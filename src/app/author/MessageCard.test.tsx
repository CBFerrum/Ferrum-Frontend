// The "Send a message" card rendered with a template chosen, then axe; and the template pick of the mail card.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../../test/axe";
import { fromAction } from "../../lib/automationDraft";
import type { Field } from "../../lib/meta";
import { MessageCard, TemplatePick } from "./MessageCard";

const field = (name: string, type: string) => ({ name, label: name, type, can_read: true, can_write: true }) as unknown as Field;
const chips = [field("customer", "link"), field("email", "email")];
const card = fromAction({ type: "message", template: "bookings.confirmed", to: ["field:customer", "role:Front desk"], channels: ["text", "email"], values: { link: "doc.token", extra: "1" } });
function page(node: React.ReactNode) {
  const qc = new QueryClient();
  qc.setQueryData(["admin", "roles"], { roles: [{ name: "Front desk" }] });
  qc.setQueryData(["admin", "messages", "templates"], { templates: [{ key: "bookings.confirmed", label: "Booking confirmed", entity: "Booking", channels: ["email"], languages: ["en"], source: "package", default_changed: false }, { key: "hr.other", entity: "Employee", channels: ["email"], languages: ["en"], source: "package", default_changed: false }] });
  qc.setQueryData(["admin", "messages", "template", "bookings.confirmed"], { template: { key: "bookings.confirmed", values: ["link"], languages: { en: {} } }, default: null, edited: false, default_changed: false });
  return renderToString(
    <QueryClientProvider client={qc}>
      <StaticRouter location="/customize/Booking/buttons">{node}</StaticRouter>
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the send-a-message card", () => {
  const html = page(<MessageCard a={card as never} entity="Booking" chips={chips} onChange={() => {}} />);
  it("shows the template with a link to edit it, each recipient, the channels in order, and a box for each value the template declares", () => {
    expect(html).toContain('href="/customize/messages/bookings.confirmed"');
    expect(html).toContain('value="Front desk"');
    expect(text(html)).toContain("Text message");
    expect(html.indexOf("Text message")).toBeLessThan(html.indexOf("E-mail"));
    expect(text(html)).toContain("Value “link”");
    expect(text(html)).toContain("Send on every channel each person can be reached on");
  });
  it("says so for a value the template does not declare", () => {
    expect(text(html)).toContain("“extra” is not a value this template declares.");
  });
  it("offers the templates about this record type, or about none", () => {
    expect(html).toContain('value="bookings.confirmed"');
    expect(html).not.toContain('value="hr.other"');
  });
  it("passes axe", async () => {
    expect(await violations(html)).toEqual([]);
    expect(await violations(page(<TemplatePick id="x" label="A template" value="" onChange={() => {}} entity="Booking" />))).toEqual([]);
  });
});
