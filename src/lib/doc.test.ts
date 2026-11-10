import { describe, expect, it } from "vitest";
import { calcBody, carryTitles, createBody, diffDoc, errorAtCell, hasInvalidNumbers, mergeCalc } from "./doc";
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

  it("moves editable values the server set, not ones the user changed since", () => {
    const prev = { po_no: "auto-1", items: [{ id: "r1", item: "i1", qty: "3" }] };
    const server = { po_no: "auto-2", items: [{ id: "r1", item: "i1", qty: "36" }] };
    const out = mergeCalc(meta, { po_no: "auto-1", items: [{ id: "r1", item: "i1", qty: "3" }] }, server, prev);
    expect(out).toMatchObject({ po_no: "auto-2", items: [{ qty: "36" }] });
    const typed = mergeCalc(meta, { po_no: "mine", items: [{ id: "r1", item: "i1", qty: "4" }] }, server, prev);
    expect(typed).toMatchObject({ po_no: "mine", items: [{ qty: "4" }] });
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

describe("lines within lines", () => {
  const ctl = {
    name: "XControl",
    fields: [rw("code", "data"), rw("total", "decimal", { read_only: true }), rw("tests", "table", { of: "XTest" })],
    children: {
      tests: {
        entity: "XTest",
        label: "Tests",
        fields: [rw("name", "data"), rw("spent", "decimal", { read_only: true }), rw("evidence", "table", { of: "XEvidence" })],
        children: { evidence: { entity: "XEvidence", label: "Evidence", fields: [rw("title", "data"), rw("amount", "decimal")] } },
      },
    },
  } as unknown as EntityMeta;
  const base = {
    id: "c1",
    code: "A-1",
    tests: [
      { id: "t1", name: "door", spent: "0.3", evidence: [{ id: "e1", title: "photo", amount: "0.1" }] },
      { id: "t2", name: "lock", spent: "0", evidence: [] },
    ],
  };
  const withTests = (tests: unknown[]) => ({ ...base, tests });

  it("sends nothing when nothing changed, and nothing for server values", () => {
    expect(diffDoc(ctl, base, structuredClone(base))).toEqual({});
    expect(diffDoc(ctl, base, withTests([{ ...base.tests[0], spent: "9" }, base.tests[1]]))).toEqual({});
  });

  it("a changed line without its sub-lines changing sends no sub-table", () => {
    const out = diffDoc(ctl, base, withTests([{ ...base.tests[0], name: "gate" }, base.tests[1]]));
    expect(out).toEqual({ tests: [{ id: "t1", name: "gate" }, { id: "t2", name: "lock" }] });
  });

  it("adding, changing and removing a sub-line each send that line with its sub-table", () => {
    const added = diffDoc(ctl, base, withTests([base.tests[0], { ...base.tests[1], evidence: [{ _key: "n", title: "scan", amount: "1" }] }]));
    expect(added).toEqual({ tests: [{ id: "t1", name: "door" }, { id: "t2", name: "lock", evidence: [{ title: "scan", amount: "1" }] }] });
    const changed = diffDoc(ctl, base, withTests([{ ...base.tests[0], evidence: [{ id: "e1", title: "photo", amount: "0.2" }] }, base.tests[1]]));
    expect(changed).toEqual({ tests: [{ id: "t1", name: "door", evidence: [{ id: "e1", title: "photo", amount: "0.2" }] }, { id: "t2", name: "lock" }] });
    const removed = diffDoc(ctl, base, withTests([{ ...base.tests[0], evidence: [] }, base.tests[1]]));
    expect(removed).toEqual({ tests: [{ id: "t1", name: "door", evidence: [] }, { id: "t2", name: "lock" }] });
  });

  it("a new line goes with its sub-lines; createBody sends them whole", () => {
    const doc = { tests: [{ _key: "k", name: "x", evidence: [{ _key: "k2", title: "t", amount: "1", _titles: {} }] }] };
    expect(createBody(ctl, doc)).toEqual({ tests: [{ name: "x", evidence: [{ title: "t", amount: "1" }] }] });
    expect(diffDoc(ctl, { tests: [] }, doc)).toEqual({ tests: [{ name: "x", evidence: [{ title: "t", amount: "1" }] }] });
  });

  it("calcBody and carryTitles reach the sub-lines", () => {
    const doc = { tests: [{ _key: "k", _titles: {}, name: "x", evidence: [{ _key: "k2", _titles: { a: "b" }, title: "t" }] }] };
    expect(calcBody(ctl, doc)).toEqual({ tests: [{ name: "x", evidence: [{ title: "t" }] }] });
    const prev = { tests: [{ name: "x", evidence: [{ title: "t", _titles: { title: "T" } }] }] };
    const saved = { tests: [{ id: "t1", name: "x", evidence: [{ id: "e1", title: "t" }] }] };
    expect(carryTitles(ctl, saved, prev).tests).toEqual([{ id: "t1", name: "x", _titles: {}, evidence: [{ id: "e1", title: "t", _titles: { title: "T" } }] }]);
  });

  it("mergeCalc takes server totals on a line and on its sub-lines, keeping what was typed", () => {
    const local = { code: "A-1", tests: [{ name: "door", spent: "0", evidence: [{ title: "photo", amount: "0.1" }] }] };
    const server = { code: "A-1", total: "0.3", tests: [{ name: "door", spent: "0.3", evidence: [{ title: "photo", amount: "0.5" }] }] };
    const prev = { tests: [{ name: "door", spent: "0", evidence: [{ title: "photo", amount: "0.4" }] }] };
    const out = mergeCalc(ctl, local, server, prev);
    const tests = out.tests as { spent: string; evidence: unknown[] }[];
    expect(tests[0].spent).toBe("0.3");
    expect(tests[0].evidence[0]).toBe(local.tests[0].evidence[0]);
    expect(mergeCalc(ctl, local, { tests: [{ ...local.tests[0] }] }, local)).toBe(local);
  });

  it("mergeCalc adopts server-made sub-lines under client keys", () => {
    const local = { tests: [{ name: "d" }] };
    const out = mergeCalc(ctl, local, { tests: [{ name: "d", evidence: [{ id: "p1", title: "t" }] }] }, local);
    expect((out.tests as { evidence: unknown[] }[])[0].evidence).toEqual([{ title: "t", _key: "p1" }]);
  });

  it("hasInvalidNumbers looks in sub-lines", () => {
    expect(hasInvalidNumbers(ctl, { tests: [{ evidence: [{ amount: "1.5" }] }] })).toBe(false);
    expect(hasInvalidNumbers(ctl, { tests: [{ evidence: [{ amount: "abc" }] }] })).toBe(true);
  });
});

describe("errorAtCell", () => {
  const line = { field: "name", message: "m", row: ["tests", 0] as [string, number] };
  const sub = { field: "title", message: "m", row: ["tests", 0] as [string, number], path: [["tests", 0], ["evidence", 1]] as [string, number][] };
  it("tells a line's cell from a cell in its own lines", () => {
    expect(errorAtCell(line, "tests", { row: 0, field: "name" })).toBe(true);
    expect(errorAtCell(sub, "tests", { row: 0, field: "title" })).toBe(false);
    expect(errorAtCell(sub, "tests", { row: 0, field: "evidence", sub: { row: 1, field: "title" } })).toBe(true);
    expect(errorAtCell(sub, "tests", { row: 0, field: "evidence", sub: { row: 0, field: "title" } })).toBe(false);
    expect(errorAtCell(line, "tests", { row: 0, field: "evidence", sub: { row: 1, field: "name" } })).toBe(false);
  });
});
