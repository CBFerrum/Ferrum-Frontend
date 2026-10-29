import { describe, expect, it } from "vitest";
import { byDay, daysOf, isoDay, monthGrid, safeColor, safeLink, type Occurrence } from "./calendar";

const occ = (id: string, start: string, end: string, all_day = false): Occurrence => ({ id, event: id, start, end, all_day, subject: id });

describe("calendar", () => {
  it("lays a month out as six Monday-first weeks", () => {
    const g = monthGrid(new Date(2026, 9, 15)); // October 2026 starts on a Thursday
    expect(g).toHaveLength(42);
    expect(isoDay(g[0]!)).toBe("2026-09-28");
    expect(g[0]!.getDay()).toBe(1);
    expect(isoDay(g[41]!)).toBe("2026-11-08");
  });

  it("puts all-day events on their dates, exclusive end", () => {
    expect(daysOf(occ("a", "2026-10-30T00:00:00Z", "2026-11-01T00:00:00Z", true))).toEqual(["2026-10-30", "2026-10-31"]);
    expect(daysOf(occ("b", "2026-10-30T00:00:00Z", "2026-10-30T00:00:00Z", true))).toEqual(["2026-10-30"]);
  });

  it("puts timed events on each local day they touch, and orders a day", () => {
    const at = (h: number, d = 30) => new Date(2026, 9, d, h).toISOString();
    expect(daysOf(occ("t", at(9), at(10)))).toEqual(["2026-10-30"]);
    expect(daysOf(occ("n", at(22), at(0, 31)))).toEqual(["2026-10-30"]); // ends at midnight
    expect(daysOf(occ("o", at(22), at(2, 31)))).toEqual(["2026-10-30", "2026-10-31"]);
    const day = byDay([occ("late", at(15), at(16)), occ("early", at(9), at(10)), occ("whole", "2026-10-30T00:00:00Z", "2026-10-31T00:00:00Z", true)]).get("2026-10-30");
    expect(day?.map((o) => o.id)).toEqual(["whole", "early", "late"]);
  });

  it("only lets safe colors and links through", () => {
    expect([safeColor("#0a7"), safeColor("#00aa77ff"), safeColor("red;background:url(x)"), safeColor(null)]).toEqual(["#0a7", "#00aa77ff", undefined, undefined]);
    expect([safeLink("https://meet.example/x"), safeLink("javascript:alert(1)")]).toEqual(["https://meet.example/x", undefined]);
  });
});
