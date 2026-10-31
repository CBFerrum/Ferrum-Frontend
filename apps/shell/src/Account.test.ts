import { describe, expect, it } from "vitest";
import { b64, browserName } from "./Account";

describe("passkeys' base64url", () => {
  it("round-trips any bytes, without padding", () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 250) % 256);
      const text = b64.encode(bytes.buffer);
      expect(text).not.toMatch(/[+/=]/);
      expect([...b64.decode(text)]).toEqual([...bytes]);
    }
  });

  it("names browsers for people", () => {
    expect(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Chrome on macOS");
  });
});
