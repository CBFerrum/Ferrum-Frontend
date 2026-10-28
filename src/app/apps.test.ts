import { describe, expect, it } from "vitest";
import { permissionLines, sectionLabel } from "./Apps";

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
