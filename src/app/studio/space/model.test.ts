import { describe, expect, it } from "vitest";
import { parseApiError } from "@/lib/api";
import type { EntitySummary, Module } from "@/lib/meta";
import { fieldIssues, type ResolvedWidget, type SpaceBlock, type SpaceRecord } from "@/lib/studio";
import {
  blockIssues,
  blockIssuesAt,
  blockTitle,
  cleanBlock,
  commit,
  draftFromRecord,
  draftIssues,
  emptyDraft,
  filterInput,
  filterKind,
  filterValue,
  initialValue,
  isComplete,
  listHref,
  newBlock,
  placeIssues,
  rebase,
  recordBody,
  redo,
  retarget,
  sameDraft,
  SHORTCUT_TARGETS,
  spanClass,
  starterSpace,
  startHistory,
  targetOf,
  undo,
  urlTarget,
  widgetEntities,
  widthOf,
  type SpaceDraft,
} from "./model";

const keys = () => {
  let n = 0;
  return () => `k${++n}`;
};

describe("blocks", () => {
  it("saves without what the server would refuse", () => {
    const shortcut: SpaceBlock = { type: "shortcut", label: "  Unpaid  ", entity: " SalesInvoice ", filters: { status: "Unpaid" }, show_count: true, color: "", width: 3 };
    expect(cleanBlock(shortcut)).toEqual({ type: "shortcut", label: "Unpaid", entity: "SalesInvoice", filters: [["status", "=", "Unpaid"]], show_count: true, width: 3 });
    // Filters and counts belong to list shortcuts only.
    const toReport = { ...retarget(shortcut, SHORTCUT_TARGETS, "report"), report: "r1" };
    expect(cleanBlock(toReport)).toEqual({ type: "shortcut", label: "Unpaid", report: "r1", width: 3 });
    expect(cleanBlock({ type: "list", entity: "Customer", label: " ", fields: [], sort: "", limit: null })).toEqual({ type: "list", entity: "Customer" });
    expect(cleanBlock({ type: "links", label: "Docs", items: [{ label: " Invoices ", entity: "SalesInvoice", report: null }, { label: "Site", url: "https://x.test" }] })).toEqual({
      type: "links",
      label: "Docs",
      items: [
        { label: "Invoices", entity: "SalesInvoice" },
        { label: "Site", url: "https://x.test" },
      ],
    });
    expect(cleanBlock({ type: "onboarding", title: "", steps: [{ label: "Add", description: "", entity: "", filters: [["a", "=", 1]], url: "/app/e/Customer/new" }] })).toEqual({
      type: "onboarding",
      steps: [{ label: "Add", url: "/app/e/Customer/new" }],
    });
    expect(cleanBlock({ type: "heading", text: "Overview", level: null })).toEqual({ type: "heading", text: "Overview" });
    expect(cleanBlock({ type: "markdown", content: "**Hi**\n\n" })).toEqual({ type: "markdown", content: "**Hi**" });
  });

  it("knows which target a shortcut or link opens", () => {
    expect(targetOf({ entity: "" }, SHORTCUT_TARGETS)).toBe("entity");
    expect(targetOf({ entity: null, dashboard: "" }, SHORTCUT_TARGETS)).toBe("dashboard");
    expect(targetOf({}, SHORTCUT_TARGETS)).toBe("entity");
    expect(retarget({ type: "shortcut", label: "x", entity: "A" }, SHORTCUT_TARGETS, "url")).toEqual({ type: "shortcut", label: "x", url: "" });
  });

  it("checks blocks as the server does", () => {
    const paths = (b: SpaceBlock) => blockIssues(b).map((i) => i.path);
    expect(paths(newBlock("shortcut"))).toEqual(["label", "entity"]);
    expect(paths({ type: "shortcut", label: "Site", url: "javascript:alert(1)" })).toEqual(["url"]);
    expect(paths({ type: "shortcut", label: "Site", url: "//evil.test" })).toEqual(["url"]);
    expect(paths({ type: "shortcut", label: "Ok", entity: "Lead", color: "red;" })).toEqual(["color"]);
    expect(paths({ type: "shortcut", label: "Ok", entity: "Lead", filters: [["", "=", 1], ["status", "=", ""], ["owner", "is", "set"]] })).toEqual(["filters[0]", "filters[1]"]);
    expect(paths({ type: "links", label: "L", items: [{ label: "", builtin: "" }] })).toEqual(["items[0].label", "items[0].builtin"]);
    expect(paths({ type: "links", label: "L", items: [] })).toEqual(["items"]);
    expect(paths({ type: "list", entity: "Lead", limit: 51, fields: Array.from({ length: 13 }, (_, i) => `f${i}`) })).toEqual(["fields", "limit"]);
    expect(paths({ type: "heading", text: "x".repeat(201), level: 4 as 1 })).toEqual(["text", "level"]);
    expect(paths({ type: "markdown", content: "x".repeat(20_001) })).toEqual(["content"]);
    expect(paths({ type: "onboarding", steps: [] })).toEqual(["steps"]);
    expect(paths({ type: "chart", chart: "", width: 13 })).toEqual(["width", "chart"]);
    expect(isComplete({ type: "card", card: "c1" })).toBe(true);
    expect(isComplete(newBlock("list"))).toBe(false);
  });

  it("names blocks for the editor and screen readers", () => {
    expect(blockTitle({ type: "shortcut", label: "Unpaid", entity: "SalesInvoice" })).toBe("Shortcut: Unpaid");
    expect(blockTitle({ type: "list", entity: "SalesInvoice" }, { entity: () => "Sales Invoices" })).toBe("Quick list: Sales Invoices");
    expect(blockTitle({ type: "chart", chart: "c1" }, { record: (id) => (id === "c1" ? "Revenue" : undefined) })).toBe("Chart: Revenue");
    expect(blockTitle({ type: "markdown", content: "x" })).toBe("Text");
  });

  it("lays blocks out by width", () => {
    expect(widthOf({ type: "shortcut" })).toBe(3);
    expect(widthOf({ type: "chart", width: 12 })).toBe(12);
    expect(widthOf({ type: "card", width: 40 })).toBe(12);
    expect(spanClass(3)).toBe("col-span-6 @xl:col-span-4 @4xl:col-span-3");
    expect(spanClass(6)).toBe("col-span-12 @xl:col-span-6 @4xl:col-span-6");
    expect(spanClass(8)).toBe("col-span-12 @xl:col-span-12 @4xl:col-span-8");
  });
});

