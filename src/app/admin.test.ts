import { describe, expect, it } from "vitest";
import { conditionValues, exportGone, GROUPS, size, TABS } from "./Admin";

describe("permission conditions", () => {
  it("types the values typed for a field", () => {
    expect(conditionValues("select", " Individual, Company ,")).toEqual(["Individual", "Company"]);
    expect(conditionValues("check", "false")).toEqual([false]);
    expect(conditionValues("int", "3, x, 4")).toEqual([3, 4]);
  });
});

describe("sizes", () => {
  it("reads as the largest unit under 1024", () => {
    expect(size(0)).toMatch(/^0\s?bytes$/);
    expect(size(1536)).toMatch(/^1\.5\s?kB/);
    expect(size(10 * 1024 ** 3)).toMatch(/^10\s?GB/);
  });
});

describe("a workspace export", () => {
  const done = { status: "done" as const, result: { parts: [{ id: "p", file_name: "a.zip" }], expires_in_days: 7 }, finished_at: "2026-11-01T10:00:00Z" };
  const at = (iso: string) => new Date(iso).getTime();

  it("is there for the days it is kept", () => {
    expect(exportGone(done, at("2026-11-08T09:59:00Z"))).toBe(false);
    expect(exportGone(done, at("2026-11-08T10:01:00Z"))).toBe(true);
  });

  it("is gone once an erasure deleted it, and only a finished one is", () => {
    expect(exportGone({ ...done, result: { ...done.result, deleted: "erasure" } }, at("2026-11-01T11:00:00Z"))).toBe(true);
    expect(exportGone({ ...done, status: "running" }, at("2026-12-01T00:00:00Z"))).toBe(false);
  });
});

describe("the administration navigation", () => {
  it("lists every section once, under a group", () => {
    const grouped = GROUPS.flatMap((g) => g.ids);
    expect([...grouped].sort()).toEqual(TABS.map((t) => t.id).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});
