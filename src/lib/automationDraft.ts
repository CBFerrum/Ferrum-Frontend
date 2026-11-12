// An automation as the editor edits it (Administration → Automations). `fromAutomation` and `toAutomation`
// convert between the server's JSON and a draft whose rows have stable keys, so that opening and saving
// changes nothing the person did not touch: an action or a schedule the editor cannot show (a new kind,
// an offset of mixed units) is kept as it is ("raw"), and the JSON view shows it. `checkAutomation` says in
// plain words what would not work before anything is sent; what the server also refuses (an expression it
// cannot read) is shown as it words it.

import { t as tr } from "@ferrum/client";
import { isDecimalString } from "./format";
import { currentLanguage } from "./i18n";
import type { Field } from "./meta";

/** An automation as the server lists it and takes it. */
export interface Automation {
  id?: string;
  name: string;
  entity: string;
  event: string;
  condition?: string | null;
  /** Present when `event` is "scheduled". */
  schedule?: unknown;
  actions: unknown;
  is_active: boolean;
  updated_at?: string;
}

export const EVENTS = ["created", "updated", "submitted", "cancelled", "deleted"] as const;
export const MAX_FILTERS = 8;
export const MAX_ACTIONS = 20;
export const MAX_LOOP_EFFECTS = 10;

export type Unit = "days" | "hours" | "minutes";
export interface Row { key: string; field: string; expr: string }
/** A condition on the records a calendar schedule picks; `value` is the JSON the list API takes. */
export interface FilterRow { key: string; field: string; op: string; value: unknown }

export type Trigger =
  | { kind: "event"; event: string }
  | { kind: "relative"; field: string; amount: string; unit: Unit; dir: "before" | "after"; at: string; repeat: string; until: string }
  | { kind: "every"; period: "day" | "week" | "month"; at: string; on: string; filters: FilterRow[] }
  /** What the editor has no form for: kept as it is. */
  | { kind: "raw"; event: string; schedule?: unknown };

export type NotifyTo = "owner" | "role" | "user" | "field";
/** One recipient spec of a message effect: `owner`, `user:<id>`, `role:<name>`, `field:<name>` or `expr:<expression>`. */
export interface MessageTo { key: string; kind: "owner" | "user" | "role" | "field" | "expr"; value: string }
export const MESSAGE_TO_KINDS = ["owner", "user", "role", "field", "expr"] as const;
export const MESSAGE_CHANNEL_NAMES = ["email", "text", "chat", "inapp"] as const;
const toSpec = (spec: string): MessageTo | null => {
  const m = /^(user|role|field|expr):([\s\S]*)$/.exec(spec);
  return spec === "owner" ? { key: newKey(), kind: "owner", value: "" } : m ? { key: newKey(), kind: m[1] as MessageTo["kind"], value: m[2] } : null;
};
export type DraftAction = (
  | { key: string; kind: "set_fields"; rows: Row[] }
  | { key: string; kind: "create_document"; entity: string; rows: Row[] }
  /** Writes the record that link field `link` of the triggering record names (a button's or an automation's). */
  | { key: string; kind: "update_linked"; link: string; rows: Row[] }
  /** One more line at the end of table field `table`. `extra`: properties the editor has no control for, kept. */
  | { key: string; kind: "append_line"; table: string; rows: Row[]; extra: Record<string, unknown> }
  /** Changes the one line of `table` for which `where` holds (`row` is the line). */
  | { key: string; kind: "set_line"; table: string; where: string; rows: Row[]; extra: Record<string, unknown> }
  /** `message`: a message template's key (BD-20) in place of the title. */
  | { key: string; kind: "notify"; to: NotifyTo; target: string; title: string; body: string; message?: string }
  /** `message`: a message template's key in place of the subject and body. */
  | { key: string; kind: "email"; to: string; subject: string; purpose?: string; formatted: boolean; body: string; template: string; message?: string }
  /** A message template sent to people on the channels it has (BD-20): `to` specs, `channels` in the order tried (none: the template's), `all` for every channel each can be reached on, `values` the template declares. */
  | { key: string; kind: "message"; template: string; to: MessageTo[]; channels: string[]; all: boolean; values: Row[]; extra: Record<string, unknown> }
  /** A step of another app through the capability catalog; `once` gives it its own `key` expression. `extra`: what the editor has no control for. */
  | { key: string; kind: "invoke"; capability: string; rows: Row[]; once: boolean; onceKey: string; extra: Record<string, unknown> }
  /** The one record of `entity` whose `by` fields hold those values; `create` (made when none) and `update` (changed when found) are null when absent. */
  | { key: string; kind: "find"; entity: string; by: Row[]; create: Row[] | null; update: Row[] | null; extra: Record<string, unknown> }
  /** Once per line of `table`, or per record of `entity` whose link field `link` names this one; the item is `item`. One level: `effects` hold no loop. */
  | { key: string; kind: "for_each"; over: "table" | "entity"; table: string; entity: string; link: string; where: string; effects: DraftAction[]; extra: Record<string, unknown> }
  /** The lines of `from_table` of the record `link` names (or the earlier effect `result` found) into `table`, each value an expression over `item`. `mode` "" is absent (append). */
  | { key: string; kind: "copy_lines"; table: string; source: "link" | "result"; link: string; result: string; from_table: string; rows: Row[]; mode: "" | "append" | "replace"; extra: Record<string, unknown> }
  | { key: string; kind: "raw"; json: unknown }
) & {
  /** "Only when": the effect runs when this holds (absent: always). */
  when?: string;
};