describe("links", () => {
  it("keeps app addresses inside the app", () => {
    expect(urlTarget("/app/e/SalesInvoice?f.status=Paid")).toEqual({ to: "/e/SalesInvoice?f.status=Paid" });
    expect(urlTarget("/app")).toEqual({ to: "/" });
    expect(urlTarget("/files/abc")).toEqual({ href: "/files/abc", external: false });
    expect(urlTarget("https://erp.test/app/r/payables", "https://erp.test")).toEqual({ to: "/r/payables" });
    expect(urlTarget("https://docs.test/guide", "https://erp.test")).toEqual({ href: "https://docs.test/guide", external: true });
  });

  it("opens lists with the filters a shortcut counts", () => {
    expect(listHref("SalesInvoice")).toBe("/e/SalesInvoice");
    expect(listHref("SalesInvoice", { status: "Unpaid", is_return: false })).toBe("/e/SalesInvoice?f.status=Unpaid&f.is_return=0");
    expect(listHref("SalesInvoice", [["posting_date", ">=", "2026-10-01"], ["posting_date", "<=", "2026-10-31"]])).toBe("/e/SalesInvoice?f.posting_date=2026-10-01..2026-10-31");
    // Anything the list cannot show itself travels whole.
    const href = listHref("SalesInvoice", [["status", "=", "Unpaid"], ["grand_total", ">", "1000"]]);
    const sp = new URLSearchParams(href.split("?")[1]);
    expect(sp.get("f.status")).toBe("Unpaid");
    expect(JSON.parse(sp.get("filters")!)).toEqual([["status", "=", "Unpaid"], ["grand_total", ">", "1000"]]);
  });

  it("lists the entities a space shows, for live refreshes", () => {
    const widgets = [
      { type: "shortcut", label: "A", entity: "SalesInvoice", count: 2 },
      { type: "list", entity: "Customer", fields: [], rows: [] },
      { type: "onboarding", steps: [{ label: "x", entity: "Lead", done: false }, { label: "y" }] },
      { type: "card", card: { label: "C", base_entity: "SalesOrder", format: "int" }, value: 1, drill_down: { entity: "SalesOrder", filters: [] }, meta: {} },
      { type: "chart", chart: { label: "x", chart_type: "bar" }, error: { error: "invalid", message: "no" } },
      { type: "markdown", content: "" },
    ] as unknown as ResolvedWidget[];
    expect(widgetEntities(widgets)).toEqual(["Customer", "Lead", "SalesInvoice", "SalesOrder"]);
  });
});

