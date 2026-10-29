// The form designer's pure logic, on top of the layout model in lib/formLayout.ts: sections kept in
// tab order, section/field/tab moves for drag-and-drop and the "Move to…" menus, the undo/redo stack,
// hints for section conditions, the server's save errors mapped to sections, and saved layout versions.

import { evaluate } from "../../lib/expr";
import { moveField, renameTab, tabsOf, type FormSection, type LayoutSection } from "../../lib/formLayout";
import { SYSTEM_FIELD_LABELS } from "../../lib/meta";

/** A tab's label as the form shows it (`null` is the untitled first tab). */
export const tabLabel = (tab: string | null) => tab ?? "Details";

export const sectionTitle = (s: Pick<LayoutSection, "label">) => s.label?.trim() || "Untitled section";

/** The section holding `field`, or "palette" when no section places it. */
export const containerOf = (layout: LayoutSection[], field: string) => layout.find((s) => s.fields.includes(field))?.key ?? "palette";

const inTab = (s: LayoutSection, tab: string | null) => (s.tab || null) === tab;

/**
 * Sections grouped by tab, in tab order. The form renders the same either way, but kept grouped a move
 * inside one tab can never change the order of the tabs (which follows each tab's first section).
 * Returns `layout` itself when it is already grouped.
 */
export function normalize(layout: LayoutSection[]): LayoutSection[] {
  const out = tabsOf(layout).flatMap((t) => layout.filter((s) => inTab(s, t)));
  return out.every((s, i) => s === layout[i]) ? layout : out;
}

/**
 * Drops section `key` where section `over` is, in `over`'s tab: within a tab like arrayMove (after it
 * when moving down), from another tab just before it.
 */
export function placeSection(layout: LayoutSection[], key: string, over: string): LayoutSection[] {
  const from = layout.findIndex((s) => s.key === key);
  const to = layout.findIndex((s) => s.key === over);
  if (from < 0 || to < 0 || from === to) return layout;
  const target = layout[to];
  const rest = layout.filter((_, i) => i !== from);
  const at = rest.indexOf(target) + (from < to && inTab(layout[from], target.tab || null) ? 1 : 0);
  return normalize([...rest.slice(0, at), { ...layout[from], tab: target.tab || null }, ...rest.slice(at)]);
}

/** Moves a section one place up (-1) or down (1) within its tab. */
export function nudgeSection(layout: LayoutSection[], key: string, delta: -1 | 1): LayoutSection[] {
  const s = layout.find((x) => x.key === key);
  if (!s) return layout;
  const siblings = layout.filter((x) => inTab(x, s.tab || null));
  const target = siblings[siblings.indexOf(s) + delta];
  return target ? placeSection(layout, key, target.key) : layout;
}

/** Moves a field one place earlier (-1) or later (1) within its section. */
export function nudgeField(layout: LayoutSection[], field: string, delta: -1 | 1): LayoutSection[] {
  const s = layout.find((x) => x.fields.includes(field));
  if (!s) return layout;
  const i = s.fields.indexOf(field) + delta;
  return i < 0 || i >= s.fields.length ? layout : moveField(layout, field, s.key, i);
}

/** Puts a field at the end of a tab's last section. */
export function moveFieldToTab(layout: LayoutSection[], field: string, tab: string | null): LayoutSection[] {
  const last = layout.filter((s) => inTab(s, tab)).at(-1);
  return last ? moveField(layout, field, last.key, last.fields.length) : layout;
}

/** Moves a labelled tab one place left (-1) or right (1). The untitled first tab always stays first. */
export function nudgeTab(layout: LayoutSection[], tab: string | null, delta: -1 | 1): LayoutSection[] {
  const order = tabsOf(layout);
  const i = order.indexOf(tab);
  const j = i + delta;
  if (tab === null || i < 0 || j < 0 || j >= order.length || order[j] === null) return layout;
  [order[i], order[j]] = [order[j], order[i]];
  return order.flatMap((t) => layout.filter((s) => inTab(s, t)));
}

