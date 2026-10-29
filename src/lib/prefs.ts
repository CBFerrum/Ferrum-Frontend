// Per-user interface preferences (`/api/prefs`): one JSON value per scope (`list:SalesInvoice`),
// kept on the server so they follow the user to every device. All scopes load in one cached request.
// `usePref` changes a value at once (optimistically) and saves it after a short pause. A save that
// lost a race with another tab or device (409) reloads the stored value, reapplies this tab's changes
// on top of it (`rebasePref`) and saves again. Unsaved values are sent when the page is hidden.

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { api, ApiError, getSession, parseApiError } from "./api";

export interface PrefEntry {
  value: unknown;
  version: number;
}
export type PrefsMap = Record<string, PrefEntry>;

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep equality of JSON values; object key order does not matter (the server may reorder keys). */
export function samePref(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => samePref(x, b[i]));
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => samePref(a[k], b[k]));
  }
  return false;
}

/**
 * `stored` over `defaults`: nested objects merge key by key, anything else is replaced. A stored value
 * whose type differs from its default (an old or damaged preference) is ignored; keys without a
 * default are kept as stored.
 */
export function mergePref<T>(defaults: T, stored: unknown): T {
  if (stored === undefined || stored === null) return defaults;
  if (defaults === undefined || defaults === null) return stored as T;
  if (isPlain(defaults)) {
    if (!isPlain(stored)) return defaults;
    const out: Plain = { ...stored };
    for (const [k, d] of Object.entries(defaults)) out[k] = mergePref(d, stored[k]);
    return out as T;
  }
  if (Array.isArray(defaults)) return (Array.isArray(stored) ? stored : defaults) as T;
  return (typeof stored === typeof defaults ? stored : defaults) as T;
}

/**
 * Three-way merge for a save that lost a race: this tab's changes (`local` against `base`, the stored
 * value it started from) applied over `remote`, the newer stored value. Objects merge key by key, so
 * changes to different keys are all kept; where both sides changed the same value, this tab's (the
 * latest intent here) wins. `undefined` means absent, so deletions merge too.
 */
