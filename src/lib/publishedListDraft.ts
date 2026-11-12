// A published list (Customize → Lists) as the screen edits it: the `publish_list` customization's list as a draft, and
// back. A list has a fixed set of properties, so the draft starts from those only: anything else the server sends is
// dropped, as the server refuses definitions with properties it does not know. What the list shows is public, to anyone
// without signing in: the screen offers only the fields the server would accept; the server's refusal on save stays the
// final word (it knows what a package declares as personal data).

import { t as tr } from "@ferrum/client";
import { MAX_FILTERS, newKey, type FilterRow } from "./automationDraft";
import type { Field, EntityMeta } from "./meta";

export type Raw = Record<string, unknown>;

export const MAX_FIELDS = 12;
export const MAX_LISTS = 20;
export const MAX_LIMIT = 1000;

/** A list as `publish_list` takes it. */
export interface ListDef {
  name: string;
  label: string;
  description?: string;
  fields: string[];
  filter?: [string, string, unknown][];
  sort?: [string, "asc" | "desc"];
  csv?: boolean;
  limit?: number;
  /** A text field whose value is each record's public address: record pages, search, search engines (BD-25). */
  slug?: string;
  /** Fields only a record's page shows. */
  detail?: string[];
  /** The field a record page gives search engines as its description. */
  summary?: string;
  /** Sites that may frame its pages (`https://host[:port]`, at most 10). */
  frame_origins?: string[];
  /** A whole-number field counting each record page's visitors (BD-42). */
  count_views?: string;
  /** Whole-number fields counting "was this helpful" answers. */
  votes?: { up: string; down: string };
}

