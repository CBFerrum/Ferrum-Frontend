import { describe, expect, it } from "vitest";
import { ApiError, errorMessage, parseApiError, queryString, withPrintCsp } from "./api";

describe("parseApiError", () => {
  it("parses validation errors with child rows", () => {
    const e = parseApiError(422, {
      error: "validation_failed",
      message: "Please correct the highlighted fields",
      fields: [
        { field: "customer", message: "is required" },
        { field: "qty", message: "'abc' is not a valid number", row: ["items", 0] },
        { nonsense: true },
      ],
    });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(422);
    expect(e.code).toBe("validation_failed");
    expect(e.message).toBe("Please correct the highlighted fields");
    expect(e.fields).toEqual([
      { field: "customer", message: "is required" },
      { field: "qty", message: "'abc' is not a valid number", row: ["items", 0] },
    ]);
  });

  it("parses conflicts and keeps the server message", () => {
    const e = parseApiError(409, { error: "conflict", message: "changed by someone else" });
    expect(e.code).toBe("conflict");
    expect(e.message).toBe("changed by someone else");
    expect(e.fields).toEqual([]);
  });

  it("appends the error id of internal errors", () => {
    const e = parseApiError(500, { error: "internal", message: "An internal error occurred", error_id: "abc-123" });
    expect(e.errorId).toBe("abc-123");
    expect(e.message).toContain("abc-123");
  });

  it("falls back when the body is missing or not JSON", () => {
    expect(parseApiError(403, null).code).toBe("forbidden");
    expect(parseApiError(503, "Service Unavailable").code).toBe("unavailable");
    expect(parseApiError(502, undefined).code).toBe("unavailable");
    expect(parseApiError(500, undefined).code).toBe("server_error");
    expect(parseApiError(418, []).message).toContain("418");
    expect(parseApiError(0, null).code).toBe("network");
  });

  it("drops malformed row references", () => {
    const e = parseApiError(422, { error: "validation_failed", fields: [{ field: "a", message: "b", row: ["items"] }] });
    expect(e.fields).toEqual([{ field: "a", message: "b" }]);
  });
});

describe("errorMessage", () => {
  it("summarizes field errors for toasts", () => {
    const e = parseApiError(422, {
      error: "validation_failed",
      message: "Please correct the highlighted fields",
      fields: [{ field: "qty", message: "is required", row: ["items", 1] }],
    });
    expect(errorMessage(e)).toBe("Please correct the highlighted fields — row 2 qty: is required");
    expect(errorMessage(e, false)).toBe("Please correct the highlighted fields");
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
});

describe("helpers", () => {
  it("builds query strings without empty values", () => {
    expect(queryString({ a: 1, b: "", c: undefined, d: null, e: true, f: "x y" })).toBe("?a=1&e=true&f=x+y");
    expect(queryString({})).toBe("");
  });

  it("injects a script-blocking CSP before any print markup", () => {
    const out = withPrintCsp("<!doctype html><html><head><script>alert(1)</script></head></html>");
    expect(out.startsWith("<!doctype html><meta http-equiv=\"Content-Security-Policy\"")).toBe(true);
    expect(withPrintCsp("<p>hi</p>").startsWith("<!doctype html><meta")).toBe(true);
  });
});
