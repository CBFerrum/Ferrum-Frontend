import { describe, expect, it } from "vitest";
import { joinRange, readFilters, serializeFilters, splitRange, toApiFilters, writeFilters } from "./filters";

const fields = [
  { name: "status", type: "select" },
  { name: "customer", type: "link" },
  { name: "is_return", type: "check" },
  { name: "posting_date", type: "date" },
  { name: "created_on", type: "datetime" },
  { name: "po_no", type: "data" },
  { name: "qty", type: "int" },
  { name: "rate", type: "currency" },
];

describe("toApiFilters", () => {
  it("serializes each filter type", () => {
    expect(
      toApiFilters(fields, {
        status: "Paid",
        customer: "01a1832f-b13f-7102-8759-1d2c43bbced8",
        is_return: "0",
        posting_date: "2026-01-01..2026-03-31",
        created_on: "2026-02-01..",
        po_no: "PO-1",
        qty: "5",
        rate: "12.50",
      }),
    ).toEqual([
      ["status", "=", "Paid"],
      ["customer", "=", "01a1832f-b13f-7102-8759-1d2c43bbced8"],
      ["is_return", "=", false],
      ["posting_date", ">=", "2026-01-01"],
      ["posting_date", "<=", "2026-03-31"],
      ["created_on", ">=", "2026-02-01T00:00:00.000Z"],
      ["po_no", "like", "%PO-1%"],
      ["qty", "=", 5],
      ["rate", "=", "12.50"],
    ]);
  });

  it("skips empty and invalid values", () => {
    expect(toApiFilters(fields, { status: "", is_return: "maybe", qty: "1.5", rate: "abc", posting_date: ".." })).toEqual([]);
    expect(toApiFilters(fields, { unknown: "x" })).toEqual([]);
  });

  it("handles open-ended date ranges", () => {
    expect(toApiFilters(fields, { posting_date: "..2026-12-31" })).toEqual([["posting_date", "<=", "2026-12-31"]]);
  });
});

describe("serializeFilters", () => {
  it("returns JSON or undefined", () => {
    expect(serializeFilters(fields, {})).toBeUndefined();
    expect(serializeFilters(fields, { is_return: "1" })).toBe('[["is_return","=",true]]');
  });
});

describe("URL round trip", () => {
  it("reads and writes filters while keeping other params", () => {
    const sp = new URLSearchParams("q=acme&sort=posting_date+desc&f.status=Paid");
    expect(readFilters(sp)).toEqual({ status: "Paid" });
    const next = writeFilters(sp, { status: "", posting_date: joinRange("2026-01-01", "") });
    expect(next.get("q")).toBe("acme");
    expect(next.get("sort")).toBe("posting_date desc");
    expect(next.has("f.status")).toBe(false);
    expect(next.get("f.posting_date")).toBe("2026-01-01..");
    expect(splitRange(next.get("f.posting_date") ?? "")).toEqual(["2026-01-01", ""]);
    expect(joinRange("", "")).toBe("");
  });
});
