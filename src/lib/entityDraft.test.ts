import { describe, expect, it } from "vitest";
import {
  addField, buildBatch, checkDraft, entityDefs, entityName, fieldName, fromDef, gatherLines, linesName, markSaved, moveField, nextNumber, parseNumbering, patchField, removeField,
  savedDefs, setEntityLabel, setFieldLabel, signature, startDraft, startField, startLines, startTotal, type Draft, type Raw,
} from "./entityDraft";

const ALL_TYPES = ["data", "text", "markdown", "code", "int", "decimal", "currency", "percent", "date", "datetime", "check", "select", "link", "json", "email", "phone", "url", "attach", "color"];

/** A saved entity with a field of every type, a unique combination, a lines table, both kinds of total and a property the designer does not know. */
const lines: Raw = {
  name: "XMembershipCharges",
  label: "Membership Charges",
  kind: "child",
  fields: [
    { name: "description", label: "Description", type: "data", required: true },
    { name: "amount", label: "Amount", type: "currency", min: "0", in_list: true, widget: "money" },
  ],
};
const everyType = ALL_TYPES.map((type) => ({
  name: `f_${type}`, label: type, type,
  ...(type === "select" ? { options: ["Gold", "Silver"], default: "Gold" } : {}),
  ...(type === "link" ? { to: "Customer" } : {}),
  ...(type === "int" ? { default: 3, min: "1", max: "9" } : {}),
  ...(type === "decimal" ? { precision: 3, default: "1.500" } : {}),
  ...(type === "data" ? { max_length: 40, required: true, unique: true, in_filter: true, visible_if: "doc.f_check", description: "Hello" } : {}),
  ...(type === "check" ? { default: true } : {}),
}));
const membership: Raw = {
  name: "XMembership",
  label: "Membership",
  label_plural: "Memberships",
  kind: "document",
  submittable: true,
  description: "Who belongs",
  title_field: "member_no",
  numbering: { template: "MEM-{seq:5}" },
  search_fields: ["member_no"],
  fields: [
    { name: "member_no", label: "Member number", type: "data", unique: true },
    ...everyType,
    { name: "charges", label: "Charges", type: "table", of: "XMembershipCharges" },
    { name: "total", label: "Total", type: "currency", read_only: true, rollup: { table: "charges", op: "sum", field: "amount" } },
    { name: "charge_count", label: "Number of charges", type: "int", read_only: true, rollup: { table: "charges", op: "count" } },
  ],
  unique: [["member_no", "f_email"]],
};

const loaded = () => fromDef(membership, { XMembershipCharges: lines }, ["Customer", "XMembership", "XMembershipCharges"]);
const defsOf = (d: Draft) => buildBatch(d, {}).ops.map((o) => (o.op as { entity: Raw }).entity);
const messages = (d: Draft) => checkDraft(d).map((p) => p.message);

/** A new entity "Membership" the way a person builds it. */
function built(): Draft {
  let d = startDraft(["Customer"]);
  d = setEntityLabel(d, "Membership");
  d.entity.kind = "document";
  d.entity.numbering = { prefix: "MEM-", digits: 5 };
  d.entity = addField(d.entity, { ...startField("data", "Member number"), unique: true, required: true });
  const table = startLines("Charges");
  d.entity = addField(d.entity, table);
  const rows = d.entity.fields[1].lines!;
  d.entity.fields[1] = { ...d.entity.fields[1], lines: addField({ ...rows, fields: [] }, { ...startField("currency", "Amount"), required: true }) };
  d.entity.fields[1].lines = addField(d.entity.fields[1].lines!, startField("data", "Description"));
  const table2 = d.entity.fields[1];
  d.entity = addField(d.entity, startTotal(table2, table2.lines!.fields[0]));
  d.entity.title = d.entity.fields[0].key;
  return d;
}

