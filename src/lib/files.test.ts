import { describe, expect, it } from "vitest";
import { megabytes, uploadRoute } from "./files";

const MB = 1024 * 1024;

describe("upload route", () => {
  it("sends small files through the API and large ones straight to storage", () => {
    const s3 = { max_bytes: 25 * MB, direct: true, direct_max_bytes: 2048 * MB };
    expect(uploadRoute(25 * MB, s3)).toBe("api");
    expect(uploadRoute(25 * MB + 1, s3)).toBe("direct");
    expect(uploadRoute(2048 * MB + 1, s3)).toEqual({ tooLarge: 2048 * MB });
  });

  it("refuses large files when the server has no direct uploads", () => {
    expect(uploadRoute(30 * MB, { max_bytes: 25 * MB, direct: false, direct_max_bytes: null })).toEqual({ tooLarge: 25 * MB });
    expect(megabytes(25 * MB)).toBe("25 MB");
    expect(megabytes(2048 * MB)).toBe("2 GB");
  });
});
