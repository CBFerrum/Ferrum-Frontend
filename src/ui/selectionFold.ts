// Which of a toolbar's actions stay as buttons and which fold into its "More" menu, from measured widths (pure: the toolbar measures,
// this decides). Order is kept; at most two actions may be marked `priority` and are the last to fold.

export interface Fold {
  /** Indices that stay as buttons, in the order given. */
  shown: number[];
  /** Indices that go in the menu, in the order given. */
  folded: number[];
}

/**
 * `widths`: each action's width as a button; `available`: the room for the buttons (and the More button when something folds);
 * `gap`: between neighbours; `more`: the More button's width; `priority`: per action. Everything that fits stays; otherwise the
 * priority actions are kept first, then actions in the order given while they fit (the first that does not fit folds with all after it,
 * so a short later action never jumps ahead of a longer earlier one).
 */
export function foldActions(widths: number[], available: number, o: { gap: number; more: number; priority?: boolean[] }): Fold {
  const all = widths.map((_, i) => i);
  const total = widths.reduce((s, w) => s + w, 0) + o.gap * Math.max(0, widths.length - 1);
  if (total <= available) return { shown: all, folded: [] };
  const room = available - o.more - o.gap; // what the buttons may take once the More button is there
  const keep = new Set<number>();
  let used = 0;
  const add = (i: number) => {
    const next = keep.size ? used + o.gap + widths[i] : widths[i];
    if (next > room) return false;
    keep.add(i);
    used = next;
    return true;
  };
  all.filter((i) => o.priority?.[i]).slice(0, 2).forEach(add);
  for (const i of all) {
    if (keep.has(i) || o.priority?.[i]) continue;
    if (!add(i)) break;
  }
  const shown = all.filter((i) => keep.has(i));
  return { shown, folded: all.filter((i) => !keep.has(i)) };
}
