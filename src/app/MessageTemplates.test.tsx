// The message templates page and editor rendered to HTML (a data router, as the editor guards unsaved changes), then axe; and
// the place a refusal is shown.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider, type StaticHandlerContext } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import type { Template, TemplateRead, TemplateRow } from "../lib/messageDraft";
import { ChannelBody, MessageTemplatesPage, TemplateEditor } from "./MessageTemplates";

async function render(element: ReactElement, seed: (qc: QueryClient) => void = () => {}) {
  const qc = new QueryClient();
  qc.setQueryData(["me"], { tenant: "t", user: { id: "u", email: "a@x", full_name: "A", is_admin: true, roles: [] } });
  qc.setQueryData(["meta", "index"], { version: 1, packages: [], modules: [], entities: [{ name: "Booking", label: "Booking", kind: "document" }, { name: "Guest", label: "Guest", kind: "master" }], warnings: [] });
  seed(qc);
  const handler = createStaticHandler([{ path: "/customize/messages", element }]);
  const context = (await handler.query(new Request("http://localhost/customize/messages"))) as StaticHandlerContext;
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(
    <QueryClientProvider client={qc}>
      <StaticRouterProvider router={router} context={context} hydrate={false} />
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const def: Template = {
  key: "bookings.confirmed", label: "Booking confirmed", entity: "Booking", category: "operational", values: ["link"],
  languages: {
    en: {
      email: { subject: "Booking {{ doc.number }} confirmed", body: "<p>See you</p>" },
      text: { text: "Booking {{ doc.number }}: {{ values.link }}" },
      chat: { template: "booking_confirmed", values: ["{{ doc.number }}", "{{ doc.starts_on }}"] },
      inapp: { title: "Confirmed" },
    },
  },
};
const mine: Template = { ...def, languages: { ...def.languages, de: { text: { text: "Buchung bestätigt" } } } };
const read: TemplateRead = { template: mine, default: def, edited: true, default_changed: true };

describe("the message templates page", () => {
  const rows: TemplateRow[] = [
    { key: "bookings.confirmed", label: "Booking confirmed", entity: "Booking", category: "operational", channels: ["email", "text"], languages: ["en", "de"], source: "edited", default_changed: true },
    { key: "bookings.reminder", label: "Reminder", entity: "Booking", channels: ["email"], languages: ["en"], source: "package", default_changed: false },
    { key: "welcome", label: "Welcome", entity: null, channels: ["inapp"], languages: ["en"], source: "workspace", default_changed: false },
  ];
  it("lists the packages' templates and the workspace's, marking the edited and the default that changed since", async () => {
    const html = await render(<MessageTemplatesPage />, (qc) => qc.setQueryData(["admin", "messages", "templates"], { templates: rows }));
    const t = text(html);
    expect(t).toContain("Edited");
    expect(t).toContain("The default changed since you edited it");
    expect(t).toContain("From the package");
    expect(t).toContain("Your own");
    expect(t).toContain("E-mail, Text message");
    expect(html).toContain('href="/customize/messages/bookings.confirmed"');
    expect(await violations(html)).toEqual([]);
  });
});

describe("the template editor", () => {
  it("shows each language's bodies per channel, the chat-app values in order, and what resets or removes it", async () => {
    const html = await render(<TemplateEditor read={read} />);
    const t = text(html);
    expect(t).toContain("Language en");
    expect(t).toContain("Language de");
    expect(html).toContain('value="Booking {{ doc.number }} confirmed"');
    expect(html).toContain('value="booking_confirmed"');
    expect(html).toContain('aria-label="Value 2"');
    expect(html).toContain('value="{{ doc.starts_on }}"');
    expect(t).toContain("The package's default has changed");
    expect(t).toContain("Reset to the package default");
    expect(t).toContain("Show the package's default beside each body");
    expect(t).toContain("Add a language");
    expect(html).toContain('aria-label="Add a Chat-app message body in de"');
  });
  it("offers a test only once it is saved, and a preview against a record", async () => {
    const html = await render(<TemplateEditor read={read} />);
    expect(text(html)).toContain("Send a test to me");
    expect(text(html)).toContain("Preview");
    expect(text(await render(<TemplateEditor fresh={{ key: "x", languages: { en: { inapp: { title: "" } } } }} />))).toContain("Save the template first");
  });
  it("passes axe", async () => {
    expect(await violations(await render(<TemplateEditor read={read} />))).toEqual([]);
    expect(await violations(await render(<TemplateEditor read={{ template: def, default: null, edited: false, default_changed: false }} />))).toEqual([]);
  });
});

describe("a refusal", () => {
  it("is shown at the body it names, and marks it invalid", async () => {
    const html = await render(<ChannelBody lang="en" ch="email" t={def} edit={() => {}} refusal="unknown field nope" />);
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("unknown field nope");
    expect(html).toContain('aria-invalid="true"');
    expect(await violations(html)).toEqual([]);
    expect(text(await render(<ChannelBody lang="en" ch="email" t={def} edit={() => {}} />))).not.toContain("unknown field nope");
  });
});
