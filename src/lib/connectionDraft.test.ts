// The connection editor's logic: what a description keeps when edited, what is sent for secrets, and the states.

import { describe, expect, it } from "vitest";
import { at, captureMinutes, changes, checkConnection, connectionBody, connectionState, parseDescription, parseInputs, personalState, put, secretNames, secretsToSend, tidy } from "./connectionDraft";

const description = {
  base: "https://api.carrier.example/v2",
  auth: { type: "bearer", secret: "api_key" },
  headers: { "x-account": "acme" },
  future_property: { kept: true },
  operations: { track: { path: "/tracks/{{ inputs.tracking }}", result: { status: "/status" } }, ping: {} },
  inbound: { verify: { type: "token", header: "x-token", secret: "hook" } },
};

describe("a description", () => {
  it("keeps what this screen has no control for, and drops what is empty", () => {
    const next = put(put(description, ["headers", "x-account"], ""), ["timeout_ms"], undefined);
    expect(next.future_property).toEqual({ kept: true });
    expect(tidy(next).headers).toBeUndefined();
    expect(tidy({ ...next, allowed_hosts: [""], operations: { ping: { path: "" } } }).operations).toEqual({ ping: {} });
    expect(tidy({ a: false, b: 0 })).toEqual({ a: false, b: 0 });
  });
  it("names the secrets it uses", () => {
    expect(secretNames(description).sort()).toEqual(["api_key", "hook"]);
    expect(at(description, "auth", "type")).toBe("bearer");
  });
  it("is the object the raw view holds, or says why not", () => {
    expect(parseDescription('{"base": "https://x.example"}')).toEqual({ ok: true, value: { base: "https://x.example" } });
    expect(parseDescription("[1]").ok).toBe(false);
    expect(parseDescription("{").ok).toBe(false);
    expect(parseInputs("3").ok).toBe(false);
  });
});

describe("secrets", () => {
  it("are not sent when none was typed, so the ones set stay", () => {
    expect(secretsToSend(["api_key", "hook"], {})).toEqual({});
  });
  it("are all sent when any is typed, because the server replaces the set", () => {
    expect(secretsToSend(["api_key", "hook"], { api_key: "a" }).error).toContain("hook");
    expect(secretsToSend(["api_key", "hook"], { api_key: "a", hook: "b" }).send).toEqual({ api_key: "a", hook: "b" });
  });
  it("are left out of the body unless given", () => {
    const f = { name: "carrier", label: "Parcel carrier", enabled: true, description };
    expect("secrets" in connectionBody(f)).toBe(false);
    expect(connectionBody(f, { api_key: "k" }).secrets).toEqual({ api_key: "k" });
  });
});

describe("what is checked before sending", () => {
  it("is the name and the label, as the server takes them", () => {
    expect(checkConnection({ name: "carrier", label: "Carrier" })).toEqual([]);
    expect(checkConnection({ name: "Carrier!", label: " " })).toHaveLength(2);
  });
  it("needs a key to try what changes something", () => {
    expect(changes({ method: "POST" })).toBe(true);
    expect(changes({ path: "/x" })).toBe(false);
    expect(changes({ body: "{}" })).toBe(true);
    expect(changes({ method: "POST", changes: false })).toBe(false);
  });
  it("takes a capture of 0 to 60 minutes", () => {
    expect([captureMinutes("15"), captureMinutes("61"), captureMinutes("x"), captureMinutes("0")]).toEqual([15, null, null, 0]);
  });
});

describe("states", () => {
  it("are on, off, or needing to connect again", () => {
    expect(connectionState({ enabled: true })).toBe("on");
    expect(connectionState({ enabled: false })).toBe("off");
    expect(connectionState({ enabled: true, account: { status: "needs_reconnecting" } })).toBe("reconnect");
    expect([personalState({ id: "1", name: "m", label: "M", status: null, account: null }), personalState({ id: "1", name: "m", label: "M", status: "connected", account: "a@x" })]).toEqual(["none", "connected"]);
  });
});
