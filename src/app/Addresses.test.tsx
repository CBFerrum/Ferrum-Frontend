// @vitest-environment jsdom
// Administration → Addresses: every address with what it opens and its state, the operator's address and zone read only; adding a name
// under the base (its address as typed, reserved names refused before sending, the server's refusal in place) or a domain of the
// workspace's own and checking it; changing what an address shows (only what changed is sent); making one main; removing one (what
// happens, and the date the server answers); short paths (checked before sending, a refusal by the alias it names, one an app took);
// the limits; a closed or restricted workspace; one request for a double press. Shapes are those of server/src/controllers/domains.rs
// and server/tests/addresses_it.rs.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMoment } from "../lib/format";
import { violations } from "../test/axe";
import { ConfirmHost, Toaster } from "../ui/kit";
import { Addresses, nameProblem } from "./Addresses";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
beforeEach(() => {
  // jsdom has no showModal: it only has to set `open`.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  // Toasts live in one store for the page: what a test said is not the next one's.
  act(() => document.querySelectorAll<HTMLButtonElement>('.toast [aria-label="Dismiss notification"]').forEach((b) => b.click()));
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MAIN = "beta.ferrum.test";
const SALES = "sales--beta.ferrum.test";
const OPERATOR = "erp.beta.internal";
const OWN = "erp.acme.example";

type Row = Record<string, unknown> & { host: string };
const row = (host: string, over: Record<string, unknown> = {}): Row => ({
  host, kind: "subdomain", target: "shell", primary: false, is_primary: false, status: "verified", verify_token: "", verified_at: "2026-11-14T09:00:00Z",
  checked_at: null, failures: 0, released_at: null, created_at: "2026-11-14T09:00:00Z", leaving_until: null, zone: null, home: null, apps: null, label: null,
  base_name: null, can: { edit: true, remove: false, make_primary: false }, ...over,
});
const main = row(MAIN, { primary: true, is_primary: true });
const operator = row(OPERATOR, { kind: "operator", zone: "office", can: { edit: false, remove: false, make_primary: true } });
const sales = row(SALES, { base_name: "sales", home: "crm", apps: ["crm"], label: "Sales", can: { edit: true, remove: true, make_primary: true } });
const pending = row(OWN, { kind: "custom", status: "pending", verified_at: null, can: { edit: true, remove: true, make_primary: false } });
const listing = (domains: Row[], over: Record<string, unknown> = {}) => ({
  domains, point_to: "edge.ferrum.test", sites: [], base: "ferrum.test", name_form: "{name}--beta.ferrum.test",
  reserved_names: ["accounts", "admin", "api", "hooks", "login", "mail", "www", "xn"],
  homes: [{ id: "crm", name: "CRM", route: "crm" }, { id: "helpdesk", name: "Helpdesk", route: "helpdesk" }],
  limits: { addresses: 20, paths: 50 }, used: { addresses: domains.filter((d) => !d.released_at).length, paths: 0 }, ...over,
});
const TAKEN = ["account", "admin", "api", "crm", "data", "helpdesk", "open", "portal", "store"];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refused = (field: string, message: string) => json(422, { error: "validation_failed", message: "Please correct the highlighted fields", fields: [{ field, message }] });

type Answer = (body: any) => Response | Promise<Response>; // eslint-disable-line @typescript-eslint/no-explicit-any -- request bodies as sent
/** The screen against `routes` ("METHOD /path" → an answer, or a body to answer 200 with); each change sent is kept. */
async function open(routes: Record<string, Answer | object>) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const all: Record<string, Answer | object> = { "GET /api/admin/usage": { state: "active" }, "GET /api/admin/paths": { paths: [], limit: 50, taken: TAKEN }, ...routes };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(url, "http://x").pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET") sent.push({ method, path, body });
    const answer = all[`${method} ${path}`];
    if (answer === undefined) return json(404, { error: "not_found", message: `${method} ${path}` });
    return typeof answer === "function" ? (answer as Answer)(body) : json(200, answer);
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Addresses />
        <ConfirmHost />
        <Toaster />
      </QueryClientProvider>,
    );
  });
  // Two rounds: an older server's list is read before its account state (useFrozen).
  await settle();
  await settle();
  return { host, sent };
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
/** Pressed as a person does: focus, then click. */
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
const pick = async (el: HTMLSelectElement, value: string) => {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const button = (scope: ParentNode, name: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent === name || b.getAttribute("aria-label") === name);
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
/** A control by its visible label. */
const field = <T extends HTMLElement = HTMLInputElement>(label: string) => {
  const l = [...dialog().querySelectorAll("label")].find((x) => (x.textContent ?? "").replace(/\*$/, "") === label);
  return (l?.htmlFor ? document.getElementById(l.htmlFor) : l?.querySelector("input")) as T;
};
const submit = async () => {
  await act(async () => void dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle();
};
const rowOf = (host: HTMLElement, address: string) => [...host.querySelectorAll("tbody tr")].find((r) => r.querySelector("a .mono")?.textContent === address) as HTMLTableRowElement;
const menu = async (host: HTMLElement, address: string, item: string) => {
  await click(button(host, `Actions for ${address}`));
  await click([...host.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent === item));
};
const toasts = (host: HTMLElement) => [...host.querySelectorAll(".toast-message")].map((t) => t.textContent);

describe("the addresses of a workspace", () => {
  it("lists each address: a link to it, what it opens with its label and apps, the main one, its state; the operator's address and zone read only", async () => {
    const until = "2026-11-28T10:00:00Z";
    const leaving = row("old.acme.example", { kind: "custom", status: "leaving", released_at: "2026-11-14T10:00:00Z", leaving_until: until, can: { edit: false, remove: false, make_primary: false } });
    const { host } = await open({ "GET /api/admin/domains": listing([main, operator, sales, pending, leaving]) });
    expect(host.textContent).toContain("4 of 20 used");
    expect(host.textContent).toContain("People sign in on each address on its own, and each address keeps its own offline work on each device.");

    const first = rowOf(host, MAIN);
    expect(new URL(first.querySelector("a")!.href).hostname).toBe(MAIN);
    expect(first.querySelector("a")!.target).toBe("_blank");
    expect(first.textContent).toContain("Main");
    expect(first.textContent).toContain("Made with the workspace; it stays.");
    expect(first.textContent).toContain("The whole workspace");
    expect(first.textContent).toContain("Working");
    expect(button(first, "Change")).toBeDefined();
    expect(button(first, `Actions for ${MAIN}`)).toBeUndefined(); // neither main again nor removable

    const op = rowOf(host, OPERATOR);
    expect(op.textContent).toContain("Added by whoever runs the installation, who alone can change or remove it.");
    expect(op.textContent).toContain("In the zone office, which only whoever runs the installation can change.");
    expect(op.textContent).not.toContain("Main");
    expect(button(op, "Change")).toBeUndefined();
    await click(button(op, `Actions for ${OPERATOR}`));
    expect([...host.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent)).toEqual(["Make main"]); // the one thing the server lets an administrator do with it
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    const name = rowOf(host, SALES);
    expect(name.textContent).toContain("Shown in the bar as Sales");
    expect(name.textContent).toContain("The workspace, landing on CRM");
    expect(name.textContent).toContain("Lists only CRM");
    expect(button(name, "Change")).toBeDefined();

    const own = rowOf(host, OWN);
    expect(own.textContent).toContain("Waiting for the domain");
    expect(own.textContent).toContain("Point it at edge.ferrum.test with a CNAME record, then check it.");
    expect(button(own, "Check now")).toBeDefined();

    const gone = rowOf(host, "old.acme.example");
    expect(gone.textContent).toContain("Leaving");
    expect(gone.textContent).toContain(`Stops on ${formatMoment(until, { dateStyle: "medium" })}: until then people signed in there keep working, and new visitors go to beta.ferrum.test.`);
    expect(gone.querySelectorAll("button")).toHaveLength(0);
    // Addresses keep left to right in a page that reads right to left.
    expect([...host.querySelectorAll("tbody a .mono")].every((s) => s.getAttribute("dir") === "ltr")).toBe(true);
    expect(await violations(host.innerHTML)).toEqual([]);
  });

  it("shows loading, then what an address is for with one action while the workspace has none of its own; a failure and a refusal as the server says them", async () => {
    let release!: (r: Response) => void;
    const slow = await open({ "GET /api/admin/domains": () => new Promise<Response>((r) => (release = r)) });
    expect(slow.host.querySelector('[role="status"][aria-label="Loading…"]')).not.toBeNull();
    await act(async () => release(json(200, listing([main]))));
    await settle();
    expect(slow.host.textContent).toContain("No addresses of your own yet");
    expect(slow.host.textContent).toContain("Another address can open the workspace for one team");
    expect([...slow.host.querySelectorAll("button")].filter((b) => b.textContent === "Add an address")).toHaveLength(1);
    expect(await violations(slow.host.innerHTML)).toEqual([]);

    const failed = await open({ "GET /api/admin/domains": () => json(500, { error: "internal_error", message: "An internal error occurred (operation 7f3a)" }) });
    expect(failed.host.textContent).toContain("An internal error occurred (operation 7f3a)");
    expect(button(failed.host, "Try again")).toBeDefined();

    // Not an administrator: one refusal for the screen, and nothing of what exists.
    const denied = await open({ "GET /api/admin/domains": () => json(403, { error: "forbidden", message: "administrator access required" }) });
    expect(denied.host.textContent).toContain("You don't have access to this");
    expect(denied.host.textContent).not.toContain("Short paths");
    expect(denied.host.querySelectorAll("button")).toHaveLength(0);
  });

  it("adds a name under the base: the address it gives as it is typed, a reserved name refused before sending, the server's refusal in place", async () => {
    let rows = [main];
    const { host, sent } = await open({
      "GET /api/admin/domains": () => json(200, listing(rows)),
      "POST /api/admin/domains": (b) => (b.name === "crm" ? refused("name", "is an app's name, and here it would be that app's own address") : ((rows = [main, sales]), json(201, sales))),
    });
    await click(button(host, "Add an address"));
    const name = field("Name");
    expect(document.activeElement).toBe(name);
    await type(name, "Sales");
    expect(dialog().textContent).toContain("The address will be sales--beta.ferrum.test");
    await type(name, "accounts");
    expect(dialog().textContent).toContain("This name is kept for the service's own addresses.");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    await submit();
    await type(name, "sa--les");
    expect(dialog().textContent).toContain("Use 1 to 30 lowercase letters, digits or single hyphens, not at either end.");
    await submit();
    expect(sent).toEqual([]);

    await type(name, "crm");
    await submit();
    expect(sent).toHaveLength(1);
    expect(dialog().querySelector(".field-error")?.textContent).toBe("is an app's name, and here it would be that app's own address");
    expect(document.activeElement).toBe(name);

    await type(name, "sales");
    await pick(field<HTMLSelectElement>("The app it lands on"), "crm");
    await click(field("Only these apps"));
    expect(dialog().textContent).toContain("Listing only some apps is a convenience, not a lock: other apps still open there through a link.");
    await submit();
    expect(dialog().textContent).toContain("Tick at least one app, or list every app.");
    expect(sent).toHaveLength(1);
    await click(field("CRM"));
    await type(field("Label"), " Sales ");
    expect(await violations(dialog().outerHTML)).toEqual([]);
    await submit();
    expect(sent[1]).toEqual({ method: "POST", path: "/api/admin/domains", body: { name: "sales", target: "shell", home: "crm", apps: ["crm"], label: "Sales" } });
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(toasts(host)).toContain("sales--beta.ferrum.test is added and works now");
    expect(document.activeElement).toBe(rowOf(host, SALES).querySelector("a"));
  });

  it("adds a domain of the workspace's own with where to point it, then checks it", async () => {
    let rows = [main, sales];
    const { host, sent } = await open({
      "GET /api/admin/domains": () => json(200, listing(rows)),
      "POST /api/admin/domains": () => ((rows = [main, sales, pending]), json(201, pending)),
      [`POST /api/admin/domains/${OWN}/check`]: { host: OWN, answers: false },
    });
    await click(button(host, "Add an address"));
    await click(field("A domain of your own"));
    expect(dialog().textContent).toContain("Point the domain at edge.ferrum.test with a CNAME record;");
    const domain = field("Domain");
    await type(domain, "https://erp.acme.example");
    expect(dialog().textContent).toContain("Write the domain alone, such as erp.example.com.");
    await type(domain, "x.ferrum.test");
    expect(dialog().textContent).toContain("This is under ferrum.test, this service's own domain: give a name instead.");
    await type(domain, "ERP.acme.example");
    await submit();
    expect(sent).toEqual([{ method: "POST", path: "/api/admin/domains", body: { host: OWN, target: "shell" } }]);
    expect(toasts(host)).toContain("erp.acme.example is added: it works once the domain points here and is checked");
    const own = rowOf(host, OWN);
    expect(own.textContent).toContain("Point it at edge.ferrum.test with a CNAME record, then check it.");
    await click(button(own, "Check now"));
    expect(sent[1]).toEqual({ method: "POST", path: `/api/admin/domains/${OWN}/check`, body: undefined });
    expect(toasts(host)).toContain("erp.acme.example does not point here yet");
  });

  it("changes what an address shows, sending only what changed", async () => {
    let current = sales;
    const { host, sent } = await open({
      "GET /api/admin/domains": () => json(200, listing([main, current])),
      [`PATCH /api/admin/domains/${SALES}`]: (b) => ((current = { ...current, ...b }), json(200, current)),
    });
    const change = button(rowOf(host, SALES), "Change")!;
    await click(change);
    expect(dialog().querySelector("h2")!.textContent).toBe("Change what sales--beta.ferrum.test shows");
    const save = button(dialog(), "Save")!;
    expect(save.disabled).toBe(true);
    await type(field("Label"), "Sales team");
    await submit();
    expect(sent).toEqual([{ method: "PATCH", path: `/api/admin/domains/${SALES}`, body: { label: "Sales team" } }]);
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(rowOf(host, SALES).textContent).toContain("Shown in the bar as Sales team");
    expect(document.activeElement).toBe(button(rowOf(host, SALES), "Change"));

    await click(button(rowOf(host, SALES), "Change"));
    await pick(field<HTMLSelectElement>("The app it lands on"), "");
    await click(field("Every app"));
    await submit();
    expect(sent[1]!.body).toEqual({ home: null, apps: null });
    expect(rowOf(host, SALES).textContent).toContain("The whole workspace");
  });

  it("makes an address the main one, and reads the list again", async () => {
    let rows = [main, sales];
    const { host, sent } = await open({
      "GET /api/admin/domains": () => json(200, listing(rows)),
      [`PUT /api/admin/domains/${SALES}/primary`]: () => {
        rows = [{ ...main, primary: false, can: { edit: true, remove: false, make_primary: true } }, { ...sales, primary: true, can: { edit: true, remove: true, make_primary: false } }];
        return new Response(null, { status: 204 });
      },
    });
    await menu(host, SALES, "Make main");
    expect(sent).toEqual([{ method: "PUT", path: `/api/admin/domains/${SALES}/primary`, body: undefined }]);
    expect(toasts(host)).toContain("sales--beta.ferrum.test is now the main address");
    expect(rowOf(host, SALES).querySelector(".badge-blue")?.textContent).toBe("Main");
    expect(rowOf(host, MAIN).querySelector(".badge-blue")).toBeNull();
  });

  it("removes an address after saying what happens, and shows the date the server answers", async () => {
    const until = "2026-11-28T10:00:00Z";
    let rows = [main, sales];
    const { host, sent } = await open({
      "GET /api/admin/domains": () => json(200, listing(rows)),
      [`DELETE /api/admin/domains/${SALES}`]: () => {
        rows = [main, { ...sales, status: "leaving", released_at: "2026-11-14T10:00:00Z", leaving_until: until, can: { edit: false, remove: false, make_primary: false } }];
        return json(200, { host: SALES, leaving_until: until });
      },
    });
    await menu(host, SALES, "Remove…");
    expect(dialog().textContent).toContain("Remove sales--beta.ferrum.test?");
    expect(dialog().textContent).toContain(
      "People already signed in on it keep working there until its leaving period ends, and new visitors go to beta.ferrum.test from now on. Then it stops, and for 90 days only sends visitors on.",
    );
    expect(sent).toEqual([]);
    await click(button(dialog(), "Remove"));
    expect(sent).toEqual([{ method: "DELETE", path: `/api/admin/domains/${SALES}`, body: undefined }]);
    const date = formatMoment(until, { dateStyle: "medium" });
    expect(toasts(host)).toContain(`sales--beta.ferrum.test is leaving: people signed in there keep working until ${date}`);
    const gone = rowOf(host, SALES);
    expect(gone.textContent).toContain(`Stops on ${date}`);
    expect(gone.querySelectorAll("button")).toHaveLength(0);
    // Its menu went with it: focus is on the address, not lost.
    expect(document.activeElement).toBe(gone.querySelector("a"));
  });

  it("shows a refused change in place and moves focus to it", async () => {
    const { host } = await open({
      "GET /api/admin/domains": () => json(200, listing([main, sales])),
      [`PUT /api/admin/domains/${SALES}/primary`]: () => json(403, { error: "forbidden", message: "this workspace is read-only now that its account is closed or restricted: its addresses stay as they are" }),
    });
    await menu(host, SALES, "Make main");
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("sales--beta.ferrum.test was not changed: this workspace is read-only now that its account is closed or restricted: its addresses stay as they are");
    expect(document.activeElement?.contains(alert)).toBe(true);
  });

  it("checks short paths before sending, shows a refusal by the alias it names, and marks one an app has taken", async () => {
    let paths = [{ alias: "helpdesk", target: "/crm/", works: false }];
    const { host, sent } = await open({
      "GET /api/admin/domains": listing([main, sales]),
      "GET /api/admin/paths": () => json(200, { paths, limit: 50, taken: TAKEN }),
      "PUT /api/admin/paths": (b: { paths: { alias: string; target: string }[] }) =>
        b.paths.some((p) => p.alias === "help")
          ? refused("paths", "/help must lead to a page of this workspace: /, /data/…, /store/…, /admin/…, /account/…, /open/…, or an app's address such as /crm/")
          : ((paths = b.paths.map((p) => ({ ...p, works: true }))), json(200, { paths: b.paths })),
    });
    const card = host.querySelector('section[aria-labelledby="paths-head"]') as HTMLElement;
    expect(card.textContent).toContain("It sends people on, so the address bar then shows the page's own path.");
    expect(card.textContent).toContain("An app now uses /helpdesk, so its page opens there and this short path does nothing. Change it or remove it to save.");
    const save = button(card, "Save")!;
    expect(save.disabled).toBe(true);

    await click(button(card, "Remove short path 1"));
    expect(card.textContent).toContain("No short paths yet.");
    await click(button(card, "Add a short path"));
    const alias = (n: number) => card.querySelector<HTMLInputElement>(`[aria-label="Short path ${n}"]`)!;
    const target = (n: number) => card.querySelector<HTMLInputElement>(`[aria-label="Where short path ${n} leads"]`)!;
    expect(document.activeElement).toBe(alias(1));
    await type(alias(1), "api");
    expect(card.textContent).toContain("/api is already the address of an app or of the service itself.");
    await type(alias(1), "/Q4-Sales");
    expect(alias(1).value).toBe("q4-sales");
    await type(target(1), "crm/");
    expect(card.textContent).toContain("Lead it to a page of this workspace, such as /crm/ or /data/.");
    await type(target(1), "/crn/");
    expect(card.textContent).toContain("Lead it to a page of this workspace, such as /crm/ or /data/.");
    expect(save.disabled).toBe(true);
    await type(target(1), "/crm/");
    await click(button(card, "Add a short path"));
    await type(alias(2), "q4-sales");
    await type(target(2), "/");
    expect(card.textContent).toContain("/q4-sales is given twice.");
    await type(alias(2), "help");
    await type(target(2), "/portal/");
    expect(sent).toEqual([]);

    await act(async () => void card.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    expect(sent).toEqual([{ method: "PUT", path: "/api/admin/paths", body: { paths: [{ alias: "q4-sales", target: "/crm/" }, { alias: "help", target: "/portal/" }] } }]);
    expect(alias(2).getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(alias(2).getAttribute("aria-describedby")!)!.textContent).toContain("/help must lead to a page of this workspace");
    expect(document.activeElement).toBe(alias(2));

    await click(button(card, "Remove short path 2"));
    await act(async () => void card.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    expect(sent[1]).toEqual({ method: "PUT", path: "/api/admin/paths", body: { paths: [{ alias: "q4-sales", target: "/crm/" }] } });
    expect(card.textContent).toContain("1 of 50 used");
    expect(alias(1).value).toBe("q4-sales");
    expect(document.activeElement).toBe(card.querySelector("h2"));
    expect(await violations(card.outerHTML)).toEqual([]);
  });

  it("says where the limits are: adding waits at the limit, and the server's refusal shows in place when it is reached first", async () => {
    const full = await open({
      "GET /api/admin/domains": listing([main, sales], { limits: { addresses: 2, paths: 1 }, used: { addresses: 2, paths: 1 } }),
      "GET /api/admin/paths": { paths: [{ alias: "q4-sales", target: "/crm/", works: true }], limit: 1, taken: TAKEN },
    });
    expect(full.host.textContent).toContain("2 of 2 used");
    expect(full.host.textContent).toContain("This workspace has all 2 of its addresses: remove one to add another.");
    expect(button(full.host, "Add an address")!.disabled).toBe(true);
    expect(full.host.textContent).toContain("This workspace has all 1 of its short paths.");
    expect(button(full.host, "Add a short path")!.disabled).toBe(true);

    // Another administrator took the last place first: the refusal is said where it happened, what was typed stays, and the count is read again.
    let used = 3;
    const race = await open({
      "GET /api/admin/domains": () => json(200, listing([main, sales], { limits: { addresses: 4, paths: 50 }, used: { addresses: used, paths: 0 } })),
      "POST /api/admin/domains": () => ((used = 4), json(422, { error: "invalid", message: "a workspace has at most 4 addresses" })),
    });
    expect(race.host.textContent).toContain("3 of 4 used");
    await click(button(race.host, "Add an address"));
    await type(field("Name"), "spare");
    await submit();
    const said = dialog().querySelector('[role="alert"]')!;
    expect(said.textContent).toBe("a workspace has at most 4 addresses");
    expect(document.activeElement?.contains(said)).toBe(true);
    expect(field("Name").value).toBe("spare");
    expect(race.host.textContent).toContain("4 of 4 used");
  });

  it("in a closed or restricted workspace shows everything, with nothing to press and one sentence why", async () => {
    const { host } = await open({
      "GET /api/admin/usage": { state: "restricted" },
      "GET /api/admin/domains": listing([main, operator, sales, pending]),
      "GET /api/admin/paths": { paths: [{ alias: "q4-sales", target: "/crm/", works: true }], limit: 50, taken: TAKEN },
    });
    expect(host.textContent).toContain("While this workspace is closed or restricted, its addresses and short paths keep working and cannot be changed.");
    expect(rowOf(host, SALES).textContent).toContain("The workspace, landing on CRM");
    expect(host.textContent).toContain("/q4-sales");
    expect([...host.querySelectorAll("button, input, select")].map((b) => b.outerHTML.slice(0, 120))).toEqual([]);
    expect(await violations(host.innerHTML)).toEqual([]);
  });

  it("sends once for a double press", async () => {
    let answer!: (r: Response) => void;
    let saved!: (r: Response) => void;
    const { host, sent } = await open({
      "GET /api/admin/domains": listing([main, sales]),
      "POST /api/admin/domains": () => new Promise<Response>((r) => (answer = r)),
      "PUT /api/admin/paths": () => new Promise<Response>((r) => (saved = r)),
    });
    await click(button(host, "Add an address"));
    await type(field("Name"), "spare");
    await submit();
    await submit();
    expect(sent.filter((s) => s.method === "POST")).toHaveLength(1);
    expect(button(dialog(), "Add")!.disabled).toBe(true);
    await act(async () => answer(json(201, row("spare--beta.ferrum.test", { base_name: "spare" }))));
    await settle();

    const card = host.querySelector('section[aria-labelledby="paths-head"]') as HTMLElement;
    await click(button(card, "Add a short path"));
    await type(card.querySelector<HTMLInputElement>('[aria-label="Short path 1"]')!, "q4-sales");
    await type(card.querySelector<HTMLInputElement>('[aria-label="Where short path 1 leads"]')!, "/crm/");
    const form = card.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(sent.filter((s) => s.method === "PUT")).toHaveLength(1);
    await act(async () => saved(json(200, { paths: [{ alias: "q4-sales", target: "/crm/" }] })));
  });
});

// A server that knows proof by record, forwarding and the rest (docs/api.md, /api/admin/domains and /api/admin/paths).
const newer = (r: Row): Row => ({ waiting: null, record: null, proved_at: null, forward: false, redirecting: null, ...r });
const newerListing = (domains: Row[], over: Record<string, unknown> = {}) => listing(domains.map(newer), { proof: "points", read_only: null, leaving_days: 14, ...over });
const RECORD = { name: `_ferrum.${OWN}`, type: "TXT", value: "ferrum-domain=4f1c2a" };
const asked = (path: string) => vi.mocked(fetch).mock.calls.some(([url]) => new URL(String(url), "http://x").pathname === path);
const inDays = (n: number) => formatMoment(Date.now() + n * 86_400_000, { dateStyle: "medium" });

describe("what a newer server says", () => {
  it("shows the DNS record a domain waits for, tells waiting for the domain from waiting for the record, and says each outcome of a check", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    let own: Row = { ...pending, waiting: "domain", record: RECORD };
    const answers: Record<string, unknown>[] = [
      { host: OWN, answers: false, points: false, waiting: "domain" },
      { host: OWN, answers: false, points: true, waiting: "record" },
      { host: OWN, answers: true, points: true, waiting: null },
    ];
    const { host, sent } = await open({
      "GET /api/admin/domains": () => json(200, newerListing([main, own], { proof: "record" })),
      [`POST /api/admin/domains/${OWN}/check`]: () => {
        const a = answers.shift()!;
        own = a.answers ? { ...own, status: "verified", verified_at: "2026-11-15T09:00:00Z", waiting: null, record: null } : { ...own, waiting: a.waiting };
        return json(200, a);
      },
    });
    let r = rowOf(host, OWN);
    expect(r.textContent).toContain("Waiting for the domain");
    expect(r.textContent).toContain("Point it at edge.ferrum.test with a CNAME record, then check it.");
    expect(r.textContent).toContain("Add this DNS record at the domain's DNS provider, where its other records are. Then check it again.");
    expect([...r.querySelectorAll("dd .mono")].map((m) => m.textContent)).toEqual([`_ferrum.${OWN}`, "TXT", "ferrum-domain=4f1c2a"]);
    await click(button(r, "Copy the record's value"));
    expect(writeText).toHaveBeenCalledWith("ferrum-domain=4f1c2a");
    expect(toasts(host)).toContain("Copied to the clipboard");
    expect(await violations(host.innerHTML)).toEqual([]);

    await click(button(r, "Check now"));
    expect(toasts(host)).toContain("erp.acme.example does not point here yet");
    await click(button(rowOf(host, OWN), "Check now"));
    expect(toasts(host)).toContain("erp.acme.example points here, but its DNS record is not there yet");
    r = rowOf(host, OWN);
    expect(r.querySelector(".badge")!.textContent).toBe("Waiting for its DNS record");
    expect(r.textContent).toContain("It points here. It works once its DNS record is added and checked.");
    expect(r.textContent).not.toContain("CNAME");
    expect(r.textContent).toContain("ferrum-domain=4f1c2a");
    await click(button(r, "Check now"));
    expect(toasts(host)).toContain("erp.acme.example now opens this workspace");
    r = rowOf(host, OWN);
    expect(r.textContent).toContain("Working");
    expect(r.textContent).not.toContain("DNS record");
    expect(sent.map((s) => s.path)).toEqual(Array(3).fill(`/api/admin/domains/${OWN}/check`));
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("says in the Add dialog that a DNS record is asked for, only where it is", async () => {
    for (const proof of ["record", "points"]) {
      const { host } = await open({ "GET /api/admin/domains": newerListing([main], { proof }) });
      await click(button(host, "Add an address"));
      await click(field("A domain of your own"));
      const said = dialog().textContent!.includes("This installation also asks for a DNS record that proves the domain is yours.");
      expect(said).toBe(proof === "record");
      await click(button(dialog(), "Cancel"));
    }
  });

  it("adds an address that only sends people on: no apps or label offered, `forward` sent, and the list says where it leads", async () => {
    let rows = [main];
    const front = { ...row("front--beta.ferrum.test", { base_name: "front", home: "crm", can: { edit: true, remove: true, make_primary: false } }), forward: true };
    const { host, sent } = await open({
      "GET /api/admin/domains": () => json(200, newerListing(rows)),
      "POST /api/admin/domains": () => ((rows = [main, front]), json(201, newer(front))),
    });
    await click(button(host, "Add an address"));
    expect(dialog().textContent).toContain("Sending people on means one sign-in, on the main address, and nothing kept separately on this address.");
    expect(field("Label")).toBeTruthy();
    await type(field("Name"), "front");
    await click(field("Only sends people on to the main address, beta.ferrum.test"));
    expect(field("Label")).toBeFalsy();
    expect(dialog().textContent).not.toContain("Apps listed there");
    await pick(field<HTMLSelectElement>("The app it lands on"), "crm");
    // A portal never forwards: the choice goes with the target.
    await pick(field<HTMLSelectElement>("What it opens"), "portal");
    expect(dialog().textContent).not.toContain("What this address does");
    await pick(field<HTMLSelectElement>("What it opens"), "shell");
    expect(await violations(dialog().outerHTML)).toEqual([]);
    await submit();
    expect(sent).toEqual([{ method: "POST", path: "/api/admin/domains", body: { name: "front", target: "shell", home: "crm", forward: true } }]);
    const r = rowOf(host, "front--beta.ferrum.test");
    expect(r.textContent).toContain("Sends people on to beta.ferrum.test, landing on CRM");
    expect(r.textContent).not.toContain("Shown in the bar");
  });

  it("turns an address in use to forwarding: its apps and label go with it, the main one is never offered it, and the date it stops serving shows", async () => {
    const until = "2026-11-29T10:00:00Z";
    let current = newer(sales);
    const { host, sent } = await open({
      "GET /api/admin/domains": () => json(200, newerListing([main, current])),
      [`PATCH /api/admin/domains/${SALES}`]: (b) => ((current = { ...current, ...b, leaving_until: until, can: { edit: true, remove: true, make_primary: false } }), json(200, current)),
    });
    await click(button(rowOf(host, MAIN), "Change"));
    expect(dialog().textContent).not.toContain("What this address does");
    await click(button(dialog(), "Cancel"));

    await click(button(rowOf(host, SALES), "Change"));
    expect(field("Every app")).toBeTruthy();
    await click(field("Only sends people on to the main address, beta.ferrum.test"));
    expect(field("Label")).toBeFalsy();
    expect(field("Every app")).toBeFalsy();
    expect(dialog().textContent).toContain(`People signed in there keep working there until ${inDays(14)}. Then it only sends people on.`);
    await submit();
    // The server keeps what is not sent and refuses apps and a label together with forwarding: both are cleared with it.
    expect(sent).toEqual([{ method: "PATCH", path: `/api/admin/domains/${SALES}`, body: { apps: null, label: null, forward: true } }]);
    const date = formatMoment(until, { dateStyle: "medium" });
    expect(toasts(host)).toContain(`sales--beta.ferrum.test is saved: people signed in there keep working there until ${date}, then it only sends people on`);
    const r = rowOf(host, SALES);
    expect(r.textContent).toContain("Sends people on to beta.ferrum.test, landing on CRM");
    expect(r.textContent).toContain(`Until ${date} people signed in there keep working there. Then it only sends people on to the main address.`);
    await click(button(r, `Actions for ${SALES}`));
    expect([...host.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent)).toEqual(["Remove…"]);
  });

  it("takes whether changes are refused from the list, not the account state", async () => {
    const closed = await open({ "GET /api/admin/usage": { state: "active" }, "GET /api/admin/domains": newerListing([main, sales], { read_only: "closed" }) });
    expect(closed.host.textContent).toContain("While this workspace is closed or restricted, its addresses and short paths keep working and cannot be changed.");
    expect(closed.host.querySelectorAll("button, input, select")).toHaveLength(0);
    expect(asked("/api/admin/usage")).toBe(false);

    const open_ = await open({ "GET /api/admin/usage": { state: "restricted" }, "GET /api/admin/domains": newerListing([main, sales]) });
    expect(open_.host.textContent).not.toContain("cannot be changed");
    expect(button(rowOf(open_.host, SALES), "Change")).toBeDefined();
    expect(asked("/api/admin/usage")).toBe(false);
  });

  it("names the day a removed address stops before removing it, or that it stops at once", async () => {
    for (const [days, said] of [
      [14, `People already signed in on it keep working there until ${inDays(14)}, and new visitors go to beta.ferrum.test from now on.`],
      [0, "It stops at once, and for 90 days only sends visitors on to beta.ferrum.test."],
    ] as const) {
      const { host, sent } = await open({ "GET /api/admin/domains": newerListing([main, sales], { leaving_days: days }) });
      await menu(host, SALES, "Remove…");
      expect(dialog().textContent).toContain(said);
      expect(dialog().textContent).not.toContain("leaving period");
      await click(button(dialog(), "Cancel"));
      expect(sent).toEqual([]);
    }
  });

  it("tells a removed address that still sends visitors on from one that no longer answers", async () => {
    const gone = (host: string, redirecting: boolean) => row(host, { kind: "custom", status: "released", released_at: "2026-06-01T10:00:00Z", can: { edit: false, remove: false, make_primary: false }, redirecting });
    const { host } = await open({ "GET /api/admin/domains": newerListing([main, gone("old.acme.example", true), gone("older.acme.example", false)]) });
    expect(rowOf(host, "old.acme.example").textContent).toContain("It only sends visitors on to beta.ferrum.test, for 90 days after it stopped.");
    expect(rowOf(host, "older.acme.example").textContent).toContain("It no longer answers.");
    expect(rowOf(host, "older.acme.example").textContent).not.toContain("sends visitors on");
  });

  it("marks the short path the server names by its place in the list, and names the app that took a word", async () => {
    const { host, sent } = await open({
      "GET /api/admin/domains": newerListing([main]),
      "GET /api/admin/paths": { paths: [{ alias: "helpdesk", target: "/crm/", works: false, taken_by: "helpdesk" }, { alias: "desk", target: "/crm/", works: false, taken_by: null }], limit: 50, taken: TAKEN },
      "PUT /api/admin/paths": () => json(422, { error: "validation_failed", message: "Please correct the highlighted fields", fields: [{ field: "paths", message: "must lead to a page of this workspace", row: ["paths", 1] }] }),
    });
    const card = host.querySelector('section[aria-labelledby="paths-head"]') as HTMLElement;
    expect(card.textContent).toContain("Helpdesk now uses /helpdesk, so its page opens there and this short path does nothing.");
    expect(card.textContent).toContain("An app now uses /desk, so its page opens there and this short path does nothing.");
    await click(button(card, "Remove short path 2"));
    await click(button(card, "Remove short path 1"));
    const alias = (n: number) => card.querySelector<HTMLInputElement>(`[aria-label="Short path ${n}"]`)!;
    const target = (n: number) => card.querySelector<HTMLInputElement>(`[aria-label="Where short path ${n} leads"]`)!;
    for (let n = 1; n <= 3; n++) await click(button(card, "Add a short path"));
    await type(alias(1), "q4-sales");
    await type(target(1), "/crm/");
    // Row 2 stays blank: it is not sent, so the server's place 1 is row 3 here.
    await type(alias(3), "help");
    await type(target(3), "/crm/x");
    await act(async () => void card.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    expect(sent[0]!.body).toEqual({ paths: [{ alias: "q4-sales", target: "/crm/" }, { alias: "help", target: "/crm/x" }] });
    expect(alias(3).getAttribute("aria-invalid")).toBe("true");
    expect(alias(1).getAttribute("aria-invalid")).toBeNull();
    expect(document.getElementById(alias(3).getAttribute("aria-describedby")!)!.textContent).toBe("must lead to a page of this workspace");
    expect(document.activeElement).toBe(alias(3));
  });
});

describe("an older server, which sends none of the newer fields", () => {
  it("works as before: the list, checking, adding, changing and removing", async () => {
    const { host, sent } = await open({
      "GET /api/admin/domains": listing([main, sales, pending]),
      [`POST /api/admin/domains/${OWN}/check`]: { host: OWN, answers: false },
    });
    expect(asked("/api/admin/usage")).toBe(true);
    const own = rowOf(host, OWN);
    expect(own.querySelector(".badge")!.textContent).toBe("Waiting for the domain");
    expect(own.textContent).toContain("Point it at edge.ferrum.test with a CNAME record, then check it.");
    expect(host.textContent).not.toContain("DNS record");
    expect(rowOf(host, SALES).textContent).toContain("The workspace, landing on CRM");
    await click(button(own, "Check now"));
    expect(toasts(host)).toContain("erp.acme.example does not point here yet");

    await click(button(host, "Add an address"));
    expect(dialog().textContent).not.toContain("What this address does");
    await click(field("A domain of your own"));
    expect(dialog().textContent).not.toContain("DNS record");
    await click(button(dialog(), "Cancel"));
    await click(button(rowOf(host, SALES), "Change"));
    expect(dialog().textContent).not.toContain("What this address does");
    expect(field("Label")).toBeTruthy();
    await click(button(dialog(), "Cancel"));

    await menu(host, SALES, "Remove…");
    expect(dialog().textContent).toContain("People already signed in on it keep working there until its leaving period ends");
    await click(button(dialog(), "Cancel"));
    expect(sent.map((s) => s.path)).toEqual([`/api/admin/domains/${OWN}/check`]);
  });
});

describe("a name under the base", () => {
  it("is one part of an address: 63 characters at most with the workspace's own", () => {
    expect(nameProblem("a".repeat(30), `{name}--${"s".repeat(30)}.ferrum.test`, [])).toBeNull();
    expect(nameProblem("a".repeat(30), `{name}--${"s".repeat(32)}.ferrum.test`, [])).toBe("This name is too long for this workspace's addresses: use a shorter one.");
    expect(nameProblem("a".repeat(31), "{name}--beta.ferrum.test", [])).toBe("Use 1 to 30 lowercase letters, digits or single hyphens, not at either end.");
    expect(nameProblem("-sales", "{name}--beta.ferrum.test", [])).not.toBeNull();
  });
});
