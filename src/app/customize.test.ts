import { describe, expect, it } from "vitest";
import { shownValue } from "./Customize";

describe("what an update changed under a customization", () => {
  it("is said in a few words", () => {
    expect(shownValue(null)).toBe("Not set");
    expect(shownValue("Serial number")).toBe("Serial number");
    expect(shownValue(true)).toBe("true");
    // A workflow by its states; a print template by its length.
    expect(shownValue({ name: "Tickets", states: [{ name: "Open" }, { name: "Waiting" }, { name: "Closed" }] })).toBe("Open, Waiting, Closed");
    expect(shownValue(`<p>${"x".repeat(200)}</p>`)).toBe("207 characters");
    expect(shownValue({ form: { tabs: ["x".repeat(100)] } })).toMatch(/…$/);
  });
});
