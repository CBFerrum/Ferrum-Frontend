import { describe, expect, it } from "vitest";
import { toChart, type QueryResult } from "@/lib/studio";
import { bucketEnd, compactTick, describeChart, formatPeriod, formatShare, toHeat, toScatter, toSingle, toSlices } from "./charts";
import { listParams, pointFilters, zonedMidnight } from "./drill";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

const en = { locale: "en-US" };

// Shapes as the dev backend returns them.
const byStatus: QueryResult = {
  columns: [
    { field: "status", label: "Status", name: "status", role: "dimension", type: "select", options: ["Draft", "Unpaid", "Paid"] },
    { field: "grand_total", fn: "sum", label: "Sum of Grand Total", name: "sum(grand_total)", role: "measure", type: "currency" },
  ],
  rows: [
    { status: "Draft", "sum(grand_total)": "0" },
    { status: "Paid", "sum(grand_total)": "0.1" },
    { status: "Unpaid", "sum(grand_total)": "0.2" },
    { status: null, "sum(grand_total)": "21240" },
  ],
  totals: { "sum(grand_total)": "21240.3" },
  meta: { entity: "SalesInvoice", timezone: "UTC", sql_ms: 1, truncated: false, row_count: 4 },
};

const daily: QueryResult = {
  columns: [
    { bucket: "day", field: "posting_date", label: "Posting Date (Day)", name: "day(posting_date)", role: "dimension", type: "date" },
    { fn: "count", label: "Count", name: "count", role: "measure", type: "int" },
    { field: "grand_total", fn: "sum", label: "Sum of Grand Total", name: "sum(grand_total)", role: "measure", type: "currency" },
  ],
  rows: [
    { "day(posting_date)": "2026-10-28", count: 4, "sum(grand_total)": "23277.28" },
    { "day(posting_date)": "2026-10-29", count: 0, "sum(grand_total)": "0" },
    { "day(posting_date)": "2026-11-02", count: 1, "sum(grand_total)": "100" },
  ],
  totals: { count: 5, "sum(grand_total)": "23377.28" },
  meta: { entity: "SalesInvoice", timezone: "UTC", sql_ms: 1, truncated: false, row_count: 3 },
};

describe("slices", () => {
  it("sorts pie slices, drops what is not positive and folds the rest exactly", () => {
    const m = toSlices(byStatus, { ...en, kind: "pie", max: 2 });
    expect(m.slices.map((s) => [s.label, s.text])).toEqual([
      ["(not set)", "21,240.00"],
      ["Other (2)", "0.30"],
    ]);
    expect(m.total).toBe("21,240.30");
    expect(Math.round(m.slices[0].share)).toBe(100);
  });

  it("keeps a funnel's order and every stage", () => {
    expect(toSlices(byStatus, { ...en, kind: "funnel" }).slices.map((s) => s.label)).toEqual(["Draft", "Paid", "Unpaid", "(not set)"]);
    expect([formatShare(0.04, "en-US"), formatShare(12.345, "en-US")]).toEqual(["<0.1%", "12.3%"]);
  });
});

