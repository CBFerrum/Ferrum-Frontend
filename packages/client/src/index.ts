// @ferrum/client (docs/plan/apps-ui.md §10.4): what an app's interface needs from the platform,
// whatever framework it is written in: the bootstrap the server put in its page, the shell API
// (with fallbacks where no shell runs, as in a test or a page opened outside one), and requests to
// the API with the browser's session, with the platform's errors and version checks handled.

import { parseApiError } from "./errors";

export { ApiError, errorMessage, parseApiError, type FieldError } from "./errors";
export {
  compareDecimal,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatValue,
  humanize,
  initials,
  isDecimalString,
  NUMERIC_TYPES,
  relativeTime,
  setTimeZone,
  shortId,
  todayIso,
  type FormatOptions,
} from "../../../src/lib/format";

export interface Bootstrap {
  v: 1;
  /** `id` is null on public pages, which know the workspace by name only. */
  workspace: { id: string | null; slug: string; name: string; host: string };
  /** Null on public pages (§7.3): nobody is signed in there. */
  person: { id: string; name: string; email: string; kind: "member" | "guest" | "portal" | "service"; admin: boolean; actor: string | null } | null;
  app: {
    id: string;
    version: string;
    release: string;
    /** Route → its address: `{"crm": "/crm/"}`. */
    routes: Record<string, string>;
    /** The route this page was opened at. */
    entry: string;
    title: string;
    compact: boolean;
    /** The shell's records of an app without an interface of its own (`/data/{app}/`). */
    scope?: { app: string; title: string; packages: string[] } | null;
  } | null;
  host: { kind: "page" | "frame" | "companion" | "status" | "public" | "native" | "test"; shell: string };
  api: { base: string; live: string | null; auth: "cookie" | "bearer" | "none" };
  locale: { language: string; timezone: string; dir: "ltr" | "rtl" };
  theme: { appearance: "light" | "dark" | "system"; hash: string };
  company: string | null;
  flags: Record<string, unknown>;
  /** On a public page: which of the app's public pages (`drive/s`). */
  public?: string;
}

let cached: Bootstrap | null | undefined;

/**
 * The page's bootstrap, or null outside a page the platform served. Tests and hosts without a
 * document (a native shell's web view before load) may hand one over as
 * `globalThis.__FERRUM_BOOTSTRAP__` (see @ferrum/testing).
 */
