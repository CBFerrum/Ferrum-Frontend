// @vitest-environment jsdom
// An action's list and row parameters (docs/app-contract.md, "Lists and rows as parameters"): rows of the declared fields, add and remove,
// the item cap, what is required, and what is sent: real JSON arrays and objects, `[]` only after rows were added and taken away.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionDef, ActionParam } from "../lib/meta";
import { ActionDialog } from "./ActionDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 10)));
const sent = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").map((c) => JSON.parse(String((c[1] as RequestInit).body)));

async function open(params: ActionParam[], doc: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (url: string) => (String(url).includes("/run") ? json(200, { ok: true }) : json(200, { rows: [] })));
  vi.stubGlobal("fetch", fetchMock);
  const action = { name: "run", label: "Run it", params } as unknown as ActionDef;
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><ActionDialog action={action} doc={doc as never} path="/api/x/run" onClose={() => {}} onDone={() => {}} /></QueryClientProvider></MemoryRouter>));
  return fetchMock;
}
const q = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const button = (name: string | RegExp) => [...document.querySelectorAll("button")].find((b) => (typeof name === "string" ? b.textContent === name || b.getAttribute("aria-label") === name : name.test(b.getAttribute("aria-label") ?? b.textContent ?? "")))!;
const click = async (name: string | RegExp) => (await act(async () => button(name).click()), flush());
const type = async (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
const submit = async () => {
  await act(async () => q<HTMLButtonElement>("button[type=submit]").click());
  await flush();
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const days: ActionParam = { name: "weekdays", label: "Weekdays", type: "list", of: "select", options: ["Monday", "Sunday"] };
const items: ActionParam = {
  name: "items", label: "Items", type: "list", max_items: 2, required: true,
  fields: [{ name: "item", label: "Item", type: "link", to: "Item", required: true }, { name: "qty", label: "Quantity", type: "decimal" }],
};
const address: ActionParam = { name: "address", label: "Address", type: "row", fields: [{ name: "street", label: "Street", type: "data", required: true }, { name: "floor", label: "Floor", type: "int" }, { name: "lift", label: "Lift", type: "check" }] };

describe("a list of selects", () => {
  it("sends an array of the chosen values, one box per value", async () => {
    const f = await open([days]);
    await click("Add");
    await click("Add");
    const boxes = [...document.querySelectorAll<HTMLSelectElement>("select")];
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual(["Weekdays 1", "Weekdays 2"]);
    await type(boxes[0], "Monday");
    await type(boxes[1], "Sunday");
    await submit();
    expect(sent(f)).toEqual([{ weekdays: ["Monday", "Sunday"] }]);
  });
  it("leaves the list out when never touched, and sends [] after rows were added and taken away", async () => {
    let f = await open([days]);
    await submit();
    expect(sent(f)).toEqual([{}]);
    act(() => root.unmount());
    root = createRoot(host);
    f = await open([days]);
    await click("Add");
    await click("Remove Weekdays 1");
    await submit();
    expect(sent(f)).toEqual([{ weekdays: [] }]);
  });
});

describe("a list of rows with a link and a decimal", () => {
  it("marks what is required, refuses a row missing it, and sends objects with the decimal as typed", async () => {
    const f = await open([items]);
    expect(q("fieldset .req")).toBeTruthy();
    await click("Add");
    await type(q<HTMLInputElement>("input[id$='-qty']"), "2.50");
    await submit();
    expect(sent(f)).toEqual([]);
    expect(document.body.textContent).toContain("is needed");
    // the link field takes its record through the picker's own value; here the prefill stands in for it
  });
  it("prefills rows from the record and sends them back as objects", async () => {
    const f = await open([items], { items: [{ item: "I-1", qty: "2.50" }] });
    await submit();
    expect(sent(f)).toEqual([{ items: [{ item: "I-1", qty: "2.50" }] }]);
  });
  it("needs at least one row when the list is required", async () => {
    const f = await open([items]);
    await submit();
    expect(sent(f)).toEqual([]);
    expect(document.body.textContent).toContain("Add at least one item");
  });
  it("respects the item cap with a plain message, and removing a row frees it", async () => {
    await open([items]);
    await click("Add");
    await click("Add");
    expect(button("Add").hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain("At most 2 items.");
    await click("Remove Items 1");
    expect(button("Add").hasAttribute("disabled")).toBe(false);
  });
});

describe("a row", () => {
  it("renders its fields inline and sends one object", async () => {
    const f = await open([address]);
    expect(document.querySelectorAll("fieldset input").length).toBe(3);
    await type(q<HTMLInputElement>("#action-address-street"), "Main St");
    await type(q<HTMLInputElement>("#action-address-floor"), "3");
    await act(async () => q<HTMLInputElement>("#action-address-lift").click());
    await submit();
    expect(sent(f)).toEqual([{ address: { street: "Main St", floor: 3, lift: true } }]);
  });
  it("is left out when untouched, even with required fields", async () => {
    const f = await open([address]);
    await submit();
    expect(sent(f)).toEqual([{}]);
  });
  it("is refused when part-filled and a required field is empty", async () => {
    const f = await open([address]);
    await type(q<HTMLInputElement>("#action-address-floor"), "3");
    await submit();
    expect(sent(f)).toEqual([]);
    expect(document.body.textContent).toContain("is needed");
  });
});