describe("names", () => {
  it("derive a field name from its label, avoiding the system's names and clashes", () => {
    expect(fieldName("Membership fee")).toBe("membership_fee");
    expect(fieldName("Café  & Bar!")).toBe("cafe_bar");
    expect(fieldName("2nd address")).toBe("f_2nd_address");
    expect(fieldName("بطاقة")).toBe("field");
    expect(fieldName("Number")).toBe("number_2");
    expect(fieldName("Id")).toBe("id_2");
    expect(fieldName("Amount", ["amount", "amount_2"])).toBe("amount_3");
  });

  it("derive an entity name that starts with X and avoids what exists", () => {
    expect(entityName("Membership fee")).toBe("XMembershipFee");
    expect(entityName("membership", ["XMembership"])).toBe("XMembership2");
    expect(entityName("")).toBe("XRecord");
    expect(entityName("!!!")).toBe("XRecord");
    expect(linesName("XMembership", "charges")).toBe("XMembershipCharges");
    expect(linesName("XMembership", "line_items", ["XMembershipLineItems"])).toBe("XMembershipLineItems2");
  });

  it("follows the label until the name is typed or saved", () => {
    let d = setEntityLabel(startDraft([]), "Gym member");
    expect(d.entity.name).toBe("XGymMember");
    d = { ...d, entity: { ...d.entity, nameTouched: true } };
    expect(setEntityLabel(d, "Other").entity.name).toBe("XGymMember");
    let e = addField(d.entity, startField("data", "Plan"));
    const key = e.fields[0].key;
    e = setFieldLabel(e, key, "Plan type");
    expect(e.fields[0].name).toBe("plan_type");
    e = patchField(e, key, { saved: true });
    expect(setFieldLabel(e, key, "Tier").fields[0].name).toBe("plan_type");
  });
});

describe("a definition and its draft", () => {
  it("round trips a definition with every field type, a unique combination, lines and both totals, keeping what it does not know", () => {
    const ops = buildBatch(loaded(), {}).ops;
    expect(ops.map((o) => o.entity)).toEqual(["XMembershipCharges", "XMembership"]);
    expect((ops[1].op as { entity: Raw }).entity).toEqual(membership);
    expect((ops[0].op as { entity: Raw }).entity).toEqual(lines);
    const parent = (ops[1].op as { entity: { fields: Raw[]; search_fields: unknown } }).entity;
    expect(parent.search_fields).toEqual(["member_no"]);
    expect(parent.fields.find((f) => f.name === "total")).toEqual(membership.fields && (membership.fields as Raw[]).find((f) => f.name === "total"));
    expect(((ops[0].op as { entity: { fields: Raw[] } }).entity.fields[1]).widget).toBe("money");
  });

  it("is no change to load a definition and save it as it is", () => {
    const d = loaded();
    expect(buildBatch(d, savedDefs(d)).ops).toEqual([]);
  });

  it("keeps a numbering the designer does not build", () => {
    const d = fromDef({ ...membership, numbering: { template: "{YYYY}-{seq:4}", gapless: true } }, { XMembershipCharges: lines });
    expect(d.entity.numbering).toBeNull();
    expect(defsOf(d)[1].numbering).toEqual({ template: "{YYYY}-{seq:4}", gapless: true });
    expect(loaded().entity.numbering).toEqual({ prefix: "MEM-", digits: 5 });
  });

  it("builds the entity a person makes, with the names derived", () => {
    const [child, parent] = defsOf(built());
    expect(parent).toEqual({
      name: "XMembership", label: "Membership", kind: "document", submittable: true, title_field: "member_number", numbering: { template: "MEM-{seq:5}" },
      fields: [
        { name: "member_number", label: "Member number", type: "data", required: true, unique: true },
        { name: "charges", label: "Charges", type: "table", of: "XMembershipCharges" },
        { name: "total_amount", label: "Total Amount", type: "currency", read_only: true, rollup: { table: "charges", op: "sum", field: "amount" } },
      ],
    });
    expect(child).toEqual({
      name: "XMembershipCharges", label: "Membership Charges", kind: "child",
      fields: [{ name: "amount", label: "Amount", type: "currency", required: true }, { name: "description", label: "Description", type: "data" }],
    });
  });

  it("does not let a line field be unique", () => {
    const d = built();
    d.entity.fields[1].lines!.fields[0].unique = true;
    expect(JSON.stringify(defsOf(d)[0])).not.toContain("unique");
  });
});