/** One entry of `GET /api/admin/capabilities`. */
export interface Capability {
  id: string;
  title: string;
  entity?: string | null;
  needs_key?: boolean;
  inputs: { name: string; type?: unknown; required: boolean; description?: string | null }[];
}

export interface Draft {
  id?: string;
  name: string;
  entity: string;
  active: boolean;
  condition: string;
  trigger: Trigger;
  actions: DraftAction[];
}

export interface Problem {
  message: string;
  /** Key of the action it is about. */
  action?: string;
}

/** What a refused save says, sorted by where to show it: by the 0-based index of the action, by the control a
 *  field names, or (`other`) nowhere in particular. */
export interface Refusal {
  actions: Map<number, string>;
  named: Partial<Record<"name" | "entity" | "schedule" | "condition", string>>;
  other: string[];
}
const NAMED = ["name", "entity", "schedule", "condition"] as const;
export function mapRefusal(fields: { field: string; message: string; row?: [string, number] }[]): Refusal {
  const out: Refusal = { actions: new Map(), named: {}, other: [] };
  const join = (a: string | undefined, b: string) => (a ? `${a} ${b}` : b);
  for (const f of fields) {
    const n = f.row?.[0] === "actions" && f.field === "actions" ? f.row[1] : -1;
    const named = NAMED.find((k) => k === f.field);
    if (n >= 0) out.actions.set(n, join(out.actions.get(n), f.message));
    else if (named) out.named[named] = join(out.named[named], f.message);
    else out.other.push(f.message);
  }
  return out;
}

let counter = 0;
export const newKey = () => `a${++counter}`;
export { move } from "./workflowDraft";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const onlyKeys = (o: Obj, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));
const isStr = (v: unknown): v is string => typeof v === "string";
const rest = (o: Obj, drop: string[]): Obj => Object.fromEntries(Object.entries(o).filter(([k]) => !drop.includes(k)));

// ── offsets ──

/** "-P3D" is 3 days before, "PT90M" 90 minutes after. Mixed units ("P1DT2H") have no form here: null. */
export function parseOffset(s: unknown): { amount: string; unit: Unit; dir: "before" | "after" } | null {
  const m = isStr(s) ? /^(-?)P(?:(\d+)D|T(\d+)H|T(\d+)M)$/.exec(s) : null;
  if (!m) return null;
  const unit: Unit = m[2] !== undefined ? "days" : m[3] !== undefined ? "hours" : "minutes";
  return { amount: m[2] ?? m[3] ?? (m[4] as string), unit, dir: m[1] ? "before" : "after" };
}

export const makeOffset = (amount: string, unit: Unit, dir: "before" | "after") =>
  `${dir === "before" ? "-" : ""}P${unit === "days" ? `${amount}D` : `T${amount}${unit === "hours" ? "H" : "M"}`}`;

// ── JSON → draft ──

export const REPEATS = ["P1D", "P1W", "P1M", "P1Y"];
export const FILTER_OPS = ["=", "!=", ">", ">=", "<", "<=", "like", "is"];

