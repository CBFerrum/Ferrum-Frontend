import { describe, expect, it } from "vitest";
import { byParent, permissionLines, sectionLabel, updateBrings, updateLabel } from "./Apps";

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
