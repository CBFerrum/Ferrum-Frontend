// Studio: the analytics engine's API (`/api/app/studio/...`, crates/studio/src/site.rs) and its saved
// records (Report, DashboardChart, NumberCard, Dashboard, Space: ordinary records under /api/v1 whose
// settings the server compiles and checks on every save), typed; TanStack Query hooks; and the pure
// helpers the builders share. Decimals stay exact strings: they become numbers only to be plotted,
// and subtotals add them up exactly (BigInt).

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, ApiError, docPath, download, newKey, type FieldError } from "./api";
import { compareDecimal, formatDate, formatDecimal, formatValue, isDecimalString, NUMERIC_TYPES, todayIso } from "./format";
import type { Doc, ReportDef } from "./meta";

// ───────────────────────────── query spec (spec.rs) ─────────────────────────────

export type Bucket = "day" | "week" | "month" | "quarter" | "year" | "fiscal_quarter" | "fiscal_year";
export type Agg = "count" | "count_distinct" | "sum" | "avg" | "min" | "max";
export type SortDir = "asc" | "desc";
export type CompareKind = "previous_period" | "previous_year";
export type FilterOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "not in" | "like" | "not like" | "between" | "is";
/** `[path, op, value]`; a path is `field`, `link.field`, `table.field`, `table.link.field` or `_tag`. */
export type SpecFilter = [string, FilterOp, unknown];
/** The kernel's filter syntax: the list form, or the object form `{path: value | [op, value]}`. */
export type Filters = SpecFilter[] | Record<string, unknown>;

export const BUCKET_LABEL: Record<Bucket, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
  fiscal_quarter: "Fiscal Quarter",
  fiscal_year: "Fiscal Year",
};

export const AGG_LABEL: Record<Agg, string> = {
  count: "Count",
  count_distinct: "Distinct count",
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
};

export interface FieldSel {
  field: string;
  label?: string;
}

export interface GroupBy {
  field: string;
  /** Required for date-times; dates group by day without one. */
  bucket?: Bucket;
  label?: string;
}

/** `count` without a field counts records; every other function needs a field. */
export interface Measure {
  fn: Agg;
  field?: string;
  label?: string;
}

export interface Pivot {
  field: string;
  bucket?: Bucket;
  /** 1 to 100 (default 20): the largest columns are kept. */
  max_columns?: number;
}

/** `by`: a column name (`customer`, `month(posting_date)`, `sum(grand_total)`), a group-by path or a label. */
export interface Sort {
  by: string;
  dir?: SortDir;
}

/** `from`/`to`: `YYYY-MM-DD` or a relative expression (see `resolveDate`). */
export interface TimeSeries {
  field: string;
  bucket: Bucket;
  from?: string;
  to?: string;
  /** Every bucket appears, empty ones with zero counts and sums. */
  fill_zero?: boolean;
}

export interface DateRange {
  field: string;
  from?: string;
  to?: string;
}

/** The query; the server refuses unknown keys, so this is the whole shape. */
export interface Spec {
  entity: string;
  filters?: Filters | null;
  search?: string;
  /** Plain record columns (a table report); not combined with grouping or measures. */
  fields?: FieldSel[];
  group_by?: GroupBy[];
  measures?: Measure[];
  pivot?: Pivot;
  sort?: Sort[];
  /** 1 to 10000 rows (default 500). */
  limit?: number;
  /** Either this or `date_range`: it carries its own period. */
  time_series?: TimeSeries;
  date_range?: DateRange;
  /** Needs a period with both ends; not with a pivot. */
  compare?: CompareKind;
}

// ───────────────────────────── results (run.rs) ─────────────────────────────

export type ColumnRole = "dimension" | "measure" | "pivot" | "previous" | "field";

export interface ResultColumn {
  name: string;
  label: string;
  /** Metadata field type names (`data`, `int`, `decimal`, `currency`, `percent`, `date`, `datetime`, `link`, `select`, `check`, …); a bucketed dimension is a `date`. */
  type: string;
  /** Absent on built-in report columns. */
  role?: ColumnRole;
  /** The spec path it reads. */
  field?: string;
  to?: string;
  options?: string[];
  precision?: number;
  bucket?: Bucket;
  fn?: Agg;
  /** Pivot and previous-period columns: the measure column they belong to. */
  measure?: string;
  pivot_value?: unknown;
  pivot_label?: string;
  /** From the saved report's column settings. */
  width?: number;
  format?: ColumnFormat;
}

/** Values by column name; links and users carry display titles in `_titles`, table rows their record id in `_id`. */
export type ResultRow = Record<string, unknown> & { _id?: string; _titles?: Record<string, string> };

export interface ResultMeta {
  entity: string;
  timezone: string;
  sql_ms: number;
  /** More rows matched than the limit. */
  truncated: boolean;
  row_count: number;
  /** The child table whose rows are counted (grouping or measuring child-table fields). */
  grain?: string;
  /** The period, resolved to dates. */
  date_range?: { field: string; from: string | null; to: string | null };
  compare?: { kind: CompareKind; from: string; to: string; previous_from: string; previous_to: string };
  pivot_columns?: number;
  pivot_truncated?: boolean;
}

export interface QueryResult {
  columns: ResultColumn[];
  rows: ResultRow[];
  /** Measures over every matching row (table reports: sums of number columns); null when there are none. */
  totals: Record<string, unknown> | null;
  meta: ResultMeta;
}

/** A built-in report's result (`/api/reports/{name}`): chart data when the source is `builtin`. */
export interface BuiltinResult {
  name: string;
  label: string;
  columns: ResultColumn[];
  rows: ResultRow[];
  totals?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
}

/** What the helpers read from either result. */
export interface ResultLike {
  columns: ResultColumn[];
  rows: ResultRow[];
  totals?: Record<string, unknown> | null;
}

// ───────────────────────────── field catalog and sources ─────────────────────────────

export interface CatalogField {
  path: string;
  label: string;
  type: string;
  to?: string;
  options?: string[];
  precision?: number;
  /** Heading to list it under: the entity, or the link or table it is reached through. */
  group: string;
  /** Child-table fields: grouping or measuring one counts that table's rows. */
  child_table?: string;
  groupable: boolean;
  /** Functions that apply besides `count`. */
  aggregates: Agg[];
  buckets: Bucket[];
  /** Date-times are grouped by a bucket only. */
  bucket_required: boolean;
}

export interface FieldCatalog {
  entity: string;
  label: string;
  fields: CatalogField[];
  filters: { tag: string; operators: FilterOp[] };
  functions: Agg[];
  buckets: Bucket[];
  compare: CompareKind[];
  /** Help text for relative dates. */
  dates: string;
  limits: { rows: number; pivot_columns: number; pivot_cells: number };
}

/** What can feed a chart: built-in reports and the entities the caller can query. */
export interface Sources {
  builtin: ReportDef[];
  entities: { name: string; label: string; module: string | null }[];
}

// ───────────────────────────── saved records (studio.yaml, builder.rs) ─────────────────────────────

export const STUDIO_ENTITY = {
  reports: "Report",
  charts: "DashboardChart",
  cards: "NumberCard",
  dashboards: "Dashboard",
  spaces: "Space",
} as const;
export type StudioKind = keyof typeof STUDIO_ENTITY;

export type Sharing = "private" | "roles" | "everyone";

/** Every builder record. Sharing decides who may open it; the data inside is always computed with the viewer's permissions. */
export interface StudioRecord {
  id?: string;
  version?: number;
  label: string;
  sharing: Sharing;
  /** Required when `sharing` is `roles`. */
  roles?: { id?: string; role: string }[];
  module?: string | null;
  description?: string | null;
  /** Shipped by a package: it cannot be changed (duplicate it to customize). */
  is_standard?: boolean;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  updated_by?: string;
  _titles?: Record<string, string>;
}

