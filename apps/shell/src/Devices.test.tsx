// @vitest-environment jsdom
// The browsers signed in as a person show the zone each was opened in, when the server returns one
// (crates/kernel/src/shell.rs DeviceSession: `ip`, `zone`), and only then.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Devices } from "./Account";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("shows the address with its zone, and the address alone where there is no zone", async () => {
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
  const row = (id: string, zone: string | null) => ({ id, user_id: "u", actor: null, created_at: "2026-11-14T09:00:00Z", last_seen_at: "2026-11-14T09:30:00Z", expires_at: "2026-12-14T09:00:00Z", user_agent: ua, ip: "10.0.0.5", zone, current: id === "a" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sessions: [row("a", "office"), row("b", null)] }), { status: 200, headers: { "content-type": "application/json" } })));
  const host = document.body.appendChild(document.createElement("div"));
  await act(async () => {
    createRoot(host).render(<QueryClientProvider client={new QueryClient()}><Devices /></QueryClientProvider>);
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  expect([...host.querySelectorAll("tbody .faint")].map((e) => e.textContent)).toEqual(["10.0.0.5, zone office", "10.0.0.5"]);
});

// S13 §2.1 (CLOSE REVIEW): signing out everywhere from here leaves the page without the runtime's sign-out, so it forgets what this
// device kept for the person itself (the apps' kept pages hold their name and email), and only once the server has signed them out.
it("signing out everywhere forgets the kept pages and cached reads before leaving", async () => {
  const { ConfirmHost } = await import("@/ui/kit");
  const names = ["ferrum:crm:page", "ferrum:crm:files"];
  const caches = { keys: vi.fn(async () => [...names]), delete: vi.fn(async (n: string) => (names.splice(names.indexOf(n), 1), true)) };
  vi.stubGlobal("caches", caches);
  vi.spyOn(console, "error").mockImplementation(() => {}); // jsdom does not navigate
  const order: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://x").pathname;
    if (init?.method === "POST") order.push(`${path} (${names.includes("ferrum:crm:page") ? "page kept" : "page gone"})`);
    return new Response(JSON.stringify(path === "/api/auth/sessions" ? { sessions: [] } : {}), { status: 200, headers: { "content-type": "application/json" } });
  }));
  const host = document.body.appendChild(document.createElement("div"));
  await act(async () => {
    createRoot(host).render(<QueryClientProvider client={new QueryClient()}><Devices /><ConfirmHost /></QueryClientProvider>);
  });
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  const press = async (label: string) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent === label)!;
    await act(async () => void b.click());
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  };
  await vi.waitFor(() => expect([...document.querySelectorAll("button")].some((x) => x.textContent === "Sign out everywhere")).toBe(true));
  await press("Sign out everywhere");
  const confirm = [...document.querySelectorAll("dialog button")].find((x) => x.textContent === "Sign out everywhere")!;
  await act(async () => void confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await vi.waitFor(() => expect(names).toEqual(["ferrum:crm:files"]));
  expect(order).toEqual(["/api/auth/logout_all (page kept)"]);
});
