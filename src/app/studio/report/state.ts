// The report builder's state and the pure logic around it: one shape for the URL, the saved Report
// record and the screens (kind + spec + column settings + chart), checked on the way in because a
// shared link or an agent-written record can hold anything; column order and settings as the
// server applies them; filter operators per field type; CSV; undo history.

import {
  AGG_LABEL,
  BUCKET_LABEL,
  buildSpec,
  draftFromSpec,
  emptyDraft,
  filterList,
  isSafeColor,
  type Bucket,
  type ChartSettings,
  type ChartType,
  type ColumnFormat,
  type ColumnRole,
  type ColumnSetting,
  type CompareKind,
  type FieldCatalog,
  type FilterOp,
  type FormatRule,
  type FormatStyle,
  type Issue,
  type Measure,
  type ReportKind,
  type ResultColumn,
  type ResultRow,
  type Runtime,
  type Sort,
  type Spec,
  type SpecDraft,
  type SpecFilter,
} from "../../../lib/studio";

export type ViewMode = "table" | "chart";

/** What the builder edits. `draft.kind` is table, group_by or pivot: a chart is the grouped shape shown as a chart. */
export interface BuilderState {
  draft: SpecDraft;
  view: ViewMode;
  /** Null until the report is first shown as a chart. */
  chart: ChartSettings | null;
  columns: ColumnSetting[];
}

/** The saved part of a Report record (also what a shareable link carries, with the view). */
export interface ReportShape {
  kind: ReportKind;
  spec: Spec;
  columns: ColumnSetting[] | null;
  chart: ChartSettings | null;
}

// ───────────────────────────── checking untrusted input ─────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const pick = <T>(v: unknown, ok: readonly T[]): T | undefined => (ok.includes(v as T) ? (v as T) : undefined);
const int = (v: unknown, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : undefined);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
/** The objects of a list that `f` accepts. */
const each = <T>(v: unknown, f: (x: Obj) => T | undefined): T[] =>
  Array.isArray(v) ? v.flatMap((x) => (isObj(x) ? [f(x)] : [])).filter((x): x is T => x !== undefined) : [];
const labelled = <T extends object>(o: T, label: unknown): T => (nonEmpty(label) ? { ...o, label } : o);

export const BUCKETS = Object.keys(BUCKET_LABEL) as Bucket[];
export const AGGS = Object.keys(AGG_LABEL) as (keyof typeof AGG_LABEL)[];
export const CHART_TYPES: readonly ChartType[] = ["bar", "stacked_bar", "line", "area", "pie", "donut", "percentage", "funnel", "scatter", "heatmap", "number"];
const KINDS: readonly ReportKind[] = ["table", "group_by", "pivot", "chart"];
const COMPARES: readonly CompareKind[] = ["previous_period", "previous_year"];
const STYLES: readonly FormatStyle[] = ["number", "int", "currency", "percent", "bar"];
export const RULE_OPS: readonly FormatRule["op"][] = ["=", "!=", ">", ">=", "<", "<=", "between"];
/** The kernel's operator spellings (it also takes `==`, `eq`, `not_in`…), in canonical form. */
const OP_ALIASES: Record<string, FilterOp> = {
  "=": "=", "==": "=", eq: "=", "!=": "!=", "<>": "!=", ne: "!=", ">": ">", gt: ">", ">=": ">=", gte: ">=", "<": "<", lt: "<", "<=": "<=", lte: "<=",
  in: "in", "not in": "not in", not_in: "not in", like: "like", "not like": "not like", not_like: "not like", between: "between", is: "is",
};

/** Filters in list form with canonical operators; anything malformed is dropped. */
export function sanitizeFilters(v: unknown): SpecFilter[] {
  let list: unknown[];
  try {
    list = Array.isArray(v) ? v : isObj(v) ? filterList(v) : [];
  } catch {
    return [];
  }
  return list.flatMap((f): SpecFilter[] => {
    if (!Array.isArray(f) || !nonEmpty(f[0])) return [];
    if (f.length === 2) return [[f[0], "=", f[1]]];
    const op = typeof f[1] === "string" ? OP_ALIASES[f[1].trim().toLowerCase()] : undefined;
    return f.length === 3 && op ? [[f[0], op, f[2]]] : [];
  });
}

