// The approvals page rendered with both lists, then with none, and axe over each.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { ApprovalsPage } from "./Approvals";

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
