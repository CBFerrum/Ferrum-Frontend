// Board, calendar and timeline views: which fields can drive them, and the date maths behind them.
// Pure functions so they are tested without a browser.

import type { Field } from "./meta";

export type ViewKind = "list" | "board" | "calendar" | "timeline";

export interface ViewOptions {
  /** Select fields a board can group by. */
  board: Field[];
  /** Date fields a calendar can place records on. */
  calendar: Field[];
  /** Start/end pairs a timeline can draw as bars. */
  timeline: [Field, Field][];
}

const START = /(^|_)(start|from|begin)s?(_at|_date|_on|_time)?/;
const END = /(^|_)(end|to|until|upto|till|due)s?(_at|_date|_on|_time)?/;

/** Views an entity supports, from its readable fields; the usual choices come first. */
export function viewOptions(fields: Field[]): ViewOptions {
  const readable = fields.filter((f) => f.can_read && !f.hidden);
  const board = readable.filter((f) => f.type === "select" && (f.options?.length ?? 0) > 1);
  board.sort((a, b) => Number(b.name === "status") - Number(a.name === "status"));
  const calendar = readable.filter((f) => f.type === "date" || f.type === "datetime");
  const timeline: [Field, Field][] = [];
  for (const s of calendar.filter((f) => START.test(f.name))) {
    const stem = s.name.replace(START, "$1");
    const ends = calendar.filter((e) => e !== s && END.test(e.name));
    const end = ends.find((e) => e.name.replace(END, "$1") === stem) ?? ends[0];
    if (end) timeline.push([s, end]);
  }
  return { board, calendar, timeline };
}

/** `YYYY-MM-DD` of a date or datetime value, in the viewer's time zone for datetimes. */
export function dayOf(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAY = 86_400_000;
const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => new Date(utc(day) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);

/** The 42 days (six weeks) of a month grid, weeks starting on Monday. `month` is 0-based. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = addDays(first.toISOString().slice(0, 10), -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The Monday on or before `day`. */
export function weekStart(day: string): string {
  return addDays(day, -((new Date(utc(day)).getUTCDay() + 6) % 7));
}

/** API filters selecting records with `field` inside [from, to] (whole days). */
export function dayRangeFilters(field: Field, from: string, to: string): [string, string, string][] {
  if (field.type === "datetime") {
    const lo = new Date(`${from}T00:00:00`).toISOString();
    const hi = new Date(new Date(`${to}T00:00:00`).getTime() + DAY - 1).toISOString();
    return [
      [field.name, ">=", lo],
      [field.name, "<=", hi],
    ];
  }
  return [
    [field.name, ">=", from],
    [field.name, "<=", to],
  ];
}

export interface Bar {
  /** Percent offsets within the window. */
  left: number;
  width: number;
  /** The record starts before / ends after the window. */
  before: boolean;
  after: boolean;
}

/** Where a start..end record falls in a window of `days` days from `from`; null when outside. */
export function bar(start: string | null, end: string | null, from: string, days: number): Bar | null {
  if (!start && !end) return null;
  const s = start ?? end!;
  const e = end && end >= s ? end : s;
  const a = daysBetween(from, s);
  const b = daysBetween(from, e) + 1; // the end day is included
  if (b <= 0 || a >= days) return null;
  const lo = Math.max(a, 0);
  const hi = Math.min(b, days);
  return { left: (lo / days) * 100, width: ((hi - lo) / days) * 100, before: a < 0, after: b > days };
}
