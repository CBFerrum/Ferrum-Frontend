// A connection as the administration screen edits it (docs/api.md "Connections"; BD-29 to BD-33). The description is kept as
// the server's own JSON, so a property this screen has no control for survives an edit; the helpers here read and change one
// place in it and say what the server would refuse before anything is sent. Secrets are
// write-only: this file never holds a value, only names.

import { t } from "@ferrum/client";

export type Desc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What `GET /api/admin/connections` lists. A package's connection not yet taken up has `id: null, offered: true`. */
export interface ConnectionRow {
  id: string | null;
  name: string;
  label: string;
  description: Desc;
  enabled: boolean;
  secrets: string[];
  account?: { status?: string | null; account?: string | null; expires_at?: string | null } | null;
  source?: string | null;
  refused?: number;
  debug_until?: string | null;
  inbound?: string;
  offered?: boolean;
}

/** `GET /api/connections`: a person's own. `status` is null when they have not connected. */
export interface PersonalConnection {
  id: string;
  name: string;
  label: string;
  status: string | null;
  account: string | null;
}

export type ConnState = "on" | "off" | "reconnect";

/** On, off, or needing to be connected again (the workspace's sign-in the provider no longer accepts). */
export const connectionState = (c: Pick<ConnectionRow, "enabled" | "account">): ConnState => (c.account?.status === "needs_reconnecting" ? "reconnect" : c.enabled ? "on" : "off");

export const STATE: Record<ConnState, { tone: "green" | "neutral" | "amber"; get label(): string }> = {
  on: { tone: "green", get label() { return t("On"); } },
  off: { tone: "neutral", get label() { return t("Off"); } },
  reconnect: { tone: "amber", get label() { return t("Needs reconnecting"); } },
};

/** Whether a person's own sign-in works, needs doing again, or was never done. */
export const personalState = (c: PersonalConnection): "connected" | "reconnect" | "none" => (c.status === "connected" ? "connected" : c.status === "needs_reconnecting" ? "reconnect" : "none");

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

/** `d` with `path` set to `value` (a copy); an empty value takes the property away. */
export function put(d: Desc, path: string[], value: unknown): Desc {
  const [head, ...rest] = path;
  const next = { ...d };
  const inner = rest.length ? put(d[head] && typeof d[head] === "object" && !Array.isArray(d[head]) ? d[head] : {}, rest, value) : value;
  if (rest.length === 0 && isEmpty(inner)) delete next[head];
  else next[head] = inner;
  return next;
}

export const at = (d: Desc, ...path: string[]): any => path.reduce((o: any, k) => (o && typeof o === "object" ? o[k] : undefined), d); // eslint-disable-line @typescript-eslint/no-explicit-any

/** A number typed in a box: empty is nothing, a non-number stays text so the server says why. */
export const number = (s: string): number | string | undefined => (s.trim() === "" ? undefined : Number.isFinite(Number(s)) ? Number(s) : s);

/** One name per line (or comma) as a list, and back. */
export const lines = (s: string): string[] => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

/** The raw view's text as a description: an object, or why not, in words. */
export function parseDescription(text: string): { ok: true; value: Desc } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: {} };
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, value: v as Desc } : { ok: false, error: t("The description is one JSON object, {…}.") };
  } catch (e) {
    return { ok: false, error: t("This is not valid JSON: {reason}", { reason: e instanceof Error ? e.message : String(e) }) };
  }
}

/** `{a, b}` as the same words an input takes: `["weight", "ref"]` from "weight, ref". */
/** A map as rows; a value that is not text (a pick, a file part) stays as it is. */
export const entries = (m: unknown): [string, unknown][] => Object.entries((m && typeof m === "object" ? m : {}) as Record<string, unknown>);

/** Every secret the description names: the ones calls, the signing and the sign-in use, and any a template reads as `secret.<name>`. */
export function secretNames(d: Desc): string[] {
  const names = [at(d, "auth", "secret"), at(d, "auth", "provider", "client_secret"), at(d, "inbound", "verify", "secret")].filter((n): n is string => typeof n === "string" && n !== "");
  for (const m of JSON.stringify(d).matchAll(/secret\.([a-z][a-z0-9_]*)/g)) names.push(m[1]);
  return [...new Set(names)];
}

export interface Undrawn { path: string; value: unknown }
const own = (o: unknown): o is Desc => !!o && typeof o === "object" && !Array.isArray(o);
const DRAWN = {
  description: ["base", "auth", "headers", "allowed_hosts", "timeout_ms", "max_bytes", "test", "roles", "apps", "operations", "inbound", "pulls", "meta"],
  operation: ["method", "path", "inputs", "body", "form", "result", "error_at", "idempotency_header", "fixture"],
  pull: ["name", "operation", "every_minutes", "items_at", "cursor", "next_at", "cursor_input", "max_pages", "map"],
  mapping: ["entity", "items_at", "by", "set", "create", "update_only", "outside"],
  inbound: ["verify", "delivery_header", "delivery_at", "handler", "map"],
  verify: ["type", "header", "secret", "timestamp_header", "prefix", "window_secs"],
  provider: ["dpop", "registration_url", "authorize_url", "token_url", "revoke_url", "client_id", "account_at", "client_secret", "scopes"],
  auth: {
    none: [], header: ["header", "prefix", "secret"], basic: ["username", "secret"], bearer: ["secret"], signed: ["header", "secret", "timestamp_header", "encoding"],
    session: ["login", "refresh", "token_at", "refresh_at", "expires_at", "header", "prefix"], oauth: ["owner", "provider"],
  } as Record<string, string[]>,
};

