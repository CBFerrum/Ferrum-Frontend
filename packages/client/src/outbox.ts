// The shared outbox (gapclose/design/S13-mobile.md §2.3, slice C1; extracted from Field Service's queue): work a person does on a
// device waits here until the server has it. One IndexedDB database per person and workspace for every app
// (`pendingName(…, "outbox", "steps")`), so the bar can count it and sign-out can ask about it. Each step carries its idempotency
// key from the start and is sent with it on every try, so the server does it once; steps of one group (one record) go in order,
// and a refused one holds back the later ones of its group only. Nothing is sent from a page older than the installed release.

import { ApiError, bootstrap, errorBody, errorMessage, offlineEnv, request as clientRequest, shell, type RequestOptions } from "./index";
import { forgetCached, pendingName } from "./offline";

export interface Step {
  /** Idempotency-Key: `{app}.{group}.{at}.{rand8}`, the same on every try. */
  key: string;
  /** The app that owns the step (for the bar's count and sign-out). */
  app: string;
  /** Steps of one record: a refused one blocks later ones of its group only. */
  group: string;
  /** Shown to the person ("Call with Asha, 10:40"). */
  label: string;
  /** When it was done on the device (ISO). */
  at: string;
  request: { method: "POST" | "PATCH"; path: string; body: unknown; query?: Record<string, string>; digest?: string };
  /** Files sent first (kept with `putFile` under `{key}.{name}`); `prepare` puts their ids into the body. */
  files?: string[];
}

export interface Refused {
  step: Step;
  reason: string;
  status: number;
  at: string;
}

/** Where the steps are kept: IndexedDB in a browser (`idbStore`), memory in a test (`memoryStore`). */
export interface OutboxStore {
  /** Every step waiting, in the order they were held. */
  steps(): Promise<Step[]>;
  add(step: Step): Promise<void>;
  /** A step sent: it and its files go together. */
  remove(key: string): Promise<void>;
  refused(): Promise<Refused[]>;
  /** A step refused: it moves from the steps to the refused, keeping its place for a retry. */
  refuse(r: Refused): Promise<void>;
  /** A refused step tried again (`back`) or discarded: out of the refused. */
  unrefuse(key: string, back: boolean): Promise<Refused | undefined>;
  putFile(key: string, blob: Blob): Promise<void>;
  file(key: string): Promise<Blob | undefined>;
}

type Sent = { sent: Step[]; refused: Refused[]; outdated: boolean; stopped: boolean };
/** `prepare`: the step as sent, given the ids of its files once they are stored. */
type SendOptions = { prepare?: (s: Step, fileIds: Record<string, string>) => Step };

export interface OutboxDeps {
  /** Default: the person's IndexedDB database; null where there is no person (nothing is held). */
  store?: OutboxStore | null;
  request?: <T>(path: string, init?: RequestOptions) => Promise<T>;
}

const lockName = () => `ferrum-outbox-${bootstrap()?.workspace.slug ?? ""}`;
const chains = new Map<string, Promise<unknown>>();

/** One holder at a time per workspace: every tab of the origin through Web Locks, this page alone where the browser has none. When
 *  `wait` is given and the lock is not had by then, `fn` runs anyway (signing out must not hang on a sender). */
export function withLock<T>(fn: () => Promise<T>, wait?: number): Promise<T> {
  const name = lockName();
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks) {
    if (!wait) return locks.request(name, fn) as Promise<T>;
    return (locks.request(name, { signal: AbortSignal.timeout(wait) }, fn) as Promise<T>).catch((e) => (e?.name === "TimeoutError" || e?.name === "AbortError" ? fn() : Promise.reject(e)));
  }
  const prev = chains.get(name) ?? Promise.resolve();
  const turn = wait ? Promise.race([prev, new Promise((r) => setTimeout(r, wait))]) : prev;
  const run = turn.catch(() => {}).then(fn);
  chains.set(name, run.catch(() => {}));
  return run;
}

