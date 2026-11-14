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
