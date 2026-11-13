// The connection editor's logic: what a description keeps when edited, what is sent for secrets, and the states.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { at, captureMinutes, changes, checkConnection, connectionBody, connectionState, parseDescription, parseInputs, personalState, put, secretNames, secretsPatch, typedSecrets, readPick, makePick, signatureNeedsDelivery, undrawn } from "./connectionDraft";

const description = {
  base: "https://api.carrier.example/v2",
  auth: { type: "bearer", secret: "api_key" },
  headers: { "x-account": "acme" },
  future_property: { kept: true },
  operations: { track: { path: "/tracks/{{ inputs.tracking }}", result: { status: "/status" } }, ping: {} },
  inbound: { verify: { type: "token", header: "x-token", secret: "hook" } },
};

describe("a description", () => {
  it("keeps what this screen has no control for, and what is empty but meant", () => {
    const next = put(put(description, ["headers", "x-account"], ""), ["timeout_ms"], undefined);
    expect(next.future_property).toEqual({ kept: true });
    expect(next.headers).toEqual({});
    const pulled = { ...description, pulls: [{ name: "p", operation: "track", items_at: "", every_minutes: 5 }] };
    expect(connectionBody({ name: "a", label: "A", enabled: false, description: pulled }).description).toEqual(pulled);
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

describe("what the form does not draw", () => {
  const rich = {
    base: "https://x.example", any_host: true, handshake: { type: "echo" },
    auth: { type: "oauth", owner: "workspace", provider: { authorize_url: "a", never_expires: true, keep: ["account_id"], scope_separator: " " } },
    operations: { go: { path: "/x", steps: [{ confirm: "sure" }], url: "{{ inputs.u }}", credentials: false, headers_from: "h", result: { a: { at: "/a", as: "text" } } } },
    pulls: [{ name: "p", operation: "go", items_at: "", inputs: { a: "1" }, each: "x", map: { entity: "post", as: "y" } }],
    inbound: { verify: { type: "token", secret: "hook", header: "h", not_secret: ["a"] }, wait: 1 },
  };
  it("is listed at every level, and kept whole in what is sent", () => {
    expect(undrawn(rich).map((u) => u.path).sort()).toEqual([
      "any_host", "auth.provider.keep", "auth.provider.never_expires", "auth.provider.scope_separator", "handshake", "inbound.verify.not_secret", "inbound.wait",
      "operations.go.credentials", "operations.go.headers_from", "operations.go.steps", "operations.go.url", "pulls[0].each", "pulls[0].inputs", "pulls[0].map.as",
    ]);
    expect(connectionBody({ name: "a", label: "A", enabled: false, description: rich }).description).toEqual(rich);
    expect(secretNames({ ...rich, operations: { go: { body: "{{ secret.token_x }}" } } })).toContain("token_x");
  });
  it("lists a property it has never heard of, and nothing else", () => expect(undrawn(description).map((u) => u.path)).toEqual(["future_property"]));

  // Every description a package offers: load, save untouched, and the body is the description (skipped where the packages are not checked out).
  const dir = "/Users/chinmoybhuyan/Desktop/Personal/ERP/core/social/docs/connectors";
  const files = existsSync(dir) ? [dir, `${dir}/services`].filter(existsSync).flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => `${d}/${f}`)) : [];
  it.skipIf(!files.length)("round-trips every offered description untouched", () => {
    for (const f of files) {
      const d = JSON.parse(readFileSync(f, "utf8"));
      expect(connectionBody({ name: "n", label: "L", enabled: false, description: d }).description, f).toEqual(d);
    }
  });
});