function fromSchedule(event: string, s: unknown): Trigger {
  const raw: Trigger = { kind: "raw", event, schedule: s };
  if (!isObj(s)) return raw;
  const keys = Object.keys(s);
  if (keys.length !== 1) return raw;
  if (keys[0] === "relative" && isObj(s.relative)) {
    const r = s.relative;
    const off = parseOffset(r.offset);
    const optional = (k: string) => r[k] === undefined || isStr(r[k]);
    if (!off || !isStr(r.field) || !onlyKeys(r, ["field", "offset", "at", "repeat", "until"]) || !optional("at") || !optional("until") || (r.repeat !== undefined && !REPEATS.includes(r.repeat as string))) return raw;
    return { kind: "relative", field: r.field, ...off, at: (r.at as string) ?? "", repeat: (r.repeat as string) ?? "", until: (r.until as string) ?? "" };
  }
  if (keys[0] === "every" && isObj(s.every)) {
    const e = s.every;
    if (!onlyKeys(e, ["period", "at", "on", "filter"]) || !["day", "week", "month"].includes(e.period as string) || !isStr(e.at)) return raw;
    if (e.on !== undefined && !(typeof e.on === "number" || e.on === "last")) return raw;
    const filters: FilterRow[] = [];
    if (e.filter !== undefined) {
      if (!Array.isArray(e.filter)) return raw;
      for (const f of e.filter) {
        if (!Array.isArray(f) || f.length !== 3 || !isStr(f[0]) || !isStr(f[1]) || !FILTER_OPS.includes(f[1])) return raw;
        filters.push({ key: newKey(), field: f[0], op: f[1], value: f[2] });
      }
    }
    return { kind: "every", period: e.period as "day" | "week" | "month", at: e.at, on: e.on === undefined ? "" : String(e.on), filters };
  }
  return raw;
}

const rowsOf = (v: unknown): Row[] | null =>
  isObj(v) && Object.values(v).every(isStr) ? Object.entries(v).map(([field, expr]) => ({ key: newKey(), field, expr: expr as string })) : null;

/** An action as JSON → draft. `when` is read off first, so that every kind takes it; one that is not text stays raw. */
export function fromAction(a: unknown): DraftAction {
  if (!isObj(a) || !("when" in a)) return fromKnown(a);
  const { when, ...rest } = a;
  const d = isStr(when) ? fromKnown(rest) : null;
  return d && d.kind !== "raw" ? { ...d, when: when as string } : { key: newKey(), kind: "raw", json: a };
}