describe("other chart shapes", () => {
  it("lays days out as calendar weeks, Monday first", () => {
    const h = toHeat(daily, en);
    expect(h.calendar).toBe(true);
    expect(h.weeks).toHaveLength(2);
    expect(h.weeks[0].map((c) => c?.date ?? null)).toEqual([null, null, "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(h.weeks[1][0]).toMatchObject({ date: "2026-11-02", level: 1, text: "1" });
    expect(h.weeks[0][2]).toMatchObject({ level: 4, text: "4" });
    expect(h.weeks[0][4]).toMatchObject({ level: 0, text: "0" });
  });

  it("plots two measures against each other and finds a single value", () => {
    const s = toScatter(daily, en);
    expect(s.points.map((p) => [p.x, p.y, p.label])).toEqual([
      [4, 23277.28, "Oct 28, 2026"],
      [0, 0, "Oct 29, 2026"],
      [1, 100, "Nov 2, 2026"],
    ]);
    expect(toSingle(daily, { ...en, y: ["sum(grand_total)"] }).text).toBe("23,377.28");
  });

  it("describes a chart in one sentence", () => {
    const text = describeChart("bar", toChart(byStatus, en), "Sales by status", en);
    expect(text).toBe("Sales by status: bar chart of Sum of Grand Total by Status. Draft 0.00; Paid 0.10; Unpaid 0.20; (not set) 21,240.00.");
  });

  it("formats ticks, period ends and periods", () => {
    expect([compactTick(1234, "en-US"), compactTick("2500000", "en-US"), compactTick(12.5, "en-US"), compactTick("x")]).toEqual(["1.2K", "2.5M", "12.5", "x"]);
    expect([bucketEnd("2026-10-01", "month"), bucketEnd("2026-04-01", "fiscal_quarter"), bucketEnd("2026-10-26", "week"), bucketEnd("2025-01-01", "year"), bucketEnd("2026-02-03", "day")]).toEqual([
      "2026-10-31",
      "2026-06-30",
      "2026-11-01",
      "2025-12-31",
      "2026-02-03",
    ]);
    expect(formatPeriod("2026-10-01", "2026-10-29", "en-US").replace(/\s/g, " ")).toBe("Oct 1 – 29, 2026");
    expect(formatPeriod("2026-10-01", null, "en-US")).toBe("From Oct 1, 2026");
  });
});

describe("drill-down", () => {
  const month = daily.columns[0];
  const typeOf = (p: string) => (p === "created_at" ? "datetime" : "date");

  it("turns a point into filters", () => {
    expect(
      pointFilters(
        [
          { column: { ...month, bucket: "month" }, value: "2026-10-01" },
          { column: byStatus.columns[0], value: "Paid" },
          { column: { name: "customer", label: "Customer", type: "link", role: "dimension", field: "customer" }, value: null },
        ],
        typeOf,
      ),
    ).toEqual([
      ["posting_date", "between", ["2026-10-01", "2026-10-31"]],
      ["status", "=", "Paid"],
      ["customer", "is", "not set"],
    ]);
    const created = { ...month, field: "created_at", bucket: "day" as const };
    expect(pointFilters([{ column: created, value: "2026-10-28" }], typeOf, "Asia/Kolkata")).toEqual([
      ["created_at", ">=", "2026-10-27T18:30:00.000Z"],
      ["created_at", "<", "2026-10-28T18:30:00.000Z"],
    ]);
    expect(zonedMidnight("2026-03-29", "Europe/Berlin")).toBe("2026-03-28T23:00:00.000Z");
  });

  it("says the same with list parameters only when the list can", () => {
    const fields = [
      { name: "status", type: "select", in_filter: true },
      { name: "posting_date", type: "date", in_filter: true },
      { name: "customer_name", type: "data", in_filter: true },
      { name: "remarks", type: "text" },
    ];
    expect(listParams([["status", "=", "Paid"], ["posting_date", ">=", "2026-10-01"], ["posting_date", "<=", "2026-10-31"]], fields)?.toString()).toBe(
      "f.status=Paid&f.posting_date=2026-10-01..2026-10-31",
    );
    expect(listParams([["posting_date", "between", ["2026-01-01", "2026-10-29"]]], fields)?.toString()).toBe("f.posting_date=2026-01-01..2026-10-29");
    expect(listParams([["customer_name", "=", "Acme"]], fields)).toBeNull(); // the list searches text by "contains"
    expect(listParams([["remarks", "=", "x"]], fields)).toBeNull();
    expect(listParams([["status", "in", ["Paid"]]], fields)).toBeNull();
    expect(listParams([], fields)?.toString()).toBe("");
  });
});

describe("markdown", () => {
  it("parses blocks", () => {
    expect(parseMarkdown("# Sales\n\nThis **month**\nonly.\n\n- one\n- two\n  more\n1. first\n\n> note\n---")).toEqual([
      { t: "h", level: 1, c: [{ t: "text", v: "Sales" }] },
      { t: "p", c: [{ t: "text", v: "This " }, { t: "b", c: [{ t: "text", v: "month" }] }, { t: "text", v: " only." }] },
      { t: "ul", items: [[{ t: "text", v: "one" }], [{ t: "text", v: "two more" }]] },
      { t: "ol", items: [[{ t: "text", v: "first" }]] },
      { t: "quote", c: [{ t: "text", v: "note" }] },
      { t: "hr" },
    ]);
  });

  it("keeps links safe and snake_case words whole", () => {
    expect(parseInline("[open](/app/e/Lead) [x](javascript:alert(1)) `a*b` _it_ snake_case_name")).toEqual([
      { t: "a", href: "/app/e/Lead", c: [{ t: "text", v: "open" }] },
      { t: "text", v: " x) " }, // the unsafe link stays text
      { t: "code", v: "a*b" },
      { t: "text", v: " " },
      { t: "i", c: [{ t: "text", v: "it" }] },
      { t: "text", v: " snake_case_name" },
    ]);
    expect([safeHref("https://ferrum.dev/x"), safeHref("//evil.com"), safeHref("data:text/html,x"), safeHref("mailto:a@b.c")]).toEqual([
      "https://ferrum.dev/x",
      null,
      null,
      "mailto:a@b.c",
    ]);
  });
});
