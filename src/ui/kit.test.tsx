// Status colour comes from declared state ids, never from the words.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DOCSTATUS_TONE, docstatusTone, STATUS_TONES } from "../lib/statusTones";
import { StatusBadge, statusTone } from "./kit";

describe("statusTone", () => {
  it("does not read negations or unfamiliar words as good news", () => {
    for (const v of ["Not approved", "Not verified", "Unfamiliar thing", "Genehmigt", "已批准", "", null, undefined]) expect(statusTone(v)).toBe("neutral");
  });
  it("knows whole well-known ids, case-insensitively", () => {
    expect(statusTone("Unpaid")).toBe("amber");
    expect(statusTone("APPROVED")).toBe("green");
    expect(statusTone("Cancelled")).toBe("red");
    expect(statusTone("constructor")).toBe("neutral");
  });
  it("lets declared tones win, exactly", () => {
    expect(statusTone("Approved", { Approved: "purple" })).toBe("purple");
    expect(statusTone("Shipped", { Shipped: "green" })).toBe("green");
    expect(statusTone("approved", { Approved: "purple" })).toBe("green");
  });
  it("keeps the built-in table as intended", () => {
    expect(STATUS_TONES).toMatchSnapshot();
  });
  it("maps the numeric docstatus", () => {
    expect([0, 1, 2, 3].map(docstatusTone)).toEqual(["neutral", "green", "red", "neutral"]);
    expect(DOCSTATUS_TONE).toHaveLength(3);
  });
});

describe("StatusBadge", () => {
  it("shows the label with the tone of the value", () => {
    const html = renderToString(<StatusBadge value="Paid" label="Bezahlt" />);
    expect(html).toContain("badge-green");
    expect(html).toContain("Bezahlt");
  });
  it("is neutral for a value it does not know", () => {
    expect(renderToString(<StatusBadge value="Not approved" />)).toContain("badge-neutral");
  });
});
