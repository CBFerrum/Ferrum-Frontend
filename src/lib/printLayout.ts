// A print format's layout (docs: uikit/tools/PRINT-FORMATS-SPEC.md §4) as the designer edits it: the server's JSON itself,
// changed only by the pure functions below (insert, move, remove, update, duplicate, columns), so the canvas is a view of it
// and every change can be undone. `validate` says in words what the server would refuse (§4.2), naming the block, before a
// save is sent. The types mirror the platform's (`layout.rs`, `deny_unknown_fields`): add nothing they do not have.
// Also here, because the dialog, the list, the template editor and the designer share them: the print format itself
// (a page `DocumentDef`, §3.1), the field catalogue (§6.2), the dialog's choices (§6.1) and the template error parser (§6).

import { t as tr } from "@ferrum/client";

// ── the layout (§4.1) ──

export type Id = string;
export type Hex = string;
export type Size = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
export type Space = 0 | 1 | 2 | 3 | 4 | 6 | 8;
export type Align = "start" | "center" | "end";
export type Path = string;
export type Value = Path | Path[];
export type Cel = string;

export const SIZES: Size[] = ["xs", "sm", "md", "lg", "xl", "2xl"];
export const SIZE_PT: Record<Size, number> = { xs: 8, sm: 9, md: 10.5, lg: 12, xl: 14, "2xl": 18 };
export const SPACES: Space[] = [0, 1, 2, 3, 4, 6, 8];
export const LINE_HEIGHTS = [1.2, 1.3, 1.45, 1.6] as const;
export const FORMAT_AS = ["auto", "text", "multiline", "number", "amount", "percent", "date", "datetime", "words", "check"] as const;

export interface Format {
  as?: (typeof FORMAT_AS)[number];
  decimals?: number;
  show?: "symbol" | "code" | "none";
  date?: "short" | "long";
  currency?: string;
}

export interface Layout {
  version: 1;
  style?: { font?: "sans" | "serif" | "mono"; size?: Size; color?: Hex; accent?: Hex; line_height?: (typeof LINE_HEIGHTS)[number] };
  watermark?: { text: string; when?: Cel };
  sections: Section[];
  texts?: Record<string, Record<string, string>>;
}

export interface Section {
  id: Id;
  title?: string;
  columns: Column[];
  widths?: number[];
  gap_mm?: Space;
  border?: boolean;
  background?: Hex;
  padding_mm?: Space;
  keep_together?: boolean;
  break_before?: boolean;
  when?: Cel;
  /** Not in §4.1's Section type, but §4.5's worked example sets it on sections ("parties", "lines", "sums", "foot"). */
  margin_top_mm?: Space;
}
export interface Column { id: Id; blocks: Block[] }

interface Common { id: Id; when?: Cel; align?: Align; margin_top_mm?: Space }
export type ImageSrc = { file: string } | { value: Path };

export type FieldBlock = Common & { type: "field"; value: Value; label?: string | null; label_position?: "inline" | "above"; weight?: "normal" | "bold"; size?: Size; color?: Hex; format?: Format; hide_empty?: boolean };
export type HeadingBlock = Common & { type: "heading"; text: string; level?: 1 | 2 | 3; size?: Size; color?: Hex };
export type TextBlock = Common & { type: "text"; content: Paragraph[]; size?: Size; color?: Hex };
export type ImageBlock = Common & { type: "image"; src: ImageSrc; width_mm?: number; height_mm?: number; fit?: "contain" | "cover"; alt?: string };
export type TableBlock = Common & {
  type: "table"; value: Path; columns: TableColumn[]; header?: boolean; row_numbers?: boolean; borders?: "rows" | "all" | "none"; striped?: boolean; size?: Size;
  hide_zero_rows?: Path; totals?: Id[]; totals_label?: string; empty_text?: string; hide_empty?: boolean;
};
export type TotalsBlock = Common & { type: "totals"; rows: TotalRow[]; width_pct?: number };
export type SignatureBlock = Common & { type: "signature"; label: string; image?: ImageSrc; width_mm?: number; line?: boolean };
export type BarcodeBlock = Common & { type: "barcode"; value: Value; kind: "code128" | "ean13" | "qr"; height_mm?: number; show_text?: boolean };
export type CopyLabelBlock = Common & { type: "copy_label"; size?: Size; weight?: "normal" | "bold" };
export type DividerBlock = Common & { type: "divider"; thickness?: 1 | 2 | 3; style?: "solid" | "dashed"; color?: Hex };
export type SpacerBlock = Common & { type: "spacer"; height_mm: number };
export type PageBreakBlock = Common & { type: "page_break" };
export type Block = FieldBlock | HeadingBlock | TextBlock | ImageBlock | TableBlock | TotalsBlock | SignatureBlock | BarcodeBlock | CopyLabelBlock | DividerBlock | SpacerBlock | PageBreakBlock;
export type BlockType = Block["type"];

export interface TableColumn { id: Id; value: Value; label?: string; width_pct?: number; align?: Align; format?: Format; secondary?: Value; when?: Cel }
export interface TotalRow { label: string; value: Value; format?: Format; emphasis?: boolean; hide_zero?: boolean; when?: Cel }
export interface Paragraph { align?: Align; spans: Span[] }
export type Span = ({ t: string } | { v: Value; format?: Format }) & { b?: boolean; i?: boolean; u?: boolean };

/** Block types a letter head may hold (§3.3). */
export const LETTERHEAD_BLOCKS: BlockType[] = ["field", "text", "heading", "image", "divider", "spacer"];

// ── the print format (§3.1) ──

