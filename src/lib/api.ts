// HTTP client for the Ferrum API: bearer auth, uniform error parsing, retries on connection
// errors (the dev server restarts now and then), authenticated downloads and print previews.

export interface FieldError {
  field: string;
  message: string;
  /** `[tableField, rowIndex]` for errors in child rows. */
  row?: [string, number];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldError[] = [],
    readonly errorId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const FALLBACK: Record<number, [string, string]> = {
  0: ["network", "Cannot reach the server. Check your connection and try again."],
  400: ["invalid", "The request was not valid."],
  401: ["unauthorized", "Your session has ended. Please sign in again."],
  403: ["forbidden", "You do not have permission to do that."],
  404: ["not_found", "Not found."],
  409: ["conflict", "This record was changed by someone else. Reload and try again."],
  413: ["too_large", "The upload is too large."],
  422: ["invalid", "Please check your input."],
  429: ["too_many_requests", "Too many requests. Please wait a moment and try again."],
  502: ["unavailable", "The server cannot be reached right now (it may be restarting). Please try again shortly."],
  503: ["unavailable", "The server is temporarily unavailable. Please try again shortly."],
  504: ["unavailable", "The server took too long to answer. Please try again shortly."],
};

function isFieldError(v: unknown): v is FieldError {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return typeof f.field === "string" && typeof f.message === "string";
}

/** Turns a non-2xx response (status + parsed JSON body, if any) into an `ApiError`. */
export function parseApiError(status: number, body: unknown): ApiError {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const [fbCode, fbMessage] =
    FALLBACK[status] ?? (status >= 500 ? ["server_error", "Something went wrong on the server."] : ["error", `Request failed (${status}).`]);
  const code = typeof b.error === "string" && b.error ? b.error : fbCode;
  let message = typeof b.message === "string" && b.message ? b.message : fbMessage;
  const fields: FieldError[] = (Array.isArray(b.fields) ? b.fields : []).filter(isFieldError).map((f) => {
    const row = Array.isArray(f.row) && typeof f.row[0] === "string" && Number.isInteger(f.row[1]) ? f.row : undefined;
    return row ? { field: f.field, message: f.message, row: [row[0], row[1]] } : { field: f.field, message: f.message };
  });
  const errorId = typeof b.error_id === "string" ? b.error_id : undefined;
  if (errorId) message = `${message} (reference ${errorId})`;
  return new ApiError(status, code, message, fields, errorId);
}

/** A one-line message for toasts; includes field errors when there is no form to show them in. */
export function errorMessage(e: unknown, withFields = true): string {
  if (e instanceof ApiError) {
    if (withFields && e.fields.length) {
      const detail = e.fields.map((f) => (f.row ? `row ${f.row[1] + 1} ${f.field}` : f.field) + `: ${f.message}`).join("; ");
      return `${e.message} — ${detail}`;
    }
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

// ── session ──

export interface Session {
  token: string;
  tenant: string;
  email: string;
}

const SESSION_KEY = "ferrum.session";

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s && typeof s.token === "string" ? s : null;
  } catch {
    return null;
  }
}

let session: Session | null = loadSession();
let onUnauthorized: () => void = () => {};

export function getSession(): Session | null {
  return session;
}

export function setSession(s: Session | null): void {
  session = s;
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode, disabled): the in-memory token still works
  }
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

// ── requests ──

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Document version for optimistic concurrency (`If-Match: "v<version>"`). */
  ifMatch?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Do not treat a 401 as an expired session (login, password checks). */
  noAuthRedirect?: boolean;
  /** A bearer token instead of the session's (the steps of signing in). */
  token?: string;
  /** Further request headers (X-Ferrum-App for the calls of an app's screen). */
  headers?: Record<string, string>;
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

const RETRY_STATUS = new Set([429, 502, 503, 504]);

async function send(path: string, o: RequestOptions = {}): Promise<Response> {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json", ...o.headers };
  const token = o.token ?? session?.token;
  if (token) headers.authorization = `Bearer ${token}`;
  if (o.ifMatch !== undefined) headers["if-match"] = `"v${o.ifMatch}"`;
  if (o.idempotencyKey) headers["idempotency-key"] = o.idempotencyKey;
  let body: BodyInit | undefined;
  if (o.body instanceof FormData || o.body instanceof Blob) body = o.body;
  else if (o.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(o.body);
  }
  // Safe to repeat: reads, and creates that carry an idempotency key.
  const retryable = method === "GET" || !!o.idempotencyKey;
  const url = path + queryString(o.query);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: o.signal });
    } catch (e) {
      if (o.signal?.aborted) throw e;
      if (retryable && attempt < 4) {
        await sleep(500 * 2 ** attempt, o.signal);
        continue;
      }
      throw parseApiError(0, null);
    }
    if (res.ok) return res;
    // A dev proxy answers a bare 500 while the backend restarts; the API's own 500s are JSON.
    const unreachable = res.status === 500 && !(res.headers.get("content-type") ?? "").includes("json");
    if (retryable && attempt < 4 && (RETRY_STATUS.has(res.status) || unreachable)) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 500 * 2 ** attempt, o.signal);
      continue;
    }
    const data: unknown = await res.json().catch(() => null);
    const err = parseApiError(unreachable ? 502 : res.status, data);
    if (res.status === 401 && !o.noAuthRedirect) {
      setSession(null);
      onUnauthorized();
    }
    throw err;
  }
}

export async function request<T>(path: string, o: RequestOptions = {}): Promise<T> {
  const res = await send(path, o);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? await res.json() : await res.text()) as T;
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

// ── downloads & print ──

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

/** An authenticated resource as a blob (an image preview: an <img> cannot send the session). */
export async function fetchBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  return (await send(path, { signal })).blob();
}

/** Downloads an authenticated resource (CSV export, attachment) as a file. */
export async function download(path: string, fallbackName: string, query?: Record<string, QueryValue>): Promise<void> {
  const res = await send(path, { query });
  saveBlob(await res.blob(), fileNameFrom(res.headers.get("content-disposition")) ?? fallbackName);
}

/**
 * Print HTML may contain tenant-authored templates. The response's CSP header does not travel
 * with a blob URL (which shares our origin), so the same policy is injected as a meta tag placed
 * before any other markup: no scripts can run in the print window.
 */
export function withPrintCsp(html: string): string {
  const meta =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'">`;
  const m = /^\s*<!doctype[^>]*>/i.exec(html);
  return m ? m[0] + meta + html.slice(m[0].length) : `<!doctype html>${meta}${html}`;
}

/** Fetches print HTML with auth and shows it in a new window via a blob URL. */
export async function openPrint(path: string): Promise<void> {
  // Open synchronously (inside the click) so pop-up blockers allow it, then fill it in.
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
