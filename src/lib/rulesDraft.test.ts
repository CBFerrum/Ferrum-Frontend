import { describe, expect, it } from "vitest";
import {
  aggregateChoices, aggregateLinks, aggregateTargets, checkRules, duplicateRule, isWithin, newAggregate, newLookup, newRule, newWrite, rulePart, rulesAreOdd, rulesFromSource, rulesToSource,
  type RuleItem,
} from "./rulesDraft";

const lookupRule = { id: "within_credit", entity: "Order", phase: "validate", when: "has(doc.party)", lookups: [{ name: "party", link: "party", fields: ["credit_limit"] }], check: "doc.total <= lookups.party.credit_limit", message: "Over the credit limit", ui_hint: { colour: "red" } };
const visit = {
  id: "unpaid",
  entity: "Visit",
  phase: "validate",
  field: "member",
  aggregates: [{ name: "unpaid", entity: "Charge", link: "member", to: "member", filter: [["status", "=", "Unpaid"]], op: "count" }],
  check: "aggregates.unpaid == 0",
  message: "This member has unpaid charges",
  audit_refusals: true,
};
const derive = { id: "band", entity: "Order", phase: "derive", writes: { x_band: "doc.total > 5 ? 'a' : 'b'" } };

describe("a source's rules as items and back", () => {
  it("round trips a rule with lookups, aggregates and a key it does not know", () => {
    const source = { id: "acme.rules", version: "1.0.0", parameters: { a: 1 }, rules: [lookupRule, visit, derive] };
    const items = rulesFromSource(source);
    expect(items.map((i) => !!i.rule)).toEqual([true, true, true]);
    expect(items[0].rule?.extra).toEqual({ ui_hint: { colour: "red" } });
    expect(rulesToSource(source, items)).toEqual(source);
  });

  it("keeps a rule it cannot represent exactly as it was, and says so", () => {
    const odd = { id: "r", entity: "A", phase: "validate", check: "true", message: "m", aggregates: [{ name: "x", entity: "B", link: "a", op: "count", filter: [["n", "in", [1, 2]]] }] };
    const weird = { id: "w", entity: "A", phase: "validate", check: "true", message: "m", lookups: [{ name: "l", link: "a", fields: ["b"], note: "x" }] };
    const source = { rules: [odd, weird, "not a rule"] };
    const items = rulesFromSource(source);
    expect(items.map((i) => i.raw !== undefined)).toEqual([true, true, true]);
    expect(rulesToSource(source, items).rules).toEqual(source.rules);
  });

  it("drops self from an aggregate's target, as the server does, and writes the rest as it reads it", () => {
    const source = { rules: [{ ...visit, aggregates: [{ ...visit.aggregates[0], to: "self" }] }] };
    const out = rulesToSource(source, rulesFromSource(source)).rules as { aggregates: Record<string, unknown>[] }[];
    expect("to" in out[0].aggregates[0]).toBe(false);
  });

  it("leaves a source without rules without a rules key, and keeps what it holds elsewhere", () => {
    const source = { id: "x", processes: [{ id: "p" }] };
    expect(rulesToSource(source, [])).toBe(source);
    expect(rulesAreOdd({ rules: {} })).toBe(true);
    expect(rulesAreOdd(source)).toBe(false);
  });

  it("writes a Visit refused while its member has unpaid charges", () => {
    const rule = newRule("Visit");
    Object.assign(rule, { id: "no_visit_while_unpaid", message: "This member has unpaid charges", check: "aggregates.unpaid == 0", field: "member", audit: true });
    const a = newAggregate();
    Object.assign(a, { name: "unpaid", op: "count", entity: "Charge", link: "member", to: "member" });
    a.filters = [{ key: "f", field: "status", op: "=", value: "Unpaid" }];
    rule.aggregates = [a];
    expect(rulesToSource({}, [{ key: rule.key, rule }]).rules).toEqual([
      {
        id: "no_visit_while_unpaid",
        entity: "Visit",
        phase: "validate",
        check: "aggregates.unpaid == 0",
        message: "This member has unpaid charges",
        field: "member",
        audit_refusals: true,
        aggregates: [{ name: "unpaid", entity: "Charge", link: "member", to: "member", filter: [["status", "=", "Unpaid"]], op: "count" }],
      },
    ]);
  });

  it("writes a sum with its field and leaves blank rows out", () => {
    const rule = newRule("Order");
    Object.assign(rule, { id: "r", phase: "derive" });
    rule.writes = [{ ...newWrite(), field: "x_owing", expr: "aggregates.due" }, newWrite()];
    const a = newAggregate();
    Object.assign(a, { name: "due", op: "sum", entity: "Invoice", link: "customer", to: "customer", field: "outstanding" });
    rule.aggregates = [a];
    const json = rulesToSource({}, [{ key: rule.key, rule }]).rules as Record<string, unknown>[];
    expect(json[0].writes).toEqual({ x_owing: "aggregates.due" });
    expect((json[0].aggregates as Record<string, unknown>[])[0]).toEqual({ name: "due", entity: "Invoice", link: "customer", to: "customer", op: "sum", field: "outstanding" });
  });

  it("duplicates with keys and an id of its own", () => {
    const [item] = rulesFromSource({ rules: [visit] });
    const copy = duplicateRule(item.rule!, ["unpaid", "unpaid_copy"]);
    expect(copy.id).toBe("unpaid_copy2");
    expect(copy.key).not.toBe(item.rule!.key);
    expect(copy.aggregates[0].key).not.toBe(item.rule!.aggregates[0].key);
    copy.aggregates[0].filters[0].value = "Paid";
    expect(item.rule!.aggregates[0].filters[0].value).toBe("Unpaid");
  });
});