function fromKnown(a: unknown): DraftAction {
  const raw: DraftAction = { key: newKey(), kind: "raw", json: a };
  if (!isObj(a)) return raw;
  switch (a.type) {
    case "set_fields": {
      const rows = onlyKeys(a, ["type", "values"]) ? rowsOf(a.values) : null;
      return rows ? { key: newKey(), kind: "set_fields", rows } : raw;
    }
    case "create_document": {
      const rows = onlyKeys(a, ["type", "entity", "values"]) && isStr(a.entity) ? rowsOf(a.values) : null;
      return rows ? { key: newKey(), kind: "create_document", entity: a.entity as string, rows } : raw;
    }
    case "update_linked": {
      const rows = onlyKeys(a, ["type", "link", "values"]) && isStr(a.link) ? rowsOf(a.values) : null;
      return rows ? { key: newKey(), kind: "update_linked", link: a.link as string, rows } : raw;
    }
    case "append_line":
    case "set_line": {
      const set = a.type === "set_line";
      const rows = isStr(a.table) && (!set || isStr(a.where)) ? rowsOf(a.values) : null;
      if (!rows) return raw;
      const extra = Object.fromEntries(Object.entries(a).filter(([k]) => !["type", "table", "where", "values"].includes(k)));
      return set ? { key: newKey(), kind: "set_line", table: a.table as string, where: a.where as string, rows, extra } : { key: newKey(), kind: "append_line", table: a.table as string, rows, extra };
    }
    case "notify": {
      const named = isStr(a.message) && a.title === undefined && a.body === undefined;
      if (!onlyKeys(a, ["type", "to", "title", "body", "message"]) || !isStr(a.to) || !(named || (isStr(a.title) && a.message === undefined)) || !(a.body === undefined || isStr(a.body))) return raw;
      const m = /^(role|user|field):(.*)$/.exec(a.to);
      if (a.to !== "owner" && !m) return raw;
      return { key: newKey(), kind: "notify", to: m ? (m[1] as NotifyTo) : "owner", target: m ? m[2] : "", title: (a.title as string) ?? "", body: (a.body as string) ?? "", ...(named ? { message: a.message as string } : {}) };
    }
    case "email": {
      const named = isStr(a.message) && a.subject === undefined && a.body === undefined && a.template === undefined;
      const ok = onlyKeys(a, ["type", "to", "subject", "body", "template", "purpose", "message"]) && isStr(a.to) && (named || (isStr(a.subject) && isStr(a.body) && a.message === undefined)) && (a.template === undefined || isStr(a.template)) && (a.purpose === undefined || a.purpose === "transactional" || a.purpose === "marketing");
      return ok
        ? { key: newKey(), kind: "email", to: a.to as string, subject: (a.subject as string) ?? "", purpose: a.purpose as string | undefined, formatted: a.template !== undefined, body: (a.body as string) ?? "", template: (a.template as string) ?? "", ...(named ? { message: a.message as string } : {}) }
        : raw;
    }
    case "message": {
      const specs = (isStr(a.to) ? [a.to] : Array.isArray(a.to) ? a.to : []).map((x) => (isStr(x) ? toSpec(x) : null));
      const values = a.values === undefined ? [] : rowsOf(a.values);
      const channels = a.channels === undefined ? [] : Array.isArray(a.channels) && a.channels.every((c) => isStr(c) && (MESSAGE_CHANNEL_NAMES as readonly string[]).includes(c)) ? (a.channels as string[]) : null;
      if (!isStr(a.template) || !specs.length || specs.some((x) => !x) || !values || !channels || !(a.all === undefined || typeof a.all === "boolean")) return raw;
      return { key: newKey(), kind: "message", template: a.template, to: specs as MessageTo[], channels, all: a.all === true, values, extra: rest(a, ["type", "template", "to", "channels", "all", "values"]) };
    }
    case "invoke": {
      const rows = a.input === undefined ? [] : rowsOf(a.input);
      if (!isStr(a.capability) || !rows || !(a.key === undefined || isStr(a.key))) return raw;
      const extra = Object.fromEntries(Object.entries(a).filter(([k]) => !["type", "capability", "input", "key"].includes(k)));
      return { key: newKey(), kind: "invoke", capability: a.capability, rows, once: a.key !== undefined, onceKey: (a.key as string) ?? "", extra };
    }
    case "find": {
      const rows = isStr(a.entity) ? rowsOf(a.by) : null;
      const create = a.create === undefined ? null : rowsOf(a.create);
      const update = a.update === undefined ? null : rowsOf(a.update);
      if (!rows || (a.create !== undefined && !create) || (a.update !== undefined && !update)) return raw;
      return { key: newKey(), kind: "find", entity: a.entity as string, by: rows, create, update, extra: rest(a, ["type", "entity", "by", "create", "update"]) };
    }
    case "for_each": {
      const over = isStr(a.table) ? "table" : isStr(a.entity) && isStr(a.link) ? "entity" : null;
      if (!over || !Array.isArray(a.effects) || !(a.where === undefined || isStr(a.where))) return raw;
      return {
        key: newKey(), kind: "for_each", over, table: isStr(a.table) ? a.table : "", entity: isStr(a.entity) ? a.entity : "", link: isStr(a.link) ? a.link : "", where: (a.where as string) ?? "",
        effects: a.effects.map(fromAction), extra: rest(a, ["type", "table", "entity", "link", "where", "effects"]),
      };
    }
    case "copy_lines": {
      const rows = isStr(a.table) && isStr(a.from_table) ? rowsOf(a.values) : null;
      const source = isStr(a.link) ? "link" : typeof a.result === "number" ? "result" : null;
      if (!rows || !source || (a.link !== undefined && a.result !== undefined) || !(a.mode === undefined || a.mode === "append" || a.mode === "replace")) return raw;
      return {
        key: newKey(), kind: "copy_lines", table: a.table as string, source, link: isStr(a.link) ? a.link : "", result: typeof a.result === "number" ? String(a.result) : "", from_table: a.from_table as string,
        rows, mode: (a.mode as "append" | "replace" | undefined) ?? "", extra: rest(a, ["type", "table", "link", "result", "from_table", "values", "mode"]),
      };
    }
    default:
      return raw;
  }
}

export function fromAutomation(a: Partial<Automation>): Draft {
  const event = a.event ?? "submitted";
  const trigger: Trigger =
    a.schedule !== undefined || event === "scheduled"
      ? event === "scheduled" && a.schedule !== undefined ? fromSchedule(event, a.schedule) : { kind: "raw", event, schedule: a.schedule }
      : (EVENTS as readonly string[]).includes(event) ? { kind: "event", event } : { kind: "raw", event };
  return {
    id: a.id,
    name: a.name ?? "",
    entity: a.entity ?? "",
    active: a.is_active ?? true,
    condition: a.condition ?? "",
    trigger,
    actions: Array.isArray(a.actions) ? a.actions.map(fromAction) : [],
  };
}

