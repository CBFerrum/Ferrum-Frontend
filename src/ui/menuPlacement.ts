// Where a menu opens against its trigger, so it never leaves the window (pure: the Menu measures, this decides). Vertical: below the trigger,
// else above when there is more room there; the height is capped to the room of the side chosen (the menu scrolls inside it). Horizontal: the
// menu's start (or end) edge on the trigger's, flipped in right-to-left, then shifted to stay `margin` inside the window.

export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Placement {
  left: number;
  top: number;
  width: number;
  /** The height the menu may take; its own content scrolls past it. */
  maxHeight: number;
  side: "below" | "above";
}

export function placeMenu(trigger: Edges, size: { width: number; height: number }, view: { width: number; height: number }, o: { align: "start" | "end"; rtl: boolean; margin?: number; gap?: number }): Placement {
  const margin = o.margin ?? 8;
  const gap = o.gap ?? 4;
  const width = Math.max(0, Math.min(size.width, view.width - 2 * margin));
  const atStart = (o.align === "start") !== o.rtl; // the menu's left edge on the trigger's left edge
  const wanted = atStart ? trigger.left : trigger.right - width;
  const left = Math.max(margin, Math.min(wanted, view.width - margin - width));
  const below = view.height - trigger.bottom - gap - margin;
  const above = trigger.top - gap - margin;
  const side = size.height <= below || (size.height > above && below >= above) ? "below" : "above";
  const room = Math.max(0, side === "below" ? below : above);
  const maxHeight = Math.min(size.height, room, view.height - 2 * margin);
  const top = side === "below" ? trigger.bottom + gap : trigger.top - gap - maxHeight;
  return { left, top: Math.max(margin, top), width, maxHeight, side };
}