describe("the batch", () => {
  it("creates lines first and then the entity, each with define_entity", () => {
    const { ops, plan } = buildBatch(built(), {}, "Entity designer");
    expect(ops.map((o) => [o.entity, (o.op as { op: string }).op, o.note])).toEqual([
      ["XMembershipCharges", "define_entity", "Entity designer"],
      ["XMembership", "define_entity", "Entity designer"],
    ]);
    expect(plan).toEqual([
      { name: "XMembershipCharges", label: "Membership Charges", lines: true, action: "create" },
      { name: "XMembership", label: "Membership", lines: false, action: "create" },
    ]);
  });

  it("redefines only the parent when only the parent changed", () => {
    const d = loaded();
    const saved = savedDefs(d);
    const next = { ...d, entity: { ...d.entity, description: "Changed" } };
    expect(buildBatch(next, saved).ops.map((o) => [o.entity, (o.op as { op: string }).op])).toEqual([["XMembership", "redefine_entity"]]);
  });

  it("redefines only the lines when only the lines changed", () => {
    const d = loaded();
    const saved = savedDefs(d);
    const table = d.entity.fields.find((f) => f.type === "table")!;
    const rows = addField(table.lines!, startField("date", "Charged on"));
    const next = { ...d, entity: patchField(d.entity, table.key, { lines: rows }) };
    const { ops } = buildBatch(next, saved);
    expect(ops.map((o) => [o.entity, (o.op as { op: string }).op])).toEqual([["XMembershipCharges", "redefine_entity"]]);
    expect((ops[0].op as { entity: { fields: Raw[] } }).entity.fields.at(-1)).toEqual({ name: "charged_on", label: "Charged on", type: "date" });
  });

  it("defines a new lines table first and redefines the parent that now points at it", () => {
    const d = loaded();
    const saved = savedDefs(d);
    const next = { ...d, entity: addField(d.entity, startLines("Payments")) };
    const { ops, plan } = buildBatch(next, saved);
    expect(ops.map((o) => [o.entity, (o.op as { op: string }).op])).toEqual([["XMembershipPayments", "define_entity"], ["XMembership", "redefine_entity"]]);
    expect(plan.map((p) => p.action)).toEqual(["create", "change"]);
    const parent = (ops[1].op as { entity: { fields: Raw[] } }).entity.fields.at(-1);
    expect(parent).toMatchObject({ name: "payments", type: "table", of: "XMembershipPayments" });
  });

  it("is what was saved after a save", () => {
    const d = markSaved(built());
    expect(buildBatch(d, savedDefs(d)).ops).toEqual([]);
    expect(d.entity.fields.every((f) => f.saved)).toBe(true);
    expect(d.taken).toContain("XMembershipCharges");
    expect(signature(d)).toBe(signature(markSaved(d)));
  });

  it("removes a field from the groups and the title when it is removed", () => {
    const d = loaded();
    const key = d.entity.fields.find((f) => f.name === "f_email")!.key;
    const e = removeField(d.entity, key);
    expect(e.unique).toEqual([]);
    const title = removeField(d.entity, d.entity.fields[0].key);
    expect(title.title).toBe("");
  });

  it("moves a field among the fields that are shown", () => {
    const d = loaded();
    const plain = (f: { type: string; rollup: unknown }) => f.type !== "table" && !f.rollup;
    const names = (e: typeof d.entity) => e.fields.filter(plain).slice(0, 2).map((f) => f.name);
    expect(names(moveField(d.entity, d.entity.fields[1].key, -1, plain))).toEqual(["f_data", "member_no"]);
    expect(moveField(d.entity, d.entity.fields[0].key, -1, plain)).toBe(d.entity);
  });
});

