// Renders the entity designer to HTML (no DOM needed) for a new entity and for one with lines, then runs axe over both.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider, type StaticHandlerContext } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { fromDef, startDraft, type Draft, type Raw } from "../lib/entityDraft";
import { Designer } from "./EntityDesigner";

const lines: Raw = {
  name: "XMembershipCharges", label: "Membership Charges", kind: "child",
  fields: [{ name: "description", label: "Description", type: "data" }, { name: "amount", label: "Amount", type: "currency", required: true }],
};
const membership: Raw = {
  name: "XMembership", label: "Membership", kind: "document", submittable: true, title_field: "member_no", numbering: { template: "MEM-{seq:5}" },
  fields: [
    { name: "member_no", label: "Member number", type: "data", unique: true },
    { name: "tier", label: "Tier", type: "select", options: ["Gold", "Silver"] },
    { name: "owner", label: "Owner", type: "link", to: "Customer" },
    { name: "charges", label: "Charges", type: "table", of: "XMembershipCharges" },
    { name: "total", label: "Total", type: "currency", read_only: true, rollup: { table: "charges", op: "sum", field: "amount" } },
  ],
  unique: [["member_no", "tier"]],
};
const taken = ["Customer", "XMembership", "XMembershipCharges"];

async function page(start: Draft) {
  const qc = new QueryClient();
  qc.setQueryData(["meta"], { version: 1, packages: [], modules: [], warnings: [], entities: [{ name: "Customer", label: "Customer", label_plural: "Customers", kind: "master", submittable: false }] });
  const routes = [{ path: "*", element: <Designer start={start} /> }];
  const { query } = createStaticHandler(routes);
  const context = (await query(new Request("http://localhost/customize/new"))) as StaticHandlerContext;
  return renderToString(
    <QueryClientProvider client={qc}>
      <StaticRouterProvider router={createStaticRouter(routes, context)} context={context} hydrate={false} />
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the entity designer", () => {
  it("starts a new entity with the basics, an empty field list and nothing to save", async () => {
    const html = await page(startDraft(taken));
    const t = text(html);
    expect(t).toContain("New entity");
    expect(t).toContain("A list of things");
    expect(t).toContain("A document that is submitted, and can be cancelled");
    expect(t).toContain("No fields yet.");
    expect(t).toContain("Create the entity");
    expect(t).toContain("Check Create");
    expect(await violations(html)).toEqual([]);
  });

  it("shows an existing entity with its fields, unique combination, lines and total", async () => {
    const html = await page(fromDef(membership, { XMembershipCharges: lines }, taken));
    const t = text(html);
    expect(t).toContain("Design Membership");
    expect(html).toContain('value="member_no"');
    expect(html).toContain("readOnly");
    expect(t).toContain("The name cannot change once the entity exists.");
    expect(t).toContain("The next number would be MEM-00001");
    expect(t).toContain("Combination 1: unique together");
    expect(t).toContain("Sum of Charges.Amount");
    expect(t).toContain("Number of Charges");
    expect(t).toContain("Save changes");
    expect(t).toContain("Nothing has changed yet.");
    expect(html).toContain("Gold");
    expect(await violations(html)).toEqual([]);
  });
});
