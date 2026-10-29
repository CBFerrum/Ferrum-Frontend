import { describe, expect, it } from "vitest";
import type { EntityMeta, Field, Me } from "../../lib/meta";
import { bulkActions, chunk, countOf, describeOp, mergeResults, pageState, parseTags, retryIds, rowErrorText, togglePage, toggleRow } from "./bulk";

const order = ["a", "b", "c", "d", "e"];
const set = (...ids: string[]) => new Set(ids);

describe("selection", () => {
  it("toggles one row", () => {
    expect(toggleRow(set(), order, "b", null, false)).toEqual(set("b"));
    expect(toggleRow(set("b"), order, "b", "b", false)).toEqual(set());
  });
  it("shift-click sets the range from the anchor, either direction, to the clicked row's new state", () => {
    expect(toggleRow(set("b"), order, "d", "b", true)).toEqual(set("b", "c", "d"));
    expect(toggleRow(set("e"), order, "b", "e", true)).toEqual(set("b", "c", "d", "e"));
    expect(toggleRow(set("a", "b", "c", "d"), order, "c", "a", true)).toEqual(set("d")); // c was on: a..c off
  });
  it("falls back to a single toggle when the anchor is gone", () => {
    expect(toggleRow(set(), order, "c", "zz", true)).toEqual(set("c"));
  });
  it("selects or clears the page from the header", () => {
    expect(pageState(set(), order)).toBe("none");
    expect(pageState(set("a"), order)).toBe("some");
    expect(pageState(set(...order, "elsewhere"), order)).toBe("all");
    expect(togglePage(set("a", "elsewhere"), order)).toEqual(set("elsewhere", ...order));
    expect(togglePage(set(...order, "elsewhere"), order)).toEqual(set("elsewhere"));
    expect(pageState(set("x"), [])).toBe("none");
  });
});

const f = (name: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({ name, label: name, type, can_read: true, can_write: true, ...extra });
const me = (roles: string[], is_admin = false) => ({ user: { id: "u", email: "u@x.test", full_name: "U", is_admin, roles } }) as Me;
const base = {
  name: "Claim",
  label: "Claim",
  label_plural: "Claims",
  kind: "document",
  submittable: true,
  fields: [
    f("status", "select"),
    f("code", "data", { unique: true }),
    f("total", "currency", { read_only: true }),
    f("amount", "currency", { computed: "1" }),
    f("lines", "table"),
    f("scan", "attach"),
    f("approver", "link"),
    f("hidden_one", "data", { can_write: false }),
  ],
  permissions: { read: "all", write: "all", create: "all", delete: "own", submit: "all", cancel: "none", export: "all", import: "none" },
} as unknown as EntityMeta;

describe("bulk actions", () => {
  it("offers settable fields and the lifecycle the viewer may use", () => {
    const a = bulkActions(base, me([]));
    expect(a.fields.map((x) => x.name)).toEqual(["approver", "status"]);
    expect(a).toMatchObject({ delete: true, submit: true, cancel: false, workflow: [] });
  });
  it("offers workflow actions by role instead of submit and cancel", () => {
    const workflow = {
      initial_state: "Draft",
      states: [],
      transitions: [
        { action: "Approve", from: "Draft", to: "Approved", roles: ["Approver"] },
        { action: "Cancel", from: "Approved", to: "Cancelled", roles: ["Approver"] },
        { action: "Cancel", from: "Rejected", to: "Cancelled", roles: ["Approver"] },
        { action: "Reopen", from: "Cancelled", to: "Draft", roles: ["Manager"] },
      ],
    };
    const m = { ...base, workflow } as EntityMeta;
    expect(bulkActions(m, me(["Approver"]))).toMatchObject({ submit: false, cancel: false, workflow: ["Approve", "Cancel"] });
    expect(bulkActions(m, me([], true)).workflow).toEqual(["Approve", "Cancel", "Reopen"]);
  });
  it("offers nothing that writes on a ledger", () => {
    const a = bulkActions({ ...base, kind: "ledger" } as EntityMeta, me([]));
    expect(a.fields).toEqual([]);
    expect(a.delete).toBe(false);
  });
});

describe("requests and results", () => {
  it("splits large selections into requests of 500", () => {
    const ids = Array.from({ length: 1201 }, (_, i) => String(i));
    expect(chunk(ids).map((c) => c.length)).toEqual([500, 500, 201]);
    expect(chunk([])).toEqual([]);
  });
  it("merges results and finds what to retry, including records never reached", () => {
    const r = mergeResults([
      { succeeded: 1, failed: 1, results: [{ id: "a", ok: true }, { id: "b", ok: false, error: { error: "forbidden", message: "No" } }] },
      { succeeded: 1, failed: 0, results: [{ id: "c", ok: true }] },
    ]);
    expect(r).toMatchObject({ succeeded: 2, failed: 1 });
    expect(retryIds(["a", "b", "c", "d"], r)).toEqual(["b", "d"]);
  });
  it("describes failures with field labels", () => {
    const m = { ...base, fields: [f("status", "select", { label: "Status" })] } as EntityMeta;
    expect(rowErrorText(m, { error: "validation_failed", message: "Please correct", fields: [{ field: "status", message: "must be one of Open, Closed" }] })).toBe(
      "Status: must be one of Open, Closed",
    );
    expect(rowErrorText(m, { error: "internal", message: "An internal error occurred", error_id: "e1" })).toBe("An internal error occurred (reference e1)");
  });
  it("words messages", () => {
    expect(countOf(base, 1)).toBe("1 Claim");
    expect(describeOp({ op: "submit" }).done(countOf(base, 1200))).toBe(`${(1200).toLocaleString()} Claims submitted`);
    expect(describeOp({ op: "workflow", action: "Approve" }).running("3 Claims")).toBe("Applying “Approve” to 3 Claims…");
  });
  it("parses typed tags", () => {
    expect(parseTags(" urgent,  key   account ,Urgent,, ")).toEqual(["urgent", "key account"]);
  });
});
