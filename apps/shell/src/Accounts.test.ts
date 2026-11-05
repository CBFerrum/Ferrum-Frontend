import { describe, expect, it } from "vitest";
import { backAsChosen, initials } from "./Accounts";

describe("a workspace's monogram", () => {
  it("takes the first and last words' initials", () => {
    expect(initials("Acme Co")).toBe("AC");
    expect(initials("  Ana  Maria Rao ")).toBe("AR");
    expect(initials("globex")).toBe("G");
    expect(initials("")).toBe("?");
  });
});

describe("signing in as another account", () => {
  it("comes back as the account chosen, not to be asked again", () => {
    expect(backAsChosen("/authorize?host=walk.example&state=abc&prompt=select_account")).toBe("/authorize?host=walk.example&state=abc&prompt=none");
    expect(backAsChosen("/authorize?host=walk.example&state=abc&prompt=none")).toBe("/authorize?host=walk.example&state=abc&prompt=none");
    expect(backAsChosen("/account")).toBe("/account");
  });
});
