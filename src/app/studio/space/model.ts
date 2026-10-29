// Spaces (module home pages): the pure logic behind the view and the editor. What each block type
// is and starts as, what a block saves as (the server refuses unknown keys and checks every block on
// save), the same checks run before sending, links into the app, responsive widths, starter spaces,
// filter values, the editor's undo history and the rebase after someone else saved first.

import { humanize } from "@/lib/format";
import type { EntitySummary, Module } from "@/lib/meta";
import {
  filterList,
  isSafeColor,
  type Block,
  type FilterOp,
  type Filters,
  type Issue,
  type LinkItem,
  type ListBlock,
  type OnboardingStep,
  type ResolvedWidget,
  type Sharing,
  type SpaceBlock,
  type ShortcutBlock,
  type SpaceRecord,
  type SpecFilter,
} from "@/lib/studio";

export type BlockType = Block["type"];

export const BLOCK_KINDS: Record<BlockType, { label: string; hint: string; width: number }> = {
  shortcut: { label: "Shortcut", hint: "Opens a list, report, dashboard or page; a list can show a live count", width: 3 },
  card: { label: "Number card", hint: "One number and its change since the previous period", width: 3 },
  chart: { label: "Chart", hint: "A saved chart", width: 6 },
  list: { label: "Quick list", hint: "The latest records of a list", width: 6 },
  links: { label: "Link card", hint: "A card of links to lists, reports, dashboards and pages", width: 4 },
  onboarding: { label: "Onboarding", hint: "Getting-started steps that tick themselves off", width: 6 },
  heading: { label: "Heading", hint: "A section title", width: 12 },
  markdown: { label: "Text", hint: "Notes and instructions, with Markdown formatting", width: 12 },
};
/** In the order the add-block menu offers them. */
export const BLOCK_TYPES = Object.keys(BLOCK_KINDS) as BlockType[];

// ───────────────────────────── widths ─────────────────────────────

export const WIDTHS = [
  { value: 3, label: "Quarter" },
  { value: 4, label: "Third" },
  { value: 6, label: "Half" },
  { value: 8, label: "Two thirds" },
  { value: 9, label: "Three quarters" },
  { value: 12, label: "Full width" },
];

const clampWidth = (w: number) => Math.min(12, Math.max(1, Math.round(w) || 12));

/** Columns of 12 the block takes on a wide screen: its own width, else its type's. */
export const widthOf = (b: { type: BlockType; width?: number | null }) => clampWidth(b.width ?? BLOCK_KINDS[b.type].width);

export const widthLabel = (w: number) => WIDTHS.find((x) => x.value === w)?.label ?? `${w} of 12 columns`;

// Written out so Tailwind finds them. The grid answers to its container, not the window, so a space
// looks the same in the editor's narrower canvas and on a module's home.
const WIDE = [
  "@4xl:col-span-1", "@4xl:col-span-2", "@4xl:col-span-3", "@4xl:col-span-4", "@4xl:col-span-5", "@4xl:col-span-6",
  "@4xl:col-span-7", "@4xl:col-span-8", "@4xl:col-span-9", "@4xl:col-span-10", "@4xl:col-span-11", "@4xl:col-span-12",
];

/** Grid classes: small blocks pair up on phones and sit three a row on tablets; wide containers follow the width. */
export function spanClass(width: number): string {
  const w = clampWidth(width);
  const narrow = w <= 3 ? "col-span-6" : "col-span-12";
  const medium = w <= 3 ? "@xl:col-span-4" : w <= 6 ? "@xl:col-span-6" : "@xl:col-span-12";
  return `${narrow} ${medium} ${WIDE[w - 1]}`;
}

// ───────────────────────────── targets ─────────────────────────────

export const SHORTCUT_TARGETS = ["entity", "report", "dashboard", "url"] as const;
export const LINK_TARGETS = ["entity", "report", "dashboard", "builtin", "url"] as const;
export type LinkTarget = (typeof LINK_TARGETS)[number];

export const TARGET_LABEL: Record<LinkTarget, string> = {
  entity: "List",
  report: "Saved report",
  dashboard: "Dashboard",
  builtin: "Built-in report",
  url: "Address",
};

/** What a shortcut or link opens: the first target set (`""` is chosen but not filled in yet). */
export function targetOf<K extends string>(o: Partial<Record<K, unknown>>, kinds: readonly K[]): K {
  return kinds.find((k) => o[k] !== undefined && o[k] !== null) ?? kinds[0];
}

