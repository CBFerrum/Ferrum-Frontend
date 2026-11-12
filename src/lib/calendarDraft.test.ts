import { describe, expect, it } from "vitest";
import { addHolidays, checkCalendar, copyDay, fromCalendar, newException, parseDates, seedHours, toCalendar, type Calendar } from "./calendarDraft";

const plain: Calendar = { name: "india", zone: "Asia/Kolkata", weekends: ["sat", "sun"], holidays: ["2026-01-26", "2026-08-15"] };
const timed: Calendar = { ...plain, hours: { mon: [["09:00", "13:00"], ["14:00", "18:00"]], tue: [["22:00", "24:00"]], fri: [["00:00", "06:00"]] } };

describe("calendar drafts", () => {
  it("come back as the calendar they were made from", () => {
    expect(toCalendar(fromCalendar(plain))).toEqual(plain);
    expect(toCalendar(fromCalendar(timed))).toEqual(timed);
  });

  it("leave hours out until they are set", () => {
    expect("hours" in toCalendar(fromCalendar(plain))).toBe(false);
    expect(toCalendar({ ...fromCalendar(plain), custom: true }).hours).toEqual({});
  });

  it("drop the windows of a day that stopped being a business day", () => {
    const d = fromCalendar(timed);
    d.open.fri = false;
    expect(toCalendar(d).weekends).toEqual(["fri", "sat", "sun"]);
    expect(toCalendar(d).hours?.fri).toBeUndefined();
  });

  it("seed nine to five, and copy a day to the other business days only", () => {
    const d = seedHours({ ...fromCalendar(plain), custom: true });
    expect(d.windows.mon).toEqual([{ from: "09:00", to: "17:00" }]);
    expect(d.windows.sat).toEqual([]);
    const c = copyDay(fromCalendar(timed), "mon");
    expect(c.windows.wed).toEqual(c.windows.mon);
    expect(c.windows.sat).toEqual([]);
  });
});

describe("checking a calendar", () => {
  const msgs = (c: Calendar, isNew = false) => checkCalendar(fromCalendar(c), isNew).map((p) => p.message);
  it("accepts the good ones, and a shift over midnight as two windows", () => {
    expect(msgs(plain)).toEqual([]);
    expect(msgs(timed)).toEqual([]);
  });
  it("refuses a name of the wrong shape, only while it is new", () => {
    expect(msgs({ ...plain, name: "Head Office" }, true)).toHaveLength(1);
    expect(msgs({ ...plain, name: "Head Office" }, false)).toEqual([]);
  });
  it("wants a business day, and a window when hours are set", () => {
    expect(msgs({ ...plain, weekends: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] })).toHaveLength(1);
    expect(msgs({ ...plain, hours: {} })).toHaveLength(1);
  });
  it("refuses a start at or after its end, and windows that overlap", () => {
    expect(msgs({ ...plain, hours: { mon: [["13:00", "13:00"]] } })[0]).toContain("start must be before");
    expect(msgs({ ...plain, hours: { mon: [["09:00", "12:00"], ["11:00", "14:00"]] } })[0]).toContain("overlap");
    expect(msgs({ ...plain, hours: { mon: [["09:00", "12:00"], ["12:00", "14:00"]] } })).toEqual([]);
    expect(msgs({ ...plain, hours: { mon: [["09:00", ""]] } })[0]).toContain("both times");
  });
});

describe("holidays", () => {
  it("are read from lines or commas, and what is not a date is returned", () => {
    expect(parseDates("2026-01-26, 2026-02-30\n2026-08-15 soon;2026-1-1")).toEqual({ dates: ["2026-01-26", "2026-08-15"], bad: ["2026-02-30", "soon", "2026-1-1"] });
  });
  it("stay sorted and without repeats", () => {
    expect(addHolidays(["2026-08-15"], ["2026-01-26", "2026-08-15"])).toEqual(["2026-01-26", "2026-08-15"]);
  });
});

describe("exceptions", () => {
  const base = { name: "office", zone: "Europe/Berlin", weekends: ["sat", "sun"], holidays: [] };
  const exceptions = { "2026-12-24": { open: false, hours: [["12:00", "24:00"]] as [string, string][] }, "2026-12-27": { open: true, hours: [["10:00", "14:00"]] as [string, string][], note: "kept" }, "2026-12-31": { open: false } };
  it("come back as they went, unknown properties included, and none are sent when there are none", () => {
    const c = toCalendar(fromCalendar({ ...base, exceptions } as never));
    expect(c.exceptions).toEqual(exceptions);
    expect(toCalendar(fromCalendar(base as never)).exceptions).toBeUndefined();
  });
  it("are listed by date", () => {
    expect(fromCalendar({ ...base, exceptions } as never).exceptions.map((e) => e.date)).toEqual(["2026-12-24", "2026-12-27", "2026-12-31"]);
  });
  it("are checked: a real date once, windows with both times, in order, not overlapping", () => {
    const d = fromCalendar({ ...base, exceptions } as never);
    expect(checkCalendar(d, false)).toEqual([]);
    d.exceptions.push({ ...newException("2026-12-24"), windows: [{ from: "10:00", to: "09:00" }, { from: "", to: "" }] });
    d.exceptions.push({ ...newException("2026-13-40"), windows: [{ from: "09:00", to: "12:00" }, { from: "11:00", to: "13:00" }] });
    const said = checkCalendar(d, false).map((p) => p.message).join("|");
    expect(said).toContain("2026-12-24: it is listed twice.");
    expect(said).toContain("window 1: the start must be before the end.");
    expect(said).toContain("window 2: enter both times.");
    expect(said).toContain("2026-13-40: not a date");
    expect(said).toContain("windows may not overlap.");
  });
});
