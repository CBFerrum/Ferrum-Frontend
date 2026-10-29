import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { mergePref, PrefWriter, rebasePref, samePref, type PrefIO, type PrefsMap } from "./prefs";

describe("mergePref", () => {
  const defaults = { density: "comfortable", columns: ["a"], panel: { open: true, width: 300 }, pinned: null as string | null };

  it("fills in what is not stored", () => {
    expect(mergePref(defaults, undefined)).toEqual(defaults);
    expect(mergePref(defaults, { columns: ["b", "c"] })).toEqual({ ...defaults, columns: ["b", "c"] });
  });
  it("merges nested objects key by key", () => {
    expect(mergePref(defaults, { panel: { width: 420 } }).panel).toEqual({ open: true, width: 420 });
  });
  it("ignores stored values of the wrong type, keeps keys without a default", () => {
    const v = mergePref(defaults, { density: 3, columns: "a,b", panel: [1], extra: { x: 1 }, pinned: "home" });
    expect(v).toEqual({ ...defaults, extra: { x: 1 }, pinned: "home" });
    expect(mergePref(defaults, "garbage")).toEqual(defaults);
  });
});

describe("rebasePref", () => {
  it("keeps both sides' changes to different keys", () => {
    const base = { columns: ["a"], sort: "a asc" };
    expect(rebasePref(base, { columns: ["a", "b"], sort: "a asc" }, { columns: ["a"], sort: "b desc" })).toEqual({ columns: ["a", "b"], sort: "b desc" });
  });
  it("lets this tab win where both changed the same value; arrays are values", () => {
    expect(rebasePref({ columns: ["a"] }, { columns: ["b"] }, { columns: ["c"] })).toEqual({ columns: ["b"] });
  });
  it("merges views added and removed on either side", () => {
    const v = (name: string) => ({ name });
    const base = { views: { x: v("X"), y: v("Y") } };
    const local = { views: { x: v("X"), y: v("Y"), mine: v("Mine") } }; // added one
    const remote = { views: { x: v("X 2") } }; // renamed x, deleted y
    expect(rebasePref(base, local, remote)).toEqual({ views: { x: v("X 2"), mine: v("Mine") } });
    expect(rebasePref(base, { views: { x: v("X") } }, base)).toEqual({ views: { x: v("X") } }); // a deletion here
  });
  it("applies changes over a value reset elsewhere", () => {
    expect(rebasePref({ a: 1, b: 2 }, { a: 1, b: 3 }, undefined)).toEqual({ b: 3 });
  });
  it("compares objects regardless of key order", () => {
    expect(samePref({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(samePref({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

/** A fake server with the API's versioning (an update with a stale version is a 409). */
function setup(initial: PrefsMap = {}) {
  const server: PrefsMap = structuredClone(initial);
  let cache: PrefsMap = structuredClone(initial);
  const sent: [string, unknown, number | undefined][] = [];
  // As the server: version 0 only creates; another version must match the stored one.
  const io: PrefIO = {
    async put(scope, value, version) {
      sent.push([scope, value, version]);
      const cur = server[scope];
      if (cur && cur.version !== version) throw new ApiError(409, "conflict", "changed elsewhere");
      server[scope] = { value: structuredClone(value), version: (cur?.version ?? 0) + 1 };
      return server[scope];
    },
    async del(scope) {
      sent.push([scope, "DELETE", undefined]);
      delete server[scope];
    },
    async reload() {
      cache = structuredClone(server);
      return cache;
    },
    stored: (scope) => cache[scope],
    saved: (scope, e) => {
      if (e) cache[scope] = e;
      else delete cache[scope];
    },
  };
  return { io, sent, server, cache: () => cache };
}

describe("PrefWriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves quick changes once, after a pause, with the version read", async () => {
    const t = setup({ s: { value: { a: 1 }, version: 3 } });
    const w = new PrefWriter(t.io, 500);
    w.set("s", { a: 2 });
    w.set("s", { a: 3 });
    expect(w.get("s")?.local).toEqual({ a: 3 }); // shown at once
    await vi.advanceTimersByTimeAsync(499);
    expect(t.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.sent).toEqual([["s", { a: 3 }, 3]]);
    expect(w.get("s")).toBeUndefined();
    expect(t.cache().s).toEqual({ value: { a: 3 }, version: 4 });
  });

  it("after a conflict, reloads, reapplies this tab's change and saves again", async () => {
    const t = setup({ s: { value: { columns: ["a"], sort: "a asc" }, version: 1 } });
    const w = new PrefWriter(t.io);
    t.server.s = { value: { columns: ["a"], sort: "b desc" }, version: 2 }; // another device
    w.set("s", { columns: ["a", "b"], sort: "a asc" });
    await w.flush("s");
    expect(t.sent.map((s) => s[2])).toEqual([1, 2]);
    expect(t.server.s).toEqual({ value: { columns: ["a", "b"], sort: "b desc" }, version: 3 });
    expect(w.get("s")).toBeUndefined();
  });

  it("saves a change made during a save next, with the new version", async () => {
    const t = setup();
    const w = new PrefWriter(t.io);
    w.set("s", { a: 1 });
    const first = w.flush("s");
    w.set("s", { a: 2 });
    await first;
    expect(t.sent).toEqual([
      ["s", { a: 1 }, 0],
      ["s", { a: 2 }, 1],
    ]);
    expect(t.server.s.value).toEqual({ a: 2 });
  });

  it("keeps a change that could not be saved, with the error", async () => {
    const t = setup();
    t.io.put = () => Promise.reject(new ApiError(0, "network", "offline"));
    const w = new PrefWriter(t.io);
    w.set("s", { a: 1 });
    await w.flush("s");
    expect(w.get("s")).toMatchObject({ local: { a: 1 }, busy: false });
    expect((w.get("s")?.error as ApiError).code).toBe("network");
  });

  it("never overwrites a value created elsewhere that it has not read", async () => {
    const t = setup();
    const w = new PrefWriter(t.io);
    t.server.s = { value: { views: { x: { name: "X" } } }, version: 1 }; // created on another device
    w.set("s", { columns: ["a"] });
    await w.flush("s");
    expect(t.sent.map((s) => s[2])).toEqual([0, 1]);
    expect(t.server.s.value).toEqual({ views: { x: { name: "X" } }, columns: ["a"] });
  });

  it("reset deletes the stored value", async () => {
    const t = setup({ s: { value: { a: 1 }, version: 2 } });
    const w = new PrefWriter(t.io);
    w.reset("s");
    await w.flush("s");
    expect(t.sent).toEqual([["s", "DELETE", undefined]]);
    expect(t.cache().s).toBeUndefined();
  });
});
