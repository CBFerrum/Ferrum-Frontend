import { describe, expect, it } from "vitest";
import { placeMenu, type Edges } from "./menuPlacement";

const view = { width: 390, height: 800 };
const at = (left: number, top: number, w = 40, h = 32): Edges => ({ left, top, right: left + w, bottom: top + h });
const menu = { width: 220, height: 200 };

describe("placeMenu", () => {
  it("opens below, its end edge on the trigger's, when there is room", () => {
    expect(placeMenu(at(300, 100), menu, view, { align: "end", rtl: false })).toMatchObject({ left: 120, top: 136, side: "below", maxHeight: 200 });
  });
  it("opens from the start edge for align start, flipped in right to left", () => {
    expect(placeMenu(at(100, 100), menu, view, { align: "start", rtl: false }).left).toBe(100);
    expect(placeMenu(at(100, 100), menu, view, { align: "start", rtl: true }).left).toBe(8); // right edge 140 - 220 = -80, shifted in
    expect(placeMenu(at(200, 100), menu, view, { align: "start", rtl: true }).left).toBe(20); // 240 - 220
    expect(placeMenu(at(100, 100), menu, view, { align: "end", rtl: true }).left).toBe(100);
  });
  it("never leaves the window sideways: a trigger near the left edge (the ERP list at 390)", () => {
    const p = placeMenu(at(100, 100), menu, view, { align: "end", rtl: false }); // end-aligned: 140 - 220 = -80
    expect(p.left).toBe(8);
    const right = placeMenu(at(360, 100, 24), menu, view, { align: "start", rtl: false }); // would run past the right edge
    expect(right.left + right.width).toBeLessThanOrEqual(382);
    expect(right.left).toBe(162);
  });
  it("is as wide as the window allows at 320", () => {
    const p = placeMenu(at(10, 50), { width: 360, height: 100 }, { width: 320, height: 600 }, { align: "start", rtl: false });
    expect(p.width).toBe(304);
    expect(p.left).toBe(8);
  });
  it("flips above when there is more room above", () => {
    const p = placeMenu(at(100, 700), menu, view, { align: "start", rtl: false }); // below: 800-732-4-8 = 56; above: 700-12 = 688
    expect(p.side).toBe("above");
    expect(p.top).toBe(700 - 4 - 200);
    expect(p.maxHeight).toBe(200);
  });
  it("caps the height to the side with more room and scrolls inside it", () => {
    const p = placeMenu(at(100, 150), { width: 220, height: 900 }, view, { align: "start", rtl: false }); // below 800-182-12 = 606, above 138-... = 138
    expect(p.side).toBe("below");
    expect(p.maxHeight).toBe(606);
    expect(p.top).toBe(186);
    const short = placeMenu(at(100, 300), { width: 220, height: 900 }, { width: 390, height: 420 }, { align: "start", rtl: false }); // below 420-332-12 = 76, above 300-12 = 288
    expect(short.side).toBe("above");
    expect(short.maxHeight).toBe(288);
    expect(short.top).toBe(8);
  });
  it("stays inside the window at every edge", () => {
    for (const [l, t] of [[0, 0], [350, 0], [0, 770], [350, 770], [195, 400]]) for (const rtl of [false, true]) for (const align of ["start", "end"] as const) {
      const p = placeMenu(at(l, t), menu, view, { align, rtl });
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.left + p.width).toBeLessThanOrEqual(382);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.top + p.maxHeight).toBeLessThanOrEqual(792);
    }
  });
});
