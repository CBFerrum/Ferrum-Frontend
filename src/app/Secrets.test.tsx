// @vitest-environment jsdom
// Administration → Secrets: the workspace's secrets by owner (the platform, an app by its name, a plugin), described and never shown;
// adding one (the name checked before sending), a new version, removing one after asking; a value the server made shown once and gone
// with its dialog; a step-up refusal confirmed and the request sent again once; a closed vault; someone else's removal. Shapes are those
// of server/src/controllers/secrets.rs and crates/kernel/src/vault/secrets.rs (`Described`).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { violations } from "../test/axe";
import { ConfirmHost, Toaster } from "../ui/kit";
import { nameProblem, Secrets } from "./Secrets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  act(() => document.querySelectorAll<HTMLButtonElement>('.toast [aria-label="Dismiss notification"]').forEach((b) => b.click()));
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const RULE = { reveal: false, hosts: [], sandbox: "blank", overlap_secs: 0, expires_at: null };
const secret = (owner: string, name: string, over: Record<string, unknown> = {}) => ({
  owner, workspace: "0195b6d8-7c2e-7000-8000-000000000001", name, kind: "value", version: 1, rule: RULE, set_at: "2026-11-14T09:00:00Z", set_by: null, last_used: null, ...over,
});
const LISTED = {
  owners: [
    { owner: "crm", secrets: [secret("crm", "mail_token", { version: 3, rule: { ...RULE, hosts: ["api.mail.example"], overlap_secs: 86_400 } })] },
    { owner: "platform", secrets: [secret("platform", "signing", { kind: "ed25519", public_key: "MCowBQYDK2VwAyEA", rule: { ...RULE, sandbox: "regenerate" } })] },
    { owner: "plugin:stripe", secrets: [secret("plugin:stripe", "api_key", { rule: { ...RULE, reveal: true } })] },
  ],
};
const MADE = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MDEyMzQ1Njc4OTA";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Answer = (body: any) => Response | Promise<Response>; // eslint-disable-line @typescript-eslint/no-explicit-any -- request bodies as sent
async function open(routes: Record<string, Answer | object>) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const reads = { n: 0 };
  const all: Record<string, Answer | object> = {
    "GET /api/admin/apps": { installed: [{ id: "crm", name: "CRM" }], available: [], uploads: "off", platform: "", stores: [] },
    "GET /api/admin/plugins": { plugins: [{ name: "stripe" }] },
    ...routes,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = decodeURIComponent(new URL(url, "http://x").pathname);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET") sent.push({ method, path, body });
    if (`${method} ${path}` === "GET /api/admin/secrets") reads.n++;
    const answer = all[`${method} ${path}`];
    if (answer === undefined) return json(404, { error: "not_found", message: `${method} ${path}` });
    return typeof answer === "function" ? (answer as Answer)(body) : json(200, answer);
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Secrets />
        <ConfirmHost />
        <Toaster />
      </QueryClientProvider>,
    );
  });
  await settle();
  return { host, sent, reads, client };
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error("nothing to press");
  await act(async () => {
    (el as HTMLElement).focus();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
};
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const button = (scope: ParentNode, name: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent === name || b.getAttribute("aria-label") === name);
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
const field = (label: string) => {
  const l = [...dialog().querySelectorAll("label")].find((x) => (x.textContent ?? "").replace(/\*$/, "") === label);
  return (l?.htmlFor ? document.getElementById(l.htmlFor) : l?.querySelector("input")) as HTMLInputElement;
};
const submit = async () => {
  await act(async () => void dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle();
};
const rowOf = (host: HTMLElement, name: string) => [...host.querySelectorAll("tbody tr")].find((r) => r.querySelector(".mono")?.textContent === name) as HTMLTableRowElement;

describe("the workspace's secrets", () => {
  it("lists them grouped by owner, an app by its name, with how each is used, and never a value", async () => {
    const { host } = await open({ "GET /api/admin/secrets": LISTED });
    expect([...host.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["CRM", "The platform", "Plugin stripe"]);
    const mail = rowOf(host, "mail_token").textContent!;
    expect(mail).toContain("A value · Version 3");
    expect(mail).toContain("Used by the server, never shown");
    expect(mail).toContain("Sent only to api.mail.example");
    expect(mail).toContain("A sandbox has none");
    expect(mail).toContain("the version before still checks for 1 day");
    expect(mail).toContain("Not used yet");
    expect(rowOf(host, "signing").textContent).toContain("A signing key pair");
    expect(rowOf(host, "signing").textContent).toContain("A sandbox gets its own");
    expect(rowOf(host, "api_key").textContent).toContain("Its owner may read it");
    // Nothing that shows a value, nor anything that would.
    expect(host.querySelectorAll("input")).toHaveLength(0);
    expect(button(host, "Show the value")).toBeUndefined();
    expect(await violations(host.innerHTML)).toEqual([]);
  });

  it("says what a secret is when there is none", async () => {
    const { host } = await open({ "GET /api/admin/secrets": { owners: [] } });
    expect(host.textContent).toContain("No secrets yet");
    expect(host.textContent).toContain("A secret is a password, token or key");
    expect(button(host, "Add a secret")).toBeTruthy();
  });

  it("says plainly that the vault is closed, once, without asking again", async () => {
    const { host, reads } = await open({ "GET /api/admin/secrets": () => json(503, { error: "unavailable", message: "the vault is closed" }) });
    await settle();
    expect(host.textContent).toContain("The vault is closed");
    expect(host.textContent).toContain("must give it its root");
    expect(button(host, "Try again")).toBeUndefined();
    expect(reads.n).toBe(1);
  });

  it("shows the refusal of someone who is not an administrator, and nothing that exists", async () => {
    const { host } = await open({ "GET /api/admin/secrets": () => json(403, { error: "forbidden", message: "a workspace's secrets are its administrators' to manage" }) });
    expect(host.textContent).toContain("You don't have access to this");
    expect(host.querySelector("table")).toBeNull();
  });

  it("checks the name before sending anything", async () => {
    expect(nameProblem("api_token.v2-x")).toBeNull();
    expect(nameProblem("Api")).not.toBeNull();
    expect(nameProblem("_x")).not.toBeNull();
    const { host, sent } = await open({ "GET /api/admin/secrets": LISTED });
    await click(button(host, "Add a secret"));
    await type(field("Name"), "My Token");
    await type(field("Value"), "s3cret");
    await submit();
    expect(dialog().textContent).toContain("Use up to 100 lowercase letters");
    // A name the owner already has is a new version, not a second secret.
    await type(field("Name"), "signing");
    await submit();
    expect(dialog().textContent).toContain("already has a secret with this name");
    expect(sent).toEqual([]);
  });

  it("adds a typed value under the rule's defaults, and clears the value when the server refuses it", async () => {
    let refuse = true;
    const { host, sent } = await open({
      "GET /api/admin/secrets": LISTED,
      "PUT /api/admin/secrets/crm/webhook": () =>
        refuse ? json(422, { error: "validation_failed", message: "Please correct the highlighted fields", fields: [{ field: "hosts", message: "\"API\" is not a host's name in lowercase" }] }) : json(200, { secret: secret("crm", "webhook") }),
    });
    await click(button(host, "Add a secret"));
    await act(async () => {
      const s = field("Owner") as unknown as HTMLSelectElement;
      s.value = "crm";
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await type(field("Name"), "webhook");
    const value = field("Value");
    expect([value.type, value.autocomplete]).toEqual(["password", "off"]);
    await click(button(dialog(), "Show the value"));
    expect(field("Value").type).toBe("text");
    await type(field("Value"), "typed-1");
    await submit();
    expect(sent[0]).toEqual({ method: "PUT", path: "/api/admin/secrets/crm/webhook", body: { value: "typed-1", rule: { reveal: false, hosts: [], sandbox: "blank", overlap_secs: 0, expires_at: null } } });
    expect(dialog().textContent).toContain("is not a host's name");
    expect(dialog().querySelector("details")!.open).toBe(true);
    expect(field("Value").value).toBe("");
    refuse = false;
    await type(field("Value"), "typed-2");
    await submit();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(host.textContent).toContain("webhook is saved");
  });

  it("asks the person to confirm it is them on a step-up refusal, then sends the change again once", async () => {
    let proved = false;
    const { host, sent } = await open({
      "GET /api/admin/secrets": LISTED,
      "POST /api/auth/step-up": () => ((proved = true), new Response(null, { status: 204 })),
      "POST /api/admin/secrets/crm/mail_token/rotate": () => (proved ? json(200, { secret: secret("crm", "mail_token", { version: 4 }) }) : json(403, { error: "step_up", message: "confirm it is you to do this" })),
    });
    await click(button(rowOf(host, "mail_token"), "New version"));
    expect(dialog().textContent).toContain("The version before still checks for 1 day after the change.");
    await click([...dialog().querySelectorAll("label")].find((l) => l.textContent?.startsWith("A random value"))!.querySelector("input"));
    await submit();
    expect(document.body.textContent).toContain("confirm it is you");
    const password = [...document.querySelectorAll<HTMLInputElement>("input[type=password]")].at(-1)!;
    await type(password, "right");
    await click(button(document.body, "Confirm"));
    await settle();
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /api/admin/secrets/crm/mail_token/rotate", "POST /api/auth/step-up", "POST /api/admin/secrets/crm/mail_token/rotate"]);
    expect(sent[2]!.body).toEqual({ random: 32 });
    expect(host.textContent).toContain("mail_token has a new version");
  });

  it("shows a value the server made once, and nothing keeps it after the dialog closes", async () => {
    const { host, client } = await open({
      "GET /api/admin/secrets": LISTED,
      "PUT /api/admin/secrets/platform/hook_key": { secret: secret("platform", "hook_key"), shown: MADE },
    });
    const writes = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: writes }, configurable: true });
    await click(button(host, "Add a secret"));
    await type(field("Name"), "hook_key");
    await click([...dialog().querySelectorAll("label")].find((l) => l.textContent?.startsWith("A random value"))!.querySelector("input"));
    await submit();
    expect(dialog().querySelector("code")!.textContent).toBe(MADE);
    // Announced without the value; the copy button has focus.
    expect(dialog().querySelector("[role=status]")!.textContent).not.toContain(MADE);
    expect(document.activeElement?.textContent).toBe("Copy");
    await click(button(dialog(), "Copy"));
    expect(writes).toHaveBeenCalledWith(MADE);
    await click(button(dialog(), "Done"));
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(document.documentElement.outerHTML).not.toContain(MADE);
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(MADE);
    expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state))).not.toContain(MADE);
    expect(location.href).not.toContain(MADE);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(MADE);
  });

  it("asks before removing, saying what stops working, and sends nothing when the answer is no", async () => {
    const { host, sent, reads } = await open({ "GET /api/admin/secrets": LISTED, "DELETE /api/admin/secrets/plugin:stripe/api_key": { removed: true } });
    await click(button(rowOf(host, "api_key"), "Remove…"));
    expect(dialog().textContent).toContain("Remove api_key?");
    expect(dialog().textContent).toContain("Whatever Plugin stripe does with it stops working");
    await click(button(dialog(), "Cancel"));
    expect(sent).toEqual([]);
    await click(button(rowOf(host, "api_key"), "Remove…"));
    await click(button(dialog(), "Remove"));
    expect(sent).toEqual([{ method: "DELETE", path: "/api/admin/secrets/plugin:stripe/api_key", body: undefined }]);
    expect(reads.n).toBe(2);
  });

  it("reads the list again and says so when someone else removed the secret being changed", async () => {
    let listed: object = LISTED;
    const { host, reads } = await open({
      "GET /api/admin/secrets": () => json(200, listed),
      "POST /api/admin/secrets/crm/mail_token/rotate": () => ((listed = { owners: LISTED.owners.slice(1) }), json(404, { error: "not_found", message: "secret" })),
    });
    await click(button(rowOf(host, "mail_token"), "New version"));
    await type(field("Value"), "typed");
    await submit();
    await settle();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(host.textContent).toContain("Someone else removed mail_token meanwhile");
    expect(rowOf(host, "mail_token")).toBeUndefined();
    expect(reads.n).toBe(2);
  });
});