/** A spec as the server would read it, or null when it names no entity. Unknown keys and malformed parts are dropped. */
export function sanitizeSpec(v: unknown): Spec | null {
  if (!isObj(v) || !nonEmpty(v.entity)) return null;
  const s: Spec = { entity: v.entity };
  const filters = sanitizeFilters(v.filters);
  if (filters.length) s.filters = filters;
  if (nonEmpty(v.search)) s.search = v.search;
  const fields = each(v.fields, (f) => (typeof f.field === "string" ? labelled({ field: f.field }, f.label) : undefined));
  if (fields.length) s.fields = fields;
  const groups = each(v.group_by, (g) => {
    if (typeof g.field !== "string") return undefined;
    const bucket = pick(g.bucket, BUCKETS);
    return labelled({ field: g.field, ...(bucket ? { bucket } : {}) }, g.label);
  });
  if (groups.length) s.group_by = groups;
  const measures = each(v.measures, (m): Measure | undefined => {
    const fn = pick(m.fn, AGGS);
    if (!fn) return undefined;
    return labelled({ fn, ...(typeof m.field === "string" && m.field ? { field: m.field } : {}) }, m.label);
  });
  if (measures.length) s.measures = measures;
  if (isObj(v.pivot) && typeof v.pivot.field === "string") {
    const bucket = pick(v.pivot.bucket, BUCKETS);
    const max = int(v.pivot.max_columns, 1, 100);
    s.pivot = { field: v.pivot.field, ...(bucket ? { bucket } : {}), ...(max ? { max_columns: max } : {}) };
  }
  const sort = each(v.sort, (o): Sort | undefined => (nonEmpty(o.by) ? { by: o.by, dir: o.dir === "desc" ? "desc" : "asc" } : undefined));
  if (sort.length) s.sort = sort;
  const limit = int(v.limit, 1, 10_000);
  if (limit) s.limit = limit;
  const ends = (r: Obj) => ({ ...(nonEmpty(r.from) ? { from: r.from } : {}), ...(nonEmpty(r.to) ? { to: r.to } : {}) });
  const ts = v.time_series;
  const tsBucket = isObj(ts) ? pick(ts.bucket, BUCKETS) : undefined;
  if (isObj(ts) && typeof ts.field === "string" && tsBucket) s.time_series = { field: ts.field, bucket: tsBucket, ...ends(ts), ...(ts.fill_zero === true ? { fill_zero: true } : {}) };
  else if (isObj(v.date_range) && typeof v.date_range.field === "string") s.date_range = { field: v.date_range.field, ...ends(v.date_range) };
  const compare = pick(v.compare, COMPARES);
  if (compare) s.compare = compare;
  const formulas = each(v.formulas, (f) => (typeof f.label === "string" && typeof f.expr === "string" ? { label: f.label, expr: f.expr } : undefined)).slice(0, 10);
  if (formulas.length) s.formulas = formulas;
  if (v.subtotals === true) s.subtotals = true;
  return s;
}

function sanitizeFormat(v: unknown): ColumnFormat | undefined {
  if (!isObj(v)) return undefined;
  const f: ColumnFormat = {};
  const style = pick(v.style, STYLES);
  if (style) f.style = style;
  const precision = int(v.precision, 0, 9);
  if (precision !== undefined) f.precision = precision;
  if (nonEmpty(v.prefix)) f.prefix = v.prefix;
  if (nonEmpty(v.suffix)) f.suffix = v.suffix;
  const rules = each(v.rules, (r): FormatRule | undefined => {
    const op = pick(r.op, RULE_OPS);
    return op && isSafeColor(r.color) ? { op, value: r.value, color: r.color } : undefined;
  });
  if (rules.length) f.rules = rules;
  return Object.keys(f).length ? f : undefined;
}

export function sanitizeColumns(v: unknown): ColumnSetting[] {
  const seen = new Set<string>();
  return each(v, (c): ColumnSetting | undefined => {
    if (!nonEmpty(c.name) || seen.has(c.name)) return undefined;
    seen.add(c.name);
    const out: ColumnSetting = { name: c.name };
    if (nonEmpty(c.label)) out.label = c.label;
    const width = int(c.width, 40, 2000);
    if (width) out.width = width;
    if (c.hidden === true) out.hidden = true;
    const format = sanitizeFormat(c.format);
    if (format) out.format = format;
    return out;
  });
}

