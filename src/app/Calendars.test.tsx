// The calendar editor rendered open on a calendar with exceptions (a coming one and a past one), then axe.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import type { Calendar } from "../lib/calendarDraft";
import { CalendarDialog } from "./Calendars";

const calendar: Calendar = {
  name: "office", zone: "Europe/Berlin", weekends: ["sat", "sun"], holidays: [],
  exceptions: { "2020-12-24": { open: false }, "2999-12-24": { open: false, hours: [["12:00", "24:00"]] }, "2999-12-27": { open: true, hours: [["10:00", "14:00"]] } },
};
const html = renderToString(<CalendarDialog value={calendar} onClose={() => {}} onDone={() => {}} />);
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the calendar editor's exceptions", () => {
  it("lists them by date, the past ones collapsed, each with closed or open and its hours", () => {
    expect(text).toContain("Exceptions");
    expect(text).toContain("Past exceptions (1)");
    expect(html.indexOf("2020-12-24")).toBeGreaterThan(html.indexOf("<details"));
    expect(html.indexOf("2999-12-24")).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain('aria-label="2999-12-24: closed or open"');
    expect(html).toContain('value="12:00"');
    expect(html).toContain('aria-label="A date to make an exception"');
  });
  it("passes axe", async () => {
    expect(await violations(html)).toEqual([]);
  });
});
