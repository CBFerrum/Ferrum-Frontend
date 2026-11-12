// The approval panel on a record, rendered to HTML for a request with a stand-in, an escalation and a void decision, then axe.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import type { ApprovalRequest, Me } from "../lib/meta";
import { ApprovalPanel } from "./ApprovalPanel";

const request: ApprovalRequest = {
  id: "r1", entity: "Order", record: "o1", action: "Submit", from: "Draft", to: "Approved", requester: "u-req", requested_at: "2026-11-12T08:00:00Z", status: "pending",
  steps: [
    { label: "Manager", state: "approved", need: "any", approvers: ["u-mgr"] },
    { label: "Finance", state: "open", need: 2, approvers: ["u-me", "u-fin"], escalated: ["u-dir"], remind_at: "2026-11-13T08:00:00Z" },
  ],
  decisions: [
    { step: 0, decider: "u-sub", on_behalf_of: "u-mgr", outcome: "approve", comment: "fine", at: "2026-11-12T09:00:00Z" },
    { step: 0, decider: "u-old", outcome: "approve", at: "2026-11-12T08:30:00Z", void: true },
  ],
};
const me = { tenant: "t", user: { id: "u-me", email: "me@x", full_name: "Me", is_admin: false, roles: [] } } as unknown as Me;

function page(mayDecide: boolean) {
  const qc = new QueryClient();
  qc.setQueryData(["approvals"], { to_decide: mayDecide ? [{ request: "r1" }] : [], awaiting_others: [] });
  return renderToString(
    <QueryClientProvider client={qc}>
      <StaticRouter location="/e/Order/o1">
        <ApprovalPanel entity="Order" id="o1" request={request} me={me} onChanged={() => {}} />
      </StaticRouter>
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the approval panel", () => {
  it("shows the steps, a stand-in as 'X for Y', the escalation and the cancelled decision", () => {
    const t = text(page(true));
    expect(t).toContain("Approval of “Submit”");
    expect(t).toContain("Manager");
    expect(t).toContain("Finance");
    expect(t).toContain("for");
    expect(t).toContain("Escalated to");
    expect(t).toContain("1 earlier decision(s) were cancelled");
  });
  it("offers Approve and Reject only to someone who may decide, and Recall not to a stranger", () => {
    const yes = page(true);
    expect(yes).toContain(">Approve<");
    expect(yes).toContain(">Reject<");
    expect(yes).not.toContain("Recall this request");
    expect(page(false)).not.toContain(">Approve<");
  });
  it("passes axe", async () => {
    expect(await violations(page(true))).toEqual([]);
  });
});
