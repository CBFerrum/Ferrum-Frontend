import { describe, expect, it } from "vitest";
import type { EntityMeta, Field } from "../../lib/meta";
import {
  applyView,
  clampWidth,
  columnChoices,
  defaultColumns,
  layoutOf,
  queryOf,
  readPrefs,
  resolveColumns,
  sameQuery,
  validSort,
  viewNameError,
  withLayout,
  withoutView,
  withWidth,
  type ListPrefs,
} from "./settings";

const f = (name: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({ name, label: name, type, can_read: true, storage: "column", ...extra });

const meta = (extra: Partial<EntityMeta> = {}): EntityMeta =>
  ({
    name: "Invoice",
    label: "Invoice",
    label_plural: "Invoices",
    kind: "document",
    submittable: true,
    numbering: { template: "INV-{seq}" },
    title_field: "customer",
    list: { columns: [], sort: null },
    form: [],
    search_fields: [],
    rules: [],
    actions: [],
    children: {},
    permissions: { read: "all", write: "all", create: "all", delete: "all", submit: "all", cancel: "all", export: "all", import: "all" },
    fields: [
      f("customer", "link", { in_list: true }),
      f("total", "currency", { in_list: true }),
      f("notes", "text", { storage: "ext" }),
      f("secret_margin", "decimal", { can_read: false }),
      f("items", "table"),
      f("x_region", "data", { in_list: true }),
    ],
    ...extra,
  }) as EntityMeta;

describe("columns", () => {
  it("defaults to in_list fields with the number and status", () => {
    expect(defaultColumns(meta())).toEqual(["number", "customer", "total", "x_region", "docstatus"]);
    expect(defaultColumns(meta({ list: { columns: ["customer", "secret_margin"] } }))).toEqual(["customer", "x_region", "docstatus"]);
  });
  it("offers every readable field and the system fields, never tables or unreadable fields", () => {
    const names = columnChoices(meta()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["notes", "created_at", "updated_at", "docstatus", "number"]));
    expect(names).not.toContain("items");
    expect(names).not.toContain("secret_margin");
  });
  it("keeps the stored order, drops columns that no longer exist, falls back to the defaults", () => {
    expect(resolveColumns(meta(), ["total", "gone", "customer", "total"]).map((c) => c.name)).toEqual(["total", "customer"]);
    expect(resolveColumns(meta(), ["gone"]).map((c) => c.name)).toEqual(defaultColumns(meta()));
    expect(resolveColumns(meta(), undefined).map((c) => c.name)).toEqual(defaultColumns(meta()));
  });
  it("only accepts a sort on a sortable column", () => {
    expect(validSort(meta(), "total desc")).toBe("total desc");
    expect(validSort(meta(), "notes asc")).toBeUndefined(); // stored outside a column
    expect(validSort(meta(), "secret_margin asc")).toBeUndefined();
    expect(validSort(meta(), "total sideways")).toBeUndefined();
    expect(validSort(meta(), "created_at desc")).toBe("created_at desc");
  });
});

describe("stored settings", () => {
  it("drops malformed values", () => {
    const p = readPrefs({
      columns: ["a", 3, "b"],
      widths: { a: 5, b: "wide", c: 5000 },
      sort: 4,
      views: { v1: { name: " Mine ", query: { "f.status": "Open", junk: "x", q: 4 } }, v2: { name: "" }, v3: "x" },
      default_view: "v2",
    });
    expect(p).toEqual({
      columns: ["a", "b"],
      widths: { a: 60, c: 800 },
      sort: undefined,
      views: { v1: { id: "v1", name: "Mine", query: { "f.status": "Open" }, columns: undefined, widths: undefined } },
      default_view: undefined,
    });
    expect(readPrefs("nonsense")).toEqual({ columns: undefined, widths: undefined, sort: undefined, views: {}, default_view: undefined });
  });
  it("changes the layout in use: a view's, else the personal one", () => {
    const p: ListPrefs = { columns: ["a"], views: { v: { id: "v", name: "V", query: {} } } };
    expect(withLayout(p, null, { columns: ["b"] }).columns).toEqual(["b"]);
    const q = withLayout(p, "v", { columns: ["c"], widths: { c: 100 } });
    expect(q.columns).toEqual(["a"]);
    expect(q.views.v).toMatchObject({ columns: ["c"], widths: { c: 100 } });
    expect(withLayout(p, "deleted", { columns: ["z"] })).toBe(p);
  });
  it("removing the default view clears the default", () => {
    const p: ListPrefs = { views: { v: { id: "v", name: "V", query: {} } }, default_view: "v" };
    expect(withoutView(p, "v")).toEqual({ views: {}, default_view: undefined });
  });
  it("checks view names", () => {
    const views = { v: { id: "v", name: "Open invoices", query: {} } };
    expect(viewNameError("  ", views)).toBe("Enter a name.");
    expect(viewNameError("open INVOICES", views)).toMatch(/already/);
    expect(viewNameError("open invoices", views, "v")).toBeNull(); // renaming itself
    expect(viewNameError("x".repeat(61), views)).toMatch(/60/);
  });
  it("sets, clamps and clears widths", () => {
    expect([clampWidth(10), clampWidth(123.4), clampWidth(9000)]).toEqual([60, 123, 800]);
    expect(withWidth(undefined, "a", 10)).toEqual({ a: 60 });
    expect(withWidth({ a: 100, b: 200 }, "a", undefined)).toEqual({ b: 200 });
    expect(withWidth({ a: 100 }, "a", undefined)).toBeUndefined();
  });
  it("finds the layout in use", () => {
    const p: ListPrefs = { columns: ["a"], views: { v: { id: "v", name: "V", query: {}, columns: ["b"] } } };
    expect(layoutOf(p, "v").columns).toEqual(["b"]);
    expect(layoutOf(p, null).columns).toEqual(["a"]);
    expect(layoutOf(p, "gone").columns).toEqual(["a"]);
  });
});

describe("views in the URL", () => {
  it("reads the query part of the list's URL", () => {
    const sp = new URLSearchParams("f.status=Open&q=acme&sort=total+desc&view=board&by=status&saved=v1&other=1&f.empty=");
    expect(queryOf(sp)).toEqual({ "f.status": "Open", q: "acme", sort: "total desc", view: "board", by: "status" });
  });
  it("applies a view over the current URL, keeping unrelated parameters", () => {
    const sp = new URLSearchParams("f.status=Open&q=acme&other=1");
    const view = { id: "v1", name: "Big", query: { "f.total": "1000", sort: "total desc" } };
    expect(applyView(sp, view).toString()).toBe("other=1&f.total=1000&sort=total+desc&saved=v1");
    expect(applyView(new URLSearchParams("f.a=1&saved=v1&other=1"), null).toString()).toBe("other=1");
  });
  it("compares queries regardless of order", () => {
    expect(sameQuery({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
    expect(sameQuery({ a: "1" }, { a: "1", q: "x" })).toBe(false);
  });
});