export interface ListDraft {
  saved: boolean;
  name: string;
  nameTouched: boolean;
  label: string;
  description: string;
  fields: string[];
  filters: FilterRow[];
  sortField: string;
  sortDir: "asc" | "desc";
  csv: boolean;
  /** Text, so a half-typed number is kept; blank: the server's default (200). */
  limit: string;
  slug: string;
  detail: string[];
  summary: string;
  /** One origin per line, as typed. */
  frameOrigins: string;
  countViews: string;
  votesUp: string;
  votesDown: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export const startList = (): ListDraft => ({ saved: false, name: "", nameTouched: false, label: "", description: "", fields: [], filters: [], sortField: "", sortDir: "asc", csv: false, limit: "", slug: "", detail: [], summary: "", frameOrigins: "", countViews: "", votesUp: "", votesDown: "" });

/** From the definition (the properties a list has, nothing else). */
export function fromList(raw: Raw): ListDraft {
  const filters: FilterRow[] = [];
  if (Array.isArray(raw.filter)) for (const f of raw.filter) if (Array.isArray(f) && f.length === 3 && typeof f[0] === "string" && typeof f[1] === "string") filters.push({ key: newKey(), field: f[0], op: f[1], value: f[2] });
  const sort = Array.isArray(raw.sort) && raw.sort.length === 2 ? raw.sort : null;
  return {
    saved: true, name: str(raw.name), nameTouched: true, label: str(raw.label), description: str(raw.description),
    fields: Array.isArray(raw.fields) ? raw.fields.filter((x): x is string => typeof x === "string") : [],
    filters, sortField: sort ? str(sort[0]) : "", sortDir: sort && sort[1] === "desc" ? "desc" : "asc",
    csv: raw.csv === true, limit: raw.limit === undefined ? "" : str(raw.limit),
    slug: str(raw.slug), detail: Array.isArray(raw.detail) ? raw.detail.filter((x): x is string => typeof x === "string") : [], summary: str(raw.summary),
    frameOrigins: Array.isArray(raw.frame_origins) ? raw.frame_origins.map(str).join("\n") : "", countViews: str(raw.count_views),
    votesUp: str((raw.votes as Raw | undefined)?.up), votesDown: str((raw.votes as Raw | undefined)?.down),
  };
}

/** The definition a draft comes to. */
export function toList(d: ListDraft): ListDef {
  const out: ListDef = { name: d.name.trim(), label: d.label.trim(), fields: d.fields };
  if (d.description.trim()) out.description = d.description.trim();
  if (d.filters.length) out.filter = d.filters.map((f) => [f.field, f.op, f.value]);
  if (d.sortField) out.sort = [d.sortField, d.sortDir];
  if (d.csv) out.csv = true;
  if (d.limit.trim()) out.limit = Number(d.limit);
  if (d.slug) out.slug = d.slug;
  if (d.detail.length) out.detail = d.detail;
  if (d.summary) out.summary = d.summary;
  const origins = originList(d.frameOrigins);
  if (origins.length) out.frame_origins = origins;
  if (d.countViews) out.count_views = d.countViews;
  if (d.votesUp || d.votesDown) out.votes = { up: d.votesUp, down: d.votesDown };
  return out;
}

/** Origins one to a line (or comma): trimmed, no empty one. */
export const originList = (text: string): string[] => text.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
/** `https://host[:port]`, nothing after it. */
export const ORIGIN_OK = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
export const MAX_ORIGINS = 10;
export const MAX_DETAIL = 12;

/** The address of a record's page, with a placeholder where its slug goes, and the sitemap of every published page. */
export const recordPath = (workspace: string, name: string) => `${publicPath(workspace, name)}/{${"slug"}}`;
export const sitemapPath = (workspace: string) => `/public/${encodeURIComponent(workspace)}/sitemap.xml`;

// ── the name ──

/** The name made from a label: lowercase letters, digits and single hyphens, at most 60. */
export const listName = (label: string) => label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
export const NAME_OK = /^[a-z0-9][a-z0-9-]*$/;

export function setLabel(d: ListDraft, label: string): ListDraft {
  return { ...d, label, name: d.saved || d.nameTouched ? d.name : listName(label) };
}

/** The public page of a list: its address from the site's root. */
export const publicPath = (slug: string, name: string) => `/public/${encodeURIComponent(slug)}/lists/${encodeURIComponent(name)}`;
export const listsLink = (entity: string) => `/customize/${encodeURIComponent(entity)}/lists`;

// ── which fields may be offered ──

export interface Offered { name: string; label: string }
export interface NotOffered extends Offered { why: string }

/** What the description may carry beyond the field's type: a permission group, never exported, declared personal data. */
type Marks = { group?: unknown; no_export?: unknown; personal_data?: unknown; personal?: unknown };

/** Why a field may not be published, in words; null when the browser knows no reason (the server may still refuse). */
export function whyNot(f: Field): string | null {
  const m = f as unknown as Marks;
  switch (f.type) {
    case "email": return tr("an email address");
    case "phone": return tr("a phone number");
    case "secret": return tr("a secret");
    case "attach": return tr("an attachment");
    case "table": return tr("lines of the record");
  }
  if (m.group) return tr("in a field group: only some people may read it");
  if (m.no_export) return tr("never exported");
  if (m.personal_data || m.personal) return tr("people’s personal data");
  return null;
}

/** The fields the form holds, in its order, then the rest; split into those that may be published and those that may not.
 *  `number` is offered first on a numbered entity. */
export function offering(meta: Pick<EntityMeta, "form" | "fields" | "numbering" | "kind">): { offered: Offered[]; unavailable: NotOffered[] } {
  const by = new Map(meta.fields.map((f) => [f.name, f]));
  const order = [...new Set([...meta.form.flatMap((s) => s.fields), ...meta.fields.map((f) => f.name)])].filter((n) => by.has(n));
  const offered: Offered[] = meta.numbering ? [{ name: "number", label: tr("Number") }] : [];
  const unavailable: NotOffered[] = [];
  for (const n of order) {
    const f = by.get(n)!;
    const why = whyNot(f);
    if (why) unavailable.push({ name: n, label: f.label || n, why });
    else offered.push({ name: n, label: f.label || n });
  }
  return { offered, unavailable };
}

// ── checking ──

export interface CheckContext {
  /** The names of the entity's other lists. */
  taken: string[];
  offered: Offered[];
  /** The fields a filter or the order may use. */
  fields: Pick<Field, "name" | "label">[];
}

export function checkList(d: ListDraft, c: CheckContext): string[] {
  const out: string[] = [];
  const say = (m: string) => out.push(m);
  if (!d.label.trim()) say(tr("Give the list a label."));
  if (!NAME_OK.test(d.name.trim())) say(tr("The name may hold lowercase letters, digits and hyphens, and starts with a letter or digit."));
  else if (d.name.length > 60) say(tr("The name may be at most 60 characters."));
  else if (c.taken.includes(d.name.trim())) say(tr("Another list of this entity already has the name {name}.", { name: d.name.trim() }));
  if (!d.fields.length) say(tr("Tick at least one field to show."));
  if (d.fields.length > MAX_FIELDS) say(tr("Show at most {n} fields.", { n: MAX_FIELDS }));
  const gone = d.fields.filter((n) => !c.offered.some((o) => o.name === n));
  if (gone.length) say(tr("These fields can no longer be published: {names}. Untick them.", { names: gone.join(", ") }));
  if (d.filters.length > MAX_FILTERS) say(tr("Use at most {n} filter rows.", { n: MAX_FILTERS }));
  const isOffered = (n: string) => c.offered.some((o) => o.name === n);
  const intField = (n: string) => c.fields.some((f) => f.name === n && (f as { type?: string }).type === "int");
  if (d.slug && !c.fields.some((f) => f.name === d.slug && ["data", "text"].includes((f as { type?: string }).type ?? ""))) say(tr("The address of a record page comes from a text field of this entity."));
  if (d.slug && !isOffered(d.slug)) say(tr("The field {name} cannot be published, so it cannot be the address of a record page.", { name: d.slug }));
  if (d.detail.length > MAX_DETAIL) say(tr("A record page shows at most {n} more fields.", { n: MAX_DETAIL }));
  if (d.detail.some((n) => !isOffered(n))) say(tr("A field that cannot be published is among those only the record page shows. Untick it."));
  if (d.summary && !d.fields.includes(d.summary) && !d.detail.includes(d.summary)) say(tr("The summary is one of the fields shown, on the list or on the record page."));
  if ((d.detail.length || d.summary || d.countViews || d.votesUp || d.votesDown) && !d.slug) say(tr("Record pages need the address field: choose it first."));
  const origins = originList(d.frameOrigins);
  if (origins.length > MAX_ORIGINS) say(tr("At most {n} sites may frame the pages.", { n: MAX_ORIGINS }));
  const badOrigin = origins.find((o) => !ORIGIN_OK.test(o));
  if (badOrigin) say(tr("{origin} is not a site address: https://host, with a port if it has one, and nothing after it.", { origin: badOrigin }));
  if (d.countViews && !intField(d.countViews)) say(tr("Views are counted in a whole-number field."));
  if (!!d.votesUp !== !!d.votesDown) say(tr("Votes need two fields: one for helpful, one for not helpful."));
  if (d.votesUp && d.votesDown && (!intField(d.votesUp) || !intField(d.votesDown))) say(tr("Votes are counted in whole-number fields."));
  if (d.votesUp && d.votesUp === d.votesDown) say(tr("Helpful and not helpful need two different fields."));
  d.filters.forEach((f, i) => {
    const empty = f.value === "" || f.value === undefined || f.value === null || f.value === "%%";
    if (!f.field || (f.op !== "is" && empty)) say(tr("Finish filter row {n}, or remove it.", { n: i + 1 }));
  });
  if (d.sortField && !c.fields.some((f) => f.name === d.sortField) && !["number", "created_at", "updated_at"].includes(d.sortField)) say(tr("The order names a field this entity does not have."));
  if (d.limit.trim() && !(/^\d+$/.test(d.limit.trim()) && Number(d.limit) >= 1 && Number(d.limit) <= MAX_LIMIT)) say(tr("Show at most: a whole number from 1 to {n}.", { n: MAX_LIMIT }));
  return out;
}

// ── the batches ──

export const saveBatch = (entity: string, d: ListDraft, note = "") => [{ entity, op: { op: "publish_list", list: toList(d) } as Raw, ...(note ? { note } : {}) }];
export const takeDownBatch = (entity: string, name: string, note = "") => [{ entity, op: { op: "unpublish_list", name } as Raw, ...(note ? { note } : {}) }];

/** The newest active `publish_list` of each name that no later change replaced, as the customization list carries them. */
export function currentLists(rows: { entity: string; op: Raw; is_active: boolean; superseded_by?: string | null; seq?: number }[], entity: string): Raw[] {
  const out = new Map<string, { seq: number; list: Raw }>();
  for (const r of rows) {
    const list = r.op.op === "publish_list" ? (r.op.list as Raw | undefined) : undefined;
    if (!list || r.entity !== entity || !r.is_active || r.superseded_by) continue;
    const name = str(list.name);
    const seq = r.seq ?? 0;
    if (!out.has(name) || seq > out.get(name)!.seq) out.set(name, { seq, list });
  }
  return [...out.values()].map((v) => v.list);
}