export type PaperSize = "A4" | "A5" | "A3" | "Letter" | "Legal" | "Custom";
export interface PageSetup { size: PaperSize; width_mm?: number; height_mm?: number; orientation: "portrait" | "landscape"; margin_mm: { top: number; right: number; bottom: number; left: number } }
export const PAPER_MM: Record<Exclude<PaperSize, "Custom">, [number, number]> = { A3: [297, 420], A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
export const DEFAULT_MARGINS = { top: 15, right: 12, bottom: 15, left: 12 };

/** A page `DocumentDef` (BD-21, extended). `kind` comes from the server and is not sent back. */
export interface PrintFormat {
  key: string;
  label?: string | null;
  entity: string;
  output: "page" | "text" | "csv" | "xml";
  default?: boolean;
  roles?: string[];
  values?: string[];
  languages?: Record<string, { body: string; header?: string | null; footer?: string | null }>;
  layout?: Layout;
  page?: PageSetup;
  letterhead?: string;
  enabled?: boolean;
  copies?: string[];
  based_on?: string | null;
  kind?: "template" | "layout";
  encoding?: string;
  crlf?: boolean;
}

export const kindOf = (f: Pick<PrintFormat, "layout" | "kind">) => f.kind ?? (f.layout ? "layout" : "template");

/** What is saved: the server derives `kind`; `default` is never sent; empty optional parts are left out as the server leaves them out. */
export function toSave(f: PrintFormat): PrintFormat {
  const out: PrintFormat = JSON.parse(JSON.stringify(f));
  delete out.kind;
  // The workspace's default is its own choice (D9, PUT …/defaults): a save never sends `default`, or saving a package's format
  // as read (default: true) would make it the workspace's default again (seen on the walk server).
  delete out.default;
  if (!out.roles?.length) delete out.roles;
  if (!out.copies?.length) delete out.copies;
  if (out.letterhead === "default") delete out.letterhead;
  if (out.enabled !== false) delete out.enabled;
  if (out.layout) delete out.languages;
  return out;
}

/** The paper in millimetres, turned for landscape. Unknown: A4. */
export function paperMm(page?: Pick<PageSetup, "size" | "width_mm" | "height_mm" | "orientation"> | null): { width: number; height: number } {
  const [w, h] = page?.size === "Custom" ? [page.width_mm ?? 210, page.height_mm ?? 297] : PAPER_MM[(page?.size ?? "A4") as keyof typeof PAPER_MM] ?? PAPER_MM.A4;
  return page?.orientation === "landscape" ? { width: h, height: w } : { width: w, height: h };
}

export const MM_PX = 96 / 25.4;

// ── the field catalogue (§6.2) ──

export interface CatField { path: Path; label: string; type?: string; to?: string; precision?: number; format?: string }
export interface Catalogue {
  entity: { name: string; label: string; submittable?: boolean };
  fields: CatField[];
  system: CatField[];
  tables: { path: Path; label: string; of: string; columns: CatField[] }[];
  links: { path: Path; field: string; to: string; label: string; fields: CatField[] }[];
  company?: CatField[];
  computed: CatField[];
  print: CatField[];
  settings: CatField[];
}

/** Every path a layout may name outside a table, with its catalogue entry. */
export function pathIndex(c: Catalogue): Map<Path, CatField> {
  const m = new Map<Path, CatField>();
  for (const f of [...c.fields, ...c.system, ...c.tables.map((t) => ({ path: t.path, label: t.label, type: "table" })), ...c.links.flatMap((l) => l.fields), ...(c.company ?? []), ...c.print, ...c.settings]) m.set(f.path, f);
  return m;
}

/** A field's label for a path (the catalogue's, else the path's last part). */
export function pathLabel(path: Path, c?: Catalogue | null): string {
  if (c) {
    const hit = pathIndex(c).get(path) ?? c.tables.flatMap((t) => t.columns).find((x) => x.path === path);
    if (hit) return hit.label;
  }
  const last = path.split(".").at(-1) ?? path;
  return last.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());
}

export const firstPath = (v: Value): Path => (Array.isArray(v) ? (v[0] ?? "") : v);
export const pathsOf = (v: Value | undefined): Path[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// ── finding things ──

export type Where =
  | { kind: "section"; s: number }
  | { kind: "column"; s: number; c: number }
  | { kind: "block"; s: number; c: number; b: number }
  | { kind: "tcol"; s: number; c: number; b: number; t: number };

export function locate(l: Layout, id: Id): Where | null {
  for (const [s, sec] of l.sections.entries()) {
    if (sec.id === id) return { kind: "section", s };
    for (const [c, col] of sec.columns.entries()) {
      if (col.id === id) return { kind: "column", s, c };
      for (const [b, blk] of col.blocks.entries()) {
        if (blk.id === id) return { kind: "block", s, c, b };
        if (blk.type === "table") for (const [t, tc] of blk.columns.entries()) if (tc.id === id) return { kind: "tcol", s, c, b, t };
      }
    }
  }
  return null;
}

export function nodeAt(l: Layout, w: Where): Section | Column | Block | TableColumn {
  const sec = l.sections[w.s];
  if (w.kind === "section") return sec;
  const col = sec.columns[w.c];
  if (w.kind === "column") return col;
  const blk = col.blocks[w.b];
  return w.kind === "block" ? blk : (blk as TableBlock).columns[w.t];
}

export const find = (l: Layout, id: Id) => {
  const w = locate(l, id);
  return w ? nodeAt(l, w) : null;
};

export function allIds(l: Layout): Id[] {
  const out: Id[] = [];
  for (const s of l.sections) {
    out.push(s.id);
    for (const c of s.columns) {
      out.push(c.id);
      for (const b of c.blocks) {
        out.push(b.id);
        if (b.type === "table") out.push(...b.columns.map((x) => x.id));
      }
    }
  }
  return out;
}

const ID = /^[a-z][a-z0-9_-]{0,39}$/;

/** An id no part of `l` (nor `taken`) has, made from `base`. */
export function freshId(l: Layout, base: string, taken: Set<string> = new Set()): Id {
  const used = new Set([...allIds(l), ...taken]);
  let stem = base.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/, "").slice(0, 34) || "b";
  if (!/^[a-z]/.test(stem)) stem = `b${stem}`;
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n++) if (!used.has(`${stem}_${n}`)) return `${stem}_${n}`;
}

/** A copy of `b` whose id and table column ids are new in `l`. */
export function reId(l: Layout, b: Block, taken: Set<string> = new Set()): Block {
  const c = structuredClone(b);
  c.id = freshId(l, b.id, taken);
  taken.add(c.id);
  if (c.type === "table") {
    const map = new Map<string, string>();
    for (const tc of c.columns) {
      const n = freshId(l, tc.id, taken);
      taken.add(n);
      map.set(tc.id, n);
      tc.id = n;
    }
    if (c.totals) c.totals = c.totals.map((x) => map.get(x) ?? x);
  }
  return c;
}