describe("what is checked before saving", () => {
  const ok = () => built();

  it("accepts what a person built", () => {
    expect(messages(ok())).toEqual([]);
    expect(messages(loaded())).toEqual([]);
  });

  it("wants labels and an entity name that is free", () => {
    const d = ok();
    d.entity.label = " ";
    d.entity.fields[0].label = "";
    expect(messages(d)).toEqual(expect.arrayContaining(["Give the entity a label.", "Every field needs a label."]));
    const clash = { ...ok(), taken: ["XMembership"] };
    expect(messages(clash)[0]).toBe("Something is already called “XMembership”: choose another name.");
    const bad = ok();
    bad.entity.name = "membership";
    expect(messages(bad)[0]).toContain("cannot be used");
  });

  it("wants field names that are unique and not the system's", () => {
    const d = ok();
    d.entity = addField(d.entity, { ...startField("data", "Again"), name: "member_number" });
    d.entity = addField(d.entity, { ...startField("data", "Mine"), name: "created_at" });
    expect(messages(d)).toEqual(expect.arrayContaining(["Two fields are called “member_number”: give each its own name.", "“created_at” is a name the system keeps for itself: choose another for Mine."]));
  });

  it("wants choices for a Choice and a target for a Link", () => {
    const d = ok();
    d.entity = addField(d.entity, startField("select", "Tier"));
    d.entity = addField(d.entity, startField("link", "Owner"));
    expect(messages(d)).toEqual(["A choice needs choices: list them for Tier.", "Choose what Owner links to."]);
    const fixed = patchField(patchField(d.entity, d.entity.fields[3].key, { options: ["Gold", " ", "Gold"] }), d.entity.fields[4].key, { to: "Customer" });
    expect(checkDraft({ ...d, entity: fixed }).map((p) => p.message)).toEqual(["Tier lists the same choice twice."]);
  });

  it("wants numbers where numbers go", () => {
    const d = ok();
    d.entity = addField(d.entity, { ...startField("decimal", "Rate"), precision: "x", min: "5", max: "2" });
    expect(messages(d)).toEqual(["The digits after the point of Rate must be a whole number.", "The smallest value of Rate is larger than its largest."]);
  });

  it("wants a total to have its lines and a numeric field", () => {
    let d = ok();
    const total = d.entity.fields[2];
    d.entity = patchField(d.entity, total.key, { rollup: { table: "gone", op: "sum", field: "" } });
    expect(messages(d)).toEqual(["The total Total Amount needs a lines table to add up."]);
    d = ok();
    const rows = d.entity.fields[1].lines!;
    d.entity.fields[2] = { ...d.entity.fields[2], rollup: { table: d.entity.fields[1].key, op: "sum", field: rows.fields[1].key } };
    expect(messages(d)).toEqual(["The total Total Amount adds up “Description”, which is not a number."]);
    d.entity.fields[2] = { ...d.entity.fields[2], rollup: { table: d.entity.fields[1].key, op: "sum", field: "" } };
    expect(messages(d)).toEqual(["The total Total Amount needs a field of Charges to add up."]);
    d.entity.fields[2] = { ...d.entity.fields[2], rollup: { table: d.entity.fields[1].key, op: "count", field: "" } };
    expect(messages(d)).toEqual([]);
  });

  it("wants lines that have fields, and a lines entity used by one table only", () => {
    const d = ok();
    d.entity.fields[1].lines!.fields = [];
    expect(messages(d)).toContain("The lines “Charges” need at least one field.");
    const shared = loaded();
    const table = shared.entity.fields.find((f) => f.type === "table")!;
    shared.entity = addField(shared.entity, { ...startLines("Again"), lines: table.lines });
    expect(messages(shared)).toContain("XMembershipCharges is the lines of 2 tables: each lines table needs its own.");
  });

  it("wants unique combinations of two fields at least, and no repeats", () => {
    const d = ok();
    const [a] = d.entity.fields;
    d.entity.unique = [[a.key], [a.key, a.key]];
    expect(messages(d)).toEqual(["A unique combination needs at least two different fields.", "A unique combination needs at least two different fields."]);
    d.entity = addField(d.entity, startField("data", "Other"));
    const b = d.entity.fields.at(-1)!;
    d.entity.unique = [[a.key, b.key], [b.key, a.key]];
    expect(messages(d)).toEqual(["The same unique combination is listed twice."]);
  });

  it("wants numbering that fits", () => {
    const d = ok();
    d.entity.numbering = { prefix: "{x}", digits: 0 };
    expect(messages(d)).toEqual(["Numbers have between 1 and 12 digits.", "The start of a number cannot contain curly brackets."]);
  });
});

