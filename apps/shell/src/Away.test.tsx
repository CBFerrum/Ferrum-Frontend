// The Away section on the account page rendered to HTML with the periods the server holds, then axe.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "@/test/axe";
import { Away } from "./Account";

function page(periods: unknown[]) {
  const qc = new QueryClient();
  qc.setQueryData(["away"], periods);
  return renderToString(
    <QueryClientProvider client={qc}>
      <Away />
    </QueryClientProvider>,
  );
}
const now = { starts_on: "2026-11-10", ends_on: "2026-11-14", current: true, substitute: "u2", substitute_name: "Sue Standin", reason: "leave" };
const later = { starts_on: "2026-12-10", ends_on: "2026-12-12", current: false, substitute: "u2", substitute_name: "Sue Standin", reason: "travel" };

describe("the away section", () => {
  const html = page([now, later]);
  it("asks for the days, the person and why, each labelled", () => {
    for (const label of ["From", "To", "Who decides for you", "Why"]) expect(html).toContain(label);
    expect(html).toContain('type="date"');
  });
  it("says plainly who is deciding today, and lists each period with Change and Clear", () => {
    expect(html).toContain("is deciding for you today");
    expect(html).toContain("Sue Standin");
    expect(html).toContain("travel");
    expect(html.match(/>Clear</g)).toHaveLength(2);
    expect(html.match(/>Change</g)).toHaveLength(2);
  });
  it("says so when there is none, and says nothing about a stand-in", () => {
    const none = page([]);
    expect(none).toContain("You have no away period set.");
    expect(none).not.toContain("is deciding for you today");
  });
  it("passes axe", async () => {
    expect(await violations(html)).toEqual([]);
  });
});