/** Columns in reading order, with where each is. */
export const columnsInOrder = (l: Layout) => l.sections.flatMap((s, si) => s.columns.map((c, ci) => ({ id: c.id, s: si, c: ci })));

/** `"bill:1"` (a `data-slot`): column `bill`, before its second block. */
export function parseSlot(slot: string): { column: Id; index: number } | null {
  const i = slot.lastIndexOf(":");
  const index = Number(slot.slice(i + 1));
  return i > 0 && Number.isInteger(index) && index >= 0 ? { column: slot.slice(0, i), index } : null;
}

// ── changes (each returns a new layout; the one given is never touched) ──

const clone = (l: Layout) => structuredClone(l);

/** Puts `block` in `column` at `index` (clamped), with a new id if its own is taken. */
export function insertBlock(l: Layout, block: Block, column: Id, index: number): { layout: Layout; id: Id } {
  const w = locate(l, column);
  if (!w || w.kind !== "column") return { layout: l, id: block.id };
  const next = clone(l);
  const b = allIds(l).includes(block.id) || (block.type === "table" && block.columns.some((x) => allIds(l).includes(x.id))) ? reId(l, block) : structuredClone(block);
  const blocks = next.sections[w.s].columns[w.c].blocks;
  blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, b);
  return { layout: next, id: b.id };
}

/** Moves block `id` to `column` before what is now its `index`-th block. */
export function moveBlock(l: Layout, id: Id, column: Id, index: number): Layout {
  const from = locate(l, id);
  const to = locate(l, column);
  if (!from || from.kind !== "block" || !to || to.kind !== "column") return l;
  const next = clone(l);
  const src = next.sections[from.s].columns[from.c].blocks;
  const [b] = src.splice(from.b, 1);
  const same = from.s === to.s && from.c === to.c;
  const dst = next.sections[to.s].columns[to.c].blocks;
  const at = Math.max(0, Math.min(same && index > from.b ? index - 1 : index, dst.length));
  if (same && at === from.b) return l;
  dst.splice(at, 0, b);
  return next;
}

/** Removes a block, a table column, a column (its blocks join the one before) or a section; the last section and a section's
 *  last column stay. */
export function removeNode(l: Layout, id: Id): Layout {
  const w = locate(l, id);
  if (!w) return l;
  const next = clone(l);
  const sec = next.sections[w.s];
  if (w.kind === "section") {
    if (next.sections.length < 2) return l;
    next.sections.splice(w.s, 1);
  } else if (w.kind === "column") {
    if (sec.columns.length < 2) return l;
    const [gone] = sec.columns.splice(w.c, 1);
    sec.columns[Math.max(0, w.c - 1)].blocks.push(...gone.blocks);
    if (sec.widths) sec.widths.splice(w.c, 1);
  } else if (w.kind === "block") {
    sec.columns[w.c].blocks.splice(w.b, 1);
  } else {
    const t = sec.columns[w.c].blocks[w.b] as TableBlock;
    t.columns.splice(w.t, 1);
    if (t.totals) t.totals = t.totals.filter((x) => x !== id);
  }
  return next;
}

/** Sets the properties of a node; a property given as `undefined` is removed. An id is never changed this way. */
export function updateNode<T extends Section | Column | Block | TableColumn>(l: Layout, id: Id, patch: Partial<T>): Layout {
  const w = locate(l, id);
  if (!w) return l;
  const next = clone(l);
  const node = nodeAt(next, w) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (k === "id") continue;
    if (v === undefined) delete node[k];
    else node[k] = structuredClone(v);
  }
  return next;
}

/** A copy of a block or section just after it, with new ids; the copy's id is returned. */
export function duplicateNode(l: Layout, id: Id): { layout: Layout; id: Id } {
  const w = locate(l, id);
  if (!w || (w.kind !== "block" && w.kind !== "section")) return { layout: l, id };
  const next = clone(l);
  if (w.kind === "block") {
    const b = reId(l, next.sections[w.s].columns[w.c].blocks[w.b]);
    next.sections[w.s].columns[w.c].blocks.splice(w.b + 1, 0, b);
    return { layout: next, id: b.id };
  }
  const taken = new Set<string>();
  const s = structuredClone(next.sections[w.s]);
  s.id = freshId(l, s.id, taken);
  taken.add(s.id);
  for (const c of s.columns) {
    c.id = freshId(l, c.id, taken);
    taken.add(c.id);
    c.blocks = c.blocks.map((b) => reId(l, b, taken));
  }
  next.sections.splice(w.s + 1, 0, s);
  return { layout: next, id: s.id };
}

/** Moves a block within its column, a section among sections or a table column within its table, by one place. */
export function nudge(l: Layout, id: Id, delta: -1 | 1): Layout {
  const w = locate(l, id);
  if (!w || w.kind === "column") return l;
  const next = clone(l);
  const list: unknown[] = w.kind === "section" ? next.sections : w.kind === "block" ? next.sections[w.s].columns[w.c].blocks : (next.sections[w.s].columns[w.c].blocks[w.b] as TableBlock).columns;
  const i = w.kind === "section" ? w.s : w.kind === "block" ? w.b : w.t;
  const j = i + delta;
  if (j < 0 || j >= list.length) return l;
  [list[i], list[j]] = [list[j], list[i]];
  return next;
}

/** Moves a block to the next (1) or previous (-1) column in reading order, crossing sections: at the start of the next one,
 *  at the end of the previous one. */
export function toNeighbourColumn(l: Layout, id: Id, delta: -1 | 1): Layout {
  const w = locate(l, id);
  if (!w || w.kind !== "block") return l;
  const cols = columnsInOrder(l);
  const i = cols.findIndex((c) => c.s === w.s && c.c === w.c);
  const target = cols[i + delta];
  if (!target) return l;
  return moveBlock(l, id, target.id, delta > 0 ? 0 : l.sections[target.s].columns[target.c].blocks.length);
}

