import { describe, expect, it } from "vitest";
import { moreOf } from "./edgeCue";

const row = (scrollWidth: number, clientWidth: number, scrollLeft: number) => ({ scrollWidth, clientWidth, scrollLeft });

describe("moreOf: which edges of a sideways-scrolling row have more", () => {
  it("is empty when the row fits", () => {
    expect(moreOf(row(300, 300, 0))).toBe("");
    expect(moreOf(row(301, 300, 0))).toBe(""); // a pixel of rounding is not overflow
  });
  it("says there is more after, at rest", () => expect(moreOf(row(388, 356, 0))).toBe("end"));
  it("says there is more on both sides in the middle", () => expect(moreOf(row(388, 356, 16))).toBe("both"));
  it("says there is more before, at the end", () => {
    expect(moreOf(row(388, 356, 32))).toBe("start");
    expect(moreOf(row(388, 356, 31.4))).toBe("start"); // fractional scroll positions
  });
  it("reads the same right to left, where scrollLeft is negative", () => {
    expect(moreOf(row(388, 356, 0))).toBe("end");
    expect(moreOf(row(388, 356, -16))).toBe("both");
    expect(moreOf(row(388, 356, -32))).toBe("start");
  });
});
