// The connections screens rendered to HTML with the server's shapes (docs/api.md "Connections"), then axe: the list with each
// state, the editor with its secrets write-only, a person's own connections.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import type { ConnectionRow } from "../lib/connectionDraft";
import { ConnectionEditor } from "./ConnectionEditor";
import { Connections, MyConnections } from "./Connections";
import { InboundAddress } from "./ConnectionTools";

const render = (el: ReactElement, seed: (qc: QueryClient) => void = () => {}) => {
  const qc = new QueryClient();
  seed(qc);
  return renderToString(<QueryClientProvider client={qc}>{el}</QueryClientProvider>);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const carrier: ConnectionRow = {
  id: "11111111-1111-7111-8111-111111111111", name: "carrier", label: "Parcel carrier", enabled: true, secrets: ["api_key"], account: null, source: null, refused: 0, debug_until: null,
  inbound: "/api/connections/inbound/11111111-1111-7111-8111-111111111111",
  description: { base: "https://api.carrier.example/v2", auth: { type: "bearer", secret: "api_key" }, operations: { track: { path: "/tracks/{{ inputs.tracking }}", result: { status: "/status" } } },
    inbound: { verify: { type: "token", header: "x-token", secret: "hook" } } },
};
const mailbox: ConnectionRow = { ...carrier, id: "22222222-2222-7222-8222-222222222222", name: "mail", label: "Mailbox", secrets: [], account: { status: "needs_reconnecting", account: "ops@acme.example" },
  description: { base: "https://mail.example", auth: { type: "oauth", owner: "workspace", provider: { authorize_url: "https://a.example/a", token_url: "https://a.example/t", client_id: "x" } } } };
const offered: ConnectionRow = { id: null, name: "pager", label: "Pager", enabled: false, secrets: [], source: "package:alerts", offered: true, description: { test: true } };
const off: ConnectionRow = { ...carrier, id: "33333333-3333-7333-8333-333333333333", name: "old", label: "Old one", enabled: false, secrets: [] };

describe("the connections list", () => {
  const html = render(<Connections />, (qc) => qc.setQueryData(["admin", "connections"], { connections: [carrier, mailbox, offered, off] }));
  it("shows each connection's state, with what a package offers apart", async () => {
    const t = text(html);
    expect(t).toContain("On");
    expect(t).toContain("Off");
    expect(t).toContain("Needs reconnecting");
    expect(t).toContain("Offered by a package");
    expect(t).toContain("ops@acme.example");
    expect(t).toContain("Connect again");
    expect(t).toContain("Take it up");
    expect(t).toContain("Secrets set: api_key");
    expect(await violations(html)).toEqual([]);
  });
  it("is empty in words of its own, and a refusal is the server's", () => {
    expect(text(render(<Connections />, (qc) => qc.setQueryData(["admin", "connections"], { connections: [] })))).toContain("Nothing is connected yet");
  });
});

describe("the editor", () => {
  const html = render(<ConnectionEditor row={carrier} onClose={() => {}} onSaved={() => {}} />);
  it("shows the structured fields and the raw view, and the secrets as password boxes that hold nothing", async () => {
    expect(html).toContain('value="https://api.carrier.example/v2"');
    expect(html).toContain('value="/tracks/{{ inputs.tracking }}"');
    expect(html).toContain("Called from outside");
    const secrets = [...html.matchAll(/<input[^>]*id="secret-(api_key|hook)"[^>]*>/g)];
    expect(secrets.map((m) => m[1]).sort()).toEqual(["api_key", "hook"]);
    for (const m of secrets) expect(m[0]).toContain('type="password"');
    for (const m of secrets) expect(m[0]).not.toMatch(/value="[^"]/);
    expect(text(html)).toContain("Set. Type to replace it.");
    expect(text(html)).toContain("Not set.");
    expect(html).toContain('aria-label="Replace api_key"');
    expect(html).toContain('aria-label="Remove api_key"');
    expect(html).not.toContain('aria-label="Remove hook"');
    expect(html).not.toContain('name="secret:');
    expect(await violations(html)).toEqual([]);
  });
  it("starts a new connection with nothing set", () => {
    const fresh = render(<ConnectionEditor row={null} onClose={() => {}} onSaved={() => {}} />);
    expect(text(fresh)).toContain("No secret is named yet.");
    expect(fresh).not.toContain("Replace ");
  });
  it("keeps a pick, a form part and a file body it has no control for exactly as they are", async () => {
    const odd: ConnectionRow = { ...carrier, description: { ...carrier.description, auth: { type: "session", login: "login", refresh: "refresh", token_at: "/t" },
      operations: { login: {}, refresh: {}, up: { method: "POST", path: "/u", form: { caption: "{{ inputs.t }}", media: { file: "{{ inputs.f }}", max_bytes: 5 } }, result: { id: { header: "Location", required: true }, label: { file: { from: "/u" } }, n: "/n" } },
        down: { body: { file: "{{ inputs.v }}" } } }, meta: { owner: "ops" } } };
    const html = render(<ConnectionEditor row={odd} onClose={() => {}} onSaved={() => {}} />);
    expect(html).toContain("A session: log in, then refresh");
    expect(html).toContain("&quot;file&quot;:&quot;{{ inputs.f }}&quot;");
    expect(html).toMatch(/<option value="header" selected/);
    expect(html).toContain("Kept as it is");
    expect(html).toContain("&quot;owner&quot;: &quot;ops&quot;");
    expect(await violations(html)).toEqual([]);
  });
});

describe("the inbound address and my connections", () => {
  it("gives the address to copy only for a connection that takes calls in", () => {
    expect(render(<InboundAddress row={carrier} />)).toContain("/api/connections/inbound/11111111-1111-7111-8111-111111111111");
    expect(text(render(<InboundAddress row={{ ...off, description: { base: "https://x.example" } }} />))).not.toContain("Address to give the caller");
  });
  it("lists a person's own with their state", async () => {
    const html = render(<MyConnections />, (qc) =>
      qc.setQueryData(["connections", "mine"], { connections: [{ id: "a", name: "mail", label: "Mailbox", status: "connected", account: "me@acme.example" }, { id: "b", name: "social", label: "Social", status: null, account: null }, { id: "c", name: "cal", label: "Calendar", status: "needs_reconnecting", account: null }] }),
    );
    const t = text(html);
    expect(t).toContain("Connected");
    expect(t).toContain("Not connected");
    expect(t).toContain("Needs reconnecting");
    expect(t).toContain("me@acme.example");
    expect(await violations(html)).toEqual([]);
  });
});