const fields = { Visit: [{ name: "member", type: "link", to: "Member", label: "Member" }, { name: "site", type: "link", to: "Site", label: "Site" }, { name: "notes", type: "text", label: "Notes" }], Charge: [{ name: "member", type: "link", to: "Member", label: "Member" }, { name: "visit", type: "link", to: "Visit", label: "Visit" }, { name: "amount", type: "currency", label: "Amount" }, { name: "status", type: "select", label: "Status" }], Member: [{ name: "name", type: "data", label: "Name" }] } as const;
const meta = (name: keyof typeof fields) => ({ name, fields: fields[name] as unknown as Parameters<typeof aggregateChoices>[0]["fields"] });

describe("what an aggregate can point at", () => {
  it("offers the saved record and the record one of its links points to, where the link targets fit", () => {
    expect(aggregateChoices(meta("Visit"), meta("Charge"))).toEqual([
      { link: "visit", to: "" },
      { link: "member", to: "member" },
    ]);
    expect(aggregateLinks(meta("Visit"), meta("Charge"))).toEqual(["visit", "member"]);
    expect(aggregateTargets(meta("Visit"), meta("Charge"), "member")).toEqual(["member"]);
    expect(aggregateTargets(meta("Visit"), meta("Charge"), "visit")).toEqual([""]);
  });

  it("offers nothing where no link fits", () => {
    expect(aggregateChoices(meta("Visit"), meta("Member"))).toEqual([]);
    expect(aggregateChoices(meta("Member"), meta("Charge"))).toEqual([{ link: "member", to: "" }]);
  });
});

const ctx = { fieldsOf: (e: string) => (fields as unknown as Record<string, { name: string; type: string }[]>)[e] };
const one = (patch: (r: ReturnType<typeof newRule>) => void): RuleItem[] => {
  const r = newRule("Visit");
  Object.assign(r, { id: "r1", check: "true", message: "m" });
  patch(r);
  return [{ key: r.key, rule: r }];
};
const says = (items: RuleItem[]) => checkRules(items, ctx).map((p) => `${p.part}: ${p.message}`);

