// Per-user list settings, stored as the preference `list:<Entity>`: which columns show, in what
// order and how wide, the sort, and named views. A view is a saved query (the list's URL state:
// filters, search, sort, view kind) with its own columns; one of them can open the list by default.
// Pure functions, tested without a browser.

import { newKey } from "../../lib/api";
import { humanize } from "../../lib/format";
import { SYSTEM_FIELD_LABELS, type EntityMeta, type Field } from "../../lib/meta";

export interface Column {
  name: string;
  label: string;
  field: Pick<Field, "name" | "type"> & Partial<Field>;
  sortable: boolean;
}

export interface SavedView {
  id: string;
  name: string;
  /** The list's URL state: `f.<field>` filters, `q`, `sort`, `view`, `by`. */
  query: Record<string, string>;
  columns?: string[];
  widths?: Record<string, number>;
}

/** The columns of the personal layout or of a view; absent means the entity's defaults. */
export type Layout = Pick<SavedView, "columns" | "widths">;

export interface ListPrefs extends Layout {
  sort?: string;
  views: Record<string, SavedView>;
  /** The view a list opens with. */
  default_view?: string;
}

export const listScope = (entity: string) => `list:${entity}`;
/** URL parameter naming the saved view in use. */
export const VIEW_PARAM = "saved";
export const MIN_WIDTH = 60;
export const MAX_WIDTH = 800;

export const clampWidth = (w: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));

const SYSTEM_TYPES: Record<string, Field["type"]> = { created_at: "datetime", updated_at: "datetime", docstatus: "int", version: "int" };

function toColumn(byName: Map<string, Field>, n: string): Column {
  const f = byName.get(n);
  return {
    name: n,
    label: f?.label ?? SYSTEM_FIELD_LABELS[n] ?? humanize(n),
    field: f ?? { name: n, type: SYSTEM_TYPES[n] ?? "data" },
    sortable: f ? f.storage === "column" : n !== "id",
  };
}

/** The entity's columns: `list.columns` (else `in_list` fields) the viewer can read, with the status. */
export function defaultColumns(meta: EntityMeta): string[] {
  const byName = new Map(meta.fields.map((f) => [f.name, f]));
  const readable = (n: string) => {
    const f = byName.get(n);
    return f ? f.can_read === true && !f.hidden && f.type !== "table" : n in SYSTEM_FIELD_LABELS;
  };
  const names = meta.list.columns.length
    ? [...meta.list.columns]
    : [...(meta.numbering ? ["number"] : []), ...meta.fields.filter((f) => f.in_list).map((f) => f.name)];
  // Tenant custom fields marked "in list" appear even when the package defines explicit columns.
  for (const f of meta.fields) if (f.name.startsWith("x_") && f.in_list && !names.includes(f.name)) names.push(f.name);
  let cols = names.filter(readable);
  if (!cols.length) cols = [meta.title_field && readable(meta.title_field) ? meta.title_field : "id"];
  if (meta.workflow && !cols.includes("workflow_state")) cols.push("workflow_state");
  if (meta.submittable && !cols.includes("status") && !cols.includes("docstatus")) cols.push("docstatus");
  return cols;
}

/** Every column the viewer may show: the defaults, readable fields (not tables) and system fields. */
export function columnChoices(meta: EntityMeta): Column[] {
  const byName = new Map(meta.fields.map((f) => [f.name, f]));
  const names = new Set(defaultColumns(meta));
  for (const f of meta.fields) if (f.can_read === true && !f.hidden && f.type !== "table") names.add(f.name);
  if (meta.numbering) names.add("number");
  if (meta.submittable) names.add("docstatus");
  if (meta.workflow) names.add("workflow_state");
  names.add("created_at");
  names.add("updated_at");
  return [...names].map((n) => toColumn(byName, n));
}

/** The columns to show: the stored choice, minus what the viewer can no longer see; else the defaults. */
export function resolveColumns(meta: EntityMeta, stored: string[] | undefined): Column[] {
  const choices = new Map(columnChoices(meta).map((c) => [c.name, c]));
  const picked = [...new Set(stored ?? [])].filter((n) => choices.has(n));
  return (picked.length ? picked : defaultColumns(meta)).map((n) => choices.get(n)!);
}

