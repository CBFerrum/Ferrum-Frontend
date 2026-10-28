import { describe, expect, it } from "vitest";
import { mentionedIn } from "./Collab";

const people = [
  { id: "a", full_name: "Ada Admin", email: "ada@x.test" },
  { id: "b", full_name: "Bea Sales", email: "bea@x.test" },
  { id: "c", full_name: "", email: "carl@x.test" },
];

describe("mentionedIn", () => {
  it("finds people by name or email, case-insensitively", () => {
    expect(mentionedIn("Thanks @ada admin, and @CARL@x.test please check", people)).toEqual(["a", "c"]);
  });
  it("ignores plain names without @ and unknown people", () => {
    expect(mentionedIn("Bea Sales will call; ping @nobody", people)).toEqual([]);
  });
});
