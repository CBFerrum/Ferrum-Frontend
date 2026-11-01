// List filters. UI state lives in the URL (`f.<field>=value`; ranges as `from..to`) so filtered
// lists can be bookmarked and shared; it is serialized to the API's `filters` JSON
// (`[["field", "op", value], ...]`). A value may also be a word the list works out when it asks:
// `@today`, `@last_30`, so a saved "due this week" still means this week next month, and `@empty`
// or `@set`, for any field. Numbers take `>=10`, `<=10`, `>10`, `<10` and `10..20`.

import { isDecimalString } from "./format";

export interface FilterField {
  name: string;
  type: string;
}
export type FilterState = Record<string, string>;
export type ApiFilter = [string, string, unknown];

const PREFIX = "f.";

export function readFilters(sp: URLSearchParams): FilterState {
  const out: FilterState = {};
  sp.forEach((v, k) => {
    if (k.startsWith(PREFIX) && v !== "") out[k.slice(PREFIX.length)] = v;
  });
  return out;
}

/** Returns a copy of `sp` with the filter keys replaced by `state` (other params are kept). */
export function writeFilters(sp: URLSearchParams, state: FilterState): URLSearchParams {
  const next = new URLSearchParams();
  sp.forEach((v, k) => {
    if (!k.startsWith(PREFIX)) next.append(k, v);
  });
  for (const [k, v] of Object.entries(state)) if (v !== "") next.set(PREFIX + k, v);
  return next;
}

/** What a list cannot ask about: rows, files, secrets and raw JSON. */
const UNFILTERABLE = new Set(["table", "attach", "secret", "json", "code"]);

/** The fields a person can filter on: any they can read, those the app puts forward first. The
 *  server holds the rule: a field closed to them is refused, however it is asked for. */
export function filterable<F extends FilterField & { label?: string; in_filter?: boolean; can_read?: boolean; hidden?: boolean }>(
  fields: F[],
  children: Record<string, { label: string; fields: F[] }> = {},
): F[] {
  const open = fields.filter((f) => f.can_read === true && !f.hidden && !UNFILTERABLE.has(f.type));
  // A row's link too: "orders with this item in them". It fills in nothing on a new record.
  const rows = Object.entries(children).flatMap(([table, c]) =>
    c.fields.filter((f) => f.type === "link" && f.can_read === true && !f.hidden).map((f) => ({ ...f, name: `${table}.${f.name}`, label: `${c.label}: ${f.label}`, can_write: false })),
  );
  return [...open.filter((f) => f.in_filter), ...open.filter((f) => !f.in_filter), ...rows];
}

/** Filter by whether the field holds anything, whatever its type. */
export const EMPTY = "@empty";
export const SET = "@set";

/** The named periods, in the order a person looks for them. */
export const PERIODS: [string, string][] = [
  ["@today", "Today"],
  ["@yesterday", "Yesterday"],
  ["@tomorrow", "Tomorrow"],
  ["@this_week", "This week"],
  ["@last_week", "Last week"],
  ["@next_7", "Next 7 days"],
  ["@last_7", "Last 7 days"],
  ["@last_30", "Last 30 days"],
  ["@next_30", "Next 30 days"],
  ["@this_month", "This month"],
  ["@last_month", "Last month"],
  ["@this_year", "This year"],
  ["@overdue", "Before today"],
];

/** A value that stands for something other than itself. */
export const isWord = (raw: string | undefined) => !!raw && (raw === EMPTY || raw === SET || PERIODS.some(([k]) => k === raw));

