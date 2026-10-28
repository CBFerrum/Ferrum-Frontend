import { describe, expect, it } from "vitest";
import type { Field } from "./meta";
import { bar, dayOf, dayRangeFilters, monthGrid, viewOptions, weekStart } from "./views";

const f = (name: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({ name, label: name, type, can_read: true, ...extra });

describe("viewOptions", () => {
  it("offers select fields for boards, status first", () => {
    const o = viewOptions([f("priority", "select", { options: ["Low", "High"] }), f("status", "select", { options: ["Open", "Done"] }), f("kind", "select", { options: ["One"] })]);
    expect(o.board.map((x) => x.name)).toEqual(["status", "priority"]);
  });
  it("pairs start and end fields for timelines", () => {
    const o = viewOptions([
      f("expected_start_date", "date"),
      f("expected_end_date", "date"),
      f("actual_start_date", "date"),
      f("actual_end_date", "date"),
      f("starts_at", "datetime"),
      f("ends_at", "datetime"),
    ]);
    expect(o.timeline.map(([s, e]) => `${s.name}->${e.name}`)).toEqual([
      "expected_start_date->expected_end_date",
      "actual_start_date->actual_end_date",
      "starts_at->ends_at",
    ]);
    expect(o.calendar).toHaveLength(6);
  });
  it("pairs from/to and ignores unreadable or hidden fields", () => {
    const o = viewOptions([f("from_date", "date"), f("to_date", "date"), f("secret_date", "date", { can_read: false }), f("status", "select", { options: ["A", "B"], hidden: true })]);
    expect(o.timeline.map(([s, e]) => [s.name, e.name])).toEqual([["from_date", "to_date"]]);
    expect(o.calendar.map((x) => x.name)).toEqual(["from_date", "to_date"]);
    expect(o.board).toEqual([]);
  });
});

describe("dates", () => {
  it("builds a six-week month grid starting on Monday", () => {
    const g = monthGrid(2026, 1); // February 2026 starts on a Sunday
    expect(g).toHaveLength(42);
    expect(g[0]).toBe("2026-01-26");
    expect(g[6]).toBe("2026-02-01");
    expect(g[41]).toBe("2026-03-08");
  });
  it("finds the Monday of a week", () => {
    expect(weekStart("2026-10-28")).toBe("2026-10-26");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });
  it("reads days from dates and datetimes", () => {
    expect(dayOf("2026-10-28")).toBe("2026-10-28");
    expect(dayOf("not a date")).toBeNull();
    expect(dayOf(null)).toBeNull();
    const local = new Date(2026, 9, 28, 23, 30);
    expect(dayOf(local.toISOString())).toBe("2026-10-28");
  });
  it("filters whole days for dates and datetimes", () => {
    expect(dayRangeFilters(f("d", "date"), "2026-10-01", "2026-10-31")).toEqual([
      ["d", ">=", "2026-10-01"],
      ["d", "<=", "2026-10-31"],
    ]);
    const [[, , lo], [, , hi]] = dayRangeFilters(f("t", "datetime"), "2026-10-01", "2026-10-31");
    expect(new Date(lo).getDate()).toBe(1);
    expect(new Date(hi).getDate()).toBe(31);
    expect(new Date(hi).getHours()).toBe(23);
  });
});

describe("bar", () => {
  it("places a record inside the window", () => {
    expect(bar("2026-10-03", "2026-10-04", "2026-10-01", 10)).toEqual({ left: 20, width: 20, before: false, after: false });
  });
  it("clips records that cross the edges", () => {
    expect(bar("2026-09-25", "2026-10-02", "2026-10-01", 10)).toEqual({ left: 0, width: 20, before: true, after: false });
    expect(bar("2026-10-09", "2026-10-20", "2026-10-01", 10)).toEqual({ left: 80, width: 20, before: false, after: true });
  });
  it("skips records outside the window and handles missing or reversed ends", () => {
    expect(bar("2026-09-01", "2026-09-30", "2026-10-01", 10)).toBeNull();
    expect(bar("2026-10-11", "2026-10-12", "2026-10-01", 10)).toBeNull();
    expect(bar(null, null, "2026-10-01", 10)).toBeNull();
    expect(bar("2026-10-05", null, "2026-10-01", 10)).toEqual({ left: 40, width: 10, before: false, after: false });
    expect(bar("2026-10-05", "2026-10-01", "2026-10-01", 10)).toEqual({ left: 40, width: 10, before: false, after: false });
  });
});
