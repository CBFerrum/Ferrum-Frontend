import { afterEach, describe, expect, it, vi } from "vitest";
import { parseApiError } from "./api";
import {
  buildSpec,
  chartIssues,
  columnLabel,
  DATE_PRESETS,
  draftFromSpec,
  emptyDraft,
  fieldIssues,
  formatBucket,
  formatCardValue,
  formatCell,
  formatChange,
  groupRows,
  issuesAt,
  presetOf,
  resolveDate,
  retryTransient,
  ruleColor,
  runtimeQuery,
  sameObject,
  specIssues,
  studio,
  sumDecimal,
  toChart,
  totalsLine,
  type FieldCatalog,
  type QueryResult,
  type ResultColumn,
  type SpecDraft,
} from "./studio";

const en = { locale: "en-US" };

// Shapes as the dev backend returns them (POST /api/app/studio/query).
const byCustomer: QueryResult = {
  columns: [
    { field: "customer", label: "Customer", name: "customer", role: "dimension", to: "Customer", type: "link" },
    { fn: "count", label: "Count", name: "count", role: "measure", type: "int" },
    { field: "grand_total", fn: "sum", label: "Sum of Grand Total", name: "sum(grand_total)", role: "measure", type: "currency" },
    { field: "grand_total", fn: "avg", label: "Average of Grand Total", name: "avg(grand_total)", role: "measure", type: "currency" },
  ],
  rows: [
    { _titles: { customer: "Acme Traders" }, "avg(grand_total)": "1018.64", count: 3, customer: "c-acme", "sum(grand_total)": "2037.28" },
    { _titles: { customer: "Bharat Retail" }, "avg(grand_total)": "21240", count: 1, customer: "c-bharat", "sum(grand_total)": "21240" },
  ],
  totals: { "avg(grand_total)": "7759.093333333", count: 4, "sum(grand_total)": "23277.28" },
  meta: { entity: "SalesInvoice", row_count: 2, sql_ms: 5.3, timezone: "UTC", truncated: false },
};

const weekly = (fn: "sum" | "avg"): QueryResult => ({
  columns: [
    { bucket: "week", field: "posting_date", label: "Posting Date (Week)", name: "week(posting_date)", role: "dimension", type: "date" },
    { field: "status", label: "Status", name: "status", role: "dimension", type: "select" },
    { field: "grand_total", fn, label: "Sum of Grand Total", name: `${fn}(grand_total)`, role: "measure", type: "currency" },
  ],
  rows: [
    { "week(posting_date)": "2026-10-19", status: "Draft", [`${fn}(grand_total)`]: "100" },
    { "week(posting_date)": "2026-10-26", status: "Draft", [`${fn}(grand_total)`]: "1593" },
    { "week(posting_date)": "2026-10-26", status: "Partly Paid", [`${fn}(grand_total)`]: "21240" },
    { "week(posting_date)": "2026-10-26", status: null, [`${fn}(grand_total)`]: "0.5" },
  ],
  totals: null,
  meta: { entity: "SalesInvoice", row_count: 4, sql_ms: 6.2, timezone: "UTC", truncated: false },
});

const pivot: QueryResult = {
  columns: [
    { field: "customer", label: "Customer", name: "customer", role: "dimension", to: "Customer", type: "link" },
    { label: "Partly Paid", measure: "sum(grand_total)", name: "sum(grand_total)@0", pivot_label: "Partly Paid", pivot_value: "Partly Paid", role: "pivot", type: "currency" },
    { label: "Draft", measure: "sum(grand_total)", name: "sum(grand_total)@1", pivot_label: "Draft", pivot_value: "Draft", role: "pivot", type: "currency" },
    { field: "grand_total", fn: "sum", label: "Total · Sum of Grand Total", name: "sum(grand_total)", role: "measure", type: "currency" },
  ],
  rows: [{ _titles: { customer: "Bharat Retail" }, customer: "c-bharat", "sum(grand_total)": "21240", "sum(grand_total)@0": "21240", "sum(grand_total)@1": "0" }],
  totals: { "sum(grand_total)": "21240", "sum(grand_total)@0": "21240", "sum(grand_total)@1": "0" },
  meta: { entity: "SalesInvoice", row_count: 1, sql_ms: 8.8, timezone: "UTC", truncated: false, pivot_columns: 2, pivot_truncated: false },
};

