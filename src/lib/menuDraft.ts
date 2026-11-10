// A workspace's own menu (Customize → Menus) as the screen edits it: the `define_module` customization's module as a
// draft, and back. What the screen has no control for (`order`, anything newer) stays as it was (`extra`), so opening
// and saving changes nothing the person did not touch. `checkMenu` says in words what the server would refuse.

import { t as tr } from "@ferrum/client";
import { fieldName } from "./entityDraft";

export type Raw = Record<string, unknown>;

export const MAX_ITEMS = 50;
export const MAX_SUGGESTIONS = 6;
export const LIMITS = { label: 60, description: 200, instructions: 2000, suggestion: 200, name: 40 } as const;

export interface MenuDraft {
  /** The server has it: its name is fixed. */
  saved: boolean;
  name: string;
  nameTouched: boolean;
  label: string;
  description: string;
  /** A name `AppIcon` knows; empty: the label's initial. */
  icon: string;
  /** `#rrggbb`, or empty. */
  color: string;
  /** Entity names and `report:<name>`, in order. */
  items: string[];
  /** The entity items a "+" entry is offered for. */
  create: string[];
  instructions: string;
  suggestions: string[];
  assistantExtra: Raw;
  extra: Raw;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strings = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const rest = (o: Raw, known: string[]): Raw => Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k)));

export const isReport = (item: string) => item.startsWith("report:");

export const startMenu = (): MenuDraft => ({
  saved: false, name: "", nameTouched: false, label: "", description: "", icon: "", color: "", items: [], create: [], instructions: "", suggestions: [], assistantExtra: {}, extra: {},
});

const KNOWN = ["name", "label", "icon", "color", "description", "items", "create", "assistant"];

/** The draft of a module as `GET /api/meta` lists it. */
export function fromModule(m: Raw): MenuDraft {
  const a = isObj(m.assistant) ? m.assistant : {};
  return {
    saved: true,
    name: str(m.name),
    nameTouched: true,
    label: str(m.label),
    description: str(m.description),
    icon: str(m.icon),
    color: str(m.color),
    items: strings(m.items),
    create: strings(m.create),
    instructions: str(a.instructions),
    suggestions: strings(a.suggestions),
    assistantExtra: rest(a, ["instructions", "suggestions"]),
    extra: rest(m, KNOWN),
  };
}

/** The module a draft saves: what is empty is left out; `assistant` only when there are instructions. */
export function toModule(d: MenuDraft): Raw {
  const out: Raw = { ...d.extra, name: d.name.trim(), label: d.label.trim(), items: [...d.items] };
  if (d.description.trim()) out.description = d.description.trim();
  if (d.icon) out.icon = d.icon;
  if (d.color) out.color = d.color;
  if (d.create.length) out.create = [...d.create];
  if (d.instructions.trim()) {
    const suggestions = d.suggestions.map((s) => s.trim()).filter(Boolean);
    out.assistant = { ...d.assistantExtra, instructions: d.instructions.trim(), ...(suggestions.length ? { suggestions } : {}) };
  }
  return out;
}

/** `Governance and risk` → `x_governance_and_risk`, and not one of `taken` (the workspace's menus). */
export function menuName(label: string, taken: string[]): string {
  const base = `x_${fieldName(label).slice(0, LIMITS.name - 5).replace(/_+$/, "")}`;
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}_${n}`;
  return name;
}

/** A label: the name follows it until the name is typed or the menu is saved. */
export function setLabel(d: MenuDraft, label: string, taken: string[]): MenuDraft {
  return { ...d, label, name: d.saved || d.nameTouched ? d.name : label.trim() ? menuName(label, taken) : "" };
}

/** An item out of the list, and out of the "+" entries with it. */
export const removeItem = (d: MenuDraft, item: string): MenuDraft => ({ ...d, items: d.items.filter((i) => i !== item), create: d.create.filter((i) => i !== item) });

export const toggleCreate = (d: MenuDraft, item: string, on: boolean): MenuDraft => ({ ...d, create: on ? [...new Set([...d.create, item])] : d.create.filter((i) => i !== item) });

/** What is wrong with a draft, in words a person who is not a developer follows. `taken`: names of the menus the workspace has. */
export function checkMenu(d: MenuDraft, taken: string[]): string[] {
  const out: string[] = [];
  if (!d.label.trim()) out.push(tr("Give the menu a label."));
  else if (d.label.trim().length > LIMITS.label) out.push(tr("The label is at most {n} characters.", { n: LIMITS.label }));
  const n = d.name.trim();
  if (!/^x_[a-z0-9_]+$/.test(n) || n.length > LIMITS.name) out.push(tr("The name “{name}” cannot be used: x_ and then lower-case letters, digits and underscores, at most {n} characters in all.", { name: n || "…", n: LIMITS.name }));
  else if (!d.saved && taken.includes(n)) out.push(tr("The workspace already has a menu called “{name}”: choose another name.", { name: n }));
  if (d.description.trim().length > LIMITS.description) out.push(tr("The description is at most {n} characters.", { n: LIMITS.description }));
  if (d.color && !/^#[0-9a-f]{6}$/i.test(d.color)) out.push(tr("The colour is written #rrggbb."));
  if (d.items.length > MAX_ITEMS) out.push(tr("A menu has at most {n} items.", { n: MAX_ITEMS }));
  const twice = d.items.filter((x, i) => d.items.indexOf(x) !== i);
  if (twice.length) out.push(tr("{item} is in the menu twice.", { item: [...new Set(twice)].join(", ") }));
  const stray = d.create.filter((c) => isReport(c) || !d.items.includes(c));
  if (stray.length) out.push(tr("{item} is offered in the + menu but is not a record type of the menu.", { item: stray.join(", ") }));
  if (d.instructions.length > LIMITS.instructions) out.push(tr("The instructions are at most {n} characters.", { n: LIMITS.instructions }));
  const asks = d.suggestions.map((s) => s.trim()).filter(Boolean);
  if (asks.length && !d.instructions.trim()) out.push(tr("Suggested questions need instructions for the assistant: write them, or clear the questions."));
  if (asks.length > MAX_SUGGESTIONS) out.push(tr("At most {n} suggested questions.", { n: MAX_SUGGESTIONS }));
  if (asks.some((s) => s.length > LIMITS.suggestion)) out.push(tr("A suggested question is at most {n} characters.", { n: LIMITS.suggestion }));
  return out;
}

/** The operations of one save: `define_module` makes the menu, or replaces the one of the same name. */
export function saveBatch(d: MenuDraft, note = "") {
  return [{ entity: d.name.trim(), op: { op: "define_module", module: toModule(d) } as Raw, ...(note ? { note } : {}) }];
}

/** The operations that remove a menu. */
export function removeBatch(name: string, note = "") {
  return [{ entity: name, op: { op: "remove_module", name } as Raw, ...(note ? { note } : {}) }];
}

export const menusLink = "/customize/menus";
