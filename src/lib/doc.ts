// Document bodies for create/update, and merging `_calc` previews into the form being edited.

import type { FieldError } from "@ferrum/client";
import { isServerManaged, type ChildTable, type Doc, type EntityMeta, type Field } from "./meta";

const isBlank = (v: unknown) => v === null || v === undefined || v === "";
const norm = (v: unknown) => (isBlank(v) ? null : v);

/** A record or a line: its fields and, for a line that has lines of its own, their tables (two levels at most). */
type Level = { fields: Field[]; children?: Record<string, ChildTable> };
const tablesOf = (l: Level) => Object.entries(l.children ?? {});

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
export const asRows = (v: unknown): Doc[] => (Array.isArray(v) ? (v as Doc[]) : []);

/**
 * A child row as sent to the server: its id plus writable fields (client-only keys dropped). A line's
 * own table goes whole (each sub-row with its id) when `sends` says so; a line sent without it keeps its sub-lines.
 */
function rowBody(r: Doc, level: Level, sends: (table: string) => boolean = () => true): Doc {
  const out: Doc = {};
  if (r.id) out.id = r.id;
  for (const f of level.fields) if (f.type !== "table" && !isServerManaged(f) && f.name in r) out[f.name] = norm(r[f.name]);
  for (const [table] of tablesOf(level)) if (table in r && sends(table)) out[table] = subBodies(r, table, level);
  return out;
}
const subBodies = (r: Doc, table: string, level: Level) => asRows(r[table]).map((sr) => rowBody(sr, level.children![table]));

/** POST body: writable fields that have a value, child tables with their rows. */
export function createBody(meta: EntityMeta, doc: Doc): Doc {
  const out: Doc = {};
  for (const f of meta.fields) {
    const child = meta.children[f.name];
    if (f.type === "table") {
      if (child && f.can_write === true) out[f.name] = asRows(doc[f.name]).map((r) => rowBody(r, child));
    } else if (!isServerManaged(f) && !isBlank(doc[f.name])) out[f.name] = doc[f.name];
  }
  return out;
}

/**
 * PATCH body: changed writable fields; a changed child table is sent whole (rows are replaced), and
 * within it a line's own table only when that changed.
 */
export function diffDoc(meta: EntityMeta, base: Doc, doc: Doc): Doc {
  const out: Doc = {};
  for (const f of meta.fields) {
    const child = meta.children[f.name];
    if (f.type === "table") {
      if (!child || f.can_write !== true) continue;
      const baseRows = asRows(base[f.name]);
      const before = baseRows.map((r) => rowBody(r, child));
      if (JSON.stringify(before) === JSON.stringify(asRows(doc[f.name]).map((r) => rowBody(r, child)))) continue;
      out[f.name] = asRows(doc[f.name]).map((r) => {
        const was = r.id ? baseRows.find((b) => b.id === r.id) : undefined;
        return rowBody(r, child, (t) => !was || JSON.stringify(subBodies(was, t, child)) !== JSON.stringify(subBodies(r, t, child)));
      });
    } else if (!isServerManaged(f) && !sameValue(base[f.name], doc[f.name])) out[f.name] = norm(doc[f.name]);
  }
  return out;
}

/** Body for `_calc`: the whole working document minus client-only keys (in lines and their lines too). */
export function calcBody(meta: Level, doc: Doc): Doc {
  const out: Doc = { ...doc };
  delete out._titles;
  delete out._key;
  for (const [table, child] of tablesOf(meta)) {
    if (Array.isArray(out[table])) out[table] = asRows(out[table]).map((r) => calcBody(child, r));
  }
  return out;
}

/**
 * Takes what the server computed without clobbering what the user typed: server-managed fields
 * (read-only, computed, not writable) always follow the server; editable fields fill blanks, and
 * follow the server while they still hold what it said last (`prev`): a price the server set
 * moves with the unit, a price the user typed stays.
 */
