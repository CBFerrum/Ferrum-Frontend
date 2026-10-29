// Chart shapes beyond the series of `toChart` (lib/studio.ts): slices for pie, donut,
// percentage and funnel charts, calendar cells for heatmaps, points for scatter charts, the
// single value of a number chart, compact axis ticks and a sentence describing a chart for
// screen readers. Values are numbers only to be drawn; totals of slices stay exact (sumDecimal).

import { formatDate, isDecimalString } from "@/lib/format";
import {
  chartColor,
  columnLabel,
  formatCell,
  isNumericColumn,
  sumDecimal,
  toChart,
  toNumber,
  type ChartModel,
  type ChartOptions,
  type ChartType,
  type ResultColumn,
  type ResultLike,
  type ResultRow,
} from "@/lib/studio";

export const CHART_TYPE_LABEL: Record<ChartType, string> = {
  bar: "Bar",
  stacked_bar: "Stacked bar",
  line: "Line",
  area: "Area",
  pie: "Pie",
  donut: "Donut",
  percentage: "Percentage",
  heatmap: "Heatmap",
  scatter: "Scatter",
  funnel: "Funnel",
  number: "Number",
};

/** The value columns a chart can plot: numbers that are measures (or, for built-in reports, any number column). */
export const valueColumns = (columns: ResultColumn[]) =>
  columns.filter((c) => (c.role ? c.role === "measure" || c.role === "pivot" || c.role === "previous" : true) && isNumericColumn(c));

/** Columns that can go on the x axis: dimensions (or, for built-in reports, columns that are not numbers). */
export const axisColumns = (columns: ResultColumn[]) => columns.filter((c) => (c.role ? c.role === "dimension" : !isNumericColumn(c)));

export interface Slice {
  key: string;
  label: string;
  value: number;
  /** The exact value, formatted. */
  text: string;
  /** Percent of the total (0-100). */
  share: number;
  color: string;
  /** The row it comes from (none for "Other"). */
  row?: ResultRow;
}

export interface SliceModel {
  slices: Slice[];
  /** The exact total, formatted. */
  total: string;
  column?: ResultColumn;
  /** Slices folded into "Other". */
  folded: number;
}

const dimsOf = (result: ResultLike, x: ResultColumn | undefined) => {
  const dims = result.columns.filter((c) => c.role === "dimension");
  return dims.length ? dims : x ? [x] : [];
};

/**
 * One measure across the categories of the dimensions. Pie and donut charts drop values that
 * are not positive, sort by size and fold the rest into "Other" after `max` slices; funnels keep
 * the query's order and every stage.
 */
export function toSlices(result: ResultLike, o: ChartOptions & { kind: "pie" | "funnel"; max?: number }): SliceModel {
  const model = toChart(result, { ...o, maxSeries: 1 });
  const y = model.series[0]?.column;
  if (!y) return { slices: [], total: "", folded: 0 };
  const dims = dimsOf(result, model.x);
  const label = (r: ResultRow) => dims.map((d) => formatCell(d, r[d.name], r, o)).join(" · ") || formatCell(y, r[y.name], r, o);
  let rows = result.rows.map((r) => ({ r, n: toNumber(r[y.name]) ?? 0 }));
  if (o.kind === "pie") rows = rows.filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const max = o.kind === "pie" ? Math.max(1, o.max ?? 8) : Infinity;
  const kept = rows.length > max ? rows.slice(0, max - 1) : rows;
  const rest = rows.slice(kept.length);
  const plotted = rows.reduce((s, x) => s + Math.max(x.n, 0), 0);
  const slices: Slice[] = kept.map(({ r, n }, i) => ({
    key: `p${i}`,
    label: label(r),
    value: n,
    text: formatCell(y, r[y.name], r, o),
    share: plotted > 0 ? (Math.max(n, 0) / plotted) * 100 : 0,
    color: chartColor(i, o.colors),
    row: r,
  }));
  if (rest.length) {
    const exact = sumDecimal(rest.map((x) => x.r[y.name]));
    const n = rest.reduce((s, x) => s + x.n, 0);
    slices.push({ key: "other", label: `Other (${rest.length})`, value: n, text: formatCell(y, y.type === "int" ? Number(exact) : exact, undefined, o), share: plotted > 0 ? (n / plotted) * 100 : 0, color: "var(--chart-8)" });
  }
  const total = sumDecimal(rows.map((x) => x.r[y.name]));
  return { slices, total: total === null ? "" : formatCell(y, y.type === "int" ? Number(total) : total, undefined, o), column: y, folded: rest.length };
}

