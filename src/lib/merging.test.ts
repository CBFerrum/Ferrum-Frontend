import { describe, expect, it } from "vitest";
import { defaultPicks, differing, mergedValues } from "./merging";
import type { Doc, Field } from "./meta";

const f = (name: string, more: Partial<Field> = {}) => ({ name, label: name, type: "data", can_read: true, can_write: true, ...more }) as Field;
const fields = [f("name"), f("email"), f("phone"), f("city")];

describe("merging two records", () => {
  const a = { id: "a", name: "Acme", email: "", phone: "1", city: "Pune" } as Doc;
  const b = { id: "b", name: "ACME Ltd", email: "x@y", phone: "1", city: null } as Doc;

  it("asks only about what differs", () => {
    expect(differing(fields, a, b).map((x) => x.name)).toEqual(["name", "email", "city"]);
  });

  it("does not treat an empty string and nothing as a difference", () => {
    expect(differing([f("x")], { x: "" } as Doc, { x: null } as Doc)).toEqual([]);
  });

  it("does not ask about what the viewer cannot change or see", () => {
    const closed = [f("a", { can_write: false }), f("b", { read_only: true }), f("c", { hidden: true }), f("d", { can_read: false }), f("e", { type: "table" }), f("g", { type: "secret" })];
    expect(differing(closed, { a: 1, b: 1, c: 1, d: 1, e: 1, g: 1 } as Doc, { a: 2, b: 2, c: 2, d: 2, e: 2, g: 2 } as Doc)).toEqual([]);
  });

  it("starts from the record that stays, filling only its gaps", () => {
    expect(defaultPicks(differing(fields, a, b), a)).toEqual({ name: "keep", email: "other", city: "keep" });
  });

  it("writes only what was taken from the other record", () => {
    const d = differing(fields, a, b);
    expect(mergedValues(d, b, { name: "keep", email: "other", city: "keep" })).toEqual({ email: "x@y" });
    expect(mergedValues(d, b, { name: "keep", email: "keep", city: "other" })).toEqual({ city: null });
  });
});