/** A new one-column section above the block's own, holding only that block. */
export function toNewSectionAbove(l: Layout, id: Id): { layout: Layout; section: Id } {
  const w = locate(l, id);
  if (!w || w.kind !== "block") return { layout: l, section: "" };
  const next = clone(l);
  const [b] = next.sections[w.s].columns[w.c].blocks.splice(w.b, 1);
  const sid = freshId(l, "section");
  const cid = freshId(l, `${sid}_c`, new Set([sid]));
  next.sections.splice(w.s, 0, { id: sid, columns: [{ id: cid, blocks: [b] }] });
  return { layout: next, section: sid };
}

/** An empty one-column section after `after` (or at the end). */
export function addSection(l: Layout, after?: Id): { layout: Layout; section: Id; column: Id } {
  const next = clone(l);
  const sid = freshId(l, "section");
  const cid = freshId(l, `${sid}_c`, new Set([sid]));
  const w = after ? locate(l, after) : null;
  next.sections.splice(w ? w.s + 1 : next.sections.length, 0, { id: sid, columns: [{ id: cid, blocks: [] }] });
  return { layout: next, section: sid, column: cid };
}

/** A section with `n` columns (1 to 4): new ones empty, the blocks of removed ones join the last that stays. Widths go equal. */
export function setColumnCount(l: Layout, section: Id, n: number): Layout {
  const w = locate(l, section);
  if (!w || w.kind !== "section" || n < 1 || n > 4) return l;
  const next = clone(l);
  const s = next.sections[w.s];
  if (s.columns.length === n) return l;
  const taken = new Set<string>();
  while (s.columns.length < n) {
    const id = freshId(next, `${s.id}_c`, taken);
    taken.add(id);
    s.columns.push({ id, blocks: [] });
  }
  if (s.columns.length > n) {
    const gone = s.columns.splice(n);
    s.columns[n - 1].blocks.push(...gone.flatMap((c) => c.blocks));
  }
  delete s.widths;
  return next;
}

/** The section's widths as numbers (equal when it has none). */
export const widthsOf = (s: Section): number[] => (s.widths?.length === s.columns.length ? s.widths : s.columns.map(() => Math.max(1, Math.floor(12 / s.columns.length))));

/** Moves the line between column `i` and `i + 1` by `delta` units (each column stays 1 to 12). */
export function resizeColumns(l: Layout, section: Id, i: number, delta: number): Layout {
  const w = locate(l, section);
  if (!w || w.kind !== "section") return l;
  const s = l.sections[w.s];
  if (i < 0 || i >= s.columns.length - 1) return l;
  const ws = [...widthsOf(s)];
  const d = Math.max(1 - ws[i], Math.min(delta, ws[i + 1] - 1, 12 - ws[i], ws[i + 1] - 1));
  if (!d) return l;
  ws[i] += d;
  ws[i + 1] -= d;
  return updateNode<Section>(l, section, { widths: ws });
}

// ── new blocks ──

export function newBlock(type: BlockType, l: Layout, value?: Path): Block {
  const id = freshId(l, value ? value.split(".").at(-1)! : type);
  switch (type) {
    case "field": return { id, type, value: value ?? "doc.number" };
    case "heading": return { id, type, text: tr("Heading"), level: 2 };
    case "text": return { id, type, content: [{ spans: [{ t: tr("Text") }] }] };
    case "image": return value ? { id, type, src: { value }, height_mm: 20 } : { id, type, src: { file: "" }, height_mm: 20 };
    case "table": return { id, type, value: value ?? "", columns: [] };
    case "totals": return { id, type, rows: [{ label: tr("Total"), value: "doc.grand_total", format: { as: "amount" }, emphasis: true }], align: "end" };
    case "signature": return { id, type, label: tr("Authorised signatory"), line: true, width_mm: 60 };
    case "barcode": return { id, type, value: value ?? "doc.number", kind: "code128" };
    case "copy_label": return { id, type, weight: "bold" };
    case "divider": return { id, type, thickness: 1, style: "solid" };
    case "spacer": return { id, type, height_mm: 6 };
    case "page_break": return { id, type };
  }
}

/** The block a catalogue entry makes when dropped: a table for a table (with its first columns), an image for an attach field,
 *  "in words" for a computed words value, else a field. */
export function blockFromCatalogue(path: Path, c: Catalogue, l: Layout, computedFormat?: string): Block {
  const table = c.tables.find((t) => t.path === path);
  if (table) {
    const taken = new Set<string>();
    const cols: TableColumn[] = table.columns.slice(0, 5).map((x) => {
      const id = freshId(l, `c_${x.path.split(".").at(-1)}`, taken);
      taken.add(id);
      const num = ["int", "decimal", "float", "currency", "percent"].includes(x.type ?? "");
      return { id, value: x.path, label: x.label, ...(num ? { align: "end" as const } : {}), ...(x.type === "currency" ? { format: { as: "amount" as const, show: "none" as const } } : {}) };
    });
    const id = freshId(l, path.split(".").at(-1)!, taken);
    return { id, type: "table", value: path, columns: cols };
  }
  const f = pathIndex(c).get(path);
  if (f?.type === "attach" || f?.type === "image") return newBlock("image", l, path);
  const b = newBlock("field", l, path) as FieldBlock;
  if (computedFormat === "words") return { ...b, id: freshId(l, `${path.split(".").at(-1)}_words`), label: f ? tr("{field} in words", { field: f.label }) : undefined, label_position: "above", format: { as: "words" } };
  return b;
}

/** A table column for a row path. */
export function newTableColumn(l: Layout, path: Path, label?: string): TableColumn {
  return { id: freshId(l, `c_${path.split(".").at(-1)}`), value: path, ...(label ? { label } : {}) };
}

// ── words for things ──

export const BLOCK_NAMES = (): Record<BlockType, string> => ({
  field: tr("Field"), heading: tr("Heading"), text: tr("Text"), image: tr("Image"), table: tr("Table"), totals: tr("Totals"), signature: tr("Signature"),
  barcode: tr("Barcode"), copy_label: tr("Copy label"), divider: tr("Line"), spacer: tr("Space"), page_break: tr("Page break"),
});

