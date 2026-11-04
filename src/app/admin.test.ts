import { describe, expect, it } from "vitest";
import { conditionValues, size } from "./Admin";

describe("permission conditions", () => {
  it("types the values typed for a field", () => {
    expect(conditionValues("select", " Individual, Company ,")).toEqual(["Individual", "Company"]);
    expect(conditionValues("check", "false")).toEqual([false]);
    expect(conditionValues("int", "3, x, 4")).toEqual([3, 4]);
  });
});

describe("sizes", () => {
  it("reads as the largest unit under 1024", () => {
    expect(size(0)).toMatch(/^0\s?bytes$/);
    expect(size(1536)).toMatch(/^1\.5\s?kB/);
    expect(size(10 * 1024 ** 3)).toMatch(/^10\s?GB/);
  });
});
