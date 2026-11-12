// A text-message or chat-app channel connection (BD-20) as the administration form edits it: where the request goes, how it
// is shaped, where the provider's id and error are in its answer, and the inbound part. The server's JSON is `description`;
// `fromChannel` and `toChannelInput` convert so that opening and saving changes nothing the person did not touch. A secret
// is write-only: it is never in what the server sends, so a draft holds only what is typed now.

import { t as tr } from "@ferrum/client";
import { newKey } from "./automationDraft";

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const pairs = (v: unknown): KV[] => (v && typeof v === "object" ? Object.entries(v as Raw).map(([name, value]) => ({ key: newKey(), name, value: str(value) })) : []);
const object = (rows: KV[]) => Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), r.value]));

export interface KV { key: string; name: string; value: string }

/** `GET /api/admin/messages/channels`. */
export interface ChannelRow {
  id: string;
  kind: "text" | "chat";
  name: string;
  description: Raw;
  enabled: boolean;
  has_secrets: boolean;
  refused: number;
  /** The path a provider calls with delivery reports and replies. */
  inbound: string;
}

export interface DraftInbound {
  auth: "hmac" | "token";
  header: string;
  secret: string;
  id_at: string;
  status_at: string;
  statuses: KV[];
  from_at: string;
  text_at: string;
  stop: string;
  start: string;
  extra: Raw;
}

export interface DraftChannel {
  id?: string;
  kind: "text" | "chat";
  name: string;
  enabled: boolean;
  /** A test channel delivers into the log only. */
  test: boolean;
  url: string;
  method: string;
  headers: KV[];
  shape: "form" | "json";
  form: KV[];
  body: string;
  from: string;
  id_at: string;
  error_at: string;
  /** Statuses meaning "later", comma separated; empty: the server's. */
  temporary: string;
  inbound: DraftInbound | null;
  /** Secrets typed now; sent only when there are some (they replace every one stored). */
  secrets: KV[];
  extra: Raw;
}

export const newChannel = (kind: "text" | "chat"): DraftChannel => ({
  kind, name: "", enabled: true, test: false, url: "", method: "POST", headers: [], shape: kind === "chat" ? "json" : "form", form: [], body: "", from: "", id_at: "", error_at: "", temporary: "", inbound: null, secrets: [], extra: {},
});

export const newInbound = (): DraftInbound => ({ auth: "token", header: "", secret: "", id_at: "", status_at: "", statuses: [], from_at: "", text_at: "", stop: "STOP", start: "START", extra: {} });

const KNOWN = ["test", "url", "method", "headers", "body", "form", "from", "id_at", "error_at", "temporary", "inbound"];
const INBOUND_KNOWN = ["auth", "header", "secret", "id_at", "status_at", "statuses", "from_at", "text_at", "stop", "start"];
const rest = (o: Raw, known: string[]): Raw => Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k)));
const words = (v: unknown) => (Array.isArray(v) ? v.map(String).join(", ") : "");
const list = (s: string) => s.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);

export function fromChannel(c: ChannelRow): DraftChannel {
  const d = c.description;
  const ib = d.inbound && typeof d.inbound === "object" ? (d.inbound as Raw) : null;
  return {
    id: c.id, kind: c.kind, name: c.name, enabled: c.enabled, test: d.test === true, url: str(d.url), method: str(d.method) || "POST", headers: pairs(d.headers),
    shape: str(d.body) ? "json" : pairs(d.form).length ? "form" : c.kind === "chat" ? "json" : "form", form: pairs(d.form), body: str(d.body), from: str(d.from), id_at: str(d.id_at), error_at: str(d.error_at),
    temporary: Array.isArray(d.temporary) ? d.temporary.join(", ") : "",
    inbound: ib ? {
      auth: ib.auth === "hmac" ? "hmac" : "token", header: str(ib.header), secret: str(ib.secret), id_at: str(ib.id_at), status_at: str(ib.status_at), statuses: pairs(ib.statuses),
      from_at: str(ib.from_at), text_at: str(ib.text_at), stop: words(ib.stop), start: words(ib.start), extra: rest(ib, INBOUND_KNOWN),
    } : null,
    secrets: [], extra: rest(d, KNOWN),
  };
}

/** What `POST` and `PUT /api/admin/messages/channels` take. */
export function toChannelInput(d: DraftChannel): Raw {
  const description: Raw = { ...d.extra };
  if (d.test) description.test = true;
  if (!d.test) {
    description.url = d.url.trim();
    if (d.method && d.method !== "POST") description.method = d.method;
    const headers = object(d.headers);
    if (Object.keys(headers).length) description.headers = headers;
    if (d.shape === "form") {
      const form = object(d.form);
      if (Object.keys(form).length) description.form = form;
    } else if (d.body.trim()) description.body = d.body;
  }
  if (d.from.trim()) description.from = d.from.trim();
  if (d.id_at.trim()) description.id_at = d.id_at.trim();
  if (d.error_at.trim()) description.error_at = d.error_at.trim();
  const later = list(d.temporary).map(Number);
  if (later.length) description.temporary = later;
  const i = d.inbound;
  if (i) {
    const inbound: Raw = { ...i.extra, auth: i.auth, secret: i.secret.trim() };
    if (i.header.trim()) inbound.header = i.header.trim();
    for (const k of ["id_at", "status_at", "from_at", "text_at"] as const) if (i[k].trim()) inbound[k] = i[k].trim();
    const statuses = object(i.statuses);
    if (Object.keys(statuses).length) inbound.statuses = statuses;
    if (list(i.stop).length) inbound.stop = list(i.stop);
    if (list(i.start).length) inbound.start = list(i.start);
    description.inbound = inbound;
  }
  const secrets = object(d.secrets);
  return { kind: d.kind, name: d.name.trim(), enabled: d.enabled, description, ...(Object.keys(secrets).length ? { secrets } : {}) };
}

export interface Problem { message: string }

/** What would be refused, said before anything is sent; what the server also refuses (a template that does not compile) it words itself. */
export function checkChannel(d: DraftChannel): Problem[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push(tr("Give the connection a name."));
  if (!d.test && !/^https:\/\//.test(d.url.trim())) out.push(tr("The address must start with https://."));
  for (const [label, v] of [[tr("Where the id is"), d.id_at], [tr("Where the error is"), d.error_at], [tr("Inbound: where the id is"), d.inbound?.id_at ?? ""], [tr("Inbound: where the status is"), d.inbound?.status_at ?? ""]] as const) {
    if (v.trim() && !v.trim().startsWith("/")) out.push(tr("{label} is a JSON pointer starting with /, like /message/id.", { label }));
  }
  if (list(d.temporary).some((x) => !/^[1-5]\d\d$/.test(x))) out.push(tr("The statuses meaning “later” are HTTP statuses, like 429, 503."));
  if (d.inbound) {
    if (!d.inbound.secret.trim()) out.push(tr("Inbound: name the secret that authenticates the provider."));
    if (d.inbound.auth === "hmac" && !d.inbound.header.trim()) out.push(tr("Inbound: an HMAC signature needs the header it arrives in."));
    if (d.inbound.statuses.some((s) => !["sent", "delivered", "failed"].includes(s.value))) out.push(tr("Inbound: each provider status becomes sent, delivered or failed."));
  }
  if (d.secrets.some((s) => !!s.name.trim() !== !!s.value)) out.push(tr("A secret needs both a name and a value."));
  return out.map((message) => ({ message }));
}
