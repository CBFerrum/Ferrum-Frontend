// What a save on Admin's Interface words page does with each word.

import { describe, expect, it } from "vitest";
import { change, ownMenuNames, ownNames } from "./InterfaceWords";

describe("a word on the interface words page", () => {
  it("is made, changed, removed or left as it was", () => {
    const kept = { id: "w1", version: 1, words: "حفظ" };
    expect(change(undefined, "احفظ")).toBe("create");
    expect(change(undefined, "   ")).toBeNull();
    expect(change(kept, "حفظ")).toBeNull();
    expect(change(kept, " احفظ ")).toBe("update");
    expect(change(kept, "")).toBe("delete");
  });
});

describe("the workspace's own names", () => {
  const base = { label: "Membership", label_plural: "Memberships", fields: [{ name: "tier", label: "Tier", type: "select" as const, options: ["Gold", "Silver"] }], actions: [{ name: "renew", label: "Renew", docstatus: [0], permission: "write", confirm: "Renew it?" }], workflow: { initial_state: "New", states: [{ name: "New", docstatus: 0, edit_roles: [] }], transitions: [{ action: "Approve", from: "New", to: "New", roles: [] }] }, form: [{ label: "Plan", fields: ["tier"] }, { fields: [] }] };
  it("come from an entity the workspace made: labels, fields, choices, buttons, workflow, sections", () => {
    expect(ownNames({ ...base, package: "tenant" }).sort()).toEqual(["Approve", "Gold", "Membership", "Memberships", "New", "Plan", "Renew", "Renew it?", "Silver", "Tier"]);
    expect(ownNames({ ...base, package: "x", custom: true })).toHaveLength(10);
  });
  it("are nothing from a packaged entity, whose added fields the description does not mark", () => {
    expect(ownNames({ ...base, package: "erp" })).toEqual([]);
  });
});

describe("the workspace's own menus' names", () => {
  it("are the labels and descriptions of its menus, not a package's modules", () => {
    expect(ownMenuNames([{ package: "tenant", label: "Governance", description: "Risks" }, { package: "tenant", label: "Audit" }, { package: "crm", label: "CRM", description: "Sales" }])).toEqual(["Governance", "Risks", "Audit"]);
  });
});
