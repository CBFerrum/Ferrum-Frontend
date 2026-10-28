// The document form's sections and tabs, from the same layout model as the form builder (formLayout.ts),
// so the two never disagree: tabs in the builder's order (untitled sections first, then labelled tabs
// as they first appear), and fields no section places as "Additional fields" at the end of the first
// tab (not of the last one, which may be conditional or unrelated).

import { layoutOf, tabsOf, unplaced, type FormSection } from "./formLayout";

export interface FormViewSection<F> {
  key: string;
  label: string | null;
  columns: number;
  collapsible: boolean;
  /** `null` is the untitled first tab. */
  tab: string | null;
  /** Condition on `doc`; the section shows unless it evaluates to false (as a field's `visible_if`). */
  visibleIf: string | null;
  fields: F[];
}

export function formSections<F extends { name: string }>(meta: { form: FormSection[]; fields: F[] }): { sections: FormViewSection<F>[]; tabs: (string | null)[] } {
  const byName = new Map(meta.fields.map((f) => [f.name, f]));
  const layout = layoutOf(meta);
  const tabs = tabsOf(layout);
  const sections: FormViewSection<F>[] = layout.map((s) => ({
    key: s.key,
    label: s.label,
    columns: s.columns,
    collapsible: s.collapsible,
    tab: s.tab,
    visibleIf: s.visible_if,
    fields: s.fields.map((n) => byName.get(n)!),
  }));
  const rest = unplaced(layout, meta);
  if (rest.length) {
    const first = tabs.length ? tabs[0] : null;
    sections.push({ key: "rest", label: "Additional fields", columns: 2, collapsible: false, tab: first, visibleIf: null, fields: rest.map((n) => byName.get(n)!) });
  }
  return { sections, tabs: tabs.length ? tabs : [null] };
}
