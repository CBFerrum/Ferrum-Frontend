// What a record page says when an action has run.

import { describe, expect, it } from "vitest";
import { actionToast } from "./FormView";

describe("an action's toast", () => {
  it("is the action's own message when it gives one", () => {
    expect(actionToast("Recognise Deferred Revenue and Expense", { lines: 1, message: "1 deferred line recognised through 2026-10-31" })).toBe(
      "1 deferred line recognised through 2026-10-31",
    );
  });

  it("says the action is done otherwise", () => {
    for (const res of [null, undefined, "ok", { message: "  " }, { message: 3 }, { file: { name: "a.xml" } }]) {
      expect(actionToast("Bank Payment File", res)).toBe("Bank Payment File: done");
    }
  });
});
