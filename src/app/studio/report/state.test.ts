import { describe, expect, it } from "vitest";
import { emptyDraft, type ResultColumn } from "../../../lib/studio";
import {
  decodeParam,
  decodeState,
  displayColumns,
  encodeParam,
  encodeState,
  filterIssues,
  historyReducer,
  moveColumn,
  opsFor,
  patchColumn,
  recordFromState,
  sanitizeRuntime,
  sanitizeSpec,
  specColumns,
  stateFromRecord,
  stateKey,
  toCsv,
  valueForOp,
  dayValue,
  withFields,
  type BuilderState,
  type History,
} from "./state";

const grouped: BuilderState = {
  draft: { ...emptyDraft("SalesInvoice", "group_by"), group_by: [{ field: "customer" }], measures: [{ fn: "count" }, { fn: "sum", field: "grand_total" }] },
  view: "table",
  chart: null,
  columns: [],
};

// A pivot by status as the dev backend returns it.
const pivotCols: ResultColumn[] = [
  { field: "customer", label: "Customer", name: "customer", role: "dimension", to: "Customer", type: "link" },
  { label: "Draft · Count", measure: "count", name: "count@0", pivot_label: "Draft", pivot_value: "Draft", role: "pivot", type: "int" },
  { label: "Paid · Count", measure: "count", name: "count@1", pivot_label: "Paid", pivot_value: "Paid", role: "pivot", type: "int" },
  { fn: "count", label: "Total · Count", name: "count", role: "measure", type: "int" },
];

describe("sanitizeSpec", () => {
  it("keeps what the server reads and drops the rest", () => {
    const s = sanitizeSpec({
      entity: "SalesInvoice",
      grup_by: [],
      filters: { status: "Paid", grand_total: [">", 10] },
      group_by: [{ field: "posting_date", bucket: "monthly" }, { field: "customer", label: "Cust" }, "junk"],
      measures: [{ fn: "sum", field: "grand_total" }, { fn: "median", field: "x" }, { fn: "count" }],
      pivot: { field: "status", max_columns: 500 },
      sort: [{ by: "count", dir: "down" }, { by: "" }],
      limit: 0,
      date_range: { field: "posting_date", from: "today-30d", to: 5 },
      compare: "previous_period",
    });
    expect(s).toEqual({
      entity: "SalesInvoice",
      filters: [
        ["status", "=", "Paid"],
        ["grand_total", ">", 10],
      ],
      group_by: [{ field: "posting_date" }, { field: "customer", label: "Cust" }],
      measures: [{ fn: "sum", field: "grand_total" }, { fn: "count" }],
      pivot: { field: "status" },
      sort: [{ by: "count", dir: "asc" }],
      date_range: { field: "posting_date", from: "today-30d" },
      compare: "previous_period",
    });
  });

  it("reads the kernel's operator spellings and short filters", () => {
    expect(sanitizeSpec({ entity: "X", filters: [["a", "EQ", 1], ["b", "not_in", [2]], ["c", 3], ["d", "~", 4], [5, "=", 6]] })?.filters).toEqual([
      ["a", "=", 1],
      ["b", "not in", [2]],
      ["c", "=", 3],
    ]);
  });

  it("needs an entity", () => {
    expect(sanitizeSpec({ entity: "" })).toBeNull();
    expect(sanitizeSpec("SalesInvoice")).toBeNull();
    expect(sanitizeSpec(null)).toBeNull();
  });
});

