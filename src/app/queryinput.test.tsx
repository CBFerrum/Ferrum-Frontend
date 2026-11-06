// A Studio query kept in a record's JSON field (`widget: studio_query`), read and drawn on the
// server renderer with the query cache seeded.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Field, Me } from "../lib/meta";
import { studioKeys, type FieldCatalog, type QueryResult, type Spec } from "../lib/studio";
import QueryInput, { specOf } from "./QueryInput";

const spec: Spec = { entity: "SalesInvoice", group_by: [{ field: "customer" }], measures: [{ fn: "count" }] };

describe("a query field's value", () => {
  it("is a query when it names its entity, as an object or as JSON", () => {
    expect(specOf(spec)).toEqual(spec);
    expect(specOf(JSON.stringify(spec))).toEqual(spec);
  });

  it("is not one otherwise, so the field is written as JSON", () => {
    for (const v of [null, undefined, "", "{", "[]", [], { measures: [] }, { entity: 3 }, 7]) expect(specOf(v)).toBeNull();
  });
});

const me: Me = {
  tenant: "t",
  user: { id: "u1", email: "a@b.test", full_name: "A", is_admin: true, roles: [] },
  default_company: null,
  scopes: {},
  fiscal_year_start_month: 4,
  packages: [],
};
const field = (path: string, label: string, type: string, extra: object = {}) => ({ path, label, type, group: "Sales Invoice", groupable: true, aggregates: [], buckets: [], bucket_required: false, ...extra });
const catalog: FieldCatalog = {
  entity: "SalesInvoice",
  label: "Sales Invoice",
  fields: [field("customer", "Customer", "link", { to: "Customer", aggregates: ["count_distinct"] }), field("grand_total", "Grand Total", "currency", { aggregates: ["sum"] })],
  filters: { tag: "_tag", operators: ["=", "!=", "in"] },
  functions: ["count", "count_distinct", "sum", "avg", "min", "max"],
  buckets: [],
  compare: [],
  dates: "",
  limits: { rows: 10000, pivot_columns: 100, pivot_cells: 200000 },
};
const result: QueryResult = {
  columns: [
    { field: "customer", label: "Customer", name: "customer", role: "dimension", to: "Customer", type: "link" },
    { fn: "count", label: "Count", name: "count", role: "measure", type: "int" },
  ],
  rows: [{ _titles: { customer: "Bharat Retail" }, count: 1234, customer: "c2" }],
  totals: { count: 1234 },
  meta: { entity: "SalesInvoice", row_count: 1, sql_ms: 1, timezone: "UTC", truncated: false },
};
const definition = { name: "definition", label: "Definition", type: "json", widget: "studio_query", can_write: true } as Field;

function html(value: unknown, disabled = false, seed: (qc: QueryClient) => void = () => {}): string {
  // A refusal stays as it was answered: on a page, the query asked again is refused again.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
  qc.setQueryData(["me"], me);
  qc.setQueryData(studioKeys.sources, { builtin: [], entities: [{ name: "SalesInvoice", label: "Sales Invoice", module: "selling" }] });
  qc.setQueryData(studioKeys.fields("SalesInvoice"), catalog);
  qc.setQueryData(studioKeys.query(spec), result);
  seed(qc);
  return renderToString(
    <QueryClientProvider client={qc}>
      <QueryInput field={definition} value={value} onChange={() => {}} id="f" disabled={disabled} />
    </QueryClientProvider>,
  ).replace(/<!-- -->/g, "");
}

describe("a query field on a form", () => {
  it("is built with Studio's builder, the first rows beside it", () => {
    const out = html(spec);
    expect(out).toContain("Report shape");
    expect(out).toContain("Count");
    expect(out).toMatch(/1\D?234/); // the preview's totals line (its rows are drawn only on screen)
    expect(out).toContain("Write it as JSON");
  });

  it("starts from nothing, asking what it is about", () => {
    expect(html(null)).toContain("Choose what it is about.");
  });

  it("is written as JSON where Studio is not installed, saying so", async () => {
    // As the server answers a workspace without Studio: its sources refused.
    const refused = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await refused.prefetchQuery({ queryKey: studioKeys.sources, queryFn: () => Promise.reject(new Error("package studio not found")) });
    const state = refused.getQueryState(studioKeys.sources);
    const out = html(spec, false, (qc) => qc.getQueryCache().build(qc, { queryKey: studioKeys.sources }).setState(state!));
    expect(out).toContain("Once Studio is installed");
    expect(out).toContain("<textarea");
  });

  it("is written as JSON when the builder cannot read it, and read only when the field is", () => {
    const bad = html({ measures: [] });
    expect(bad).toContain("<textarea");
    expect(bad).toMatch(/<button[^>]*disabled[^>]*>Build it instead/);
    expect(html(spec, true)).toContain("<pre");
  });
});