describe("buildSpec", () => {
  it("builds a table report: fields with trimmed labels, the period as a date range, nothing grouped", () => {
    const d: SpecDraft = {
      ...emptyDraft("SalesInvoice"),
      fields: [{ field: "customer" }, { field: "grand_total", label: " Total " }],
      group_by: [{ field: "status" }],
      period: { field: "posting_date", from: "start_of_month", to: "" },
      sort: [{ by: "posting_date", dir: "desc" }],
      limit: 50,
      compare: "previous_period",
    };
    expect(buildSpec(d)).toEqual({
      entity: "SalesInvoice",
      fields: [{ field: "customer" }, { field: "grand_total", label: "Total" }],
      date_range: { field: "posting_date", from: "start_of_month" },
      sort: [{ by: "posting_date", dir: "desc" }],
      limit: 50,
    });
  });

  it("puts the period on the time axis and keeps incomplete rows in place", () => {
    const d: SpecDraft = {
      ...emptyDraft("SalesInvoice", "chart"),
      search: "  acme ",
      group_by: [{ field: "status" }],
      measures: [{ fn: "count" }, { fn: "sum", field: " " }, { fn: "sum", field: "grand_total", label: "" }],
      time: { field: "posting_date", bucket: "week", fill_zero: true },
      period: { field: "due_date", from: "start_of_month", to: "today" },
      compare: "previous_period",
    };
    const spec = buildSpec(d);
    expect(spec).toEqual({
      entity: "SalesInvoice",
      search: "acme",
      group_by: [{ field: "status" }],
      measures: [{ fn: "count" }, { fn: "sum" }, { fn: "sum", field: "grand_total" }],
      time_series: { field: "posting_date", bucket: "week", from: "start_of_month", to: "today", fill_zero: true },
      compare: "previous_period",
    });
    expect(specIssues(spec)).toEqual([{ path: "measures[1].field", message: "Choose the field for sum" }]);
  });

  it("leaves compare out of pivots, which the server refuses", () => {
    const d: SpecDraft = {
      ...emptyDraft("SalesInvoice", "pivot"),
      group_by: [{ field: "customer" }],
      pivot: { field: "status", max_columns: 10 },
      period: { field: "posting_date", from: "2026-01-01", to: "2026-12-31" },
      compare: "previous_year",
    };
    expect(buildSpec(d)).toEqual({
      entity: "SalesInvoice",
      group_by: [{ field: "customer" }],
      measures: [{ fn: "count" }],
      pivot: { field: "status", max_columns: 10 },
      date_range: { field: "posting_date", from: "2026-01-01", to: "2026-12-31" },
    });
  });

  it("round-trips saved specs, converting object filters to the list form", () => {
    const spec = {
      entity: "SalesInvoice",
      filters: { status: "Paid", grand_total: [">", "10"] },
      group_by: [{ field: "customer", label: "Client" }],
      measures: [{ fn: "sum" as const, field: "grand_total" }],
      time_series: { field: "posting_date", bucket: "month" as const, from: "start_of_year", to: "today" },
      sort: [{ by: "sum(grand_total)", dir: "desc" as const }],
      limit: 100,
      compare: "previous_year" as const,
    };
    const d = draftFromSpec(spec);
    expect(d.kind).toBe("group_by");
    expect(d.time).toEqual({ field: "posting_date", bucket: "month", fill_zero: false });
    expect(d.period).toEqual({ field: "posting_date", from: "start_of_year", to: "today" });
    expect(buildSpec(d)).toEqual({ ...spec, filters: [["status", "=", "Paid"], ["grand_total", ">", "10"]] });
    expect(draftFromSpec({ entity: "X", pivot: { field: "a" }, measures: [{ fn: "count" }] }).kind).toBe("pivot");
    expect(draftFromSpec({ entity: "X", fields: [{ field: "a" }] }).kind).toBe("table");
  });
});