describe("record ⇄ state", () => {
  it("round-trips a chart report as the grouped shape shown as a chart", () => {
    const s = stateFromRecord({
      kind: "chart",
      spec: { entity: "SalesInvoice", group_by: [{ field: "customer" }], measures: [{ fn: "count" }] },
      chart: { type: "pie", y: ["count"], colour: "red" },
      columns: [{ name: "count", width: 10, label: "Invoices" }, { name: "count" }],
    });
    expect(s?.draft.kind).toBe("group_by");
    expect(s?.view).toBe("chart");
    expect(s?.columns).toEqual([{ name: "count", label: "Invoices" }]);
    expect(recordFromState(s!)).toEqual({
      kind: "chart",
      spec: { entity: "SalesInvoice", group_by: [{ field: "customer" }], measures: [{ fn: "count" }] },
      columns: [{ name: "count", label: "Invoices" }],
      chart: { type: "pie", y: ["count"] },
    });
  });

  it("drops settings of columns and chart axes the spec no longer has", () => {
    const s: BuilderState = {
      ...grouped,
      view: "chart",
      chart: { type: "bar", x: "status", y: ["count", "sum(total)"] },
      columns: [{ name: "status", width: 120 }, { name: "sum(grand_total)", label: "Revenue" }],
    };
    expect(recordFromState(s)).toMatchObject({ kind: "chart", columns: [{ name: "sum(grand_total)", label: "Revenue" }], chart: { type: "bar", y: ["count"] } });
  });

  it("orders record columns as the fields and saves no chart for them", () => {
    const s: BuilderState = {
      draft: { ...emptyDraft("SalesInvoice"), fields: [{ field: "number" }, { field: "customer" }] },
      view: "chart",
      chart: { type: "bar" },
      columns: [{ name: "customer", width: 200 }, { name: "number", width: 90 }],
    };
    expect(recordFromState(s)).toEqual({
      kind: "table",
      spec: { entity: "SalesInvoice", fields: [{ field: "number" }, { field: "customer" }] },
      columns: [{ name: "number", width: 90 }, { name: "customer", width: 200 }],
      chart: null,
    });
  });

  it("gives equal keys to states that save the same record", () => {
    const a = stateFromRecord({ kind: "group_by", spec: { entity: "X", measures: [{ fn: "count" }], search: "" } })!;
    const b = stateFromRecord({ kind: "group_by", spec: { measures: [{ fn: "count", label: "" }], entity: "X" }, columns: [] })!;
    expect(stateKey(a)).toBe(stateKey(b));
    expect(stateKey(a)).not.toBe(stateKey({ ...a, draft: { ...a.draft, limit: 10 } }));
  });
});

describe("links", () => {
  it("round-trips builder state, unicode included", () => {
    const s: BuilderState = { ...grouped, view: "chart", chart: { type: "line" }, columns: [{ name: "count", label: "Anzahl · Rechnungen €" }] };
    const raw = encodeState(s);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(stateKey(decodeState(raw)!)).toBe(stateKey(s));
    expect(decodeState(raw)?.view).toBe("chart");
  });

  it("reads plain JSON and survives garbage", () => {
    expect(decodeState('{"kind":"table","spec":{"entity":"Customer","fields":[{"field":"customer_name"}]}}')?.draft.fields).toEqual([{ field: "customer_name" }]);
    for (const bad of ["", "%%%", "e30", encodeParam({ kind: "table" }), encodeParam([1, 2]), null, undefined]) expect(decodeState(bad)).toBeNull();
    expect(decodeParam(encodeParam({ a: [1, "ü"] }))).toEqual({ a: [1, "ü"] });
  });

  it("checks run settings", () => {
    expect(sanitizeRuntime({ filters: [["status", "=", "Paid"], ["x"]], sort: [{ by: "count", dir: "desc" }], limit: 99999, from: "today-7d", view: "pie", extra: 1 })).toEqual({
      filters: [["status", "=", "Paid"]],
      sort: [{ by: "count", dir: "desc" }],
      from: "today-7d",
    });
    expect(sanitizeRuntime("x")).toEqual({});
  });
});

describe("specColumns", () => {
  it("names columns as the server does", () => {
    expect(
      specColumns({
        entity: "SalesInvoice",
        time_series: { field: "posting_date", bucket: "week" },
        group_by: [{ field: "customer" }, { field: "due_date", bucket: "month" }],
        measures: [{ fn: "count" }, { fn: "count", field: "customer" }, { fn: "sum", field: "grand_total" }],
        compare: "previous_year",
      }).map((c) => c.name),
    ).toEqual(["week(posting_date)", "customer", "month(due_date)", "count", "count(customer)", "sum(grand_total)", "previous(count)", "previous(count(customer))", "previous(sum(grand_total))"]);
    expect(specColumns({ entity: "X", fields: [{ field: "items.item" }] })).toEqual([{ name: "items.item", role: "field" }]);
  });
});

