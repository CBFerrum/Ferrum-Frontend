import { describe, expect, it } from "vitest";
import { splitErrors } from "./ActionDialog";

describe("an action's refusal", () => {
  const params = [{ name: "reason", label: "Reason", type: "text" as const }];

  it("shows errors on its parameters beside them, and the rest as words", () => {
    const { own, others } = splitErrors(
      [
        { field: "reason", message: "is required" },
        { field: "warehouse", message: "is required", row: ["items", 0] },
        { field: "customer", message: "is on hold" },
      ],
      params,
    );
    expect(own).toEqual([{ field: "reason", message: "is required" }]);
    expect(others).toBe("row 1 warehouse: is required; customer: is on hold");
  });

  it("leaves nothing over when every error is its own", () => {
    expect(splitErrors([{ field: "reason", message: "is required" }], params).others).toBe("");
  });
});
