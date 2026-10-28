import { describe, expect, it } from "vitest";
import { compareDecimal, formatDate, formatDecimal, formatValue, humanize } from "./format";

describe("formatDecimal", () => {
  it("groups digits and keeps the value's own precision by default", () => {
    expect(formatDecimal("1234567.5", undefined, "en-US")).toBe("1,234,567.5");
    expect(formatDecimal("-0.25", undefined, "en-US")).toBe("-0.25");
    expect(formatDecimal(42, undefined, "en-US")).toBe("42");
  });

  it("rounds exactly (no binary floating point) to the requested precision", () => {
    expect(formatDecimal("1.005", 2, "en-US")).toBe("1.01");
    expect(formatDecimal("0.125", 2, "en-US")).toBe("0.13");
    expect(formatDecimal("-2.5", 0, "en-US")).toBe("-3");
    expect(formatDecimal("12345678901234567.89", 2, "en-US")).toBe("12,345,678,901,234,567.89");
    expect(formatDecimal("10", 3, "en-US")).toBe("10.000");
  });

  it("respects locale grouping", () => {
    expect(formatDecimal("1234567.891", 2, "en-IN")).toBe("12,34,567.89");
    expect(formatDecimal("1234567.891", 2, "de-DE")).toBe("1.234.567,89");
  });

  it("passes through empty and non-numeric values", () => {
    expect(formatDecimal(null)).toBe("");
    expect(formatDecimal("")).toBe("");
    expect(formatDecimal("abc")).toBe("abc");
  });
});

describe("formatValue", () => {
  it("formats by field type", () => {
    expect(formatValue({ type: "currency" }, "1500", { locale: "en-US" })).toBe("1,500.00");
    expect(formatValue({ type: "currency" }, "1500.456", { currencyPrecision: 3, locale: "en-US" })).toBe("1,500.456");
    expect(formatValue({ type: "currency" }, "7.5", { currencyPrecision: 0, locale: "en-US" })).toBe("8");
    expect(formatValue({ type: "percent" }, "18", { locale: "en-US" })).toBe("18%");
    expect(formatValue({ type: "decimal", precision: 3 }, "2", { locale: "en-US" })).toBe("2.000");
    expect(formatValue({ type: "int" }, 1234, { locale: "en-US" })).toBe("1,234");
    expect(formatValue({ type: "check" }, true)).toBe("Yes");
    expect(formatValue({ type: "data" }, null)).toBe("");
  });

  it("formats dates without time-zone shifts", () => {
    expect(formatDate("2026-01-01", "en-US")).toBe("Jan 1, 2026");
  });
});

describe("compareDecimal", () => {
  it("compares exactly", () => {
    expect(compareDecimal("1.10", "1.1")).toBe(0);
    expect(compareDecimal("-0", "0.00")).toBe(0);
    expect(compareDecimal("10", "9.999")).toBe(1);
    expect(compareDecimal("-10", "-9.999")).toBe(-1);
    expect(compareDecimal("0.30000000000000000001", "0.3")).toBe(1);
    expect(compareDecimal("007", "7")).toBe(0);
  });
});

describe("humanize", () => {
  it("mirrors the server label fallback", () => {
    expect(humanize("x_gst_number")).toBe("Gst Number");
    expect(humanize("trial_balance")).toBe("Trial Balance");
  });
});