/** The same shortcut or link pointing at another kind of target, not yet chosen. */
export function retarget<T extends object>(o: T, kinds: readonly string[], kind: string): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of kinds) delete out[k];
  out[kind] = "";
  return out as T;
}

// ───────────────────────────── saving ─────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const chars = (s: string) => [...s].length;

/** Text values are kept as typed while editing (spaces included) and trimmed when saved; `contains` patterns inside their `%`. */
const trimValue = (v: unknown) => (typeof v !== "string" ? v : /^%.*%$/s.test(v) ? `%${v.slice(1, -1).trim()}%` : v.trim());

/** Filters in list form, field paths and text values trimmed. */
export const cleanFilters = (f: Filters | null | undefined): SpecFilter[] => filterList(f).map(([p, op, v]) => [str(p), op, trimValue(v)]);

function cleanLink(l: LinkItem): LinkItem {
  const kind = targetOf(l, LINK_TARGETS);
  const value = str(l[kind]);
  return value ? { label: str(l.label), [kind]: value } : { label: str(l.label) };
}

function cleanStep(s: OnboardingStep): OnboardingStep {
  const out: OnboardingStep = { label: str(s.label) };
  if (str(s.description)) out.description = str(s.description);
  if (str(s.entity)) {
    out.entity = str(s.entity);
    const f = cleanFilters(s.filters);
    if (f.length) out.filters = f;
  }
  if (str(s.url)) out.url = str(s.url);
  return out;
}

/**
 * A block as it is saved: trimmed, without empty settings, and without what does not apply to its
 * target (filters and counts belong to list shortcuts). The server refuses unknown keys, so editor
 * state never leaks into it.
 */
export function cleanBlock(b: SpaceBlock): SpaceBlock {
  const width = typeof b.width === "number" ? { width: b.width } : {};
  switch (b.type) {
    case "shortcut": {
      const kind = targetOf(b, SHORTCUT_TARGETS);
      const value = str(b[kind]);
      const out: ShortcutBlock = { type: "shortcut", label: str(b.label), ...(value ? { [kind]: value } : {}) };
      if (kind === "entity") {
        const f = cleanFilters(b.filters);
        if (f.length) out.filters = f;
        if (b.show_count) out.show_count = true;
      }
      if (str(b.color)) out.color = str(b.color);
      return { ...out, ...width };
    }
    case "links":
      return { type: "links", label: str(b.label), items: b.items.map(cleanLink), ...width };
    case "chart":
      return { type: "chart", chart: str(b.chart), ...width };
    case "card":
      return { type: "card", card: str(b.card), ...width };
    case "list": {
      const out: ListBlock = { type: "list", entity: str(b.entity) };
      if (str(b.label)) out.label = str(b.label);
      const f = cleanFilters(b.filters);
      if (f.length) out.filters = f;
      if (b.fields?.length) out.fields = [...b.fields];
      if (str(b.sort)) out.sort = str(b.sort);
      if (b.limit != null) out.limit = b.limit;
      return { ...out, ...width };
    }
    case "markdown":
      return { type: "markdown", content: (b.content ?? "").replace(/\s+$/, ""), ...width };
    case "heading":
      return { type: "heading", text: str(b.text), ...(b.level ? { level: b.level } : {}), ...width };
    case "onboarding":
      return { type: "onboarding", ...(str(b.title) ? { title: str(b.title) } : {}), steps: b.steps.map(cleanStep), ...width };
  }
}

/** The editor's starting point for a new block of a type. */
export function newBlock(type: BlockType): SpaceBlock {
  switch (type) {
    case "shortcut":
      return { type, label: "", entity: "", show_count: true };
    case "links":
      return { type, label: "", items: [{ label: "", entity: "" }] };
    case "chart":
      return { type, chart: "" };
    case "card":
      return { type, card: "" };
    case "list":
      return { type, entity: "", sort: "updated_at desc", limit: 5 };
    case "markdown":
      return { type, content: "" };
    case "heading":
      return { type, text: "", level: 2 };
    case "onboarding":
      return { type, title: "Get started", steps: [{ label: "", entity: "" }] };
  }
}

// ───────────────────────────── checks (the server's, before sending) ─────────────────────────────

/** The server's rule for addresses: an app path (`/app/...`) or an http(s) URL. */
export const urlOk = (u: string) => (u.startsWith("/") && !u.startsWith("//")) || u.startsWith("https://") || u.startsWith("http://");

