// @vitest-environment jsdom
// A link picker whose metadata says `link_filters: { company: { from: "company" } }`: what it sends, what it says while the
// field it reads is empty, and what it does with a chosen record when that field changes.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comparedFields, resolveLinkFilters } from "../lib/linkFilters";
import type { EntityMeta } from "../lib/meta";
import { LinkInput } from "./widgets";

const get = vi.fn();
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), api: { get: (...a: unknown[]) => get(...a) } }));
const warehouse = {
  name: "Warehouse", label: "Warehouse", title_field: "name",
  fields: [{ name: "name", label: "Name", type: "data" }, { name: "company", label: "Company", type: "link", to: "Company" }],
} as unknown as EntityMeta;
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useEntityMeta: () => ({ data: warehouse, isLoading: false }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  get.mockReset();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const filters = { company: { from: "company" } };
const labelOf = (p: string) => (p === "company" ? "Company" : undefined);

function mount(props: { doc: Record<string, unknown>; parent?: Record<string, unknown>; value?: string | null; linkFilters?: Record<string, unknown>; onChange?: (v: string | null) => void }) {
  return act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <LinkInput to="Warehouse" id="w" value={props.value ?? null} linkFilters={props.linkFilters ?? filters} scope={{ doc: props.doc, parent: props.parent, labelOf }} onChange={props.onChange ?? (() => {})} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
const search = () => get.mock.calls.filter((c) => c[0] === "/api/v1/Warehouse" || String(c[0]).endsWith("/Warehouse")).map((c) => c[1] as Record<string, string>);
const openPicker = async () => {
  await act(async () => void host.querySelector<HTMLInputElement>("input")!.click());
  await wait(320);
};

describe("resolving link filters", () => {
  it("keeps literals, reads a from in the record, and parent. in the parent", () => {
    const r = resolveLinkFilters({ kind: "stock", company: { from: "company" }, branch: { from: "parent.branch" } }, { doc: { company: "C1" }, parent: { branch: "B1" } });
    expect(r.applied).toEqual({ kind: "stock", company: "C1", branch: "B1" });
    expect(r.required).toEqual({ company: "C1", branch: "B1" });
    expect(r.waiting).toEqual([]);
  });
  it("leaves out a from whose source is empty and names the field to choose first", () => {
    const r = resolveLinkFilters(filters, { doc: { company: "" }, labelOf });
    expect(r.applied).toEqual({});
    expect(r.waiting).toEqual([{ key: "company", from: "company", label: "Company" }]);
    expect(comparedFields({ kind: "x", ...filters })).toEqual(["company"]);
  });
});

describe("the picker", () => {
  it("sends the form's value as an equality filter with the search, and asks for the compared field", async () => {
    get.mockResolvedValue({ rows: [{ id: "w1", name: "Stores", company: "C1" }] });
    await mount({ doc: { company: "C1" } });
    await openPicker();
    const last = search().at(-1)!;
    expect(JSON.parse(last.filters)).toEqual({ company: "C1" });
    expect(last.fields).toBe("id,number,name,company");
  });
  it("reads the parent's field in a child table's row", async () => {
    get.mockResolvedValue({ rows: [] });
    await mount({ doc: { qty: 1 }, parent: { company: "C9" }, linkFilters: { company: { from: "parent.company" } } });
    await openPicker();
    expect(JSON.parse(search().at(-1)!.filters)).toEqual({ company: "C9" });
  });
  it("sends no filter while the field is empty, and says which field to choose first", async () => {
    get.mockResolvedValue({ rows: [] });
    await mount({ doc: { company: null } });
    expect(host.textContent).toContain("Choose Company first");
    await openPicker();
    expect(search().at(-1)!.filters).toBeUndefined();
  });
  it("sends a literal as it is", async () => {
    get.mockResolvedValue({ rows: [] });
    await mount({ doc: {}, linkFilters: { disabled: 0 } });
    await openPicker();
    expect(JSON.parse(search().at(-1)!.filters)).toEqual({ disabled: 0 });
    expect(host.textContent).not.toContain("first");
  });
  it("clears a chosen record that does not belong to the company now chosen, and says so", async () => {
    get.mockImplementation(async (path: string) => (path.includes("/w1") ? { id: "w1", name: "Stores", company: "C1" } : { rows: [] }));
    const onChange = vi.fn();
    await mount({ doc: { company: "C1" }, value: "w1", onChange });
    await wait(20);
    expect(onChange).not.toHaveBeenCalled();
    await mount({ doc: { company: "C2" }, value: "w1", onChange });
    await wait(20);
    expect(onChange).toHaveBeenCalledWith(null, "");
    expect(host.textContent).toContain("does not belong to the Company now chosen");
  });
  it("keeps a chosen record that still matches the new value", async () => {
    get.mockImplementation(async (path: string) => (path.includes("/w1") ? { id: "w1", company: "C2" } : { rows: [] }));
    const onChange = vi.fn();
    await mount({ doc: { company: "C1" }, value: "w1", onChange });
    await mount({ doc: { company: "C2" }, value: "w1", onChange });
    await wait(20);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("shows the compared field under each choice", async () => {
    get.mockImplementation(async (path: string) => (path.includes("/Company/") ? { id: "C1", name: "Acme Co" } : { rows: [{ id: "w1", name: "Stores", company: "C1" }] }));
    await mount({ doc: { company: null } });
    await openPicker();
    await wait(20);
    expect(host.querySelector("li.option small")?.textContent).toBe("Acme Co");
  });
});