/** A share as text: one decimal, `<0.1%` for slivers. */
export const formatShare = (share: number, locale?: string) =>
  share > 0 && share < 0.1 ? "<0.1%" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(share)}%`;

export interface HeatCell {
  date: string;
  value: number;
  text: string;
  /** 0 (nothing) to 4 (the largest values). */
  level: number;
  row?: ResultRow;
}

export interface HeatModel {
  /** Day buckets: columns of seven days (Monday first); other buckets: one row of periods. */
  calendar: boolean;
  weeks: (HeatCell | null)[][];
  cells: HeatCell[];
  column?: ResultColumn;
  dim?: ResultColumn;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY;
const isoOfDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** Cells of a heatmap over the first date dimension and the first measure. */
export function toHeat(result: ResultLike, o: ChartOptions = {}): HeatModel {
  const dim = result.columns.find((c) => c.role === "dimension" && c.type === "date") ?? result.columns.find((c) => c.type === "date");
  const column = (o.y?.length ? result.columns.find((c) => c.name === o.y![0]) : undefined) ?? valueColumns(result.columns)[0];
  if (!dim || !column) return { calendar: false, weeks: [], cells: [], column, dim };
  // Several rows on one date (a second dimension) add up, exactly for the text.
  const byDate = new Map<string, { value: number; raw: unknown[]; row: ResultRow }>();
  for (const r of result.rows) {
    const d = r[dim.name];
    if (typeof d !== "string" || !ISO.test(d)) continue;
    const prev = byDate.get(d) ?? { value: 0, raw: [], row: r };
    prev.value += toNumber(r[column.name]) ?? 0;
    prev.raw.push(r[column.name]);
    byDate.set(d, prev);
  }
  const max = Math.max(0, ...[...byDate.values()].map((v) => v.value));
  const level = (v: number) => (v <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((v / max) * 4)));
  const zero = column.type === "int" ? 0 : "0";
  const cell = (date: string): HeatCell => {
    const v = byDate.get(date);
    const exact = v ? (v.raw.length === 1 ? v.raw[0] : sumDecimal(v.raw)) : zero;
    return { date, value: v?.value ?? 0, text: formatCell(column, column.type === "int" && typeof exact === "string" ? Number(exact) : exact, v?.raw.length === 1 ? v.row : undefined, o), level: level(v?.value ?? 0), row: v?.row };
  };
  const dates = [...byDate.keys()].sort();
  const calendar = !dim.bucket || dim.bucket === "day";
  if (!calendar || !dates.length) {
    const cells = dates.map(cell);
    return { calendar: false, weeks: cells.length ? [cells] : [], cells, column, dim };
  }
  const first = dayNum(dates[0]);
  const last = dayNum(dates[dates.length - 1]);
  const monday = first - ((new Date(first * DAY).getUTCDay() + 6) % 7);
  const weeks: (HeatCell | null)[][] = [];
  const cells: HeatCell[] = [];
  for (let w = monday; w <= last; w += 7) {
    const col: (HeatCell | null)[] = [];
    for (let d = w; d < w + 7; d++) {
      if (d < first || d > last) col.push(null);
      else {
        const c = cell(isoOfDay(d));
        col.push(c);
        cells.push(c);
      }
    }
    weeks.push(col);
  }
  return { calendar: true, weeks, cells, column, dim };
}

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  xText: string;
  yText: string;
  row: ResultRow;
}

/** Points with the first two plotted measures as x and y; rows missing either are left out. */
export function toScatter(result: ResultLike, o: ChartOptions = {}): { points: ScatterPoint[]; x?: ResultColumn; y?: ResultColumn } {
  const named = (n: string) => result.columns.find((c) => c.name === n);
  const ys = o.y?.length ? o.y.map(named).filter((c): c is ResultColumn => !!c && isNumericColumn(c)) : valueColumns(result.columns);
  const [x, y] = ys;
  if (!x || !y) return { points: [], x, y };
  const dims = result.columns.filter((c) => c.role === "dimension" || (!c.role && !isNumericColumn(c)));
  const points: ScatterPoint[] = [];
  for (const r of result.rows) {
    const px = toNumber(r[x.name]);
    const py = toNumber(r[y.name]);
    if (px === null || py === null) continue;
    points.push({ x: px, y: py, label: dims.map((d) => formatCell(d, r[d.name], r, o)).join(" · "), xText: formatCell(x, r[x.name], r, o), yText: formatCell(y, r[y.name], r, o), row: r });
  }
  return { points, x, y };
}

/** A number chart's value: the measure's total, else its only row. */
export function toSingle(result: ResultLike, o: ChartOptions = {}): { column?: ResultColumn; text: string } {
  const column = (o.y?.length ? result.columns.find((c) => c.name === o.y![0]) : undefined) ?? valueColumns(result.columns)[0];
  if (!column) return { text: "" };
  const v = result.totals && column.name in result.totals ? result.totals[column.name] : result.rows[0]?.[column.name];
  return { column, text: formatCell(column, v, undefined, o) || "—" };
}

/** Axis ticks: `1.2K`, `3.4M` (whole numbers below 1000 as they are). */
export function compactTick(n: unknown, locale?: string): string {
  const v = typeof n === "number" ? n : isDecimalString(n) ? Number(n) : NaN;
  if (!Number.isFinite(v)) return String(n ?? "");
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: Math.abs(v) < 1000 ? 2 : 1 }).format(v);
}

/** A category label shortened for an axis (the tooltip shows it whole). */
export const shortLabel = (s: string, max = 14) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** One sentence for screen readers: what is plotted and the first few values. */
export function describeChart(type: ChartType, model: ChartModel, title: string, o: { locale?: string } = {}): string {
  const kind = CHART_TYPE_LABEL[type].toLowerCase();
  if (!model.rows.length || !model.series.length) return `${title}: ${kind} chart with no data.`;
  const what = model.series.map((s) => s.label).join(", ");
  const by = model.x ? ` by ${columnLabel(model.x, o)}` : "";
  const shown = model.rows.slice(0, 6).map((r) => `${r.label} ${model.series.map((s) => r.fmt[s.key] || "none").join(" / ")}`);
  const more = model.rows.length > shown.length ? `, and ${model.rows.length - shown.length} more` : "";
  return `${title}: ${kind} chart of ${what}${by}. ${shown.join("; ")}${more}.`;
}

/** A period's last day: the bucket start plus its length, minus a day. */
export function bucketEnd(start: string, bucket: string): string {
  if (!ISO.test(start)) return start;
  const [y, m, d] = start.split("-").map(Number);
  const months = { month: 1, quarter: 3, fiscal_quarter: 3, year: 12, fiscal_year: 12 }[bucket];
  if (months) return isoOfDay(Date.UTC(y, m - 1 + months, d) / DAY - 1);
  return isoOfDay(dayNum(start) + (bucket === "week" ? 6 : 0));
}

/** A period as text: `Oct 1 – Oct 29, 2026` (one date when both ends are the same). */
export function formatPeriod(from: string | null | undefined, to: string | null | undefined, locale?: string): string {
  if (from && to && from === to) return formatDate(from, locale);
  if (from && to && ISO.test(from) && ISO.test(to)) {
    const f = new Date(`${from}T00:00:00`);
    const t = new Date(`${to}T00:00:00`);
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).formatRange(f, t);
    } catch {
      return `${formatDate(from, locale)} – ${formatDate(to, locale)}`;
    }
  }
  if (from) return `From ${formatDate(from, locale)}`;
  if (to) return `Until ${formatDate(to, locale)}`;
  return "";
}