const URL_HINT = "Use an app path such as /app/e/SalesInvoice, or an address starting with https://";
const labelOk = (l: unknown) => str(l) !== "" && chars(str(l)) <= 140;
const empty = (v: unknown) => {
  const t = trimValue(v);
  return t === undefined || t === null || t === "" || t === "%%" || (Array.isArray(t) && !t.length);
};

function filterIssues(f: Filters | null | undefined, path: string, add: (path: string, message: string) => void) {
  filterList(f).forEach(([field, op, value], i) => {
    if (!str(field)) add(`${path}[${i}]`, "Choose a field to filter on");
    else if (op !== "is" && empty(value)) add(`${path}[${i}]`, "Enter a value to filter by");
  });
}

/** Problems that would make the server refuse a block, at paths inside it (`label`, `items[0].url`). */
export function blockIssues(b: SpaceBlock): Issue[] {
  const out: Issue[] = [];
  const add = (path: string, message: string) => out.push({ path, message });
  if (b.width != null && (!Number.isInteger(b.width) || b.width < 1 || b.width > 12)) add("width", "A block is 1 to 12 columns wide");
  switch (b.type) {
    case "shortcut": {
      if (!labelOk(b.label)) add("label", "Give the shortcut a label (up to 140 characters)");
      const kind = targetOf(b, SHORTCUT_TARGETS);
      const value = str(b[kind]);
      const missing = { entity: "Choose the list it opens", report: "Choose a report", dashboard: "Choose a dashboard", url: "Enter the address it opens" };
      if (!value) add(kind, missing[kind]);
      else if (kind === "url" && !urlOk(value)) add("url", URL_HINT);
      if (kind === "entity") filterIssues(b.filters, "filters", add);
      if (str(b.color) && !isSafeColor(str(b.color))) add("color", "Use a color such as #2f5bea or teal");
      break;
    }
    case "links":
      if (!labelOk(b.label)) add("label", "Give the card a title (up to 140 characters)");
      if (!b.items.length || b.items.length > 50) add("items", "A link card holds 1 to 50 links");
      b.items.forEach((l, i) => {
        if (!labelOk(l.label)) add(`items[${i}].label`, "Give the link a label");
        const kind = targetOf(l, LINK_TARGETS);
        const value = str(l[kind]);
        if (!value) add(`items[${i}].${kind}`, "Choose where the link goes");
        else if (kind === "url" && !urlOk(value)) add(`items[${i}].url`, URL_HINT);
      });
      break;
    case "chart":
      if (!str(b.chart)) add("chart", "Choose a chart");
      break;
    case "card":
      if (!str(b.card)) add("card", "Choose a number card");
      break;
    case "list":
      if (!str(b.entity)) add("entity", "Choose the list to show");
      if ((b.fields?.length ?? 0) > 12) add("fields", "Show at most 12 fields");
      if (b.limit != null && (!Number.isInteger(b.limit) || b.limit < 1 || b.limit > 50)) add("limit", "Show 1 to 50 records");
      filterIssues(b.filters, "filters", add);
      break;
    case "markdown":
      if (chars(b.content ?? "") > 20_000) add("content", "Text is limited to 20,000 characters");
      break;
    case "heading":
      if (!str(b.text) || chars(str(b.text)) > 200) add("text", "Enter the heading (up to 200 characters)");
      if (b.level != null && ![1, 2, 3].includes(b.level)) add("level", "Choose a size");
      break;
    case "onboarding":
      if (!b.steps.length || b.steps.length > 20) add("steps", "Onboarding has 1 to 20 steps");
      b.steps.forEach((s, i) => {
        if (!labelOk(s.label)) add(`steps[${i}].label`, "Give the step a label");
        if (str(s.url) && !urlOk(str(s.url))) add(`steps[${i}].url`, URL_HINT);
        if (str(s.entity)) filterIssues(s.filters, `steps[${i}].filters`, add);
      });
      break;
  }
  return out;
}

/** Whether a block can be previewed: its target and other required settings are chosen. */
export const isComplete = (b: SpaceBlock) => !blockIssues(b).length;

// ───────────────────────────── the space being edited ─────────────────────────────

export interface EditorBlock {
  /** The editor's own id (drag and drop, focus); never saved. */
  key: string;
  block: SpaceBlock;
}

