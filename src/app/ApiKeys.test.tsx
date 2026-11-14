// @vitest-environment jsdom
// API keys with networks: listed with each key, set when one is made, edited afterwards. Shapes from server/src/controllers/auth.rs
// (list_keys, create_key, update_key) and server/tests/access_it.rs; the `network` refusal is the server's, the screen only edits.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { violations } from "../test/axe";
import { ApiKeys, keyFrom } from "./Admin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no showModal: it only has to set `open`.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const key = (id: string, name: string, networks: string[]) => ({ id, name, prefix: "fk_ab12_…", created_at: "2026-11-14T09:30:12Z", expires_at: null, revoked_at: null, last_used_at: null, scope: null, networks });
const keys = { keys: [key("k1", "pinned", ["10.0.0.0/8", "2001:db8::/32"]), key("k2", "free", [])] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function open(answer: (method: string, url: string, body: any) => Response) {
  const calls: { method: string; url: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET") calls.push({ method, url, body });
    return method === "GET" ? json(200, keys) : answer(method, url, body);
  }));
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(<QueryClientProvider client={new QueryClient()}><ApiKeys /></QueryClientProvider>);
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  return { host, calls };
}
const set = async (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const click = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (host: ParentNode, label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;

describe("API keys with networks", () => {
  it("lists where each works from, anywhere for none", async () => {
    const { host } = await open(() => json(204, {}));
    expect(keyFrom([])).toBe("anywhere");
    const rows = [...host.querySelectorAll("tbody tr")].map((r) => r.textContent);
    expect(rows[0]).toContain("10.0.0.0/8, 2001:db8::/32");
    expect(rows[1]).toContain("anywhere");
    expect(await violations(host.innerHTML)).toEqual([]);
  });

  it("makes a key with its networks", async () => {
    const { host, calls } = await open(() => json(201, { id: "k3", key: "fk_x", note: "Store this key now; it cannot be shown again." }));
    await set(host.querySelector("#key-name")!, "scanner");
    await click(button(host, "Add a network"));
    await set(host.querySelector('[aria-label="Network 1"]')!, "10.0.0.0/8");
    await act(async () => void host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/auth/api_keys", body: { name: "scanner", networks: ["10.0.0.0/8"] } });
  });

  it("edits a key's networks with PATCH, and shows the server's refusal as it is", async () => {
    const refusal = "10.0.0.1/8 is not a network: write 10.0.0.0/8 or 2001:db8::/32";
    const { host, calls } = await open(() => json(422, { error: "validation_failed", message: refusal }));
    await click(button(host, "Networks of pinned"));
    const dialog = document.querySelector("dialog[open]")!;
    await click(button(dialog, "Remove network 2"));
    await set(dialog.querySelector('[aria-label="Network 1"]')!, "10.0.0.1/8");
    await act(async () => void dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(calls).toEqual([{ method: "PATCH", url: "/api/auth/api_keys/k1", body: { networks: ["10.0.0.1/8"] } }]);
    expect(dialog.textContent).toContain(refusal);
  });
});