/** Removes a tab; its sections join the end of the untitled first tab ("Details"). */
export const removeTab = (layout: LayoutSection[], tab: string) => normalize(renameTab(layout, tab, null));

/** Why `name` cannot name a tab (`current` when renaming one), or null. Names are unique ignoring case. */
export function tabNameProblem(name: string, layout: LayoutSection[], current?: string | null): string | null {
  const n = name.trim();
  if (!n) return "Give the tab a name.";
  if (current && n === current) return null;
  if (n.toLowerCase() === "details") return "“Details” is the name of the untitled first tab.";
  if (tabsOf(layout).some((t) => t !== null && t !== current && t.toLowerCase() === n.toLowerCase())) return "A tab with this name already exists.";
  return null;
}

// ── undo / redo ──

export const UNDO_LIMIT = 100;

export interface Undoable {
  past: LayoutSection[][];
  present: LayoutSection[];
  future: LayoutSection[][];
  /** Changes recorded with the same group in a row (typing in one input) undo as one step. */
  group: string | null;
}

export const startHistory = (present: LayoutSection[]): Undoable => ({ past: [], present, future: [], group: null });

export function record(h: Undoable, next: LayoutSection[], group: string | null = null): Undoable {
  if (JSON.stringify(next) === JSON.stringify(h.present)) return h;
  if (group && group === h.group) return { ...h, present: next, future: [] };
  return { past: [...h.past, h.present].slice(-UNDO_LIMIT), present: next, future: [], group };
}

export function undo(h: Undoable): Undoable {
  const prev = h.past.at(-1);
  return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], group: null } : h;
}

export function redo(h: Undoable): Undoable {
  const [next, ...rest] = h.future;
  return next ? { past: [...h.past, h.present], present: next, future: rest, group: null } : h;
}

// ── section conditions ──

export interface Hint {
  tone: "ok" | "info" | "warning" | "error";
  message: string;
}

const NAMES = new Set(["doc", "parent", "user", "today", "now", "time", "true", "false", "null", "in"]);
const SYSTEM_FIELDS = Object.keys(SYSTEM_FIELD_LABELS);
// Macros bind their own variables (`doc.items.exists(i, i.qty > 0)`): free names are not checked there.
const MACRO = /\.(all|exists|exists_one|map|filter)\(/;

/** The source with string contents blanked (so names inside quotes are ignored); null if a string is not closed. */
function blankStrings(src: string): string | null {
  let out = "";
  let quote = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!quote) {
      if (c === "'" || c === '"') quote = c;
      out += c;
    } else if (c === "\\") {
      out += "  ";
      i++;
    } else if (c === quote) {
      quote = "";
      out += c;
    } else out += " ";
  }
  return quote ? null : out;
}

function bracketProblem(code: string): string | null {
  const open: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (const c of code) {
    if (c === "(" || c === "[" || c === "{") open.push(c);
    else if (c in pairs && open.pop() !== pairs[c]) return "The brackets or parentheses do not match.";
  }
  return open.length ? "A bracket or parenthesis is not closed." : null;
}

/**
 * A quick check of a section's `visible_if` while it is typed. The server compiles the condition (CEL)
 * when the layout is saved and is the authority; this catches common slips early and says whether the
 * browser preview can evaluate it.
 */
