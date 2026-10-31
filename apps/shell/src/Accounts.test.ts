import { describe, expect, it } from "vitest";
import { initials } from "./Accounts";

describe("a workspace's monogram", () => {
  it("takes the first and last words' initials", () => {
    expect(initials("Acme Co")).toBe("AC");
    expect(initials("  Ana  Maria Rao ")).toBe("AR");
    expect(initials("globex")).toBe("G");
    expect(initials("")).toBe("?");
  });
});
