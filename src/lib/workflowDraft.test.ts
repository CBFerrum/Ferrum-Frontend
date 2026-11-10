import { describe, expect, it } from "vitest";
import {
  checkDraft, creatorLinkChoices, fromMeta, move, reachable, removeState, startDraft, toWorkflow, workflowDesignerLink, workflowOp,
  type Draft,
} from "./workflowDraft";
import type { EntityMeta, Workflow } from "./meta";

// The shape a packaged workflow has in an entity's meta (a purchase order with an approval step).
const packaged: Workflow = {
  name: "Purchase approval",
  initial_state: "Draft",
  states: [
    { name: "Draft", docstatus: 0, edit_roles: ["Purchaser"], required: ["supplier"] },
    { name: "Pending Approval", docstatus: 0, edit_roles: [], editable: ["notes"] },
    { name: "Approved", docstatus: 1, edit_roles: [] },
    { name: "Rejected", docstatus: 2, edit_roles: [] },
  ],
  transitions: [
    { action: "Submit for approval", from: "Draft", to: "Pending Approval", roles: ["Purchaser"], condition: null },
    { action: "Approve", from: "Pending Approval", to: "Approved", roles: ["Purchase Manager"], condition: "doc.total < 10000", not_creator: true, not_creator_of: ["supplier", "items.item"] },
    { action: "Reject", from: "Pending Approval", to: "Rejected", roles: ["Purchase Manager"] },
  ],
};
const meta = { name: "PurchaseOrder", label: "Purchase Order", submittable: true } as unknown as EntityMeta;
const draftOf = (wf: Workflow = packaged) => fromMeta(meta, wf);
const names = (d: Draft, keys: string[]) => keys.map((k) => d.states.find((s) => s.key === k)?.name);
const messages = (d: Draft, submittable = true) => checkDraft(d, submittable).map((p) => p.message);

