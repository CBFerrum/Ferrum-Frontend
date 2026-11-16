import { describe, expect, it } from "vitest";
import { megabytes, uploadRoute } from "./files";

const MB = 1024 * 1024;

describe("upload route", () => {
  it("sends large files in parts where the server takes them, on any store", () => {
    const parts = { max_bytes: 25 * MB, parts_max_bytes: 2048 * MB };
    expect(uploadRoute(25 * MB, parts)).toBe("api");
    expect(uploadRoute(25 * MB + 1, parts)).toBe("parts");
    expect(uploadRoute(2048 * MB + 1, parts)).toEqual({ tooLarge: 2048 * MB });
  });

  it("refuses files larger than parts may be", () => {
    expect(uploadRoute(30 * MB, { max_bytes: 25 * MB, parts_max_bytes: 25 * MB })).toEqual({ tooLarge: 25 * MB });
    expect(megabytes(25 * MB)).toBe("25 MB");
    expect(megabytes(2048 * MB)).toBe("2 GB");
  });
});
