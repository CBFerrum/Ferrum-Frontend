// @vitest-environment jsdom
// A phone number on a record can be called from where it is shown (gapclose/design/S14-S15-S16.md, slice 17 FE-CALL): through the
// `call` intent when an app the person may use handles it (Comms' phone), else a plain `tel:` link the device dials.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeShell, removeFakeShell } from "@ferrum/testing";
import { pages } from "../../apps/shell/src/routes";
import type { Field } from "../lib/meta";
import { FieldControl } from "./widgets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  removeFakeShell();
  delete (globalThis as { ferrum?: unknown }).ferrum;
  vi.unstubAllGlobals();
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));
async function draw(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  await settle();
  return host;
}
/** A label without the marks that keep a number apart in right-to-left text. */
const plain = (s: string | null) => (s ?? "").replace(/[\u2066-\u2069]/g, "");
const phone = { name: "mobile_no", label: "Mobile", type: "phone", can_read: true, can_write: true } as Field;

/** A shell whose `call` intent is handled (or not); the intents asked are kept. */
const shellWith = (handles: boolean) => installFakeShell(handles ? { intents: { "call phone": null } } : {}).intents;

describe("a phone field", () => {
  it("call_uses_intent_else_tel", async () => {
    // An app handles calls: a Call button that asks it, with the number and the record.
    let asked = shellWith(true);
    let host = await draw(<FieldControl field={phone} id="f-mobile_no" value="+91 98765 43210" onChange={() => {}} entity="Lead" recordId="L-1" />);
    const button = host.querySelector<HTMLButtonElement>("button")!;
    expect(plain(button.getAttribute("aria-label"))).toBe("Call +91 98765 43210");
    expect(host.querySelector('a[href^="tel:"]')).toBeNull();
    await act(async () => button.click());
    expect(asked).toEqual([{ action: "call", type: "phone", data: { number: "+91 98765 43210", entity: "Lead", id: "L-1" } }]);
    act(() => roots.splice(0).forEach((r) => r.unmount()));
    removeFakeShell();

    // None does (no phone line, no Comms, no shell): a tel: link with the digits alone, named for the number.
    asked = shellWith(false);
    host = await draw(<FieldControl field={phone} id="f-mobile_no" value="+91 (98765) 43210" onChange={() => {}} disabled />);
    const link = host.querySelector<HTMLAnchorElement>('a[href^="tel:"]')!;
    expect(link.getAttribute("href")).toBe("tel:+919876543210");
    expect(plain(link.getAttribute("aria-label"))).toBe("Call +91 (98765) 43210");
    expect(host.querySelector("button")).toBeNull();
    // The number itself is still shown and selectable.
    expect(host.querySelector<HTMLInputElement>("#f-mobile_no")?.value).toBe("+91 (98765) 43210");
    expect(asked).toEqual([]);
  });

  it("offers nothing to call while it is empty or holds no digits", async () => {
    shellWith(true);
    for (const value of [null, "", "n/a"]) {
      const host = await draw(<FieldControl field={phone} id="f-mobile_no" value={value} onChange={() => {}} />);
      expect(host.querySelector("button, a")).toBeNull();
    }
  });
});

it("a record's phone opens through the real route table with its Call link", async () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const all = { read: "all", write: "all", create: "all", delete: "all", submit: "none", cancel: "none", amend: "none", report: "all", export: "all", import: "all", share: "all", print: "all", email: "all" };
  const META = {
    name: "Contact", label: "Contact", label_plural: "Contacts", kind: "master", title_field: "full_name", submittable: false, list: { columns: ["full_name"] },
    form: [{ fields: ["full_name", "mobile_no"] }], search_fields: [], rules: [], actions: [], children: {}, permissions: all,
    fields: [{ name: "full_name", label: "Full Name", type: "data", can_read: true, can_write: true }, phone],
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url, "http://x").pathname;
    if (path === "/api/meta/Contact") return json(META);
    if (path === "/api/v1/Contact/C-1") return json({ id: "C-1", version: 1, full_name: "Asha", mobile_no: "+44 20 7946 0000" });
    if (path === "/api/auth/me") return json({ tenant: "t", user: { id: "u", email: "a@b.test", full_name: "A", is_admin: false, roles: [] }, default_company: null, scopes: {}, fiscal_year_start_month: 1, packages: [] });
    if (path === "/api/meta") return json({ version: 1, packages: [], modules: [], entities: [], warnings: [] });
    return new Response(JSON.stringify({ error: "not_found", message: path }), { status: 404, headers: { "content-type": "application/json" } });
  }));
  const router = createMemoryRouter([{ path: "/", element: <Outlet />, children: pages.data }], { initialEntries: ["/e/Contact/C-1"] });
  const host = await draw(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  for (let i = 0; i < 250 && !host.querySelector('a[href^="tel:"]'); i++) await settle();
  expect(host.querySelector('a[href^="tel:"]')?.getAttribute("href")).toBe("tel:+442079460000");
});
