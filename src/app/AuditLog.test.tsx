// @vitest-environment jsdom
// Administration → Audit log: rows from the event shape of docs/operations.md (and server/tests/access_it.rs), paged by next_before,
// filtered by category, with an empty state and the server's refusal as it is.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { violations } from "../test/axe";
import { AuditLog, eventWords } from "./AuditLog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const signIn = (id: number, over: Record<string, unknown> = {}) => ({
  id: String(id), workspace: "w", at: "2026-11-14T09:30:12.004211Z", category: "sign_in", entity: "SignIn", record: "u1", action: "signed_in", actor: "u1", request_id: null,
  details: { address: "203.0.113.7", user_agent: "Mozilla/5.0", zone: "office", method: "password" }, hash: "9f2c", ...over,
});
const change = { id: "40", workspace: "w", at: "2026-11-14T09:00:00Z", category: "administration", entity: "Tenant", record: "w", action: "settings", actor: null, request_id: null, details: { idle_minutes: 15 }, hash: "ab" };

async function open(answer: (url: URL) => Response) {
  const urls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url, "http://x");
    if (u.pathname === "/api/admin/users") return json(200, { users: [{ id: "u1", email: "ana@acme.test", full_name: "Ana" }] });
    urls.push(u);
    return answer(u);
  }));
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuditLog /></QueryClientProvider>);
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
  return { host, urls };
}
const click = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

describe("the audit log", () => {
  it("lists events with when, who, what, address, zone and the method of a sign-in", async () => {
    const { host, urls } = await open(() => json(200, { events: [signIn(48213), change], next_before: 40 }));
    const rows = [...host.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows[0]!.slice(1)).toEqual(["Ana", "Signed in", "203.0.113.7", "office", "password"]);
    expect(rows[0]![0]).toMatch(/2026|Nov/);
    expect(rows[1]!.slice(1)).toEqual(["System", "Tenant settings", "", "", ""]);
    expect(urls[0]!.search).toBe("?limit=50");
    expect(host.textContent).not.toContain("Load more");
    expect(await violations(host.innerHTML)).toEqual([]);
  });

  it("pages with next_before and filters by category", async () => {
    const full = Array.from({ length: 50 }, (_, i) => signIn(200 - i));
    const { host, urls } = await open((u) => (u.searchParams.get("before") ? json(200, { events: [signIn(100)], next_before: 100 }) : json(200, { events: full, next_before: 151 })));
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Load more")!);
    await settle();
    expect(urls[1]!.searchParams.get("before")).toBe("151");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(51);
    expect(host.textContent).not.toContain("Load more");
    const select = host.querySelector("select")!;
    await act(async () => {
      select.value = "administration";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(urls.at(-1)!.searchParams.get("category")).toBe("administration");
    expect(urls.at(-1)!.searchParams.get("before")).toBeNull();
  });

  it("says when there is nothing, and shows the server's refusal as it is", async () => {
    const empty = await open(() => json(200, { events: [], next_before: null }));
    expect(empty.host.textContent).toContain("No events yet");
    document.body.innerHTML = "";
    const refused = await open(() => json(403, { error: "forbidden", message: "administrator access required" }));
    expect(refused.host.textContent).toContain("administrator access required");
  });

  it("names a sign-in's action for people", () => {
    expect([eventWords({ category: "sign_in", entity: "SignIn", action: "failed_summary" }), eventWords({ category: "records", entity: "Customer", action: "update" })]).toEqual(["Failed sign-ins, summarised", "Customer update"]);
  });
});