export function sanitizeChart(v: unknown): ChartSettings | null {
  if (!isObj(v)) return null;
  const type = pick(v.type, CHART_TYPES);
  if (!type) return null;
  const c: ChartSettings = { type };
  if (nonEmpty(v.x)) c.x = v.x;
  const y = Array.isArray(v.y) ? v.y.filter(nonEmpty) : [];
  if (y.length) c.y = y;
  const colors = Array.isArray(v.colors) ? v.colors.filter(isSafeColor).slice(0, 20) : [];
  if (colors.length) c.colors = colors;
  if (v.stacked === true) c.stacked = true;
  if (typeof v.show_legend === "boolean") c.show_legend = v.show_legend;
  if (v.show_values === true) c.show_values = true;
  const height = int(v.height, 120, 2000);
  if (height) c.height = height;
  return c;
}

// ───────────────────────────── record ⇄ state ─────────────────────────────

/** Builder state from a saved record or a link (`view` optional); null when it has no usable spec. */
export function stateFromRecord(r: unknown): BuilderState | null {
  if (!isObj(r)) return null;
  const spec = sanitizeSpec(r.spec);
  if (!spec) return null;
  const kind = pick(r.kind, KINDS);
  const shape = kind === "chart" ? (spec.pivot ? "pivot" : "group_by") : kind;
  const draft = draftFromSpec(spec, shape);
  const view: ViewMode = draft.kind === "table" ? "table" : r.view === "chart" || r.view === "table" ? r.view : kind === "chart" ? "chart" : "table";
  return { draft, view, chart: sanitizeChart(r.chart), columns: sanitizeColumns(r.columns) };
}

export const measureName = (m: Pick<Measure, "fn" | "field">) => (m.fn === "count" && !m.field ? "count" : `${m.fn}(${m.field ?? ""})`);
const dimName = (field: string, bucket?: Bucket) => (bucket ? `${bucket}(${field})` : field);
export const isGroupedSpec = (s: Spec) => !!(s.group_by?.length || s.measures?.length || s.pivot || s.time_series);

/** The columns a spec produces, named as the server names them (pivot cells, which depend on the data, excluded). */
export function specColumns(s: Spec): { name: string; role: ColumnRole }[] {
  if (!isGroupedSpec(s)) return (s.fields ?? []).map((f) => ({ name: f.field, role: "field" }));
  const out: { name: string; role: ColumnRole }[] = [];
  if (s.time_series) out.push({ name: dimName(s.time_series.field, s.time_series.bucket), role: "dimension" });
  for (const g of s.group_by ?? []) out.push({ name: dimName(g.field, g.bucket), role: "dimension" });
  for (const m of s.measures ?? []) out.push({ name: measureName(m), role: "measure" });
  if (s.compare && !s.pivot) for (const m of s.measures ?? []) out.push({ name: `previous(${measureName(m)})`, role: "previous" });
  if (!s.pivot) (s.formulas ?? []).forEach((_, i) => out.push({ name: `calc${i + 1}`, role: "formula" }));
  return out;
}

/** What the state saves: settings of columns the spec no longer has and chart axes it no longer has are dropped (the server refuses them). */
export function recordFromState(s: BuilderState): ReportShape {
  const spec = buildSpec(s.draft);
  const grouped = s.draft.kind !== "table";
  const cols = specColumns(spec);
  const names = cols.map((c) => c.name);
  let columns = s.columns.filter((c) => names.includes(c.name));
  // Record columns follow the field order (the builder's list is the one order).
  if (!grouped) columns = [...columns].sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
  let chart: ChartSettings | null = null;
  if (grouped && s.chart) {
    const dims = new Set(cols.filter((c) => c.role === "dimension").map((c) => c.name));
    const values = new Set(cols.filter((c) => c.role !== "dimension").map((c) => c.name));
    const { x, y, ...rest } = s.chart;
    const keptY = (y ?? []).filter((n) => values.has(n));
    chart = { ...rest, ...(x && dims.has(x) ? { x } : {}), ...(keptY.length ? { y: keptY } : {}) };
  }
  return { kind: grouped && s.view === "chart" ? "chart" : s.draft.kind, spec, columns: columns.length ? columns : null, chart };
}

