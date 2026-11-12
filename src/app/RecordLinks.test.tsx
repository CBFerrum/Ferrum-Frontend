// The links issued on a record, with the server's shape (docs/api.md "Signed action links"): states, who for, revoke.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { LinksTable } from "./RecordLinks";

const base = { id: "l1", actions: ["accept"], show: ["title"], columns: null, uses: 0, max_uses: 1, expires_at: "2099-01-01T00:00:00Z", recipient: "ann@x.example", code: true, revoked_at: null, created_at: "2026-11-10T00:00:00Z", issued_by: null, opened_at: null };
const render = (links: unknown[]) => {
  const qc = new QueryClient();
  qc.setQueryData(["record-links", "Offer", "o1"], { links });
  return renderToString(<QueryClientProvider client={qc}><LinksTable entity="Offer" id="o1" /></QueryClientProvider>);
};
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the links issued on a record", () => {
  const html = render([
    base,
    { ...base, id: "l2", recipient: null, code: false, opened_at: "2026-11-11T00:00:00Z", max_uses: 3, uses: 1 },
    { ...base, id: "l3", uses: 1, opened_at: "2026-11-11T00:00:00Z" },
    { ...base, id: "l4", revoked_at: "2026-11-12T00:00:00Z" },
    { ...base, id: "l5", expires_at: "2020-01-01T00:00:00Z" },
  ]);
  it("shows who each is for, its state and whether it was opened and used", async () => {
    const t = text(html);
    expect(t).toContain("ann@x.example");
    expect(t).toContain("Anyone with it");
    for (const s of ["Not opened", "Opened, not used up", "Used", "Revoked", "Expired"]) expect(t).toContain(s);
    expect(t).toContain("1 / 3");
    expect(await violations(html)).toEqual([]);
  });
  it("offers revoke only on a link that can still be used", () => {
    expect((html.match(/>Revoke</g) ?? []).length).toBe(2);
  });
  it("says so when there are none, and never shows an address", () => {
    expect(text(render([]))).toContain("No link has been issued");
    expect(html).not.toContain("token");
  });
});
