// Builder state ⇄ saved records, for charts, number cards and dashboards: what the editors hold,
// what they save (blank optional settings as null, settings that do not apply to the chosen
// source or format dropped), and what keeps a draft from being previewed.

import { buildSpec, draftFromSpec, emptyDraft, specIssues, type CardRecord, type ChartRecord, type ChartType, type DashboardBlock, type DashboardRecord, type FieldCatalog, type Issue, type SpecDraft, type SpecFilter } from "@/lib/studio";
import type { DashboardDraft } from "./DashboardSettings";
import { cleanFilterDef } from "./filters";
import { stableJson } from "./history";
import { normalize, withIds, type Placed } from "./layout";

const CHART_TYPES: ChartType[] = ["bar", "stacked_bar", "line", "area", "pie", "donut", "percentage", "heatmap", "scatter", "funnel", "number"];

/** Conditions still missing their value (the server would read an empty value literally). */
function incompleteFilters(filters: SpecFilter[]): Issue[] {
  const out: Issue[] = [];
  filters.forEach(([path, op, v], i) => {
    const empty = v === "" || v === null || v === undefined || (Array.isArray(v) && (!v.length || v.some((x) => x === "")));
    if (path && op !== "is" && empty) out.push({ path: `spec.filters[${i}]`, message: "Enter a value, or remove the condition" });
  });
  return out;
}

const SPEC_KEYS = new Set(["entity", "filters", "search", "fields", "group_by", "measures", "pivot", "sort", "limit", "time_series", "date_range", "compare"]);

