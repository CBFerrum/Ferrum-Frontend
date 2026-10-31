import { describe, expect, it } from "vitest";
import { byUrgency, localDay, type WorkItem } from "./MyWork";

const item = (key: string, o: Partial<WorkItem> = {}): WorkItem => ({ key, source: "s", kind: "app", title: key, url: `/${key}`, ...o });

describe("byUrgency", () => {
  it("puts overdue first, then today, decisions, mentions, later dates, the rest newest first", () => {
    const today = "2026-10-31";
    const order = byUrgency(
      [
        item("old", { at: "2026-10-01T00:00:00Z" }),
        item("later", { due: "2026-11-05" }),
        item("mention", { kind: "mention", at: "2026-10-30T09:00:00Z" }),
        item("today", { due: today }),
        item("approval", { kind: "approval" }),
        item("overdue", { due: "2026-10-29" }),
        item("new", { at: "2026-10-31T08:00:00Z" }),
        item("sooner", { due: "2026-11-02" }),
      ],
      today,
    ).map((i) => i.key);
    expect(order).toEqual(["overdue", "today", "approval", "mention", "sooner", "later", "new", "old"]);
  });

  it("names the local day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
