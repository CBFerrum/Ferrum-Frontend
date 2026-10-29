// Drill-down: list filters selecting exactly what a widget (or one point of a chart) counts, and
// the list page's own URL parameters when they can say the same thing.

import { isDecimalString } from "@/lib/format";
import type { DrillDown, ResultColumn, SpecFilter } from "@/lib/studio";
import { bucketEnd } from "./charts";

/** A chart point: the dimension values it stands for. */
export interface DrillPoint {
  column: ResultColumn;
  value: unknown;
}

/** What to open: the widget's own filters, narrowed to a point when one was clicked. */
export interface DrillTarget extends DrillDown {
  title: string;
  points?: DrillPoint[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC instant of midnight starting `day` in `timeZone` (the browser's when unknown). */
export function zonedMidnight(day: string, timeZone?: string): string {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const offsetAt = (t: number) => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
      const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - t;
    } catch {
      return -new Date(t).getTimezoneOffset() * 60_000;
    }
  };
  // Twice: the offset at the first guess can differ across a daylight-saving change.
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first)).toISOString();
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Filters for a point's dimension values: `=` the value, `is not set` for an empty group, and a
 * bucket's days for a date period (local-day bounds on date-time fields, as the server drills).
 */
export function pointFilters(points: readonly DrillPoint[], typeOf: (path: string) => string | undefined, timeZone?: string): SpecFilter[] {
  const out: SpecFilter[] = [];
  for (const { column, value } of points) {
    const path = column.field ?? column.name;
    if (value === null || value === undefined || value === "") out.push([path, "is", "not set"]);
    else if (column.bucket && typeof value === "string" && ISO.test(value)) {
      const end = bucketEnd(value, column.bucket);
      if (typeOf(path) === "datetime") out.push([path, ">=", zonedMidnight(value, timeZone)], [path, "<", zonedMidnight(nextDay(end), timeZone)]);
      else out.push([path, "between", [value, end]]);
    } else out.push([path, "=", value]);
  }
  return out;
}

export interface ListField {
  name: string;
  type: string;
  in_filter?: boolean;
}

const EXACT_EQ = new Set(["select", "link", "int", "decimal", "currency", "percent", "check"]);

/**
 * The list page's `f.<field>` parameters for these filters, or null when it cannot show exactly
 * them (it filters only its filter fields, text by "contains", date-times by UTC days).
 */
export function listParams(filters: readonly SpecFilter[], fields: readonly ListField[]): URLSearchParams | null {
  const byName = new Map(fields.filter((f) => f.in_filter).map((f) => [f.name, f]));
  const ranges = new Map<string, [string, string]>();
  const sp = new URLSearchParams();
  for (const [path, op, value] of filters) {
    const f = byName.get(path);
    if (!f) return null;
    if (f.type === "date") {
      const r = ranges.get(path) ?? ["", ""];
      if (op === "between" && Array.isArray(value) && value.length === 2 && ISO.test(String(value[0])) && ISO.test(String(value[1]))) {
        r[0] = String(value[0]);
        r[1] = String(value[1]);
      } else if ((op === ">=" || op === "<=" || op === "=") && typeof value === "string" && ISO.test(value)) {
        if (op !== "<=") r[0] = value;
        if (op !== ">=") r[1] = value;
      } else return null;
      ranges.set(path, r);
      continue;
    }
    if (op !== "=" || !EXACT_EQ.has(f.type) || value === null || value === undefined || sp.has(`f.${path}`)) return null;
    if (f.type === "check") {
      if (typeof value !== "boolean") return null;
      sp.set(`f.${path}`, value ? "1" : "0");
    } else if (f.type === "int" ? Number.isInteger(value) || /^-?\d+$/.test(String(value)) : f.type === "select" || f.type === "link" ? typeof value === "string" : isDecimalString(String(value))) {
      sp.set(`f.${path}`, String(value));
    } else return null;
  }
  for (const [path, [from, to]] of ranges) sp.set(`f.${path}`, `${from}..${to}`);
  return sp;
}