const record: SpaceRecord = {
  id: "s1",
  version: 3,
  label: "Selling",
  icon: "shopping-cart",
  module: "selling",
  sequence: 2,
  sharing: "roles",
  roles: [{ id: "r1", role: "Sales User" }],
  description: null,
  blocks: [
    { type: "shortcut", label: "Unpaid", entity: "SalesInvoice", filters: { status: "Unpaid" }, show_count: true },
    { type: "markdown", content: "Hi", width: 6 },
  ],
};

describe("drafts", () => {
  it("round-trips a record", () => {
    const d = draftFromRecord(record, keys());
    expect(d.blocks.map((b) => b.key)).toEqual(["k1", "k2"]);
    // Filters are edited as rows.
    expect(d.blocks[0].block).toMatchObject({ filters: [["status", "=", "Unpaid"]] });
    expect(recordBody(d)).toEqual({
      label: "Selling",
      icon: "shopping-cart",
      module: "selling",
      sequence: 2,
      sharing: "roles",
      roles: [{ role: "Sales User" }],
      description: null,
      blocks: [
        { type: "shortcut", label: "Unpaid", entity: "SalesInvoice", filters: [["status", "=", "Unpaid"]], show_count: true },
        { type: "markdown", content: "Hi", width: 6 },
      ],
    });
    expect(sameDraft(d, { ...d, label: " Selling " })).toBe(true);
    expect(sameDraft(d, { ...d, blocks: [...d.blocks].reverse() })).toBe(false);
    // Roles only travel when the space is shared with roles; switching away clears them.
    expect(recordBody({ ...d, sharing: "everyone" }).roles).toEqual([]);
  });

  it("finds what to fix before saving", () => {
    const d: SpaceDraft = { ...emptyDraft(), sharing: "roles", blocks: [{ key: "a", block: { type: "markdown", content: "ok" } }, { key: "b", block: newBlock("chart") }] };
    const issues = draftIssues(d);
    expect(issues.map((i) => i.path)).toEqual(["label", "roles", "blocks[1].chart"]);
    expect(blockIssuesAt(issues, 1)).toEqual([{ path: "chart", message: "Choose a chart" }]);
  });

  it("places the server's errors on the blocks they concern", () => {
    const err = parseApiError(422, {
      error: "validation_failed",
      message: "Please correct the highlighted fields",
      fields: [
        { field: "blocks", message: "[0]: a shortcut opens exactly one of: entity, report, dashboard, url" },
        { field: "blocks", message: "[1].width must be a whole number from 1 to 12" },
        { field: "blocks", message: "Dashboard Chart not found: c9" },
        { field: "roles", message: "unknown roles: Nope" },
      ],
    });
    const blocks: SpaceBlock[] = [{ type: "shortcut", label: "x" }, { type: "markdown", content: "" }, { type: "chart", chart: "c9" }];
    const placed = placeIssues(fieldIssues(err), blocks);
    expect(placed.map((i) => i.path)).toEqual(["blocks[0]", "blocks[1].width", "blocks[2]", "roles"]);
    expect(placed[2].message).toMatch(/^Dashboard Chart not found: it was deleted/);
    expect(blockIssuesAt(placed, 1)).toEqual([{ path: "width", message: "Must be a whole number from 1 to 12" }]);
  });
});

describe("starter spaces", () => {
  const entities = [
    { name: "SalesOrder", label: "Sales Order", label_plural: "Sales Orders", kind: "document" },
    { name: "SalesInvoice", label: "Sales Invoice", label_plural: "Sales Invoices", kind: "document" },
    { name: "Customer", label: "Customer", label_plural: "Customers", kind: "master" },
    { name: "SalesInvoiceItem", label: "Item", label_plural: "Items", kind: "child" },
  ] as EntitySummary[];
  const selling: Module = { name: "selling", label: "Selling", icon: "shopping-cart", order: 40, items: ["SalesOrder", "SalesInvoice", "Customer", "SalesInvoiceItem", "Hidden", "report:sales_register"] };

  it("counts documents, links the rest and shows recent records", () => {
    const s = starterSpace(selling, entities, [{ name: "sales_register", label: "Sales Register" }]);
    expect(s).toMatchObject({ label: "Selling", icon: "shopping-cart", module: "selling" });
    expect(s.blocks).toEqual([
      { type: "shortcut", label: "Sales Orders", entity: "SalesOrder", show_count: true },
      { type: "shortcut", label: "Sales Invoices", entity: "SalesInvoice", show_count: true },
      { type: "links", label: "Lists", items: [{ label: "Customers", entity: "Customer" }] },
      { type: "links", label: "Reports", items: [{ label: "Sales Register", builtin: "sales_register" }] },
      { type: "list", label: "Recent sales orders", entity: "SalesOrder", sort: "updated_at desc", limit: 5 },
    ]);
    // Every generated block is valid as saved.
    expect(s.blocks.flatMap(blockIssues)).toEqual([]);
  });

  it("starts empty for a module the viewer cannot read", () => {
    expect(starterSpace({ ...selling, items: ["Hidden"] }, entities).blocks).toEqual([]);
  });
});

