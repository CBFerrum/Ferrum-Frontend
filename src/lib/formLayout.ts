// The form builder's model: an entity's `form` sections as an editable list. Every operation is
// pure (returns a new layout). `checkLayout` applies the server's rules for a customized layout
// (known fields, each placed once, 1 to 4 columns) so mistakes show while editing.

import type { Section } from "./meta";

export interface LayoutSection {
  key: string;
  label: string | null;
  fields: string[];
  columns: number;
  collapsible: boolean;
  /** Sections with the same tab label show together under that tab; `null` is the first tab. */
  tab: string | null;
  /** Condition on `doc`; the section shows only when it holds. */
  visible_if: string | null;
}

/** A section as `/api/meta` sends it and the `form` customization stores it. */
export type FormSection = Section & { tab?: string | null; visible_if?: string | null };

type Meta = { form: FormSection[]; fields: { name: string }[] };

/** The layout to edit: the entity's sections, or one section with every field (as the form shows it). */
export function layoutOf(meta: Meta): LayoutSection[] {
  const defs: FormSection[] = meta.form.length ? meta.form : [{ label: null, fields: meta.fields.map((f) => f.name) }];
  const known = new Set(meta.fields.map((f) => f.name));
  const used = new Set<string>();
  return defs.map((s, i) => {
    const fields: string[] = [];
    for (const n of s.fields) {
      if (known.has(n) && !used.has(n)) {
        used.add(n);
        fields.push(n);
      }
    }
    return {
      key: `s${i}`,
      label: s.label ?? null,
      fields,
      columns: s.columns ?? 2,
      collapsible: !!s.collapsible,
      tab: s.tab || null,
      visible_if: s.visible_if || null,
    };
  });
}

/** Fields no section places; the form shows them last, under "Additional fields". */
export function unplaced(layout: LayoutSection[], meta: Pick<Meta, "fields">): string[] {
  const placed = new Set(layout.flatMap((s) => s.fields));
  return meta.fields.filter((f) => !placed.has(f.name)).map((f) => f.name);
}

/** Tabs in display order: untabbed sections first (`null`), then labelled tabs as they first appear. */
export function tabsOf(layout: LayoutSection[]): (string | null)[] {
  const tabs: (string | null)[] = layout.some((s) => !s.tab) ? [null] : [];
  for (const s of layout) if (s.tab && !tabs.includes(s.tab)) tabs.push(s.tab);
  return tabs;
}

/** Puts `field` into section `to` at `index` (its position in the resulting list), taking it out of any other. */
export function moveField(layout: LayoutSection[], field: string, to: string, index: number): LayoutSection[] {
  return layout.map((s) => {
    const fields = s.fields.filter((f) => f !== field);
    if (s.key !== to) return fields.length === s.fields.length ? s : { ...s, fields };
    const at = Math.max(0, Math.min(index, fields.length));
    return { ...s, fields: [...fields.slice(0, at), field, ...fields.slice(at)] };
  });
}

/** Takes `field` off the form layout (it then shows under "Additional fields"). */
export function removeField(layout: LayoutSection[], field: string): LayoutSection[] {
  return layout.map((s) => (s.fields.includes(field) ? { ...s, fields: s.fields.filter((f) => f !== field) } : s));
}

/** Adds an empty section after `after`, or at the end of `tab`. Returns the layout and the new key. */
export function addSection(layout: LayoutSection[], tab: string | null, after?: string): [LayoutSection[], string] {
  const key = `s${1 + Math.max(-1, ...layout.map((s) => Number(s.key.slice(1)) || 0))}`;
  const section: LayoutSection = { key, label: null, fields: [], columns: 2, collapsible: false, tab, visible_if: null };
  let at = after ? layout.findIndex((s) => s.key === after) + 1 : layout.map((s) => s.tab).lastIndexOf(tab) + 1;
  if (at <= 0) at = layout.length;
  return [[...layout.slice(0, at), section, ...layout.slice(at)], key];
}

/** Removes a section; its fields move to "Additional fields" until placed again. */
export function removeSection(layout: LayoutSection[], key: string): LayoutSection[] {
  return layout.filter((s) => s.key !== key);
}

/** Moves a section to `index` (its position in the resulting list). */
export function moveSection(layout: LayoutSection[], key: string, index: number): LayoutSection[] {
  const s = layout.find((x) => x.key === key);
  if (!s) return layout;
  const rest = layout.filter((x) => x.key !== key);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), s, ...rest.slice(at)];
}

export function updateSection(layout: LayoutSection[], key: string, patch: Partial<Omit<LayoutSection, "key" | "fields" | "tab">>): LayoutSection[] {
  return layout.map((s) => (s.key === key ? { ...s, ...patch } : s));
}

/** Moves a section to the end of another tab. */
export function setSectionTab(layout: LayoutSection[], key: string, tab: string | null): LayoutSection[] {
  const s = layout.find((x) => x.key === key);
  if (!s || s.tab === tab) return layout;
  const rest = layout.filter((x) => x.key !== key);
  const last = rest.map((x) => x.tab).lastIndexOf(tab);
  const at = last < 0 ? rest.length : last + 1;
  return [...rest.slice(0, at), { ...s, tab }, ...rest.slice(at)];
}

/** Renames a tab (an empty name merges it into the first tab). */
export function renameTab(layout: LayoutSection[], from: string | null, to: string | null): LayoutSection[] {
  const name = to?.trim() || null;
  return layout.map((s) => (s.tab === from ? { ...s, tab: name } : s));
}

export interface LayoutProblem {
  section: string;
  message: string;
}

/** The server's rules for a layout; an empty list means it can be saved. */
export function checkLayout(layout: LayoutSection[], meta: Pick<Meta, "fields">): LayoutProblem[] {
  const known = new Set(meta.fields.map((f) => f.name));
  const seen = new Set<string>();
  const out: LayoutProblem[] = [];
  for (const s of layout) {
    if (!Number.isInteger(s.columns) || s.columns < 1 || s.columns > 4) out.push({ section: s.key, message: "A section has 1 to 4 columns." });
    for (const f of s.fields) {
      if (!known.has(f)) out.push({ section: s.key, message: `The field ${f} no longer exists.` });
      else if (seen.has(f)) out.push({ section: s.key, message: `${f} is placed twice.` });
      seen.add(f);
    }
  }
  return out;
}

/** The layout as the server stores it: empty sections dropped, labels and conditions trimmed. */
export function toForm(layout: LayoutSection[]): FormSection[] {
  return layout
    .filter((s) => s.fields.length)
    .map((s) => {
      const out: FormSection = { label: s.label?.trim() || null, fields: s.fields, columns: s.columns, collapsible: s.collapsible };
      if (s.tab?.trim()) out.tab = s.tab.trim();
      if (s.visible_if?.trim()) out.visible_if = s.visible_if.trim();
      return out;
    });
}

/** The customization that saves a layout (POST /api/customize with the entity). */
export const layoutOp = (layout: LayoutSection[]) => ({ op: "set_entity_property", property: "form", value: toForm(layout) });

/** Whether two layouts save to the same form (for "unsaved changes"). */
export const sameLayout = (a: LayoutSection[], b: LayoutSection[]) => JSON.stringify(toForm(a)) === JSON.stringify(toForm(b));