describe("columns on screen", () => {
  it("applies settings as the server arranges them", () => {
    const cols: ResultColumn[] = [
      { name: "customer", label: "Customer", type: "link", role: "dimension" },
      { name: "count", label: "Count", type: "int", role: "measure" },
      { name: "sum(grand_total)", label: "Sum of Grand Total", type: "currency", role: "measure" },
    ];
    const { shown, hidden } = displayColumns(cols, [{ name: "sum(grand_total)", label: "Revenue", width: 140 }, { name: "count", hidden: true }, { name: "gone" }]);
    expect(shown.map((c) => [c.name, c.label, c.width])).toEqual([
      ["sum(grand_total)", "Revenue", 140],
      ["customer", "Customer", undefined],
    ]);
    expect(hidden.map((c) => c.name)).toEqual(["count"]);
  });

  it("keeps a pivot's totals after its cells, which take their measure's format", () => {
    const { shown } = displayColumns(pivotCols, [{ name: "count", width: 90, format: { style: "int", suffix: " inv" } }, { name: "customer" }]);
    expect(shown.map((c) => c.name)).toEqual(["customer", "count@0", "count@1", "count"]);
    expect(shown[1]).toMatchObject({ width: 90, format: { style: "int", suffix: " inv" } });
  });

  it("lists every shown column when one changes, never pivot cells", () => {
    const { shown } = displayColumns(pivotCols, []);
    expect(patchColumn([], shown, "count", { width: 333, label: "  " })).toEqual([{ name: "customer" }, { name: "count", width: 333 }]);
    expect(patchColumn([{ name: "x", hidden: true }], shown, "customer", { hidden: true })).toEqual([{ name: "customer", hidden: true }, { name: "count" }, { name: "x", hidden: true }]);
    expect(patchColumn([], shown, "customer", { width: 5 })[0]).toEqual({ name: "customer", width: 40 });
  });

  it("moves record columns by reordering the fields, grouped ones by their settings", () => {
    const records: BuilderState = { ...grouped, draft: { ...emptyDraft("X"), fields: [{ field: "a" }, { field: "b" }, { field: "c" }] } };
    expect(moveColumn(records, [], "c", "a").draft.fields.map((f) => f.field)).toEqual(["c", "a", "b"]);
    const listDefaults = (["number", "status"] as const).map((name): ResultColumn => ({ name, label: name, type: "data", role: "field" }));
    expect(moveColumn({ ...records, draft: { ...records.draft, fields: [] } }, listDefaults, "status", "number").draft.fields).toEqual([{ field: "status" }, { field: "number" }]);
    const cols = (["customer", "count", "sum(grand_total)"] as const).map((name): ResultColumn => ({ name, label: name, type: "int", role: name === "customer" ? "dimension" : "measure" }));
    const moved = moveColumn({ ...grouped, columns: [{ name: "count", width: 80 }, { name: "z", hidden: true }] }, displayColumns(cols, [{ name: "count", width: 80 }]).shown, "customer", "sum(grand_total)");
    expect(moved.columns).toEqual([{ name: "count", width: 80 }, { name: "sum(grand_total)" }, { name: "customer" }, { name: "z", hidden: true }]);
  });
});

describe("withFields", () => {
  it("takes the shown list columns as fields only when none are chosen", () => {
    const cols: ResultColumn[] = [{ name: "number", label: "Number", type: "data", role: "field" }];
    const records: BuilderState = { ...grouped, draft: { ...emptyDraft("X"), fields: [] } };
    expect(withFields(records, cols).draft.fields).toEqual([{ field: "number" }]);
    const chosen = { ...records, draft: { ...records.draft, fields: [{ field: "a" }] } };
    expect(withFields(chosen, cols)).toBe(chosen);
    expect(withFields(grouped, cols)).toBe(grouped);
  });
});

