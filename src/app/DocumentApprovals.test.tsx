// Approval before a document is submitted or cancelled: the screen rendered with a policy on submit and none on cancel, then
// axe; and the draft's round trip (unknown properties stay, nothing a document refuses is sent).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { currentDocumentPolicy, documentOp, effectivePolicy, fromPolicy, shippedPolicy } from "../lib/approvalDraft";
import type { EntityMeta } from "../lib/meta";
import { DocumentApprovals } from "./DocumentApprovals";

const field = (name: string, type: string) => ({ name, label: name.replace(/^./, (c) => c.toUpperCase()), type, can_read: true, can_write: true });
const meta = { name: "Bill", label: "Bill", kind: "document", submittable: true, fields: [field("supplier", "link"), field("total", "currency")], children: {} } as unknown as EntityMeta;
const policy = {
  steps: [{ label: "Finance", approvers: { role: "Accounts" }, need: "all", future_step_key: 1 }],
  reset_on: ["total"], lock: true, system_bypass: true, show: ["total"], message: "bills.notice", future_key: { a: 1 },
};
const list = [
  { entity: "Bill", op: { op: "set_approval", on: "submit", approval: { steps: [{ label: "Old", approvers: { role: "X" } }] } }, is_active: true, seq: 1, superseded_by: "z" },
  { entity: "Bill", op: { op: "set_approval", on: "submit", approval: policy }, is_active: true, seq: 2 },
];

function page(m: EntityMeta, shipped?: unknown) {
  const qc = new QueryClient();
  qc.setQueryData(["admin", "roles"], { roles: [{ name: "Accounts" }] });
  qc.setQueryData(["customize"], { customizations: list, warnings: [] });
  return renderToString(
    <QueryClientProvider client={qc}>
      <StaticRouter location="/customize/Bill/approvals">
        <DocumentApprovals meta={m} list={list as never} shipped={shipped} />
      </StaticRouter>
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("approval before submit or cancel", () => {
  const html = page(meta);
  it("offers both, with the policy now on submit and the options a document has", () => {
    const t = text(html);
    expect(t).toContain("Approval before submitting");
    expect(t).toContain("Approval before cancelling");
    expect(html).toContain('value="Finance"');
    expect(html).not.toContain('value="Old"');
    expect(t).toContain("Lock the record while it awaits approval");
    expect(t).toContain("Let the system (an automation, another app) go ahead without approval");
    expect(t).toContain("Fields approvers see even where a field group hides them");
  });
  it("has no state to reject to and no transition to name, which a document refuses", () => {
    expect(text(html)).not.toContain("When it is rejected");
    expect(text(html)).not.toContain("Not whoever took");
  });
  it("is shown only for a submittable document no workflow submits", () => {
    expect(text(page({ ...meta, workflow: { initial_state: "A", states: [], transitions: [] } } as unknown as EntityMeta))).toContain("This one has a workflow");
    expect(text(page({ ...meta, submittable: false } as EntityMeta))).toContain("not a document that is submitted");
  });
  it("passes axe", async () => {
    expect(await violations(html)).toEqual([]);
  });
  it("reads the latest active policy and sends back what it was sent, unknown properties included, without what a document refuses", () => {
    const now = currentDocumentPolicy(list as never, "Bill", "submit");
    expect(now).toEqual(policy);
    expect(currentDocumentPolicy(list as never, "Bill", "cancel")).toBeNull();
    const op = documentOp("submit", fromPolicy(now, (k) => k)) as { approval: Record<string, unknown> };
    expect(op.approval).toEqual(policy);
    expect(documentOp("cancel", null)).toEqual({ op: "set_approval", on: "cancel", approval: null });
    const withReject = { ...policy, on_reject: "Draft", steps: [{ ...policy.steps[0], not_who_took: ["Prepare"] }] };
    const sent = documentOp("submit", fromPolicy(withReject, (k) => k)) as { approval: { on_reject?: string; steps: { not_who_took?: string[] }[] } };
    expect(sent.approval.on_reject).toBeUndefined();
    expect(sent.approval.steps[0].not_who_took).toBeUndefined();
  });
});

describe("approval before an action runs, and what a package ships", () => {
  const board = { name: "Change", label: "Change", kind: "document", submittable: false, fields: [field("title", "text")], children: {}, actions: [
    { name: "apply", label: "Apply", docstatus: [0], permission: "write" }, { name: "peek", label: "Peek", docstatus: [0], permission: "read", read_only: true }] } as unknown as EntityMeta;
  const ships = { entity: "Change", package: "board", approvals: [{ on: "action:apply", policy: { steps: [{ label: "Board", approvers: { role: "Board" } }] }, source: "package", package: "board", changed: false, workspace: { steps: [{ label: "Board", approvers: { role: "Board" } }] } }] };
  it("offers each action that changes something, and starts from the policy in force", async () => {
    const html = page(board, ships);
    const t = text(html);
    expect(t).toContain("Approval before “Apply”");
    expect(t).not.toContain("Peek");
    expect(t).toContain("As board ships it");
    expect(html).toContain('value="Board"');
    expect(t).toContain("This is not a document that is submitted");
    expect(await violations(html)).toEqual([]);
  });
  it("marks what an administrator changed or switched off", () => {
    const changed = { ...ships, approvals: [{ ...ships.approvals[0], changed: true, workspace: null }] };
    const t = text(page(board, changed));
    expect(t).toContain("Changed from what board ships");
    expect(t).toContain("An administrator switched off what board ships here.");
  });
  it("sends an action's policy as `on: {action}`, and reads the shipped marks from either shape of the definition", () => {
    expect(documentOp({ action: "apply" }, null)).toEqual({ op: "set_approval", on: { action: "apply" }, approval: null });
    const mine = [{ entity: "Change", op: { op: "set_approval", on: { action: "apply" }, approval: policy }, is_active: true, seq: 1 }];
    expect(currentDocumentPolicy(mine as never, "Change", { action: "apply" })).toEqual(policy);
    expect(currentDocumentPolicy(mine as never, "Change", "submit")).toBeNull();
    expect(shippedPolicy(ships, "action:apply")).toEqual({ package: "board", changed: false });
    expect(shippedPolicy(ships, "submit")).toBeNull();
    const custom = { approvals: { submit: { steps: [] } }, package_approvals: [{ on: "submit", policy: { steps: [{ label: "A" }] }, source: "package", package: "x" }] };
    expect(shippedPolicy(custom, "submit")).toEqual({ package: "x", changed: true });
    expect(effectivePolicy(ships, "action:apply")).toEqual(ships.approvals[0].policy);
  });
});
