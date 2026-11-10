import { describe, expect, it } from "vitest";
import { actionButtons, transitionOffered } from "./actionButtons";
import type { ActionDef } from "./meta";

const act = (o: Partial<ActionDef>): ActionDef => ({ name: "a", label: "A", docstatus: [], permission: "write", ...o });
const ctx = (permitted = true, doc: Record<string, unknown> = { status: "Draft", owner: "me@x" }) => ({ doc, user: { email: "me@x" }, docstatus: 0, permitted: () => permitted });

describe("which buttons a record shows", () => {
  it("leaves out hidden actions, other lifecycle states and false conditions", () => {
    const list = [act({ name: "h", hidden: true }), act({ name: "s", docstatus: [1] }), act({ name: "c", condition: "doc.status == 'Open'" }), act({ name: "ok", condition: "doc.status == 'Draft'" })];
    expect(actionButtons(list, ctx()).map((b) => b.action.name)).toEqual(["ok"]);
  });
  it("needs both: the server's may_run (roles) and the caller's rights on this record", () => {
    const list = [act({ name: "no", may_run: false }), act({ name: "yes", may_run: true }), act({ name: "old" })];
    expect(actionButtons(list, ctx(true)).map((b) => b.action.name)).toEqual(["yes", "old"]);
    // Someone else's record, to a person who may change only their own: nothing, whatever may_run says.
    expect(actionButtons(list, ctx(false))).toEqual([]);
  });
  it("disables a button the first refusal that holds names, with its message", () => {
    const a = act({ refuse_if: [{ when: "doc.status == 'Open'", message: "closed" }, { when: "doc.owner == user.email", message: "not your own" }, { when: "true", message: "never" }] });
    expect(actionButtons([a], ctx())[0].refusal).toBe("not your own");
    expect(actionButtons([a], ctx(true, { status: "Open" }))[0].refusal).toBe("closed");
  });
  it("sees params as empty, and leaves a button enabled when an expression cannot be evaluated here", () => {
    const a = act({ refuse_if: [{ when: "params.note == 'x'", message: "x" }, { when: "doc.status.startsWith('D')", message: "unsupported" }, { when: "", message: "blank" }] });
    expect(actionButtons([a], ctx())[0].refusal).toBeNull();
  });
  it("leaves a button shown and enabled when an expression reads links or row: the server decides", () => {
    const a = act({ condition: "links.type.name == 'Gold'", refuse_if: [{ when: "links.type.documents.exists(row, row.item == 'x')", message: "m" }, { when: "row.item == params.item", message: "m" }] });
    const [b] = actionButtons([a], ctx());
    expect(b.refusal).toBeNull();
  });
});

describe("which workflow steps are offered", () => {
  const step = (o: Partial<Parameters<typeof transitionOffered>[0]> = {}) => ({ action: "Approve", from: "A", to: "B", roles: ["Approver"], ...o });
  const who = (o = {}) => ({ isAdmin: false, roles: ["Approver"], canWrite: true, ...o });
  it("a step naming roles needs one of them", () => {
    expect(transitionOffered(step(), who())).toBe(true);
    expect(transitionOffered(step(), who({ roles: [] }))).toBe(false);
    expect(transitionOffered(step(), who({ roles: [], isAdmin: true }))).toBe(true);
  });
  it("a step naming no roles needs the right to change this record", () => {
    expect(transitionOffered(step({ roles: [] }), who())).toBe(true);
    expect(transitionOffered(step({ roles: [] }), who({ canWrite: false }))).toBe(false);
  });
  it("the server's may_take false hides the step; true stands for the roles", () => {
    expect(transitionOffered(step({ may_take: false }), who())).toBe(false);
    expect(transitionOffered(step({ may_take: true }), who({ roles: [] }))).toBe(true);
    expect(transitionOffered(step({ roles: [], may_take: true }), who({ canWrite: false }))).toBe(false);
  });
  it("an older server sends no may_take: the roles decide", () => {
    expect(transitionOffered(step({ may_take: undefined }), who({ roles: ["Other"] }))).toBe(false);
  });
});
