import { describe, expect, it } from "vitest";
import { parseCsv, separatorOf, toCsv } from "./csv";
import { buildRecords, cellValue, guessMapping, importable, missingRequired } from "./importing";
import type { Field } from "./meta";

const f = (name: string, type: string, extra: Partial<Field> = {}) => ({ name, label: name.replace(/_/g, " "), type, can_read: true, can_write: true, ...extra }) as Field;

describe("reading a CSV file", () => {
  it("handles quotes, doubled quotes and line breaks in a field", () => {
    expect(parseCsv('name,note\n"Acme, Inc","said ""hi""\nthen left"\n')).toEqual([
      ["name", "note"],
      ["Acme, Inc", 'said "hi"\nthen left'],
    ]);
  });

  it("drops a byte-order mark, and blank lines, and takes CRLF", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n\r\n,\r\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("finds the separator a spreadsheet used", () => {
    expect(separatorOf("name;city\nAsha;Pune")).toBe(";");
    expect(separatorOf("name\tcity")).toBe("\t");
    expect(separatorOf('"a;b",c\n')).toBe(",");
    expect(separatorOf("name")).toBe(",");
    expect(parseCsv("name;city\nAsha;Pune")).toEqual([["name", "city"], ["Asha", "Pune"]]);
  });

  it("writes back what it can read", () => {
    const rows = [["a", 'b"c'], ["d,e", "f\ng"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("matching columns to fields", () => {
  const fields = [f("customer_name", "data"), f("email_id", "data", { label: "Email" }), f("city", "data")];
  it("matches by label or name, ignoring case and punctuation", () => {
    expect(guessMapping(["Customer Name", "EMAIL", "Notes"], fields)).toEqual(["customer_name", "email_id", null]);
    expect(guessMapping(["customer-name"], fields)).toEqual(["customer_name"]);
  });
  it("uses a field once", () => {
    expect(guessMapping(["City", "city"], fields)).toEqual(["city", null]);
  });
  it("offers only what a person can fill", () => {
    const all = [f("a", "data"), f("b", "table"), f("c", "data", { read_only: true }), f("d", "data", { can_write: false }), f("e", "data", { computed: "x" as never })];
    expect(importable(all).map((x) => x.name)).toEqual(["a"]);
  });
  it("names a required field nothing fills", () => {
    const req = [f("name", "data", { required: true }), f("kind", "select", { required: true, default: "A" })];
    expect(missingRequired(req, [null, null]).map((x) => x.name)).toEqual(["name"]);
  });
});

describe("what a cell becomes", () => {
  it("reads numbers without losing them to floating point", () => {
    expect(cellValue(f("n", "currency"), "1,234.50")).toEqual({ value: "1234.50" });
    expect(cellValue(f("n", "int"), "42")).toEqual({ value: 42 });
    expect("problem" in cellValue(f("n", "int"), "4.2")).toBe(true);
    expect("problem" in cellValue(f("n", "decimal"), "abc")).toBe(true);
  });
  it("takes yes and no however they are written", () => {
    expect(cellValue(f("c", "check"), "Yes")).toEqual({ value: true });
    expect(cellValue(f("c", "check"), "0")).toEqual({ value: false });
    expect("problem" in cellValue(f("c", "check"), "maybe")).toBe(true);
  });
  it("is strict about dates, whose meaning a guess could change", () => {
    expect(cellValue(f("d", "date"), "2026-03-04")).toEqual({ value: "2026-03-04" });
    expect("problem" in cellValue(f("d", "date"), "03/04/2026")).toBe(true);
  });
  it("matches a choice ignoring case, and names the choices when it fails", () => {
    const s = f("s", "select", { options: ["Open", "Closed"] });
    expect(cellValue(s, "open")).toEqual({ value: "Open" });
    const wrong = cellValue(s, "Lost");
    expect("problem" in wrong && wrong.problem).toContain("Open, Closed");
  });
  it("takes empty as nothing", () => {
    expect(cellValue(f("n", "int"), "  ")).toEqual({ value: null });
  });
});

describe("building records", () => {
  const fields = [f("name", "data", { required: true }), f("group", "link", { to: "Group" }), f("limit", "decimal")];
  const mapping = ["name", "group", "limit"];
  const links = { group: new Map([["retail", "id-1"]]) };

  it("keeps good rows and says exactly what is wrong with the others, by spreadsheet row", () => {
    const { records, problems } = buildRecords([["Asha", "Retail", "100"], ["", "Retail", ""], ["Ravi", "Wholesale", "abc"]], mapping, fields, links);
    expect(records).toEqual([{ row: 2, doc: { name: "Asha", group: "id-1", limit: "100" } }]);
    expect(problems).toEqual([
      { row: 3, field: "name", message: "is required" },
      { row: 4, field: "group", message: 'no record called "Wholesale"' },
      { row: 4, field: "limit", message: '"abc" is not a number' },
    ]);
  });

  it("finds a linked record whatever the case, and leaves unmapped columns alone", () => {
    const { records } = buildRecords([["Asha", "RETAIL", "ignored"]], ["name", "group", null], fields, links);
    expect(records[0].doc).toEqual({ name: "Asha", group: "id-1" });
  });

  it("copes with a short row", () => {
    expect(buildRecords([["Asha"]], mapping, fields, links).records[0].doc).toEqual({ name: "Asha" });
  });
});