describe("checking rules before the compiler", () => {
  it("accepts a whole rule", () => {
    expect(says(one(() => {}))).toEqual([]);
    expect(says(rulesFromSource({ rules: [lookupRule, visit, derive] }))).toEqual([]);
  });

  it("asks for a name, a kind of record, a check and a message", () => {
    const out = says(one((r) => Object.assign(r, { id: " ", entity: "", check: "", message: "" })));
    expect(out.map((s) => s.split(":")[0])).toEqual(["id", "entity", "check", "message"]);
  });

  it("refuses a name twice and a field two rules fill", () => {
    const a = newRule("Order"), b = newRule("Order");
    Object.assign(a, { id: "x", phase: "derive", writes: [{ key: "1", field: "x_a", expr: "1" }] });
    Object.assign(b, { id: "y", phase: "derive", writes: [{ key: "2", field: "x_a", expr: "2" }] });
    expect(says([{ key: a.key, rule: a }, { key: b.key, rule: b }]).join("\n")).toContain("also filled in by rule");
    b.id = "x";
    expect(says([{ key: a.key, rule: a }, { key: b.key, rule: b }]).filter((s) => s.startsWith("id:"))).toHaveLength(2);
  });

  it("bounds linked records at 4, their fields at 16, and names them", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...newLookup(), name: `l${i}`, link: "member", fields: ["name"] }));
    expect(says(one((r) => (r.lookups = five)))).toContain("lookups: Rule 1: it reads at most 4 linked records.");
    const many = { ...newLookup(), name: "m", link: "member", fields: Array.from({ length: 17 }, (_, i) => `f${i}`) };
    expect(says(one((r) => (r.lookups = [many]))).join()).toContain("between 1 and 16");
    const bad = { ...newLookup(), name: "1 x", link: "member", fields: ["name"] };
    expect(says(one((r) => (r.lookups = [bad]))).join()).toContain("not a usable name");
  });

  it("bounds counts at 4 and conditions at 8, and shares names with lookups", () => {
    const agg = (name: string) => Object.assign(newAggregate(), { name, entity: "Charge", link: "member" });
    expect(says(one((r) => (r.aggregates = ["a", "b", "c", "d", "e"].map(agg)))).join()).toContain("at most 4 sets of records");
    const l = { ...newLookup(), name: "same", link: "member", fields: ["name"] };
    expect(says(one((r) => ((r.lookups = [l]), (r.aggregates = [agg("same")])))).join()).toContain("both called “same”");
    const nine = agg("n");
    nine.filters = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, field: "status", op: "=", value: "Open" }));
    expect(says(one((r) => (r.aggregates = [nine]))).join()).toContain("at most 8 conditions");
  });

  it("wants the number a total adds up, and conditions that fit their field", () => {
    const sum = Object.assign(newAggregate(), { name: "t", op: "sum", entity: "Charge", link: "member" });
    expect(says(one((r) => (r.aggregates = [sum]))).join()).toContain("choose the number that total 1 adds up");
    const c = Object.assign(newAggregate(), { name: "t", entity: "Charge", link: "member", filters: [{ key: "k", field: "amount", op: ">", value: "lots" }, { key: "j", field: "status", op: "=", value: "" }] });
    const out = says(one((r) => (r.aggregates = [c])));
    expect(out).toEqual(["aggregates/0/filter/0: Rule 1: condition 1 of count or total 1 needs a number.", "aggregates/0/filter/1: Rule 1: finish condition 2 of count or total 1, or remove it."]);
  });

  it("bounds what one save reads across the rules of an entity", () => {
    const rules = Array.from({ length: 9 }, (_, i) => {
      const r = newRule("Visit");
      Object.assign(r, { id: `r${i}`, check: "true", message: "m", aggregates: [Object.assign(newAggregate(), { name: "a", entity: "Charge", link: "member", filters: [{ key: `k${i}`, field: "status", op: "=", value: `v${i}` }] })] });
      return { key: r.key, rule: r };
    });
    expect(says(rules).join()).toContain("count or add up 9 different sets of records in one save: at most 8");
  });
});

describe("where a diagnostic points", () => {
  it("names the rule and the part", () => {
    expect(rulePart("/rules/2/check")).toEqual({ rule: 2, part: "check" });
    expect(rulePart("/rules/0/lookups/1/fields")).toEqual({ rule: 0, part: "lookups/1/fields" });
    expect(rulePart("/rules/1/aggregates/0/filter/2")).toEqual({ rule: 1, part: "aggregates/0/filter/2" });
    expect(rulePart("/rules/3/writes/x_band")).toEqual({ rule: 3, part: "writes/x_band" });
    expect(rulePart("/rules/4")).toEqual({ rule: 4, part: "" });
    expect(rulePart("/processes/0/nodes/1")).toBeNull();
    expect(rulePart("/")).toBeNull();
  });

  it("puts a message on the part it is inside", () => {
    expect(isWithin("aggregates/1/filter/0", "aggregates/1")).toBe(true);
    expect(isWithin("aggregates/10", "aggregates/1")).toBe(false);
    expect(isWithin("check", "check")).toBe(true);
  });
});
