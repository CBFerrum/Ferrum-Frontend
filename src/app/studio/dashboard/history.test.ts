import { describe, expect, it } from "vitest";
import { mergeRecord, record, redo, stableJson, start, undo } from "./history";

describe("undo and redo", () => {
  it("steps back and forward, and a new change drops the redo steps", () => {
    let h = start({ label: "a" });
    h = record(h, { label: "b" });
    h = record(h, { label: "c" });
    h = undo(h);
    expect(h.present).toEqual({ label: "b" });
    h = redo(h);
    expect(h.present).toEqual({ label: "c" });
    h = record(undo(h), { label: "d" });
    expect(h.future).toEqual([]);
    expect(undo(undo(undo(h))).present).toEqual({ label: "a" });
  });

  it("compares values whatever the order of their keys", () => {
    expect(stableJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(stableJson({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }));
    expect(record(start({ a: 1, b: 2 }), { b: 2, a: 1 }).past).toEqual([]);
  });

  it("keeps typing in one field as one step, and ignores no-op changes", () => {
    let h = start("");
    h = record(h, "S", "label", 1000);
    h = record(h, "Sa", "label", 1500);
    h = record(h, "Sal", "label", 2000);
    expect(h.past).toEqual([""]);
    h = record(h, "Sale", "label", 4000); // a pause: a new step
    expect(h.past).toEqual(["", "Sal"]);
    expect(record(h, "Sale", "other")).toBe(h);
  });
});

describe("rebasing onto a newer version", () => {
  it("keeps my changes, takes theirs, and reports fields both changed", () => {
    const base = { version: 1, label: "Sales", description: "x", refresh_interval: 0 };
    const mine = { ...base, label: "Sales (mine)", refresh_interval: 60 };
    const theirs = { ...base, version: 2, description: "theirs", refresh_interval: 300 };
    expect(mergeRecord(base, mine, theirs)).toEqual({
      value: { version: 2, label: "Sales (mine)", description: "theirs", refresh_interval: 60 },
      conflicts: ["refresh_interval"],
    });
  });

  it("lets a field merge itself", () => {
    const merged = mergeRecord({ list: [1] }, { list: [1, 2] }, { list: [0, 1] }, { list: (b, m, t) => [...new Set([...t, ...m.filter((x) => !b.includes(x))])] });
    expect(merged.value.list).toEqual([0, 1, 2]);
  });
});