/** What a person calls a node: "Field “Invoice no”", "Table “Items”", "Section “parties”". */
export function nodeName(n: Section | Column | Block | TableColumn, c?: Catalogue | null): string {
  if ("columns" in n && !("type" in n)) return n.title ? tr("Section “{name}”", { name: n.title }) : tr("Section {id}", { id: n.id });
  if ("blocks" in n) return tr("Column {id}", { id: n.id });
  if (!("type" in n)) return tr("Column “{name}”", { name: n.label || pathLabel(firstPath(n.value), c) });
  const kind = BLOCK_NAMES()[n.type];
  const what =
    n.type === "field" ? (typeof n.label === "string" && n.label ? n.label : pathLabel(firstPath(n.value), c))
    : n.type === "heading" ? n.text
    : n.type === "table" ? pathLabel(n.value, c)
    : n.type === "signature" ? n.label
    : n.type === "barcode" ? pathLabel(firstPath(n.value), c)
    : n.type === "text" ? n.content.flatMap((p) => p.spans.map((s) => ("t" in s ? s.t : `{${firstPath(s.v)}}`))).join("").slice(0, 30)
    : "";
  return what ? tr("{kind} “{name}”", { kind, name: what }) : kind;
}

// ── checks before save (§4.2) ──

export interface Problem { id: Id | null; message: string }

const HEX = /^#[0-9a-fA-F]{6}$/;
const FILE = /^\/files\/[0-9a-fA-F-]{36}$/;
const TOKEN = /\{((?:doc|links|company|settings|print)\.[A-Za-z0-9_.]+)(?:\|([a-z]+))?\}/g;
export const MAX_LAYOUT_BYTES = 256 * 1024;

/** What the server would refuse in a layout, each naming the node by what a person calls it. `letterhead`: the stricter
 *  rules of a letter head's header or footer (§3.3). Paths are checked only when the catalogue is given. */