export type ReportKind = "table" | "group_by" | "pivot" | "chart";
export type ChartType = "bar" | "stacked_bar" | "line" | "area" | "pie" | "donut" | "percentage" | "heatmap" | "scatter" | "funnel" | "number";
export type ChartSource = "query" | "report" | "builtin";
export type CardFormat = "int" | "decimal" | "currency" | "percent";
export type FormatStyle = "number" | "int" | "currency" | "percent" | "bar";

/** A conditional color: the first matching rule wins. `between` takes `[low, high]`. */
export interface FormatRule {
  op: "=" | "!=" | ">" | ">=" | "<" | "<=" | "between";
  value: unknown;
  /** `#rgb`, `#rrggbb`, `#rrggbbaa` or a lower-case color name. */
  color: string;
}

export interface ColumnFormat {
  style?: FormatStyle | null;
  /** 0 to 9. */
  precision?: number | null;
  prefix?: string | null;
  suffix?: string | null;
  rules?: FormatRule[];
}

/** One visible column of a saved report, in display order; unlisted columns follow. */
export interface ColumnSetting {
  name: string;
  label?: string | null;
  /** 40 to 2000 pixels. */
  width?: number | null;
  hidden?: boolean;
  format?: ColumnFormat | null;
}

/** `Report.chart`. */
export interface ChartSettings {
  type: ChartType;
  x?: string | null;
  y?: string[];
  colors?: string[];
  stacked?: boolean;
  show_legend?: boolean | null;
  show_values?: boolean;
  height?: number | null;
}

export interface ReportRecord extends StudioRecord {
  kind: ReportKind;
  /** Set by the server from the spec. */
  base_entity?: string | null;
  spec: Spec;
  columns?: ColumnSetting[] | null;
  chart?: ChartSettings | null;
  space?: string | null;
}

/** Dashboard filters a widget takes: filter name → its own field path, or `false` to ignore it. */
export type Accepts = Record<string, string | false>;

export interface ChartRecord extends StudioRecord {
  chart_type: ChartType;
  source: ChartSource;
  base_entity?: string | null;
  /** Source `query`. */
  spec?: Spec | null;
  /** Source `report`: a Report id. */
  report?: string | null;
  /** Source `builtin`: a report name from `/api/reports` and its text parameters. */
  builtin_report?: string | null;
  builtin_params?: Record<string, string> | null;
  /** Defaults to the first dimension. */
  x_field?: string | null;
  /** Defaults to every measure. */
  y_fields?: string[] | null;
  colors?: string[] | null;
  accepts?: Accepts | null;
}

export interface CardRecord extends StudioRecord {
  base_entity?: string | null;
  /** One measure, no grouping; a date_range with `compare` gives the change. */
  spec: Spec;
  format: CardFormat;
  precision?: number | null;
  /** A Currency id. */
  currency?: string | null;
  /** A trend over the spec's date range (which then needs both ends). */
  sparkline?: Bucket | null;
  color?: string | null;
  accepts?: Accepts | null;
}

export type FilterType = "link" | "select" | "data" | "check" | "date" | "date_range";

/** A dashboard-level filter, applied to every widget that accepts it. */
export interface FilterDef {
  /** A lower-case identifier, unique on the dashboard. */
  name: string;
  label?: string | null;
  type: FilterType;
  /** Link filters: the entity. */
  to?: string | null;
  /** Select filters. */
  options?: string[];
  /** Date ranges: `{from, to}` (relative expressions keep a dashboard current). */
  default?: unknown;
  /** The field it filters in widgets that do not map it (defaults to `name`). */
  field?: string | null;
}

/** Filter values by name; date ranges as `{from?, to?}`, several values as a list. */
export type FilterValues = Record<string, unknown>;

export interface LinkItem {
  label: string;
  entity?: string | null;
  report?: string | null;
  dashboard?: string | null;
  /** A built-in report name. */
  builtin?: string | null;
  url?: string | null;
}

export interface OnboardingStep {
  label: string;
  description?: string | null;
  /** Done once a matching record exists. */
  entity?: string | null;
  filters?: Filters | null;
  url?: string | null;
}

/** Opens exactly one of entity (optionally filtered, with a live count), report, dashboard or url. */
export interface ShortcutBlock {
  type: "shortcut";
  label: string;
  entity?: string | null;
  report?: string | null;
  dashboard?: string | null;
  url?: string | null;
  /** Entity shortcuts only. */
  filters?: Filters | null;
  show_count?: boolean;
  color?: string | null;
}
export interface LinksBlock {
  type: "links";
  label: string;
  items: LinkItem[];
}
export interface ChartBlock {
  type: "chart";
  chart: string;
}
export interface CardBlock {
  type: "card";
  card: string;
}
export interface ListBlock {
  type: "list";
  label?: string | null;
  entity: string;
  filters?: Filters | null;
  /** Up to 12. */
  fields?: string[];
  sort?: string | null;
  /** 1 to 50 (default 5). */
  limit?: number | null;
}
export interface MarkdownBlock {
  type: "markdown";
  content: string;
}
export interface HeadingBlock {
  type: "heading";
  text: string;
  level?: 1 | 2 | 3 | null;
}
export interface OnboardingBlock {
  type: "onboarding";
  title?: string | null;
  steps: OnboardingStep[];
}

export type Block = ShortcutBlock | LinksBlock | ChartBlock | CardBlock | ListBlock | MarkdownBlock | HeadingBlock | OnboardingBlock;
/** Dashboards hold charts, cards, shortcuts, markdown, headings and lists. */
export type DashboardBlock = Exclude<Block, LinksBlock | OnboardingBlock>;
/** A widget on the 12-column grid: x 0-11, x + w ≤ 12, h 1-100; items may not overlap. `i` is assigned on save when missing. */
export type GridItem = DashboardBlock & { i?: string; x: number; y: number; w: number; h: number };
/** A space block; `width` is 1-12 columns. */
export type SpaceBlock = Block & { width?: number };

export interface DashboardRecord extends StudioRecord {
  layout?: GridItem[] | null;
  filters?: FilterDef[] | null;
  /** Seconds: 0 (off) or 30 to 86400. */
  refresh_interval?: number;
}

export interface SpaceRecord extends StudioRecord {
  icon?: string | null;
  blocks?: SpaceBlock[] | null;
  /** Order in the sidebar. */
  sequence?: number;
}

export interface StudioRecords {
  reports: ReportRecord;
  charts: ChartRecord;
  cards: CardRecord;
  dashboards: DashboardRecord;
  spaces: SpaceRecord;
}

interface ListExtras {
  reports: { base_entity: string | null; kind: ReportKind; space: string | null };
  charts: { base_entity: string | null; chart_type: ChartType; source: ChartSource };
  cards: { base_entity: string | null; format: CardFormat };
  dashboards: { refresh_interval: number | null };
  spaces: { icon: string | null; sequence: number | null };
}

/** A row of `GET /api/app/studio/{kind}`: records the caller may open. `mine`: the caller created it. */
export type StudioListRow<K extends StudioKind = StudioKind> = {
  id: string;
  updated_at: string;
  mine: boolean;
  label: string;
  module: string | null;
  sharing: Sharing;
  is_standard: boolean | null;
  description: string | null;
} & ListExtras[K];

export interface ListFilter {
  module?: string;
  /** Base entity. */
  entity?: string;
}

// ───────────────────────────── data endpoints ─────────────────────────────

/** Runtime settings for a report, chart or card: extra filters (ANDed), search, sort, limit and the period (`from`/`to` replace those of its date range or time series). */
export interface Runtime {
  filters?: Filters | null;
  search?: string;
  sort?: Sort[];
  limit?: number;
  from?: string;
  to?: string;
}

export interface WidgetRequest extends Runtime {
  /** The dashboard it is shown on: lends its sharing and its filters. */
  dashboard?: string;
  values?: FilterValues;
  /** Filter definitions to apply `values` with (previews, or charts shown outside a dashboard). */
  filter_defs?: FilterDef[];
}

/** A builder's live preview: the unsaved record. */
export interface PreviewRequest<R> extends WidgetRequest {
  record: R;
}

/** An error shown in place of one widget. */
export interface WidgetError {
  error: string;
  message: string;
  fields?: FieldError[];
}

