// Dashboard grid: the 12-column layout the server stores (builder.rs `parse_layout`: x 0-11,
// x + w ≤ 12, h 1-100, no overlaps), the moves the editor makes from the keyboard and menus (the
// same collision rules as dragging, from react-grid-layout's core), the reading-order spans that
// narrower screens use, and a three-way merge for saving over someone else's newer version.

import { bottom, cloneLayout, moveElement, verticalCompactor, type LayoutItem } from "react-grid-layout/core";
import type { DashboardBlock, GridItem } from "@/lib/studio";
import { stableJson } from "./history";

export const COLS = 12;
/** Height of one grid row and the gap between widgets, in pixels. */
export const ROW_PX = 36;
export const GAP_PX = 12;
const MAX_H = 100;

export type BlockType = DashboardBlock["type"];
/** A grid item with its id (the server assigns missing ones on save; so does `withIds`). */
export type Placed = GridItem & { i: string };

export const DEFAULT_SIZE: Record<BlockType, { w: number; h: number }> = {
  chart: { w: 6, h: 8 },
  card: { w: 3, h: 4 },
  shortcut: { w: 3, h: 2 },
  list: { w: 6, h: 7 },
  markdown: { w: 6, h: 4 },
  heading: { w: 12, h: 1 },
};

export const MIN_SIZE: Record<BlockType, { w: number; h: number }> = {
  chart: { w: 3, h: 5 },
  card: { w: 2, h: 3 },
  shortcut: { w: 2, h: 2 },
  list: { w: 3, h: 3 },
  markdown: { w: 2, h: 1 },
  heading: { w: 2, h: 1 },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** Ids for items without one, as the server assigns them (`w{index}`, `_` appended until unique). */
export function withIds(items: readonly GridItem[]): Placed[] {
  const used = new Set(items.flatMap((it) => (it.i ? [it.i] : [])));
  return items.map((it, n) => {
    if (it.i) return it as Placed;
    let id = `w${n}`;
    while (used.has(id)) id += "_";
    used.add(id);
    return { ...it, i: id };
  });
}

/** A fresh id that none of `items` uses. */
export function newId(items: readonly { i: string }[]): string {
  const used = new Set(items.map((it) => it.i));
  for (let n = items.length; ; n++) if (!used.has(`w${n}`)) return `w${n}`;
}

const minOf = (it: GridItem) => MIN_SIZE[it.type] ?? { w: 1, h: 1 };

/** The grid's view of the items (sizes kept within the grid and each widget's minimum). */
export function toLayout(items: readonly Placed[]): LayoutItem[] {
  return items.map((it) => {
    const min = minOf(it);
    const w = clamp(Math.round(it.w), 1, COLS);
    return { i: it.i, x: clamp(Math.round(it.x), 0, COLS - w), y: Math.max(0, Math.round(it.y)), w, h: clamp(Math.round(it.h), 1, MAX_H), minW: Math.min(min.w, w), minH: Math.min(min.h, it.h) };
  });
}

/** Positions from the grid applied to the items (matched by id; the items' order is kept). */
export function fromLayout(items: readonly Placed[], layout: readonly LayoutItem[]): Placed[] {
  const at = new Map(layout.map((l) => [l.i, l]));
  return items.map((it) => {
    const l = at.get(it.i);
    return l && (l.x !== it.x || l.y !== it.y || l.w !== it.w || l.h !== it.h) ? { ...it, x: l.x, y: l.y, w: l.w, h: l.h } : it;
  });
}

export const sameGeometry = (items: readonly Placed[], layout: readonly LayoutItem[]) => {
  const at = new Map(layout.map((l) => [l.i, l]));
  return items.length === layout.length && items.every((it) => {
    const l = at.get(it.i);
    return !!l && l.x === it.x && l.y === it.y && l.w === it.w && l.h === it.h;
  });
};

/** Gravity, as while dragging: items float up into free rows, overlaps are pushed down. */
const settle = (layout: LayoutItem[]) => [...verticalCompactor.compact(layout, COLS)];

/** Within the grid, without overlaps, compacted upward: what the editor works on. */
export const normalize = (items: readonly Placed[]): Placed[] => fromLayout(items, settle(toLayout(items)));

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The first free w×h spot, scanning rows from the top (a new widget fills the first gap that fits). */
export function findSpot(items: readonly Placed[], w: number, h: number): { x: number; y: number } {
  const width = clamp(w, 1, COLS);
  const end = bottom(toLayout(items));
  for (let y = 0; y <= end; y++)
    for (let x = 0; x + width <= COLS; x++) if (!items.some((it) => overlaps(it, { x, y, w: width, h }))) return { x, y };
  return { x: 0, y: end };
}

/** Adds a widget at the first free spot; returns the items and the new widget's id. */
export function addItem(items: readonly Placed[], block: DashboardBlock, size = DEFAULT_SIZE[block.type]): [Placed[], string] {
  const i = newId(items);
  const w = clamp(size.w, 1, COLS);
  const item = { ...block, i, ...findSpot(items, w, size.h), w, h: size.h } as Placed;
  return [normalize([...items, item]), i];
}

export const removeItem = (items: readonly Placed[], i: string): Placed[] => normalize(items.filter((it) => it.i !== i));

/** Replaces a widget's settings, keeping its place. */
export const updateBlock = (items: readonly Placed[], i: string, block: DashboardBlock): Placed[] =>
  items.map((it) => (it.i === i ? ({ ...block, i, x: it.x, y: it.y, w: it.w, h: it.h } as Placed) : it));

/**
 * Moves a widget one step (the keyboard and menu equivalent of a drag). Down passes the widget
 * below: with gravity, a step into empty space would float straight back.
 */
export function moveBy(items: readonly Placed[], i: string, dx: number, dy: number): Placed[] {
  const layout = toLayout(items);
  const start = layout.find((l) => l.i === i);
  if (!start) return [...items];
  const tryAt = (x: number, y: number) => {
    const copy = cloneLayout(layout);
    const l = copy.find((c) => c.i === i)!;
    return settle(moveElement(copy, l, x, y, true, false, "vertical", COLS));
  };
  const x = clamp(start.x + dx, 0, COLS - start.w);
  if (dy > 0) {
    for (let y = start.y + 1, end = bottom(layout); y <= end; y++) {
      const next = tryAt(x, y);
      if (next.find((l) => l.i === i)!.y > start.y) return fromLayout(items, next);
    }
    return [...items];
  }
  const y = Math.max(0, start.y + dy);
  return x === start.x && y === start.y ? [...items] : fromLayout(items, tryAt(x, y));
}

/** Resizes a widget by whole columns and rows (within the grid and its minimum); neighbours make way. */
export function resizeBy(items: readonly Placed[], i: string, dw: number, dh: number): Placed[] {
  const it = items.find((x) => x.i === i);
  if (!it) return [...items];
  const min = minOf(it);
  const w = clamp(it.w + dw, Math.min(min.w, it.w), COLS);
  const h = clamp(it.h + dh, Math.min(min.h, it.h), MAX_H);
  if (w === it.w && h === it.h) return [...items];
  const x = Math.min(it.x, COLS - w); // widening at the right edge grows leftward
  const layout = toLayout(items.map((o) => (o.i === i ? { ...o, x, w, h } : o)));
  // The resized widget stays put; everything it now covers moves down below it.
  const resized = layout.find((l) => l.i === i)!;
  const others = layout.filter((l) => l.i !== i).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: LayoutItem[] = [resized];
  for (const o of others) {
    while (placed.some((p) => overlaps(p, o))) o.y += 1;
    placed.push(o);
  }
  return fromLayout(items, settle(layout));
}

/** Top-to-bottom, then left-to-right: the order screen readers and narrow screens follow. */
export const readingOrder = <T extends { x: number; y: number }>(items: readonly T[]): T[] => [...items].sort((a, b) => a.y - b.y || a.x - b.x);

/** Columns a widget spans on tablets (of 12: twice its width) and on phones (of 2: small widgets pair up). */
export const tabletSpan = (w: number) => Math.min(COLS, w * 2);
export const phoneSpan = (w: number) => (w <= 4 ? 1 : 2);

/** Where a widget is, in words, for announcements after a keyboard move. */
export const describePlace = (it: { x: number; y: number; w: number; h: number }) =>
  `column ${it.x + 1}, row ${it.y + 1}, ${it.w} column${it.w === 1 ? "" : "s"} wide and ${it.h} row${it.h === 1 ? "" : "s"} tall`;

// ───────────────────────────── merging with a newer version ─────────────────────────────

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/**
 * Three-way merge of layouts by widget id: what I changed wins, what only they changed is
 * taken, widgets either side added are kept, widgets removed on one side and untouched on the
 * other are removed. Overlaps the merge creates are pushed down.
 */
export function mergeLayouts(base: readonly Placed[], mine: readonly Placed[], theirs: readonly Placed[]): Placed[] {
  const b = new Map(base.map((it) => [it.i, it]));
  const t = new Map(theirs.map((it) => [it.i, it]));
  const m = new Set(mine.map((it) => it.i));
  const out: Placed[] = [];
  for (const it of mine) {
    const was = b.get(it.i);
    const now = t.get(it.i);
    if (!was) out.push(it);
    else if (!now) {
      if (!same(it, was)) out.push(it);
    } else out.push(same(it, was) ? now : it);
  }
  for (const it of theirs) if (!m.has(it.i) && !b.has(it.i)) out.push(it);
  return normalize(out);
}
