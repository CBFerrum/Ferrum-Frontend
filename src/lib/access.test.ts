import { describe, expect, it } from "vitest";
import { accessPatch, looksLikeNetwork, ownNetwork, readsValue, stepUpMinutes, stepUpRows, stepUpValue, type AccessSettings } from "./access";

// Shapes from the server: crates/kernel/src/tenant.rs (tenant_settings) and server/tests/access_it.rs.
const initial: AccessSettings = { staff_networks: { networks: ["10.0.0.0/8", "2001:db8::/32"], mode: "enforce" }, idle_minutes: 0, break_glass: null, new_device_notice: false };
const same = { networks: ["10.0.0.0/8", "2001:db8::/32"], mode: "enforce" as const, idle: "0", breakGlass: null, notice: false };

describe("networks as typed", () => {
  it("takes an address and a length, v4 or v6, and leaves host bits to the server", () => {
    expect(["10.0.0.0/8", "2001:db8::/32", "10.0.0.1/8", "::/0"].map(looksLikeNetwork)).toEqual([true, true, true, true]);
    expect(["10.0.0.0", "10.0.0.0/33", "300.0.0.0/8", "2001:db8::/129", "hello/8", "10.0.0.0/8/1", ""].map(looksLikeNetwork)).toEqual([false, false, false, false, false, false, false]);
  });
  it("makes a network of one's own address, when it is one", () => {
    expect([ownNetwork("203.0.113.7"), ownNetwork("2001:db8::7"), ownNetwork("local"), ownNetwork(null)]).toEqual(["203.0.113.7/32", "2001:db8::7/128", null, null]);
  });
});

describe("what a save sends", () => {
  it("is nothing when nothing changed", () => {
    expect(accessPatch(initial, same)).toEqual({});
  });
  it("sends only what changed: networks with their mode, none as null, minutes, the list, the notice", () => {
    expect(accessPatch(initial, { ...same, mode: "report", networks: [" 192.0.2.0/24 ", ""] })).toEqual({ staff_networks: { networks: ["192.0.2.0/24"], mode: "report" } });
    expect(accessPatch(initial, { ...same, networks: [] })).toEqual({ staff_networks: null });
    expect(accessPatch(initial, { ...same, idle: "15", breakGlass: ["a"], notice: true })).toEqual({ idle_minutes: 15, break_glass: ["a"], new_device_notice: true });
    expect(accessPatch({ ...initial, break_glass: ["a"] }, { ...same, breakGlass: null })).toEqual({ break_glass: null });
    expect(accessPatch({ ...initial, idle_minutes: 15 }, { ...same, idle: "" })).toEqual({ idle_minutes: 0 });
  });
});

describe("step-up and recorded reads", () => {
  // crates/kernel/src/controls.rs check_step_up: the server keeps `work` sorted by name and fills `keys: true`.
  const kept = { minutes: 5, entities: { Employee: { work: ["delete", "export", "read", "write"], keys: true }, Payslip: { work: ["read"], keys: false } } };
  const withKept: AccessSettings = { ...initial, step_up: kept, record_reads: { Payslip: "all", Employee: "open" } };
  const form = { ...same, stepUp: { minutes: stepUpMinutes(kept), rows: stepUpRows(kept) }, reads: [{ entity: "Employee", level: "open" as const }, { entity: "Payslip", level: "all" as const }] };

  it("is nothing when the form is what was read, whatever order the server listed", () => {
    expect(accessPatch(withKept, form)).toEqual({});
    expect(accessPatch(initial, { ...same, stepUp: { minutes: "10", rows: [] }, reads: [{ entity: "", level: "open" }] })).toEqual({});
  });
  it("sends the whole setting when one rule changes, and null when the last is removed", () => {
    const rows = stepUpRows(kept).map((r) => (r.entity === "Payslip" ? { ...r, work: [...r.work, "write" as const], refuseKeys: false } : r));
    expect(accessPatch(withKept, { ...form, stepUp: { minutes: "5", rows } })).toEqual({ step_up: { minutes: 5, entities: { Employee: { work: ["write", "delete", "export", "read"], keys: true }, Payslip: { work: ["write", "read"], keys: true } } } });
    expect(accessPatch(withKept, { ...form, stepUp: { minutes: "5", rows: [] }, reads: [] })).toEqual({ step_up: null, record_reads: null });
    expect(accessPatch(withKept, { ...form, reads: [{ entity: "Employee", level: "all" }, form.reads[1]] })).toEqual({ record_reads: { Employee: "all", Payslip: "all" } });
  });
  it("leaves a row not yet filled in out, and takes 10 minutes when none is typed", () => {
    expect(stepUpValue("", [{ entity: "A", work: ["read"], refuseKeys: false }, { entity: "", work: ["write"], refuseKeys: false }])).toEqual({ minutes: 10, entities: { A: { work: ["read"], keys: true } } });
    expect(readsValue([{ entity: "", level: "all" }])).toBeNull();
  });
});
