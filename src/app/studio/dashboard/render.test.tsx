// Every chart type and widget renders from real result shapes (server-side, without a browser):
// a missing guard on some data shape fails here rather than on a dashboard.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { CardWidgetData, ChartType, QueryResult, ResolvedWidget } from "@/lib/studio";
import { ChartView, ResultTable } from "./ChartView";
import { NumberCardView } from "./NumberCardView";
import { Markdown, WidgetView } from "./Widget";

const html = (node: ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <StaticRouter location="/studio/dashboards/d1">{node}</StaticRouter>
    </QueryClientProvider>,
  );

const daily: QueryResult = {
  columns: [
    { bucket: "day", field: "posting_date", label: "Posting Date (Day)", name: "day(posting_date)", role: "dimension", type: "date" },
    { field: "status", label: "Status", name: "status", role: "dimension", type: "select" },
    { fn: "count", label: "Count", name: "count", role: "measure", type: "int" },
    { field: "grand_total", fn: "sum", label: "Sum of Grand Total", name: "sum(grand_total)", role: "measure", type: "currency" },
  ],
  rows: [
    { "day(posting_date)": "2026-10-28", status: "Paid", count: 4, "sum(grand_total)": "23277.28" },
    { "day(posting_date)": "2026-10-29", status: null, count: 1, "sum(grand_total)": "0.5" },
  ],
  totals: { count: 5, "sum(grand_total)": "23277.78" },
  meta: { entity: "SalesInvoice", timezone: "UTC", sql_ms: 1, truncated: false, row_count: 2 },
};
const builtin = {
  name: "sales_register",
  label: "Sales Register",
  columns: [
    { label: "Invoice", name: "voucher_no", type: "data" },
    { label: "Grand Total", name: "grand_total", type: "currency" },
  ],
  rows: [{ voucher_no: "SINV-1", grand_total: "21240" }],
};
const TYPES: ChartType[] = ["bar", "stacked_bar", "line", "area", "pie", "donut", "percentage", "heatmap", "scatter", "funnel", "number"];

describe("charts render", () => {
  it.each(TYPES)("%s, from a query, a built-in report and no rows", (type) => {
    expect(html(<ChartView type={type} data={daily} title="Sales" onPoint={() => {}} />)).toContain("@container");
    expect(html(<ChartView type={type} data={builtin} title="Register" />)).toBeTruthy();
    expect(html(<ChartView type={type} data={{ ...daily, rows: [], totals: null }} title="Empty" />)).toBeTruthy();
  });

  it("renders the data table with totals", () => {
    const out = html(<ResultTable data={daily} onRow={() => {}} />);
    expect(out).toContain("23,277.78");
    expect(out).toContain("(not set)");
  });
});

describe("widgets render", () => {
  const card: CardWidgetData = {
    card: { id: "k1", label: "Revenue", format: "currency", currency: "INR", color: "#0f8f80" },
    value: "23277.28",
    previous: "0",
    delta: "23277.28",
    delta_percent: null,
    direction: "up",
    drill_down: { entity: "SalesInvoice", filters: [["posting_date", "between", ["2026-10-01", "2026-10-29"]]] },
    meta: { entity: "SalesInvoice", timezone: "UTC", sql_ms: 1, truncated: false, row_count: 1, date_range: { field: "posting_date", from: "2026-10-01", to: "2026-10-29" }, compare: { kind: "previous_period", from: "2026-10-01", to: "2026-10-29", previous_from: "2026-09-01", previous_to: "2026-09-29" } },
    sparkline: [
      ["2026-10-19", "0"],
      ["2026-10-26", "23277.28"],
    ],
  };

  it("shows a number card's value, change and period", () => {
    const out = html(<NumberCardView data={card} title="Revenue" onDrill={() => {}} />);
    expect(out).toContain("23,277.28");
    expect(out).toContain("+₹23,277.28");
    expect(out).toContain("vs previous period");
  });

  const widgets: ResolvedWidget[] = [
    { type: "chart", chart: { id: "c1", label: "By day", chart_type: "bar", source: "query", x: "day(posting_date)", y: ["count"] }, data: daily },
    { type: "chart", chart: { label: "Broken", chart_type: "pie" }, error: { error: "invalid", message: "unknown field" } },
    { type: "card", ...card },
    { type: "card", card: { label: "Broken card" }, error: { error: "forbidden", message: "no access" } },
    { type: "shortcut", label: "Invoices", entity: "SalesInvoice", count: 1234, filters: [["status", "=", "Paid"]] },
    { type: "shortcut", label: "Help", url: "https://ferrum.dev" },
    { type: "list", entity: "SalesInvoice", fields: [], rows: [{ id: "r1", number: "SINV-1" }] },
    { type: "list", entity: "SalesInvoice", error: { error: "invalid", message: "bad filter" } },
    { type: "markdown", content: "# Notes\n- [Leads](/app/e/Lead)" },
    { type: "heading", text: "This month", level: 2 },
    { error: { error: "internal", message: "broken" } },
  ];

  it.each(widgets.map((w, i) => [w.type ?? "error", i] as const))("%s (%i)", (_, i) => {
    expect(html(<WidgetView widget={widgets[i]} />).length).toBeGreaterThan(20);
  });

  it("renders markdown as elements, never as HTML", () => {
    const out = html(<Markdown source={"**<img src=x onerror=alert(1)>** [x](javascript:alert(1))"} />);
    expect(out).not.toContain("<img");
    expect(out).not.toContain('href="javascript');
  });
});