// ── draft → JSON ──

const specOf = (t: MessageTo) => (t.kind === "owner" ? "owner" : `${t.kind}:${t.value}`);
const values = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.field.trim(), r.expr]));

export function actionJson(a: DraftAction): unknown {
  const j = actionBody(a);
  return a.kind !== "raw" && a.when?.trim() ? { ...(j as Obj), when: a.when.trim() } : j;
}

function actionBody(a: DraftAction): unknown {
  switch (a.kind) {
    case "raw":
      return a.json;
    case "set_fields":
      return { type: "set_fields", values: values(a.rows) };
    case "create_document":
      return { type: "create_document", entity: a.entity, values: values(a.rows) };
    case "update_linked":
      return { type: "update_linked", link: a.link, values: values(a.rows) };
    case "append_line":
      return { ...a.extra, type: "append_line", table: a.table, values: values(a.rows) };
    case "set_line":
      return { ...a.extra, type: "set_line", table: a.table, where: a.where, values: values(a.rows) };
    case "notify":
      return { type: "notify", to: a.to === "owner" ? "owner" : `${a.to}:${a.target}`, ...(a.message ? { message: a.message } : { title: a.title, ...(a.body.trim() ? { body: a.body } : {}) }) };
    case "message":
      return { ...a.extra, type: "message", template: a.template, to: a.to.length === 1 ? specOf(a.to[0]) : a.to.map(specOf), ...(a.channels.length ? { channels: a.channels } : {}), ...(a.all ? { all: true } : {}), ...(a.values.length ? { values: values(a.values) } : {}) };
    case "find":
      return { ...a.extra, type: "find", entity: a.entity, by: values(a.by), ...(a.create ? { create: values(a.create) } : {}), ...(a.update ? { update: values(a.update) } : {}) };
    case "for_each":
      return { ...a.extra, type: "for_each", ...(a.over === "table" ? { table: a.table } : { entity: a.entity, link: a.link }), ...(a.where.trim() ? { where: a.where.trim() } : {}), effects: a.effects.map(actionJson) };
    case "copy_lines":
      return { ...a.extra, type: "copy_lines", table: a.table, ...(a.source === "link" ? { link: a.link } : { result: Number(a.result) }), from_table: a.from_table, values: values(a.rows), ...(a.mode ? { mode: a.mode } : {}) };
    case "invoke":
      return { ...a.extra, type: "invoke", capability: a.capability, ...(a.rows.length ? { input: values(a.rows) } : {}), ...(a.once ? { key: a.onceKey } : {}) };
    case "email":
      if (a.message) return { type: "email", to: a.to, message: a.message, ...(a.purpose ? { purpose: a.purpose } : {}) };
      // The server always wants a body; a formatted mail with none gets an empty text.
      return { type: "email", to: a.to, subject: a.subject, body: a.formatted && !a.body.trim() ? "''" : a.body, ...(a.formatted ? { template: a.template } : {}), ...(a.purpose ? { purpose: a.purpose } : {}) };
  }
}

function scheduleJson(t: Trigger): unknown {
  if (t.kind === "relative") {
    return { relative: { field: t.field, offset: makeOffset(t.amount, t.unit, t.dir), ...(t.at ? { at: t.at } : {}), ...(t.repeat ? { repeat: t.repeat } : {}), ...(t.repeat && t.until ? { until: t.until } : {}) } };
  }
  if (t.kind === "every") {
    const on = t.on === "" ? {} : { on: t.on === "last" ? "last" : Number(t.on) };
    return { every: { period: t.period, at: t.at, ...on, ...(t.filters.length ? { filter: t.filters.map((f) => [f.field, f.op, f.value]) } : {}) } };
  }
  return t.kind === "raw" ? t.schedule : undefined;
}

/** What `POST /api/admin/automations` takes. */
export function toAutomation(d: Draft): Automation {
  const t = d.trigger;
  const event = t.kind === "event" || t.kind === "raw" ? t.event : "scheduled";
  const schedule = scheduleJson(t);
  return {
    ...(d.id ? { id: d.id } : {}),
    name: d.name,
    entity: d.entity,
    event,
    condition: d.condition.trim() || null,
    ...(schedule !== undefined ? { schedule } : {}),
    actions: d.actions.map(actionJson),
    is_active: d.active,
  };
}

// ── filter rows ──