function mergeFields(fields: Field[], local: Doc, server: Doc, prev?: Doc): Doc {
  let out = local;
  let titles = local._titles;
  for (const f of fields) {
    if (f.type === "table" || !(f.name in server)) continue;
    const untouched = isBlank(local[f.name]) || (!!prev && f.name in prev && sameValue(prev[f.name], local[f.name]));
    if (!isServerManaged(f) && !untouched) continue;
    if (sameValue(server[f.name], local[f.name])) continue;
    if (out === local) out = { ...local };
    out[f.name] = server[f.name];
    if (f.type === "link" && titles && f.name in titles) {
      titles = { ...titles };
      delete titles[f.name]; // stale: the widget will look the new title up
    }
  }
  if (out !== local) out._titles = titles;
  return out;
}

/** Rows the server generated carry preview ids that mean nothing: they become client keys (in their lines too). */
function adopt(rows: Doc[], level: Level): Doc[] {
  return rows.map(({ id, ...r }, i) => {
    for (const [table, sub] of tablesOf(level)) if (Array.isArray(r[table])) r[table] = adopt(asRows(r[table]), sub);
    return { ...r, _key: String(id ?? `calc-${i}`) };
  });
}

/**
 * Merges a `_calc` result into the working document (returns `local` itself when nothing changed);
 * a line is merged the same way, with its own lines inside it.
 * `prev` is what the server said before (the last result, or the document as loaded).
 */
export function mergeCalc(meta: Level, local: Doc, server: Doc, prev?: Doc): Doc {
  let out = mergeFields(meta.fields, local, server, prev);
  for (const [table, child] of tablesOf(meta)) {
    const mine = asRows(local[table]);
    const theirs = asRows(server[table]);
    if (!(table in server)) continue;
    if (mine.length !== theirs.length) {
      // Rows the server generated into an empty table (e.g. taxes from a template) are adopted;
      // otherwise the user changed the rows meanwhile and the next preview will catch up.
      if (!mine.length) {
        if (out === local) out = { ...local };
        out[table] = adopt(theirs, child);
      }
      continue;
    }
    const before = prev ? asRows(prev[table]) : [];
    const rows = mine.map((r, i) => mergeCalc(child, r, theirs[i], before.length === mine.length ? before[i] : undefined));
    if (rows.some((r, i) => r !== mine[i])) {
      if (out === local) out = { ...local };
      out[table] = rows;
    }
  }
  return out;
}

/** Saved documents come back without `_titles`; keep the titles we already know for unchanged links (in lines too). */
export function carryTitles(meta: Level, saved: Doc, prev: Doc): Doc {
  const t: Record<string, string> = { ...saved._titles };
  for (const [k, v] of Object.entries(prev._titles ?? {})) if (!(k in t) && saved[k] === prev[k]) t[k] = v;
  const out: Doc = { ...saved, _titles: t };
  for (const [table, child] of tablesOf(meta)) {
    const s = asRows(saved[table]);
    const p = asRows(prev[table]);
    if (s.length && s.length === p.length) out[table] = s.map((r, i) => carryTitles(child, r, p[i]));
  }
  return out;
}

const NUMERIC = new Set(["int", "decimal", "currency", "percent"]);
const badNumber = (f: Field, v: unknown) => NUMERIC.has(f.type) && typeof v === "string" && v.trim() !== "" && !/^[-+]?\d+(\.\d+)?$/.test(v.trim());

/** True when a numeric field (top level or in a row) holds text that is not a number. */
export function hasInvalidNumbers(meta: Level, doc: Doc): boolean {
  if (meta.fields.some((f) => badNumber(f, doc[f.name]))) return true;
  return tablesOf(meta).some(([table, child]) => asRows(doc[table]).some((r) => hasInvalidNumbers(child, r)));
}

/** True while a visible required top-level field is blank: the server cannot preview the document yet. */
export function missingRequired(meta: EntityMeta, doc: Doc, isRequiredVisible: (f: Field) => boolean): boolean {
  return meta.fields.some((f) => f.type !== "table" && isBlank(doc[f.name]) && isRequiredVisible(f));
}

/** Whether an error belongs to the edited cell of `table`: one of a line, or one of its own lines (`cell.sub`). */
export function errorAtCell(e: FieldError, table: string, cell: { row: number; field: string; sub?: { row: number; field: string } }): boolean {
  if (e.row?.[0] !== table || e.row[1] !== cell.row) return false;
  const [tb, j] = e.path?.[1] ?? [];
  return cell.sub ? tb === cell.field && j === cell.sub.row && e.field === cell.sub.field : !e.path && e.field === cell.field;
}