describe("numbering", () => {
  it("shows the next number it would give", () => {
    expect(nextNumber("MEM-{seq:5}")).toBe("MEM-00001");
    expect(nextNumber("{YYYY}/{MM}/{DD}-{seq:3}", new Date(2026, 10, 9))).toBe("2026/11/09-001");
    expect(nextNumber("{YY}{seq:2}", new Date(2026, 0, 1))).toBe("2601");
  });

  it("reads back a template the designer builds", () => {
    expect(parseNumbering("MEM-{seq:5}")).toEqual({ prefix: "MEM-", digits: 5 });
    expect(parseNumbering("{seq:3}")).toEqual({ prefix: "", digits: 3 });
    expect(parseNumbering("{YYYY}-{seq:3}")).toBeNull();
  });
});

it("a new lines table starts with a field that already has a name", () => {
  const table = startLines("Items");
  expect(table.lines?.fields[0].name).toBe("description");
});

describe("a definition as it is now, with what other screens added", () => {
  const now: Raw = {
    name: "XTask", label: "Task", kind: "document", submittable: true,
    fields: [
      { name: "title", label: "Title", type: "data", required: true, default_expr: "'New'", hidden: false },
      { name: "state", label: "State", type: "select", options: ["Open", "Done"], read_only: true },
    ],
    rules: [{ name: "needs_title", check: "doc.title != ''", message: "A task needs a title", on: "save" }],
    actions: [
      { name: "finish", label: "Finish", confirm: "Finish it?", roles: ["Manager"], refuse_if: [{ when: "doc.state == 'Done'", message: "already done" }], effects: [{ type: "set_fields", values: { state: "'Done'" } }, { type: "update_linked", link: "project", values: { open: "false" } }] },
    ],
  };
  it("keeps the rules, the buttons with their effects and the field properties it does not show", () => {
    const d = fromDef(now, {}, ["XTask"]);
    const [def] = entityDefs(d);
    expect(def.def.rules).toEqual(now.rules);
    expect(def.def.actions).toEqual(now.actions);
    expect((def.def.fields as Raw[])[0]).toMatchObject({ default_expr: "'New'", hidden: false });
    expect((def.def.fields as Raw[])[1]).toMatchObject({ read_only: true });
    // Loading it is no change, and a change to a label still sends them back.
    expect(buildBatch(d, savedDefs(d)).ops).toEqual([]);
    const edited = { ...d, entity: { ...d.entity, label: "Job" } };
    const ops = buildBatch(edited, savedDefs(d)).ops;
    expect(ops).toHaveLength(1);
    expect((ops[0].op.entity as Raw).actions).toEqual(now.actions);
    expect((ops[0].op.entity as Raw).rules).toEqual(now.rules);
  });
});

