import { describe, expect, it } from "vitest";
import { latest } from "./StudioHome";

describe("latest", () => {
  it("keeps the most recently changed first, at most n", () => {
    const rows = [
      { id: "a", updated_at: "2026-10-01T00:00:00Z" },
      { id: "b", updated_at: "2026-10-30T00:00:00Z" },
      { id: "c", updated_at: "2026-10-15T00:00:00Z" },
    ];
    expect(latest(rows, 2).map((r) => r.id)).toEqual(["b", "c"]);
    expect(rows[0].id).toBe("a");
  });
});