describe("specIssues", () => {
  const catalog = {
    fields: [
      { path: "created_at", label: "Created At", type: "datetime", group: "Sales Invoice", groupable: true, aggregates: ["count_distinct", "min", "max"], buckets: ["day"], bucket_required: true },
      { path: "customer", label: "Customer", type: "link", group: "Sales Invoice", groupable: true, aggregates: ["count_distinct"], buckets: [], bucket_required: false },
    ],
  } as FieldCatalog;

  it("reports what is incomplete at the server's paths", () => {
    const issues = specIssues(
      {
        entity: "",
        group_by: [{ field: "" }, { field: "created_at" }],
        measures: [{ fn: "sum", field: "customer" }],
        date_range: { field: "posting_date", from: "yesterday" },
        compare: "previous_period",
        sort: [{ by: "" }],
        filters: [["", "=", 1]],
      },
      catalog,
    );
    expect(issues.map((i) => i.path)).toEqual(["entity", "group_by[0].field", "group_by[1].bucket", "measures[0]", "date_range.from", "compare", "sort[0].by", "filters[0]"]);
    expect(issues[3].message).toBe("Sum does not apply to Customer");
  });

  it("asks for a measure when grouping, and accepts a bare table", () => {
    expect(specIssues({ entity: "X", group_by: [{ field: "a" }] })).toEqual([{ path: "measures", message: "Add at least one measure, such as a count" }]);
    expect(specIssues({ entity: "X" })).toEqual([]);
  });
});

describe("toChart", () => {
  it("plots the measures of one dimension with safe keys, titles and exact display values", () => {
    const c = toChart(byCustomer, en);
    expect(c.x?.name).toBe("customer");
    expect(c.series.map((s) => [s.key, s.label])).toEqual([
      ["s0", "Count"],
      ["s1", "Sum of Grand Total"],
      ["s2", "Average of Grand Total"],
    ]);
    expect(c.rows[0]).toMatchObject({ x: "c-acme", label: "Acme Traders", s0: 3, s1: 2037.28, s2: 1018.64, fmt: { s0: "3", s1: "2,037.28", s2: "1,018.64" } });
    expect(c.config.s1).toEqual({ label: "Sum of Grand Total", color: "var(--chart-2)" });
    expect(c.truncated).toBe(false);
  });

  it("spreads other dimensions into series, largest first, with zero for empty sums", () => {
    const c = toChart(weekly("sum"), en);
    expect(c.x?.name).toBe("week(posting_date)");
    expect(c.series.map((s) => s.label)).toEqual(["Partly Paid", "Draft", "(not set)"]);
    expect(c.series[0].dims).toEqual({ status: "Partly Paid" });
    expect(c.rows.map((p) => p.label)).toEqual(["Week of Oct 19, 2026", "Week of Oct 26, 2026"]);
    expect(c.rows[0]).toMatchObject({ s0: 0, s1: 100, s2: 0, fmt: { s0: "0.00", s1: "100.00", s2: "0.00" } });
    expect(c.rows[1]).toMatchObject({ s0: 21240, s1: 1593, s2: 0.5, fmt: { s0: "21,240.00" } });

    const capped = toChart(weekly("sum"), { maxSeries: 2 });
    expect(capped.series.map((s) => s.label)).toEqual(["Partly Paid", "Draft"]);
    expect(capped.truncated).toBe(true);
  });

  it("leaves gaps where an empty group is unknown (averages)", () => {
    const c = toChart(weekly("avg"), en);
    expect(c.rows[0]).toMatchObject({ s0: null, s1: 100, fmt: { s0: "" } });
  });

  it("names series by value and measure when spreading several measures", () => {
    const r = weekly("sum");
    r.columns.push({ field: "grand_total", fn: "sum", label: "Sum of Grand Total (previous)", measure: "sum(grand_total)", name: "previous(sum(grand_total))", role: "previous", type: "currency" });
    const c = toChart(r, en);
    expect(c.series.slice(0, 2).map((s) => s.label)).toEqual(["Partly Paid · Sum of Grand Total", "Partly Paid · Sum of Grand Total (previous)"]);
    expect(c.rows[0].s1).toBe(0);
  });

  it("plots pivot columns without their totals", () => {
    const c = toChart(pivot, en);
    expect(c.series.map((s) => [s.label, s.column.name])).toEqual([
      ["Partly Paid", "sum(grand_total)@0"],
      ["Draft", "sum(grand_total)@1"],
    ]);
    expect(c.rows[0]).toMatchObject({ label: "Bharat Retail", s0: 21240, s1: 0 });
  });

  it("plots only the number columns of built-in reports", () => {
    const builtin = {
      columns: [
        { label: "Invoice", name: "voucher_no", type: "data" },
        { label: "Date", name: "posting_date", type: "date" },
        { label: "Grand Total", name: "grand_total", type: "currency" },
        { label: "Status", name: "status", type: "data" },
      ],
      rows: [{ voucher_no: "SINV-1", posting_date: "2026-10-28", grand_total: "21240", status: "Paid" }],
    };
    const c = toChart(builtin, { x: "voucher_no", y: ["posting_date", "grand_total", "status"] });
    expect(c.series.map((s) => s.column.name)).toEqual(["grand_total"]);
    expect(c.rows[0]).toMatchObject({ label: "SINV-1", s0: 21240 });
  });

  it("uses only colors that are safe in CSS", () => {
    const c = toChart(byCustomer, { colors: ["#336699", "red;}body{color:red", "teal"] });
    expect(c.series.map((s) => s.color)).toEqual(["#336699", "var(--chart-2)", "teal"]);
  });

  it("returns an empty model for an empty result", () => {
    expect(toChart({ columns: [], rows: [] })).toEqual({ x: undefined, series: [], rows: [], config: {}, truncated: false });
  });
});

