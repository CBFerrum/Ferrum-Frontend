// What a save on Admin's Interface words page does with each word.

import { describe, expect, it } from "vitest";
import { change } from "./InterfaceWords";

describe("a word on the interface words page", () => {
  it("is made, changed, removed or left as it was", () => {
    const kept = { id: "w1", version: 1, words: "حفظ" };
    expect(change(undefined, "احفظ")).toBe("create");
    expect(change(undefined, "   ")).toBeNull();
    expect(change(kept, "حفظ")).toBeNull();
    expect(change(kept, " احفظ ")).toBe("update");
    expect(change(kept, "")).toBe("delete");
  });
});