describe("a workflow and its draft", () => {
  it("round trips a packaged workflow to what the server takes", () => {
    const out = toWorkflow(draftOf(), "PurchaseOrder");
    expect(out.name).toBe("Purchase approval");
    expect(out.entity).toBe("PurchaseOrder");
    expect(out.initial_state).toBe("Draft");
    expect(out.states.map((s) => [s.name, s.docstatus, s.edit_roles, s.editable, s.required])).toEqual([
      ["Draft", 0, ["Purchaser"], [], ["supplier"]],
      ["Pending Approval", 0, [], ["notes"], []],
      ["Approved", 1, [], [], []],
      ["Rejected", 2, [], [], []],
    ]);
    expect(out.transitions[1]).toEqual({
      action: "Approve", from: "Pending Approval", to: "Approved", roles: ["Purchase Manager"], condition: "doc.total < 10000", not_creator: true, not_creator_of: ["supplier", "items.item"],
    });
    expect(out.transitions[0].condition).toBeNull();
    expect(out.transitions[2]).toMatchObject({ not_creator: false, not_creator_of: [] });
    // And back again: the same draft in all but its keys.
    expect(toWorkflow(fromMeta(meta, JSON.parse(JSON.stringify(out))), "PurchaseOrder")).toEqual(out);
  });

  it("is the operation set_workflow", () => {
    expect(workflowOp(draftOf(), "PurchaseOrder")).toEqual({ op: "set_workflow", workflow: toWorkflow(draftOf(), "PurchaseOrder") });
  });

  it("names a workflow after its entity when it has no name, and starts with one state", () => {
    expect(draftOf({ ...packaged, name: undefined }).name).toBe("Purchase Order workflow");
    const s = startDraft(meta);
    expect(s.states).toHaveLength(1);
    expect(s.initial).toBe(s.states[0].key);
    expect(messages(s)).toEqual([]);
  });

  it("keeps every action on the same states when a state is renamed or moved", () => {
    let d = draftOf();
    const [draft, pending] = d.states;
    d = { ...d, states: d.states.map((s) => (s.key === pending.key ? { ...s, name: "Waiting" } : s)) };
    d = { ...d, states: move(d.states, 1, -1) };
    const out = toWorkflow(d, "PurchaseOrder");
    expect(out.states.map((s) => s.name)).toEqual(["Waiting", "Draft", "Approved", "Rejected"]);
    expect(out.transitions.map((t) => [t.action, t.from, t.to])).toEqual([
      ["Submit for approval", "Draft", "Waiting"],
      ["Approve", "Waiting", "Approved"],
      ["Reject", "Waiting", "Rejected"],
    ]);
    // Renaming the starting state moves the starting point with it.
    d = { ...d, states: d.states.map((s) => (s.key === draft.key ? { ...s, name: "New" } : s)) };
    expect(toWorkflow(d, "PurchaseOrder").initial_state).toBe("New");
  });

  it("moves an item and stays put at the ends", () => {
    expect(move([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(move([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  it("removes a state with its actions and hands the start to the first left", () => {
    const d = draftOf();
    const out = removeState(d, d.states[0].key);
    expect(names(out, [out.initial])).toEqual(["Pending Approval"]);
    expect(out.transitions.map((t) => t.action)).toEqual(["Approve", "Reject"]);
  });

  it("links to the entity's links and its child tables' links, as the server accepts them", () => {
    const m = {
      fields: [{ name: "supplier", label: "Supplier", type: "link", to: "Supplier" }, { name: "notes", label: "Notes", type: "text" }, { name: "owner", label: "Owner", type: "link" }, { name: "items", label: "Items", type: "table", of: "POItem" }],
      children: { items: { entity: "POItem", label: "Items", fields: [{ name: "item", label: "Item", type: "link", to: "Item" }, { name: "qty", label: "Qty", type: "decimal" }] } },
    } as unknown as EntityMeta;
    expect(creatorLinkChoices(m).map((c) => c.value)).toEqual(["supplier", "items.item"]);
  });

  it("opens at its own address", () => {
    expect(workflowDesignerLink("Purchase Order")).toBe("/customize/Purchase%20Order/workflow");
  });
});

describe("checking a draft before it is sent", () => {
  it("accepts the packaged workflow", () => {
    expect(messages(draftOf())).toEqual([]);
  });

  it("wants a state", () => {
    expect(messages({ name: "x", initial: "", states: [], transitions: [] })).toEqual(["Add at least one state."]);
  });

  it("wants names", () => {
    const d = draftOf();
    d.states[1].name = "  ";
    d.transitions[0].action = "";
    expect(messages(d)).toEqual(expect.arrayContaining(["Every state needs a name.", "Every action needs a name."]));
  });

  it("wants state names to differ", () => {
    const d = draftOf();
    d.states[3].name = "Approved";
    expect(messages(d)).toContain("Two states are called “Approved”: give each its own name.");
  });

  it("wants a starting state that exists", () => {
    const d = { ...draftOf(), initial: "gone" };
    expect(messages(d)).toContain("Choose the state a new record starts in.");
  });

  it("wants every action to start and end in a state that exists", () => {
    const d = draftOf();
    d.transitions[0].to = "gone";
    d.transitions[2].from = "gone";
    const m = messages(d);
    expect(m).toContain("The action “Submit for approval” does not lead to a state that exists.");
    expect(m).toContain("The action “Reject” does not start from a state that exists.");
  });

  it("wants action names to differ within a state, and lets another state reuse one", () => {
    const d = draftOf();
    d.transitions[2].action = "Approve";
    expect(messages(d)).toContain("“Pending Approval” has two actions called “Approve”: rename one.");
    d.transitions[2].from = d.states[0].key; // from Draft instead
    expect(messages(d)).toEqual([]);
  });

  it("finds a state nothing leads to, and one only an unreachable state leads to", () => {
    const d = draftOf();
    d.transitions = d.transitions.filter((t) => t.action !== "Submit for approval");
    const m = messages(d);
    expect(m).toContain("“Pending Approval” can never be reached: no action leads to it from the starting state.");
    expect(m).toContain("“Approved” can never be reached: no action leads to it from the starting state.");
    expect(reachable(d).size).toBe(1);
  });

  it("allows a loop back to an earlier state", () => {
    const d = draftOf();
    d.transitions.push({ ...d.transitions[2], key: "t99", action: "Reopen", from: d.states[3].key, to: d.states[0].key });
    expect(messages(d)).toEqual([]);
  });

  it("refuses submitted or cancelled only where the entity is never submitted", () => {
    expect(messages(draftOf(), false)).toEqual(expect.arrayContaining([expect.stringContaining("“Approved” cannot mean submitted or cancelled")]));
  });
});