describe("chartIssues", () => {
  const cols: ResultColumn[] = [
    { name: "customer", label: "Customer", role: "dimension", type: "link" },
    { name: "count", label: "Count", role: "measure", type: "int" },
    { name: "sum(grand_total)", label: "Sum", role: "measure", type: "currency" },
  ];

  it("applies the server's rules", () => {
    expect(chartIssues("bar", cols, "customer", ["count"], ["#336699", "teal"])).toEqual([]);
    expect(chartIssues("pie", cols)).toEqual(["pie, donut, percentage and funnel charts need exactly one dimension and one measure"]);
    expect(chartIssues("pie", cols, null, ["count"])).toEqual([]);
    expect(chartIssues("number", cols, null, ["count"])).toHaveLength(1);
    expect(chartIssues("heatmap", cols)).toHaveLength(1);
    expect(chartIssues("bar", cols, "nope", ["also_nope"], ["javascript:x"])).toHaveLength(3);
    expect(chartIssues("line", [{ name: "a", label: "A", type: "data" }])).toEqual([]);
  });
});

describe("totals", () => {
  it("adds decimals exactly", () => {
    expect(sumDecimal(["0.1", "0.2"])).toBe("0.3");
    expect(sumDecimal(["12345678901234567.89", "0.11"])).toBe("12345678901234568");
    expect(sumDecimal(["-1.50", 1, "0.5"])).toBe("0");
    expect(sumDecimal(["-2.25", "1"])).toBe("-1.25");
    expect(sumDecimal([null, "x", undefined])).toBeNull();
  });

  it("groups rows with subtotals that only derive what adds up", () => {
    const r = {
      columns: [
        { name: "region", label: "Region", role: "dimension", type: "data" },
        { name: "status", label: "Status", role: "dimension", type: "select" },
        { name: "count", label: "Count", role: "measure", type: "int", fn: "count" },
        { name: "sum(amount)", label: "Sum", role: "measure", type: "currency", fn: "sum" },
        { name: "avg(amount)", label: "Avg", role: "measure", type: "currency", fn: "avg" },
        { name: "max(amount)", label: "Max", role: "measure", type: "currency", fn: "max" },
        { name: "min(day)", label: "First", role: "measure", type: "date", fn: "min" },
        { name: "count_distinct(customer)", label: "Customers", role: "measure", type: "int", fn: "count_distinct" },
      ] as ResultColumn[],
      rows: [
        { region: "North", status: "Paid", count: 2, "sum(amount)": "10.10", "avg(amount)": "5.05", "max(amount)": "6", "min(day)": "2026-10-02", "count_distinct(customer)": 2 },
        { region: "South", status: "Paid", count: 1, "sum(amount)": "0.2", "avg(amount)": "0.2", "max(amount)": "0.2", "min(day)": "2026-10-05", "count_distinct(customer)": 1 },
        { region: "North", status: "Draft", count: 3, "sum(amount)": "0.2", "avg(amount)": "0.0667", "max(amount)": "0.1", "min(day)": "2026-09-30", "count_distinct(customer)": 3 },
      ],
    };
    const groups = groupRows(r, "region");
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ["North", 2],
      ["South", 1],
    ]);
    expect(groups[0].totals).toEqual({ count: 5, "sum(amount)": "10.3", "max(amount)": "6", "min(day)": "2026-09-30" });
  });

  it("formats the totals line with a caption", () => {
    expect(totalsLine(byCustomer, en)).toEqual(["Total", "4", "23,277.28", "7,759.09"]);
    expect(totalsLine({ ...byCustomer, totals: null })).toBeNull();
    expect(totalsLine({ ...byCustomer, totals: { other: 1 } })).toBeNull();
  });
});

