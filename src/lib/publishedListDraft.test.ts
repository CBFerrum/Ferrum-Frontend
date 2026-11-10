import { describe, expect, it } from "vitest";
import { checkList, currentLists, fromList, listName, offering, publicPath, saveBatch, setLabel, startList, takeDownBatch, toList, type ListDraft } from "./publishedListDraft";
import type { Field } from "./meta";

const f = (name: string, type: string, extra: Record<string, unknown> = {}) => ({ name, label: name, type, can_read: true, can_write: true, ...extra }) as unknown as Field;
const fields = [f("holder", "data"), f("kind", "select"), f("email", "email"), f("mobile", "phone"), f("token", "secret"), f("scan", "attach"), f("items", "table"), f("salary", "currency", { group: "hr" }), f("issued_on", "date")];
const meta = { kind: "document" as const, form: [{ fields: ["kind", "holder", "email"] }], fields, numbering: { template: "P-{seq:4}" } };
const def = { name: "permits", label: "Issued permits", description: "Trade permits", fields: ["number", "holder"], filter: [["kind", "=", "Trade"], ["issued_on", ">=", "2026-11-10"]], sort: ["issued_on", "desc"], csv: true, limit: 500 };

describe("a list as a draft", () => {
  it("goes back unchanged", () => {
    expect(toList(fromList(def))).toEqual(def);
    const small = { name: "a", label: "A", fields: ["holder"] };
    expect(toList(fromList(small))).toEqual(small);
  });
  it("drops what the server adds", () => {
    expect(toList(fromList({ ...def, superseded_by: "x", is_active: true }))).toEqual(def);
  });
});

describe("the name", () => {
  it("is made from the label", () => {
    expect(listName("  Issued Permits (2026)! ")).toBe("issued-permits-2026");
    expect(listName("Café prices")).toBe("cafe-prices");
    expect(listName("???")).toBe("");
  });
  it("follows the label until saved, then stays", () => {
    expect(setLabel(startList(), "Price list").name).toBe("price-list");
    expect(setLabel({ ...startList(), nameTouched: true, name: "mine" }, "Other").name).toBe("mine");
    expect(setLabel(fromList(def), "New words").name).toBe("permits");
  });
  it("makes the public path", () => expect(publicPath("acme", "permits")).toBe("/public/acme/lists/permits"));
});

describe("which fields may be offered", () => {
  const { offered, unavailable } = offering(meta);
  it("offers the number first, then the form's order, then the rest", () => {
    expect(offered.map((o) => o.name)).toEqual(["number", "kind", "holder", "issued_on"]);
  });
  it("says why not, in words", () => {
    expect(Object.fromEntries(unavailable.map((u) => [u.name, u.why]))).toEqual({
      email: "an email address", mobile: "a phone number", token: "a secret", scan: "an attachment", items: "lines of the record", salary: "in a field group: only some people may read it",
    });
  });
  it("has no number on an entity without numbering", () => expect(offering({ ...meta, numbering: null }).offered[0].name).toBe("kind"));
});

describe("checks", () => {
  const ctx = { taken: ["other"], offered: offering(meta).offered, fields };
  const ok = (): ListDraft => fromList(def);
  it("passes a good list", () => expect(checkList(ok(), ctx)).toEqual([]));
  it("finds each fault", () => {
    expect(checkList({ ...ok(), label: " " }, ctx)).toHaveLength(1);
    expect(checkList({ ...ok(), name: "Bad Name" }, ctx)).toHaveLength(1);
    expect(checkList({ ...ok(), name: "other" }, ctx)).toHaveLength(1);
    expect(checkList({ ...ok(), fields: [] }, ctx)).toHaveLength(1);
    expect(checkList({ ...ok(), fields: ["holder", "email"] }, ctx)).toHaveLength(1);
    expect(checkList({ ...ok(), fields: Array.from({ length: 13 }, (_, i) => `f${i}`) }, ctx).length).toBeGreaterThan(1);
    expect(checkList({ ...ok(), limit: "0" }, ctx)).toHaveLength(1);
    expect(checkList({ ...ok(), limit: "1001" }, ctx)).toHaveLength(1);
    expect(checkList({ ...ok(), limit: "2.5" }, ctx)).toHaveLength(1);
    expect(checkList({ ...ok(), sortField: "nope" }, ctx)).toHaveLength(1);
    expect(checkList({ ...ok(), filters: [{ key: "k", field: "kind", op: "=", value: "" }] }, ctx)).toHaveLength(1);
  });
});

describe("the batches", () => {
  it("saves one publish_list and takes down with unpublish_list", () => {
    expect(saveBatch("XPermit", fromList(def), "n")).toEqual([{ entity: "XPermit", op: { op: "publish_list", list: def }, note: "n" }]);
    expect(takeDownBatch("XPermit", "permits")).toEqual([{ entity: "XPermit", op: { op: "unpublish_list", name: "permits" } }]);
  });
  it("reads the newest live definition", () => {
    const rows = [
      { entity: "XPermit", seq: 1, is_active: true, superseded_by: "b", op: { op: "publish_list", list: { ...def, label: "Old" } } },
      { entity: "XPermit", seq: 2, is_active: true, op: { op: "publish_list", list: def } },
      { entity: "XPermit", seq: 3, is_active: false, op: { op: "publish_list", list: { ...def, name: "off" } } },
      { entity: "Other", seq: 4, is_active: true, op: { op: "publish_list", list: { ...def, name: "elsewhere" } } },
    ];
    expect(currentLists(rows, "XPermit")).toEqual([def]);
  });
});
