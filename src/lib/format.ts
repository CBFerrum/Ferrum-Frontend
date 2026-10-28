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

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string | undefined, digits: number): Intl.NumberFormat {
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
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
}

export function formatDateTime(value: unknown, locale?: string): string {
  if (typeof value !== "string" || !value) return value == null ? "" : String(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function relativeTime(value: string, now = Date.now()): string {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return value;
  const s = Math.round((t - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
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

/** Today's date (UTC, like the server's `today`) as `YYYY-MM-DD`. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