describe("formatCell", () => {
  const link: ResultColumn = { name: "customer", label: "Customer", type: "link", role: "dimension" };
  const col = (c: Partial<ResultColumn>): ResultColumn => ({ name: "v", label: "V", type: "decimal", role: "measure", ...c });

  it("shows titles, empty groups and periods", () => {
    expect(formatCell(link, "c-1", { customer: "c-1", _titles: { customer: "Acme" } })).toBe("Acme");
    expect(formatCell(link, null)).toBe("(not set)");
    expect(formatCell(col({ type: "int" }), null)).toBe("");
    expect(formatCell(col({ type: "date", role: "dimension", bucket: "month" }), "2026-10-01", undefined, en)).toBe("Oct 2026");
    expect(formatCell(col({ type: "check", role: "dimension" }), false)).toBe("No");
  });

  it("formats numbers by type and saved format, exactly", () => {
    expect(formatCell(col({ fn: "avg" }), "7759.093333333", undefined, en)).toBe("7,759.09");
    expect(formatCell(col({ fn: "avg", precision: 4 }), "7759.093333333", undefined, en)).toBe("7,759.0933");
    expect(formatCell(col({ type: "currency" }), "1593.5", undefined, { ...en, currencyPrecision: 3 })).toBe("1,593.500");
    expect(formatCell(col({ type: "currency", format: { style: "int", prefix: "₹ " } }), "1593.5", undefined, en)).toBe("₹ 1,594");
    expect(formatCell(col({ type: "percent", format: { precision: 1 } }), "12.345", undefined, en)).toBe("12.3%");
  });

  it("labels date pivot columns as dates", () => {
    const c: ResultColumn = { name: "count@0", label: "2026-10-01 · Count", type: "int", role: "pivot", measure: "count", pivot_value: "2026-10-01", pivot_label: "2026-10-01" };
    expect(columnLabel(c, en)).toBe("Oct 1, 2026 · Count");
    expect(columnLabel({ ...c, bucket: "month" }, en)).toBe("Oct 2026 · Count");
    expect(columnLabel(pivot.columns[1])).toBe("Partly Paid");
  });
});

describe("formatBucket", () => {
  it("names calendar and fiscal periods", () => {
    expect(formatBucket("2026-10-26", "week", 1, "en-US")).toBe("Week of Oct 26, 2026");
    expect(formatBucket("2026-10-01", "quarter")).toBe("Q4 2026");
    expect(formatBucket("2026-01-01", "year")).toBe("2026");
    expect(formatBucket("2026-04-01", "fiscal_year")).toBe("FY 2026-27");
    expect(formatBucket("2026-01-01", "fiscal_year")).toBe("FY 2026");
    expect(formatBucket("2026-04-01", "fiscal_quarter", 4)).toBe("Q1 FY 2026-27");
    expect(formatBucket("2026-10-01", "fiscal_quarter", 4)).toBe("Q3 FY 2026-27");
    expect(formatBucket("2026-01-01", "fiscal_quarter", 4)).toBe("Q4 FY 2025-26");
    expect(formatBucket("2026-10-01", "fiscal_quarter")).toBe("Q4 FY 2026");
    expect(formatBucket("soon", "month")).toBe("soon");
  });
});