describe("filters", () => {
  it("offers operators by type", () => {
    expect(opsFor("data")[0]).toBe("like");
    expect(opsFor("link")).toEqual(["=", "!=", "in", "not in", "is"]);
    expect(opsFor("datetime")).not.toContain("=");
    expect(opsFor("check")).toEqual(["=", "is"]);
    expect(opsFor("currency")).toContain("between");
  });

  it("keeps the value when the operator changes", () => {
    expect(valueForOp("in", "Paid", "select")).toEqual(["Paid"]);
    expect(valueForOp("in", "", "select")).toEqual([]);
    expect(valueForOp("=", ["Paid", "Draft"], "select")).toBe("Paid");
    expect(valueForOp("between", "10", "int")).toEqual(["10", ""]);
    expect(valueForOp("is", "x", "data")).toBe("set");
    expect(valueForOp("=", "set", "data")).toBe("");
    expect(valueForOp("=", "", "check")).toBe(true);
  });

  it("waits for values", () => {
    expect(
      filterIssues([
        ["status", "=", ""],
        ["status", "in", []],
        ["grand_total", "between", ["1", ""]],
        ["customer", "is", "set"],
        ["is_return", "=", false],
        ["", "=", ""],
      ]).map((i) => i.path),
    ).toEqual(["filters[0]", "filters[1]", "filters[2]"]);
  });

  it("counts whole days on date-times", () => {
    expect(dayValue("2026-10-01", "datetime", false)).toBe("2026-10-01T00:00:00.000Z");
    expect(dayValue("2026-10-01", "datetime", true)).toBe("2026-10-01T23:59:59.999Z");
    expect(dayValue("2026-10-01", "date", true)).toBe("2026-10-01");
  });
});

describe("toCsv", () => {
  it("matches the server's export", () => {
    const cols: ResultColumn[] = [
      { name: "customer", label: "Customer", type: "link" },
      { name: "note", label: "Note, quoted", type: "data" },
      { name: "sum(x)", label: "Sum", type: "decimal" },
    ];
    const out = toCsv(
      cols,
      [
        { customer: "id-1", note: '=HYPERLINK("x")', "sum(x)": "-0.3", _titles: { customer: 'Alpha "A"' } },
        { customer: null, note: "line\nbreak", "sum(x)": "10" },
      ],
      { "sum(x)": "9.7" },
    );
    expect(out.startsWith("﻿")).toBe(true);
    expect(out.slice(1).split("\r\n")).toEqual(["Customer,\"Note, quoted\",Sum", '"Alpha ""A""","\'=HYPERLINK(""x"")",-0.3', ',"line\nbreak",10', "Total,,9.7", ""]);
  });
});

describe("history", () => {
  const start: History<number> = { past: [], present: 0, future: [] };
  const set = (h: History<number>, v: number, key?: string, at = 0) => historyReducer(h, { type: "set", recipe: () => v, key, at });

  it("undoes and redoes", () => {
    let h = set(set(start, 1), 2);
    h = historyReducer(h, { type: "undo" });
    expect(h.present).toBe(1);
    h = historyReducer(h, { type: "redo" });
    expect(h.present).toBe(2);
    h = set(historyReducer(h, { type: "undo" }), 5);
    expect([h.past, h.present, h.future]).toEqual([[0, 1], 5, []]);
    expect(historyReducer(start, { type: "undo" })).toBe(start);
  });

  it("makes one step of quick edits to the same thing", () => {
    let h = set(start, 1, "label", 1000);
    h = set(h, 2, "label", 1500);
    h = set(h, 3, "label", 4000);
    h = set(h, 4, "limit", 4100);
    expect(h.past).toEqual([0, 2, 3]);
    expect(historyReducer(h, { type: "set", recipe: (s) => s, at: 5000 })).toBe(h);
  });
});