describe("filter values", () => {
  it("types what was entered", () => {
    expect(filterKind("currency")).toBe("number");
    expect(filterKind("email")).toBe("text");
    expect(filterValue("int", "=", " 42 ")).toBe(42);
    expect(filterValue("int", "=", "4.2")).toBe("4.2");
    expect(filterValue("currency", ">", "1000.50")).toBe("1000.50");
    expect(filterValue("data", "like", "acme")).toBe("%acme%");
    // Typing keeps its spaces ("acme " on the way to "acme corp"); saving trims them.
    expect(filterValue("data", "=", "acme ")).toBe("acme ");
    expect(filterInput("data", "like", filterValue("data", "like", "acme "))).toBe("acme ");
    expect(cleanBlock({ type: "list", entity: "Lead", filters: [[" status ", "=", " Open "], ["name", "like", "% acme %"]] })).toEqual({
      type: "list",
      entity: "Lead",
      filters: [["status", "=", "Open"], ["name", "like", "%acme%"]],
    });
    expect(blockIssues({ type: "list", entity: "Lead", filters: [["status", "=", "  "], ["name", "like", "% %"]] }).map((i) => i.path)).toEqual(["filters[0]", "filters[1]"]);
    expect(filterValue("datetime", ">=", "2026-10-01")).toBe("2026-10-01T00:00:00.000Z");
    expect(filterValue("datetime", "<=", "2026-10-31")).toBe("2026-10-31T23:59:59.999Z");
    expect(filterInput("data", "like", "%acme%")).toBe("acme");
    expect(filterInput("datetime", "<=", "2026-10-31T23:59:59.999Z")).toBe("2026-10-31");
    expect(initialValue("select", "in")).toEqual([]);
    expect(initialValue("check", "=")).toBe(true);
    expect(initialValue("text", "is")).toBe("set");
  });
});

describe("undo history", () => {
  it("undoes and redoes, typing into one field being one step", () => {
    let h = startHistory("a");
    h = commit(h, "ab", "label", 1000);
    h = commit(h, "abc", "label", 1500); // same field, a moment later: one step
    h = commit(h, "abcd", "other", 1600);
    expect(h.past).toEqual(["a", "abc"]);
    h = undo(h);
    expect(h.present).toBe("abc");
    h = undo(h);
    expect(h.present).toBe("a");
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toBe("abc");
    // A new edit drops what could be redone.
    h = commit(h, "x", undefined, 5000);
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it("starts a new step after a pause", () => {
    let h = startHistory(0);
    h = commit(h, 1, "n", 0);
    h = commit(h, 2, "n", 5000);
    expect(h.past).toEqual([0, 1]);
  });
});

describe("rebase", () => {
  const base = draftFromRecord(record, keys());
  const block = (content: string) => ({ key: content, block: { type: "markdown" as const, content } });

  it("keeps my edits and takes theirs where I changed nothing", () => {
    const mine = { ...base, label: "Sales home" };
    const theirs = { ...base, icon: "store", blocks: [...base.blocks, block("theirs")] };
    const { merged, conflicts } = rebase(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.label).toBe("Sales home");
    expect(merged.icon).toBe("store");
    expect(merged.blocks.map((b) => b.block.type)).toEqual(["shortcut", "markdown", "markdown"]);
  });

  it("reports parts both changed, keeping mine", () => {
    const mine = { ...base, blocks: [block("mine")], sharing: "everyone" as const };
    const theirs = { ...base, blocks: [block("theirs")], sharing: "everyone" as const };
    const { merged, conflicts } = rebase(base, mine, theirs);
    expect(conflicts).toEqual(["Blocks"]);
    expect(merged.blocks[0].block).toEqual({ type: "markdown", content: "mine" });
  });
});
