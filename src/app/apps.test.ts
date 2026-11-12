import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { byParent, permissionLines, sectionLabel, unmetRequirement, UpdateFirst, updateBrings, updateLabel } from "./Apps";

describe("add-ons", () => {
  it("follow the app they extend, at any depth", () => {
    const apps = [
      { id: "editor-x", parent: "office" },
      { id: "crm", parent: null },
      { id: "office" },
      { id: "x-plugin", parent: "editor-x" },
      { id: "orphan", parent: "not-installed" },
    ];
    expect(byParent(apps).map(({ app, depth }) => `${app.id}:${depth}`)).toEqual(["crm:0", "office:0", "editor-x:1", "x-plugin:2", "orphan:0"]);
  });
});

describe("permission summaries", () => {
  it("labels sections", () => {
    expect(sectionLabel("http_hosts")).toBe("Http hosts");
    expect(sectionLabel("native")).toBe("Built into the server");
    expect(sectionLabel("services")).toBe("Runs outside Ferrum, as an account of its own, at");
  });
  it("describes lists of grants, plain lists and maps", () => {
    expect(permissionLines([{ entity: "Customer", read: true, write: false, create: true }])).toEqual(["Customer — read, create"]);
    expect(permissionLines(["api.example.com"])).toEqual(["api.example.com"]);
    expect(permissionLines({ sockets: ["/ocpp/*"], public: true })).toEqual(["sockets: /ocpp/*", "public: true"]);
    expect(permissionLines(null)).toEqual([]);
    expect([permissionLines(true, "native"), permissionLines(false, "native"), permissionLines(true, "other")]).toEqual([["It runs in the server itself, not in a sandbox"], [], ["Yes"]]);
    expect(permissionLines([{ path: "/status", public: true }])).toEqual(["/status — public"]);
  });
});

describe("what an update brings", () => {
  it("a newer version reads as an update to it, and says what it brings when the server knows", () => {
    const u = { version: "1.2.0", packages: ["crm 0.2.0 → 0.4.0", "hr 0.9.0 → 0.11.1"] };
    expect(updateLabel("1.1.0", u)).toBe("Update to 1.2.0");
    expect(updateBrings(u)).toBe("Brings: crm 0.2.0 → 0.4.0, hr 0.9.0 → 0.11.1");
  });
  it("the same version with older packages is brought up to date, not updated to what is installed", () => {
    const u = { version: "1.1.0", packages: ["crm 0.2.0 → 0.4.0"] };
    expect(updateLabel("1.1.0", u)).toBe("Bring up to date");
    expect(updateBrings(u)).toBe("Brings: crm 0.2.0 → 0.4.0");
  });
  it("without packages (an older server) there is no line, and the button is as before", () => {
    expect(updateBrings({ version: "1.2.0" })).toBeNull();
    expect(updateBrings({ version: "1.2.0", packages: [] })).toBeNull();
    expect(updateBrings(null)).toBeNull();
    expect(updateLabel("1.1.0", { version: "1.2.0" })).toBe("Update to 1.2.0");
  });
});

describe("an app the workspace's installed apps are too old for", () => {
  // The refusal as GET /api/admin/apps/pos/plan answered it (422) on the first browser walk.
  const said = "cannot install: pos 0.7.3 requires erp >=0.26, but erp 0.24.1 is installed; upgrade erp first";

  it("is read from the server's words: which app, what it needs, what is installed", () => {
    expect(unmetRequirement(said)).toEqual({ app: "pos", version: "0.7.3", dep: "erp", need: ">=0.26", have: "0.24.1" });
    expect(unmetRequirement("pos needs erp, which is disabled in this workspace; enable it first")).toBeNull();
  });

  it("says what must be updated first and offers that update, with no install button", () => {
    const need = unmetRequirement(said)!;
    const html = renderToString(createElement(UpdateFirst, { need, installed: [{ id: "erp", name: "ERP", update: { version: "0.26.0" } }], onFirst: () => {} }));
    expect(html).toContain("pos 0.7.3 needs ERP &gt;=0.26, and this workspace has ERP 0.24.1.");
    expect(html).toContain("Update ERP first, then install it.");
    expect(html).toContain("Update ERP to 0.26.0");
    expect(html).not.toContain("Install");
  });

  it("says so, with no button, where this server has nothing newer to update to", () => {
    const html = renderToString(createElement(UpdateFirst, { need: unmetRequirement(said)!, installed: [{ id: "erp", name: "ERP", update: null }], onFirst: () => {} }));
    expect(html).toContain("This server has no newer ERP to update to");
    expect(html).not.toContain("<button");
  });
});
