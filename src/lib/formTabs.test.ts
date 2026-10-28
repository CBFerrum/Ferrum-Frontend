import { describe, expect, it } from "vitest";
import { formSections } from "./formTabs";

const fields = ["customer", "date", "items", "terms", "account", "notes", "x_extra"].map((name) => ({ name }));

describe("formSections", () => {
  it("shows every field in one untitled section when there is no layout", () => {
    const { sections, tabs } = formSections({ form: [], fields });
    expect(tabs).toEqual([null]);
    expect(sections).toHaveLength(1);
    expect(sections[0].fields.map((f) => f.name)).toEqual(fields.map((f) => f.name));
  });

  it("keeps the builder's tab order and puts unplaced fields at the end of the first tab", () => {
    const { sections, tabs } = formSections({
      form: [
        { label: "Terms", fields: ["terms"], tab: "More" },
        { label: null, fields: ["customer", "date", "customer", "nope"] },
        { label: "Accounting", fields: ["account"], tab: "Accounting", visible_if: "doc.date != null" },
        { label: "Items", fields: ["items"] },
      ],
      fields,
    });
    expect(tabs).toEqual([null, "More", "Accounting"]);
    expect(sections.map((s) => [s.label, s.tab, s.fields.map((f) => f.name)])).toEqual([
      ["Terms", "More", ["terms"]],
      [null, null, ["customer", "date"]], // duplicates and unknown fields dropped, as the builder does
      ["Accounting", "Accounting", ["account"]],
      ["Items", null, ["items"]],
      ["Additional fields", null, ["notes", "x_extra"]],
    ]);
    expect(sections[2].visibleIf).toBe("doc.date != null");
  });

  it("starts with the first labelled tab when every section has one", () => {
    const { sections, tabs } = formSections({ form: [{ label: "A", fields: ["customer"], tab: "Main" }, { label: "B", fields: ["terms"], tab: "Other" }], fields });
    expect(tabs).toEqual(["Main", "Other"]);
    expect(sections.at(-1)).toMatchObject({ label: "Additional fields", tab: "Main" });
  });
});
