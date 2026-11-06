// What a new record's form starts with.

import { describe, expect, it } from "vitest";
import { prefill } from "./FormView";
import type { EntityMeta } from "../lib/meta";

const meta = (fields: object[]) => ({ name: "Incident", fields: fields.map((f) => ({ can_write: true, ...f })) }) as unknown as EntityMeta;

describe("a new record's values", () => {
  it("ticks a box whose default is 1, as the server saves it", () => {
    const doc = prefill(meta([{ name: "public", type: "check", default: 1 }, { name: "internal", type: "check", default: 0 }, { name: "on", type: "check", default: true }]), new URLSearchParams(), null);
    expect(doc).toEqual({ public: true, internal: false, on: true });
  });

  it("reads a box from the address as 1, true or anything else", () => {
    const fields = [{ name: "a", type: "check" }, { name: "b", type: "check" }, { name: "c", type: "check" }];
    expect(prefill(meta(fields), new URLSearchParams("a=1&b=true&c=0"), null)).toEqual({ a: true, b: true, c: false });
  });
});
