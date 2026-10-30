// @ferrum/client (docs/plan/apps-ui.md §10.4): what an app's interface needs from the platform,
// whatever framework it is written in: the bootstrap the server put in its page, the shell API
// (with fallbacks where no shell runs, as in a test or a page opened outside one), and requests to
// the API with the browser's session, with the platform's errors and version checks handled.

export interface Bootstrap {
  v: 1;
  workspace: { id: string; slug: string; name: string; host: string };
  person: { id: string; name: string; email: string; kind: "member" | "guest" | "portal" | "service"; admin: boolean; actor: string | null };
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
  } | null;
  host: { kind: "page" | "frame" | "companion" | "status" | "native" | "test"; shell: string };
  api: { base: string; live: string; auth: "cookie" | "bearer" };
  locale: { language: string; timezone: string; dir: "ltr" | "rtl" };
  theme: { appearance: "light" | "dark" | "system"; hash: string };
  company: string | null;
  flags: Record<string, unknown>;
  legacy?: string;
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

// ───────────────────────── the shell ─────────────────────────

export interface IntentOutcome<T = unknown> {
  status: "done" | "cancelled";
  result?: T;
  app?: string;
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
  intent<T = unknown>(request: { action: string; type: string; data?: unknown }): Promise<IntentOutcome<T>>;
  canIntent(action: string, type: string): Promise<boolean>;
  companion(o: { kind: string; url: string; width?: number; height?: number }): Window | null;
  toast(message: string, o?: { tone?: "info" | "error" }): void;
  leaveGuard(isDirty: () => boolean): () => void;
  session: { signOut(): void; reauthenticate(): void; on(event: string, cb: (detail: unknown) => void): void };
  live: { subscribe(topics: string | string[], onChange: (change: Record<string, unknown>) => void): () => void };
  on(event: string, cb: (detail: unknown) => void): void;
}

const noop = () => {};

/** Where no shell runs: plain navigation and titles, no intents, no live channel. */
const fallback: Shell = {
  version: "0",
  host: "none",
  supports: (c) => ["navigate", "title"].includes(c),
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
  intent: () => Promise.reject(Object.assign(new Error("no shell: intents are not available"), { code: "no_handler" })),
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
  on: noop,
};

/** The shell API of the host the page runs in, or the fallback. */
export function shell(): Shell {
  const s = (globalThis as { ferrum?: { shell?: Shell } }).ferrum?.shell;
  return s ?? fallback;
}

// ───────────────────────── requests ─────────────────────────

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: { field: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A request to the API with the browser's session (the cookie). Retries reads on connection
 * errors and on 429, 502–504 (with `Retry-After`); waits while the app is being upgraded (503
 * `app_upgrading`); asks the shell to sign in again on 401; tells the shell on 409 `ui_outdated`.
 */
export async function request<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | null | undefined>; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const b = bootstrap();
  const headers: Record<string, string> = { accept: "application/json", ...init.headers };
  if (b?.app) headers["x-ferrum-ui"] = `${b.app.id}@${b.app.version}`;
  let body: BodyInit | undefined;
  if (init.body instanceof FormData || init.body instanceof Blob) body = init.body;
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const url = path + (q.size ? `?${q}` : "");
  const retryable = method === "GET";
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, credentials: "same-origin", signal: init.signal });
    } catch (e) {
      if (init.signal?.aborted || !retryable || attempt >= 4) throw new ApiError(0, "network", "Cannot reach the server. Check your connection and try again.");
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return ((res.headers.get("content-type") ?? "").includes("json") ? await res.json() : await res.text()) as T;
    }
    const data = (await res.json().catch(() => null)) as { error?: string; message?: string; fields?: { field: string; message: string }[] } | null;
    const code = data?.error ?? "error";
    const after = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 500 * 2 ** attempt;
    if (res.status === 503 && code === "app_upgrading" && attempt < 10) {
      await sleep(wait);
      continue;
    }
    if (retryable && attempt < 4 && [429, 502, 503, 504].includes(res.status)) {
      await sleep(wait);
      continue;
    }
    if (res.status === 401) shell().session.reauthenticate();
    // The runtime checks the version when the page becomes visible: the same check, now.
    if (res.status === 409 && code === "ui_outdated" && typeof document !== "undefined") document.dispatchEvent(new Event("visibilitychange"));
    throw new ApiError(res.status, code, data?.message ?? `Request failed (${res.status}).`, data?.fields ?? []);
  }
}

export const api = {
  get: <T>(path: string, query?: Record<string, string | number | boolean | null | undefined>, signal?: AbortSignal) => request<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  del: <T = void>(path: string) => request<T>(path, { method: "DELETE" }),
};