export function bootstrap(): Bootstrap | null {
  if (cached !== undefined) return cached;
  const handed = (globalThis as { __FERRUM_BOOTSTRAP__?: Bootstrap }).__FERRUM_BOOTSTRAP__;
  if (handed) return (cached = handed);
  try {
    const el = typeof document !== "undefined" ? document.getElementById("ferrum-bootstrap") : null;
    cached = el?.textContent ? (JSON.parse(el.textContent) as Bootstrap) : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Forgets the bootstrap read (tests). */
export function resetBootstrap(): void {
  cached = undefined;
}

/** The base path of one of the app's routes, `/crm/`, from the bootstrap (or `/{route}/`). */
export function routeBase(route: string): string {
  return bootstrap()?.app?.routes?.[route] ?? (route ? `/${route}/` : "/");
}

/** Whether this page is one anyone with a link may open (no person, no session). */
export function isPublicPage(): boolean {
  return bootstrap()?.host?.kind === "public";
}

// ───────────────────────── the shell ─────────────────────────

export interface IntentOutcome<T = unknown> {
  status: "done" | "cancelled";
  result?: T;
  app?: string;
}

/** An upload the shell carries on with across page loads (§12.6). */
export interface Upload {
  id: string;
  app: string | null;
  label: string;
  name: string;
  size: number;
  type: string;
  url: string;
  state: "queued" | "uploading" | "done" | "failed" | "cancelled";
  loaded: number;
  error: string | null;
  result: unknown;
}

export interface UploadRequest {
  file: Blob;
  /** One of this site's `/api/` addresses; the file is the request's body. */
  url: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  /** What the tray calls it (the file's name by default). */
  label?: string;
}

export interface FamilyEntry {
  id: string;
  app: string;
  title: string;
  url: string;
  icon: string | null;
  color: string | null;
  current: boolean;
}

export interface Family {
  id: string;
  title: string;
  entries: FamilyEntry[];
}

export interface SidePanel {
  id: string;
  app: string;
  title: string;
  url: string;
}

/** What an intent's handler page was asked (`shell().intent.request()`). */
export interface IntentRequest {
  action: string;
  type: string;
  data: unknown;
  /** The app that asked. */
  from: string | null;
}

/** Starts an intent; on the handler's page, `request`, `done` and `cancel` answer one (§11.3). */
export interface Intent {
  <T = unknown>(request: { action: string; type: string; data?: unknown }): Promise<IntentOutcome<T>>;
  request(): Promise<IntentRequest>;
  done(result?: unknown): void;
  cancel(): void;
}

/** An entry of the bar's launcher: an app (or a part of one) the person may use. */
export interface LauncherEntry {
  id: string;
  app: string;
  title: string;
  url: string;
  description?: string | null;
  color?: string | null;
  family?: string | null;
}

export interface Shell {
  version: string;
  host: string;
  supports(capability: string): boolean;
  ready(): void;
  navigate(target: string | { entity: string; id: string } | { path: string }): boolean;
  title(text: string): void;
  breadcrumbs(trail: (string | { label: string })[]): void;
  badge(count: number): void;
  intent: Intent;
  canIntent(action: string, type: string): Promise<boolean>;
  companion(o: { kind: string; url: string; width?: number; height?: number }): Window | null;
  toast(message: string, o?: { tone?: "info" | "error" }): void;
  leaveGuard(isDirty: () => boolean): () => void;
  session: { signOut(): void; reauthenticate(): void; on(event: string, cb: (detail: unknown) => void): void };
  live: {
    subscribe(topics: string | string[], onChange: (change: Record<string, unknown>) => void, o?: { resync?: () => void }): () => void;
  };
  sidepanel: {
    open(o: string | { id: string; context?: unknown }): Promise<boolean>;
    close(): void;
    current(): string | null;
    context(): unknown;
    list(): Promise<SidePanel[]>;
  };
  uploads: {
    start(r: UploadRequest): Promise<{ id: string; done: Promise<unknown> }>;
    cancel(id: string): Promise<void>;
    retry(id: string): Promise<boolean>;
    dismiss(id: string): Promise<void>;
    list(): Upload[];
    on(event: "progress" | "done" | "failed" | "cancelled", cb: (u: Upload) => void): () => void;
  };
  family(): Promise<Family | null>;
  /** Opens the assistant beside the page with what the person is looking at (a record, a
   *  selection); false where there is none. */
  assistant(context?: unknown): Promise<boolean>;
  /** The launcher's entries: the apps the person may use. */
  apps(): Promise<LauncherEntry[]>;
  /** Events: "ready", "outdated", "sidepanel" (the panel open now, or null), "panel-context"…;
   *  returns a function that stops listening (older shells return nothing). */
  on(event: string, cb: (detail: unknown) => void): (() => void) | void;
}

const noop = () => {};

/** Where no shell runs: plain navigation and titles, no intents, no live channel; uploads go
 *  while the page lives. */
const fallback: Shell = {
  version: "0",
  host: "none",
  supports: (c) => ["navigate", "title", "uploads"].includes(c),
  ready: noop,
  navigate(target) {
    const url = typeof target === "string" ? target : "path" in target ? target.path : `/open/${encodeURIComponent(target.entity)}/${encodeURIComponent(target.id)}`;
    location.assign(url);
    return true;
  },
  title(text) {
    document.title = text;
  },
  breadcrumbs: noop,
  badge: noop,
  intent: Object.assign(() => Promise.reject(Object.assign(new Error("no shell: intents are not available"), { code: "no_handler" })), {
    request: () => Promise.reject(new Error("this page was not opened for an intent")),
    done: noop,
    cancel: noop,
  }) as Intent,
  canIntent: () => Promise.resolve(false),
  companion: ({ url }) => window.open(url, "_blank"),
  toast: noop,
  leaveGuard: () => noop,
  session: {
    signOut: () => location.assign("/login"),
    reauthenticate: () => location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`),
    on: noop,
  },
  live: { subscribe: () => noop },
  sidepanel: { open: () => Promise.resolve(false), close: noop, current: () => null, context: () => null, list: () => Promise.resolve([]) },
  uploads: {
    async start(r) {
      const id = newKey();
      const done = request<unknown>(r.url, { method: r.method ?? "POST", body: r.file, headers: { ...r.headers, "idempotency-key": id } });
      done.catch(noop);
      return { id, done };
    },
    cancel: () => Promise.resolve(),
    retry: () => Promise.resolve(false),
    dismiss: () => Promise.resolve(),
    list: () => [],
    on: () => noop,
  },
  family: () => Promise.resolve(null),
  assistant: () => Promise.resolve(false),
  apps: () => Promise.resolve([]),
  on: noop,
};

/** The shell API of the host the page runs in, or the fallback (a part an older shell lacks
 *  falls back on its own). */
export function shell(): Shell {
  const s = (globalThis as { ferrum?: { shell?: Partial<Shell> } }).ferrum?.shell;
  if (!s) return fallback;
  if (s.sidepanel && s.uploads && s.family && s.apps && s.assistant) return s as Shell;
  return { ...fallback, ...s } as Shell;
}

// ───────────────────────── requests ─────────────────────────

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Document version for optimistic concurrency (`If-Match: "v<version>"`). */
  ifMatch?: number;
  /** Makes a create safe to repeat. */
  idempotencyKey?: string;
}

export function queryString(query?: Record<string, QueryValue>): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

/**
 * A request to the API with the browser's session (the cookie). Retries reads (and creates with
 * an idempotency key) on connection errors and on 429, 502–504 (with `Retry-After`); waits while
 * the app is being upgraded (503 `app_upgrading`); asks the shell to sign in again on 401; tells
 * the shell on 409 `ui_outdated`.
 */
async function send(path: string, init: RequestOptions = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const b = bootstrap();
  const headers: Record<string, string> = { accept: "application/json", ...init.headers };
  if (b?.app) headers["x-ferrum-ui"] = `${b.app.id}@${b.app.version}`;
  if (init.ifMatch !== undefined) headers["if-match"] = `"v${init.ifMatch}"`;
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  let body: BodyInit | undefined;
  if (init.body instanceof FormData || init.body instanceof Blob || init.body instanceof URLSearchParams) body = init.body;
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const url = path + queryString(init.query);
  const retryable = method === "GET" || !!init.idempotencyKey;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, credentials: "same-origin", signal: init.signal });
    } catch (e) {
      if (init.signal?.aborted) throw e;
      if (!retryable || attempt >= 4) throw parseApiError(0, null);
      await sleep(500 * 2 ** attempt, init.signal);
      continue;
    }
    if (res.ok) return res;
    const data: unknown = await res.json().catch(() => null);
    const err = parseApiError(res.status, data);
    const after = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 500 * 2 ** attempt;
    if (res.status === 503 && err.code === "app_upgrading" && attempt < 10) {
      await sleep(wait, init.signal);
      continue;
    }
    if (retryable && attempt < 4 && [429, 502, 503, 504].includes(res.status)) {
      await sleep(wait, init.signal);
      continue;
    }
    if (res.status === 401 && !isPublicPage()) shell().session.reauthenticate();
    // The runtime checks the version when the page becomes visible: the same check, now.
    if (res.status === 409 && err.code === "ui_outdated" && typeof document !== "undefined") document.dispatchEvent(new Event("visibilitychange"));
    throw err;
  }
}

export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const res = await send(path, init);
  if (res.status === 204) return undefined as T;
  return ((res.headers.get("content-type") ?? "").includes("json") ? await res.json() : await res.text()) as T;
}

type Opts = Omit<RequestOptions, "method" | "body">;

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal) => request<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, o?: Opts) => request<T>(path, { ...o, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, o?: Opts) => request<T>(path, { ...o, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, o?: Opts) => request<T>(path, { ...o, method: "PUT", body }),
  del: <T = void>(path: string, o?: Opts) => request<T>(path, { ...o, method: "DELETE" }),
};

/** Path for a document collection or record, with every segment encoded. */
export function docPath(entity: string, ...rest: string[]): string {
  return ["/api/v1", entity, ...rest].map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join("/");
}

export function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function fileNameFrom(disposition: string | null): string | undefined {
  const m = disposition && /filename="?([^";]+)"?/i.exec(disposition);
  return m ? m[1] : undefined;
}

/** A resource of the API as a blob (an image preview, a file to hand to an editor). */
export async function fetchBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  return (await send(path, { signal })).blob();
}

/** Downloads a resource of the API (an export, an attachment) as a file. */
export async function download(path: string, fallbackName: string, query?: Record<string, QueryValue>): Promise<void> {
  const res = await send(path, { query });
  saveBlob(await res.blob(), fileNameFrom(res.headers.get("content-disposition")) ?? fallbackName);
}

/**
 * Print HTML may contain workspace-authored templates. The response's CSP does not travel with a
 * blob URL (which shares this origin), so the same policy goes in as a meta tag before any other
 * markup: no script runs in the print window.
 */
export function withPrintCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'">`;
  const m = /^\s*<!doctype[^>]*>/i.exec(html);
  return m ? m[0] + meta + html.slice(m[0].length) : `<!doctype html>${meta}${html}`;
}

/** Shows print HTML of the API in a new window. */
export async function openPrint(path: string): Promise<void> {
  // Opened inside the click, so pop-up blockers allow it, then filled in.
  const win = window.open("", "_blank");
  if (!win) throw new Error("The print window was blocked. Allow pop-ups for this site and try again.");
  win.document.title = "Preparing print…";
  win.document.body.textContent = "Preparing print preview…";
  try {
    const html = await request<string>(path);
    const url = URL.createObjectURL(new Blob([withPrintCsp(html)], { type: "text/html" }));
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win.close();
    throw e;
  }
}

// ───────────────────────── files ─────────────────────────

export interface StoredFile {
  id: string;
  url: string;
  file_name: string;
  size: number;
  sha256: string;
}

interface Limits {
  max_bytes: number;
  direct: boolean;
  direct_max_bytes: number | null;
}

let limits: Promise<Limits> | null = null;
const FALLBACK_LIMITS: Limits = { max_bytes: 25 * 1024 * 1024, direct: false, direct_max_bytes: null };

function uploadLimits(): Promise<Limits> {
  limits ??= api
    .get<{ uploads?: Limits }>("/api/version")
    .then((v) => v.uploads ?? FALLBACK_LIMITS)
    .catch(() => {
      limits = null;
      return FALLBACK_LIMITS;
    });
  return limits;
}

export function megabytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${Math.floor(bytes / 1024 ** 3)} GB` : `${Math.floor(bytes / 1024 ** 2)} MB`;
}

/**
 * Stores a file in the platform's file store (`/api/files`), attached to a record when `attach`
 * is given: through the API when it fits its request limit, else straight to object storage with
 * a presigned URL. For files that must survive the page (a big upload to Drive), hand them to
 * `shell().uploads` instead.
 */
export async function uploadFile(file: File, attach?: { entity: string; id: string }): Promise<StoredFile> {
  const l = await uploadLimits();
  if (file.size <= l.max_bytes) {
    const fd = new FormData();
    fd.append("file", file);
    if (attach) {
      fd.append("entity", attach.entity);
      fd.append("record_id", attach.id);
    }
    return api.post<StoredFile>("/api/files", fd);
  }
  if (!l.direct || l.direct_max_bytes == null || file.size > l.direct_max_bytes) {
    throw new Error(`Files must be ${megabytes(l.direct && l.direct_max_bytes != null ? l.direct_max_bytes : l.max_bytes)} or smaller.`);
  }
  const up = await api.post<{ upload_id: string; method: string; url: string; headers: Record<string, string> }>("/api/files/uploads", {
    file_name: file.name,
    content_type: file.type,
    size: file.size,
    entity: attach?.entity,
    record_id: attach?.id,
  });
  let res: Response;
  try {
    res = await fetch(up.url, { method: up.method, headers: up.headers, body: file });
  } catch {
    throw new Error("Could not reach the file storage service. Check your connection, or ask an administrator to allow uploads from this site.");
  }
  if (!res.ok) throw new Error(`The file storage service refused the upload (${res.status}).`);
  return api.post<StoredFile>(`/api/files/uploads/${up.upload_id}/complete`);
}

