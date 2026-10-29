import { describe, expect, it } from "vitest";
import type { CardRecord, ChartRecord, DashboardRecord, FieldCatalog } from "@/lib/studio";
import { stableJson } from "./history";
import { asRecordIssue, blankCard, blankChart, blockKey, cardDraft, cardIssuesLocal, cardRecord, chartDraft, chartIssuesLocal, chartRecord, dashboardBody, dashboardDraft } from "./records";

// A saved chart as GET /api/v1/DashboardChart/{id} returns it (server fields included).
const saved: ChartRecord & Record<string, unknown> = {
  id: "c1",
  version: 3,
  label: "Sales by status",
  sharing: "roles",
  roles: [{ id: "r1", role: "Sales User" }],
  chart_type: "stacked_bar",
  source: "query",
  base_entity: "SalesInvoice",
  spec: {
    entity: "SalesInvoice",
    filters: { docstatus: 1 },
    group_by: [{ field: "status" }],
    measures: [{ fn: "sum", field: "grand_total", label: "Revenue" }],
    time_series: { field: "posting_date", bucket: "month", from: "start_of_year", to: "today", fill_zero: true },
    sort: [{ by: "sum(grand_total)", dir: "desc" }],
    limit: 100,
  },
  report: null,
  colors: ["#336699"],
  accepts: { company: false },
  docstatus: 0,
  number: null,
};

const catalog = {
  entity: "SalesInvoice",
  fields: [
    { path: "status", label: "Status", type: "select", group: "Sales Invoice", groupable: true, aggregates: ["count_distinct"], buckets: [], bucket_required: false },
    { path: "created_at", label: "Created", type: "datetime", group: "Sales Invoice", groupable: true, aggregates: [], buckets: ["day", "month"], bucket_required: true },
  ],
} as unknown as FieldCatalog;

describe("charts", () => {
  it("saves what it loaded, unchanged", () => {
    const rec = chartRecord(chartDraft(saved));
    expect(rec.spec).toEqual({ ...saved.spec, filters: [["docstatus", "=", 1]] });
    expect(rec).toMatchObject({ id: "c1", version: 3, label: "Sales by status", chart_type: "stacked_bar", colors: ["#336699"], accepts: { company: false }, roles: saved.roles });
    expect(stableJson(chartRecord(chartDraft(rec)))).toBe(stableJson(rec)); // a second round trip changes nothing
  });

  it("drops what does not apply to the source and blanks empty settings", () => {
    const d = chartDraft(saved);
    const rec = chartRecord({ ...d, rec: { ...d.rec, source: "builtin", builtin_report: "sales_register", builtin_params: { company: "c9", customer: " " }, report: "r1", y_fields: [], sharing: "private" } });
    expect(rec).toMatchObject({ spec: null, report: null, builtin_report: "sales_register", builtin_params: { company: "c9" }, y_fields: null, roles: [] });
  });

  it("finds what keeps it from being previewed", () => {
    const fresh = chartDraft(blankChart(new URLSearchParams("type=pie&entity=SalesInvoice")));
    expect(fresh.rec.chart_type).toBe("pie");
    expect(fresh.query.measures).toEqual([{ fn: "count" }]);
    expect(chartIssuesLocal(fresh, catalog, [])).toEqual([]);
    const grouped = { ...fresh, query: { ...fresh.query, group_by: [{ field: "created_at" }], filters: [["status", "=", ""]] as [string, "=", string][] } };
    expect(chartIssuesLocal(grouped, catalog, []).map((i) => i.path)).toEqual(["spec.group_by[0].bucket", "spec.filters[0]"]);
    expect(chartIssuesLocal(chartDraft(blankChart()), catalog, [])[0].path).toBe("spec.entity");
    expect(chartIssuesLocal({ ...fresh, rec: { ...fresh.rec, source: "builtin", builtin_report: "variant_stock_matrix" } }, catalog, ["template"])).toEqual([
      { path: "builtin_params", message: "Enter template: the report needs it" },
    ]);
  });

  it("files preview errors under the spec", () => {
    expect(asRecordIssue({ path: "group_by[0].field", message: "x" }).path).toBe("spec.group_by[0].field");
    expect(asRecordIssue({ path: "builtin_params", message: "x" }).path).toBe("builtin_params");
  });
});

describe("number cards", () => {
  const card: CardRecord = {
    label: " Revenue ",
    sharing: "everyone",
    format: "int",
    precision: 2,
    currency: "cur1",
    sparkline: "week",
    spec: { entity: "SalesInvoice", measures: [{ fn: "sum", field: "grand_total" }, { fn: "count" }], group_by: [{ field: "status" }], date_range: { field: "posting_date", from: "start_of_month", to: "today" }, compare: "previous_period" },
  };

  it("reduces to one value and drops settings the format does not use", () => {
    const rec = cardRecord(cardDraft(card));
    expect(rec.spec).toEqual({ entity: "SalesInvoice", measures: [{ fn: "sum", field: "grand_total" }], date_range: { field: "posting_date", from: "start_of_month", to: "today" }, compare: "previous_period" });
    expect(rec).toMatchObject({ label: "Revenue", precision: null, currency: null, sparkline: "week", roles: [] });
  });

  it("keeps a trend only over a whole period", () => {
    const d = cardDraft({ ...card, format: "currency" });
    const open = cardRecord({ ...d, query: { ...d.query, period: { field: "posting_date", from: "start_of_month", to: "" }, compare: null } });
    expect(open).toMatchObject({ sparkline: null, currency: "cur1", precision: 2 });
    expect(cardIssuesLocal(cardDraft(blankCard()), undefined)).toEqual([{ path: "spec.entity", message: "Choose what to count" }]);
  });
});

describe("dashboards", () => {
  const dash: DashboardRecord = {
    id: "d1",
    version: 2,
    label: "Sales",
    sharing: "private",
    refresh_interval: 300,
    filters: [{ name: "period", type: "date_range", label: "Period", default: { from: "start_of_year", to: "today" }, options: [], field: null, to: null }],
    layout: [
      { type: "chart", chart: "c1", x: 0, y: 2, w: 6, h: 8 },
      { type: "card", card: "k1", i: "w0", x: 6, y: 0, w: 3, h: 3 },
    ],
  };

  it("edits a compacted layout with ids, and saves clean filter definitions", () => {
    const d = dashboardDraft(dash);
    expect(d.layout.map((it) => [it.i, it.y])).toEqual([
      ["w0_", 0],
      ["w0", 0],
    ]);
    const body = dashboardBody(d);
    expect(body.filters).toEqual([{ name: "period", type: "date_range", label: "Period", default: { from: "start_of_year", to: "today" } }]);
    expect(stableJson(dashboardBody(dashboardDraft({ ...dash, ...body })))).toBe(stableJson(body));
  });

  it("tells a widget's settings from its place", () => {
    const [a] = dashboardDraft(dash).layout;
    expect(blockKey(a)).toBe(blockKey({ ...a, x: 9, y: 4, w: 3 }));
    expect(blockKey(a)).not.toBe(blockKey({ ...a, chart: "c2" } as typeof a));
  });
});
