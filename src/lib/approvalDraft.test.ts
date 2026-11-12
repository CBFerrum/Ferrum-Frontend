import { describe, expect, it } from "vitest";
import { checkPolicy, fromPolicy, newPolicy, stepAt, toPolicy } from "./approvalDraft";
import { fromMeta, toWorkflow } from "./workflowDraft";
import type { Workflow } from "./meta";

const policy = {
  steps: [
    { label: "Manager", approvers: { field: "manager" }, future: { kept: true } },
    { label: "Finance", approvers: { role: "Finance" }, need: 2, when: "doc.amount > 10000", not_earlier_deciders: true, not_who_took: ["Prepare"], calendar: "Office", remind_after: "PT8H", escalate_after: "P2D", escalate_to: { role: "Director" } },
  ],
  reset_on: ["amount"],
  on_reject: "Rejected",
  also: 1,
};
const keyOf = (n: string) => `k:${n}`;
const nameOf = (k: string) => k.slice(2);

describe("an approval policy as a draft", () => {
  it("goes back as it came, unknown properties included", () => {
    const back = toPolicy(fromPolicy(policy, keyOf)!, nameOf);
    expect(back).toEqual(policy);
    expect((back.steps as unknown[])[0]).toMatchObject({ future: { kept: true } });
  });

  it("is checked in words before anything is sent", () => {
    const d = newPolicy();
    expect(checkPolicy(d).map((p) => p.message)).toEqual(["Approval step 1: say who decides."]);
    d.steps[0].who.value = "Finance";
    d.steps[0].need = "number";
    d.steps[0].count = "0";
    expect(checkPolicy(d)[0].message).toContain("whole number");
    d.steps[0].count = "3";
    expect(checkPolicy(d)).toEqual([]);
    expect(checkPolicy({ ...d, steps: [] })[0].message).toContain("at least one step");
  });

  it("finds the step the server's refusal names", () => {
    const d = fromPolicy(policy, keyOf)!;
    expect(stepAt("customization rejected: Order: transition Submit, approval step 2: there is no role X", "Submit", d)).toBe(d.steps[1].key);
    expect(stepAt("transition Other, approval step 2: x", "Submit", d)).toBeUndefined();
  });
});

describe("a workflow with approvals, params and effects", () => {
  const wf = {
    name: "w", initial_state: "Draft", states: [{ name: "Draft", docstatus: 0, edit_roles: [] }, { name: "Rejected", docstatus: 0, edit_roles: [] }],
    transitions: [{ action: "Submit", from: "Draft", to: "Draft", roles: [], may_take: true, package: "erp", params: [{ name: "reason", label: "Reason", type: "text", required: true }], effects: [{ type: "set_fields", values: { note: "params.reason" } }], approval: policy, extra_mark: "keep" }],
  } as unknown as Workflow;
  it("keeps what the server sent, and drops the marks it adds", () => {
    const out = toWorkflow(fromMeta({ name: "O", label: "O" }, wf), "O").transitions[0] as Record<string, unknown>;
    expect(out.extra_mark).toBe("keep");
    expect(out.may_take).toBeUndefined();
    expect(out.package).toBeUndefined();
    expect(out.params).toEqual([{ name: "reason", label: "Reason", type: "text", required: true }]);
    expect((out.effects as unknown[]).length).toBe(1);
    expect((out.approval as { on_reject: string }).on_reject).toBe("Rejected");
  });
});
