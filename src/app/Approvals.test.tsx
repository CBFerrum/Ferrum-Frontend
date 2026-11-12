// The approvals page rendered with both lists, then with none, and axe over each.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { ApprovalsPage, Detail } from "./Approvals";

const item = { request: "r1", entity: "Order", entity_label: "Order", record: "o1", title: "SO-0001", action: "Submit", from: "Draft", requester: "u1", requester_name: "Ann Asker", requested_at: "2026-11-12T08:00:00Z", step: { index: 1, label: "Finance", opened_at: "2026-11-12T09:00:00Z" } };
function page(data: unknown) {
  const qc = new QueryClient();
  qc.setQueryData(["approvals"], data);
  return renderToString(
    <QueryClientProvider client={qc}>
      <StaticRouter location="/approvals">
        <ApprovalsPage />
      </StaticRouter>
    </QueryClientProvider>,
  );
}

describe("the approvals page", () => {
  const full = page({ to_decide: [item], awaiting_others: [{ ...item, request: "r2", record: "o2", title: "SO-0002" }] });
  it("lists what to decide and what waits for others, each opening its record", () => {
    expect(full).toContain('href="/e/Order/o1"');
    expect(full).toContain('href="/e/Order/o2"');
    expect(full).toContain("To decide");
    expect(full).toContain("Waiting for others");
  });
  it("shows the requester's name, the step and since when it has waited", () => {
    expect(full).toContain("Ann Asker");
    expect(full).toContain("Finance");
    expect(full).toContain("waiting since");
  });
  it("says so when there is nothing", () => {
    expect(page({ to_decide: [], awaiting_others: [] })).toContain("Nothing is waiting for your decision.");
  });
  it("passes axe", async () => {
    expect(await violations(full)).toEqual([]);
    expect(await violations(page({ to_decide: [], awaiting_others: [] }))).toEqual([]);
  });
});

describe("a request opened in the inbox", () => {
  const request = {
    id: "r1", entity: "Order", record: "o1", action: "Submit", from: "Draft", to: "Approved", requester: "u1", requested_at: "2026-11-12T08:00:00Z", status: "pending",
    steps: [{ label: "Finance", state: "open", need: 1, approvers: ["u2"] }],
    decisions: [{ step: 0, decider: "u3", outcome: "reject", comment: "Too late", at: "2026-11-12T10:00:00Z", void: true }, { step: 0, decider: "u4", outcome: "approve", comment: "Fine", at: "2026-11-12T11:00:00Z" }],
  };
  const open = (mine: "decide" | "withdraw", status = "pending") => {
    const qc = new QueryClient();
    qc.setQueryData(["card", "Order", "o1"], { title: "SO-0001", fields: [{ name: "total", label: "Total", type: "currency", value: "1200.00" }] });
    qc.setQueryData(["approval", "Order", "o1"], { ...request, status });
    return renderToString(<QueryClientProvider client={qc}><StaticRouter location="/approvals"><Detail item={item} mine={mine} /></StaticRouter></QueryClientProvider>);
  };
  it("shows the record's summary and the trail, and approve or reject for whoever decides", async () => {
    const html = open("decide");
    expect(html).toContain("1200.00");
    expect(html).toContain("Fine");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).not.toContain("Withdraw my request");
    expect(await violations(html)).toEqual([]);
  });
  it("offers the requester to withdraw their own, and nothing once it is decided", () => {
    expect(open("withdraw")).toContain("Withdraw my request");
    const done = open("withdraw", "approved");
    expect(done).not.toContain("Withdraw my request");
    expect(done).toContain("It is no longer waiting.");
  });
  it("lists a Review button on what waits for the person, and Details on their own", () => {
    const list = page({ to_decide: [item], awaiting_others: [{ ...item, request: "r2", record: "o2" }] });
    expect(list).toContain("Review");
    expect(list).toContain("Details");
  });
});
