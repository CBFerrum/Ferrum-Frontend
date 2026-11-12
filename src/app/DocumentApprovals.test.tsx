// Approval before a document is submitted or cancelled: the screen rendered with a policy on submit and none on cancel, then
// axe; and the draft's round trip (unknown properties stay, nothing a document refuses is sent).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { currentDocumentPolicy, documentOp, fromPolicy } from "../lib/approvalDraft";
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

function page(m: EntityMeta) {
  const qc = new QueryClient();
  qc.setQueryData(["admin", "roles"], { roles: [{ name: "Accounts" }] });
  qc.setQueryData(["customize"], { customizations: list, warnings: [] });
  return renderToString(
    <QueryClientProvider client={qc}>
      <StaticRouter location="/customize/Bill/approvals">
        <DocumentApprovals meta={m} list={list as never} />
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
