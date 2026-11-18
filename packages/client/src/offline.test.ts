import { describe, expect, it } from "vitest";
import { cacheName, currentLease, forgetCached, mayKeep, pendingName, stale, sweep, type OfflineEnv, type OfflineLease } from "./offline";

function memory(): OfflineEnv["storage"] & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const NOW = Date.parse("2026-11-06T10:00:00Z");
const lease = (over: Partial<OfflineLease> = {}): OfflineLease => ({ allowed: true, until: "2026-11-09T10:00:00Z", hours: 72, key: "k1", person: "p1", ...over });

describe("offline", () => {
  it("keeps cached reads under the person's sign-in while the lease holds", () => {
    const env = { workspace: "acme", lease: lease(), storage: memory() };
    expect(cacheName(env, "pos", "pricebook", NOW)).toBe("ferrum.offline.acme.pos.k1.pricebook");
    expect(pendingName(env, "pos", "outbox")).toBe("ferrum.offline.acme.pos.person-p1.outbox");
    expect(cacheName(env, "pos", "pricebook", Date.parse("2026-11-09T10:00:01Z"))).toBeNull();
    expect(cacheName({ ...env, lease: lease({ allowed: false, until: null }) }, "pos", "pricebook", NOW)).toBeNull();
    expect(mayKeep(null)).toBe(false);
  });

  it("remembers the lease for a start without the server", () => {
    const storage = memory();
    currentLease({ workspace: "acme", lease: lease(), storage });
    expect(currentLease({ workspace: "acme", lease: null, storage })?.key).toBe("k1");
    expect(currentLease({ workspace: "other", lease: null, storage })).toBeNull();
  });

  it("forgets cached reads of another sign-in or past the lease, never pending work", async () => {
    const storage = memory();
    for (const name of [
      "ferrum.offline.acme.pos.k0.pricebook",
      "ferrum.offline.acme.pos.k1.memory",
      "ferrum.offline.acme.pos.person-p0.outbox",
      "ferrum.offline.other.pos.k0.pricebook",
      "unrelated",
    ])
      storage.setItem(name, "x");
    const env = { workspace: "acme", lease: lease(), storage };
    const deleted: string[] = [];
    const databases = {
      databases: async () => [{ name: "ferrum.offline.acme.docs.k0.cache", version: 1 }, { name: "ferrum.offline.acme.docs.person-p1.unsaved", version: 1 }],
      deleteDatabase: (name: string) => {
        deleted.push(name);
        return {} as IDBOpenDBRequest;
      },
    };
    const gone = await sweep(env, databases, NOW);
    expect(gone.sort()).toEqual(["ferrum.offline.acme.docs.k0.cache", "ferrum.offline.acme.pos.k0.pricebook"]);
    expect(deleted).toEqual(["ferrum.offline.acme.docs.k0.cache"]);
    expect([...storage.map.keys()].sort()).toEqual([
      "ferrum.offline.acme.lease",
      "ferrum.offline.acme.pos.k1.memory",
      "ferrum.offline.acme.pos.person-p0.outbox",
      "ferrum.offline.other.pos.k0.pricebook",
      "unrelated",
    ]);
    // Past the lease, every cached read goes; the queued sale stays.
    await sweep(env, undefined, Date.parse("2026-11-10T00:00:00Z"));
    expect(storage.map.has("ferrum.offline.acme.pos.k1.memory")).toBe(false);
    expect(storage.map.has("ferrum.offline.acme.pos.person-p0.outbox")).toBe(true);
    expect(stale(env, "ferrum.offline.acme.lease", NOW)).toBe(false);
  });

  it("sweep_deletes_stale_cache_storage", async () => {
    const env = { workspace: "acme", lease: lease(), storage: memory() };
    const caches = cacheStorage(["ferrum.offline.acme.docs.k0.pages", "ferrum.offline.acme.docs.k1.pages", "ferrum.offline.acme.docs.person-p1.unsaved", "ferrum:pos:page", "ferrum:pos:files", "other"]);
    const gone = await sweep(env, undefined, NOW, caches);
    expect(gone).toEqual(["ferrum.offline.acme.docs.k0.pages"]);
    expect(caches.names.sort()).toEqual(["ferrum.offline.acme.docs.k1.pages", "ferrum.offline.acme.docs.person-p1.unsaved", "ferrum:pos:files", "ferrum:pos:page", "other"]);
  });
});

/** Cache Storage as the browser gives it: names, and delete by name. */
function cacheStorage(start: string[]) {
  const names = [...start];
  return {
    names,
    keys: async () => [...names],
    delete: async (name: string) => {
      const i = names.indexOf(name);
      if (i < 0) return false;
      names.splice(i, 1);
      return true;
    },
  };
}

// Signing out (gapclose/design/S13-mobile.md §2.1, CLOSE REVIEW): nothing personal outlives it on the device. The lease goes, every
// cached read of the workspace goes (storage keys, IndexedDB, Cache Storage), and every kept page of an offline app goes (it holds
// the bootstrap: the person's name, email and workspace). Work not sent stays for its person alone; other workspaces are not touched.
describe("forgetting at sign-out", () => {
  it("forget_cached_keeps_pending_work", async () => {
    const storage = memory();
    for (const name of [
      "ferrum.offline.acme.lease",
      "ferrum.offline.acme.pos.k1.pricebook",
      "ferrum.offline.acme.pos.k0.pricebook",
      "ferrum.offline.acme.pos.person-p1.outbox",
      "ferrum.offline.other.pos.k9.pricebook",
      "ferrum.offline.other.lease",
      "unrelated",
    ])
      storage.setItem(name, "x");
    const deleted: string[] = [];
    const databases = {
      databases: async () => ["ferrum.offline.acme.docs.k1.cache", "ferrum.offline.acme.outbox.person-p1.steps", "ferrum.offline.other.docs.k9.cache"].map((name) => ({ name, version: 1 })),
      deleteDatabase: (name: string) => (deleted.push(name), {} as IDBOpenDBRequest),
    };
    const caches = cacheStorage(["ferrum:field-service:page", "ferrum:logistics:page", "ferrum:field-service:files", "ferrum.offline.acme.learn.k1.lessons", "ferrum.offline.acme.learn.person-p1.progress", "ferrum.offline.other.learn.k9.lessons"]);
    // The page's own lease is still in its bootstrap: forgetting must not write it back.
    const gone = await forgetCached({ workspace: "acme", lease: lease(), storage }, databases, caches);
    expect([...storage.map.keys()].sort()).toEqual(["ferrum.offline.acme.pos.person-p1.outbox", "ferrum.offline.other.lease", "ferrum.offline.other.pos.k9.pricebook", "unrelated"]);
    expect(deleted).toEqual(["ferrum.offline.acme.docs.k1.cache"]);
    expect(caches.names.sort()).toEqual(["ferrum.offline.acme.learn.person-p1.progress", "ferrum.offline.other.learn.k9.lessons", "ferrum:field-service:files"]);
    expect(gone).toContain("ferrum:field-service:page");
    expect(gone).toContain("ferrum.offline.acme.lease");
  });

  it("forgets the kept pages even where nothing else can be listed, and on a page with no workspace", async () => {
    const caches = cacheStorage(["ferrum:crm:page", "ferrum:crm:files"]);
    await forgetCached({ workspace: null, lease: null, storage: undefined }, undefined, caches);
    expect(caches.names).toEqual(["ferrum:crm:files"]);
  });
});