const dayText = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shifted = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/** The days a period covers, in the viewer's own calendar; weeks start on Monday. */
export function periodRange(word: string, now: Date): [string, string] | null {
  const day = (n: number) => dayText(shifted(now, n));
  const monday = -((now.getDay() + 6) % 7);
  const month = (n: number, last: number) => dayText(new Date(now.getFullYear(), now.getMonth() + n, last));
  switch (word) {
    case "@today":
      return [day(0), day(0)];
    case "@yesterday":
      return [day(-1), day(-1)];
    case "@tomorrow":
      return [day(1), day(1)];
    case "@this_week":
      return [day(monday), day(monday + 6)];
    case "@last_week":
      return [day(monday - 7), day(monday - 1)];
    case "@next_7":
      return [day(0), day(6)];
    case "@last_7":
      return [day(-6), day(0)];
    case "@next_30":
      return [day(0), day(29)];
    case "@last_30":
      return [day(-29), day(0)];
    case "@this_month":
      return [month(0, 1), month(1, 0)];
    case "@last_month":
      return [month(-1, 1), month(0, 0)];
    case "@this_year":
      return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
    case "@overdue":
      return ["", day(-1)];
    default:
      return null;
  }
}

/** What a number filter asks: its operator (`=`, `>=`, `<=`, `>`, `<`, `..`) and values. */
export function splitNumber(raw: string): { op: string; a: string; b: string } {
  const m = /^(>=|<=|>|<)(.*)$/.exec(raw);
  if (m) return { op: m[1], a: m[2], b: "" };
  if (raw.includes("..")) {
    const [a, b] = splitRange(raw);
    return { op: "..", a, b };
  }
  return { op: "=", a: raw, b: "" };
}

export function joinNumber(op: string, a: string, b: string): string {
  if (op === "..") return joinRange(a, b);
  return a === "" ? "" : op === "=" ? a : `${op}${a}`;
}

export function splitRange(raw: string | undefined): [string, string] {
  const [from = "", to = ""] = (raw ?? "").split("..");
  return [from, to];
}

export function joinRange(from: string, to: string): string {
  return from || to ? `${from}..${to}` : "";
}

/** Number filters, with `valid` the field type's own test and `as` its form on the wire. */
function numberFilters(name: string, raw: string, valid: (s: string) => boolean, as: (s: string) => unknown): ApiFilter[] {
  const { op, a, b } = splitNumber(raw);
  if (op === "..") return [...(valid(a) ? [[name, ">=", as(a)] as ApiFilter] : []), ...(valid(b) ? [[name, "<=", as(b)] as ApiFilter] : [])];
  return valid(a) ? [[name, op, as(a)]] : [];
}

export function toApiFilters(fields: FilterField[], state: FilterState, now = new Date()): ApiFilter[] {
  const out: ApiFilter[] = [];
  for (const f of fields) {
    const raw = state[f.name]?.trim();
    if (!raw) continue;
    if (raw === EMPTY || raw === SET) {
      out.push([f.name, "is", raw === SET ? "set" : "not set"]);
      continue;
    }
    switch (f.type) {
      case "check":
        if (raw === "1" || raw === "0") out.push([f.name, "=", raw === "1"]);
        break;
      case "date":
      case "datetime": {
        const [from, to] = periodRange(raw, now) ?? splitRange(raw);
        const dt = f.type === "datetime";
        // A day is the viewer's day: "today" at 01:00 in Kolkata began the evening before in UTC.
        if (from) out.push([f.name, ">=", dt ? new Date(`${from}T00:00:00`).toISOString() : from]);
        if (to) out.push([f.name, "<=", dt ? new Date(`${to}T23:59:59.999`).toISOString() : to]);
        break;
      }
      case "int":
        out.push(...numberFilters(f.name, raw, (s) => /^-?\d+$/.test(s), Number));
        break;
      case "decimal":
      case "currency":
      case "percent":
        out.push(...numberFilters(f.name, raw, isDecimalString, (s) => s));
        break;
      case "select":
      case "link":
        out.push([f.name, "=", raw]);
        break;
      default:
        out.push([f.name, "like", `%${raw}%`]);
    }
  }
  return out;
}

/** The `filters` query parameter, or `undefined` when nothing is filtered. */
export function serializeFilters(fields: FilterField[], state: FilterState, now = new Date()): string | undefined {
  const f = toApiFilters(fields, state, now);
  return f.length ? JSON.stringify(f) : undefined;
}
