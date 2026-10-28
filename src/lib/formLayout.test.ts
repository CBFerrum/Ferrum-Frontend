import { describe, expect, it } from "vitest";
import {
  addSection,
  checkLayout,
  layoutOf,
  layoutOp,
  moveField,
  moveSection,
  removeField,
  removeSection,
  renameTab,
  sameLayout,
  setSectionTab,
  tabsOf,
  toForm,
  unplaced,
  type LayoutSection,
} from "./formLayout";

const fields = ["title", "status", "owner", "notes", "due"].map((name) => ({ name }));
const sec = (key: string, f: string[], tab: string | null = null): LayoutSection => ({
  key,
  label: key,
  fields: f,
  columns: 2,
  collapsible: false,
  tab,
  visible_if: null,
});
const names = (l: LayoutSection[]) => l.map((s) => `${s.key}:${s.fields.join(",")}`);

describe("layoutOf", () => {
  it("starts from one section with every field when the entity has no layout", () => {
    expect(names(layoutOf({ form: [], fields }))).toEqual(["s0:title,status,owner,notes,due"]);
  });
  it("drops unknown and repeated fields and keeps tabs and conditions", () => {
    const l = layoutOf({
      form: [
        { label: "Main", fields: ["title", "gone", "status"], tab: "Details" },
        { label: null, fields: ["status", "notes"], columns: 1, visible_if: "doc.status == 'Open'" },
      ],
      fields,
    });
    expect(names(l)).toEqual(["s0:title,status", "s1:notes"]);
    expect([l[0].tab, l[1].tab, l[1].columns, l[1].visible_if]).toEqual(["Details", null, 1, "doc.status == 'Open'"]);
    expect(unplaced(l, { fields })).toEqual(["owner", "due"]);
  });
});

describe("fields", () => {
  const l = [sec("s0", ["title", "status", "owner"]), sec("s1", ["notes"])];
  it("moves within a section like arrayMove", () => {
    expect(names(moveField(l, "title", "s0", 2))).toEqual(["s0:status,owner,title", "s1:notes"]);
    expect(names(moveField(l, "owner", "s0", 0))).toEqual(["s0:owner,title,status", "s1:notes"]);
  });
  it("moves across sections, places unplaced fields and clamps the index", () => {
    expect(names(moveField(l, "status", "s1", 0))).toEqual(["s0:title,owner", "s1:status,notes"]);
    expect(names(moveField(l, "due", "s1", 99))).toEqual(["s0:title,status,owner", "s1:notes,due"]);
  });
  it("removes a field to the additional fields", () => {
    const r = removeField(l, "status");
    expect(names(r)).toEqual(["s0:title,owner", "s1:notes"]);
    expect(unplaced(r, { fields })).toEqual(["status", "due"]);
  });
});

describe("sections and tabs", () => {
  const l = [sec("s0", ["title"]), sec("s1", ["status"], "More"), sec("s2", ["owner"]), sec("s3", ["notes"], "More")];
  it("orders tabs with the untabbed sections first", () => {
    expect(tabsOf(l)).toEqual([null, "More"]);
    expect(tabsOf([sec("s0", ["title"], "B"), sec("s1", ["notes"], "A")])).toEqual(["B", "A"]);
  });
  it("adds a section at the end of its tab or after another, with a fresh key", () => {
    const [a, key] = addSection(l, null);
    expect(key).toBe("s4");
    expect(a.map((s) => s.key)).toEqual(["s0", "s1", "s2", "s4", "s3"]);
    expect(addSection(l, "New")[0].map((s) => s.key)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(addSection(l, "More", "s1")[0].map((s) => s.key)).toEqual(["s0", "s1", "s4", "s2", "s3"]);
  });
  it("moves, removes and retabs sections", () => {
    expect(moveSection(l, "s0", 3).map((s) => s.key)).toEqual(["s1", "s2", "s3", "s0"]);
    expect(unplaced(removeSection(l, "s1"), { fields })).toEqual(["status", "due"]);
    const t = setSectionTab(l, "s0", "More");
    expect(t.map((s) => `${s.key}:${s.tab}`)).toEqual(["s1:More", "s2:null", "s3:More", "s0:More"]);
    expect(tabsOf(renameTab(l, "More", "  "))).toEqual([null]);
    expect(tabsOf(renameTab(l, "More", "Extra"))).toEqual([null, "Extra"]);
  });
});

describe("checks and saving", () => {
  it("applies the server's rules", () => {
    const bad = [sec("s0", ["title", "gone"]), { ...sec("s1", ["title"]), columns: 5 }];
    expect(checkLayout(bad, { fields }).map((p) => `${p.section}: ${p.message}`)).toEqual([
      "s0: The field gone no longer exists.",
      "s1: A section has 1 to 4 columns.",
      "s1: title is placed twice.",
    ]);
    expect(checkLayout([sec("s0", ["title"])], { fields })).toEqual([]);
  });
  it("saves without empty sections, trimmed, as a form customization", () => {
    const l = [{ ...sec("s0", ["title"], " Info "), label: "  ", visible_if: " doc.x " }, sec("s1", [])];
    expect(toForm(l)).toEqual([{ label: null, fields: ["title"], columns: 2, collapsible: false, tab: "Info", visible_if: "doc.x" }]);
    expect(layoutOp(l)).toEqual({ op: "set_entity_property", property: "form", value: toForm(l) });
    expect(sameLayout(l, [l[0]])).toBe(true);
    expect(sameLayout(l, moveField(l, "title", "s1", 0))).toBe(false);
  });
});