/** List filters selecting exactly what a widget counts. */
export interface DrillDown {
  entity: string;
  filters: SpecFilter[];
}

interface Summary {
  id?: string;
  label: string;
  description?: string | null;
  module?: string | null;
  sharing?: Sharing;
  is_standard?: boolean;
}

export type ReportSummary = Summary & Pick<ReportRecord, "kind" | "base_entity" | "columns" | "chart" | "space">;
export type ChartSummary = Summary & Pick<ChartRecord, "chart_type" | "source" | "base_entity" | "colors" | "builtin_report"> & { x: string | null; y: string[] };
export type CardSummary = Summary & Pick<CardRecord, "base_entity" | "format" | "precision" | "color"> & { /** The currency code. */ currency?: string | null };

export interface ReportRun {
  report: ReportSummary;
  data: QueryResult;
}

export interface ChartWidgetData {
  chart: ChartSummary;
  data: QueryResult | BuiltinResult;
  /** Null for built-in sources. */
  drill_down: DrillDown | null;
}

export interface CardWidgetData {
  card: CardSummary;
  value: unknown;
  drill_down: DrillDown;
  meta: ResultMeta;
  /** `[bucket start, value]`, when the card has a sparkline. */
  sparkline?: [string, unknown][];
  /** The trend could not be drawn (the number still is). */
  sparkline_error?: WidgetError;
  /** With `compare`: */
  previous?: unknown;
  delta?: string;
  /** Null when the previous value is zero. */
  delta_percent?: string | null;
  direction?: "up" | "down" | "flat";
}

/** A block resolved for the viewer: what they cannot read is left out; a broken one carries `error`. */
export type ResolvedWidget =
  | {
      type: "shortcut";
      label: string;
      color?: string | null;
      entity?: string;
      filters?: Filters | null;
      count?: number;
      report?: string;
      dashboard?: string;
      /** Title of the report or dashboard opened. */
      title?: string;
      url?: string | null;
      error?: WidgetError;
    }
  | { type: "links"; label: string; items: LinkItem[] }
  | { type: "chart"; chart: ChartSummary; data: QueryResult | BuiltinResult; error?: undefined }
  | { type: "chart"; chart: Summary & { chart_type: ChartType }; error: WidgetError }
  | ({ type: "card"; error?: undefined } & CardWidgetData)
  | { type: "card"; card: Summary & { format?: CardFormat }; error: WidgetError }
  | { type: "list"; label?: string | null; entity: string; fields: string[]; rows: Doc[]; error?: undefined }
  | { type: "list"; label?: string | null; entity: string; error: WidgetError }
  | { type: "markdown"; content: string }
  | { type: "heading"; text: string; level: number }
  | {
      type: "onboarding";
      title?: string | null;
      steps: { label: string; description?: string | null; url?: string | null; entity?: string; done?: boolean; error?: WidgetError }[];
    }
  | { type?: undefined; error: WidgetError };

export interface DashboardData {
  dashboard: Summary & { refresh_interval?: number; filters: FilterDef[] };
  /** The effective filter values: defaults, overridden by what was sent. */
  filters: FilterValues;
  items: { i: string; x: number; y: number; w: number; h: number; widget: ResolvedWidget }[];
}

export interface SpaceData {
  space: Summary & { icon?: string | null; sequence?: number };
  blocks: (ResolvedWidget & { width?: number })[];
}

// ───────────────────────────── client ─────────────────────────────

const BASE = "/api/app/studio";
const enc = encodeURIComponent;

/** Runtime settings as query parameters (filters and sort as JSON), for the CSV export link. */
export function runtimeQuery(rt: Runtime): Record<string, string | number | undefined> {
  const json = (v: unknown) => (v == null || (Array.isArray(v) && !v.length) ? undefined : JSON.stringify(v));
  return { filters: json(rt.filters), sort: json(rt.sort), search: rt.search?.trim() || undefined, limit: rt.limit, from: rt.from || undefined, to: rt.to || undefined };
}

export const studio = {
  query: (spec: Spec, signal?: AbortSignal) => api.post<QueryResult>(`${BASE}/query`, spec, { signal }),
  fields: (entity: string, signal?: AbortSignal) => api.get<FieldCatalog>(`${BASE}/fields/${enc(entity)}`, undefined, signal),
  sources: async (signal?: AbortSignal): Promise<Sources> => {
    const s = await api.get<Sources>(`${BASE}/sources`, undefined, signal);
    // The catalog can list a report twice; names are unique keys.
    return { ...s, builtin: [...new Map(s.builtin.map((r) => [r.name, r])).values()] };
  },
  /** Records of one kind the caller may open. */
  list: async <K extends StudioKind>(kind: K, filter: ListFilter = {}, signal?: AbortSignal) =>
    (await api.get<{ rows: StudioListRow<K>[] }>(`${BASE}/${kind}`, { module: filter.module, entity: filter.entity }, signal)).rows,
  /** The whole record, for editing (viewers who did not create it open it through the data endpoints). */
  get: <K extends StudioKind>(kind: K, id: string, signal?: AbortSignal) => api.get<StudioRecords[K]>(docPath(STUDIO_ENTITY[kind], id), undefined, signal),
  /** Creates (no id) or updates (If-Match on `version`: a 409 means someone saved first). Invalid settings come back as a 422 with field errors (`fieldIssues`). */
  save: <K extends StudioKind>(kind: K, record: StudioRecords[K]): Promise<StudioRecords[K]> => {
    const { id, version, ...body } = record;
    return id
      ? api.patch<StudioRecords[K]>(docPath(STUDIO_ENTITY[kind], id), body, { ifMatch: version })
      : api.post<StudioRecords[K]>(docPath(STUDIO_ENTITY[kind]), body, { idempotencyKey: newKey() });
  },
  /** A 409 when a dashboard or space still shows it. */
  remove: (kind: StudioKind, id: string, version?: number) => api.del(docPath(STUDIO_ENTITY[kind], id), { ifMatch: version }),
  runReport: (id: string, rt: Runtime = {}, signal?: AbortSignal) => api.post<ReportRun>(`${BASE}/reports/${enc(id)}/run`, rt, { signal }),
  /** Downloads every row (up to 10000) as CSV; needs export permission on the report's entity. */
  exportReport: (id: string, rt: Runtime = {}, fileName = "report.csv") =>
    download(`${BASE}/reports/${enc(id)}/export`, fileName, { format: "csv", ...runtimeQuery(rt) }),
  chartData: (id: string, req: WidgetRequest = {}, signal?: AbortSignal) => api.post<ChartWidgetData>(`${BASE}/charts/${enc(id)}/data`, req, { signal }),
  cardData: (id: string, req: WidgetRequest = {}, signal?: AbortSignal) => api.post<CardWidgetData>(`${BASE}/cards/${enc(id)}/data`, req, { signal }),
  previewChart: (req: PreviewRequest<ChartRecord>, signal?: AbortSignal) => api.post<ChartWidgetData>(`${BASE}/charts/preview`, req, { signal }),
  previewCard: (req: PreviewRequest<CardRecord>, signal?: AbortSignal) => api.post<CardWidgetData>(`${BASE}/cards/preview`, req, { signal }),
  dashboardData: (id: string, values: FilterValues = {}, signal?: AbortSignal) => api.post<DashboardData>(`${BASE}/dashboards/${enc(id)}/data`, { values }, { signal }),
  spaceData: (id: string, signal?: AbortSignal) => api.get<SpaceData>(`${BASE}/spaces/${enc(id)}/data`, undefined, signal),
};

// ───────────────────────────── query keys and hooks ─────────────────────────────

/**
 * Lists sit under `["list", Entity]`, so the shell's live updates and generic record edits refresh
 * them; everything computed from saved records sits under `studioKeys.data`.
 */