export function rebasePref(base: unknown, local: unknown, remote: unknown): unknown {
  if (samePref(local, base)) return remote;
  if (samePref(remote, base)) return local;
  // A value deleted elsewhere merges as an empty object: only this tab's changes survive.
  if (isPlain(local) && (isPlain(remote) || remote === undefined)) {
    const b = isPlain(base) ? base : {};
    const r = remote ?? {};
    const out: Plain = {};
    for (const k of new Set([...Object.keys(r), ...Object.keys(local)])) {
      const v = rebasePref(b[k], local[k], r[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return local;
}

// ── saving ──

/** What the writer needs from the outside world (the API and the query cache; fakes in tests). */
export interface PrefIO {
  /** Version 0 creates the value only if none is stored (otherwise a 409, as for a stale version). */
  put(scope: string, value: unknown, version: number, keepalive: boolean): Promise<PrefEntry>;
  del(scope: string): Promise<void>;
  /** Fetches every stored preference again (and refreshes the cache). */
  reload(): Promise<PrefsMap>;
  /** The stored entry as last read. */
  stored(scope: string): PrefEntry | undefined;
  /** Records a saved entry (`undefined`: reset). */
  saved(scope: string, entry: PrefEntry | undefined): void;
}

/** The value meaning "forget the stored value". */
const RESET: unique symbol = Symbol("reset");

/** A value changed here and not saved yet. Replaced, never mutated, so it can be a store snapshot. */
export interface Draft {
  readonly local: unknown;
  /** The stored value and version the local change applies to. */
  readonly base: unknown;
  readonly version?: number;
  readonly busy: boolean;
  readonly error?: unknown;
}

const CONFLICT_RETRIES = 3;

export class PrefWriter {
  private drafts = new Map<string, Draft>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();

  constructor(
    private io: PrefIO,
    private delay = 500,
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  get = (scope: string): Draft | undefined => this.drafts.get(scope);

  /** Changes the value now and saves it after a pause (later changes restart the pause). */
  set(scope: string, value: unknown): void {
    this.change(scope, value);
  }

  /** Back to the defaults: the stored value is deleted. */
  reset(scope: string): void {
    this.change(scope, RESET);
  }

  /** Saves every unsaved value now (the page is being hidden, or the connection is back). */
  flushAll(keepalive = false): void {
    for (const scope of [...this.drafts.keys()]) void this.flush(scope, keepalive);
  }

  /** Saves `scope` now; resolves when it is saved, or failed (see `Draft.error`). */
  async flush(scope: string, keepalive = false, conflicts = 0): Promise<void> {
    clearTimeout(this.timers.get(scope));
    this.timers.delete(scope);
    const d = this.drafts.get(scope);
    if (!d || d.busy) return; // a running save sends newer values when it ends
    const sending = d.local;
    this.put(scope, { ...d, busy: true, error: undefined });
    try {
      let saved: PrefEntry | undefined;
      if (sending === RESET) await this.io.del(scope);
      else saved = await this.io.put(scope, sending, d.version ?? 0, keepalive);
      this.io.saved(scope, saved);
      const now = this.drafts.get(scope)!;
      if (now.local === sending) return this.put(scope, undefined);
      // Changed again while saving: save that too, on top of what was just stored.
      this.put(scope, { ...now, busy: false, base: saved?.value, version: saved?.version });
      return this.flush(scope, keepalive);
    } catch (e) {
      let error = e;
      if (e instanceof ApiError && e.status === 409 && conflicts < CONFLICT_RETRIES) {
        try {
          const remote = (await this.io.reload())[scope];
          const now = this.drafts.get(scope)!;
          const local = now.local === RESET ? RESET : rebasePref(now.base, now.local, remote?.value);
          this.put(scope, { local, base: remote?.value, version: remote?.version, busy: false });
          return this.flush(scope, keepalive, conflicts + 1);
        } catch (e2) {
          error = e2;
        }
      }
      this.put(scope, { ...this.drafts.get(scope)!, busy: false, error });
    }
  }

  private change(scope: string, local: unknown) {
    const d = this.drafts.get(scope);
    const s = d ? undefined : this.io.stored(scope);
    this.put(scope, d ? { ...d, local, error: undefined } : { local, base: s?.value, version: s?.version, busy: false });
    clearTimeout(this.timers.get(scope));
    this.timers.set(
      scope,
      setTimeout(() => void this.flush(scope), this.delay),
    );
  }

  private put(scope: string, d: Draft | undefined) {
    if (d) this.drafts.set(scope, d);
    else this.drafts.delete(scope);
    this.listeners.forEach((fn) => fn());
  }
}

// ── the hook ──

const KEY = ["prefs"] as const;
const path = (scope: string) => `/api/prefs/${encodeURIComponent(scope)}`;

async function loadPrefs(signal?: AbortSignal): Promise<PrefsMap> {
  return (await api.get<{ prefs?: PrefsMap }>("/api/prefs", undefined, signal)).prefs ?? {};
}

async function putPref(scope: string, value: unknown, version: number, keepalive: boolean): Promise<PrefEntry> {
  const body = JSON.stringify({ value, version });
  if (!keepalive || body.length > 60_000) return api.put<PrefEntry>(path(scope), { value, version });
  // The page is being hidden, maybe closed: a keepalive request outlives it (bodies up to 64 KB).
  const session = getSession();
  const res = await fetch(path(scope), {
    method: "PUT",
    keepalive: true,
    headers: { accept: "application/json", "content-type": "application/json", ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
    body,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw parseApiError(res.status, data);
  return data as PrefEntry;
}

const writers = new WeakMap<QueryClient, PrefWriter>();

function writerFor(qc: QueryClient): PrefWriter {
  let w = writers.get(qc);
  if (w) return w;
  const writer = new PrefWriter({
    put: putPref,
    del: (scope) => api.del(path(scope)),
    reload: () => qc.fetchQuery({ queryKey: KEY, queryFn: ({ signal }) => loadPrefs(signal), staleTime: 0 }),
    stored: (scope) => qc.getQueryData<PrefsMap>(KEY)?.[scope],
    saved: (scope, entry) => {
      // Never into an empty cache (a partial map would pass for "nothing else stored"): load it all.
      if (!qc.getQueryData(KEY)) return void qc.invalidateQueries({ queryKey: KEY });
      qc.setQueryData<PrefsMap>(KEY, (old) => {
        const next = { ...old };
        if (entry) next[scope] = { value: entry.value, version: entry.version };
        else delete next[scope];
        return next;
      });
    },
  });
  writers.set(qc, writer);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && writer.flushAll(true));
  window.addEventListener("online", () => writer.flushAll());
  return writer;
}

export interface Pref<T> {
  /** The stored value over the defaults, or this tab's unsaved change. */
  value: T;
  /** Changes the value (or derives it from the current one); saved after a short pause. */
  set: (next: T | ((current: T) => T)) => void;
  /** Forgets the stored value: back to the defaults. */
  reset: () => void;
  /** Stored preferences have loaded (or failed to: the defaults apply). */
  ready: boolean;
  /** A change is waiting to be saved. */
  saving: boolean;
  /** Why the last save failed; the change stays here and is saved with the next one. */
  error: unknown;
}

/** One preference of the signed-in user. `defaults` may be a new object on every render. */
export function usePref<T>(scope: string, defaults: T): Pref<T> {
  const qc = useQueryClient();
  const writer = writerFor(qc);
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => loadPrefs(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: true, // pick up what other devices changed
  });
  const getDraft = () => writer.get(scope);
  const draft = useSyncExternalStore(writer.subscribe, getDraft, getDraft);
  const stored = draft ? (draft.local === RESET ? undefined : draft.local) : q.data?.[scope]?.value;
  const key = JSON.stringify(defaults); // stands for `defaults` in the dependencies below
  const value = useMemo(() => mergePref(defaults, stored), [stored, key]);
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      // From the latest value, which an earlier call in the same event may have changed.
      const d = writer.get(scope);
      const current = mergePref(defaults, d ? (d.local === RESET ? undefined : d.local) : qc.getQueryData<PrefsMap>(KEY)?.[scope]?.value);
      writer.set(scope, typeof next === "function" ? (next as (c: T) => T)(current) : next);
    },
    [writer, qc, scope, key],
  );
  const reset = useCallback(() => writer.reset(scope), [writer, scope]);
  return { value, set, reset, ready: q.status !== "pending", saving: !!draft, error: draft?.error ?? null };
}
