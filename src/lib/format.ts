// Display formatting. Money and decimals arrive as strings and stay strings: we never do
// arithmetic on them, we only compare (exactly) and format (Intl.NumberFormat accepts decimal
// strings and rounds them exactly, without going through binary floating point).

const DECIMAL = /^[-+]?\d+(\.\d+)?$/;

export function isDecimalString(v: unknown): v is string {
  return typeof v === "string" && DECIMAL.test(v.trim());
}

/** Exact comparison of two decimal strings: -1, 0 or 1. */
export function compareDecimal(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  const za = !pa.int && !pa.frac;
  const zb = !pb.int && !pb.frac;
  if (za && zb) return 0;
  const negA = pa.neg && !za;
  const negB = pb.neg && !zb;
  if (negA !== negB) return negA ? -1 : 1;
  const c = compareAbs(pa, pb);
  return negA ? -c : c;
}

function parts(s: string) {
  const t = s.trim();
  const neg = t.startsWith("-");
  const [i = "", f = ""] = t.replace(/^[-+]/, "").split(".");
  return { neg, int: i.replace(/^0+/, ""), frac: f.replace(/0+$/, "") };
}

function compareAbs(a: { int: string; frac: string }, b: { int: string; frac: string }): number {
  if (a.int.length !== b.int.length) return a.int.length < b.int.length ? -1 : 1;
  if (a.int !== b.int) return a.int < b.int ? -1 : 1;
  const n = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(n, "0");
  const fb = b.frac.padEnd(n, "0");
  return fa === fb ? 0 : fa < fb ? -1 : 1;
}

/** The locale numbers and dates are written in when a caller names none: the one the person or the
 *  workspace chose (lib/i18n.ts applyLocale), else the browser's. */
let defaultLocale: string | undefined;

export function setFormatLocale(tag: string | undefined): void {
  defaultLocale = tag;
}

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(given: string | undefined, digits: number): Intl.NumberFormat {
  const locale = given ?? defaultLocale;
  const key = `${locale ?? ""}|${digits}`;
  let nf = formatters.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(key, nf);
  }
  return nf;
}

/**
 * Formats a decimal (string or integer) for display with digit grouping.
 * `precision` fixes the number of fraction digits (rounded half away from zero, exactly);
 * without it the value keeps its own fraction digits.
 */
export function formatDecimal(value: unknown, precision?: number | null, locale?: string): string {
  if (value === null || value === undefined || value === "") return "";
  const s = typeof value === "number" ? String(value) : String(value).trim();
  if (!DECIMAL.test(s)) return s;
  const own = (s.split(".")[1] ?? "").length;
  const digits = Math.min(precision ?? own, 20);
  return numberFormat(locale, digits).format(s as Intl.StringNumericLiteral);
}

export const NUMERIC_TYPES = new Set(["int", "decimal", "currency", "percent", "float", "number"]);

export interface FormatOptions {
  /** Fraction digits from the record's currency, when known. */
  currencyPrecision?: number;
  locale?: string;
}