export const studioKeys = {
  fields: (entity: string) => ["studio", "fields", entity] as const,
  sources: ["studio", "sources"] as const,
  query: (spec: Spec | null) => ["studio", "query", spec] as const,
  list: (kind: StudioKind, filter: ListFilter = {}) => ["list", STUDIO_ENTITY[kind], "studio", filter] as const,
  record: (kind: StudioKind, id: string) => ["studio", "record", kind, id] as const,
  data: ["studio", "data"] as const,
  run: (id: string, rt: Runtime) => ["studio", "data", "run", id, rt] as const,
  chart: (id: string, req: WidgetRequest) => ["studio", "data", "chart", id, req] as const,
  card: (id: string, req: WidgetRequest) => ["studio", "data", "card", id, req] as const,
  preview: (kind: "charts" | "cards", req: unknown) => ["studio", "data", "preview", kind, req] as const,
  dashboard: (id: string, values: FilterValues) => ["studio", "data", "dashboard", id, values] as const,
  space: (id: string) => ["studio", "data", "space", id] as const,
};

/** Query retries for POST reads (the client retries GETs itself): network errors and overload, three times. */
export const retryTransient = (failures: number, error: unknown) =>
  failures < 3 && error instanceof ApiError && [0, 429, 502, 503, 504].includes(error.status);

const LONG = 5 * 60_000;
/** Builder previews: the last result stays on screen while the edited one loads. */
const live = { placeholderData: keepPreviousData, retry: retryTransient };
/** Saved objects: the same, but never another object's data (dashboard A's widgets while B loads). Keys hold the id at [3]. */
export const sameObject = (id: string | undefined) => ({
  placeholderData: <T>(prev: T | undefined, q: { queryKey: readonly unknown[] } | undefined) => (q?.queryKey[3] === (id ?? "") ? prev : undefined),
  retry: retryTransient,
});

export const useStudioFields = (entity: string | undefined) =>
  useQuery({ queryKey: studioKeys.fields(entity ?? ""), queryFn: ({ signal }) => studio.fields(entity ?? "", signal), enabled: !!entity, staleTime: LONG });

export const useStudioSources = () => useQuery({ queryKey: studioKeys.sources, queryFn: ({ signal }) => studio.sources(signal), staleTime: LONG });

/**
 * Runs a spec, keeping the previous result on screen while the next loads. Debounce edits
 * (`useDebounced`) and pass `undefined` while `specIssues` reports something.
 */
export const useStudioQuery = (spec: Spec | undefined) =>
  useQuery({ queryKey: studioKeys.query(spec ?? null), queryFn: ({ signal }) => studio.query(spec as Spec, signal), enabled: !!spec, ...live });

export const useStudioList = <K extends StudioKind>(kind: K, filter: ListFilter = {}) =>
  useQuery({ queryKey: studioKeys.list(kind, filter), queryFn: ({ signal }) => studio.list(kind, filter, signal) });

export const useStudioRecord = <K extends StudioKind>(kind: K, id: string | undefined) =>
  useQuery({ queryKey: studioKeys.record(kind, id ?? ""), queryFn: ({ signal }) => studio.get(kind, id ?? "", signal), enabled: !!id });

function refreshAfterWrite(qc: QueryClient, kind: StudioKind) {
  void qc.invalidateQueries({ queryKey: ["list", STUDIO_ENTITY[kind]] });
  void qc.invalidateQueries({ queryKey: studioKeys.data });
}

export function useSaveStudioRecord<K extends StudioKind>(kind: K) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (record: StudioRecords[K]) => studio.save(kind, record),
    onSuccess: (saved) => {
      if (saved.id) qc.setQueryData(studioKeys.record(kind, saved.id), saved);
      refreshAfterWrite(qc, kind);
    },
  });
}

export function useDeleteStudioRecord(kind: StudioKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version?: number }) => studio.remove(kind, id, version),
    onSuccess: (_, { id }) => {
      qc.removeQueries({ queryKey: studioKeys.record(kind, id) });
      refreshAfterWrite(qc, kind);
    },
  });
}

export const useReportRun = (id: string | undefined, rt: Runtime = {}) =>
  useQuery({ queryKey: studioKeys.run(id ?? "", rt), queryFn: ({ signal }) => studio.runReport(id ?? "", rt, signal), enabled: !!id, ...sameObject(id) });

export const useChartData = (id: string | undefined, req: WidgetRequest = {}) =>
  useQuery({ queryKey: studioKeys.chart(id ?? "", req), queryFn: ({ signal }) => studio.chartData(id ?? "", req, signal), enabled: !!id, ...sameObject(id) });

export const useCardData = (id: string | undefined, req: WidgetRequest = {}) =>
  useQuery({ queryKey: studioKeys.card(id ?? "", req), queryFn: ({ signal }) => studio.cardData(id ?? "", req, signal), enabled: !!id, ...sameObject(id) });

/** Live preview of an unsaved chart (debounce the record; `undefined` pauses). */
export const useChartPreview = (req: PreviewRequest<ChartRecord> | undefined) =>
  useQuery({ queryKey: studioKeys.preview("charts", req ?? null), queryFn: ({ signal }) => studio.previewChart(req as PreviewRequest<ChartRecord>, signal), enabled: !!req, ...live });

export const useCardPreview = (req: PreviewRequest<CardRecord> | undefined) =>
  useQuery({ queryKey: studioKeys.preview("cards", req ?? null), queryFn: ({ signal }) => studio.previewCard(req as PreviewRequest<CardRecord>, signal), enabled: !!req, ...live });

/** Every widget of a dashboard; refreshes itself on the dashboard's interval while the page is visible. */
export const useDashboardData = (id: string | undefined, values: FilterValues = {}) =>
  useQuery({
    queryKey: studioKeys.dashboard(id ?? "", values),
    queryFn: ({ signal }) => studio.dashboardData(id ?? "", values, signal),
    enabled: !!id,
    ...sameObject(id),
    refetchInterval: (q) => {
      const s = q.state.data?.dashboard.refresh_interval ?? 0;
      return s >= 30 ? s * 1000 : false;
    },
  });

export const useSpaceData = (id: string | undefined) =>
  useQuery({ queryKey: studioKeys.space(id ?? ""), queryFn: ({ signal }) => studio.spaceData(id ?? "", signal), enabled: !!id });

// ───────────────────────────── builder state → spec ─────────────────────────────

/**
 * What a query builder edits: every part present, rows possibly incomplete, so switching the
 * report kind keeps what does not apply. `buildSpec` keeps rows one-to-one, so error paths such as
 * `measures[1].field` (from `specIssues` or the server) point at the same rows.
 */
export interface SpecDraft {
  entity: string;
  kind: ReportKind;
  filters: SpecFilter[];
  search: string;
  /** Table reports. */
  fields: FieldSel[];
  group_by: GroupBy[];
  measures: Measure[];
  /** Pivot reports. */
  pivot: Pivot | null;
  sort: Sort[];
  limit: number | null;
  /** A time axis: a date field bucketed as the first dimension (grouped kinds). */
  time: { field: string; bucket: Bucket; fill_zero: boolean } | null;
  /** The period (dates or relative expressions); with a time axis it applies to the axis field. */
  period: { field: string; from: string; to: string } | null;
  /** Grouped kinds except pivot. */
  compare: CompareKind | null;
}

export function emptyDraft(entity = "", kind: ReportKind = "table"): SpecDraft {
  return {
    entity,
    kind,
    filters: [],
    search: "",
    fields: [],
    group_by: [],
    measures: kind === "table" ? [] : [{ fn: "count" }],
    pivot: null,
    sort: [],
    limit: null,
    time: null,
    period: null,
    compare: null,
  };
}

const clean = (s: string | null | undefined) => s?.trim() || undefined;

function labelled<T extends object>(base: T, label: string | undefined): T & { label?: string } {
  const l = clean(label);
  return l ? { ...base, label: l } : base;
}

