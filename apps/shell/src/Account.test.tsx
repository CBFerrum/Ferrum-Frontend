// @vitest-environment jsdom
// AG-3a (gapclose/design/A2-A3-agents.md §2.10 5, §2.13): until agents open, the build refuses every agent and /mcp admits
// no one, so the Account page offers "Connect an AI assistant" only when the meta index says `agents.open`; absent is closed.
// The page is opened through the shell's real route table (routes.tsx), as /account/ serves it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { pages } from "./routes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ME = { tenant: "t", user: { id: "u", email: "a@b.test", full_name: "A B", is_admin: false, roles: [] }, default_company: null, scopes: {}, fiscal_year_start_month: 1, packages: [] };

async function openAccount(agents: unknown) {
  const meta = { version: 1, packages: [], modules: [], entities: [], warnings: [], ...(agents === undefined ? {} : { agents }) };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url, "http://x").pathname;
    if (path === "/api/meta") return json(200, meta);
    if (path === "/api/auth/me") return json(200, ME);
    return json(404, { error: "not_found", message: path });
  }));
  const router = createMemoryRouter([{ path: "/", element: <Outlet />, children: pages.account }], { initialEntries: ["/"] });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>));
  for (let i = 0; i < 250 && !host.querySelector("h1"); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  return host;
}

it("the_ai_section_is_hidden_unless_agents_are_open", async () => {
  for (const [agents, shown] of [[undefined, false], [{ open: false }, false], [{}, false], [{ open: true }, true]] as const) {
    const host = await openAccount(agents);
    expect(host.querySelector("h1")?.textContent).toBe("Your account");
    expect(!!host.querySelector("#acct-ai"), JSON.stringify(agents)).toBe(shown);
    expect(!!host.querySelector('[aria-label="MCP server address"]')).toBe(shown);
    act(() => roots.splice(0).forEach((r) => r.unmount()));
    document.body.innerHTML = "";
  }
});
