// The report screens rendered for real (router, query cache seeded with dev-backend shapes), on the
// server renderer: no DOM is needed, and a component that throws or shows the wrong state fails here.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { Me, MetaIndex } from "../../../lib/meta";
import { buildSpec, studioKeys, type FieldCatalog, type QueryResult, type ReportRecord, type StudioListRow } from "../../../lib/studio";
import type { ReactNode } from "react";
import { reportNav, reportRoutes } from "../ReportBuilder";
import { BuilderPanel } from "./BuilderPanel";
import { CHART_META, ChartSettingsBar, ResultChart } from "./ResultChart";
import { CHART_TYPES, stateFromRecord } from "./state";

const all = { read: "all", write: "all", create: "all", delete: "all", submit: "all", cancel: "all", export: "all", import: "all" } as const;
const meta: MetaIndex = {
  version: 1,
  packages: [],
  modules: [{ name: "selling", label: "Selling", order: 1, items: [] }],
  entities: [
    { name: "SalesInvoice", label: "Sales Invoice", label_plural: "Sales Invoices", kind: "document", module: "selling", submittable: true, permissions: all },
    { name: "Report", label: "Report", label_plural: "Reports", kind: "master", module: "studio", submittable: false, permissions: all },
  ],
  warnings: [],
};
const me: Me = {
  tenant: "t",
  user: { id: "u1", email: "a@b.test", full_name: "A", is_admin: true, roles: ["Sales User"] },
  default_company: null,
  scopes: {},
  fiscal_year_start_month: 4,
  packages: [],
};
const field = (path: string, label: string, type: string, extra: object = {}) => ({ path, label, type, group: "Sales Invoice", groupable: true, aggregates: [], buckets: [], bucket_required: false, ...extra });
const catalog: FieldCatalog = {
  entity: "SalesInvoice",
  label: "Sales Invoice",
  fields: [
    field("customer", "Customer", "link", { to: "Customer", aggregates: ["count_distinct"] }),
    field("status", "Status", "select", { options: ["Draft", "Paid"], aggregates: ["count_distinct"] }),
    field("grand_total", "Grand Total", "currency", { aggregates: ["count_distinct", "sum", "avg", "min", "max"] }),
    field("posting_date", "Posting Date", "date", { aggregates: ["count_distinct", "min", "max"], buckets: ["day", "week", "month", "quarter", "year", "fiscal_quarter", "fiscal_year"] }),
  ],
  filters: { tag: "_tag", operators: ["=", "!=", "in"] },
  functions: ["count", "count_distinct", "sum", "avg", "min", "max"],
  buckets: ["day", "week", "month", "quarter", "year", "fiscal_quarter", "fiscal_year"],
  compare: ["previous_period", "previous_year"],
  dates: "",
  limits: { rows: 10000, pivot_columns: 100, pivot_cells: 200000 },
};
const record: ReportRecord = {
  id: "r1",
  version: 3,
  label: "Revenue by customer",
  sharing: "everyone",
  roles: [],
  kind: "group_by",
  created_by: "u1",
  spec: { entity: "SalesInvoice", group_by: [{ field: "customer" }], measures: [{ fn: "count" }, { fn: "sum", field: "grand_total" }], sort: [{ by: "sum(grand_total)", dir: "desc" }] },
  columns: [{ name: "sum(grand_total)", label: "Revenue", format: { style: "currency", precision: 2 } }],
  chart: null,
};
const result: QueryResult = {
  columns: [
    { field: "customer", label: "Customer", name: "customer", role: "dimension", to: "Customer", type: "link" },
    { fn: "count", label: "Count", name: "count", role: "measure", type: "int" },
    { field: "grand_total", fn: "sum", label: "Sum of Grand Total", name: "sum(grand_total)", role: "measure", type: "currency" },
  ],
  rows: [
    { _titles: { customer: "Bharat Retail" }, count: 1, customer: "c2", "sum(grand_total)": "21240" },
    { _titles: { customer: "Acme Traders" }, count: 3, customer: "c1", "sum(grand_total)": "2037.28" },
  ],
  totals: { count: 4, "sum(grand_total)": "23277.28" },
  meta: { entity: "SalesInvoice", row_count: 2, sql_ms: 4.2, timezone: "UTC", truncated: false },
};

/** 23,277.28 in any locale's digit grouping. */
const TOTAL = /23\D?277\D28/;

function seeded(seed: (qc: QueryClient) => void = () => {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["meta"], meta);
  qc.setQueryData(["me"], me);
  qc.setQueryData(studioKeys.sources, { builtin: [], entities: [{ name: "SalesInvoice", label: "Sales Invoice", module: "selling" }] });
  qc.setQueryData(studioKeys.fields("SalesInvoice"), catalog);
  seed(qc);
  return qc;
}

const html = (node: ReactNode) =>
  renderToString(<QueryClientProvider client={seeded()}>{node}</QueryClientProvider>).replace(/<!-- -->/g, "");

function render(url: string, seed: (qc: QueryClient) => void = () => {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["meta"], meta);
  qc.setQueryData(["me"], me);
  qc.setQueryData(studioKeys.sources, { builtin: [], entities: [{ name: "SalesInvoice", label: "Sales Invoice", module: "selling" }] });
  qc.setQueryData(studioKeys.fields("SalesInvoice"), catalog);
  seed(qc);
  const router = createMemoryRouter(reportRoutes, { initialEntries: [url] });
  return renderToString(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  ).replace(/<!-- -->/g, ""); // text-node separators
}