export function buildSpec(d: SpecDraft): Spec {
  const spec: Spec = { entity: d.entity.trim() };
  const grouped = d.kind !== "table";
  if (d.filters.length) spec.filters = d.filters;
  const search = clean(d.search);
  if (search) spec.search = search;
  if (!grouped && d.fields.length) spec.fields = d.fields.map((f) => labelled({ field: f.field.trim() }, f.label));
  if (grouped) {
    if (d.group_by.length) spec.group_by = d.group_by.map((g) => labelled({ field: g.field.trim(), ...(g.bucket ? { bucket: g.bucket } : {}) }, g.label));
    if (d.measures.length)
      spec.measures = d.measures.map((m) => {
        const field = clean(m.field);
        return labelled({ fn: m.fn, ...(field ? { field } : {}) }, m.label);
      });
    if (d.kind === "pivot" && d.pivot) {
      const { bucket, max_columns } = d.pivot;
      spec.pivot = { field: d.pivot.field.trim(), ...(bucket ? { bucket } : {}), ...(max_columns ? { max_columns } : {}) };
    }
  }
  const from = clean(d.period?.from);
  const to = clean(d.period?.to);
  const ends = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  if (grouped && d.time) spec.time_series = { field: d.time.field.trim(), bucket: d.time.bucket, ...ends, ...(d.time.fill_zero ? { fill_zero: true } : {}) };
  else if (d.period && (from || to)) spec.date_range = { field: d.period.field.trim(), ...ends };
  if (grouped && d.kind !== "pivot" && d.compare) spec.compare = d.compare;
  if (d.sort.length) spec.sort = d.sort.map((s) => ({ by: s.by.trim(), dir: s.dir ?? "asc" }));
  if (d.limit != null) spec.limit = d.limit;
  return spec;
}

/** Filters in their list form (the object form is converted as the server does). */
export function filterList(f: Filters | null | undefined): SpecFilter[] {
  if (!f) return [];
  if (Array.isArray(f)) return f;
  return Object.entries(f).map(([path, v]) =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === "string" ? [path, v[0] as FilterOp, v[1]] : [path, "=", v],
  );
}

/** A saved spec as builder state (the kind from the record, else inferred). */
export function draftFromSpec(spec: Spec, kind?: ReportKind): SpecDraft {
  const ts = spec.time_series;
  const grouped = !!(spec.group_by?.length || spec.measures?.length || spec.pivot || ts);
  const range = ts ?? spec.date_range;
  return {
    entity: spec.entity,
    kind: kind ?? (spec.pivot ? "pivot" : grouped ? "group_by" : "table"),
    filters: filterList(spec.filters),
    search: spec.search ?? "",
    fields: spec.fields ?? [],
    group_by: spec.group_by ?? [],
    measures: spec.measures ?? [],
    pivot: spec.pivot ?? null,
    sort: spec.sort ?? [],
    limit: spec.limit ?? null,
    time: ts ? { field: ts.field, bucket: ts.bucket, fill_zero: !!ts.fill_zero } : null,
    period: range && (range.from || range.to) ? { field: range.field, from: range.from ?? "", to: range.to ?? "" } : null,
    compare: spec.compare ?? null,
  };
}

/** A problem at a path of the spec (`measures[1].field`) or of a record (`spec.measures[1].field`, `layout[2]`). */
export interface Issue {
  path: string;
  message: string;
}

/**
 * What keeps a spec from being worth sending: incomplete rows, a missing measure, unreadable
 * dates (and, with the entity's catalog, buckets and functions that do not apply). The server
 * checks everything else and answers with the same paths.
 */
export function specIssues(spec: Spec, catalog?: FieldCatalog): Issue[] {
  const out: Issue[] = [];
  const add = (path: string, message: string) => out.push({ path, message });
  const field = new Map(catalog?.fields.map((f) => [f.path, f]));
  if (!spec.entity) add("entity", "Choose what to report on");
  spec.fields?.forEach((f, i) => f.field || add(`fields[${i}].field`, "Choose a field"));
  spec.group_by?.forEach((g, i) => {
    if (!g.field) add(`group_by[${i}].field`, "Choose a field");
    else if (!g.bucket && field.get(g.field)?.bucket_required) add(`group_by[${i}].bucket`, "Choose a period: date-times are grouped by day, week, month, quarter or year");
  });
  spec.measures?.forEach((m, i) => {
    if (!m.field) {
      if (m.fn !== "count") add(`measures[${i}].field`, `Choose the field for ${AGG_LABEL[m.fn].toLowerCase()}`);
      return;
    }
    const f = field.get(m.field);
    if (f && m.fn !== "count" && !f.aggregates.includes(m.fn)) add(`measures[${i}]`, `${AGG_LABEL[m.fn]} does not apply to ${f.label}`);
  });
  const grouped = !!(spec.group_by?.length || spec.measures?.length || spec.pivot || spec.time_series);
  if (grouped && !spec.measures?.length) add("measures", "Add at least one measure, such as a count");
  if (spec.pivot && !spec.pivot.field) add("pivot.field", "Choose a field");
  for (const key of ["time_series", "date_range"] as const) {
    const r = spec[key];
    if (!r) continue;
    if (!r.field) add(`${key}.field`, "Choose a date field");
    for (const end of ["from", "to"] as const) {
      const v = r[end];
      if (v && resolveDate(v) === null) add(`${key}.${end}`, "Use a date (YYYY-MM-DD) or an expression such as today-30d or start_of_month");
    }
  }
  const range = spec.time_series ?? spec.date_range;
  if (spec.compare && !(range?.from && range.to)) add("compare", "Comparing needs a period with a start and an end");
  spec.sort?.forEach((s, i) => s.by || add(`sort[${i}].by`, "Choose a column"));
  if (Array.isArray(spec.filters)) spec.filters.forEach((f, i) => f[0] || add(`filters[${i}]`, "Choose a field"));
  return out;
}

// ───────────────────────────── formatting ─────────────────────────────

