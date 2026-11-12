import { describe, expect, it } from "vitest";
import { foldActions } from "./selectionFold";

const o = { gap: 8, more: 70 };
describe("foldActions", () => {
  it("keeps everything that fits, with no More", () => {
    expect(foldActions([80, 90, 100], 300, o)).toEqual({ shown: [0, 1, 2], folded: [] }); // 270 + 16 = 286
    expect(foldActions([], 0, o)).toEqual({ shown: [], folded: [] });
  });
  it("folds from the end, keeping room for More", () => {
    // room = 285 - 70 - 8 = 207: 80, 80+8+90 = 178, +8+100 = 286 does not fit
    expect(foldActions([80, 90, 100, 60], 285, o)).toEqual({ shown: [0, 1], folded: [2, 3] });
  });
  it("stops at the first that does not fit: a short later action does not jump ahead", () => {
    expect(foldActions([80, 200, 20], 250, o)).toEqual({ shown: [0], folded: [1, 2] });
  });
  it("keeps up to two priority actions first, in their place", () => {
    const r = foldActions([80, 90, 100, 60], 285, { ...o, priority: [false, false, false, true] });
    expect(r).toEqual({ shown: [0, 3], folded: [1, 2] }); // 60, then 60+8+80 = 148, +8+90 = 246 > 207
    const three = foldActions([80, 90, 100, 60], 200, { ...o, priority: [true, true, true, false] });
    expect(three.shown).toEqual([0]); // room 122: 80, then 80+8+90 = 178 > 122; the third mark is ignored
  });
  it("folds a priority action too when even it does not fit; only More is left", () => {
    expect(foldActions([300, 90], 150, { ...o, priority: [true, false] })).toEqual({ shown: [], folded: [0, 1] });
  });
  it("is stable when the width is exactly enough", () => {
    expect(foldActions([100, 100], 208, o).folded).toEqual([]);
    expect(foldActions([100, 100], 207, o).folded).toEqual([1]);
  });
});
