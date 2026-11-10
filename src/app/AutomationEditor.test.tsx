// Renders the automation editor to HTML (no DOM needed) for an event automation and a scheduled one, then runs axe over it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import type { EntityMeta } from "../lib/meta";
import type { Automation } from "../lib/automationDraft";
import { AutomationEditor } from "./AutomationEditor";

const field = (name: string, type: string, extra = {}) => ({ name, label: name.replace(/^./, (c) => c.toUpperCase()).replace("_", " "), type, can_read: true, can_write: true, ...extra });
const meta = {
  name: "Contract",
  label: "Contract",
  kind: "document",
  submittable: true,
  fields: [field("end_date", "date"), field("starts_at", "datetime"), field("status", "select", { options: ["Open", "Closed"] }), field("email", "email"), field("total", "currency")],
  children: {},
} as unknown as EntityMeta;
const entities = [{ name: "Contract", label: "Contract", label_plural: "Contracts", kind: "document", submittable: true }, { name: "Project", label: "Project", label_plural: "Projects", kind: "document", submittable: false }];

function page(a: Partial<Automation>) {
  const qc = new QueryClient();
  qc.setQueryData(["meta"], { version: 1, packages: [], modules: [], entities, warnings: [] });
  qc.setQueryData(["meta", "Contract"], meta);
  qc.setQueryData(["meta", "Project"], { ...meta, name: "Project", fields: [field("project_name", "data")] });
  qc.setQueryData(["admin", "roles"], { roles: [{ name: "Sales Manager" }] });
  qc.setQueryData(["admin", "users"], { users: [{ id: "u1", email: "a@x.test", full_name: "Asha" }] });
  return renderToString(
    <QueryClientProvider client={qc}>
      <AutomationEditor initial={a} onClose={() => {}} onDone={() => {}} />
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const event: Automation = {
  id: "1",
  name: "Welcome",
  entity: "Contract",
  event: "submitted",
  condition: "doc.total > 10.0",
  is_active: true,
  actions: [
    { type: "set_fields", values: { status: "'Open'" } },
    { type: "create_document", entity: "Project", values: { project_name: "doc.name" } },
    { type: "notify", to: "role:Sales Manager", title: "'x'" },
    { type: "email", to: "doc.email", subject: "'Hi'", body: "''", template: "<p>{{ doc.status }}</p>" },
    { type: "webhook", url: "https://x.test" },
  ],
};
const scheduled: Automation = {
  name: "Renewal",
  entity: "Contract",
  event: "scheduled",
  is_active: true,
  schedule: { every: { period: "week", at: "08:00", on: 1, filter: [["status", "=", "Open"]] } },
  actions: [{ type: "notify", to: "owner", title: "'Renew'" }],
};
const relative: Automation = { ...scheduled, schedule: { relative: { field: "end_date", offset: "-P3D" } } };

describe("the automation editor", () => {
  it("shows an event automation as a form, with a card for each action and a read-only one for the unknown", () => {
    const html = page(event);
    const t = text(html);
    expect(html).toContain('value="Welcome"');
    expect(t).toContain("Action 1: Set fields");
    expect(t).toContain("Action 2: Create a record");
    expect(t).toContain("Action 3: Notify");
    expect(t).toContain("Action 4: Send mail");
    expect(t).toContain("Action 5: Other action");
    expect(html).toContain("https://x.test");
    expect(html).toContain("{{ doc.status }}");
    expect(html).toContain('aria-label="Insert status"');
    expect(t).toContain("Values from the record are escaped");
    expect(t).not.toContain("Runs:");
  });

  it("shows a scheduled automation with its schedule read back", () => {
    const t = text(page(scheduled));
    expect(t).toContain("Runs: Every Monday at 08:00, in the workspace's time zone, for records where Status is Open");
    expect(text(page(relative))).toContain("Runs: 3 days before End date at 09:00, in the workspace's time zone");
  });

  it("starts empty with an invitation to add an action", () => {
    expect(text(page({ event: "created", is_active: true, actions: [] }))).toContain("No actions yet");
  });

  it("breaks none of axe's rules that hold without layout", async () => {
    for (const a of [event, scheduled, relative]) expect(await violations(page(a))).toEqual([]);
  });
});
