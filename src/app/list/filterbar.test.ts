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

  it("name the word a filter uses", () => {
    expect(chipText(field("date"), "@last_30")).toBe("Last 30 days");
    expect(chipText(field("link"), "@empty")).toBe("is empty");
    expect(chipText(field("select"), "@set")).toBe("has a value");
  });

  it("say how a number is compared", () => {
    expect(chipText(field("currency"), ">=100")).toBe("at least 100");
    expect(chipText(field("int"), "<5")).toBe("under 5");
    expect(chipText(field("decimal"), "1..2")).toBe("1 – 2");
    expect(chipText(field("decimal"), "..2")).toBe("at most 2");
    expect(chipText(field("int"), "7")).toBe("7");
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