export interface CellOptions {
  locale?: string;
  /** The workspace's (`/api/auth/me` → `fiscal_year_start_month`), for fiscal quarter labels. */
  fyStartMonth?: number;
  /** Fraction digits of the currency, when known. */
  currencyPrecision?: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const fiscalYear = (year: number, startMonth: number) => (startMonth === 1 ? `FY ${year}` : `FY ${year}-${String((year + 1) % 100).padStart(2, "0")}`);

/** A bucket start (`YYYY-MM-DD`) as a period: `Oct 2026`, `Q4 2026`, `Q3 FY 2026-27`, `Week of Oct 26, 2026`. */
export function formatBucket(value: unknown, bucket: Bucket, fyStartMonth = 1, locale?: string): string {
  const m = typeof value === "string" ? ISO_DATE.exec(value) : null;
  if (!m) return value == null ? "" : String(value);
  const [y, mo] = [Number(m[1]), Number(m[2])];
  const date = new Date(y, mo - 1, Number(m[3]));
  switch (bucket) {
    case "day":
      return formatDate(value, locale);
    case "week":
      return `Week of ${formatDate(value, locale)}`;
    case "month":
      return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(date);
    case "quarter":
      return `Q${Math.floor((mo - 1) / 3) + 1} ${y}`;
    case "year":
      return String(y);
    case "fiscal_year":
      return fiscalYear(y, mo);
    case "fiscal_quarter": {
      const start = Math.min(Math.max(Math.trunc(fyStartMonth) || 1, 1), 12);
      const fy = mo >= start ? y : y - 1;
      return `Q${Math.floor(((y - fy) * 12 + mo - start) / 3) + 1} ${fiscalYear(fy, start)}`;
    }
  }
}

/** A column's display label; date pivot values read as dates (`Oct 1, 2026 · Count`, not `2026-10-01 · Count`). */
export function columnLabel(c: ResultColumn, o: CellOptions = {}): string {
  const pl = c.pivot_label;
  if (c.role !== "pivot" || typeof pl !== "string" || !c.label.startsWith(pl)) return c.label;
  const v = c.pivot_value;
  const nice = c.bucket ? formatBucket(v, c.bucket, o.fyStartMonth, o.locale) : typeof v === "string" && ISO_DATE.test(v) ? formatDate(v, o.locale) : pl;
  return nice + c.label.slice(pl.length);
}

/** Numbers (not bucketed dates): right-aligned in tables, plotted in charts. */
export const isNumericColumn = (c: ResultColumn) => NUMERIC_TYPES.has(c.type) && !c.bucket;

/**
 * A cell for display: link and user titles, `(not set)` for empty groups, date buckets as periods,
 * numbers by type (or the saved column format) with exact rounding, averages to two places
 * unless the field says otherwise.
 */
export function formatCell(c: ResultColumn, value: unknown, row?: ResultRow, o: CellOptions = {}): string {
  const title = row?._titles?.[c.name];
  if (title) return title;
  if (value === null || value === undefined || value === "") return c.role === "dimension" ? "(not set)" : "";
  if (c.bucket) return formatBucket(value, c.bucket, o.fyStartMonth, o.locale);
  const f = c.format;
  const styled = { int: "int", currency: "currency", percent: "percent", number: "decimal" } as Record<string, string>;
  const type = (f?.style && styled[f.style]) || c.type;
  const precision = f?.precision ?? c.precision ?? (c.fn === "avg" ? 2 : undefined);
  const text = formatValue({ type, precision }, value, { locale: o.locale, currencyPrecision: f?.precision == null ? o.currencyPrecision : undefined });
  return text && (f?.prefix || f?.suffix) ? `${f.prefix ?? ""}${text}${f.suffix ?? ""}` : text;
}

/** -1/0/1, exactly for numbers; null when the values cannot be ordered against each other. */
function compareValues(a: unknown, b: unknown): number | null {
  if (a === b) return 0;
  const sa = typeof a === "number" ? String(a) : a;
  const sb = typeof b === "number" ? String(b) : b;
  const na = isDecimalString(sa);
  if (na && isDecimalString(sb)) return compareDecimal(sa, sb);
  // Text against text (dates, names); a number never orders against text.
  if (!na && !isDecimalString(sb) && typeof sa === "string" && typeof sb === "string") return sa < sb ? -1 : sa > sb ? 1 : 0;
  return null;
}

function ruleMatches(r: FormatRule, v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (r.op === "between") {
    if (!Array.isArray(r.value) || r.value.length !== 2) return false;
    const lo = compareValues(v, r.value[0]);
    const hi = compareValues(v, r.value[1]);
    return lo !== null && hi !== null && lo >= 0 && hi <= 0;
  }
  const c = compareValues(v, r.value);
  if (c === null) return r.op === "!=";
  return { "=": c === 0, "!=": c !== 0, ">": c > 0, ">=": c >= 0, "<": c < 0, "<=": c <= 0 }[r.op];
}

/** The color of the first conditional-format rule the value meets (safe CSS colors only). */
export function ruleColor(c: ResultColumn, value: unknown): string | undefined {
  return c.format?.rules?.find((r) => isSafeColor(r.color) && ruleMatches(r, value))?.color;
}

/** A number card's value by its format: currency symbols from ISO codes, `compact` for `₹23.3K`. Missing values read `—`. */
export function formatCardValue(value: unknown, card: Pick<CardSummary, "format" | "precision" | "currency">, o: { locale?: string; compact?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const s = String(value).trim();
  if (!isDecimalString(s)) return s;
  const digits = card.format === "int" ? 0 : Math.min(Math.max(card.precision ?? 2, 0), 9);
  const opts: Intl.NumberFormatOptions = o.compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  const n = s as Intl.StringNumericLiteral;
  if (card.format === "currency" && card.currency) {
    try {
      return new Intl.NumberFormat(o.locale, { ...opts, style: "currency", currency: card.currency }).format(n);
    } catch {
      // Not an ISO 4217 code: shown in front of the number.
      return `${card.currency} ${new Intl.NumberFormat(o.locale, opts).format(n)}`;
    }
  }
  const text = new Intl.NumberFormat(o.locale, opts).format(n);
  return card.format === "percent" ? `${text}%` : text;
}

/** The change since the previous period: `+12.5%`, or the absolute change when the previous value was zero; `""` without a comparison. */
export function formatChange(data: Pick<CardWidgetData, "delta" | "delta_percent">, card: Pick<CardSummary, "format" | "precision" | "currency">, o: { locale?: string } = {}): string {
  const { delta, delta_percent: pct } = data;
  if (delta == null) return "";
  const raw = pct ?? delta;
  const text = pct != null ? `${formatDecimal(pct, undefined, o.locale)}%` : formatCardValue(delta, card, o);
  return isDecimalString(raw) && compareDecimal(raw, "0") > 0 ? `+${text}` : text;
}

// ───────────────────────────── totals ─────────────────────────────

/** Exact sum of decimal strings and integers (others are skipped); null when there is nothing to add. */
export function sumDecimal(values: unknown[]): string | null {
  let total = 0n;
  let scale = 0;
  let any = false;
  for (const v of values) {
    const s = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : "";
    if (!isDecimalString(s)) continue;
    any = true;
    const [int, frac = ""] = s.replace(/^[-+]/, "").split(".");
    if (frac.length > scale) {
      total *= 10n ** BigInt(frac.length - scale);
      scale = frac.length;
    }
    const n = BigInt(int + frac.padEnd(scale, "0"));
    total += s.startsWith("-") ? -n : n;
  }
  if (!any) return null;
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, "0");
  const frac = digits.slice(digits.length - scale).replace(/0+$/, "");
  const out = digits.slice(0, digits.length - scale) + (frac ? `.${frac}` : "");
  return total < 0n ? `-${out}` : out;
}

const fnOf = (c: ResultColumn, cols: ResultColumn[]): Agg | undefined => c.fn ?? (c.measure ? cols.find((m) => m.name === c.measure)?.fn : undefined);
/** Table reports total these (percentages do not add up). */
const SUMMED_FIELDS = new Set(["int", "decimal", "currency"]);

/** Totals of some rows: sums and counts add up, minimums and maximums carry over; averages and distinct counts cannot be derived and are left out. */
export function subtotal(columns: ResultColumn[], rows: ResultRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    const fn = fnOf(c, columns);
    const values = rows.map((r) => r[c.name]).filter((v) => v !== null && v !== undefined && v !== "");
    if (fn === "sum" || fn === "count" || (c.role === "field" && SUMMED_FIELDS.has(c.type))) {
      const s = sumDecimal(values);
      out[c.name] = s === null ? null : c.type === "int" ? Number(s) : s;
    } else if (fn === "min" || fn === "max") {
      out[c.name] = values.reduce<unknown>((best, v) => {
        const d = best === undefined ? null : compareValues(v, best);
        return best === undefined || (d !== null && (fn === "min" ? d < 0 : d > 0)) ? v : best;
      }, undefined) ?? null;
    }
  }
  return out;
}

export interface RowGroup {
  /** The dimension's raw value. */
  value: unknown;
  label: string;
  rows: ResultRow[];
  totals: Record<string, unknown>;
}

/** Rows grouped by a dimension (in first-seen order), each group with its subtotals. */
export function groupRows(result: ResultLike, dim: string, o: CellOptions = {}): RowGroup[] {
  const col = result.columns.find((c) => c.name === dim);
  const groups = new Map<string, RowGroup>();
  for (const r of result.rows) {
    const key = JSON.stringify(r[dim] ?? null);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { value: r[dim] ?? null, label: col ? formatCell(col, r[dim], r, o) : String(r[dim] ?? ""), rows: [], totals: {} }));
    g.rows.push(r);
  }
  const out = [...groups.values()];
  for (const g of out) g.totals = subtotal(result.columns, g.rows);
  return out;
}

/** The totals line in column order (formatted), "Total" in the first cell when it has no total; null without totals. */
export function totalsLine(result: ResultLike, o: CellOptions = {}): string[] | null {
  const t = result.totals;
  if (!t || !result.columns.some((c) => c.name in t)) return null;
  return result.columns.map((c, i) => (c.name in t ? formatCell(c, t[c.name], undefined, o) : i === 0 ? "Total" : ""));
}

// ───────────────────────────── charts ─────────────────────────────

