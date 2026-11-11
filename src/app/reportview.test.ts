import { describe, expect, it } from "vitest";
import { figureTone } from "./ReportView";

describe("figureTone", () => {
  it("marks a figure by its own value: zero recedes, a minus stands out, nothing is recomputed", () => {
    expect(["0.00", "0", "-0.00", 0].map(figureTone)).toEqual(["zero", "zero", "zero", "zero"]);
    expect(["-440.00", "-0.5", -3].map(figureTone)).toEqual(["neg", "neg", "neg"]);
    expect(["13,500.00", "13500.00", 2, "Asset", null, undefined, ""].map(figureTone)).toEqual([false, false, false, false, false, false, false]);
  });
});
