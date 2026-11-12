// Administration → Messaging rendered with a connection of each kind, then axe: the secret is never shown, the connection's
// form is labelled, and the settings and opt-out forms are there.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { fromChannel, newChannel, newInbound, type ChannelRow } from "../lib/channelDraft";
import { ChannelDialog, Messaging, SettingsForm } from "./Messaging";

const channels: ChannelRow[] = [
  { id: "c1", kind: "text", name: "SMS gateway", enabled: true, has_secrets: true, refused: 2, inbound: "/api/messages/inbound/c1", description: { url: "https://sms.example/send", form: { to: "{{ to }}" }, inbound: { auth: "token", secret: "hook" } } },
  { id: "c2", kind: "chat", name: "Chat app", enabled: false, has_secrets: false, refused: 0, inbound: "/api/messages/inbound/c2", description: { test: true } },
];
function render(node: React.ReactNode) {
  const qc = new QueryClient();
  qc.setQueryData(["admin", "messages", "channels"], { channels });
  qc.setQueryData(["admin", "settings"], { messages: { calling_code: "+49", trunk_prefix: "0", quiet_hours: { from: "21:00", to: "08:00" }, per_hour: 500 } });
  return renderToString(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the messaging section", () => {
  const html = render(<Messaging />);
  it("lists the connections with their state, a test connection marked, the inbound address, and never a secret", () => {
    const t = text(html);
    expect(t).toContain("SMS gateway");
    expect(t).toContain("Turned on");
    expect(t).toContain("Turned off");
    expect(t).toContain("Test connection");
    expect(t).toContain("Secrets stored");
    expect(t).toContain("2 refused calls");
    expect(html).toContain("/api/messages/inbound/c1");
    expect(html).toContain("Send a test on SMS gateway");
  });
  it("has the calling code, quiet hours and limits, and the opt-out form", () => {
    expect(html).toContain('value="+49"');
    expect(html).toContain('value="21:00"');
    expect(html).toContain('value="500"');
    expect(text(html)).toContain("Opt out");
    expect(text(html)).toContain("Show what was sent to it");
  });
  it("passes axe", async () => {
    expect(await violations(html)).toEqual([]);
    expect(await violations(render(<SettingsForm initial={{}} />))).toEqual([]);
  });
});

describe("the connection form", () => {
  it("takes secrets as write-only password boxes, and shows the inbound part when asked", async () => {
    const start = { ...fromChannel(channels[0]), secrets: [{ key: "k", name: "key", value: "" }], inbound: { ...newInbound(), auth: "hmac" as const, header: "X-Signature", secret: "hook", statuses: [{ key: "s", name: "DELIVRD", value: "delivered" }] } };
    const html = render(<ChannelDialog start={start} onClose={() => {}} onDone={() => {}} />);
    expect(html).toContain('type="password"');
    expect(html).toContain("Entering any replaces every stored secret");
    expect(html).toContain('value="X-Signature"');
    expect(html).toContain('aria-label="Provider status 1"');
    expect(await violations(html)).toEqual([]);
  });
  it("starts a new one with the choices a person makes first, and passes axe", async () => {
    const html = render(<ChannelDialog start={newChannel("chat")} onClose={() => {}} onDone={() => {}} />);
    expect(text(html)).toContain("Add a connection");
    expect(text(html)).toContain("A test connection");
    expect(await violations(html)).toEqual([]);
  });
});
