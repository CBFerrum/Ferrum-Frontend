import { describe, expect, it } from "vitest";
import { actionJson, checkActions, fromAction } from "./automationDraft";
import { addLanguage, checkTemplate, refusalAt, removeLanguage, setBody, toSend, type Template } from "./messageDraft";

const t: Template = {
  key: "bookings.confirmed", entity: "Booking", values: ["link"],
  languages: { en: { email: { subject: "Hi", body: "<p>x</p>" }, chat: { template: "confirmed", values: ["{{ doc.number }}"] }, inapp: { title: "T", text: "" } } },
};

describe("a message template", () => {
  it("is sent as it was read: empty optional parts left out, nothing else touched", () => {
    expect(toSend(t)).toEqual({ ...t, languages: { en: { email: t.languages.en.email, chat: t.languages.en.chat, inapp: { title: "T" } } } });
  });
  it("sends a chat-app message as either the provider's template and its values or free text, never both", () => {
    const free = setBody(t, "en", "chat", { text: "hello", template: "x", values: ["a"] });
    expect(toSend(free).languages.en.chat).toEqual({ text: "hello" });
    expect(toSend(setBody(t, "en", "chat", { template: "n", values: ["", "{{ doc.a }}"] })).languages.en.chat).toEqual({ template: "n", values: ["{{ doc.a }}"] });
  });
  it("gains a language as a copy and loses one", () => {
    const de = addLanguage(t, "de", "en");
    expect(Object.keys(de.languages)).toEqual(["en", "de"]);
    expect(de.languages.de).toEqual(t.languages.en);
    expect(de.languages.de).not.toBe(t.languages.en);
    expect(Object.keys(removeLanguage(de, "en").languages)).toEqual(["de"]);
  });
  it("is checked by its shape as the server checks it", () => {
    expect(checkTemplate(t, true)).toEqual([]);
    const said = (x: Template, isNew = false) => checkTemplate(x, isNew).map((p) => p.message).join("|");
    expect(said({ ...t, key: "Bad Key" }, true)).toContain("The key is lower case");
    expect(said({ ...t, languages: {} })).toContain("at least one language");
    expect(said({ ...t, languages: { "not a tag": t.languages.en } })).toContain("is not a language tag");
    expect(said({ ...t, channels: ["text"] })).toContain("which no language has a body for");
    expect(said(setBody(t, "en", "chat", { template: "x", text: "y" }))).toContain("either the provider's template name or free text");
    expect(said(setBody(t, "en", "chat", { template: "", values: [] }))).toContain("either the provider's template name or free text");
    expect(said({ ...t, values: ["not a name"] })).toContain("is not a name");
  });
  it("reads where the server's refusal points", () => {
    expect(refusalAt("de, email: unknown field doc.nope")).toEqual({ language: "de", channel: "email", text: "unknown field doc.nope" });
    expect(refusalAt("pt-BR, chat: a secret field")).toEqual({ language: "pt-BR", channel: "chat", text: "a secret field" });
    expect(refusalAt("message x has no body in any language")).toBeNull();
  });
});

describe("the message effect and the cards that may name a template", () => {
  const msg = { type: "message", template: "bookings.confirmed", to: ["field:customer", "role:Front desk", "owner"], channels: ["text", "email"], all: true, values: { link: "'https://x/' + doc.token" }, when: "doc.total > 0", note: "kept" };
  it("round-trips, with the order of recipients and channels and what it has no control for", () => {
    const d = fromAction(msg);
    expect(d.kind).toBe("message");
    expect(actionJson(d)).toEqual(msg);
    expect(actionJson(fromAction({ type: "message", template: "k", to: "owner" }))).toEqual({ type: "message", template: "k", to: "owner" });
  });
  it("stays raw when it is something the card cannot show", () => {
    expect(fromAction({ ...msg, to: [5] }).kind).toBe("raw");
    expect(fromAction({ ...msg, channels: ["pigeon"] }).kind).toBe("raw");
  });
  it("is checked: a template, someone to send to, every recipient named, every value an expression", () => {
    const say = (a: object) => checkActions([fromAction({ ...msg, ...a })], 20).map((p) => p.message).join("|");
    expect(say({})).toBe("");
    expect(say({ template: "" })).toContain("choose the message template");
    expect(say({ to: ["role:"] })).toContain("every recipient needs");
    expect(say({ values: { link: "" } })).toContain("every value needs");
  });
  it("lets the mail and notify cards name a template in place of their wording, and keeps their own when they do not", () => {
    const mail = { type: "email", to: "doc.email", message: "bookings.confirmed", purpose: "transactional" };
    expect(fromAction(mail).kind).toBe("email");
    expect(actionJson(fromAction(mail))).toEqual(mail);
    expect(actionJson(fromAction({ type: "notify", to: "owner", message: "k" }))).toEqual({ type: "notify", to: "owner", message: "k" });
    const plain = { type: "email", to: "doc.email", subject: "'s'", body: "'b'" };
    expect(actionJson(fromAction(plain))).toEqual(plain);
    expect(fromAction({ type: "email", to: "x", message: "k", subject: "'s'", body: "'b'" }).kind).toBe("raw");
    expect(checkActions([fromAction(mail)], 20)).toEqual([]);
  });
});
