// @vitest-environment jsdom
// Administration → Workspace → Access: the form shows the saved settings and the address the server sees, sends only what changed,
// shows the server's refusals by the list they are about, and a double press sends once. Shapes and messages are those of
// crates/kernel/src/tenant.rs and server/tests/access_it.rs.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { violations } from "../test/axe";
import { AccessSettings } from "./AccessSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const initial = { staff_networks: { networks: ["10.0.0.0/8"], mode: "report" as const }, idle_minutes: 0, break_glass: null, new_device_notice: false };
const users = { users: [
  { id: "a1", email: "admin@acme.test", full_name: "Admin", is_active: true, is_admin: true, kind: "member" },
  { id: "a2", email: "admin2@acme.test", full_name: "Second", is_active: true, is_admin: true, kind: "member" },
  { id: "m1", email: "member@acme.test", full_name: "Member", is_active: true, is_admin: false, kind: "member" },
  { id: "a3", email: "gone@acme.test", full_name: "Gone", is_active: false, is_admin: true, kind: "member" },
] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function open(put: (body: unknown) => Response | Promise<Response> = () => json(200, {})) {
  const puts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)));
      return put(puts.at(-1));
    }
    if (String(url).startsWith("/_zone")) return json(200, { zone: null, staff: "all", admin: true, address: "203.0.113.7" });
    return json(200, users);
  }));
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(<QueryClientProvider client={new QueryClient()}><AccessSettings initial={initial} /></QueryClientProvider>);
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  return { host, puts };
}
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const submit = (host: HTMLElement) => act(async () => void host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

describe("the access settings", () => {
  it("shows the saved networks, the address the server sees, and offers it once; saving needs a change", async () => {
    const { host } = await open();
    expect((host.querySelector('[aria-label="Network 1"]') as HTMLInputElement).value).toBe("10.0.0.0/8");
    expect(host.textContent).toContain("The server sees your address as 203.0.113.7.");
    expect(host.textContent).toContain("API keys have networks of their own");
    expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Add it")!);
    expect((host.querySelector('[aria-label="Network 2"]') as HTMLInputElement).value).toBe("203.0.113.7/32");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Add it")).toBe(false);
    expect(await violations(host.innerHTML)).toEqual([]);
  });

  it("sends only what changed, once for a double press", async () => {
    let release!: () => void;
    const { host, puts } = await open(() => new Promise<Response>((r) => (release = () => r(json(200, {})))));
    await click(host.querySelector('input[name="net-mode"][type="radio"]:not(:checked)')!);
    await type(host.querySelector("#acc-idle")!, "30");
    await submit(host);
    await submit(host);
    expect(puts).toEqual([{ staff_networks: { networks: ["10.0.0.0/8"], mode: "enforce" }, idle_minutes: 30 }]);
    await act(async () => release());
  });

  it("offers active administrators for the break-glass list and shows the server's refusal where it belongs", async () => {
    const message = "name at least one active administrator: with nobody, nobody could sign in when the identity provider is down (null keeps every administrator)";
    const { host, puts } = await open(() => json(422, { error: "validation_failed", message: "Please check your input.", fields: [{ field: "break_glass", message }] }));
    await click(host.querySelector('input[name="bg-mode"][type="radio"]:not(:checked)')!);
    expect([...host.querySelectorAll('input[type="checkbox"]')].length).toBe(3); // two administrators and the notice; not the member, not the inactive one
    expect(host.textContent).toContain("Second");
    expect(host.textContent).not.toContain("Gone");
    await submit(host);
    expect(puts).toEqual([{ break_glass: [] }]);
    expect(host.textContent).toContain(message);
  });

  it("shows the lock-out refusal by the list", async () => {
    const message = "your own address (203.0.113.7) is not inside these networks, so saving them would shut you out: add it, or save them in report mode first";
    const { host } = await open(() => json(422, { error: "validation_failed", message: "Please check your input.", fields: [{ field: "staff_networks", message }] }));
    await click(host.querySelector('input[name="net-mode"][type="radio"]:not(:checked)')!);
    await submit(host);
    expect(host.querySelector("fieldset p.field-error")?.textContent).toBe(message);
  });
});
