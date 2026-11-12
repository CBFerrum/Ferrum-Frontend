// The designer's reading of the server's design-mode render (PRINT-FORMATS-SPEC §5.2, §12 item 45): where each section,
// column, block and table column is (`data-b`), which of them are ghosts for the previewed record (`data-ghost`: a part whose
// condition is false, drawn as a thin strip, or a zero-width table column with a hairline heading), and the drop places
// (`data-slot`). Pure over a document, so it is tested on the documented markup.

import { locate, parseSlot, type Id, type Layout } from "../../lib/printLayout";

export interface Box { id: Id; kind: "section" | "column" | "block" | "tcol"; ghost: boolean; x: number; y: number; w: number; h: number }
export interface SlotBox { slot: string; column: Id; index: number; x: number; y: number; w: number; h: number }
export interface Marks { boxes: Box[]; slots: SlotBox[]; ghosts: Set<Id> }

/** A ghost column is a hairline: its box is drawn this wide (px) so it can be pointed at and selected. */
export const GHOST_MIN = 8;

export function readMarks(doc: Document, l: Layout): Marks {
  const boxes: Box[] = [];
  const ghosts = new Set<Id>();
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-b]"))) {
    const id = el.dataset.b!;
    const w = locate(l, id);
    // A table column's id marks its heading and may mark its cells; a block repeats in every copy: the first one is the place.
    if (!w || boxes.some((x) => x.id === id)) continue;
    const ghost = el.hasAttribute("data-ghost");
    if (ghost) ghosts.add(id);
    const r = el.getBoundingClientRect();
    const x = ghost && r.width < GHOST_MIN ? r.left - (GHOST_MIN - r.width) / 2 : r.left;
    boxes.push({ id, kind: w.kind, ghost, x, y: r.top, w: ghost ? Math.max(r.width, GHOST_MIN) : r.width, h: ghost ? Math.max(r.height, GHOST_MIN) : r.height });
  }
  const slots: SlotBox[] = [];
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-slot]"))) {
    const s = parseSlot(el.dataset.slot!);
    if (!s || slots.some((x) => x.slot === el.dataset.slot)) continue;
    const r = el.getBoundingClientRect();
    slots.push({ slot: el.dataset.slot!, column: s.column, index: s.index, x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return { boxes, slots, ghosts };
}
