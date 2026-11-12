// The connection editor's logic: what a description keeps when edited, what is sent for secrets, and the states.

import { describe, expect, it } from "vitest";
import { at, captureMinutes, changes, checkConnection, connectionBody, connectionState, parseDescription, parseInputs, personalState, put, secretNames, secretsPatch, typedSecrets, readPick, makePick, signatureNeedsDelivery, tidy } from "./connectionDraft";

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
  it("are sent with a new connection only when typed", () => {
    expect(typedSecrets({ api_key: "", hook: "" })).toBeUndefined();
    expect(typedSecrets({ api_key: "a", hook: "" })).toEqual({ api_key: "a" });
  });
  it("are changed by name on a saved one: set or replace some, remove others, the rest kept", () => {
    expect(secretsPatch({ api_key: "k" })).toEqual({ set: { api_key: "k" }, remove: [] });
    expect(secretsPatch({}, ["hook"])).toEqual({ set: {}, remove: ["hook"] });
  });
  it("are left out of the body unless given", () => {
    const f = { name: "carrier", label: "Parcel carrier", enabled: true, description };
    expect("secrets" in connectionBody(f)).toBe(false);
    expect(connectionBody(f, { api_key: "k" }).secrets).toEqual({ api_key: "k" });
  });
});

describe("result picks (BD-46)", () => {
  it("read a pointer, a header, a link, an expression, each perhaps required; a file has no form here", () => {
    expect(readPick("/status")).toEqual({ kind: "at", value: "/status", required: false });
    expect(readPick({ header: "Location", required: true })).toEqual({ kind: "header", value: "Location", required: true });
    expect(readPick({ link: "next" })?.kind).toBe("link");
    expect(readPick({ expr: "answer.a + answer.b" })?.kind).toBe("expr");
    expect(readPick({ file: { from: "/url" } })).toBeNull();
    expect(readPick({ header: "x", extra: 1 })).toBeNull();
  });
  it("write a plain pointer as text and anything else as the object", () => {
    expect(makePick({ kind: "at", value: "/a", required: false })).toBe("/a");
    expect(makePick({ kind: "at", value: "/a", required: true })).toEqual({ at: "/a", required: true });
    expect(makePick({ kind: "header", value: "Location", required: false })).toEqual({ header: "Location" });
  });
  it("need a delivery id for a signature without a timestamp", () => {
    const sig = { inbound: { verify: { type: "signature", header: "x-sig", secret: "hook" } } };
    expect(signatureNeedsDelivery(sig)).toBe(true);
    expect(signatureNeedsDelivery({ inbound: { ...sig.inbound, delivery_header: "x-id" } })).toBe(false);
    expect(signatureNeedsDelivery({ inbound: { verify: { ...sig.inbound.verify, timestamp_header: "x-ts" } } })).toBe(false);
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