/** Preview errors name spec paths (`group_by[0].field`); saved ones name record fields (`spec.group_by[0].field`). */
export const asRecordIssue = (i: Issue): Issue => (SPEC_KEYS.has(i.path.split(/[.[]/)[0]) ? { ...i, path: `spec.${i.path}` } : i);

// ───────────────────────────── charts ─────────────────────────────

export interface ChartDraft {
  rec: ChartRecord;
  query: SpecDraft;
}

export function chartDraft(r: ChartRecord): ChartDraft {
  const spec = r.spec ?? { entity: "" };
  const query = draftFromSpec(spec, spec.pivot ? "pivot" : "group_by");
  return { rec: { ...r, spec: undefined }, query: query.measures.length ? query : { ...query, measures: [{ fn: "count" }] } };
}

const blank = <T>(v: T | null | undefined, empty: (v: T) => boolean): T | null => (v === null || v === undefined || empty(v) ? null : v);

export function chartRecord({ rec, query }: ChartDraft): ChartRecord {
  const source = rec.source;
  const params = Object.fromEntries(Object.entries(rec.builtin_params ?? {}).filter(([, v]) => typeof v === "string" && v.trim()));
  return {
    ...rec,
    label: rec.label.trim(),
    description: rec.description?.trim() || null,
    spec: source === "query" ? buildSpec(query) : null,
    report: source === "report" ? rec.report || null : null,
    builtin_report: source === "builtin" ? rec.builtin_report || null : null,
    builtin_params: source === "builtin" && Object.keys(params).length ? params : null,
    x_field: rec.x_field || null,
    y_fields: blank(rec.y_fields, (v) => !v.length),
    colors: blank(rec.colors, (v) => !v.length),
    accepts: blank(rec.accepts, (v) => !Object.keys(v).length),
    roles: rec.sharing === "roles" ? (rec.roles ?? []) : [],
  };
}

/** A new chart (`?entity=` and `?type=` preset it). */
export function blankChart(sp: URLSearchParams = new URLSearchParams()): ChartRecord {
  const type = sp.get("type") as ChartType;
  return { label: "", sharing: "private", chart_type: CHART_TYPES.includes(type) ? type : "bar", source: "query", spec: buildSpec(emptyDraft(sp.get("entity") ?? "", "group_by")) };
}

/** What keeps a chart from being previewed (and saved), checked before asking the server. */
export function chartIssuesLocal({ rec, query }: ChartDraft, catalog: FieldCatalog | undefined, requiredParams: string[]): Issue[] {
  if (rec.source === "report") return rec.report ? [] : [{ path: "report", message: "Choose a saved report" }];
  if (rec.source === "builtin") {
    if (!rec.builtin_report) return [{ path: "builtin_report", message: "Choose a report" }];
    return requiredParams.filter((p) => !rec.builtin_params?.[p]?.trim()).map((p) => ({ path: "builtin_params", message: `Enter ${p.replace(/_/g, " ")}: the report needs it` }));
  }
  if (!query.entity) return [{ path: "spec.entity", message: "Choose what to report on" }];
  return [...specIssues(buildSpec(query), catalog).map((i) => ({ ...i, path: `spec.${i.path}` })), ...incompleteFilters(query.filters)];
}

// ───────────────────────────── number cards ─────────────────────────────

export interface CardDraft {
  rec: CardRecord;
  query: SpecDraft;
}

export function cardDraft(r: CardRecord): CardDraft {
  const q = draftFromSpec(r.spec ?? { entity: "" }, "group_by");
  return { rec: r, query: { ...q, measures: q.measures.length ? q.measures.slice(0, 1) : [{ fn: "count" }] } };
}

/** One value: no grouping, time axis, pivot, sorting or limit. */
const cardSpec = (query: SpecDraft) => buildSpec({ ...query, kind: "group_by", group_by: [], time: null, pivot: null, sort: [], limit: null, measures: query.measures.slice(0, 1) });

export function cardRecord({ rec, query }: CardDraft): CardRecord {
  const spec = cardSpec(query);
  const ranged = !!(spec.date_range?.from && spec.date_range.to);
  return {
    ...rec,
    label: rec.label.trim(),
    description: rec.description?.trim() || null,
    spec,
    precision: rec.format === "int" || rec.precision === undefined ? null : rec.precision,
    currency: rec.format === "currency" ? rec.currency || null : null,
    sparkline: ranged ? rec.sparkline || null : null,
    color: rec.color || null,
    accepts: blank(rec.accepts, (v) => !Object.keys(v).length),
    roles: rec.sharing === "roles" ? (rec.roles ?? []) : [],
  };
}

export const blankCard = (sp: URLSearchParams = new URLSearchParams()): CardRecord => ({ label: "", sharing: "private", format: "int", spec: buildSpec(emptyDraft(sp.get("entity") ?? "", "group_by")) });

export function cardIssuesLocal({ query }: CardDraft, catalog: FieldCatalog | undefined): Issue[] {
  if (!query.entity) return [{ path: "spec.entity", message: "Choose what to count" }];
  return [...specIssues(cardSpec(query), catalog).map((i) => ({ ...i, path: `spec.${i.path}` })), ...incompleteFilters(query.filters)];
}

// ───────────────────────────── dashboards ─────────────────────────────

export type DashboardEdit = DashboardDraft & { layout: Placed[] };

export function dashboardDraft(r: DashboardRecord): DashboardEdit {
  return {
    label: r.label,
    description: r.description ?? null,
    sharing: r.sharing,
    roles: (r.roles ?? []).map((x) => ({ role: x.role })),
    module: r.module ?? null,
    refresh_interval: r.refresh_interval ?? 0,
    filters: r.filters ?? [],
    layout: normalize(withIds(r.layout ?? [])),
  };
}

/** The record to save (the layout keeps every widget's id). */
export function dashboardBody(d: DashboardEdit): DashboardRecord {
  return {
    label: d.label.trim(),
    description: d.description?.trim() || null,
    sharing: d.sharing,
    roles: d.sharing === "roles" ? (d.roles ?? []) : [],
    module: d.module || null,
    refresh_interval: d.refresh_interval ?? 0,
    filters: d.filters.map(cleanFilterDef),
    layout: d.layout,
  };
}

/** A widget's settings without its place: equal keys mean the server already resolved this widget. */
export const blockKey = (it: Placed) => {
  const { i: _i, x: _x, y: _y, w: _w, h: _h, ...block } = it;
  return stableJson(block);
};

export const blockOf = (it: Placed): DashboardBlock => JSON.parse(blockKey(it)) as DashboardBlock;