/** A stable text form of what would be saved: two states save the same record when their keys are equal. */
export const stateKey = (s: BuilderState) => JSON.stringify(recordFromState(s));

export const emptyState = (entity = ""): BuilderState => ({ draft: emptyDraft(entity, "table"), view: "table", chart: null, columns: [] });

/**
 * A fresh report on `entity` in the current shape: records start with the entity's list columns,
 * summaries with a count by its first select field (usually the status).
 */
export function startState(prev: BuilderState, entity: string, listColumns: string[] | undefined, catalog: FieldCatalog | undefined): BuilderState {
  const kind = prev.draft.kind;
  const draft = emptyDraft(entity, kind);
  const known = catalog && new Set(catalog.fields.map((f) => f.path));
  draft.fields = (listColumns ?? []).filter((c) => !known || known.has(c)).map((field) => ({ field }));
  const select = catalog?.fields.find((f) => f.type === "select" && f.groupable && !f.path.includes("."));
  if (kind !== "table" && select) draft.group_by = [{ field: select.path }];
  if (kind === "pivot") draft.pivot = { field: "" };
  return { draft, view: kind === "table" ? "table" : prev.view, chart: null, columns: [] };
}

/** The chart a result first shows as: a line over time, a bar per category, a number without dimensions. */
export function defaultChart(cols: ResultColumn[]): ChartSettings {
  const x = cols.find((c) => c.role === "dimension");
  if (!x) return { type: "number" };
  return { type: x.bucket || x.type === "date" ? "line" : "bar" };
}

// ───────────────────────────── links ─────────────────────────────

function toBase64Url(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A URL parameter value: JSON, base64url-encoded (compact and unreadable by accident only). */
// ponytail: uncompressed; deflate it (CompressionStream) if links outgrow ~8 KB, nginx's default request-line limit.
export const encodeParam = (v: unknown) => toBase64Url(JSON.stringify(v));

/** Reads `encodeParam` output, or plain JSON (hand-written and agent-written links). */
export function decodeParam(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw.trimStart().startsWith("{") ? raw : fromBase64Url(raw.trim()));
  } catch {
    return undefined;
  }
}

export const encodeState = (s: BuilderState) => encodeParam({ ...recordFromState(s), view: s.view });
export const decodeState = (raw: string | null | undefined) => stateFromRecord(decodeParam(raw));

/** Runtime settings of a saved report's run view, and how it is shown. */
export type RunState = Omit<Runtime, "filters"> & { filters?: SpecFilter[]; view?: ViewMode };

export function sanitizeRuntime(v: unknown): RunState {
  if (!isObj(v)) return {};
  const out: RunState = {};
  const filters = sanitizeFilters(v.filters);
  if (filters.length) out.filters = filters;
  if (nonEmpty(v.search)) out.search = v.search;
  const sort = each(v.sort, (o): Sort | undefined => (nonEmpty(o.by) ? { by: o.by, dir: o.dir === "desc" ? "desc" : "asc" } : undefined));
  if (sort.length) out.sort = sort;
  const limit = int(v.limit, 1, 10_000);
  if (limit) out.limit = limit;
  if (nonEmpty(v.from)) out.from = v.from;
  if (nonEmpty(v.to)) out.to = v.to;
  if (v.view === "chart" || v.view === "table") out.view = v.view;
  return out;
}

// ───────────────────────────── columns on screen ─────────────────────────────

/**
 * Result columns with the saved settings applied, as the server arranges them: listed ones first
 * in their order (label, width, format), unlisted ones after; hidden ones apart. A pivot reads
 * dimensions, then its cells, then its totals, and its cells take their measure's format and width.
 */
