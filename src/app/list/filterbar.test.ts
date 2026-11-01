import { describe, expect, it } from "vitest";
import type { Field } from "../../lib/meta";
import { chipText } from "./FilterBar";
import { inlineEditable, savesOnChange } from "./RecordPeek";

const field = (type: string) => ({ name: "x", label: "X", type }) as Field;

describe("filter chips", () => {
  it("say what a filter narrows the list to", () => {
    expect(chipText(field("check"), "1")).toBe("Yes");
    expect(chipText(field("check"), "0")).toBe("No");
    expect(chipText(field("select"), "Open")).toBe("Open");
  });

  it("show a date range by which ends it has", () => {
    expect(chipText(field("date"), "2026-01-01..2026-01-31")).toBe("2026-01-01 – 2026-01-31");
    expect(chipText(field("date"), "2026-01-01..2026-01-01")).toBe("2026-01-01");
    expect(chipText(field("date"), "2026-01-01..")).toBe("from 2026-01-01");
    expect(chipText(field("datetime"), "..2026-01-31")).toBe("until 2026-01-31");
    expect(chipText(field("date"), "")).toBe("");
  });
});

describe("editing beside the list", () => {
  it("leaves rows, files and long content to the full form", () => {
    for (const type of ["table", "attach", "image", "secret"]) expect(inlineEditable(field(type))).toBe(false);
    for (const type of ["data", "select", "link", "date", "currency", "check"]) expect(inlineEditable(field(type))).toBe(true);
  });

  it("saves a choice at once, and typing when the person leaves the field", () => {
    for (const type of ["select", "link", "check", "date"]) expect(savesOnChange(field(type))).toBe(true);
    for (const type of ["data", "int", "currency", "text"]) expect(savesOnChange(field(type))).toBe(false);
  });
});