describe("ruleColor", () => {
  const col: ResultColumn = {
    name: "v",
    label: "V",
    type: "currency",
    format: {
      rules: [
        { op: "<", value: "0", color: "#d23f45" },
        { op: "between", value: ["0", "1000"], color: "amber" },
        { op: ">", value: 1000, color: "red;}x" },
        { op: "=", value: "Paid", color: "green" },
      ],
    },
  };

  it("returns the first matching rule's safe color, comparing numbers exactly", () => {
    expect(ruleColor(col, "-0.01")).toBe("#d23f45");
    expect(ruleColor(col, "1000")).toBe("amber");
    expect(ruleColor(col, "1000.01")).toBeUndefined();
    expect(ruleColor(col, "Paid")).toBe("green");
    expect(ruleColor(col, null)).toBeUndefined();
    expect(ruleColor({ ...col, format: undefined }, "5")).toBeUndefined();
  });
});

describe("number cards", () => {
  it("formats values by the card's format", () => {
    expect(formatCardValue("23277.28", { format: "currency", currency: "USD" }, en)).toBe("$23,277.28");
    expect(formatCardValue("23277.28", { format: "currency", currency: "USD" }, { ...en, compact: true })).toBe("$23.3K");
    expect(formatCardValue("5", { format: "currency", currency: "Rupee" }, en)).toBe("Rupee 5.00");
    expect(formatCardValue(4, { format: "int" }, en)).toBe("4");
    expect(formatCardValue("33.3333", { format: "percent", precision: 1 }, en)).toBe("33.3%");
    expect(formatCardValue(null, { format: "decimal" })).toBe("—");
  });

  it("formats the change with its sign", () => {
    const usd = { format: "currency" as const, currency: "USD" };
    expect(formatChange({ delta: "23277.28", delta_percent: null }, usd, en)).toBe("+$23,277.28");
    expect(formatChange({ delta: "-50", delta_percent: "-12.5" }, usd, en)).toBe("-12.5%");
    expect(formatChange({ delta: "0", delta_percent: "0" }, usd, en)).toBe("0%");
    expect(formatChange({}, usd)).toBe("");
  });
});

describe("relative dates", () => {
  // The server's own cases (spec.rs relative_dates): a Thursday, fiscal year from April.
  const r = (e: string) => resolveDate(e, "2026-10-29", 4);

  it("resolves like the server", () => {
    expect(r("2026-01-05")).toBe("2026-01-05");
    expect(r("today")).toBe("2026-10-29");
    expect(r("today-29d")).toBe("2026-09-30");
    expect(r("-1w")).toBe("2026-10-22");
    expect(r("start_of_week")).toBe("2026-10-26");
    expect(r("end_of_week")).toBe("2026-11-01");
    expect(r("start_of_month-11m")).toBe("2025-11-01");
    expect(r("end_of_month-1m")).toBe("2026-09-30");
    expect(r("start_of_quarter")).toBe("2026-10-01");
    expect(r("end_of_quarter")).toBe("2026-12-31");
    expect(r("start_of_year-1y")).toBe("2025-01-01");
    expect(r("start_of_fiscal_year")).toBe("2026-04-01");
    expect(r("end_of_fiscal_year")).toBe("2027-03-31");
    expect(r("start_of_month+1m-1d")).toBe("2026-10-31");
    expect(r("START_OF_MONTH")).toBe("2026-10-01");
    for (const bad of ["yesterday", "today-3x", "today-d", "2026-13-01", "", "today-999999y", "today-1d+", "constructor-1d", "__proto__"]) expect(r(bad)).toBeNull();
  });

  it("keeps month ends when moving by months", () => {
    expect(resolveDate("end_of_month-1m", "2026-03-31")).toBe("2026-02-28");
    expect(resolveDate("today+1y", "2024-02-29")).toBe("2025-02-28");
  });

  it("offers presets that resolve to whole periods", () => {
    const range = (id: string) => {
      const p = DATE_PRESETS.find((x) => x.id === id);
      return p && [r(p.from), r(p.to)];
    };
    expect(range("yesterday")).toEqual(["2026-10-28", "2026-10-28"]);
    expect(range("last_week")).toEqual(["2026-10-19", "2026-10-25"]);
    expect(range("last_month")).toEqual(["2026-09-01", "2026-09-30"]);
    expect(range("last_quarter")).toEqual(["2026-07-01", "2026-09-30"]);
    expect(range("last_12_months")).toEqual(["2025-11-01", "2026-10-29"]);
    expect(range("last_year")).toEqual(["2025-01-01", "2025-12-31"]);
    expect(range("this_fiscal_year")).toEqual(["2026-04-01", "2026-10-29"]);
    expect(range("last_fiscal_year")).toEqual(["2025-04-01", "2026-03-31"]);
    for (const p of DATE_PRESETS) {
      const [from, to] = [r(p.from), r(p.to)];
      expect(from && to && from <= to, p.id).toBe(true);
    }
    expect(presetOf(" Start_of_Month ", "today")?.id).toBe("this_month");
    expect(presetOf("2026-10-01", "today")).toBeUndefined();
  });
});