export interface SpaceDraft {
  label: string;
  icon: string;
  module: string;
  sequence: number;
  sharing: Sharing;
  roles: string[];
  description: string;
  blocks: EditorBlock[];
}

export const emptyDraft = (): SpaceDraft => ({ label: "", icon: "", module: "", sequence: 0, sharing: "private", roles: [], description: "", blocks: [] });

/** Settings the editor's filter rows edit in list form. */
function editable(b: SpaceBlock): SpaceBlock {
  if (b.type === "shortcut" || b.type === "list") return b.filters ? { ...b, filters: filterList(b.filters) } : b;
  if (b.type === "onboarding") return { ...b, steps: b.steps.map((s) => (s.filters ? { ...s, filters: filterList(s.filters) } : s)) };
  return b;
}

export function draftFromRecord(r: SpaceRecord, key: () => string): SpaceDraft {
  return {
    label: r.label ?? "",
    icon: r.icon ?? "",
    module: r.module ?? "",
    sequence: typeof r.sequence === "number" ? r.sequence : 0,
    sharing: r.sharing ?? "private",
    roles: (r.roles ?? []).map((x) => x.role).filter(Boolean),
    description: r.description ?? "",
    blocks: (Array.isArray(r.blocks) ? r.blocks : []).map((block) => ({ key: key(), block: editable(block) })),
  };
}

/** The record fields a save sends (roles are replaced as a whole; none unless shared with roles). */
export function recordBody(d: SpaceDraft): Pick<SpaceRecord, "label" | "icon" | "module" | "sequence" | "sharing" | "roles" | "description" | "blocks"> {
  return {
    label: d.label.trim(),
    icon: d.icon.trim() || null,
    module: d.module.trim() || null,
    sequence: Math.trunc(d.sequence) || 0,
    sharing: d.sharing,
    roles: d.sharing === "roles" ? [...new Set(d.roles.map((r) => r.trim()).filter(Boolean))].map((role) => ({ role })) : [],
    description: d.description.trim() || null,
    blocks: d.blocks.map((b) => cleanBlock(b.block)),
  };
}

/** Same content as saved (the editor's keys and untrimmed text aside). */
export const sameDraft = (a: SpaceDraft, b: SpaceDraft) => JSON.stringify(recordBody(a)) === JSON.stringify(recordBody(b));

/** Problems to fix before saving, at record paths (`label`, `blocks[2].items[0].url`). */
export function draftIssues(d: SpaceDraft): Issue[] {
  const out: Issue[] = [];
  if (!labelOk(d.label)) out.push({ path: "label", message: "Give the space a name (up to 140 characters)" });
  if (chars(d.icon.trim()) > 40) out.push({ path: "icon", message: "An icon name is up to 40 characters" });
  if (chars(d.module.trim()) > 63) out.push({ path: "module", message: "A module name is up to 63 characters" });
  if (!Number.isInteger(d.sequence)) out.push({ path: "sequence", message: "Use a whole number" });
  if (d.sharing === "roles" && !d.roles.some((r) => r.trim())) out.push({ path: "roles", message: "Choose the roles to share with" });
  if (d.blocks.length > 100) out.push({ path: "blocks", message: "A space holds up to 100 blocks" });
  d.blocks.forEach((b, n) => {
    for (const i of blockIssues(b.block)) out.push({ path: `blocks[${n}]${i.path.startsWith("[") ? "" : "."}${i.path}`, message: i.message });
  });
  return out;
}

/** Ids of the saved records a block shows or opens. */
export function refsOf(b: SpaceBlock): string[] {
  switch (b.type) {
    case "shortcut":
      return [b.report, b.dashboard].filter((x): x is string => !!x);
    case "links":
      return b.items.flatMap((l) => [l.report, l.dashboard].filter((x): x is string => !!x));
    case "chart":
      return [b.chart];
    case "card":
      return [b.card];
    default:
      return [];
  }
}

/**
 * The server's errors placed on blocks: `blocks[3]` stays, and "Dashboard Chart not found: <ids>"
 * (deleted, or not shared with whoever saves) moves to the blocks that show those records.
 */