/** A number to plot: numbers and decimal strings; null for anything else. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return typeof v === "string" && isDecimalString(v) ? Number(v) : null;
}

/** The server's color rule (`#rgb`, `#rrggbb`, `#rrggbbaa` or a lower-case name): safe inside CSS. */
export const isSafeColor = (c: unknown): c is string =>
  typeof c === "string" && (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c) || (c.length <= 30 && /^[a-z][a-z0-9-]*$/.test(c)));

/** The i-th series color: the chart's own, else the theme palette (`--chart-1` … `--chart-8`). */
export const chartColor = (i: number, colors?: string[] | null) => {
  const c = colors?.[i];
  return isSafeColor(c) ? c : `var(--chart-${(i % 8) + 1})`;
};

export interface ChartSeries {
  /** Recharts `dataKey` and chart-config key (`s0`, `s1`, …): column names hold dots and brackets neither accepts. */
  key: string;
  label: string;
  column: ResultColumn;
  color: string;
  /** Values of the dimensions spread across series (all but the x axis), for drill-down. */
  dims?: Record<string, unknown>;
}

export interface ChartRow {
  /** The raw x value (a bucket start, an id, a category). */
  x: unknown;
  label: string;
  /** Exact formatted values by series key, for tooltips and value labels. */
  fmt: Record<string, string>;
  /** Plotted values by series key: numbers, null where unknown. */
  [series: string]: unknown;
}

export interface ChartModel {
  x: ResultColumn | undefined;
  series: ChartSeries[];
  rows: ChartRow[];
  /** For `<ChartContainer config>`. */
  config: Record<string, { label: string; color: string }>;
  /** There were more series than `maxSeries`; the smallest were left out. */
  truncated: boolean;
}

export interface ChartOptions extends CellOptions {
  /** Column on the x axis (default: the first dimension). */
  x?: string | null;
  /** Columns plotted (default: measures, pivot and previous-period columns). */
  y?: string[] | null;
  colors?: string[] | null;
  /** Default 12. */
  maxSeries?: number;
}

const VALUE_ROLES = new Set<ColumnRole>(["measure", "pivot", "previous"]);
/** An empty group is worth zero for these (as the server fills pivots and time series). */
const ZERO_WHEN_EMPTY = new Set<Agg>(["count", "count_distinct", "sum"]);

/**
 * A result as chart series. Only number columns are plotted; a pivot plots its columns (not
 * their totals); dimensions other than the x axis become series (the largest `maxSeries`), with
 * empty cells zero for counts and sums and gaps otherwise.
 */
export function toChart(result: ResultLike, o: ChartOptions = {}): ChartModel {
  const cols = result.columns;
  const named = (n: string) => cols.find((c) => c.name === n);
  const dims = cols.filter((c) => c.role === "dimension");
  const x = (o.x ? named(o.x) : undefined) ?? dims[0] ?? cols[0];
  if (!x) return { x, series: [], rows: [], config: {}, truncated: false };
  let ys = o.y?.length ? o.y.map(named).filter((c): c is ResultColumn => !!c) : cols.filter((c) => !c.role || VALUE_ROLES.has(c.role));
  ys = ys.filter((c) => c !== x && isNumericColumn(c));
  const pivoted = new Set(ys.filter((c) => c.role === "pivot").map((c) => c.measure));
  if (pivoted.size) ys = ys.filter((c) => c.role !== "measure" || !pivoted.has(c.name));
  const spread = dims.filter((d) => d !== x);
  const comboOf = (r: ResultRow) => JSON.stringify(spread.map((d) => r[d.name] ?? null));

  let series: ChartSeries[];
  const owners: string[] = []; // the combination of spread values each series plots
  let truncated = false;
  if (!spread.length) {
    series = ys.map((c, i) => ({ key: `s${i}`, label: columnLabel(c, o), column: c, color: chartColor(i, o.colors) }));
  } else {
    const combos = new Map<string, { id: string; dims: Record<string, unknown>; label: string; weight: number }>();
    for (const r of result.rows) {
      const id = comboOf(r);
      let c = combos.get(id);
      if (!c) {
        c = { id, dims: Object.fromEntries(spread.map((d) => [d.name, r[d.name] ?? null])), label: spread.map((d) => formatCell(d, r[d.name], r, o)).join(" · "), weight: 0 };
        combos.set(id, c);
      }
      c.weight += Math.abs((ys[0] && toNumber(r[ys[0].name])) ?? 0);
    }
    const ranked = [...combos.values()].sort((a, b) => b.weight - a.weight); // stable: ties keep first-seen order
    const room = Math.max(1, Math.floor((o.maxSeries ?? 12) / Math.max(1, ys.length)));
    truncated = ranked.length > room;
    series = [];
    for (const c of ranked.slice(0, room)) {
      for (const y of ys) {
        const i = series.length;
        series.push({ key: `s${i}`, label: ys.length > 1 ? `${c.label} · ${columnLabel(y, o)}` : c.label, column: y, color: chartColor(i, o.colors), dims: c.dims });
        owners.push(c.id);
      }
    }
  }

  const rows: ChartRow[] = [];
  const byX = new Map<string, ChartRow>();
  for (const r of result.rows) {
    const xKey = JSON.stringify(r[x.name] ?? null);
    let p = spread.length ? byX.get(xKey) : undefined;
    if (!p) {
      p = { x: r[x.name] ?? null, label: formatCell(x, r[x.name], r, o), fmt: {} };
      for (const s of series) {
        const fn = fnOf(s.column, cols);
        const empty = spread.length && fn && ZERO_WHEN_EMPTY.has(fn) ? (s.column.type === "int" ? 0 : "0") : null;
        p[s.key] = toNumber(empty);
        p.fmt[s.key] = empty === null ? "" : formatCell(s.column, empty, undefined, o);
      }
      if (spread.length) byX.set(xKey, p);
      rows.push(p);
    }
    const id = spread.length ? comboOf(r) : null;
    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      if (id !== null && owners[i] !== id) continue;
      p[s.key] = toNumber(r[s.column.name]);
      p.fmt[s.key] = formatCell(s.column, r[s.column.name], r, o);
    }
  }
  return { x, series, rows, config: Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])), truncated };
}

/**
 * Whether a chart type fits the query's columns: the server's rules (it checks them on save,
 * not in previews), with its messages. Built-in sources (columns without roles) are checked when run.
 */
export function chartIssues(type: ChartType, columns: ResultColumn[] | undefined, x?: string | null, y: string[] = [], colors: string[] = []): string[] {
  const errs: string[] = [];
  if (colors.length > 20 || colors.some((c) => !isSafeColor(c))) errs.push("colors: at most 20 colors, each #rgb, #rrggbb, #rrggbbaa or a lower-case color name");
  if (!columns?.some((c) => c.role)) return errs;
  const dims = columns.filter((c) => c.role === "dimension").map((c) => c.name);
  const values = columns.filter((c) => c.role && VALUE_ROLES.has(c.role)).map((c) => c.name);
  if (x && !dims.includes(x)) errs.push(`x: '${x}' is not a dimension of the query (one of: ${dims.join(", ")})`);
  for (const v of y) if (!values.includes(v)) errs.push(`y: '${v}' is not a measure of the query (one of: ${values.join(", ")})`);
  const measures = y.length || columns.filter((c) => c.role === "measure").length;
  const dated = columns.some((c) => c.role === "dimension" && c.type === "date");
  if (type === "number" && (dims.length || measures !== 1)) errs.push("a number chart shows one measure without dimensions");
  else if (["pie", "donut", "percentage", "funnel"].includes(type) && (dims.length !== 1 || measures !== 1))
    errs.push("pie, donut, percentage and funnel charts need exactly one dimension and one measure");
  else if (type === "heatmap" && !dated) errs.push("a heatmap needs a date dimension (a time series by day works best)");
  else if (type === "scatter" && measures < 2) errs.push("a scatter chart needs two measures (x and y values)");
  else if (["bar", "stacked_bar", "line", "area"].includes(type) && !dims.length) errs.push("bar, line and area charts need at least one dimension (group_by or time_series)");
  return errs;
}

