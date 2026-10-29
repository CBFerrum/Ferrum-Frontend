import { describe, expect, it } from "vitest";
import { byParent, permissionLines, sectionLabel } from "./Apps";

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
  });
  it("describes lists of grants, plain lists and maps", () => {
    expect(permissionLines([{ entity: "Customer", read: true, write: false, create: true }])).toEqual(["Customer — read, create"]);
    expect(permissionLines(["api.example.com"])).toEqual(["api.example.com"]);
    expect(permissionLines({ sockets: ["/ocpp/*"], public: true })).toEqual(["sockets: /ocpp/*", "public: true"]);
    expect(permissionLines(null)).toEqual([]);
    expect(permissionLines([{ path: "/status", public: true }])).toEqual(["/status — public"]);
  });
});