/** The operators that make sense for a field of this type. */
export function opsFor(type: string | undefined): string[] {
  switch (type) {
    case "check":
      return ["="];
    case "int": case "decimal": case "currency": case "percent": case "date": case "datetime":
      return ["=", "!=", ">", ">=", "<", "<=", "is"];
    case "select": case "link":
      return ["=", "!=", "is"];
    default:
      return ["=", "!=", "like", "is"];
  }
}

/** What a person typed as the JSON a list filter takes: a number for a whole-number field, true/false for a check. */
export function filterValue(type: string | undefined, op: string, text: string): unknown {
  if (op === "is") return text === "not set" ? "not set" : "set";
  if (op === "like") return text === "" ? "" : `%${text}%`;
  if (type === "check") return text === "true";
  if (type === "int" && /^-?\d+$/.test(text.trim())) return Number(text);
  return text;
}

/** The text a filter's value shows as. */
export function filterText(op: string, value: unknown): string {
  if (op === "like" && isStr(value)) return value.replace(/^%/, "").replace(/%$/, "");
  return value === undefined || value === null ? "" : String(value);
}

export const newFilter = (field = ""): FilterRow => ({ key: newKey(), field, op: "=", value: "" });

// ── checking ──

export interface CheckContext {
  submittable: boolean;
  fields: Pick<Field, "name" | "label" | "type">[];
  /** The capability catalog, once loaded: lets the check say whether a step exists and has what it needs. */
  capabilities?: Capability[];
}