/** The outbox of `app` for the person on this page. */
export function outbox(app: string, deps: OutboxDeps = {}) {
  const request = deps.request ?? clientRequest;
  const name = () => pendingName(offlineEnv(), "outbox", "steps");
  const store = (): OutboxStore | null => (deps.store !== undefined ? deps.store : idbStore(name()));
  const mine = async (s: OutboxStore) => (await s.steps()).filter((x) => x.app === app);

  const box = {
    /** Keeps a step to send; false when the device cannot keep it (then say so: it was not taken). */
    async hold(step: Omit<Step, "key" | "app"> & { key?: string }): Promise<boolean> {
      const s = store();
      if (!s) return false;
      const key = step.key ?? `${app}.${step.group}.${step.at}.${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`.slice(0, 200);
      try {
        await s.add({ ...step, key, app });
        return true;
      } catch {
        return false;
      }
    },
    async list(): Promise<Step[]> {
      const s = store();
      return s ? mine(s) : [];
    },
    async refused(): Promise<Refused[]> {
      const s = store();
      return s ? (await s.refused()).filter((r) => r.step.app === app) : [];
    },
    /** Sends what waits, one sender at a time across tabs. Triggered by the page's load, `online`, the shell's "flush" and a timer (`watch`). */
    send(o: SendOptions = {}): Promise<Sent> {
      const out: Sent = { sent: [], refused: [], outdated: false, stopped: false };
      const s = store();
      if (!s) return Promise.resolve(out);
      return withLock(async () => {
        const boot = bootstrap();
        if (boot?.app) {
          // Never replay from a stale release: the new one sends.
          const v = await request<{ release?: string | null }>("/api/shell/version", { query: { app: boot.app.id } }).catch(() => null);
          if (!v) return { ...out, stopped: true };
          if (v.release && v.release !== "dev" && v.release !== boot.app.release) return { ...out, outdated: true };
        }
        const blocked = new Set((await s.refused()).map((r) => r.step.group));
        for (const step of await mine(s)) {
          if (blocked.has(step.group)) continue;
          try {
            const ids: Record<string, string> = {};
            for (const f of step.files ?? []) {
              const blob = await s.file(`${step.key}.${f}`);
              if (!blob) continue;
              const fd = new FormData();
              fd.append("file", blob, f);
              // ponytail: files go through /api/files in one request (photos, signatures); a file over its limit is refused like any step.
              ids[f] = (await request<{ id: string }>("/api/files", { method: "POST", body: fd, idempotencyKey: `${step.key}.${f}`, once: false })).id;
            }
            const r = (o.prepare ? o.prepare(step, ids) : step).request;
            await request(r.path, { method: r.method, body: r.body, query: r.query, idempotencyKey: step.key, idempotencyDigest: r.digest, once: false });
            await s.remove(step.key);
            out.sent.push(step);
          } catch (e) {
            const status = e instanceof ApiError ? e.status : 0;
            const code = e instanceof ApiError ? e.code : "";
            if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) {
              out.stopped = true; // kept in order, tried next time
              break;
            }
            if (status === 409 && code === "ui_outdated") {
              out.outdated = true; // the reloaded page sends it
              break;
            }
            if (status === 409 && code !== "input_changed" && namesClientRef(e) && hasClientRef(step.request.body)) {
              // Its record is there already: an earlier try whose answer was lost, after the server's receipt expired.
              await s.remove(step.key);
              out.sent.push(step);
              continue;
            }
            const refused: Refused = { step, reason: errorMessage(e), status, at: new Date().toISOString() };
            await s.refuse(refused);
            out.refused.push(refused);
            blocked.add(step.group);
          }
        }
        return out;
      });
    },
    /** A refused step back in its place, to be sent with its key. */
    async retry(key: string): Promise<boolean> {
      const s = store();
      return !!s && !!(await s.unrefuse(key, true));
    },
    /** A refused step dropped by its person; `note` may hold a step in its place (a note saying what was dropped and why). */
    async discard(key: string, note?: (r: Refused) => Step | null): Promise<boolean> {
      const s = store();
      const r = s && (await s.unrefuse(key, false));
      if (!s || !r) return false;
      const next = note?.(r);
      if (next) await s.add({ ...next, key: `${next.key}.note`.slice(0, 200), app });
      return true;
    },
    async putFile(key: string, blob: Blob): Promise<void> {
      await store()?.putFile(key, blob);
    },
    /** Sends now, when the page comes back online, when the shell asks ("flush") and every minute while the page is shown. Returns a stop. */
    watch(o?: SendOptions): () => void {
      const go = () => void box.send(o).catch(() => {});
      go();
      addEventListener("online", go);
      const off = shell().on("flush", go);
      const timer = setInterval(() => document.visibilityState === "visible" && go(), 60_000);
      return () => {
        removeEventListener("online", go);
        off?.();
        clearInterval(timer);
      };
    },
  };
  return box;
}

const hasClientRef = (body: unknown) => !!body && typeof body === "object" && typeof (body as Record<string, unknown>).client_ref === "string";
function namesClientRef(e: unknown): boolean {
  const b = errorBody(e);
  return (e instanceof ApiError && e.fields.some((f) => f.field === "client_ref")) || b?.pointer === "/client_ref";
}

/**
 * Signing out (S13 §2.1, CLOSE REVIEW): forgets what this device keeps of the workspace (the lease, cached reads, the apps' kept
 * pages) once no outbox is sending (the same lock, waited for at most 5 s). Work not sent stays for its person.
 */
export function forgetHere(): Promise<string[]> {
  const g = globalThis as { indexedDB?: IDBFactory; caches?: CacheStorage };
  let idb: IDBFactory | undefined;
  let caches: CacheStorage | undefined;
  try {
    idb = g.indexedDB;
    caches = g.caches;
  } catch {
    // A page the browser keeps from storage: nothing was kept.
  }
  return withLock(() => forgetCached(offlineEnv(), idb, caches), 5000);
}

// ───────────────────────── storage ─────────────────────────

