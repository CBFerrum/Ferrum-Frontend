// Signed action links: a link's state from what the server lists, and the link effect's options.

import { describe, expect, it } from "vitest";
import { canRevoke, checkLink, linkState, setColumns, setOption } from "./actionLinks";

const now = Date.parse("2026-11-13T12:00:00Z");
const link = { revoked_at: null, uses: 0, max_uses: 1, expires_at: "2026-11-20T00:00:00Z", opened_at: null };

describe("a link's state", () => {
  it("is revoked, used up, expired, opened or not opened, in that order of precedence", () => {
    expect(linkState({ ...link, revoked_at: "2026-11-13T00:00:00Z", uses: 1 }, now)).toBe("revoked");
    expect(linkState({ ...link, uses: 1, opened_at: "2026-11-12T00:00:00Z" }, now)).toBe("used");
    expect(linkState({ ...link, expires_at: "2026-11-12T00:00:00Z" }, now)).toBe("expired");
    expect(linkState({ ...link, max_uses: 3, uses: 1, opened_at: "2026-11-13T09:00:00Z" }, now)).toBe("opened");
    expect(linkState(link, now)).toBe("waiting");
  });
  it("can be revoked only while it can still be used", () => {
    expect(["revoked", "used", "expired", "opened", "waiting"].map((s) => canRevoke(s as never))).toEqual([false, false, false, true, true]);
  });
});

describe("the link effect's options", () => {
  const effect = { type: "link", actions: ["accept"], show: ["title", "items"], until: "doc.valid_until", days: 7 };
  it("sets one option and takes it away when empty, keeping the rest", () => {
    expect(setOption(effect, "until", "")).toEqual({ type: "link", actions: ["accept"], show: ["title", "items"], days: 7 });
    expect(setOption(effect, "uses", 3)).toMatchObject({ uses: 3, days: 7 });
    expect(setColumns(effect, "items", ["item", "qty"]).columns).toEqual({ items: ["item", "qty"] });
    expect(setColumns(setColumns(effect, "items", ["item"]), "items", [])).not.toHaveProperty("columns");
  });
  it("says what the server would refuse", () => {
    expect(checkLink({ ...effect, columns: { items: ["item"] } }, ["items"])).toEqual([]);
    expect(checkLink(effect, ["items"])).toHaveLength(1);
    expect(checkLink({ ...effect, columns: { items: Array.from({ length: 9 }, (_, i) => `c${i}`) } }, ["items"])).toHaveLength(1);
    expect(checkLink({ ...effect, columns: { items: ["a"], notes: ["b"] } }, ["items", "notes"])).toHaveLength(1);
    expect(checkLink({ ...effect, columns: { items: ["a"] }, days: 91, uses: 101 }, ["items"])).toHaveLength(2);
    expect(checkLink({ ...effect, actions: [], columns: { items: ["a"] } }, ["items"])).toHaveLength(1);
    expect(checkLink({ ...effect, columns: { items: ["a"] }, frame_origins: ["http://x.example"] }, ["items"])).toHaveLength(1);
  });
});