describe("fieldIssues", () => {
  it("maps setting errors to paths inside the setting", () => {
    const e = parseApiError(422, {
      error: "validation_failed",
      message: "Please correct the highlighted fields",
      fields: [
        { field: "roles", message: "choose the roles to share with" },
        { field: "spec", message: "group_by[0].field: unknown field 'nope_field' on Sales Invoice" },
        { field: "spec", message: "entity: unknown entity 'X'" },
        { field: "spec", message: "a number card reduces to one value: exactly one measure, without group_by, pivot or time_series" },
        { field: "layout", message: "[1] overlaps item 'w0'" },
        { field: "layout", message: "[0]: a shortcut opens exactly one of: entity, report, dashboard, url" },
        { field: "filters", message: "[0].name must be a lower-case identifier like 'company'" },
        { field: "columns", message: "columns: invalid type: map, expected a sequence" },
        { field: "chart_type", message: "x: 'nope' is not a dimension of the query (one of: customer)" },
        { field: "chart", message: "y: 'z' is not a measure of the query (one of: count)" },
        { field: "layout", message: "Dashboard Chart not found: 0190" },
        { field: "role", message: "is required", row: ["roles", 1] },
        { field: "filters[0]", message: "filter value: 'abc' is not a valid number" },
      ],
    });
    const issues = fieldIssues(e);
    expect(issues).toEqual([
      { path: "roles", message: "Choose the roles to share with" },
      { path: "spec.group_by[0].field", message: "Unknown field 'nope_field' on Sales Invoice" },
      { path: "spec.entity", message: "Unknown entity 'X'" },
      { path: "spec", message: "A number card reduces to one value: exactly one measure, without group_by, pivot or time_series" },
      { path: "layout[1]", message: "Overlaps item 'w0'" },
      { path: "layout[0]", message: "A shortcut opens exactly one of: entity, report, dashboard, url" },
      { path: "filters[0].name", message: "Must be a lower-case identifier like 'company'" },
      { path: "columns", message: "Invalid type: map, expected a sequence" },
      { path: "x_field", message: "'nope' is not a dimension of the query (one of: customer)" },
      { path: "chart.y", message: "'z' is not a measure of the query (one of: count)" },
      { path: "layout", message: "Dashboard Chart not found: 0190" },
      { path: "roles[1].role", message: "Is required" },
      { path: "filters[0]", message: "Filter value: 'abc' is not a valid number" },
    ]);
    expect(issuesAt(issues, "spec.group_by[0]")).toEqual(["Unknown field 'nope_field' on Sales Invoice"]);
    expect(issuesAt(issues, "layout")).toHaveLength(3);
    expect(issuesAt(issues, "roles")).toEqual(["Choose the roles to share with", "Is required"]);
    expect(issuesAt(issues, "filters[0]")).toHaveLength(2);
  });

  it("is empty for errors without field errors", () => {
    expect(fieldIssues(new Error("offline"))).toEqual([]);
    expect(fieldIssues(parseApiError(409, { error: "conflict", message: "changed" }))).toEqual([]);
  });
});

