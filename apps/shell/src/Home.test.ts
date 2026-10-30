import { describe, expect, it } from "vitest";
import { tileColour } from "./Home";

describe("tileColour", () => {
  it("keeps an app's own colour and derives the bar launcher's from the name otherwise", () => {
    expect(tileColour({ color: "#2563eb", title: "Mail" })).toBe("#2563eb");
    // hsl(0 55% 42%), what the bar draws for a title hashing to 0; "#bad" is not #rrggbb.
    expect(tileColour({ color: "#bad", title: "" })).toBe("#a63030");
    expect(tileColour({ color: null, title: "Helpdesk" })).toMatch(/^#[0-9a-f]{6}$/);
  });
});
