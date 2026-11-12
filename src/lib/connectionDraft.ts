// A connection as the administration screen edits it (docs/api.md "Connections"; BD-29 to BD-33). The description is kept as
// the server's own JSON, so a property this screen has no control for survives an edit; the helpers here read and change one
// place in it, drop what is empty on the way out, and say what the server would refuse before anything is sent. Secrets are
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

/** The value without what is empty (text, lists, objects), so a saved description says only what was chosen. An operation
 * with nothing in it is still an operation; booleans and numbers are always meant. */
export function tidy<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => tidy(x)).filter((x) => !isEmpty(x)) as T;
  if (v && typeof v === "object") {
    const out: Desc = {};
    for (const [k, x] of Object.entries(v as Desc)) {
      const clean = k === "operations" && x && typeof x === "object" ? Object.fromEntries(Object.entries(x as Desc).map(([n, o]) => [n, tidy(o)])) : tidy(x);
      if (!isEmpty(clean)) out[k] = clean;
    }
    return out as T;
  }
  return v;
}

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
export const entries = (m: unknown): [string, string][] => Object.entries((m && typeof m === "object" ? m : {}) as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);

/** Every secret the description names: the ones calls, the signing and the sign-in use. */
export function secretNames(d: Desc): string[] {
  const names = [at(d, "auth", "secret"), at(d, "auth", "provider", "client_secret"), at(d, "inbound", "verify", "secret")].filter((n): n is string => typeof n === "string" && n !== "");
  return [...new Set(names)];
}

/** A secret's name: lower case letters, digits and `_`, starting with a letter (what the server takes). */
export const NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** What goes in `secrets`: nothing when none was typed (the ones set stay), else every name listed with its value: the server
 * replaces the whole set, so a name left out would be lost. `error` says which are missing. */
export function secretsToSend(names: string[], values: Record<string, string>): { send?: Record<string, string>; error?: string } {
  const typed = names.filter((n) => (values[n] ?? "") !== "");
  if (!typed.length) return {};
  const missing = names.filter((n) => !(values[n] ?? ""));
  if (missing.length) return { error: t("Saving secrets replaces them all. Enter a value for {names} too, or leave every secret empty to keep what is set.", { names: missing.join(", ") }) };
  return { send: Object.fromEntries(names.map((n) => [n, values[n]])) };
}

/** The body of `POST /api/admin/connections` and `PUT …/{id}`: the description tidied, `secrets` only when given. */
export function connectionBody(f: { name: string; label: string; enabled: boolean; description: Desc }, secrets?: Record<string, string>) {
  return { name: f.name.trim(), label: f.label.trim(), enabled: f.enabled, description: tidy(f.description), ...(secrets ? { secrets } : {}) };
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
export const AUTH_KINDS = ["none", "header", "basic", "bearer", "signed", "oauth"] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

/** A new description for a new connection: nothing called, one operation to start from. */
export const newDescription = (): Desc => ({ base: "https://", auth: { type: "none" }, operations: {} });
