// Document bodies for create/update, and merging `_calc` previews into the form being edited.

import { isServerManaged, type Doc, type EntityMeta, type Field } from "./meta";

const isBlank = (v: unknown) => v === null || v === undefined || v === "";
const norm = (v: unknown) => (isBlank(v) ? null : v);

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
export const asRows = (v: unknown): Doc[] => (Array.isArray(v) ? (v as Doc[]) : []);

/** A child row as sent to the server: its id plus writable fields (client-only keys dropped). */
function rowBody(r: Doc, fields: Field[]): Doc {
  const out: Doc = {};
  if (r.id) out.id = r.id;
  for (const f of fields) if (f.type !== "table" && !isServerManaged(f) && f.name in r) out[f.name] = norm(r[f.name]);
  return out;
}

/** POST body: writable fields that have a value, child tables with their rows. */
export function createBody(meta: EntityMeta, doc: Doc): Doc {
  const out: Doc = {};
  for (const f of meta.fields) {
    const child = meta.children[f.name];
    if (f.type === "table") {
      if (child && f.can_write === true) out[f.name] = asRows(doc[f.name]).map((r) => rowBody(r, child.fields));
    } else if (!isServerManaged(f) && !isBlank(doc[f.name])) out[f.name] = doc[f.name];
  }
  return out;
}

/** PATCH body: changed writable fields; a changed child table is sent whole (rows are replaced). */
export function diffDoc(meta: EntityMeta, base: Doc, doc: Doc): Doc {
  const out: Doc = {};
  for (const f of meta.fields) {
    const child = meta.children[f.name];
    if (f.type === "table") {
      if (!child || f.can_write !== true) continue;
      const before = asRows(base[f.name]).map((r) => rowBody(r, child.fields));
      const after = asRows(doc[f.name]).map((r) => rowBody(r, child.fields));
      if (JSON.stringify(before) !== JSON.stringify(after)) out[f.name] = after;
    } else if (!isServerManaged(f) && !sameValue(base[f.name], doc[f.name])) out[f.name] = norm(doc[f.name]);
  }
  return out;
}

/** Body for `_calc`: the whole working document minus client-only keys. */
export function calcBody(meta: EntityMeta, doc: Doc): Doc {
  const out: Doc = { ...doc };
  delete out._titles;
  for (const table of Object.keys(meta.children)) {
    if (Array.isArray(out[table])) out[table] = asRows(out[table]).map(({ _titles: _t, _key: _k, ...r }) => r);
  }
  return out;
}

/**
 * Takes what the server computed without clobbering what the user typed: server-managed fields
 * (read-only, computed, not writable) always follow the server; editable fields only fill blanks.
 */
function mergeFields(fields: Field[], local: Doc, server: Doc): Doc {
  let out = local;
  let titles = local._titles;
  for (const f of fields) {
    if (f.type === "table" || !(f.name in server)) continue;
    if (!isServerManaged(f) && !isBlank(local[f.name])) continue;
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

/** Merges a `_calc` result into the working document (returns `local` itself when nothing changed). */
export function mergeCalc(meta: EntityMeta, local: Doc, server: Doc): Doc {
  let out = mergeFields(meta.fields, local, server);
  for (const [table, child] of Object.entries(meta.children)) {
    const mine = asRows(local[table]);
    const theirs = asRows(server[table]);
    if (!(table in server)) continue;
    if (mine.length !== theirs.length) {
      // Rows the server generated into an empty table (e.g. taxes from a template) are adopted;
      // their preview ids mean nothing, so they become client keys. Otherwise the user changed
      // the rows meanwhile and the next preview will catch up.
      if (!mine.length) {
        if (out === local) out = { ...local };
        out[table] = theirs.map(({ id, ...r }, i) => ({ ...r, _key: String(id ?? `calc-${i}`) }));
      }
      continue;
    }
    const rows = mine.map((r, i) => mergeFields(child.fields, r, theirs[i]));
    if (rows.some((r, i) => r !== mine[i])) {
      if (out === local) out = { ...local };
      out[table] = rows;
    }
  }
  return out;
}

/** Saved documents come back without `_titles`; keep the titles we already know for unchanged links. */
export function carryTitles(meta: EntityMeta, saved: Doc, prev: Doc): Doc {
  const keep = (s: Doc, p: Doc) => {
    const t: Record<string, string> = { ...s._titles };
    for (const [k, v] of Object.entries(p._titles ?? {})) if (!(k in t) && s[k] === p[k]) t[k] = v;
    return t;
  };
  const out: Doc = { ...saved, _titles: keep(saved, prev) };
  for (const table of Object.keys(meta.children)) {
    const s = asRows(saved[table]);
    const p = asRows(prev[table]);
    if (s.length && s.length === p.length) out[table] = s.map((r, i) => ({ ...r, _titles: keep(r, p[i]) }));
  }
  return out;
}

const NUMERIC = new Set(["int", "decimal", "currency", "percent"]);
const badNumber = (f: Field, v: unknown) => NUMERIC.has(f.type) && typeof v === "string" && v.trim() !== "" && !/^[-+]?\d+(\.\d+)?$/.test(v.trim());

/** True when a numeric field (top level or in a row) holds text that is not a number. */
export function hasInvalidNumbers(meta: EntityMeta, doc: Doc): boolean {
  if (meta.fields.some((f) => badNumber(f, doc[f.name]))) return true;
  return Object.entries(meta.children).some(([table, child]) => asRows(doc[table]).some((r) => child.fields.some((f) => badNumber(f, r[f.name]))));
}

/** True while a visible required top-level field is blank: the server cannot preview the document yet. */
export function missingRequired(meta: EntityMeta, doc: Doc, isRequiredVisible: (f: Field) => boolean): boolean {
  return meta.fields.some((f) => f.type !== "table" && isBlank(doc[f.name]) && isRequiredVisible(f));
}
