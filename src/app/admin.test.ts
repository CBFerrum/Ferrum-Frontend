import { describe, expect, it } from "vitest";
import { conditionValues } from "./Admin";

describe("permission conditions", () => {
  it("types the values typed for a field", () => {
    expect(conditionValues("select", " Individual, Company ,")).toEqual(["Individual", "Company"]);
    expect(conditionValues("check", "false")).toEqual([false]);
    expect(conditionValues("int", "3, x, 4")).toEqual([3, 4]);
  });
});