/** `sort` ("field asc|desc") when the viewer may sort by that field, else undefined. */
export function validSort(meta: EntityMeta, sort: string | undefined): string | undefined {
  const m = /^(\w+) (asc|desc)$/.exec(sort ?? "");
  return m && columnChoices(meta).some((c) => c.name === m[1] && c.sortable) ? sort : undefined;
}

// ── stored settings ──

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);

function widthsOf(v: unknown): Record<string, number> | undefined {
  if (!isPlain(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, w] of Object.entries(v)) if (typeof w === "number" && Number.isFinite(w)) out[k] = clampWidth(w);
  return Object.keys(out).length ? out : undefined;
}

function queryOfObject(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isPlain(v)) for (const [k, x] of Object.entries(v)) if (isQueryParam(k) && typeof x === "string" && x !== "") out[k] = x;
  return out;
}

/** The stored preference, checked: anything malformed (an old or damaged value) is dropped. */
export function readPrefs(raw: unknown): ListPrefs {
  const r = isPlain(raw) ? raw : {};
  const views: Record<string, SavedView> = {};
  if (isPlain(r.views))
    for (const [id, v] of Object.entries(r.views)) {
      if (!isPlain(v) || typeof v.name !== "string" || !v.name.trim()) continue;
      views[id] = { id, name: v.name.trim(), query: queryOfObject(v.query), columns: names(v.columns), widths: widthsOf(v.widths) };
    }
  return {
    columns: names(r.columns),
    widths: widthsOf(r.widths),
    sort: typeof r.sort === "string" ? r.sort : undefined,
    views,
    default_view: typeof r.default_view === "string" && views[r.default_view] ? r.default_view : undefined,
  };
}

/** The layout in use: the view `viewId`'s, else the personal one. */
export const layoutOf = (p: ListPrefs, viewId: string | null): Layout => (viewId ? p.views[viewId] : undefined) ?? p;

/** `widths` with `name` set to `width` (undefined: automatic); undefined when none is left. */
export function withWidth(widths: Record<string, number> | undefined, name: string, width: number | undefined): Record<string, number> | undefined {
  const next = { ...widths };
  if (width === undefined) delete next[name];
  else next[name] = clampWidth(width);
  return Object.keys(next).length ? next : undefined;
}

/** `p` with `patch` applied to the layout in use: the view `viewId`, else the personal one. */
export function withLayout(p: ListPrefs, viewId: string | null, patch: Layout): ListPrefs {
  const view = viewId ? p.views[viewId] : undefined;
  if (viewId && !view) return p;
  return view ? { ...p, views: { ...p.views, [view.id]: { ...view, ...patch } } } : { ...p, ...patch };
}

export function withoutView(p: ListPrefs, id: string): ListPrefs {
  const views = { ...p.views };
  delete views[id];
  return { ...p, views, default_view: p.default_view === id ? undefined : p.default_view };
}

export const sortedViews = (views: Record<string, SavedView>) => Object.values(views).sort((a, b) => a.name.localeCompare(b.name));

export const newViewId = () => newKey().replace(/-/g, "").slice(0, 12);

/** Why `name` cannot name a view (empty, too long, taken), or null. */
export function viewNameError(name: string, views: Record<string, SavedView>, exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return "Enter a name.";
  if (n.length > 60) return "Use at most 60 characters.";
  const taken = Object.values(views).some((v) => v.id !== exceptId && v.name.toLowerCase() === n.toLowerCase());
  return taken ? `You already have a view named “${n}”.` : null;
}

// ── the list's URL state ──

const QUERY_PARAMS = new Set(["q", "sort", "view", "by"]);
export const isQueryParam = (k: string) => k.startsWith("f.") || QUERY_PARAMS.has(k);

/** The query part of the list's URL: filters, search, sort and view kind. */
export function queryOf(sp: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (isQueryParam(k) && v !== "") out[k] = v;
  });
  return out;
}

export function sameQuery(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** The URL showing `view` (null: the standard view, unfiltered), other parameters kept. */
export function applyView(sp: URLSearchParams, view: SavedView | null): URLSearchParams {
  const next = new URLSearchParams();
  sp.forEach((v, k) => {
    if (!isQueryParam(k) && k !== VIEW_PARAM) next.append(k, v);
  });
  if (view) {
    for (const [k, v] of Object.entries(view.query)) next.set(k, v);
    next.set(VIEW_PARAM, view.id);
  }
  return next;
}
