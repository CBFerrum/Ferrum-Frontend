import { describe, expect, it } from "vitest";
import { layoutOf, sameLayout, tabsOf, toForm, type LayoutSection } from "../../lib/formLayout";
import { formSections } from "../../lib/formTabs";
import {
  conditionHint,
  containerOf,
  layoutSummary,
  layoutVersions,
  moveFieldToTab,
  normalize,
  nudgeField,
  nudgeSection,
  nudgeTab,
  placeSection,
  record,
  redo,
  removeTab,
  restorePlan,
  saveProblem,
  startHistory,
  tabNameProblem,
  undo,
  UNDO_LIMIT,
  type Customization,
} from "./logic";

const sec = (key: string, fields: string[], tab: string | null = null, extra: Partial<LayoutSection> = {}): LayoutSection => ({
  key,
  label: key.toUpperCase(),
  fields,
  columns: 2,
  collapsible: false,
  tab,
  visible_if: null,
  ...extra,
});
const keys = (l: LayoutSection[]) => l.map((s) => `${s.key}${s.tab ? `@${s.tab}` : ""}`).join(" ");

// Interleaved as a package may store it: tabs show in order null, More, Acc.
const mixed = [sec("a", ["title"]), sec("b", ["status"], "More"), sec("c", ["owner"]), sec("d", ["notes"], "Acc"), sec("e", ["due"], "More")];

describe("normalize", () => {
  it("groups sections by tab in the form's tab order, rendering the same form", () => {
    const n = normalize(mixed);
    expect(keys(n)).toBe("a c b@More e@More d@Acc");
    const view = (l: LayoutSection[]) => formSections({ form: toForm(l), fields: ["title", "status", "owner", "notes", "due"].map((name) => ({ name })) });
    expect(view(n).tabs).toEqual(view(mixed).tabs);
    expect(sameLayout(n, mixed)).toBe(false); // stored order differs, so compare normalized layouts only
  });
  it("returns the same array when already grouped", () => {
    const n = normalize(mixed);
    expect(normalize(n)).toBe(n);
  });
});

describe("section moves", () => {
  const l = normalize(mixed); // a c b@More e@More d@Acc
  it("reorders within a tab like arrayMove", () => {
    expect(keys(placeSection(l, "a", "c"))).toBe("c a b@More e@More d@Acc");
    expect(keys(placeSection(l, "e", "b"))).toBe("a c e@More b@More d@Acc");
    expect(placeSection(l, "a", "a")).toBe(l);
  });
  it("moves into another tab next to the target without reordering tabs", () => {
    expect(keys(placeSection(l, "d", "b"))).toBe("a c d@More b@More e@More");
    expect(keys(placeSection(l, "a", "e"))).toBe("c b@More a@More e@More d@Acc");
    expect(tabsOf(placeSection(l, "c", "d"))).toEqual([null, "More", "Acc"]);
  });
  it("nudges within the tab and stops at its ends", () => {
    expect(keys(nudgeSection(l, "e", -1))).toBe("a c e@More b@More d@Acc");
    expect(nudgeSection(l, "b", -1)).toBe(l);
    expect(nudgeSection(l, "d", 1)).toBe(l);
  });
});

describe("field moves", () => {
  const l = [sec("a", ["title", "status", "owner"]), sec("b", ["notes"], "More")];
  it("nudges within a section and stops at its ends", () => {
    expect(nudgeField(l, "status", 1)[0].fields).toEqual(["title", "owner", "status"]);
    expect(nudgeField(l, "title", -1)).toBe(l);
    expect(nudgeField(l, "due", 1)).toBe(l);
  });
  it("moves to the end of a tab's last section and knows each field's container", () => {
    const m = moveFieldToTab(l, "title", "More");
    expect(m.map((s) => s.fields)).toEqual([["status", "owner"], ["notes", "title"]]);
    expect(moveFieldToTab(l, "due", null)[0].fields).toEqual(["title", "status", "owner", "due"]);
    expect(moveFieldToTab(l, "title", "Nowhere")).toBe(l);
    expect([containerOf(l, "notes"), containerOf(l, "due")]).toEqual(["b", "palette"]);
  });
});

