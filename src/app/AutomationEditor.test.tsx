// Renders the automation editor to HTML (no DOM needed) for an event automation and a scheduled one, then runs axe over it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import type { EntityMeta } from "../lib/meta";
import type { Automation } from "../lib/automationDraft";
import { MemoryRouter } from "react-router";
import { AutomationEditor, MailPreviewDialog, type PreviewState } from "./AutomationEditor";

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
      <MemoryRouter>
        <AutomationEditor initial={a} onClose={() => {}} onDone={() => {}} />
      </MemoryRouter>
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
    { type: "message", template: "contracts.signed", to: ["field:email"], channels: ["text"] },
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
    expect(t).toContain("Action 5: Send a message");
    expect(t).toContain("Action 6: Other action");
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

describe("the mail preview dialog", () => {
  const sample = '<h1>Hi Asha</h1><p>Your contract ends soon.</p><script>alert(1)</script>';
  const draw = (state: PreviewState | null) => renderToString(<MemoryRouter><MailPreviewDialog state={state} entity="Contract" onClose={() => {}} onRetry={() => {}} /></MemoryRouter>);

  it("shows the HTML in a frame that runs nothing, names the record, and passes axe", async () => {
    const html = draw({ phase: "done", data: { html: sample, record_id: "0b0e7a52-0000-4000-8000-000000000001" } });
    expect(html).toContain('sandbox=""');
    expect(html).toContain("srcDoc=");
    expect(html).not.toContain("allow-scripts");
    expect(html).toContain('href="/e/Contract/0b0e7a52-0000-4000-8000-000000000001"');
    expect(text(html)).toContain("Preview of the mail");
    expect(await violations(html)).toEqual([]);
  });

  it("says when the entity has no records, and shows loading and error states", async () => {
    const none = draw({ phase: "done", data: { html: "<p>x</p>", record_id: null } });
    expect(text(none)).toContain("Contract has no records yet");
    expect(none).not.toContain("Open the record");
    const loading = draw({ phase: "loading" });
    expect(text(loading)).toContain("Loading");
    const bad = draw({ phase: "error", error: new Error("down") });
    expect(text(bad)).toContain("The preview could not run");
    expect(await violations(none)).toEqual([]);
    expect(await violations(loading)).toEqual([]);
    expect(await violations(bad)).toEqual([]);
  });

  it("puts a Preview button on the Send mail card", () => {
    expect(text(page(event))).toContain("Preview");
  });

  it("draws the Find, For each and Copy lines cards with Only when and the functions, and passes axe", async () => {
    const flow: Automation = {
      name: "Flow", entity: "Contract", event: "updated", is_active: true,
      actions: [
        { type: "find", entity: "Project", by: { project_name: "doc.status" }, create: {}, when: "doc.total > 1.0" },
        { type: "for_each", entity: "Project", link: "contract", effects: [{ type: "notify", to: "owner", title: "'t'" }] },
        { type: "copy_lines", table: "items", result: 0, from_table: "steps", values: { due: "item.due" }, mode: "replace" },
      ],
    };
    const html = page(flow);
    const t = text(html);
    for (const w of ["Action 1: Find", "Action 2: For each", "Action 3: Copy lines", "Create it when none is found", "Go through", "The lines come from the record", "Only when (optional)", "Functions"]) expect(t).toContain(w);
    expect(html).toContain("addDays");
    expect(html).toContain("Effects of the loop");
    expect((html.match(/Only when \(optional\)/g) ?? []).length).toBe(4);
    expect((html.match(/<summary>Functions/g) ?? []).length).toBe(5);
    expect(await violations(html)).toEqual([]);
  });
});