// ───────────────────────────── relative dates ─────────────────────────────

type Ymd = [number, number, number];

function utc(y: number, m: number, d: number): Ymd {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d); // not Date.UTC: it reads years 0-99 as 19xx
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}
const daysIn = (y: number, m: number) => utc(y, m + 1, 0)[2];
const addDays = ([y, m, d]: Ymd, n: number) => utc(y, m, d + n);
/** Months later (or earlier), on the same day or the month's last (as the server's calendar does). */
function addMonths([y, m, d]: Ymd, n: number): Ymd {
  const total = y * 12 + m - 1 + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return [ny, nm, Math.min(d, daysIn(ny, nm))];
}
const isoOf = ([y, m, d]: Ymd) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function parseIso(s: string): Ymd | null {
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo) ? [y, mo, d] : null;
}

/**
 * Resolves a date as the server does (spec.rs `resolve_date`): `YYYY-MM-DD`, or an anchor
 * (`today`, `start_of_` / `end_of_` + `week|month|quarter|year|fiscal_year`) followed by offsets
 * (`-30d`, `+1w`, `-11m`, `-1q`, `-1y`; an offset alone counts from today). Null when invalid.
 */
export function resolveDate(expr: string, today: string = todayIso(), fyStartMonth = 1): string | null {
  const s = expr.trim().toLowerCase();
  if (!s) return null;
  if (/^\d/.test(s)) {
    const d = parseIso(s);
    return d && isoOf(d);
  }
  const t = parseIso(today);
  if (!t) return null;
  const cut = s.search(/[+-]/);
  const anchor = cut < 0 ? s : s.slice(0, cut);
  let rest = cut < 0 ? "" : s.slice(cut);
  const fm = Math.min(Math.max(Math.trunc(fyStartMonth) || 1, 1), 12);
  const week = addDays(t, -((dayOfWeek(t) + 6) % 7)); // ISO weeks start on Monday
  const quarter: Ymd = [t[0], Math.floor((t[1] - 1) / 3) * 3 + 1, 1];
  const fy: Ymd = [t[1] >= fm ? t[0] : t[0] - 1, fm, 1];
  const anchors: Record<string, Ymd> = {
    "": t,
    today: t,
    start_of_week: week,
    end_of_week: addDays(week, 6),
    start_of_month: [t[0], t[1], 1],
    end_of_month: [t[0], t[1], daysIn(t[0], t[1])],
    start_of_quarter: quarter,
    end_of_quarter: addDays(addMonths(quarter, 3), -1),
    start_of_year: [t[0], 1, 1],
    end_of_year: [t[0], 12, 31],
    start_of_fiscal_year: fy,
    end_of_fiscal_year: addDays(addMonths(fy, 12), -1),
  };
  if (!Object.hasOwn(anchors, anchor)) return null; // typed text: `constructor` is not an anchor
  let d = anchors[anchor];
  while (rest) {
    const m = /^([+-])(\d+)([dwmqy])/.exec(rest);
    if (!m || Number(m[2]) > 100_000) return null;
    const n = Number(m[2]) * (m[1] === "-" ? -1 : 1);
    d = m[3] === "d" ? addDays(d, n) : m[3] === "w" ? addDays(d, 7 * n) : addMonths(d, n * ({ m: 1, q: 3, y: 12 } as Record<string, number>)[m[3]]);
    rest = rest.slice(m[0].length);
  }
  return d[0] >= 1900 && d[0] <= 9999 ? isoOf(d) : null;
}

/** 0 = Sunday … 6 = Saturday. */
function dayOfWeek([y, m, d]: Ymd): number {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return t.getUTCDay();
}

export interface DatePreset {
  id: string;
  label: string;
  /** Relative expressions: saved dashboards and reports stay current. */
  from: string;
  to: string;
}

/** Periods to date end today; "last" periods are whole. */
export const DATE_PRESETS: DatePreset[] = [
  { id: "today", label: "Today", from: "today", to: "today" },
  { id: "yesterday", label: "Yesterday", from: "today-1d", to: "today-1d" },
  { id: "last_7_days", label: "Last 7 days", from: "today-6d", to: "today" },
  { id: "last_30_days", label: "Last 30 days", from: "today-29d", to: "today" },
  { id: "last_90_days", label: "Last 90 days", from: "today-89d", to: "today" },
  { id: "this_week", label: "This week", from: "start_of_week", to: "today" },
  { id: "last_week", label: "Last week", from: "start_of_week-1w", to: "start_of_week-1d" },
  { id: "this_month", label: "This month", from: "start_of_month", to: "today" },
  { id: "last_month", label: "Last month", from: "start_of_month-1m", to: "start_of_month-1d" },
  { id: "this_quarter", label: "This quarter", from: "start_of_quarter", to: "today" },
  { id: "last_quarter", label: "Last quarter", from: "start_of_quarter-1q", to: "start_of_quarter-1d" },
  { id: "last_12_months", label: "Last 12 months", from: "start_of_month-11m", to: "today" },
  { id: "this_year", label: "This year", from: "start_of_year", to: "today" },
  { id: "last_year", label: "Last year", from: "start_of_year-1y", to: "start_of_year-1d" },
  { id: "this_fiscal_year", label: "This fiscal year", from: "start_of_fiscal_year", to: "today" },
  { id: "last_fiscal_year", label: "Last fiscal year", from: "start_of_fiscal_year-1y", to: "start_of_fiscal_year-1d" },
];

/** The preset a period is, if any. */
export function presetOf(from: string | null | undefined, to: string | null | undefined): DatePreset | undefined {
  const f = (from ?? "").trim().toLowerCase();
  const t = (to ?? "").trim().toLowerCase();
  return DATE_PRESETS.find((p) => p.from === f && p.to === t);
}

// ───────────────────────────── API errors → field messages ─────────────────────────────

/** `x: …`, `group_by[0].field: …` at the start of a message. */
const NAMED_PATH = /^([a-z_][a-z0-9_]*(?:\[\d+\]|\.[a-z_][a-z0-9_]*)*):\s+([\s\S]+)$/;
/** `[1] overlaps …`, `[0].name must be …`, `[2]: …` (positions in a list setting). */
const INDEXED_PATH = /^(\[\d+\](?:\[\d+\]|\.[a-z_][a-z0-9_]*)*):?\s+([\s\S]+)$/;
/** DashboardChart reports its chart settings under `chart_type`; these are the record fields they concern. */
const CHART_FIELDS: Record<string, string> = { x: "x_field", y: "y_fields", colors: "colors" };

/**
 * Field errors of a failed request as path → message. Paths of setting errors go down into the
 * setting: a saved Report's `{field: "spec", message: "group_by[0].field: unknown field…"}`
 * becomes `spec.group_by[0].field`, a dashboard's `{field: "layout", message: "[1] overlaps…"}`
 * becomes `layout[1]`. Queries and previews answer with spec paths (`group_by[0].field`). Empty
 * when the error has no field errors (show `errorMessage` instead).
 */
export function fieldIssues(error: unknown): Issue[] {
  if (!(error instanceof ApiError)) return [];
  return error.fields.map((f) => {
    let path = f.row ? `${f.row[0]}[${f.row[1]}].${f.field}` : f.field;
    let message = f.message;
    const m = INDEXED_PATH.exec(message) ?? NAMED_PATH.exec(message);
    if (m) {
      message = m[2];
      if (f.field === "chart_type" && CHART_FIELDS[m[1]]) path = CHART_FIELDS[m[1]];
      else if (m[1] !== f.field) path = !path ? m[1] : m[1].startsWith("[") ? path + m[1] : `${path}.${m[1]}`;
    }
    return { path, message: message.charAt(0).toUpperCase() + message.slice(1) };
  });
}

/** Messages at `path` and below (`measures[0]` covers `measures[0].field`, not `measures[01]`). */
export function issuesAt(issues: Issue[], path: string): string[] {
  return issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`) || i.path.startsWith(`${path}[`)).map((i) => i.message);
}
