// Renders the Space screens to HTML with data shaped like the dev backend's: catches crashes in
// render paths and checks what reaches the page (formatted values, safe links, structure).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { EntityMeta, Me, MetaIndex, Perms } from "@/lib/meta";
import { studioKeys, type ResolvedWidget, type SpaceRecord, type StudioListRow } from "@/lib/studio";
import { SpaceEditor } from "../SpaceEditor";
import { SpacesPage } from "../Spaces";
import { SpaceBlocks } from "./BlockView";

const all: Perms = { read: "all", write: "all", create: "all", delete: "all", submit: "all", cancel: "all", export: "all", import: "all" };
const index: MetaIndex = {
  version: 1,
  packages: [],
  warnings: [],
  modules: [{ name: "selling", label: "Selling", icon: "shopping-cart", order: 40, items: ["SalesInvoice", "Customer", "report:sales_register"] }],
  entities: [
    { name: "SalesInvoice", label: "Sales Invoice", label_plural: "Sales Invoices", kind: "document", module: "selling", submittable: true, permissions: all },
    { name: "Customer", label: "Customer", label_plural: "Customers", kind: "master", module: "selling", submittable: false, permissions: all },
    { name: "Space", label: "Space", label_plural: "Spaces", kind: "master", module: "studio", submittable: false, permissions: all },
  ],
};
const invoice: EntityMeta = {
  name: "SalesInvoice",
  label: "Sales Invoice",
  label_plural: "Sales Invoices",
  kind: "document",
  title_field: "customer_name",
  submittable: true,
  list: { columns: ["number", "customer_name", "grand_total", "status"], sort: "posting_date desc" },
  form: [],
  search_fields: [],
  rules: [],
  actions: [],
  children: {},
  permissions: all,
  fields: [
    { name: "customer_name", label: "Customer Name", type: "data", can_read: true },
    { name: "grand_total", label: "Grand Total", type: "currency", can_read: true, storage: "column" },
    { name: "status", label: "Status", type: "select", options: ["Draft", "Unpaid", "Paid"], can_read: true, storage: "column" },
  ],
};
const me: Me = { tenant: "t", user: { id: "u1", email: "a@b.test", full_name: "Admin", is_admin: true, roles: [] }, default_company: null, scopes: {}, fiscal_year_start_month: 4, packages: [] };

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["meta"], index);
  qc.setQueryData(["meta", "SalesInvoice"], invoice);
  qc.setQueryData(["me"], me);
  return qc;
}

