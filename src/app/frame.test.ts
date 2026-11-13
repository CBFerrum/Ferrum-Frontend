import { describe, expect, it } from "vitest";
import type { MetaIndex, Module } from "../lib/meta";
import type { EntitySummary } from "../lib/meta";
import { navIcon } from "../../packages/kit/src/navIconName";
import { moduleLinks, ownModule, setFrameMode, STUDIO, studioLinks } from "./Shell";
import { resetBootstrap } from "@ferrum/client";

/** The page's bootstrap as the server hands it (`__FERRUM_BOOTSTRAP__`); null: none. */
function setBootstrap(b: unknown) {
  (globalThis as { __FERRUM_BOOTSTRAP__?: unknown }).__FERRUM_BOOTSTRAP__ = b ?? undefined;
  resetBootstrap();
}

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
  it("gives every row an icon: an entity by its stable name and kind, a report by what it is about, Studio's pages as declared", () => {
    const readable = new Map([["SalesInvoice", { name: "SalesInvoice", label_plural: "Sales invoices", kind: "document", submittable: true }], ["Setup", { name: "Setup", label_plural: "Setups", kind: "settings", submittable: false }]] as unknown as [string, EntitySummary][]);
    const rows = moduleLinks(mod("selling", ["SalesInvoice", "Setup", "report:aging"]), readable, new Map([["aging", "Aging"]]));
    expect(rows.map((r) => navIcon(r))).toEqual(["receipt", "settings", "hourglass"]);
    expect(studioLinks(null).map((r) => navIcon(r))).toEqual(["chart-column", "layout-dashboard", "panel-top", "square-check", "play"]);
    expect(rows.concat(studioLinks(null)).every((r) => navIcon(r).length > 0)).toBe(true);
  });
  it("uses the icon an entity declares", () => {
    const readable = new Map([["Lead", { name: "Lead", label_plural: "Leads", kind: "master", submittable: false, icon: "bell" }]] as unknown as [string, EntitySummary][]);
    expect(navIcon(moduleLinks(mod("crm", ["Lead"]), readable, new Map())[0]!)).toBe("bell");
  });
});

describe("an app's own pages in its module", () => {
  const readable = new Map([["SocialPost", { name: "SocialPost", label_plural: "Posts", kind: "document", submittable: false }], ["SocialFeed", { name: "SocialFeed", label_plural: "Feeds", kind: "master", submittable: false }]] as unknown as [string, EntitySummary][]);
  const social: Module = {
    ...mod("social", ["SocialPost", "SocialFeed"], "social"),
    pages: [
      { app: "social", id: "compose", path: "social/compose", label: "Compose", icon: "square-pen" },
      { app: "social", id: "calendar", path: "social/calendar", label: "Calendar", icon: "calendar" },
      { app: "social", id: "numbers", path: "social/numbers", label: "Numbers", icon: "bar-chart-3", after: "SocialFeed" },
      { app: "social", id: "library", path: "social/library", label: "Library", icon: "no-such-icon", after: "Gone" },
    ],
  };

  it("puts each row after the item it names, else first in the order given, routed inside the app's own frame", () => {
    setBootstrap({ app: { id: "social", entry: "social", routes: { social: "/social/" } } });
    setFrameMode("app", ["social"]);
    const rows = moduleLinks(social, readable, new Map());
    expect(rows.map((r) => r.label)).toEqual(["Compose", "Calendar", "Library", "Posts", "Feeds", "Numbers"]);
    expect(rows[0]).toMatchObject({ to: "/compose", kind: "page" });
    expect(rows[0]!.href).toBeUndefined();
    // Every row has an icon; an unknown one falls back to a page's, an older name to its current one.
    expect(rows.map((r) => navIcon(r))).toEqual(["square-pen", "calendar", "app-window", "share-2", "rss", "chart-column"]);
  });

  it("loads the page from anywhere else, and a module without rows is as it was", () => {
    setBootstrap({ app: { id: "crm", entry: "crm", routes: { crm: "/crm/" } } });
    setFrameMode("classic");
    expect(moduleLinks(social, readable, new Map())[0]).toMatchObject({ to: "/social/compose", href: "/social/compose" });
    expect(moduleLinks({ ...social, pages: undefined }, readable, new Map()).map((r) => r.to)).toEqual(["/e/SocialPost", "/e/SocialFeed"]);
    setBootstrap(null);
  });
});
