import { describe, expect, it } from "vitest";
import { describeOp, shownValue } from "./Customize";

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

describe("how the list of changes words a button", () => {
  it("names an added and a removed button", () => {
    expect(describeOp({ op: "add_action", action: { name: "x_stop", label: "Stop it" } })).toBe("Button: Stop it");
    expect(describeOp({ op: "add_action", action: { name: "x_stop" } })).toBe("Button: x_stop");
    expect(describeOp({ op: "remove_action", name: "x_stop" })).toBe("Remove button x_stop");
  });
});
