// @vitest-environment jsdom
// The Brand form (core package, gapclose/design/S4-public-side.md §2.17) shows, under its colour fields, how public pages will
// show the colour in light and dark, with the kernel's nudge (accentTokens), as it is typed. Opened through the shell's real
// route table at /data/e/Brand/new.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { pages } from "../../apps/shell/src/routes";
import { accentTokens } from "../lib/theme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const all = { read: "all", write: "all", create: "all", delete: "all", submit: "none", cancel: "none", amend: "none", report: "all", export: "all", import: "all", share: "all", print: "all", email: "all" };
const field = (name: string, label: string, type: string, over: object = {}) => ({ name, label, type, can_read: true, can_write: true, ...over });
const BRAND = {
  name: "Brand", label: "Brand", label_plural: "Brands", kind: "master", module: "setup", title_field: "brand_name", submittable: false,
  list: { columns: ["brand_name"] }, form: [{ fields: ["brand_name", "primary_color", "primary_color_dark", "shown_color", "footer_text"] }], search_fields: [], rules: [], actions: [],
  fields: [
    field("brand_name", "Brand Name", "data", { required: true }),
    field("primary_color", "Colour", "color", { required: true, default: "#3157d5" }),
    field("primary_color_dark", "Colour in Dark Mode", "color"),
    field("shown_color", "Shown Colour", "data", { read_only: true, can_write: false }),
    field("footer_text", "Footer Text", "text"),
  ],
  children: {}, permissions: all,
};
const ME = { tenant: "t", user: { id: "u", email: "a@b.test", full_name: "A B", is_admin: true, roles: [] }, default_company: null, scopes: {}, fiscal_year_start_month: 1, packages: ["core"] };

it("the Brand form previews its colour as public pages will show it, in light and dark, as it is typed", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url, "http://x").pathname;
    if (path === "/api/meta/Brand") return json(200, BRAND);
    if (path === "/api/meta") return json(200, { version: 1, packages: ["core"], modules: [], entities: [], warnings: [] });
    if (path === "/api/auth/me") return json(200, ME);
    return json(404, { error: "not_found", message: path });
  }));
  const router = createMemoryRouter([{ path: "/", element: <Outlet />, children: pages.data }], { initialEntries: ["/e/Brand/new"] });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>));
  const preview = () => host.querySelector('[role="group"][aria-label="How public pages show this colour"]');
  for (let i = 0; i < 250 && !preview(); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  expect(preview()).not.toBeNull();
  // It follows the colour fields.
  const order = [...host.querySelectorAll("#f-primary_color_dark, [aria-label='How public pages show this colour'], #f-shown_color")].map((e) => e.id || "preview");
  expect(order).toEqual(["f-primary_color_dark", "preview", "f-shown_color"]);
  const shown = () => [...preview()!.querySelectorAll("[data-mode] .mono")].map((e) => e.textContent);
  expect(shown()).toEqual([accentTokens("#3157d5").light, accentTokens("#3157d5").dark]);

  // A yellow that fails on white is shown darker in light mode, as the server will serve it.
  const text = host.querySelector<HTMLInputElement>("#f-primary_color")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(text, "#ffff00");
    text.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(shown()).toEqual(["#707000", "#ffff00"]);
});
