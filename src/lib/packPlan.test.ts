import { describe, expect, it } from "vitest";
import { MAX_PACK_BYTES, describePlan, describeResult, packFileName, readPack, travellers } from "./packPlan";

const pack = { format: "ferrum.pack/1", name: "rooms", label: "Rooms", version: 3, customizations: [], roles: [] };

describe("reading a chosen file", () => {
  it("takes a pack", () => {
    expect(readPack(JSON.stringify(pack)).pack).toEqual(pack);
  });
  it("refuses what is not JSON, not a pack, or too large", () => {
    expect(readPack("{nope").refusal).toBe("That file is not JSON.");
    expect(readPack("[1]").refusal).toContain("not a Ferrum pack");
    expect(readPack(JSON.stringify({ ...pack, format: "ferrum.pack/2" })).refusal).toContain("ferrum.pack/1");
    expect(readPack("{}", MAX_PACK_BYTES + 1).refusal).toContain("5 MiB");
    expect(readPack(JSON.stringify(pack), MAX_PACK_BYTES).pack).toBeTruthy();
  });
  it("names the download after the pack", () => {
    expect(packFileName("rooms")).toBe("rooms.pack.json");
    expect(packFileName(" My Rooms/../x ")).toBe("my-rooms-x.pack.json");
    expect(packFileName("")).toBe("workspace.pack.json");
  });
  it("offers only the workspace's own lists", () => {
    const e = (name: string, o: object) => ({ name, kind: "master", submittable: false, custom: true, ...o });
    expect(travellers([e("A", {}), e("B", { submittable: true }), e("C", { kind: "child" }), e("D", { custom: false })]).map((x) => x.name)).toEqual(["A"]);
  });
});

const section = (created: string[], changed: string[] = [], unchanged: string[] = []) => ({ created, changed, unchanged });

describe("a plan", () => {
  it("lists every section in order, with the server's warnings", () => {
    const plan = describePlan({
      name: "rooms", label: "Rooms", version: 3, digest: "sha256:ab", can_install: true, missing: [], requires: { packages: { core: "1" } },
      sections: {
        solutions: section(["Booking"]), records: section([], ["XRoom Hall"], ["XRoom Annex"]), customizations: section(["XRoom: define_entity"]),
        roles: section([]), automations: section([], [], ["Nightly"]), studio: section(["Rooms report"]),
      },
      warnings: ["The solution Booking arrives as a draft: it runs only once it is kept as a release, reviewed by a second administrator and activated."],
    });
    expect(plan.canInstall).toBe(true);
    expect(plan.needs).toEqual([["core", "1"]]);
    expect(plan.sections.map((s) => s.key)).toEqual(["customizations", "roles", "automations", "studio", "records", "solutions"]);
    expect(plan.sections[4]).toMatchObject({ label: "Reference records", changed: ["XRoom Hall"], unchanged: ["XRoom Annex"] });
    expect(plan.warnings[0]).toContain("second administrator");
  });
  it("cannot be installed when something is missing, or has no digest", () => {
    const plan = describePlan({ name: "p", label: "P", version: 1, digest: "sha256:1", can_install: false, missing: ["the package hr is not installed"], requires: { packages: { hr: "2" } } });
    expect(plan).toMatchObject({ canInstall: false, missing: ["the package hr is not installed"], sections: [], warnings: [] });
    expect(describePlan({ can_install: true }).canInstall).toBe(false);
  });
  it("shows a section the server adds later instead of dropping it", () => {
    const plan = describePlan({ digest: "d", can_install: true, sections: { roles: section(["Clerk"]), dashboards_v2: section(["Sales"], ["Ops"]), odd: "x" } });
    expect(plan.sections.map((s) => [s.key, s.label])).toEqual([["roles", "Roles"], ["dashboards_v2", "Dashboards v2"], ["odd", "Odd"]]);
    expect(plan.sections[1]).toMatchObject({ created: ["Sales"], changed: ["Ops"], unchanged: [] });
  });
});

describe("a result", () => {
  it("names the solutions that failed and links the drafts that arrived", () => {
    const r = describeResult({
      id: "i", name: "rooms", version: 3, digest: "d",
      summary: { customizations: section(["XRoom: define_entity"]), solutions: section(["Booking"]) },
      failed: [{ solution: "Billing", error: "needs the package books" }],
    });
    expect(r.failed).toEqual([{ solution: "Billing", error: "needs the package books" }]);
    expect(r).toMatchObject({ draft: true, touched: true, name: "rooms", version: 3 });
  });
  it("has no drafts or failures when the pack held none", () => {
    expect(describeResult({ name: "p", summary: { records: section([], [], ["A"]) } })).toMatchObject({ draft: false, touched: false, failed: [] });
  });
});
