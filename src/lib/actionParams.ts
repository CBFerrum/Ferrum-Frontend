// An action's parameters that are lists or rows (docs/app-contract.md, "Lists and rows as parameters"): the dialog's state for them
// and what it sends. Every item is a row of cells (strings, as typed); a list of one value each has the one field `value`.

import { t } from "@ferrum/client";
import type { ActionParam } from "./meta";

export interface Item {
  key: number;
  cells: Record<string, string>;
}
/** `edited`: the person added or removed a row, so an empty list is said, `[]`, instead of left out. */
export interface ListState {
  items: Item[];
  edited: boolean;
}

export const HARD_MAX = 500;
export const capOf = (p: ActionParam): number => Math.min(HARD_MAX, p.max_items && p.max_items > 0 ? p.max_items : HARD_MAX);
export const isGroup = (p: ActionParam): boolean => p.type === "list" || p.type === "row";
/** The fields an item has: those declared, or the one of a list of one value each. */
export const itemFields = (p: ActionParam): ActionParam[] =>
  p.fields?.length ? p.fields : [{ name: "value", label: p.label, type: (p.of ?? "data") as ActionParam["type"], to: p.to, options: p.options }];
const ofValues = (p: ActionParam) => !p.fields?.length;

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}
export function cellsFrom(p: ActionParam, v: unknown): Record<string, string> {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return Object.fromEntries(itemFields(p).map((f) => [f.name, cellText(ofValues(p) ? v : o[f.name])]));
}
export const blankCells = (p: ActionParam): Record<string, string> => cellsFrom(p, undefined);

/** One typed value as JSON; undefined when nothing was entered. A decimal stays the text typed (exact). */
export function encodeScalar(f: ActionParam, v: string): unknown {
  if (f.type === "check") return v === "true";
  const s = v.trim();
  if (s === "") return undefined;
  return f.type === "int" ? Number(s) : s;
}
const blank = (f: ActionParam, v: string) => {
  const x = encodeScalar(f, v);
  return x === undefined || x === false;
};
const itemBlank = (p: ActionParam, cells: Record<string, string>) => itemFields(p).every((f) => blank(f, cells[f.name] ?? ""));
function encodeItem(p: ActionParam, cells: Record<string, string>): unknown {
  const fields = itemFields(p);
  if (ofValues(p)) return encodeScalar(fields[0], cells.value ?? "");
  return Object.fromEntries(fields.flatMap((f) => { const x = encodeScalar(f, cells[f.name] ?? ""); return x === undefined ? [] : [[f.name, x]]; }));
}

/** What a list or row parameter sends; undefined: leave it out. */
export function encodeGroup(p: ActionParam, state: ListState | Record<string, string>): unknown {
  if (p.type === "row") {
    const cells = state as Record<string, string>;
    return itemBlank(p, cells) ? undefined : encodeItem(p, cells);
  }
  const l = state as ListState;
  const items = l.items.filter((i) => !itemBlank(p, i.cells)).map((i) => encodeItem(p, i.cells));
  return items.length || l.edited ? items : undefined;
}

/** What is missing, said before anything is sent: keyed `name` for the parameter, `name.item key.field` for a field of an item. */
export function missingIn(p: ActionParam, state: ListState | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const need = t("is needed");
  const check = (key: string, cells: Record<string, string>) => {
    for (const f of itemFields(p)) if (f.required && blank(f, cells[f.name] ?? "")) out[`${key}.${f.name}`] = need;
  };
  if (p.type === "row") {
    const cells = state as Record<string, string>;
    if (itemBlank(p, cells)) {
      if (p.required) out[p.name] = need;
    } else check(p.name, cells);
    return out;
  }
  const items = (state as ListState).items.filter((i) => !itemBlank(p, i.cells));
  if (p.required && !items.length) out[p.name] = t("Add at least one item");
  for (const i of items) check(`${p.name}.${i.key}`, i.cells);
  return out;
}