let order = 0;
/** The order steps were held in, across pages: time, then a counter for the same millisecond. */
const nextSeq = () => Date.now() * 1000 + (order++ % 1000);

/** Steps in memory (tests, and where nothing can be kept). */
export function memoryStore(): OutboxStore {
  const steps = new Map<string, Step & { seq: number }>();
  const refused = new Map<string, Refused & { seq: number }>();
  const files = new Map<string, Blob>();
  const dropFiles = (key: string) => [...files.keys()].filter((k) => k.startsWith(`${key}.`)).forEach((k) => files.delete(k));
  return {
    steps: async () => [...steps.values()].sort((a, b) => a.seq - b.seq).map(({ seq: _, ...s }) => s),
    add: async (s) => void steps.set(s.key, { ...s, seq: nextSeq() }),
    remove: async (key) => {
      steps.delete(key);
      dropFiles(key);
    },
    refused: async () => [...refused.values()].map(({ seq: _, ...r }) => r),
    refuse: async (r) => {
      refused.set(r.step.key, { ...r, seq: steps.get(r.step.key)?.seq ?? nextSeq() });
      steps.delete(r.step.key);
    },
    unrefuse: async (key, back) => {
      const r = refused.get(key);
      if (!r) return undefined;
      refused.delete(key);
      if (back) steps.set(key, { ...r.step, seq: r.seq });
      else dropFiles(key);
      const { seq: _, ...rest } = r;
      return rest;
    },
    putFile: async (key, blob) => void files.set(key, blob),
    file: async (key) => files.get(key),
  };
}

const done = <T,>(r: IDBRequest<T>) => new Promise<T>((ok, fail) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => fail(r.error))));
const finished = (tx: IDBTransaction) => new Promise<void>((ok, fail) => ((tx.oncomplete = () => ok()), (tx.onerror = tx.onabort = () => fail(tx.error))));

const opens = new Map<string, OutboxStore>();

/** The person's outbox database (one per name for the page): stores `steps` (by key, each with its `seq`), `refused` (by the
 *  step's key) and `files`. Null without a name (no person) or where the browser keeps nothing. */
export function idbStore(name: string | null): OutboxStore | null {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!name || !idb) return null;
  if (!opens.has(name)) opens.set(name, openStore(idb, name));
  return opens.get(name)!;
}

function openStore(idb: IDBFactory, name: string): OutboxStore {
  let opened: Promise<IDBDatabase> | null = null;
  const db = () =>
    (opened ??= new Promise<IDBDatabase>((ok, fail) => {
      const r = idb.open(name, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("steps", { keyPath: "key" }).createIndex("seq", "seq");
        r.result.createObjectStore("refused", { keyPath: "step.key" });
        r.result.createObjectStore("files");
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => {
        opened = null;
        fail(r.error);
      };
    }));
  const tx = async (stores: string[], mode: IDBTransactionMode = "readonly") => (await db()).transaction(stores, mode);
  const dropFiles = (t: IDBTransaction, key: string) => t.objectStore("files").delete(IDBKeyRange.bound(`${key}.`, `${key}.￿`));
  return {
    async steps() {
      const all = await done((await tx(["steps"])).objectStore("steps").index("seq").getAll());
      return (all as (Step & { seq: number })[]).map(({ seq: _, ...s }) => s);
    },
    async add(s) {
      const t = await tx(["steps"], "readwrite");
      t.objectStore("steps").put({ ...s, seq: nextSeq() });
      await finished(t);
    },
    async remove(key) {
      const t = await tx(["steps", "files"], "readwrite");
      t.objectStore("steps").delete(key);
      dropFiles(t, key);
      await finished(t);
    },
    async refused() {
      const all = await done((await tx(["refused"])).objectStore("refused").getAll());
      return (all as (Refused & { seq: number })[]).map(({ seq: _, ...r }) => r);
    },
    async refuse(r) {
      const t = await tx(["steps", "refused"], "readwrite");
      const was = (await done(t.objectStore("steps").get(r.step.key))) as { seq?: number } | undefined;
      t.objectStore("refused").put({ ...r, seq: was?.seq ?? nextSeq() });
      t.objectStore("steps").delete(r.step.key);
      await finished(t);
    },
    async unrefuse(key, back) {
      const t = await tx(["steps", "refused", "files"], "readwrite");
      const r = (await done(t.objectStore("refused").get(key))) as (Refused & { seq: number }) | undefined;
      if (r) {
        t.objectStore("refused").delete(key);
        if (back) t.objectStore("steps").put({ ...r.step, seq: r.seq });
        else dropFiles(t, key);
      }
      await finished(t);
      if (!r) return undefined;
      const { seq: _, ...rest } = r;
      return rest;
    },
    async putFile(key, blob) {
      const t = await tx(["files"], "readwrite");
      t.objectStore("files").put(blob, key);
      await finished(t);
    },
    async file(key) {
      return (await done((await tx(["files"])).objectStore("files").get(key))) as Blob | undefined;
    },
  };
}