/** What the form has no control for, at every level (the description, its sign-in, each operation, pull, mapping and the inbound
 * side): shown read-only, kept as it is, edited in the JSON view. */
export function undrawn(d: Desc): Undrawn[] {
  const rest = (o: unknown, drawn: string[], path: string): Undrawn[] => (own(o) ? Object.keys(o).filter((k) => !drawn.includes(k)).map((k) => ({ path: path ? `${path}.${k}` : k, value: o[k] })) : []);
  const kind = typeof at(d, "auth", "type") === "string" ? (at(d, "auth", "type") as string) : "none";
  const map = (m: unknown, path: string) => rest(m, DRAWN.mapping, path);
  return [
    ...rest(d, DRAWN.description, ""),
    ...rest(d.auth, ["type", ...(DRAWN.auth[kind] ?? [])], "auth"),
    ...(kind === "oauth" ? rest(at(d, "auth", "provider"), DRAWN.provider, "auth.provider") : []),
    ...entries(d.operations).flatMap(([n, op]) => rest(op, DRAWN.operation, `operations.${n}`)),
    ...(Array.isArray(d.pulls) ? d.pulls : []).flatMap((p, i) => [...rest(p, DRAWN.pull, `pulls[${i}]`), ...map(own(p) ? p.map : undefined, `pulls[${i}].map`)]),
    ...rest(d.inbound, DRAWN.inbound, "inbound"),
    ...rest(at(d, "inbound", "verify"), DRAWN.verify, "inbound.verify"),
    ...map(at(d, "inbound", "map"), "inbound.map"),
  ];
}

/** A secret's name: lower case letters, digits and `_`, starting with a letter (what the server takes). */
export const NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** The secrets typed for a new connection: only those with a value (nothing to keep, nothing to lose), none when none was typed. */
export function typedSecrets(values: Record<string, string>): Record<string, string> | undefined {
  const typed = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
  return Object.keys(typed).length ? typed : undefined;
}

/** `PATCH /api/admin/connections/{id}/secrets`: set or replace some, remove others, the rest kept. */
export const secretsPatch = (set: Record<string, string>, remove: string[] = []) => ({ set, remove });

export type PickKind = "at" | "header" | "link" | "expr";
export const PICK_KINDS: PickKind[] = ["at", "header", "link", "expr"];
export interface ResultPick { kind: PickKind; value: string; required: boolean }

/** A result or mapping value as a pick (BD-46): a pointer, or `{at | header | link | expr: text, required?}`; `null` for what has no
 * form here (a file, anything else), which the screen keeps as it is. */
export function readPick(v: unknown): ResultPick | null {
  if (typeof v === "string") return { kind: "at", value: v, required: false };
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const kinds = PICK_KINDS.filter((k) => k in o);
  const rest = Object.keys(o).filter((k) => !PICK_KINDS.includes(k as PickKind) && k !== "required");
  if (kinds.length !== 1 || rest.length || typeof o[kinds[0]] !== "string" || (o.required !== undefined && typeof o.required !== "boolean")) return null;
  return { kind: kinds[0], value: o[kinds[0]] as string, required: o.required === true };
}

/** The value a pick comes to: a plain pointer stays a string. */
export const makePick = (p: ResultPick): unknown => (p.kind === "at" && !p.required ? p.value : { [p.kind]: p.value, ...(p.required ? { required: true } : {}) });

/** The inbound signature may leave the timestamp out only when the caller's delivery id is named. */
export const signatureNeedsDelivery = (d: Desc): boolean => at(d, "inbound", "verify", "type") === "signature" && !at(d, "inbound", "verify", "timestamp_header") && !at(d, "inbound", "delivery_header") && !at(d, "inbound", "delivery_at");

/** The body of `POST /api/admin/connections` and `PUT …/{id}`: the description exactly as held (an empty value can mean something, as a root pointer `""` does; the controls take a property away themselves when it is cleared), `secrets` only when given. */
export function connectionBody(f: { name: string; label: string; enabled: boolean; description: Desc }, secrets?: Record<string, string>) {
  return { name: f.name.trim(), label: f.label.trim(), enabled: f.enabled, description: f.description, ...(secrets ? { secrets } : {}) };
}

/** What can be said before sending: the name and label, in the server's terms. The description's own faults are the server's to say. */
export function checkConnection(f: { name: string; label: string }): string[] {
  const out: string[] = [];
  if (!NAME.test(f.name.trim())) out.push(t("Name: lower case letters, digits and _, starting with a letter"));
  if (!f.label.trim() || [...f.label.trim()].length > 100) out.push(t("Label: give it a label of at most 100 characters"));
  return out;
}

/** The inputs of "Try" as JSON (an object), or why not. */
export function parseInputs(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const r = parseDescription(text);
  return r.ok ? r : { ok: false, error: t("The inputs are one JSON object, {…}.") };
}

/** Whether an operation changes something at the service (it then needs a key to be tried): unless said, every method but GET. */
export const changes = (op: Desc): boolean => (typeof op.changes === "boolean" ? op.changes : (op.method ?? (op.body || (op.form && Object.keys(op.form).length) ? "POST" : "GET")) !== "GET");

/** The minutes of a capture: 0 to 60, a whole number. */
export const captureMinutes = (s: string): number | null => (/^\d{1,2}$/.test(s.trim()) && Number(s) <= 60 ? Number(s) : null);

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const AUTH_KINDS = ["none", "header", "basic", "bearer", "signed", "oauth", "session"] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

/** A new description for a new connection: nothing called, one operation to start from. */
export const newDescription = (): Desc => ({ base: "https://", auth: { type: "none" }, operations: {} });
