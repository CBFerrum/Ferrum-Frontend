import { describe, expect, it } from "vitest";
import type { MetaIndex, Module } from "../lib/meta";
import type { EntitySummary } from "../lib/meta";
import { navIcon } from "../../packages/kit/src/navIconName";
import { moduleLinks, ownModule, setFrameMode, STUDIO, studioLinks } from "./Shell";

const meta = { entities: [{ name: "Lead", package: "crm" }, { name: "Customer", package: "parties" }] } as unknown as MetaIndex;
const mod = (name: string, items: string[], pkg?: string): Module => ({ name, label: name, order: 0, items, package: pkg });

describe("the records frame's sidebar", () => {
  it("shows the modules the app's packages define", () => {
    setFrameMode("app", ["parties", "selling"], { pages: true });
    expect(ownModule(mod("masters", ["Customer"], "parties"), meta)).toBe(true);
    // CRM's module lists customers too, but CRM defines it.
    expect(ownModule(mod("crm", ["Lead", "Customer"], "crm"), meta)).toBe(false);
    // From a server that does not say which package defines a module: by the entities it lists.
    expect(ownModule(mod("crm", ["Lead", "Customer"]), meta)).toBe(true);
    setFrameMode("classic");
    expect(ownModule(mod("crm", ["Lead"], "crm"), meta)).toBe(true);
  });

  it("shows Studio's pages where they are among the frame's routes and Studio is the app's", () => {
    setFrameMode("app", ["parties"], { pages: true });
    expect(ownModule(mod(STUDIO, [], STUDIO), meta)).toBe(false);
    setFrameMode("app", ["parties", STUDIO], { pages: true });
    expect(ownModule(mod(STUDIO, [], STUDIO), meta)).toBe(true);
    setFrameMode("app", [STUDIO]);
    expect(ownModule(mod(STUDIO, [], STUDIO), meta)).toBe(false);
    setFrameMode("classic");
    expect(ownModule(mod(STUDIO, [], STUDIO), meta)).toBe(true);
  });
});

describe("a workspace's own menu's page", () => {
  it("shows the modules it names and nothing else, whatever their packages", () => {
    setFrameMode("app", ["tenant"], { pages: true, modules: ["x_grc"] });
    expect(ownModule({ ...mod("x_grc", ["XRisk"], "tenant") }, meta)).toBe(true);
    expect(ownModule(mod("x_other", ["XRisk"], "tenant"), meta)).toBe(false);
    expect(ownModule(mod("crm", ["Lead"], "crm"), meta)).toBe(false);
    expect(ownModule(mod(STUDIO, [], STUDIO), meta)).toBe(false);
    setFrameMode("app", ["tenant"], { pages: true });
    expect(ownModule(mod("x_other", ["XRisk"], "tenant"), meta)).toBe(true);
    setFrameMode("classic");
  });
});

describe("the sidebar's rows carry what their icon is chosen from", () => {
  it("gives every row an icon: an entity by its stable name and kind, a report as a report, Studio's pages as declared", () => {
    const readable = new Map([["SalesInvoice", { name: "SalesInvoice", label_plural: "Sales invoices", kind: "document", submittable: true }], ["Setup", { name: "Setup", label_plural: "Setups", kind: "settings", submittable: false }]] as unknown as [string, EntitySummary][]);
    const rows = moduleLinks(mod("selling", ["SalesInvoice", "Setup", "report:aging"]), readable, new Map([["aging", "Aging"]]));
    expect(rows.map((r) => navIcon(r))).toEqual(["receipt", "settings", "chart-column"]);
    expect(studioLinks(null).map((r) => navIcon(r))).toEqual(["chart-column", "layout-dashboard", "panel-top", "square-check", "play"]);
    expect(rows.concat(studioLinks(null)).every((r) => navIcon(r).length > 0)).toBe(true);
  });
  it("uses the icon an entity declares", () => {
    const readable = new Map([["Lead", { name: "Lead", label_plural: "Leads", kind: "master", submittable: false, icon: "bell" }]] as unknown as [string, EntitySummary][]);
    expect(navIcon(moduleLinks(mod("crm", ["Lead"]), readable, new Map())[0]!)).toBe("bell");
  });
});