describe("client", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(body: unknown) {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const call = (i: number) => {
      const [url, init] = fetch.mock.calls[i];
      return { url, method: init?.method, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    };
    return call;
  }

  it("creates through the records API with an idempotency key and updates with If-Match", async () => {
    const call = stubFetch({ id: "r1", version: 1 });
    await studio.save("reports", { label: "L", sharing: "private", kind: "table", spec: { entity: "SalesInvoice" } });
    expect(call(0)).toMatchObject({ url: "/api/v1/Report", method: "POST", body: { label: "L", sharing: "private", kind: "table", spec: { entity: "SalesInvoice" } } });
    expect(call(0).headers["idempotency-key"]).toBeTruthy();

    await studio.save("dashboards", { id: "d 1", version: 3, label: "D", sharing: "everyone", layout: [] });
    expect(call(1)).toMatchObject({ url: "/api/v1/Dashboard/d%201", method: "PATCH", body: { label: "D", sharing: "everyone", layout: [] } });
    expect(call(1).headers["if-match"]).toBe('"v3"');

    await studio.remove("charts", "c1", 2);
    expect(call(2)).toMatchObject({ url: "/api/v1/DashboardChart/c1", method: "DELETE" });
  });

  it("lists records and sources from the studio endpoints", async () => {
    let call = stubFetch({ rows: [{ id: "1" }] });
    expect(await studio.list("charts", { module: "selling" })).toEqual([{ id: "1" }]);
    expect(call(0).url).toBe("/api/app/studio/charts?module=selling");

    call = stubFetch({ builtin: [{ name: "a", label: "A", params: [] }, { name: "a", label: "A", params: [] }, { name: "b", label: "B", params: [] }], entities: [] });
    expect((await studio.sources()).builtin.map((r) => r.name)).toEqual(["a", "b"]);
    expect(call(0).url).toBe("/api/app/studio/sources");
  });

  it("posts runtime settings, previews and dashboard values", async () => {
    const call = stubFetch({});
    await studio.runReport("r1", { from: "today" });
    expect(call(0)).toMatchObject({ url: "/api/app/studio/reports/r1/run", method: "POST", body: { from: "today" } });
    await studio.dashboardData("d1", { company: "c1" });
    expect(call(1)).toMatchObject({ url: "/api/app/studio/dashboards/d1/data", body: { values: { company: "c1" } } });
    await studio.previewCard({ record: { label: "x", sharing: "private", format: "int", spec: { entity: "X", measures: [{ fn: "count" }] } } });
    expect(call(2)).toMatchObject({ url: "/api/app/studio/cards/preview", body: { record: { label: "x" } } });
    await studio.fields("Sales Invoice");
    expect(call(3).url).toBe("/api/app/studio/fields/Sales%20Invoice");
  });

  it("encodes runtime settings for export links", () => {
    expect(runtimeQuery({ filters: [["status", "=", "Paid"]], sort: [{ by: "x", dir: "desc" }], search: " ", limit: 10, from: "", to: "today" })).toEqual({
      filters: '[["status","=","Paid"]]',
      sort: '[{"by":"x","dir":"desc"}]',
      search: undefined,
      limit: 10,
      from: undefined,
      to: "today",
    });
    expect(runtimeQuery({ filters: [] }).filters).toBeUndefined();
  });

  it("keeps the previous data only for the same saved object", () => {
    const { placeholderData } = sameObject("d1");
    expect(placeholderData("prev", { queryKey: ["studio", "data", "dashboard", "d1", { company: "a" }] })).toBe("prev");
    expect(placeholderData("prev", { queryKey: ["studio", "data", "dashboard", "d2", {}] })).toBeUndefined();
    expect(placeholderData(undefined, undefined)).toBeUndefined();
  });

  it("retries only transient failures", () => {
    expect(retryTransient(0, parseApiError(0, null))).toBe(true);
    expect(retryTransient(1, parseApiError(503, null))).toBe(true);
    expect(retryTransient(3, parseApiError(503, null))).toBe(false);
    expect(retryTransient(0, parseApiError(422, {}))).toBe(false);
    expect(retryTransient(0, new Error("x"))).toBe(false);
  });
});
