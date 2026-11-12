import { describe, expect, it } from "vitest";
import { checkChannel, fromChannel, newChannel, newInbound, toChannelInput, type ChannelRow } from "./channelDraft";

const text: ChannelRow = {
  id: "c1", kind: "text", name: "SMS gateway", enabled: true, has_secrets: true, refused: 3, inbound: "/api/messages/inbound/c1",
  description: {
    url: "https://sms.gateway.example/v1/send", form: { to: "{{ to }}", message: "{{ text }}", sender: "{{ from }}" }, headers: { Authorization: "Bearer {{ secret.key }}" }, from: "Acme", id_at: "/message_id", error_at: "/error",
    inbound: { auth: "token", secret: "hook", id_at: "/message_id", status_at: "/status", statuses: { DELIVRD: "delivered", UNDELIV: "failed" }, from_at: "/from", text_at: "/text", stop: ["STOP", "UNSUBSCRIBE"], start: ["START"] },
  },
};
const chat: ChannelRow = {
  id: "c2", kind: "chat", name: "Chat app", enabled: false, has_secrets: true, refused: 0, inbound: "/api/messages/inbound/c2",
  description: { url: "https://chat.provider.example/v1/messages", headers: { Authorization: "Bearer {{ secret.token }}" }, body: "{\"to\": {{ to|json }}}", id_at: "/messages/0/id", temporary: [429, 503], future: { a: 1 } },
};

describe("a channel connection", () => {
  it("comes back as it was read, a form or a JSON body, with what the screen has no control for", () => {
    expect(toChannelInput(fromChannel(text))).toEqual({ kind: "text", name: "SMS gateway", enabled: true, description: text.description });
    expect(toChannelInput(fromChannel(chat))).toEqual({ kind: "chat", name: "Chat app", enabled: false, description: chat.description });
    expect(fromChannel(text).shape).toBe("form");
    expect(fromChannel(chat).shape).toBe("json");
  });
  it("never holds a secret it was not given, and sends the ones typed now", () => {
    const d = fromChannel(text);
    expect(d.secrets).toEqual([]);
    expect(JSON.stringify(toChannelInput(d))).not.toContain("secrets");
    expect(toChannelInput({ ...d, secrets: [{ key: "k", name: "key", value: "s3cret" }] }).secrets).toEqual({ key: "s3cret" });
  });
  it("is a test connection that needs no address, and sends none", () => {
    const d = { ...newChannel("text"), name: "Test", test: true };
    expect(checkChannel(d)).toEqual([]);
    expect(toChannelInput(d).description).toEqual({ test: true });
  });
  it("is checked: a name, an https address, JSON pointers, statuses, and the inbound part's secret and header", () => {
    const say = (p: object) => checkChannel({ ...fromChannel(text), ...p }).map((x) => x.message).join("|");
    expect(say({})).toBe("");
    expect(say({ name: " " })).toContain("Give the connection a name");
    expect(say({ url: "http://x" })).toContain("must start with https://");
    expect(say({ id_at: "message_id" })).toContain("is a JSON pointer");
    expect(say({ temporary: "429, soon" })).toContain("HTTP statuses");
    expect(say({ inbound: { ...newInbound(), auth: "hmac", secret: "" } })).toContain("name the secret");
    expect(say({ inbound: { ...newInbound(), auth: "hmac", secret: "hook" } })).toContain("needs the header");
    expect(say({ secrets: [{ key: "k", name: "key", value: "" }] })).toContain("needs both a name and a value");
  });
});