describe("lines within lines", () => {
  const evidence: Raw = { name: "XControlTestsEvidence", label: "Control Tests Evidence", kind: "child", fields: [{ name: "title", label: "Title", type: "data", required: true }, { name: "amount", label: "Amount", type: "decimal" }] };
  const tests: Raw = {
    name: "XControlTests", label: "Control Tests", kind: "child",
    fields: [
      { name: "name", label: "Name", type: "data" },
      { name: "evidence", label: "Evidence", type: "table", of: "XControlTestsEvidence" },
      { name: "spent", label: "Spent", type: "decimal", read_only: true, rollup: { table: "evidence", op: "sum", field: "amount" } },
    ],
  };
  const control: Raw = {
    name: "XControl", label: "Control", kind: "master",
    fields: [{ name: "code", label: "Code", type: "data" }, { name: "tests", label: "Tests", type: "table", of: "XControlTests" }, { name: "total", label: "Total", type: "decimal", read_only: true, rollup: { table: "tests", op: "sum", field: "spent" } }],
  };
  const defs: Record<string, Raw> = { XControlTests: tests, XControlTestsEvidence: evidence };
  const load = () => fromDef(control, gatherLines(control, (n) => defs[n]), ["XControl", "XControlTests", "XControlTestsEvidence"]);

  it("gathers the lines and their lines, and no third level", () => {
    expect(Object.keys(gatherLines(control, (n) => defs[n]))).toEqual(["XControlTests", "XControlTestsEvidence"]);
    const deeper = { ...evidence, fields: [...(evidence.fields as Raw[]), { name: "more", label: "More", type: "table", of: "XMore" }] };
    expect(Object.keys(gatherLines(control, (n) => ({ ...defs, XControlTestsEvidence: deeper, XMore: { name: "XMore", fields: [] } })[n]))).toEqual(["XControlTests", "XControlTestsEvidence"]);
  });

  it("round trips a two-level entity, sub-lines first, then lines, then the record", () => {
    const d = load();
    const ops = buildBatch(d, {}).ops;
    expect(ops.map((o) => o.entity)).toEqual(["XControlTestsEvidence", "XControlTests", "XControl"]);
    expect(ops.map((o) => (o.op as { entity: Raw }).entity)).toEqual([evidence, tests, control]);
    expect(buildBatch(d, savedDefs(d)).ops).toEqual([]);
    expect(checkDraft(d)).toEqual([]);
  });

  it("names and orders the sub-lines of a new entity, and is saved afterwards", () => {
    let d = setEntityLabel(startDraft([]), "Control");
    const tests = startLines("Tests");
    tests.lines = addField(addField(tests.lines!, startField("data", "Name")), startLines("Evidence"));
    d.entity = addField(d.entity, tests);
    const batch = buildBatch(d, {});
    expect(batch.ops.map((o) => o.entity)).toEqual(["XControlTestsEvidence", "XControlTests", "XControl"]);
    expect(batch.plan.map((p) => [p.lines, p.action])).toEqual([[true, "create"], [true, "create"], [false, "create"]]);
    expect(((batch.ops[1].op as { entity: { fields: Raw[] } }).entity.fields.find((f) => f.type === "table"))).toMatchObject({ name: "evidence", of: "XControlTestsEvidence" });
    expect(checkDraft(d)).toEqual([]);
    d = markSaved(d);
    expect(buildBatch(d, savedDefs(d)).ops).toEqual([]);
    expect(d.taken).toEqual(expect.arrayContaining(["XControl", "XControlTests", "XControlTestsEvidence"]));
  });

  it("redefines only the sub-lines when only they changed", () => {
    const d = load();
    const line = d.entity.fields[1].lines!;
    const inner = line.fields.find((f) => f.type === "table")!;
    line.fields = line.fields.map((f) => (f === inner ? { ...f, lines: addField(f.lines!, startField("data", "Note")) } : f));
    expect(buildBatch(d, savedDefs(load())).ops.map((o) => [o.entity, (o.op as { op: string }).op])).toEqual([["XControlTestsEvidence", "redefine_entity"]]);
  });

  it("does not let sub-lines hold a third level, nor a line total over a missing table", () => {
    const d = load();
    const inner = d.entity.fields[1].lines!.fields.find((f) => f.type === "table")!;
    inner.lines = addField(inner.lines!, startLines("More"));
    expect(messages(d)).toContain("The lines “Evidence” cannot hold lines of their own.");
    expect(messages(load())).not.toContain("The lines “Tests” cannot hold lines of their own.");
    const t = load();
    const line = t.entity.fields[1].lines!;
    line.fields = line.fields.filter((f) => f.type !== "table");
    expect(messages(t)).toContain("The total Spent needs a lines table to add up.");
  });
});
