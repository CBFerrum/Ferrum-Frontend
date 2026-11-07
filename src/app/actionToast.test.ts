// What a record page says when an action has run.

import { describe, expect, it } from "vitest";
import { actionToast, shownOnce } from "./FormView";

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

describe("an action's once-shown answer", () => {
  it("is its link, code, token or secret, kept for the dialog rather than lost in a toast", () => {
    expect(shownOnce({ link: "https://x.test/s/abc", note: "Shown once: copy it now", downloads: 5 })).toEqual([{ name: "link", value: "https://x.test/s/abc" }]);
    expect(shownOnce({ code: "1234-5678", note: "Shown once" })).toEqual([{ name: "code", value: "1234-5678" }]);
    expect(shownOnce({ message: "Archived" })).toEqual([]);
    expect(shownOnce({ link: "" })).toEqual([]);
    expect(shownOnce(null)).toEqual([]);
  });
});