export function conditionHint(src: string, fields: string[], entityLabel = "this form"): Hint | null {
  if (!src.trim()) return null;
  const blanked = blankStrings(src);
  if (blanked === null) return { tone: "error", message: "A quoted text is not closed." };
  const brackets = bracketProblem(blanked);
  if (brackets) return { tone: "error", message: brackets };
  if (/[=!]==/.test(blanked)) return { tone: "error", message: "Compare with == or != (=== and !== are not allowed)." };
  if (/(^|[^=!<>])=($|[^=])/.test(blanked)) return { tone: "error", message: "Compare with == (a single = is not allowed)." };

  const code = blanked.replace(/\s*\.\s*/g, ".").replace(/\s+\(/g, "(");
  const known = new Set([...fields, ...SYSTEM_FIELDS]);
  const unknownFields = [...new Set([...code.matchAll(/(?<![\w.])doc\.([A-Za-z_]\w*)/g)].map((m) => m[1]).filter((f) => !known.has(f)))];
  if (unknownFields.length) {
    const list = unknownFields.map((f) => `doc.${f}`).join(", ");
    return { tone: "warning", message: `${list} ${unknownFields.length === 1 ? "is not a field" : "are not fields"} of ${entityLabel}.` };
  }
  if (!MACRO.test(code)) {
    // Free names: not after a dot, not a function call, not a string prefix such as r'…'.
    const free = [...code.matchAll(/(?<![\w.])([A-Za-z_]\w*)(?![\w'"]|\()/g)].map((m) => m[1]).find((n) => !NAMES.has(n));
    if (free) return { tone: "warning", message: `Unknown name “${free}”. A condition reads doc (this record), user, today and now.` };
  }
  if (evaluate(src, { doc: {}, user: {} }) === undefined) {
    return {
      tone: "info",
      message: "The browser cannot evaluate this condition (it may use functions or arithmetic), so the preview shows the section. The server checks it on save.",
    };
  }
  return { tone: "ok", message: "The section shows while this condition is true." };
}

// ── save errors ──

export interface SaveProblem {
  message: string;
  /** Sections the message is about, to highlight them. */
  sections: string[];
}

/** The server's reason for rejecting a layout, without its prefix, with the sections it concerns. */
export function saveProblem(message: string, layout: LayoutSection[]): SaveProblem {
  const text = message.replace(/^customization rejected:\s*/i, "").replace(/^[A-Z]\w*:\s+/, "");
  let sections: string[] = [];
  const field = /^the layout places (?:unknown field (\S+)|(\S+) twice)/.exec(text);
  if (text.startsWith("section condition '")) {
    sections = layout.filter((s) => s.visible_if?.trim() && text.startsWith(`section condition '${s.visible_if.trim()}':`)).map((s) => s.key);
  } else if (field) {
    const name = field[1] ?? field[2];
    sections = layout.filter((s) => s.fields.includes(name)).map((s) => s.key);
  } else if (text.includes("1 to 4 columns")) {
    sections = layout.filter((s) => !(Number.isInteger(s.columns) && s.columns >= 1 && s.columns <= 4)).map((s) => s.key);
  }
  return { message: text.charAt(0).toUpperCase() + text.slice(1), sections };
}

// ── saved versions ──

/** A row of GET /api/customize. */
export interface Customization {
  id: string;
  seq: number;
  entity: string;
  op: Record<string, unknown>;
  is_active: boolean;
  note?: string | null;
  created_at: string;
}

/** The entity's saved form layouts, newest first, and the one in use: the latest that is switched on. */
export function layoutVersions(rows: Customization[], entity: string): { versions: Customization[]; current: Customization | null } {
  const versions = rows
    .filter((r) => r.entity === entity && r.op?.op === "set_entity_property" && r.op.property === "form")
    .sort((a, b) => b.seq - a.seq);
  return { versions, current: versions.find((v) => v.is_active) ?? null };
}

/**
 * The switches that make `target` the layout in use (`null`: the entity's own layout), in order:
 * turn it on first (the server validates that), then turn off every later one that is on.
 */
export function restorePlan(versions: Customization[], target: Customization | null): { id: string; active: boolean }[] {
  const plan = target && !target.is_active ? [{ id: target.id, active: true }] : [];
  for (const v of versions) if (v.is_active && (!target || v.seq > target.seq)) plan.push({ id: v.id, active: false });
  return plan;
}

/** Counts in a stored layout, for the history list. */
export function layoutSummary(value: unknown): { tabs: number; sections: number; fields: number } {
  const sections = (Array.isArray(value) ? value : []).filter((s): s is FormSection => !!s && typeof s === "object" && Array.isArray(s.fields));
  return {
    tabs: new Set(sections.map((s) => s.tab?.trim() || null)).size,
    sections: sections.length,
    fields: sections.reduce((n, s) => n + s.fields.length, 0),
  };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