function render(element: ReactNode, path = "/", routePath = "/", qc = client()): string {
  const router = createMemoryRouter([{ path: routePath, element }], { initialEntries: [path] });
  return renderToString(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const widgets = [
  { type: "heading", text: "Overview", level: 1 },
  { type: "shortcut", label: "Unpaid invoices", entity: "SalesInvoice", filters: [["status", "=", "Unpaid"]], count: 1234, color: "#d23f45", width: 3 },
  { type: "shortcut", label: "Guide", color: null, url: "https://docs.test/selling" },
  { type: "links", label: "Reports", items: [{ label: "Sales Register", builtin: "sales_register", entity: null, report: null, dashboard: null, url: null }] },
  {
    type: "list",
    label: null,
    entity: "SalesInvoice",
    fields: [],
    rows: [{ id: "r1", number: "SINV-0001", customer_name: "Acme Traders", grand_total: "1593", status: "Unpaid", _titles: {} }],
  },
  { type: "markdown", content: "**Welcome** to [invoices](/app/e/SalesInvoice), [evil](javascript:void) and [worse](javascript:alert(1)).", width: 6 },
  {
    type: "onboarding",
    title: "Get started",
    width: 6,
    steps: [
      { label: "Add a customer", entity: "Customer", done: true, description: null, url: null },
      { label: "Raise an invoice", entity: "SalesInvoice", done: false, description: "Bill your first order", url: null },
    ],
  },
  {
    type: "card",
    card: { label: "Revenue", format: "currency", currency: "INR", precision: 2, color: "teal" },
    value: "123456.5",
    delta: "100",
    delta_percent: "12.5",
    direction: "up",
    sparkline: [
      ["2026-09-01", "10"],
      ["2026-10-01", "12.5"],
    ],
    drill_down: { entity: "SalesInvoice", filters: [["docstatus", "=", 1]] },
    meta: { entity: "SalesInvoice", timezone: "UTC", sql_ms: 1, truncated: false, row_count: 1 },
  },
  {
    type: "chart",
    chart: { label: "Invoices by month", chart_type: "bar", x: "month(posting_date)", y: ["count"], colors: null },
    data: {
      columns: [
        { name: "month(posting_date)", label: "Month", type: "date", role: "dimension", bucket: "month" },
        { name: "count", label: "Count", type: "int", role: "measure", fn: "count" },
      ],
      rows: [
        { "month(posting_date)": "2026-09-01", count: 3 },
        { "month(posting_date)": "2026-10-01", count: 5 },
      ],
      totals: { count: 8 },
    },
  },
  { type: "chart", chart: { label: "Broken", chart_type: "pie" }, error: { error: "invalid", message: "The report it reads was deleted" } },
  { error: { error: "internal", message: "Something failed" } },
] as unknown as ResolvedWidget[];

describe("space view", () => {
  const html = render(<SpaceBlocks blocks={widgets} />);

  it("renders every block", () => {
    expect(html).toContain("<h2");
    expect(html).toContain("Overview");
    // Counts with digit grouping; the shortcut opens the list with its filter.
    expect(html).toContain("1,234");
    expect(html).toContain('href="/e/SalesInvoice?f.status=Unpaid"');
    expect(html).toContain('href="https://docs.test/selling"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('aria-label="Guide, docs.test/selling (opens in a new tab)"');
    expect(html).toContain('href="/r/sales_register"');
    // Quick list: the title field names the record, currency to two places.
    expect(html).toContain("Acme Traders");
    expect(html).toContain("1,593.00");
    expect(html).toContain('href="/e/SalesInvoice/r1"');
    expect(html).toContain("1 of 2 done");
    expect(html).toContain('href="/e/SalesInvoice/new"');
    expect(html).toContain("123,456.50");
    expect(html).toContain("+12.5%");
    expect(html).toContain("Bar chart: Invoices by month");
    expect(html).toContain("Oct 2026");
    expect(html).toContain("The report it reads was deleted");
    expect(html).toContain("Something failed");
  });

  it("keeps markdown safe", () => {
    expect(html).toContain('href="/e/SalesInvoice"');
    expect(html).toContain("<strong");
    // Unsafe targets never become links: their text stays, escaped.
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain(", evil and [worse](javascript:alert(1)).");
  });

  it("describes progress and names the title column", () => {
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuetext="1 of 2 steps done"');
    expect(html).toContain(">Customer Name</th>");
  });
});

const row: StudioListRow<"spaces"> = {
  id: "s1",
  updated_at: "2026-10-29T10:00:00.000Z",
  mine: true,
  label: "Selling",
  module: "selling",
  sharing: "everyone",
  is_standard: false,
  description: "Orders, invoices and customers",
  icon: "shopping-cart",
  sequence: 1,
};

describe("spaces list", () => {
  it("lists spaces with their module and audience", () => {
    const qc = client();
    qc.setQueryData(studioKeys.list("spaces"), [row]);
    const html = render(<SpacesPage />, "/", "/", qc);
    expect(html).toContain("Selling");
    expect(html).toContain("Orders, invoices and customers");
    expect(html).toContain("Everyone");
    expect(html).toContain('href="/studio/spaces/s1"');
    expect(html).toContain("New space");
  });

  it("offers a start when there are none", () => {
    const qc = client();
    qc.setQueryData(studioKeys.list("spaces"), []);
    expect(render(<SpacesPage />, "/", "/", qc)).toContain("No spaces yet");
  });
});

describe("space editor", () => {
  const record: SpaceRecord = {
    id: "s1",
    version: 2,
    label: "Selling",
    icon: "shopping-cart",
    module: "selling",
    sequence: 1,
    sharing: "roles",
    roles: [{ id: "x", role: "Sales User" }],
    description: null,
    blocks: [
      { type: "shortcut", label: "Unpaid", entity: "SalesInvoice", filters: { status: "Unpaid" }, show_count: true },
      { type: "chart", chart: "" },
      { type: "markdown", content: "Hello", width: 6 },
    ],
  };

  it("opens a saved space with a toolbar per block", () => {
    const qc = client();
    qc.setQueryData(studioKeys.record("spaces", "s1"), record);
    const html = render(<SpaceEditor />, "/studio/spaces/s1/edit", "/studio/spaces/:id/edit", qc);
    expect(html).toContain("Edit Selling");
    expect(html).toContain("Move Shortcut: Unpaid");
    expect(html).toContain("Actions for Chart");
    // An unfinished block says what it needs instead of loading.
    expect(html).toContain("Choose a chart");
    expect(html).toContain("Add block");
  });

  it("starts a new space from a module", () => {
    const qc = client();
    qc.setQueryData(["reports"], { reports: [{ name: "sales_register", label: "Sales Register", params: [] }] });
    const html = render(<SpaceEditor />, "/studio/spaces/new?module=selling", "/studio/spaces/new", qc);
    expect(html).toContain("New space");
    expect(html).toContain("Shortcut: Sales Invoices");
    expect(html).toContain("Link card: Lists");
    expect(html).toContain("Link card: Reports");
  });

  it("refuses to edit a standard space", () => {
    const qc = client();
    qc.setQueryData(studioKeys.record("spaces", "s1"), { ...record, is_standard: true });
    const html = render(<SpaceEditor />, "/studio/spaces/s1/edit", "/studio/spaces/:id/edit", qc);
    expect(html).toContain("Duplicate to customize");
    expect(html).toContain('href="/studio/spaces/new?from=s1"');
  });
});