export function displayColumns(cols: ResultColumn[], settings: ColumnSetting[]): { shown: ResultColumn[]; hidden: ResultColumn[] } {
  const byName = new Map(cols.map((c) => [c.name, c]));
  const listed = new Set(settings.map((s) => s.name));
  const shown: ResultColumn[] = [];
  const hidden: ResultColumn[] = [];
  for (const s of settings) {
    const c = byName.get(s.name);
    if (!c) continue;
    const applied = { ...c, ...(nonEmpty(s.label) ? { label: s.label } : {}), ...(s.width ? { width: s.width } : {}), ...(s.format ? { format: s.format } : {}) };
    (s.hidden ? hidden : shown).push(applied);
  }
  for (const c of cols) if (!listed.has(c.name)) shown.push(c);
  if (!cols.some((c) => c.role === "pivot")) return { shown, hidden };
  const totals = new Map([...shown, ...hidden].filter((c) => c.role === "measure").map((c) => [c.name, c]));
  const rank = (c: ResultColumn) => (c.role === "dimension" ? 0 : c.role === "pivot" ? 1 : 2);
  const cells = shown.map((c) => {
    const t = c.role === "pivot" ? totals.get(c.measure ?? "") : undefined;
    return t ? { ...c, format: c.format ?? t.format, width: c.width ?? t.width } : c;
  });
  return { shown: cells.sort((a, b) => rank(a) - rank(b)), hidden };
}

function cleanSetting(s: ColumnSetting): ColumnSetting {
  const out: ColumnSetting = { name: s.name };
  if (nonEmpty(s.label)) out.label = s.label;
  if (s.width) out.width = Math.round(Math.min(Math.max(s.width, 40), 2000));
  if (s.hidden) out.hidden = true;
  const format = sanitizeFormat(s.format);
  if (format) out.format = format;
  return out;
}

/**
 * Settings with `patch` applied to one column. Every shown column is listed in its current order
 * (the server puts listed columns first, so listing one alone would move it); pivot cells are
 * never listed (the server cannot name them).
 */
export function patchColumn(settings: ColumnSetting[], shown: ResultColumn[], name: string, patch: Partial<ColumnSetting>): ColumnSetting[] {
  const byName = new Map(settings.map((s) => [s.name, s]));
  const order = shown.filter((c) => c.role !== "pivot").map((c) => c.name);
  const rest = settings.filter((s) => !order.includes(s.name));
  if (!order.includes(name) && !byName.has(name)) rest.push({ name });
  return [...order.map((n) => byName.get(n) ?? { name: n }), ...rest].map((s) => (s.name === name ? cleanSetting({ ...s, ...patch }) : s));
}

/** A record report showing the list's usual columns (none chosen) takes them as its fields, so one can be changed. */
export function withFields(s: BuilderState, shown: ResultColumn[]): BuilderState {
  if (s.draft.kind !== "table" || s.draft.fields.length) return s;
  const fields = shown.filter((c) => c.role === "field").map((c) => ({ field: c.name }));
  return fields.length ? { ...s, draft: { ...s.draft, fields } } : s;
}

/** Moves column `from` to where `to` is: record reports reorder their fields, grouped ones their column settings. */
export function moveColumn(s: BuilderState, shown: ResultColumn[], from: string, to: string): BuilderState {
  if (from === to) return s;
  if (s.draft.kind === "table") {
    s = withFields(s, shown);
    const fields = s.draft.fields;
    const [i, j] = [fields.findIndex((f) => f.field === from), fields.findIndex((f) => f.field === to)];
    return i < 0 || j < 0 ? s : { ...s, draft: { ...s.draft, fields: move(fields, i, j) } };
  }
  const names = shown.filter((c) => c.role !== "pivot").map((c) => c.name);
  const [i, j] = [names.indexOf(from), names.indexOf(to)];
  if (i < 0 || j < 0) return s;
  const order = move(names, i, j);
  const byName = new Map(s.columns.map((c) => [c.name, c]));
  const rest = s.columns.filter((c) => !order.includes(c.name));
  return { ...s, columns: [...order.map((n) => byName.get(n) ?? { name: n }), ...rest] };
}

/** The list with item `from` moved to index `to`. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ───────────────────────────── filters ─────────────────────────────

export const NUMBER_TYPES = new Set(["int", "decimal", "currency", "percent", "float", "number"]);

/** Operators offered for a field type, the usual one first. */
export function opsFor(type: string): FilterOp[] {
  if (type === "check") return ["=", "is"];
  if (type === "date") return [">=", "<=", "between", "=", "!=", ">", "<", "is"];
  if (type === "datetime") return [">=", "<=", "between", ">", "<", "is"];
  if (NUMBER_TYPES.has(type)) return ["=", "!=", ">", ">=", "<", "<=", "between", "in", "not in", "is"];
  if (type === "select" || type === "link") return ["=", "!=", "in", "not in", "is"];
  return ["like", "not like", "=", "!=", "in", "not in", "is"];
}