describe("tabs", () => {
  const l = normalize(mixed);
  it("moves labelled tabs; the untitled first tab stays first", () => {
    expect(tabsOf(nudgeTab(l, "Acc", -1))).toEqual([null, "Acc", "More"]);
    expect(nudgeTab(l, "More", -1)).toBe(l);
    expect(nudgeTab(l, "Acc", 1)).toBe(l);
    expect(nudgeTab(l, null, 1)).toBe(l);
    const allTabbed = [sec("x", [], "One"), sec("y", [], "Two")];
    expect(tabsOf(nudgeTab(allTabbed, "Two", -1))).toEqual(["Two", "One"]);
  });
  it("removing a tab moves its sections to the end of Details", () => {
    expect(keys(removeTab(l, "More"))).toBe("a c b e d@Acc");
  });
  it("checks tab names", () => {
    expect(tabNameProblem("  ", l)).toBe("Give the tab a name.");
    expect(tabNameProblem("more", l)).toBe("A tab with this name already exists.");
    expect(tabNameProblem("details", l)).toMatch(/untitled first tab/);
    expect(tabNameProblem("More", l, "More")).toBeNull();
    expect(tabNameProblem("ACC", l, "Acc")).toBeNull();
    expect(tabNameProblem("Shipping", l)).toBeNull();
  });
});

describe("undo history", () => {
  const a = [sec("a", ["title"])];
  const b = [sec("a", ["title", "status"])];
  const c = [sec("a", ["status"])];
  it("records, undoes and redoes; a new change drops the redo steps", () => {
    let h = record(record(startHistory(a), b), c);
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.present).toBe(b);
    h = redo(h);
    expect(h.present).toBe(c);
    h = record(undo(undo(h)), c);
    expect([h.past.length, h.future.length]).toEqual([1, 0]);
    expect(undo(startHistory(a)).present).toBe(a);
    expect(redo(startHistory(a)).present).toBe(a);
  });
  it("ignores no-ops, merges a group into one step and keeps a bounded stack", () => {
    const h = startHistory(a);
    expect(record(h, [sec("a", ["title"])])).toBe(h);
    const typed = record(record(record(h, b, "label:a"), c, "label:a"), b, "label:a");
    expect(typed.past).toHaveLength(1);
    expect(undo(typed).present).toBe(a);
    let long = h;
    for (let i = 0; i < UNDO_LIMIT + 20; i++) long = record(long, [sec("a", [`f${i}`])]);
    expect(long.past).toHaveLength(UNDO_LIMIT);
  });
});

describe("conditionHint", () => {
  const fields = ["status", "is_return", "items", "grand_total"];
  it("accepts what the preview can evaluate", () => {
    expect(conditionHint("", fields)).toBeNull();
    expect(conditionHint("doc.status == 'Open' && !doc.is_return", fields)?.tone).toBe("ok");
    expect(conditionHint("doc.docstatus == 1 || 'Manager' in user.roles", fields)?.tone).toBe("ok");
    expect(conditionHint("doc . status != null", fields)?.tone).toBe("ok");
  });
  it("tells when only the server can evaluate it", () => {
    expect(conditionHint("size(doc.items) > 0", fields)?.tone).toBe("info");
    expect(conditionHint("doc.items.exists(i, i.qty > 0)", fields)?.tone).toBe("info");
  });
  it("catches syntax slips", () => {
    expect(conditionHint("doc.status == 'Open", fields)).toEqual({ tone: "error", message: "A quoted text is not closed." });
    expect(conditionHint("(doc.is_return", fields)?.message).toMatch(/not closed/);
    expect(conditionHint("doc.is_return)", fields)?.message).toMatch(/do not match/);
    expect(conditionHint("doc.status = 'Open'", fields)?.message).toMatch(/==/);
    expect(conditionHint("doc.status === 'Open'", fields)?.message).toMatch(/===/);
    expect(conditionHint("doc.grand_total >= 10", fields)?.tone).toBe("ok");
  });
  it("warns about unknown fields and names, not text inside quotes", () => {
    expect(conditionHint("doc.statsu == 'Open'", fields, "Sales Invoice")?.message).toBe("doc.statsu is not a field of Sales Invoice.");
    expect(conditionHint("doc.a || doc.b", fields)?.message).toBe("doc.a, doc.b are not fields of this form.");
    expect(conditionHint("status == 'Open'", fields)?.message).toMatch(/Unknown name “status”/);
    expect(conditionHint("doc.status == 'doc.nothing here'", fields)?.tone).toBe("ok");
  });
});