export function validate(l: Layout, c?: Catalogue | null, o: { letterhead?: boolean } = {}): Problem[] {
  const out: Problem[] = [];
  const add = (id: Id | null, message: string) => out.push({ id, message });
  const index = c ? pathIndex(c) : null;
  const seen = new Set<string>();
  let blocks = 0;
  let conditions = 0;
  let images = 0;
  let text = 0;
  const name = (n: Section | Column | Block | TableColumn) => nodeName(n, c);
  const checkId = (n: { id: Id }, what: Section | Column | Block | TableColumn) => {
    if (!ID.test(n.id)) add(n.id, tr("{name}: the id “{id}” must be lower case letters, digits, - and _, starting with a letter (at most 40).", { name: name(what), id: n.id }));
    if (seen.has(n.id)) add(n.id, tr("{name}: the id “{id}” is used twice.", { name: name(what), id: n.id }));
    seen.add(n.id);
  };
  const cel = (id: Id, what: string, s: string | undefined) => {
    if (s === undefined) return;
    conditions++;
    if (!s.trim()) add(id, tr("{name}: the condition is empty.", { name: what }));
    if (s.length > 500) add(id, tr("{name}: a condition is at most 500 characters.", { name: what }));
  };
  const len = (id: Id, what: string, s: string | undefined | null, max: number, part: string) => {
    if (typeof s === "string" && s.length > max) add(id, tr("{name}: the {part} is longer than {max} characters.", { name: what, part, max }));
  };
  const range = (id: Id, what: string, v: number | undefined, lo: number, hi: number, part: string) => {
    if (v !== undefined && !(typeof v === "number" && v >= lo && v <= hi)) add(id, tr("{name}: the {part} must be from {lo} to {hi}.", { name: what, part, lo, hi }));
  };
  const color = (id: Id, what: string, v: string | undefined) => {
    if (v !== undefined && !HEX.test(v)) add(id, tr("{name}: a colour is written #rrggbb.", { name: what }));
  };
  const path = (id: Id, what: string, p: Path, row?: { table: Path }) => {
    if (!p) return add(id, tr("{name}: choose a field.", { name: what }));
    if (p.startsWith("row.")) {
      if (!row) return add(id, tr("{name}: “{path}” is a line's field: it prints only in a table's columns.", { name: what, path: p }));
      if (c && !c.tables.find((t) => t.path === row.table)?.columns.some((x) => x.path === p)) add(id, tr("{name}: the lines have no field “{path}”.", { name: what, path: p }));
      return;
    }
    if (row && p.startsWith("doc.") === false && !/^(links|company|settings|print)\./.test(p)) return add(id, tr("{name}: “{path}” is not a field.", { name: what, path: p }));
    if ((p === "print.page" || p === "print.pages") && !o.letterhead) return add(id, tr("{name}: page numbers print only in a letter head.", { name: what }));
    if (o.letterhead && !/^(company|settings|print)\./.test(p)) return add(id, tr("{name}: a letter head prints only the company's, the settings' and the print's values.", { name: what }));
    if (index && !index.has(p) && !(o.letterhead && (p === "print.page" || p === "print.pages"))) add(id, tr("{name}: there is no field “{path}”.", { name: what, path: p }));
  };
  const value = (id: Id, what: string, v: Value, row?: { table: Path }) => {
    const ps = pathsOf(v);
    if (!ps.length) return add(id, tr("{name}: choose a field.", { name: what }));
    if (ps.length > 4) add(id, tr("{name}: at most 4 fields, the first that is not empty prints.", { name: what }));
    for (const p of ps) path(id, what, p, row);
  };
  const format = (id: Id, what: string, f: Format | undefined) => {
    if (!f) return;
    if (f.as && !FORMAT_AS.includes(f.as)) add(id, tr("{name}: “{as}” is not a way to print a value.", { name: what, as: f.as }));
    range(id, what, f.decimals, 0, 9, tr("decimals"));
    if (f.currency !== undefined && !/^[A-Z]{3}$/.test(f.currency)) add(id, tr("{name}: a currency is a three-letter code, like INR.", { name: what }));
  };
  const tokens = (id: Id, what: string, s: string) => {
    for (const m of s.matchAll(TOKEN)) path(id, what, m[1]);
  };
  const image = (id: Id, what: string, src: ImageSrc | undefined) => {
    if (!src) return;
    images++;
    if ("file" in src) {
      if (!FILE.test(src.file)) add(id, tr("{name}: choose an image file of this workspace.", { name: what }));
    } else path(id, what, src.value);
  };

  if (JSON.stringify(l).length > MAX_LAYOUT_BYTES) add(null, tr("The layout is larger than 256 KB."));
  // A letter head's header or footer holds 0 to 20 sections (the platform's deviation 3); a format 1 to 100.
  if (!l.sections.length && !o.letterhead) add(null, tr("A layout needs at least one section."));
  if (l.sections.length > (o.letterhead ? 20 : 100)) add(null, o.letterhead ? tr("A letter head's header or footer has at most 20 sections.") : tr("A layout has at most 100 sections."));
  color("page", tr("The page"), l.style?.color);
  color("page", tr("The page"), l.style?.accent);
  if (l.watermark) {
    len("page", tr("The watermark"), l.watermark.text, 40, tr("text"));
    cel("page", tr("The watermark"), l.watermark.when);
    tokens("page", tr("The watermark"), l.watermark.text);
  }
  for (const s of l.sections) {
    const sn = name(s);
    checkId(s, s);
    if (s.columns.length < 1 || s.columns.length > 4) add(s.id, tr("{name}: a section has 1 to 4 columns.", { name: sn }));
    if (s.widths && (s.widths.length !== s.columns.length || s.widths.some((w) => !Number.isInteger(w) || w < 1 || w > 12))) add(s.id, tr("{name}: give each column a width from 1 to 12.", { name: sn }));
    len(s.id, sn, s.title, 120, tr("title"));
    color(s.id, sn, s.background);
    for (const [k, v] of [["gap_mm", s.gap_mm], ["padding_mm", s.padding_mm]] as const) if (v !== undefined && !SPACES.includes(v)) add(s.id, tr("{name}: {part} must be one of 0, 1, 2, 3, 4, 6 or 8 mm.", { name: sn, part: k === "gap_mm" ? tr("the gap") : tr("the padding") }));
    cel(s.id, sn, s.when);
    for (const col of s.columns) {
      checkId(col, col);
      if (col.blocks.length > 50) add(col.id, tr("{name}: a column holds at most 50 blocks.", { name: name(col) }));
      for (const b of col.blocks) {
        blocks++;
        const bn = name(b);
        checkId(b, b);
        if (o.letterhead && !LETTERHEAD_BLOCKS.includes(b.type)) add(b.id, tr("{name}: a letter head holds fields, text, headings, images, lines and space only.", { name: bn }));
        cel(b.id, bn, b.when);
        if (b.margin_top_mm !== undefined && !SPACES.includes(b.margin_top_mm)) add(b.id, tr("{name}: the space above must be one of 0, 1, 2, 3, 4, 6 or 8 mm.", { name: bn }));
        if ("size" in b && b.size !== undefined && !SIZES.includes(b.size)) add(b.id, tr("{name}: choose a size from the scale.", { name: bn }));
        if ("color" in b) color(b.id, bn, b.color);
        switch (b.type) {
          case "field":
            value(b.id, bn, b.value);
            len(b.id, bn, b.label, 80, tr("label"));
            format(b.id, bn, b.format);
            break;
          case "heading":
            if (!b.text.trim()) add(b.id, tr("{name}: write the heading.", { name: bn }));
            len(b.id, bn, b.text, 200, tr("heading"));
            tokens(b.id, bn, b.text);
            break;
          case "text":
            for (const p of b.content) for (const sp of p.spans) {
              if ("t" in sp) text += sp.t.length;
              else value(b.id, bn, sp.v);
            }
            break;
          case "image":
            image(b.id, bn, b.src);
            range(b.id, bn, b.width_mm, 5, 200, tr("width"));
            range(b.id, bn, b.height_mm, 5, 200, tr("height"));
            len(b.id, bn, b.alt, 120, tr("description"));
            break;
          case "table": {
            path(b.id, bn, b.value);
            if (c && b.value && !c.tables.some((t) => t.path === b.value)) add(b.id, tr("{name}: “{path}” is not a table of lines.", { name: bn, path: b.value }));
            if (b.columns.length < 1 || b.columns.length > 20) add(b.id, tr("{name}: a table has 1 to 20 columns.", { name: bn }));
            const ids = new Set(b.columns.map((x) => x.id));
            for (const x of b.totals ?? []) if (!ids.has(x)) add(b.id, tr("{name}: the totals row names a column it does not have.", { name: bn }));
            len(b.id, bn, b.totals_label, 80, tr("totals label"));
            if (b.hide_zero_rows) path(b.id, bn, b.hide_zero_rows, { table: b.value });
            let pct = 0;
            for (const tc of b.columns) {
              const tn = name(tc);
              checkId(tc, tc);
              value(tc.id, tn, tc.value, { table: b.value });
              if (tc.secondary !== undefined) value(tc.id, tn, tc.secondary, { table: b.value });
              len(tc.id, tn, tc.label, 80, tr("label"));
              range(tc.id, tn, tc.width_pct, 3, 100, tr("width"));
              pct += tc.width_pct ?? 0;
              format(tc.id, tn, tc.format);
              cel(tc.id, tn, tc.when);
            }
            if (pct > 100) add(b.id, tr("{name}: the columns' widths add up to more than 100%.", { name: bn }));
            break;
          }
          case "totals":
            if (b.rows.length < 1 || b.rows.length > 12) add(b.id, tr("{name}: totals have 1 to 12 rows.", { name: bn }));
            range(b.id, bn, b.width_pct, 30, 100, tr("width"));
            for (const r of b.rows) {
              len(b.id, bn, r.label, 80, tr("label"));
              tokens(b.id, bn, r.label);
              value(b.id, bn, r.value);
              format(b.id, bn, r.format);
              cel(b.id, bn, r.when);
            }
            break;
          case "signature":
            len(b.id, bn, b.label, 80, tr("label"));
            tokens(b.id, bn, b.label);
            image(b.id, bn, b.image);
            range(b.id, bn, b.width_mm, 30, 120, tr("width"));
            break;
          case "barcode":
            value(b.id, bn, b.value);
            range(b.id, bn, b.height_mm, 5, 60, tr("height"));
            break;
          case "spacer":
            range(b.id, bn, b.height_mm, 1, 100, tr("height"));
            break;
          case "divider":
            if (b.thickness !== undefined && ![1, 2, 3].includes(b.thickness)) add(b.id, tr("{name}: a line is 1, 2 or 3 thick.", { name: bn }));
            break;
        }
      }
    }
  }
  if (blocks > 500) add(null, tr("A layout has at most 500 blocks."));
  if (conditions > 100) add(null, tr("A layout has at most 100 conditions."));
  if (images > 20) add(null, tr("A layout has at most 20 images."));
  if (text > 10_000) add(null, tr("The text blocks hold more than 10,000 characters in all."));
  return out;
}