const DATE_TYPES = ["date", "datetime"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What is wrong with a list of actions (an automation's, or what a button does), by the action it is about. */
export function checkActions(actions: DraftAction[], max: number, catalog?: Capability[]): Problem[] {
  const out: Problem[] = [];
  const say = (message: string, action?: string) => out.push({ message, action });
  if (!actions.length) say(tr("Add at least one action."));
  if (actions.length > max) say(tr("Use at most {n} actions.", { n: max }));
  actions.forEach((a, i) => {
    const at = (message: string) => say(tr("Action {n}: {message}", { n: i + 1, message }), a.key);
    if (a.kind === "set_fields" || a.kind === "create_document" || a.kind === "update_linked") {
      if (a.kind === "create_document" && !a.entity) at(tr("choose the kind of record to create."));
      if (a.kind === "update_linked" && !a.link) at(tr("choose the link field that names the record to change."));
      if (!a.rows.length) at(tr("add at least one field to fill in."));
      if (a.rows.some((r) => !r.field.trim() || !r.expr.trim())) at(tr("every row needs a field and a value."));
      const seen = new Set<string>();
      for (const r of a.rows) {
        const f = r.field.trim();
        if (f && seen.has(f)) at(tr("“{field}” appears twice.", { field: f }));
        seen.add(f);
      }
    } else if (a.kind === "append_line" || a.kind === "set_line") {
      if (!a.table) at(tr("choose the table field that holds the lines."));
      if (a.kind === "set_line" && !a.where.trim()) at(tr("say which line to change."));
      if (!a.rows.length) at(tr("add at least one line field to fill in."));
      if (a.rows.some((r) => !r.field.trim() || !r.expr.trim())) at(tr("every row needs a field and a value."));
    } else if (a.kind === "find") {
      const filled = (rows: Row[]) => rows.every((r) => r.field.trim() && r.expr.trim());
      if (!a.entity) at(tr("choose the kind of record to find."));
      if (!a.by.length) at(tr("say which fields to match, with a value each."));
      if (!filled(a.by) || (a.create && !filled(a.create)) || (a.update && !filled(a.update))) at(tr("every row needs a field and a value."));
    } else if (a.kind === "for_each") {
      if (a.over === "table" ? !a.table : !a.entity || !a.link) at(a.over === "table" ? tr("choose the table whose lines to go through.") : tr("choose the kind of record and the link field that names this one."));
      if (!a.effects.length) at(tr("add at least one effect to the loop."));
      if (a.effects.length > MAX_LOOP_EFFECTS) at(tr("use at most {n} effects in a loop.", { n: MAX_LOOP_EFFECTS }));
      if (a.effects.some((x) => x.kind === "for_each")) at(tr("a loop cannot hold another loop."));
      for (const p of checkActions(a.effects, MAX_LOOP_EFFECTS, catalog)) if (p.message !== tr("Add at least one action.")) say(tr("Action {n}, in the loop: {message}", { n: i + 1, message: p.message }), a.key);
    } else if (a.kind === "copy_lines") {
      if (!a.table) at(tr("choose the table to copy lines into."));
      if (a.source === "link" ? !a.link : !/^\d+$/.test(a.result)) at(tr("choose where the lines come from: a link field or an earlier Find."));
      else if (a.source === "result" && !(Number(a.result) < i && ["find", "create_document"].includes(actions[Number(a.result)]?.kind))) at(tr("the lines must come from an earlier Find or Create a record."));
      if (!a.from_table.trim()) at(tr("choose the table to copy lines from."));
      if (!a.rows.length) at(tr("add at least one line field to fill in."));
      if (a.rows.some((r) => !r.field.trim() || !r.expr.trim())) at(tr("every row needs a field and a value."));
    } else if (a.kind === "notify") {
      if (a.to !== "owner" && !a.target.trim()) at(a.to === "role" ? tr("choose the role to tell.") : a.to === "user" ? tr("choose the person to tell.") : tr("choose the field that holds the person to tell."));
      if (!a.message && !a.title.trim()) at(tr("write the notification's title."));
    } else if (a.kind === "invoke") {
      const cap = catalog?.find((c) => c.id === a.capability);
      if (!a.capability) at(tr("choose the step of another app to run."));
      else if (catalog && !cap) at(tr("“{id}” is not a step this workspace offers: is its app installed?", { id: a.capability }));
      else if (cap) {
        for (const i of cap.inputs) if (i.required && !a.rows.some((r) => r.field === i.name && r.expr.trim())) at(tr("give “{name}” a value.", { name: i.name }));
        for (const r of a.rows) if (!cap.inputs.some((i) => i.name === r.field)) at(tr("“{name}” is not something {id} takes.", { name: r.field, id: a.capability }));
      }
      if (a.once && !a.onceKey.trim()) at(tr("write the key that makes it happen once."));
    } else if (a.kind === "email") {
      if (!a.to.trim()) at(tr("say who the mail goes to."));
      if (!a.message && !a.subject.trim()) at(tr("write the subject."));
      if (!a.message && (a.formatted ? !a.template.trim() : !a.body.trim())) at(a.formatted ? tr("write the formatted message.") : tr("write the message."));
    } else if (a.kind === "message") {
      if (!a.template) at(tr("choose the message template to send."));
      if (!a.to.length) at(tr("say who the message goes to."));
      if (a.to.some((x) => x.kind !== "owner" && !x.value.trim())) at(tr("every recipient needs a role, a person, a field or an expression."));
      if (a.values.some((r) => !r.field.trim() || !r.expr.trim())) at(tr("every value needs a name and an expression."));
    }
  });
  return out;
}

/** What is wrong with a draft, in words a person who is not a developer follows. */
export function checkAutomation(d: Draft, c: CheckContext): Problem[] {
  const out: Problem[] = [];
  const say = (message: string, action?: string) => out.push({ message, action });
  const type = (name: string) => c.fields.find((f) => f.name === name)?.type;
  const label = (name: string) => c.fields.find((f) => f.name === name)?.label || name;
  if (!d.name.trim()) say(tr("Give the automation a name."));
  if (!d.entity) say(tr("Choose the kind of record it works on."));
  const t = d.trigger;
  if (t.kind === "event" && (t.event === "submitted" || t.event === "cancelled") && d.entity && !c.submittable) {
    say(tr("“{event}” only applies to records that can be submitted: choose another event.", { event: t.event }));
  }
  if (t.kind === "relative") {
    if (!t.field) say(tr("Choose the date field the schedule counts from."));
    else if (c.fields.length && !DATE_TYPES.includes(type(t.field) ?? "")) say(tr("“{field}” is not a date field of this record.", { field: label(t.field) }));
    if (!/^\d+$/.test(t.amount.trim())) say(tr("Enter how long before or after as a whole number, 0 or more."));
    if (t.at && !TIME.test(t.at)) say(tr("Enter the time of day as hours and minutes, like 09:00."));
    if (t.repeat && t.until && c.fields.length && !DATE_TYPES.includes(type(t.until) ?? "")) say(tr("“{field}” is not a date field of this record.", { field: label(t.until) }));
  }
  if (t.kind === "every") {
    if (!TIME.test(t.at)) say(tr("Choose the time of day the schedule runs."));
    const on = Number(t.on);
    if (t.on !== "" && t.period === "week" && !(Number.isInteger(on) && on >= 1 && on <= 7)) say(tr("Choose a weekday."));
    if (t.on !== "" && t.period === "month" && t.on !== "last" && !(Number.isInteger(on) && on >= 1 && on <= 28)) say(tr("Choose a day of the month from 1 to 28, or the last day."));
    if (t.filters.length > MAX_FILTERS) say(tr("Use at most {n} filter rows.", { n: MAX_FILTERS }));
    t.filters.forEach((f, i) => {
      const empty = f.value === "" || f.value === undefined || f.value === null || f.value === "%%";
      if (!f.field || (f.op !== "is" && empty)) say(tr("Finish filter row {n}, or remove it.", { n: i + 1 }));
      else if (["decimal", "currency", "percent"].includes(type(f.field) ?? "") && f.op !== "is" && f.op !== "like" && !isDecimalString(f.value)) say(tr("Filter row {n} needs a number.", { n: i + 1 }));
      else if (type(f.field) === "int" && f.op !== "is" && typeof f.value !== "number") say(tr("Filter row {n} needs a whole number.", { n: i + 1 }));
    });
  }
  out.push(...checkActions(d.actions, MAX_ACTIONS, c.capabilities));
  return out;
}

// ── reading a schedule back ──

const unitText = (n: number, unit: Unit) =>
  unit === "days" ? (n === 1 ? tr("{n} day", { n }) : tr("{n} days", { n })) : unit === "hours" ? (n === 1 ? tr("{n} hour", { n }) : tr("{n} hours", { n })) : n === 1 ? tr("{n} minute", { n }) : tr("{n} minutes", { n });

const condition = (field: string, op: string, value: unknown): string => {
  const v = filterText(op, value);
  switch (op) {
    case "=": return tr("{field} is {value}", { field, value: v });
    case "!=": return tr("{field} is not {value}", { field, value: v });
    case ">": return tr("{field} is more than {value}", { field, value: v });
    case ">=": return tr("{field} is at least {value}", { field, value: v });
    case "<": return tr("{field} is less than {value}", { field, value: v });
    case "<=": return tr("{field} is at most {value}", { field, value: v });
    case "like": return tr("{field} contains {value}", { field, value: v });
    default: return value === "not set" ? tr("{field} is empty", { field }) : tr("{field} is filled in", { field });
  }
};

/** The weekday's name in the page's language (1 = Monday). */
export const weekday = (n: number) => new Intl.DateTimeFormat(currentLanguage(), { weekday: "long" }).format(new Date(2024, 0, n));

/** One plain sentence that reads a schedule back, or null for a trigger that is not a schedule the editor shows. */
export function readBack(t: Trigger, c: CheckContext): string | null {
  const label = (name: string) => c.fields.find((f) => f.name === name)?.label || name;
  const zone = (s: string) => tr("{when}, in the workspace's time zone", { when: s });
  if (t.kind === "relative") {
    if (!t.field) return null;
    const n = Number(t.amount) || 0;
    const field = label(t.field);
    let s = n === 0 && /^\d+$/.test(t.amount) ? tr("On {field}", { field }) : (t.dir === "before" ? tr("{amount} before {field}", { amount: unitText(n, t.unit), field }) : tr("{amount} after {field}", { amount: unitText(n, t.unit), field }));
    const isDate = (c.fields.find((f) => f.name === t.field)?.type ?? "date") === "date";
    if (isDate) s = zone(tr("{when} at {time}", { when: s, time: t.at || "09:00" }));
    if (t.repeat) {
      const every = { P1D: tr("every day"), P1W: tr("every week"), P1M: tr("every month"), P1Y: tr("every year") }[t.repeat] ?? t.repeat;
      s = tr("{when}, then {repeat}", { when: s, repeat: every });
      if (t.until) s = tr("{when}, until {field}", { when: s, field: label(t.until) });
    }
    return s;
  }
  if (t.kind === "every") {
    const time = t.at || "…";
    const on = Number(t.on);
    let s =
      t.period === "day" ? tr("Every day at {time}", { time })
      : t.period === "week" ? tr("Every {day} at {time}", { day: weekday(t.on === "" ? 1 : on || 1), time })
      : t.on === "last" ? tr("On the last day of every month at {time}", { time })
      : tr("On day {day} of every month at {time}", { day: t.on === "" ? 1 : on || 1, time });
    s = zone(s);
    if (t.filters.length) s = tr("{when}, for records where {conditions}", { when: s, conditions: t.filters.map((f) => condition(label(f.field), f.op, f.value)).join("; ") });
    return s;
  }
  return null;
}
