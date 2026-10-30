import { describe, expect, it } from "vitest";
import type { MetaIndex, Module } from "../lib/meta";
import { ownModule, setFrameMode, STUDIO } from "./Shell";

const meta = { entities: [{ name: "Lead", package: "crm" }, { name: "Customer", package: "parties" }] } as unknown as MetaIndex;
const mod = (name: string, items: string[], pkg?: string): Module => ({ name, label: name, order: 0, items, package: pkg });

describe("the records frame's sidebar", () => {
  it("shows the modules the app's packages define", () => {
    setFrameMode("app", ["parties", "selling"], { pages: true });
    expect(ownModule(mod("masters", ["Customer"], "parties"), meta)).toBe(true);
    // CRM's module lists customers too, but CRM defines it.
    expect(ownModule(mod("crm", ["Lead", "Customer"], "crm"), meta)).toBe(false);
    // From a server that does not say which package defines a module: by the entities it lists.
    expect(ownModule(mod("crm", ["Lead", "Customer"]), meta)).toBe(true);
    setFrameMode("classic");
    expect(ownModule(mod("crm", ["Lead"], "crm"), meta)).toBe(true);
  });

  it("shows Studio's pages where they are among the frame's routes and Studio is the app's", () => {
    setFrameMode("app", ["parties"], { pages: true });
    expect(ownModule(mod(STUDIO, [], STUDIO), meta)).toBe(false);
    setFrameMode("app", ["parties", STUDIO], { pages: true });
    expect(ownModule(mod(STUDIO, [], STUDIO), meta)).toBe(true);
    setFrameMode("app", [STUDIO]);
    expect(ownModule(mod(STUDIO, [], STUDIO), meta)).toBe(false);
    setFrameMode("classic");
    expect(ownModule(mod(STUDIO, [], STUDIO), meta)).toBe(true);
  });
});