const DATE_OPS: Partial<Record<FilterOp, string>> = { ">": "after", ">=": "on or after", "<": "before", "<=": "on or before", "=": "on", "!=": "not on" };
const OPS: Record<FilterOp, string> = {
  "=": "is", "!=": "is not", ">": "greater than", ">=": "at least", "<": "less than", "<=": "at most",
  in: "is any of", "not in": "is none of", like: "contains", "not like": "does not contain", between: "between", is: "is",
};

export const opLabel = (op: FilterOp, type: string) => ((type === "date" || type === "datetime") && DATE_OPS[op]) || OPS[op];

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** The value kept when a filter's operator changes: lists for `in`, pairs for `between`, `set` for `is`. */
export function valueForOp(op: FilterOp, value: unknown, type: string): unknown {
  if (op === "is") return value === "not set" ? "not set" : "set";
  const scalar = value === "set" || value === "not set" ? "" : first(value);
  if (op === "in" || op === "not in") return Array.isArray(value) ? value.filter((x) => x !== "" && x != null) : scalar === "" || scalar == null ? [] : [scalar];
  if (op === "between") return Array.isArray(value) && value.length === 2 ? value : [scalar ?? "", ""];
  if (type === "check") return typeof scalar === "boolean" ? scalar : true;
  return scalar ?? "";
}

const blank = (v: unknown) => v === "" || v === null || v === undefined;

/** Filters whose value is still missing (the preview waits for them). */
export function filterIssues(filters: SpecFilter[], at = "filters"): Issue[] {
  return filters.flatMap(([path, op, value], i): Issue[] => {
    if (!path || op === "is") return [];
    const missing = op === "in" || op === "not in" ? !Array.isArray(value) || !value.length : op === "between" ? !Array.isArray(value) || value.length !== 2 || value.some(blank) : blank(value);
    return missing ? [{ path: `${at}[${i}]`, message: op === "in" || op === "not in" ? "Add at least one value" : "Enter a value" }] : [];
  });
}

/** A date input's day for a datetime filter: the start of the day, or its end for `<=` and `>` (so the whole day counts). */
export function dayValue(day: string, type: string, end: boolean): string {
  if (type !== "datetime" || !day) return day;
  return `${day}T${end ? "23:59:59.999" : "00:00:00.000"}Z`;
}

// ───────────────────────────── CSV ─────────────────────────────

/** CSV as the server exports it: labels, link titles, exact values, a totals line, guarded against spreadsheet formulas. */
export function toCsv(columns: ResultColumn[], rows: ResultRow[], totals?: Record<string, unknown> | null): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (!/^[-+]?\d+(\.\d+)?$/.test(s.trim()) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.label || c.name)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(r._titles?.[c.name] ?? r[c.name])).join(","));
  if (totals && columns.some((c) => c.name in totals)) lines.push(columns.map((c, i) => (c.name in totals ? cell(totals[c.name]) : i === 0 ? "Total" : "")).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ───────────────────────────── undo history ─────────────────────────────

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** The last change's coalescing key and time: typing into one field is one step. */
  key?: string;
  at?: number;
}

export type HistoryAction<T> =
  | { type: "set"; recipe: (s: T) => T; key?: string; at: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; present: T };

const STEPS = 100;

export function historyReducer<T>(h: History<T>, a: HistoryAction<T>): History<T> {
  switch (a.type) {
    case "set": {
      const next = a.recipe(h.present);
      if (next === h.present) return h;
      const merge = !!a.key && a.key === h.key && a.at - (h.at ?? 0) < 1000;
      return { past: merge ? h.past : [...h.past, h.present].slice(-STEPS), present: next, future: [], key: a.key, at: a.at };
    }
    case "undo":
      return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h;
    case "redo":
      return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
    case "reset":
      return { past: [], present: a.present, future: [] };
  }
}