/** The node a server's field error names: `layout.<id>` or `layout`. */
export const refusedNode = (field: string, message = ""): Id | null =>
  field.startsWith("layout.") ? field.slice(7) : field === "layout" ? (/^block ([a-z][a-z0-9_-]{0,39}):/.exec(message)?.[1] ?? null) : null;

// ── conditions (§4.4): the three shapes the builder writes ──

export interface SimpleCondition { path: Path; op: "set" | "empty" | "is"; literal?: string }

export function parseCondition(cel: string): SimpleCondition | null {
  const s = cel.trim();
  let m = /^([a-z]+(?:\.[A-Za-z0-9_]+)+) (!=|==) ""$/.exec(s);
  if (m) return { path: m[1], op: m[2] === "!=" ? "set" : "empty" };
  m = /^([a-z]+(?:\.[A-Za-z0-9_]+)+) == ("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)$/.exec(s);
  if (m) return { path: m[1], op: "is", literal: m[2].startsWith('"') ? (JSON.parse(m[2]) as string) : m[2] };
  return null;
}

export function writeCondition(c: SimpleCondition): Cel {
  if (c.op === "set") return `${c.path} != ""`;
  if (c.op === "empty") return `${c.path} == ""`;
  const lit = c.literal ?? "";
  return `${c.path} == ${/^(-?\d+(\.\d+)?|true|false)$/.test(lit) ? lit : JSON.stringify(lit)}`;
}

// ── a text block as plain text: one paragraph a line, {path} a value ──

export function textOf(ps: Paragraph[]): string {
  return ps.map((p) => p.spans.map((s) => ("t" in s ? s.t : `{${firstPath(s.v)}${s.format?.as ? `|${s.format.as}` : ""}}`)).join("")).join("\n");
}

export function paragraphsOf(text: string, align?: Align): Paragraph[] {
  return text.split("\n").map((line) => {
    const spans: Span[] = [];
    let at = 0;
    for (const m of line.matchAll(TOKEN)) {
      if (m.index! > at) spans.push({ t: line.slice(at, m.index) });
      spans.push(m[2] ? { v: m[1], format: { as: m[2] as Format["as"] } } : { v: m[1] });
      at = m.index! + m[0].length;
    }
    if (at < line.length || !spans.length) spans.push({ t: line.slice(at) });
    return align ? { align, spans } : { spans };
  });
}

// ── template formats (§6): where the server's refusal points ──

/** `"hi body, line 12: unknown filter"` → language `hi`, the body, line 12 and the rest. */
export function templateErrorAt(message: string): { language: string; part: "body" | "header" | "footer"; line: number; text: string } | null {
  const m = /^(\S+) (body|header|footer), line (\d+): ([\s\S]*)$/.exec(message);
  return m ? { language: m[1], part: m[2] as "body" | "header" | "footer", line: Number(m[3]), text: m[4] } : null;
}

/** A language's name in the interface's language, with its tag when the browser does not know it: "Hindi", "हिन्दी". */
export function languageName(tag: string, inLanguage = typeof document !== "undefined" ? document.documentElement.lang || "en" : "en"): string {
  try {
    const name = new Intl.DisplayNames([inLanguage], { type: "language" }).of(tag);
    return name && name !== tag ? name : tag;
  } catch {
    return tag;
  }
}

// ── the dialog's choices and the person's memory (§6.1) ──

export interface ChoiceTemplate { key: string; label?: string | null; output: string; kind?: "template" | "layout"; languages?: string[]; letterhead?: string; copies?: string[]; page?: { size: PaperSize; orientation: "portrait" | "landscape"; width_mm?: number; height_mm?: number } }
export interface Choices {
  templates: ChoiceTemplate[];
  standard?: { label: string; page?: ChoiceTemplate["page"] };
  default: string | null;
  letterheads?: { id: string; name: string; company?: string | null; default_for_record?: boolean }[];
  languages?: string[];
  copies?: string[];
  may_print?: boolean;
  refusal?: string | null;
}

/** What the dialog remembers per record type and person. `template` null: the standard format. */
export interface PrintChoice { template?: string | null; letterhead?: string; language?: string; copies?: string[] }

/** The preference scope for an entity (`print:<Entity>`, characters outside the scope rule as `_`). */
export const printPrefScope = (entity: string) => `print:${entity.replace(/[^A-Za-z0-9:_.-]/g, "_")}`.slice(0, 120);

/** The choice the dialog opens with: what was remembered where it is still offered, else the default. */
export function startingChoice(c: Choices, remembered: PrintChoice | undefined): Required<PrintChoice> {
  const pages = c.templates.filter((x) => x.output === "page");
  const offered = (k: string | null | undefined) => k === null || (typeof k === "string" && pages.some((x) => x.key === k));
  const template = remembered && remembered.template !== undefined && offered(remembered.template) ? remembered.template : offered(c.default) ? c.default : (pages[0]?.key ?? null);
  const lhs = c.letterheads ?? [];
  const letterhead = remembered?.letterhead && (remembered.letterhead === "none" || remembered.letterhead === "default" || lhs.some((x) => x.id === remembered.letterhead)) ? remembered.letterhead : "default";
  const t = pages.find((x) => x.key === template);
  const langs = (t?.kind === "template" || !t?.kind) && t?.languages?.length ? t.languages : (c.languages ?? []);
  const language = remembered?.language && langs.includes(remembered.language) ? remembered.language : "";
  const offeredCopies = copiesOffered(c, template);
  const copies = (remembered?.copies ?? []).filter((x) => offeredCopies.includes(x));
  return { template, letterhead, language, copies };
}

/** The copy labels offered for a format: its own, else the print settings'. */
export const copiesOffered = (c: Choices, template: string | null) => {
  const own = c.templates.find((x) => x.key === template)?.copies;
  return own?.length ? own : (c.copies ?? []);
};

/** The print choice as the server's `/print` query and `/email` body name it (platform `docs.rs` `EmailBody`, `PrintAsk`): the
 *  standard format is `"standard"`, none named is the default; the default letter head, no language and no copies are left out. */
export function printFields(o: PrintChoice): { template?: string; letterhead?: string; language?: string; copies?: string[] } {
  return {
    ...(o.template !== undefined ? { template: o.template === null ? "standard" : o.template } : {}),
    ...(o.letterhead && o.letterhead !== "default" ? { letterhead: o.letterhead } : {}),
    ...(o.language ? { language: o.language } : {}),
    ...(o.copies?.length ? { copies: o.copies } : {}),
  };
}

/** The print request's query: `copy` repeated, in order (URLSearchParams.set would keep one). */
export function printQuery(o: PrintChoice & { format?: "html" | "pdf" }): string {
  const f = printFields(o);
  const sp = new URLSearchParams();
  if (f.template) sp.set("template", f.template);
  if (f.letterhead) sp.set("letterhead", f.letterhead);
  if (f.language) sp.set("language", f.language);
  for (const c of f.copies ?? []) sp.append("copy", c);
  if (o.format) sp.set("format", o.format);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** The PDF's name as the server makes it (`documents.rs` `file_name`): "<format label> <number>.pdf", characters other than
 *  letters, digits, space, - _ . as "_". */
export function pdfFileName(label: string, number: string): string {
  const name = `${label} ${number}`.replace(/[^\p{L}\p{N} \-_.]/gu, "_").slice(0, 120).trim() || "document";
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}

/** The format a choice prints with, by name: the chosen one, else the default, else the standard format. */
export function formatLabel(c: Choices | undefined, template: string | null | undefined, fallback: string): string {
  const key = template === undefined ? c?.default : template;
  const t = key ? c?.templates.find((x) => x.key === key) : null;
  return t ? t.label || t.key : (c?.standard?.label ?? fallback);
}

// ── a letter head as the slice-one form edits it (§7.5): a logo, lines beside it, a footer line ──

export interface LetterHeadForm {
  logo: string | null; // "/files/<uuid>"
  logo_position: Align;
  logo_height_mm: number;
  lines: ({ kind: "field"; path: Path; bold?: boolean } | { kind: "text"; text: string; bold?: boolean })[];
  lines_align: Align;
  footer: string;
}
export const EMPTY_LETTERHEAD: LetterHeadForm = { logo: null, logo_position: "start", logo_height_mm: 20, lines: [], lines_align: "end", footer: "" };

/** The header and footer blocks (`{sections}`) the form writes. */
export function letterHeadBlocks(f: LetterHeadForm): { header: { sections: Section[] }; footer: { sections: Section[] } } {
  const lines: Block[] = f.lines.map((x, i) =>
    x.kind === "field"
      ? { id: `lh_line_${i + 1}`, type: "field", value: x.path, label: null, align: f.lines_align, ...(x.bold ? { weight: "bold" as const } : {}) }
      : { id: `lh_line_${i + 1}`, type: "text", content: paragraphsOf(x.text, f.lines_align).map((p) => (x.bold ? { ...p, spans: p.spans.map((s) => ({ ...s, b: true })) } : p)) },
  );
  const logo: Block[] = f.logo ? [{ id: "lh_logo", type: "image", src: { file: f.logo }, height_mm: f.logo_height_mm, align: f.logo_position, alt: "" }] : [];
  const columns: Column[] = !logo.length || f.logo_position === "center"
    ? [{ id: "lh_head_c", blocks: [...logo, ...lines] }]
    : f.logo_position === "start"
      ? [{ id: "lh_logo_c", blocks: logo }, { id: "lh_lines_c", blocks: lines }]
      : [{ id: "lh_lines_c", blocks: lines }, { id: "lh_logo_c", blocks: logo }];
  const header: Section = { id: "lh_head", columns, ...(columns.length === 2 ? { widths: f.logo_position === "start" ? [4, 8] : [8, 4] } : {}) };
  const footer: Section[] = f.footer.trim() ? [{ id: "lh_foot", columns: [{ id: "lh_foot_c", blocks: [{ id: "lh_foot_text", type: "text", size: "sm", content: paragraphsOf(f.footer, "center") }] }] }] : [];
  return { header: { sections: [header] }, footer: { sections: footer } };
}

/** The form back from blocks it wrote; `null` when the blocks were made some other way (the form would replace them). */
export function letterHeadForm(header: unknown, footer: unknown): LetterHeadForm | null {
  const hs = (header as { sections?: Section[] } | null)?.sections;
  const fs = (footer as { sections?: Section[] } | null)?.sections;
  if (!hs && !fs) return { ...EMPTY_LETTERHEAD };
  const blocks = (hs ?? []).flatMap((s) => s.columns.flatMap((c) => c.blocks));
  if ((hs ?? []).some((s) => s.id !== "lh_head") || blocks.some((b) => !/^lh_(logo|line_\d+)$/.test(b.id))) return null;
  const logo = blocks.find((b): b is ImageBlock => b.id === "lh_logo" && b.type === "image");
  const lineBlocks = blocks.filter((b) => b.id.startsWith("lh_line_"));
  const cols = hs?.[0]?.columns ?? [];
  const position: Align = !logo ? "start" : cols.length === 1 ? "center" : cols[0].id === "lh_logo_c" ? "start" : "end";
  const foot = fs?.[0]?.columns[0]?.blocks.find((b): b is TextBlock => b.type === "text");
  return {
    logo: logo && "file" in logo.src ? logo.src.file : null,
    logo_position: position,
    logo_height_mm: logo?.height_mm ?? 20,
    lines: lineBlocks.map((b) => (b.type === "field" ? { kind: "field" as const, path: firstPath(b.value), ...(b.weight === "bold" ? { bold: true } : {}) } : { kind: "text" as const, text: b.type === "text" ? textOf(b.content) : "", ...(b.type === "text" && b.content.some((p) => p.spans.some((s) => s.b)) ? { bold: true } : {}) })),
    lines_align: (lineBlocks[0]?.align ?? (lineBlocks[0]?.type === "text" ? lineBlocks[0].content[0]?.align : undefined) ?? "end") as Align,
    footer: foot ? textOf(foot.content) : "",
  };
}
