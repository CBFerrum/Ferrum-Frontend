import { describe, expect, it } from "vitest";
import {
  addItem,
  findSpot,
  mergeLayouts,
  moveBy,
  newId,
  normalize,
  phoneSpan,
  readingOrder,
  removeItem,
  resizeBy,
  tabletSpan,
  withIds,
  type Placed,
} from "./layout";

const md = (i: string, x: number, y: number, w: number, h: number): Placed => ({ type: "markdown", content: i, i, x, y, w, h });
const at = (items: Placed[], i: string) => {
  const it = items.find((x) => x.i === i)!;
  return [it.x, it.y, it.w, it.h];
};
const noOverlaps = (items: Placed[]) =>
  items.every((a, n) => items.slice(n + 1).every((b) => !(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)));
const inGrid = (items: Placed[]) => items.every((it) => it.x >= 0 && it.w >= 1 && it.x + it.w <= 12 && it.y >= 0 && it.h >= 1);

describe("ids", () => {
  it("assigns missing ids as the server does", () => {
    const items = withIds([
      { type: "markdown", content: "a", x: 0, y: 0, w: 6, h: 2 },
      { type: "markdown", content: "b", i: "w0", x: 6, y: 0, w: 6, h: 2 },
    ]);
    expect(items.map((x) => x.i)).toEqual(["w0_", "w0"]);
    expect(newId(items)).toBe("w2");
    expect(newId([{ i: "w1" }])).toBe("w2");
  });
});

describe("placing widgets", () => {
  const items = [md("a", 0, 0, 6, 4), md("b", 6, 0, 3, 2)];

  it("finds the first gap that fits, else the bottom", () => {
    expect(findSpot(items, 3, 2)).toEqual({ x: 9, y: 0 });
    expect(findSpot(items, 6, 2)).toEqual({ x: 6, y: 2 });
    expect(findSpot(items, 12, 1)).toEqual({ x: 0, y: 4 });
  });

  it("adds with the default size and a fresh id", () => {
    const [next, id] = addItem(items, { type: "card", card: "c1" });
    expect(id).toBe("w2");
    expect(at(next, id)).toEqual([9, 0, 3, 4]);
    expect(noOverlaps(next)).toBe(true);
  });

  it("removes and lets the rest float up", () => {
    const next = removeItem([md("a", 0, 0, 12, 2), md("b", 0, 2, 12, 2)], "a");
    expect(at(next, "b")).toEqual([0, 0, 12, 2]);
  });

  it("normalizes into the grid without overlaps", () => {
    const next = normalize([md("a", 10, 0, 6, 2), md("b", 0, 0, 12, 2)]);
    expect(inGrid(next) && noOverlaps(next)).toBe(true);
    expect(at(next, "a")).toEqual([6, 2, 6, 2]); // clamped into the grid, then below the widget it covered
  });
});

describe("keyboard moves", () => {
  const items = [md("a", 0, 0, 6, 4), md("b", 6, 0, 6, 4), md("c", 0, 4, 12, 2)];

  it("moves sideways within the grid, pushing what it lands on down", () => {
    expect(at(moveBy(items, "a", -1, 0), "a")).toEqual([0, 0, 6, 4]);
    const right = moveBy(items, "a", 6, 0);
    expect(at(right, "a")).toEqual([6, 0, 6, 4]);
    expect(noOverlaps(right) && inGrid(right)).toBe(true);
  });

  it("moves down past the widget below, and back up", () => {
    const down = moveBy(items, "a", 0, 1);
    expect(at(down, "a")[1]).toBe(at(down, "c")[1] + 2); // now below the full-width widget
    expect(noOverlaps(down)).toBe(true);
    const up = moveBy(down, "a", 0, -1);
    expect(noOverlaps(up)).toBe(true);
    expect(at(up, "a")[1]).toBeLessThan(at(down, "a")[1]);
  });

  it("does nothing at the bottom", () => {
    expect(moveBy(items, "c", 0, 1)).toEqual(items);
  });

  it("resizes within the grid and the widget's minimum, neighbours making way", () => {
    const wider = resizeBy(items, "a", 2, 0);
    expect(at(wider, "a")).toEqual([0, 0, 8, 4]);
    expect(noOverlaps(wider) && inGrid(wider)).toBe(true);
    expect(at(resizeBy(items, "b", 3, 0), "b")).toEqual([3, 0, 9, 4]); // grows leftward at the edge
    const chart: Placed = { type: "chart", chart: "c1", i: "k", x: 0, y: 0, w: 3, h: 5 };
    expect(at(resizeBy([chart], "k", -1, -1), "k")).toEqual([0, 0, 3, 5]);
    const taller = resizeBy(items, "a", 0, 2);
    expect(at(taller, "a")).toEqual([0, 0, 6, 6]);
    expect(at(taller, "c")[1]).toBe(6);
  });
});

describe("narrow screens", () => {
  it("orders by row, then column, and widens widgets", () => {
    expect(readingOrder([md("b", 6, 0, 6, 2), md("c", 0, 3, 6, 2), md("a", 0, 0, 6, 2)]).map((x) => x.i)).toEqual(["a", "b", "c"]);
    expect([tabletSpan(3), tabletSpan(4), tabletSpan(8)]).toEqual([6, 8, 12]);
    expect([phoneSpan(2), phoneSpan(4), phoneSpan(5)]).toEqual([1, 1, 2]);
  });
});

describe("merging with a newer version", () => {
  const base = [md("a", 0, 0, 6, 2), md("b", 6, 0, 6, 2), md("c", 0, 2, 6, 2)];

  it("keeps my changes and theirs", () => {
    const mine = [{ ...base[0], content: "mine" }, base[1], md("n", 6, 2, 6, 2)]; // edited a, removed c, added n
    const theirs = [base[0], { ...base[1], content: "theirs" }, base[2], md("t", 0, 4, 12, 2)]; // edited b, added t
    const merged = mergeLayouts(base, mine, theirs);
    expect(merged.map((x) => [x.i, (x as { content: string }).content])).toEqual([
      ["a", "mine"],
      ["b", "theirs"],
      ["n", "n"],
      ["t", "t"],
    ]);
    expect(noOverlaps(merged)).toBe(true);
  });

  it("keeps a widget I changed that they removed, drops one I left alone", () => {
    const mine = [{ ...base[0], content: "kept" }, base[1], base[2]];
    const theirs = [base[2]];
    expect(mergeLayouts(base, mine, theirs).map((x) => x.i)).toEqual(["a", "c"]);
  });
});