describe("report screens", () => {
  it("exports routes and a sidebar entry", () => {
    expect(reportRoutes.map((r) => r.path)).toEqual(["studio/reports", "studio/reports/new", "studio/reports/:id"]);
    expect(reportNav).toEqual([{ label: "Reports", to: "/studio/reports", icon: "chart" }]);
  });

  it("starts a new report by asking what to report on", () => {
    const html = render("/studio/reports/new");
    expect(html).toContain("What do you want to report on?");
    expect(html).toContain("New report");
  });

  it("edits a saved report with its live preview, totals and saved column settings", () => {
    const spec = buildSpec(stateFromRecord(record)!.draft);
    const html = render("/studio/reports/r1?edit=1", (qc) => {
      qc.setQueryData(studioKeys.record("reports", "r1"), record);
      qc.setQueryData(studioKeys.query(spec), result);
    });
    expect(html).toContain("Revenue by customer");
    expect(html).toContain("Revenue"); // the column's saved label
    expect(html).toMatch(TOTAL); // the totals line, exact
    expect(html).toContain("2 rows");
    expect(html).not.toContain("Unsaved");
  });

  it("opens a shared link's unsaved settings", () => {
    const q = encodeURIComponent(JSON.stringify({ kind: "table", spec: { entity: "SalesInvoice", fields: [{ field: "status" }] } }));
    const html = render(`/studio/reports/new?q=${q}`);
    expect(html).toContain("New report on Sales Invoices");
    expect(html).toContain("Unsaved");
  });

  it("runs a saved report for a viewer", () => {
    const html = render("/studio/reports/r1", (qc) => {
      qc.setQueryData(studioKeys.run("r1", {}), { report: { ...record, columns: record.columns }, data: { ...result, columns: result.columns.map((c) => (c.name === "sum(grand_total)" ? { ...c, label: "Revenue" } : c)) } });
      qc.setQueryData(studioKeys.record("reports", "r1"), record);
    });
    expect(html).toContain("Revenue by customer");
    expect(html).toContain("Filters");
    expect(html).toContain("Edit");
    expect(html).toMatch(TOTAL);
  });

  it("shows every settings section of a pivot with filters, a period and a sort", () => {
    const state = stateFromRecord({
      kind: "pivot",
      spec: {
        entity: "SalesInvoice",
        filters: [["status", "in", ["Paid"]], ["grand_total", "between", ["10", ""]], ["posting_date", ">=", "2026-01-01"], ["customer", "is", "set"]],
        group_by: [{ field: "customer" }],
        measures: [{ fn: "sum", field: "grand_total" }, { fn: "avg" }],
        pivot: { field: "posting_date", bucket: "month", max_columns: 12 },
        time_series: { field: "posting_date", bucket: "week", from: "start_of_month", to: "the 5th", fill_zero: true },
        sort: [{ by: "customer", dir: "desc" }],
        limit: 2000,
      },
    })!;
    const out = html(
      <BuilderPanel
        state={state}
        update={() => {}}
        catalog={catalog}
        catalogLoading={false}
        catalogError={null}
        onRetryCatalog={() => {}}
        sources={{ builtin: [], entities: [{ name: "SalesInvoice", label: "Sales Invoice", module: "selling" }] }}
        sourcesLoading={false}
        onPickEntity={() => {}}
        issues={[{ path: "measures[1].field", message: "Choose the field for average" }]}
        columns={result.columns}
        fyStartMonth={4}
      />,
    );
    // Radix selects show their chosen text on the client only, so these are the texts around them.
    for (const text of ["Group by", "Measures", "Pivot columns", "Show up to", "Filters", "Period", "Sort and limit", "Choose the field for average", "Show periods without data", "Rows match all of these conditions", "Not a date", "Remove filter 4"])
      expect(out).toContain(text);
  });

  it("draws every chart type, and its settings bar, without failing", () => {
    for (const type of CHART_TYPES) {
      const out = html(
        <>
          <ChartSettingsBar settings={{ type }} columns={result.columns} onChange={() => {}} />
          <ResultChart result={result} settings={{ type, show_values: true }} options={{}} title="Revenue" />
        </>,
      );
      expect(out).toContain(CHART_META[type].label);
    }
    const total = { ...result, columns: [result.columns[2]], rows: [{ "sum(grand_total)": "23277.28" }] };
    expect(html(<ResultChart result={total} settings={{ type: "number" }} options={{}} title="Revenue" />)).toMatch(TOTAL);
    expect(html(<ResultChart result={result} settings={{ type: "heatmap" }} options={{}} title="Revenue" />)).toContain("A heatmap shows a measure by day");
  });

  it("lists saved reports", () => {
    const rows: StudioListRow<"reports">[] = [
      { id: "r1", updated_at: "2026-10-29T10:00:00Z", mine: true, label: "Revenue by customer", module: null, sharing: "everyone", is_standard: false, description: "Who buys most", base_entity: "SalesInvoice", kind: "group_by", space: null },
    ];
    const html = render("/studio/reports", (qc) => qc.setQueryData(studioKeys.list("reports"), rows));
    expect(html).toContain("Revenue by customer");
    expect(html).toContain("Sales Invoices");
    expect(html).toContain("Who buys most");
  });
});
