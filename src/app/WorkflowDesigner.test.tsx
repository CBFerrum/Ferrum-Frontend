// Renders the workflow designer to HTML (no DOM needed) for a sample workflow, then runs axe over it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import type { EntityMeta } from "../lib/meta";
import { Designer } from "./WorkflowDesigner";

const field = (name: string, type: string, extra = {}) => ({ name, label: name.replace(/^./, (c) => c.toUpperCase()), type, can_read: true, can_write: true, ...extra });
const meta = {
  name: "PurchaseOrder",
  label: "Purchase Order",
  kind: "document",
  submittable: true,
  fields: [field("supplier", "link", { to: "Supplier" }), field("total", "currency"), field("notes", "text"), field("items", "table", { of: "POItem" })],
  children: { items: { entity: "POItem", label: "Items", fields: [field("item", "link", { to: "Item" })] } },
  workflow: {
    name: "Purchase approval",
    initial_state: "Draft",
    states: [
      { name: "Draft", docstatus: 0, edit_roles: ["Purchaser"], required: ["supplier"] },
      { name: "Pending", docstatus: 0, edit_roles: [], editable: ["notes"] },
      { name: "Approved", docstatus: 1, edit_roles: [] },
    ],
    transitions: [
      { action: "Submit", from: "Draft", to: "Pending", roles: ["Purchaser"] },
      { action: "Approve", from: "Pending", to: "Approved", roles: ["Purchase Manager"], condition: "doc.total < 100", not_creator: true, not_creator_of: ["supplier"] },
    ],
  },
} as unknown as EntityMeta;

function page(m: EntityMeta) {
  const qc = new QueryClient();
  qc.setQueryData(["admin", "roles"], { roles: [{ name: "Purchaser" }, { name: "Purchase Manager" }] });
  qc.setQueryData(["customize"], { customizations: [], warnings: [] });
  return renderToString(
    <QueryClientProvider client={qc}>
      <StaticRouter location="/customize/PurchaseOrder/workflow">
        <Designer meta={m} />
      </StaticRouter>
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the workflow designer", () => {
  const html = page(meta);

  it("shows the states, the actions and an outline with the ways out of each state", () => {
    const t = text(html);
    expect(t).toContain("Workflow of Purchase Order");
    expect(t).toContain("This entity comes with a workflow");
    expect(html).toContain('value="Pending"');
    expect(html).toContain('value="Approve"');
    expect(html).toContain("doc.total &lt; 100");
    expect(t).toContain("Submit → Pending by Purchaser");
    expect(t).toContain("Approve → Approved by Purchase Manager");
    expect(t).toContain("No way out: the record stays here.");
    expect(t).toContain("Starts here");
  });

  it("offers the workspace's roles, the entity's fields and its links", () => {
    const t = text(html);
    expect(t).toContain("Purchase Manager");
    expect(t).toContain("Items → Item");
    expect(html).toContain('aria-label="Insert total"');
  });

  it("leaves out the record's status for an entity that is never submitted", () => {
    expect(text(page({ ...meta, submittable: false } as EntityMeta))).not.toContain("Record is");
    expect(text(html)).toContain("Record is");
  });

  it("starts empty with an invitation when there is no workflow", () => {
    const t = text(page({ ...meta, workflow: null } as EntityMeta));
    expect(t).toContain("has no workflow yet");
    expect(t).toContain("Start a workflow");
  });

  it("breaks none of axe's rules that hold without layout", async () => {
    expect(await violations(html)).toEqual([]);
    expect(await violations(page({ ...meta, workflow: null } as EntityMeta))).toEqual([]);
  });
});