export function placeIssues(issues: Issue[], blocks: SpaceBlock[]): Issue[] {
  return issues.flatMap((i) => {
    const m = i.path === "blocks" ? /^(.+?) not found: (.+)$/i.exec(i.message) : null;
    if (!m) return [i];
    const ids = m[2].split(",").map((s) => s.trim());
    const placed = blocks.flatMap((b, n) =>
      refsOf(b).some((id) => ids.includes(id)) ? [{ path: `blocks[${n}]`, message: `${m[1]} not found: it was deleted, or it is not shared with you` }] : [],
    );
    return placed.length ? placed : [i];
  });
}

/** Issues of one block, at paths inside it (from record paths such as `blocks[2].label`). */
export function blockIssuesAt(issues: Issue[], n: number): Issue[] {
  const prefix = `blocks[${n}]`;
  return issues
    .filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`) || i.path.startsWith(`${prefix}[`))
    .map((i) => ({ path: i.path.slice(prefix.length).replace(/^\./, ""), message: i.message }));
}

/** A name for a block in the editor and to screen readers: "Shortcut: Unpaid invoices". */
export function blockTitle(b: SpaceBlock, names: { entity?: (name: string) => string | undefined; record?: (id: string) => string | undefined } = {}): string {
  const kind = BLOCK_KINDS[b.type].label;
  const entity = (e: unknown) => (str(e) ? (names.entity?.(str(e)) ?? humanize(str(e))) : "");
  const name =
    b.type === "shortcut" || b.type === "links"
      ? str(b.label)
      : b.type === "heading"
        ? str(b.text)
        : b.type === "list"
          ? str(b.label) || entity(b.entity)
          : b.type === "onboarding"
            ? str(b.title)
            : b.type === "chart"
              ? (names.record?.(b.chart) ?? "")
              : b.type === "card"
                ? (names.record?.(b.card) ?? "")
                : "";
  return name ? `${kind}: ${name}` : kind;
}

// ───────────────────────────── links into the app ─────────────────────────────

/** App routes (relative to `/app/`) the blocks open. */
export const PATHS = {
  spaces: "/studio/spaces",
  newSpace: "/studio/spaces/new",
  space: (id: string) => `/studio/spaces/${encodeURIComponent(id)}`,
  editSpace: (id: string) => `/studio/spaces/${encodeURIComponent(id)}/edit`,
  copySpace: (id: string) => `/studio/spaces/new?from=${encodeURIComponent(id)}`,
  report: (id: string) => `/studio/reports/${encodeURIComponent(id)}`,
  dashboard: (id: string) => `/studio/dashboards/${encodeURIComponent(id)}`,
  chart: (id: string) => `/studio/charts/${encodeURIComponent(id)}`,
  card: (id: string) => `/studio/cards/${encodeURIComponent(id)}`,
  builtin: (name: string) => `/r/${encodeURIComponent(name)}`,
  list: (entity: string) => `/e/${encodeURIComponent(entity)}`,
  newRecord: (entity: string) => `/e/${encodeURIComponent(entity)}/new`,
  record: (entity: string, id: string) => `/e/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
};

/** Where a link goes: a route inside the app, or a page outside it (`external` opens a new tab). */
export type Target = { to: string } | { href: string; external: boolean };

/** An address as a link: `/app/...` and same-site app URLs stay in the app, other paths load the page, anything else is external. */
export function urlTarget(url: string, origin = typeof location === "undefined" ? "" : location.origin): Target {
  const u = url.trim();
  const inApp = (path: string, rest: string) => {
    const tail = path.slice(4) + rest;
    return { to: tail.startsWith("/") ? tail : `/${tail}` };
  };
  if (u.startsWith("/") && !u.startsWith("//")) {
    const [path] = u.split(/[?#]/, 1);
    return path === "/app" || path.startsWith("/app/") ? inApp(path, u.slice(path.length)) : { href: u, external: false };
  }
  try {
    const p = new URL(u);
    if (origin && p.origin === origin && (p.pathname === "/app" || p.pathname.startsWith("/app/"))) return inApp(p.pathname, p.search + p.hash);
  } catch {
    // not a URL: shown as given
  }
  return { href: u, external: true };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/**
 * A list route showing what the filters select. Equality and date ranges on fields become the
 * list's own filters (`f.status=Unpaid`, `f.posting_date=2026-10-01..2026-10-31`); when others
 * remain, the whole set also rides along as `filters` JSON.
 */
export function listHref(entity: string, filters?: Filters | null): string {
  const sp = new URLSearchParams();
  const ranges = new Map<string, [string, string]>();
  let rest = false;
  for (const [path, op, value] of filterList(filters)) {
    const top = !path.includes(".") && !path.startsWith("_");
    const day = typeof value === "string" && ISO_DAY.test(value) ? value.slice(0, 10) : null;
    if (top && op === "=" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      sp.set(`f.${path}`, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
    } else if (top && day && (op === ">=" || op === "<=")) {
      const r = ranges.get(path) ?? ["", ""];
      r[op === ">=" ? 0 : 1] = day;
      ranges.set(path, r);
    } else if (top && op === "between" && Array.isArray(value) && value.every((v) => typeof v === "string" && ISO_DAY.test(v)) && value.length === 2) {
      ranges.set(path, [String(value[0]).slice(0, 10), String(value[1]).slice(0, 10)]);
    } else rest = true;
  }
  for (const [path, [from, to]] of ranges) sp.set(`f.${path}`, `${from}..${to}`);
  if (rest) sp.set("filters", JSON.stringify(filterList(filters)));
  const q = sp.toString();
  return PATHS.list(entity) + (q ? `?${q}` : "");
}

/** Entities a resolved space shows, for live refreshes. */
export function widgetEntities(widgets: ResolvedWidget[]): string[] {
  const out = new Set<string>();
  const add = (e: string | null | undefined) => e && out.add(e);
  for (const w of widgets) {
    switch (w.type) {
      case "shortcut":
        add(w.entity);
        break;
      case "list":
        add(w.entity);
        break;
      case "onboarding":
        w.steps.forEach((s) => add(s.entity));
        break;
      case "chart":
        if (!w.error) add(w.chart.base_entity);
        break;
      case "card":
        if (!w.error) add(w.card.base_entity);
        break;
    }
  }
  return [...out].sort();
}

// ───────────────────────────── starter spaces ─────────────────────────────

/**
 * A first draft of a module's space: count shortcuts for its main documents, a card of its other
 * lists, one of its reports, and the latest records of its first document.
 */
export function starterSpace(module: Module, readable: EntitySummary[], reports: { name: string; label: string }[] = []): Omit<SpaceDraft, "blocks" | "sequence" | "sharing" | "roles" | "description"> & { blocks: SpaceBlock[] } {
  const byName = new Map(readable.map((e) => [e.name, e]));
  const lists = [...new Set(module.items)].flatMap((i) => byName.get(i) ?? []).filter((e) => e.kind !== "child" && e.kind !== "ledger");
  const docs = lists.filter((e) => e.kind === "document");
  const counted = (docs.length ? docs : lists).slice(0, 4);
  const others = lists.filter((e) => !counted.includes(e));
  const labels = new Map(reports.map((r) => [r.name, r.label]));
  const builtins = module.items.filter((i) => i.startsWith("report:")).map((i) => i.slice(7));
  const blocks: SpaceBlock[] = counted.map((e) => ({ type: "shortcut", label: e.label_plural, entity: e.name, show_count: true }));
  if (others.length) blocks.push({ type: "links", label: "Lists", items: others.slice(0, 50).map((e) => ({ label: e.label_plural, entity: e.name })) });
  if (builtins.length) blocks.push({ type: "links", label: "Reports", items: builtins.slice(0, 50).map((n) => ({ label: labels.get(n) ?? humanize(n), builtin: n })) });
  const recent = docs[0] ?? lists[0];
  if (recent) blocks.push({ type: "list", label: `Recent ${recent.label_plural.toLowerCase()}`, entity: recent.name, sort: "updated_at desc", limit: 5 });
  return { label: module.label, icon: module.icon ?? "", module: module.name, blocks };
}

// ───────────────────────────── filters ─────────────────────────────

export type FilterKind = "text" | "number" | "date" | "datetime" | "select" | "check" | "link";

export function filterKind(type: string): FilterKind {
  if (["int", "decimal", "currency", "percent"].includes(type)) return "number";
  if (type === "date" || type === "datetime" || type === "select" || type === "check" || type === "link") return type;
  return "text";
}

export const OPS: Record<FilterKind, FilterOp[]> = {
  text: ["=", "!=", "like", "not like", "is"],
  number: ["=", "!=", ">", ">=", "<", "<=", "is"],
  date: ["=", ">=", "<=", ">", "<", "is"],
  datetime: [">=", "<=", "is"],
  select: ["=", "!=", "in", "not in", "is"],
  check: ["="],
  link: ["=", "!=", "is"],
};

export function opLabel(op: FilterOp, kind: FilterKind): string {
  const dated = kind === "date" || kind === "datetime";
  const labels: Partial<Record<FilterOp, string>> = {
    "=": "is",
    "!=": "is not",
    ">": dated ? "after" : "more than",
    ">=": dated ? "on or after" : "at least",
    "<": dated ? "before" : "less than",
    "<=": dated ? "on or before" : "at most",
    like: "contains",
    "not like": "does not contain",
    in: "is any of",
    "not in": "is none of",
    is: "is set or not",
  };
  return labels[op] ?? op;
}

/** The value a filter row starts with when its field or operator changes. */
export function initialValue(kind: FilterKind, op: FilterOp): unknown {
  if (op === "is") return "set";
  if (op === "in" || op === "not in") return [];
  return kind === "check" ? true : "";
}

/**
 * What was typed for a filter value, as the API wants it: whole numbers as numbers, decimals as
 * exact strings, `contains` as a pattern, date-times as instants. Text stays as typed (saving trims it).
 */
export function filterValue(type: string, op: FilterOp, raw: string): unknown {
  const t = raw.trim();
  if (op === "like" || op === "not like") return raw ? `%${raw}%` : "";
  if (type === "int") return /^-?\d+$/.test(t) && Number.isSafeInteger(Number(t)) ? Number(t) : raw;
  if (type === "datetime" && /^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T${op === "<=" || op === "<" ? "23:59:59.999" : "00:00:00.000"}Z`;
  return raw;
}

/** A saved filter value as the text its input shows. */
export function filterInput(type: string, op: FilterOp, value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (op === "like" || op === "not like") return s.replace(/^%/, "").replace(/%$/, "");
  if (type === "datetime" && ISO_DAY.test(s)) return s.slice(0, 10);
  return s;
}

// ───────────────────────────── undo history ─────────────────────────────

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** The last edit's tag and time: typing into one field within a moment is one step. */
  tag?: string;
  at: number;
}

const DEPTH = 100;
const COALESCE_MS = 1500;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], at: 0 });

export function commit<T>(h: History<T>, next: T, tag?: string, now = Date.now()): History<T> {
  if (Object.is(next, h.present)) return h;
  if (tag && tag === h.tag && now - h.at < COALESCE_MS) return { ...h, present: next, future: [], at: now };
  return { past: [...h.past, h.present].slice(-DEPTH), present: next, future: [], tag, at: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], at: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), at: 0 };
}

// ───────────────────────────── rebase after a conflict ─────────────────────────────

type Part = { label: string; get: (d: SpaceDraft) => unknown; take: (into: SpaceDraft, from: SpaceDraft) => SpaceDraft };

const PARTS: Part[] = [
  { label: "Name", get: (d) => d.label.trim(), take: (into, from) => ({ ...into, label: from.label }) },
  { label: "Icon", get: (d) => d.icon.trim(), take: (into, from) => ({ ...into, icon: from.icon }) },
  { label: "Module", get: (d) => d.module.trim(), take: (into, from) => ({ ...into, module: from.module }) },
  { label: "Order", get: (d) => d.sequence, take: (into, from) => ({ ...into, sequence: from.sequence }) },
  {
    label: "Audience",
    get: (d) => [d.sharing, d.sharing === "roles" ? [...new Set(d.roles.map((r) => r.trim()))].sort() : []],
    take: (into, from) => ({ ...into, sharing: from.sharing, roles: from.roles }),
  },
  { label: "Description", get: (d) => d.description.trim(), take: (into, from) => ({ ...into, description: from.description }) },
  { label: "Blocks", get: (d) => d.blocks.map((b) => cleanBlock(b.block)), take: (into, from) => ({ ...into, blocks: from.blocks }) },
];

/**
 * Replays my edits on top of a version someone else saved: what I did not change comes from
 * theirs, what they did not change stays mine. When both changed a part differently mine is kept
 * and the part is reported, so I can review it before saving again.
 */
export function rebase(base: SpaceDraft, mine: SpaceDraft, theirs: SpaceDraft): { merged: SpaceDraft; conflicts: string[] } {
  let merged = mine;
  const conflicts: string[] = [];
  for (const p of PARTS) {
    const [b, m, t] = [base, mine, theirs].map((d) => JSON.stringify(p.get(d)));
    if (m === b) merged = p.take(merged, theirs);
    else if (t !== b && t !== m) conflicts.push(p.label);
  }
  return { merged, conflicts };
}