describe("saveProblem", () => {
  const l = [sec("a", ["title"], null, { visible_if: "doc.x ===" }), sec("b", ["status", "notes"])];
  it("strips the prefix and points at the sections concerned", () => {
    const p = saveProblem("customization rejected: Customer: section condition 'doc.x ===': ERROR: <input>:1:7: Syntax error", l);
    expect(p).toEqual({ message: "Section condition 'doc.x ===': ERROR: <input>:1:7: Syntax error", sections: ["a"] });
    expect(saveProblem("customization rejected: Customer: the layout places unknown field notes", l).sections).toEqual(["b"]);
    expect(saveProblem("customization rejected: Customer: the layout places title twice", l).sections).toEqual(["a"]);
    expect(saveProblem("customization rejected: Customer: a section has 1 to 4 columns", [{ ...l[0], columns: 6 }, l[1]]).sections).toEqual(["a"]);
    expect(saveProblem("Something else went wrong.", l)).toEqual({ message: "Something else went wrong.", sections: [] });
  });
});

describe("saved versions", () => {
  const row = (seq: number, is_active: boolean, entity = "Customer", property = "form"): Customization => ({
    id: `id${seq}`,
    seq,
    entity,
    op: { op: "set_entity_property", property, value: [] },
    is_active,
    created_at: "2026-10-29T10:00:00Z",
  });
  const rows = [row(1, true), row(2, false), row(3, true, "Item"), row(4, true, "Customer", "label"), row(5, true), row(6, false)];
  it("lists the entity's form layouts newest first with the one in use", () => {
    const { versions, current } = layoutVersions(rows, "Customer");
    expect(versions.map((v) => v.seq)).toEqual([6, 5, 2, 1]);
    expect(current?.seq).toBe(5);
    expect(layoutVersions(rows, "Lead")).toEqual({ versions: [], current: null });
  });
  it("plans a restore: switch the target on, then later ones off", () => {
    const { versions } = layoutVersions(rows, "Customer");
    const byseq = (n: number) => versions.find((v) => v.seq === n)!;
    expect(restorePlan(versions, byseq(2))).toEqual([
      { id: "id2", active: true },
      { id: "id5", active: false },
    ]);
    expect(restorePlan(versions, byseq(1))).toEqual([{ id: "id5", active: false }]);
    expect(restorePlan(versions, byseq(6))).toEqual([{ id: "id6", active: true }]);
    expect(restorePlan(versions, null)).toEqual([
      { id: "id5", active: false },
      { id: "id1", active: false },
    ]);
  });
  it("summarizes a stored layout", () => {
    const value = toForm(layoutOf({ form: [{ label: "A", fields: ["x", "y"] }, { label: "B", fields: ["z"], tab: "More" }], fields: ["x", "y", "z"].map((name) => ({ name })) }));
    expect(layoutSummary(value)).toEqual({ tabs: 2, sections: 2, fields: 3 });
    expect(layoutSummary("not a layout")).toEqual({ tabs: 0, sections: 0, fields: 0 });
  });
});
