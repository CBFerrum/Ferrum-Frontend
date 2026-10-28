import { describe, expect, it } from "vitest";
import { calcBody, carryTitles, createBody, diffDoc, hasInvalidNumbers, mergeCalc } from "./doc";
import type { EntityMeta, Field } from "./meta";

const rw = (name: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({
  name,
  label: name,
  type,
  can_read: true,
  can_write: true,
  ...extra,
});

const meta = {
  name: "SalesInvoice",
  fields: [
    rw("customer", "link", { to: "Customer" }),
    rw("customer_name", "data", { read_only: true, fetch_from: "customer.customer_name" }),
    rw("posting_date", "date"),
    rw("po_no", "data"),
    rw("grand_total", "currency", { read_only: true }),
    rw("credit_note", "data", { can_write: undefined }),
    rw("items", "table", { of: "SalesInvoiceItem" }),
  ],
  children: {
    items: {
      entity: "SalesInvoiceItem",
      label: "Items",
      fields: [rw("item", "link", { to: "Item" }), rw("qty", "decimal"), rw("rate", "currency", { read_only: true })],
    },
  },
} as unknown as EntityMeta;

describe("createBody", () => {
  it("sends writable values and child rows without client-only keys", () => {
    const body = createBody(meta, {
      customer: "c1",
      customer_name: "Acme",
      po_no: "",
      grand_total: "10",
      credit_note: "x",
      _titles: { customer: "Acme" },
      items: [{ _key: "k1", item: "i1", qty: "2", rate: "5", _titles: { item: "Widget" } }],
    });
    expect(body).toEqual({ customer: "c1", items: [{ item: "i1", qty: "2" }] });
  });
});

describe("diffDoc", () => {
  const base = { id: "d1", version: 3, customer: "c1", po_no: null, grand_total: "10", items: [{ id: "r1", item: "i1", qty: "2", rate: "5" }] };

  it("is empty when only server-managed values changed", () => {
    expect(diffDoc(meta, base, { ...base, grand_total: "99", items: [{ id: "r1", item: "i1", qty: "2", rate: "7" }] })).toEqual({});
    expect(diffDoc(meta, base, { ...base, po_no: "" })).toEqual({});
  });

  it("sends changed fields and whole tables", () => {
    const doc = { ...base, po_no: "PO-1", items: [{ id: "r1", item: "i1", qty: "3", rate: "5" }, { _key: "n", item: "i2" }] };
    expect(diffDoc(meta, base, doc)).toEqual({
      po_no: "PO-1",
      items: [{ id: "r1", item: "i1", qty: "3" }, { item: "i2" }],
    });
  });
});

describe("mergeCalc", () => {
  it("takes computed values and fills blanks but keeps what the user typed", () => {
    const local = {
      customer: "c2",
      customer_name: "Old",
      posting_date: null,
      po_no: "typed",
      _titles: { customer: "Beta" },
      items: [{ _key: "k", item: "i1", qty: "3", _titles: { item: "Widget" } }],
    };
    const server = {
      customer: "c2",
      customer_name: "Beta Corp",
      posting_date: "2026-10-28",
      po_no: "server",
      grand_total: "376.50",
      items: [{ id: "tmp", item: "i1", qty: "3", rate: "125.50" }],
    };
    const out = mergeCalc(meta, local, server);
    expect(out).toMatchObject({ customer_name: "Beta Corp", posting_date: "2026-10-28", po_no: "typed", grand_total: "376.50" });
    expect(out.items).toEqual([{ _key: "k", item: "i1", qty: "3", rate: "125.50", _titles: { item: "Widget" } }]);
    expect(out._titles).toEqual({ customer: "Beta" });
  });

  it("returns the same object when nothing changed and skips tables whose rows changed", () => {
    const local = { customer_name: "A", items: [{ item: "i1" }] };
    expect(mergeCalc(meta, local, { customer_name: "A", items: [{ item: "i1" }] })).toBe(local);
    const skipped = mergeCalc(meta, local, { items: [{ item: "i1", rate: "1" }, { item: "i2" }] });
    expect(skipped.items).toBe(local.items);
  });

  it("adopts rows the server generated into an empty table", () => {
    const out = mergeCalc(meta, { customer_name: "A" }, { customer_name: "A", items: [{ id: "tmp1", idx: 0, item: "i9", rate: "2" }] });
    expect(out.items).toEqual([{ _key: "tmp1", idx: 0, item: "i9", rate: "2" }]);
    expect(createBody(meta, out).items).toEqual([{ item: "i9" }]);
  });

  it("drops a stale link title when the server changes the link", () => {
    const m = { ...meta, fields: [rw("uom", "link", { to: "Uom", read_only: true })], children: {} } as unknown as EntityMeta;
    const out = mergeCalc(m, { uom: "a", _titles: { uom: "Box" } }, { uom: "b" });
    expect(out).toEqual({ uom: "b", _titles: {} });
  });
});

describe("calcBody and carryTitles", () => {
  it("strips client-only keys for _calc", () => {
    expect(calcBody(meta, { id: "d1", customer: "c1", _titles: { customer: "A" }, items: [{ _key: "k", _titles: {}, item: "i1" }] })).toEqual({
      id: "d1",
      customer: "c1",
      items: [{ item: "i1" }],
    });
  });

  it("keeps known titles for links whose value did not change", () => {
    const prev = { customer: "c1", po_no: "x", _titles: { customer: "Acme", project: "P" }, project: "p1", items: [{ item: "i1", _titles: { item: "W" } }] };
    const saved = { customer: "c1", project: "p2", items: [{ id: "r1", item: "i1" }] };
    const out = carryTitles(meta, saved, prev);
    expect(out._titles).toEqual({ customer: "Acme" });
    expect(out.items).toEqual([{ id: "r1", item: "i1", _titles: { item: "W" } }]);
  });
});

describe("hasInvalidNumbers", () => {
  it("spots non-numeric text in numeric fields, including rows", () => {
    expect(hasInvalidNumbers(meta, { items: [{ qty: "3.5" }] })).toBe(false);
    expect(hasInvalidNumbers(meta, { items: [{ qty: "abc" }] })).toBe(true);
    expect(hasInvalidNumbers(meta, { grand_total: "1e5" })).toBe(true);
    expect(hasInvalidNumbers(meta, { po_no: "abc" })).toBe(false);
  });
});
