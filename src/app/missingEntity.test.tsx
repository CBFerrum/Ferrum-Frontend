// @vitest-environment jsdom
// The records frame's generic pages take the entity from the address. Mounted on a route with no `:entity` (as CRM's was, so its
// forms stayed on "Loading…" for ever) they say so plainly, log it once, and ask for nothing.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormView } from "./FormView";
import { ListView } from "./ListView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function open(ui: ReactElement, route: string, path: string) {
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={ui} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return host;
}

describe("a records page without an entity in its address", () => {
  it("shows a plain error instead of loading for ever, asks for no entity's metadata, and logs once", async () => {
    const fetched = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetched);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = await open(<FormView />, "/e/Lead/:id", "/e/Lead/new");
    expect(host.textContent).toContain("This page was not given a record type");
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    // It does not ask for metadata of an entity called "" (which answers with the list of all of them).
    expect(fetched.mock.calls.map((c) => String((c as unknown[])[0])).filter((u) => u.includes("/api/meta/"))).toEqual([]);
    // Drawn again, it does not log again.
    await open(<FormView />, "/e/Lead/:id", "/e/Lead/new");
    expect(log.mock.calls.filter((c) => String(c[0]).startsWith("FormView was mounted without an entity"))).toHaveLength(1);
  });

  it("says the same for a list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = await open(<ListView />, "/e/Lead", "/e/Lead");
    expect(host.textContent).toContain("This page was not given a record type");
  });
});