/** Formats any field value for read-only display (lists, reports, audit). */
export function formatValue(
  field: { type: string; precision?: number | null; options?: string[] },
  value: unknown,
  opts: FormatOptions = {},
): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.type) {
    case "int":
      return formatDecimal(value, 0, opts.locale);
    case "currency":
      return formatDecimal(value, opts.currencyPrecision ?? field.precision ?? 2, opts.locale);
    case "decimal":
    case "float":
    case "number":
      return formatDecimal(value, field.precision, opts.locale);
    case "percent": {
      const s = formatDecimal(value, field.precision, opts.locale);
      return s ? `${s}%` : s;
    }
    case "check":
      return value === true ? "Yes" : value === false ? "No" : String(value);
    case "date":
      return formatDate(value, opts.locale);
    case "datetime":
      return formatDateTime(value, opts.locale);
    case "json":
    case "table":
      return typeof value === "string" ? value : JSON.stringify(value);
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** `YYYY-MM-DD` → localized date, without time-zone shifting. */
export function formatDate(value: unknown, locale?: string): string {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return value == null ? "" : String(value);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat(locale ?? defaultLocale, { dateStyle: "medium" }).format(d);
}

/** A moment in time, on the workspace's clock, its zone named when the browser's is another. */
export function formatDateTime(value: unknown, locale?: string): string {
  if (typeof value !== "string" || !value) return value == null ? "" : String(value);
  return formatMoment(value, { dateStyle: "medium", timeStyle: "short" }, locale);
}

/** A moment in a page's own shape (`{ day: "numeric", month: "short", hour: "numeric", minute:
 *  "2-digit" }`), on the workspace's clock, its zone named when the browser's is another and the
 *  shape shows a time of day. */
export function formatMoment(value: string | number | Date | null | undefined, shape: Intl.DateTimeFormatOptions, locale?: string): string {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const shown = new Intl.DateTimeFormat(locale ?? defaultLocale, { ...shape, timeZone: shownTimeZone() }).format(d);
  const timed = shape.timeStyle || shape.hour || shape.minute || shape.second;
  const zone = timed && !shape.timeZoneName ? zoneLabel(d) : "";
  return zone ? `${shown} ${zone}` : shown;
}

export function relativeTime(value: string, now = Date.now()): string {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return value;
  const s = Math.round((t - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(defaultLocale, { numeric: "auto" });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return formatDateTime(value);
}

/** `x_gst_number` → `Gst Number` (mirrors the server's label fallback). */
export function humanize(name: string): string {
  return name
    .replace(/^x_/, "")
    .split("_")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function shortId(id: unknown): string {
  return typeof id === "string" ? id.slice(-8) : "";
}

let timeZone: string | undefined; // the workspace's, once /api/auth/me is known; until then the browser's
let displayZone: string | undefined; // the person's own, when they chose one

/** Makes `todayIso` follow the workspace's time zone, as the server's `today` does, and the times
 * pages show and take too unless the person chose a zone of their own. */
export function setTimeZone(zone: string | undefined): void {
  timeZone = zone;
}

/** The zone the person chose to see times in (`display_timezone`); business days stay the
 * workspace's. */
export function setDisplayZone(zone: string | undefined): void {
  displayZone = zone;
}

const known = (zone: string | undefined): string | undefined => {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
};

/** The zone times are shown and entered in: the person's own, else the workspace's, or the
 * browser's (undefined) while neither is known or is a zone this browser does not know. A page
 * drawing times itself passes it as `timeZone`. */
export function shownTimeZone(): string | undefined {
  return known(displayZone) ?? known(timeZone);
}

/** The short name of the zone times are shown in at `d` ("UTC", "GMT+5:30"), when it is not the
 * browser's own; empty when it is. */
export function zoneLabel(d: Date = new Date()): string {
  const zone = shownTimeZone();
  if (!zone || zone === Intl.DateTimeFormat().resolvedOptions().timeZone) return "";
  return new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? zone;
}

/** The wall clock at instant `t` in the zone times are shown in. */
function wallClock(t: number): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: shownTimeZone(),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour"), mi: n("minute"), s: n("second") };
}

/** An instant (RFC 3339) as a `datetime-local` value (`YYYY-MM-DDTHH:mm`) on the clock of the
 * zone times are shown in. */
export function toZonedInput(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return "";
  const w = wallClock(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}

/** A `datetime-local` value read on the clock of the zone times are shown in, as an instant
 * (RFC 3339, UTC). */
export function fromZonedInput(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  const offset = (t: number) => {
    const w = wallClock(t);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
  };
  // The zone's offset at that wall time: guessed from the wall time itself, then taken again where
  // the guess lands, so a day that changes the clocks reads right.
  const guess = wall - offset(wall);
  return new Date(wall - offset(guess)).toISOString();
}

/** Today's date in the workspace's time zone as `YYYY-MM-DD`. */
export function todayIso(): string {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    // A zone this browser does not know: its own calendar day.
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
}

/** "AR" for "Ana Rao", "R" for "raj": a person's mark on an avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
