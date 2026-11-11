// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { relativeTime, setFormatLocale } from "./format";

describe("relativeTime", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const twoHoursAgo = "2026-11-11T10:00:00Z";
  afterEach(() => { setFormatLocale(undefined); document.documentElement.dir = "ltr"; });

  it("uses Intl in the page's language, not concatenation", () => {
    expect(relativeTime(twoHoursAgo, now, "en")).toBe("2 hours ago");
    expect(relativeTime(twoHoursAgo, now, "ar")).toBe(new Intl.RelativeTimeFormat("ar", { numeric: "auto" }).format(-2, "hour"));
    setFormatLocale(undefined, "hi");
    expect(relativeTime(twoHoursAgo, now)).toBe(new Intl.RelativeTimeFormat("hi", { numeric: "auto" }).format(-2, "hour"));
  });

  it("isolates the phrase on a right-to-left page so the number keeps its place", () => {
    document.documentElement.dir = "rtl";
    expect(relativeTime(twoHoursAgo, now, "en")).toBe("\u20682 hours ago\u2069");
  });
});
