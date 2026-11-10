// A custom entity as the designer edits it (docs: Customize → Your entities). The server's definition (EntityDef)
// is JSON; here fields, lines and unique groups are named by a key that does not change, so renaming a field
// leaves the title, the unique groups and the totals pointing at the same field. `fromDef` and `toDef` convert
// between the two (a round trip is the identity, key order aside, and a property the designer does not know
// stays), `buildBatch` makes the operations to send, and `checkDraft` says in plain words what would not work,
// before anything is sent. What the server additionally refuses is shown as it words it.

import { t as tr } from "@ferrum/client";

export type Raw = Record<string, unknown>;

export interface DraftField {
  key: string;
  /** The server has this field: its name is fixed (records hold values under it). */
  saved: boolean;
  /** The type it was saved with, to warn when it changes. */
  savedType: string;
  name: string;
  /** The name was typed: stop following the label. */
  nameTouched: boolean;
  label: string;
  type: string;
  required: boolean;
  unique: boolean;
  in_list: boolean;
  in_filter: boolean;
  /** One per line while editing; blanks are dropped when saved. */
  options: string[];
  to: string;
  precision: string;
  min: string;
  max: string;
  max_length: string;
  default: string;
  /** The default as the server had it, kept when the text did not change (a number stays a number). */
  defaultWas?: unknown;
  description: string;
  visible_if: string;
  required_if: string;
  read_only_if: string;
  /** A total over the lines: keys of a table field and of one of its lines' fields. */
  rollup: { table: string; op: "sum" | "count"; field: string } | null;
  /** The lines, for a table field. */
  lines: DraftEntity | null;
  /** What the designer does not know, kept as it was (index, widget, link_filters, read_only, …). */
  extra: Raw;
}

export interface DraftEntity {
  saved: boolean;
  name: string;
  nameTouched: boolean;
  label: string;
  label_plural: string;
  /** `document` is submitted and can be cancelled; `plain-document` is a document never submitted. */
  kind: "master" | "document" | "plain-document" | "child";
  description: string;
  /** Key of a field. */
  title: string;
  numbering: { prefix: string; digits: number } | null;
  /** A numbering template the designer does not build (dates, fields): kept as it is. */
  numberingRaw: Raw | null;
  fields: DraftField[];
  /** Groups of field keys that must be unique together. */
  unique: string[][];
  extra: Raw;
}

export interface Draft {
  /** Names of every entity of the workspace, so a new name avoids them. */
  taken: string[];
  entity: DraftEntity;
}

/** What would not work, and where, so the screen can point at it: `scope` is the key of the table field whose
 *  lines it is in ("" for the entity itself). */
export interface Problem {
  message: string;
  scope: string;
  field?: string;
}

let counter = 0;
export const newKey = () => `k${++counter}`;

export const RESERVED_FIELDS = ["id", "tenant_id", "version", "docstatus", "number", "created_at", "created_by", "updated_at", "updated_by", "ext", "parent_id", "idx", "amended_from", "workflow_state", "entity"];
const NUMERIC = ["int", "decimal", "currency", "percent"];
const DECIMAL = ["decimal", "currency", "percent"];
const TEXTY = ["data", "text", "markdown", "code", "email", "phone", "url"];
export const isNumeric = (type: string) => NUMERIC.includes(type);
export const isDecimal = (type: string) => DECIMAL.includes(type);
export const hasMaxLength = (type: string) => TEXTY.includes(type);

// ── names ──

const words = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

/** `Membership fee` → `membership_fee`; avoids the server's own field names and `taken`. */
export function fieldName(label: string, taken: string[] = []): string {
  let base = words(label).join("_").toLowerCase().slice(0, 60) || "field";
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  const used = new Set([...taken, ...RESERVED_FIELDS]);
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
  return name;
}

const pascal = (s: string) =>
  words(s)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");

/** `Membership fee` → `XMembershipFee`; avoids `taken`. */
export function entityName(label: string, taken: string[] = []): string {
  const base = `X${pascal(label) || "Record"}`.slice(0, 60);
  const used = new Set(taken);
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}${n}`;
  return name;
}

/** The entity that holds the lines of table field `table` of `parent`: `X` + parent + table. */
export function linesName(parent: string, table: string, taken: string[] = []): string {
  const base = `X${parent.replace(/^X/, "")}${pascal(table)}`.slice(0, 60);
  const used = new Set(taken);
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}${n}`;
  return name;
}

const isEntityName = (s: string) => /^X[A-Za-z0-9]{0,62}$/.test(s) && s.length > 1;
const isFieldName = (s: string) => /^[a-z][a-z0-9_]{0,62}$/.test(s);

// ── numbering ──

export const numberingTemplate = (n: { prefix: string; digits: number }) => `${n.prefix}{seq:${n.digits}}`;

/** The next number a template gives (the first one of the series, today's date for date tokens). */
export function nextNumber(template: string, now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return template
    .replace(/\{YYYY\}/g, String(now.getFullYear()))
    .replace(/\{YY\}/g, two(now.getFullYear() % 100))
    .replace(/\{MM\}/g, two(now.getMonth() + 1))
    .replace(/\{DD\}/g, two(now.getDate()))
    .replace(/\{seq:(\d+)\}/g, (_, w: string) => "1".padStart(Number(w), "0"));
}

/** The prefix and digits of a template the designer builds (`MEM-{seq:5}`); null for any other. */
export function parseNumbering(template: string): { prefix: string; digits: number } | null {
  const m = /^([^{}]*)\{seq:(\d+)\}$/.exec(template);
  return m ? { prefix: m[1], digits: Number(m[2]) } : null;
}

// ── the draft ──

const blankField = (type = "data"): DraftField => ({
  key: newKey(), saved: false, savedType: "", name: "", nameTouched: false, label: "", type,
  required: false, unique: false, in_list: false, in_filter: false, options: [], to: "", precision: "", min: "", max: "", max_length: "",
  default: "", description: "", visible_if: "", required_if: "", read_only_if: "", rollup: null, lines: null, extra: {},
});

/** A new field of `type`, named after its label once there is one. */
export const startField = (type = "data", label = ""): DraftField => ({ ...blankField(type), label });

const blankEntity = (kind: DraftEntity["kind"]): DraftEntity => ({
  saved: false, name: "", nameTouched: false, label: "", label_plural: "", kind, description: "", title: "", numbering: null, numberingRaw: null, fields: [], unique: [], extra: {},
});

/** The entity being started: a list of things with nothing in it yet. */
export const startDraft = (taken: string[]): Draft => ({ taken, entity: blankEntity("master") });

/** A new table field: a lines table with a first field of its own. */
export function startLines(label = ""): DraftField {
  return { ...blankField("table"), label, lines: { ...blankEntity("child"), fields: [startField("data", tr("Description"))] } };
}

/** A total over `table`'s lines (a sum of `field`, or a count when none). */
export function startTotal(table: DraftField, field: DraftField | null): DraftField {
  const sum = field && isNumeric(field.type);
  return {
    ...blankField(sum ? field.type : "int"),
    label: sum ? tr("Total {field}", { field: field.label }) : tr("Number of {lines}", { lines: table.label }),
    rollup: { table: table.key, op: sum ? "sum" : "count", field: sum ? field.key : "" },
    extra: { read_only: true },
  };
}

const KNOWN_FIELD = new Set(["name", "label", "type", "required", "unique", "in_list", "in_filter", "default", "options", "to", "of", "precision", "min", "max", "max_length", "visible_if", "required_if", "read_only_if", "description", "rollup"]);
const KNOWN_ENTITY = new Set(["name", "label", "label_plural", "kind", "submittable", "title_field", "numbering", "description", "fields", "unique"]);
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const strings = (v: unknown) => (Array.isArray(v) ? v.map(str) : []);

function fieldFrom(f: Raw, defs: Record<string, Raw>): DraftField {
  const d = blankField(str(f.type) || "data");
  const extra: Raw = {};
  for (const [k, v] of Object.entries(f)) if (!KNOWN_FIELD.has(k)) extra[k] = v;
  const of = str(f.of);
  return {
    ...d, saved: true, savedType: d.type, name: str(f.name), nameTouched: true, label: str(f.label),
    required: f.required === true, unique: f.unique === true, in_list: f.in_list === true, in_filter: f.in_filter === true,
    options: strings(f.options), to: str(f.to), precision: str(f.precision), min: str(f.min), max: str(f.max), max_length: str(f.max_length),
    default: f.default === undefined || f.default === null ? "" : str(f.default), defaultWas: f.default,
    description: str(f.description), visible_if: str(f.visible_if), required_if: str(f.required_if), read_only_if: str(f.read_only_if),
    // Names for now: `fromDef` turns them into keys once every field has one.
    rollup: f.rollup && typeof f.rollup === "object" ? { table: str((f.rollup as Raw).table), op: (f.rollup as Raw).op === "count" ? "count" : "sum", field: str((f.rollup as Raw).field) } : null,
    lines: f.type === "table" ? (defs[of] ? entityFrom(defs[of], defs) : { ...blankEntity("child"), saved: true, name: of, extra: { __missing: true } }) : null,
    extra,
  };
}

function entityFrom(def: Raw, defs: Record<string, Raw>): DraftEntity {
  const extra: Raw = {};
  for (const [k, v] of Object.entries(def)) if (!KNOWN_ENTITY.has(k)) extra[k] = v;
  const kind = def.kind === "child" ? "child" : def.kind === "document" ? (def.submittable === true ? "document" : "plain-document") : "master";
  const fields = (Array.isArray(def.fields) ? (def.fields as Raw[]) : []).map((f) => fieldFrom(f, defs));
  const key = (name: string) => fields.find((f) => f.name === name)?.key ?? `?${name}`;
  for (const f of fields) {
    if (!f.rollup) continue;
    const table = fields.find((t) => t.name === f.rollup?.table);
    f.rollup = { table: table?.key ?? `?${f.rollup.table}`, op: f.rollup.op, field: f.rollup.field ? (table?.lines?.fields.find((l) => l.name === f.rollup?.field)?.key ?? `?${f.rollup.field}`) : "" };
  }
  const numbering = def.numbering && typeof def.numbering === "object" ? (def.numbering as Raw) : null;
  const parsed = numbering && Object.keys(numbering).length === 1 ? parseNumbering(str(numbering.template)) : null;
  return {
    saved: true, name: str(def.name), nameTouched: true, label: str(def.label), label_plural: str(def.label_plural), kind, description: str(def.description),
    title: def.title_field ? key(str(def.title_field)) : "",
    numbering: parsed, numberingRaw: numbering && !parsed ? numbering : null,
    fields, unique: (Array.isArray(def.unique) ? (def.unique as unknown[]) : []).map((g) => strings(g).map(key)), extra,
  };
}

/** The draft of a saved entity: its definition and the definitions of the entities that hold its lines. */
export function fromDef(def: Raw, children: Record<string, Raw>, taken: string[] = []): Draft {
  return { taken, entity: entityFrom(def, children) };
}

const bool = (o: Raw, k: string, v: boolean) => void (v && (o[k] = true));
const text = (o: Raw, k: string, v: string) => void (v.trim() && (o[k] = v.trim()));
const whole = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

function defaultValue(f: DraftField): unknown {
  if (!f.default.trim()) return undefined;
  if (f.defaultWas !== undefined && str(f.defaultWas) === f.default) return f.defaultWas;
  if (f.type === "check") return f.default === "true";
  if (f.type === "int") return whole(f.default) ?? f.default;
  return f.default;
}

/** The names of the entities that hold the lines of the table fields, by the field's key. */
function linesNames(e: DraftEntity, taken: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = [...taken];
  for (const f of e.fields) {
    if (!f.lines) continue;
    out[f.key] = f.lines.saved ? f.lines.name : linesName(e.name, f.name, used);
    used.push(out[f.key]);
  }
  return out;
}

function entityDef(e: DraftEntity, names: Record<string, string>): Raw {
  const name = (key: string) => (key.startsWith("?") ? key.slice(1) : (e.fields.find((f) => f.key === key)?.name ?? key));
  const fields = e.fields.map((f) => {
    const o: Raw = { name: f.name.trim(), type: f.type };
    text(o, "label", f.label);
    bool(o, "required", f.required);
    if (e.kind !== "child") bool(o, "unique", f.unique);
    bool(o, "in_list", f.in_list);
    bool(o, "in_filter", f.in_filter);
    const options = f.options.map((x) => x.trim()).filter(Boolean);
    // Only what the type uses, unless the field was saved with this type and its own leftovers.
    const uses = (t: string) => f.type === t || (f.saved && f.type === f.savedType);
    if (uses("select") && options.length) o.options = options;
    if (uses("link")) text(o, "to", f.to);
    if (f.type === "table") o.of = names[f.key] ?? "";
    for (const k of ["precision", "max_length"] as const) if (whole(f[k]) !== undefined) o[k] = whole(f[k]);
    for (const k of ["min", "max"] as const) text(o, k, f[k]);
    const dv = defaultValue(f);
    if (dv !== undefined) o.default = dv;
    text(o, "description", f.description);
    for (const k of ["visible_if", "required_if", "read_only_if"] as const) text(o, k, f[k]);
    if (f.rollup) {
      const table = e.fields.find((t) => t.key === f.rollup?.table);
      const row = table?.lines?.fields.find((l) => l.key === f.rollup?.field);
      const r: Raw = { table: table?.name ?? name(f.rollup.table), op: f.rollup.op };
      if (f.rollup.op === "sum") r.field = row?.name ?? f.rollup.field.replace(/^\?/, "");
      o.rollup = r;
    }
    return { ...f.extra, ...o };
  });
  const out: Raw = { ...e.extra, name: e.name.trim(), label: e.label.trim() };
  text(out, "label_plural", e.label_plural);
  out.kind = e.kind === "plain-document" ? "document" : e.kind;
  if (e.kind === "document") out.submittable = true;
  text(out, "description", e.description);
  if (e.title) out.title_field = name(e.title);
  if (e.numbering) out.numbering = { template: numberingTemplate(e.numbering) };
  else if (e.numberingRaw) out.numbering = e.numberingRaw;
  out.fields = fields;
  const groups = e.unique.filter((g) => g.length).map((g) => g.map(name));
  if (groups.length) out.unique = groups;
  return out;
}

/** What a definition says before the designer touched it (so loading one is no change). */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Raw).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

export interface DefOf {
  name: string;
  label: string;
  /** The lines of a table field, not an entity of its own to the person. */
  lines: boolean;
  def: Raw;
}

/** Every entity the draft makes or changes, the entities that hold lines first (they are defined before their parent). */
export function entityDefs(d: Draft): DefOf[] {
  const e = d.entity;
  const names = linesNames(e, d.taken);
  const children = e.fields
    .filter((f) => f.lines && !f.lines.extra.__missing)
    .map((f) => {
      const c = f.lines as DraftEntity;
      const child: DraftEntity = c.saved ? c : { ...c, name: names[f.key], label: `${e.label.trim()} ${f.label.trim()}`.trim() };
      return { name: child.name, label: child.label || f.label, lines: true, def: entityDef(child, {}) };
    });
  return [...children, { name: e.name, label: e.label, lines: false, def: entityDef(e, names) }];
}

/** The definitions as saved, keyed by name, for `buildBatch` to tell what changed. */
export const savedDefs = (d: Draft): Record<string, string> => Object.fromEntries(entityDefs(d).map((x) => [x.name, canon(x.def)]));

/** The draft as one string, to tell whether anything was edited. */
export const signature = (d: Draft) => canon(entityDefs(d).map((x) => x.def));

export interface PlanItem {
  name: string;
  label: string;
  lines: boolean;
  action: "create" | "change";
}

export interface Batch {
  ops: { entity: string; op: Raw; note?: string }[];
  /** One per operation, in the same order. */
  plan: PlanItem[];
}

/** The operations that make or change what the draft says, in order: lines first (new ones defined, saved ones
 *  redefined), then the entity. Only what changed since `saved` (empty for a new entity). */
export function buildBatch(d: Draft, saved: Record<string, string> = {}, note = ""): Batch {
  const out: Batch = { ops: [], plan: [] };
  for (const x of entityDefs(d)) {
    const was = saved[x.name];
    if (was !== undefined && was === canon(x.def)) continue;
    out.ops.push({ entity: x.name, op: { op: was === undefined ? "define_entity" : "redefine_entity", entity: x.def }, ...(note ? { note } : {}) });
    out.plan.push({ name: x.name, label: x.label, lines: x.lines, action: was === undefined ? "create" : "change" });
  }
  return out;
}

/** The draft after a save: everything in it is now on the server. */
export function markSaved(d: Draft): Draft {
  const names = linesNames(d.entity, d.taken);
  const entity = (e: DraftEntity, name: string): DraftEntity => ({
    ...e, saved: true, name, nameTouched: true,
    fields: e.fields.map((f) => ({ ...f, saved: true, savedType: f.type, nameTouched: true, lines: f.lines && !f.lines.extra.__missing ? entity(f.lines, names[f.key] ?? f.lines.name) : f.lines })),
  });
  const e = entity(d.entity, d.entity.name);
  const taken = [...d.taken, e.name, ...Object.values(names)];
  return { taken, entity: e };
}

// ── editing ──

/** Moves the item at `index` by `by` places (a no-op at the ends). */
export function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Moves the field `key` past its neighbour among the fields `shown` (lines and totals are kept apart from the plain fields). */
export function moveField(e: DraftEntity, key: string, by: -1 | 1, shown: (f: DraftField) => boolean): DraftEntity {
  const at = e.fields.map((f, i) => (shown(f) ? i : -1)).filter((i) => i >= 0);
  const pos = at.findIndex((i) => e.fields[i].key === key);
  const other = at[pos + by];
  if (pos < 0 || other === undefined) return e;
  const fields = [...e.fields];
  [fields[at[pos]], fields[other]] = [fields[other], fields[at[pos]]];
  return { ...e, fields };
}

/** The label of the entity: its name follows until it is typed or the entity is saved. */
export function setEntityLabel(d: Draft, label: string): Draft {
  const e = d.entity;
  return { ...d, entity: { ...e, label, name: e.saved || e.nameTouched ? e.name : entityName(label, d.taken) } };
}

/** A field's label; its name follows until it is typed or the field is saved. */
export function setFieldLabel(e: DraftEntity, key: string, label: string): DraftEntity {
  return { ...e, fields: e.fields.map((f) => (f.key !== key ? f : { ...f, label, name: f.saved || f.nameTouched ? f.name : fieldName(label, e.fields.filter((o) => o.key !== key).map((o) => o.name)) })) };
}

export const patchField = (e: DraftEntity, key: string, patch: Partial<DraftField>): DraftEntity => ({ ...e, fields: e.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) });

/** Adds a field at the end, named after its label. */
export function addField(e: DraftEntity, f: DraftField): DraftEntity {
  const name = f.name || fieldName(f.label, e.fields.map((o) => o.name));
  return { ...e, fields: [...e.fields, { ...f, name }] };
}

/** Takes a field out, and it out of the unique groups and the title. */
export function removeField(e: DraftEntity, key: string): DraftEntity {
  return {
    ...e,
    fields: e.fields.filter((f) => f.key !== key),
    title: e.title === key ? "" : e.title,
    unique: e.unique.map((g) => g.filter((k) => k !== key)).filter((g) => g.length > 1),
  };
}

// ── what is wrong ──

/** What is wrong with a draft, in words a person who is not a developer follows. */
export function checkDraft(d: Draft): Problem[] {
  const out: Problem[] = [];
  const e = d.entity;
  const add = (message: string, scope: string, field?: string) => out.push({ message, scope, field });
  if (!e.label.trim()) add(tr("Give the entity a label."), "");
  if (!isEntityName(e.name)) add(tr("The name “{name}” cannot be used: it starts with X and then has letters and digits only.", { name: e.name || "…" }), "");
  else if (!e.saved && d.taken.includes(e.name)) add(tr("Something is already called “{name}”: choose another name.", { name: e.name }), "");
  if (e.numbering) {
    if (!(e.numbering.digits >= 1 && e.numbering.digits <= 12)) add(tr("Numbers have between 1 and 12 digits."), "");
    if (/[{}]/.test(e.numbering.prefix)) add(tr("The start of a number cannot contain curly brackets."), "");
  }
  const tables = e.fields.filter((f) => f.type === "table");
  const checkEntity = (x: DraftEntity, scope: string, label: string) => {
    const seen = new Set<string>();
    const shown = (f: DraftField) => f.label.trim() || f.name || tr("a field with no label");
    for (const f of x.fields) {
      if (!f.label.trim()) add(tr("Every field needs a label."), scope, f.key);
      const n = f.name.trim();
      if (!isFieldName(n)) add(tr("The name “{name}” of {field} cannot be used: lower-case letters, digits and underscores, starting with a letter.", { name: n || "…", field: shown(f) }), scope, f.key);
      else if (RESERVED_FIELDS.includes(n)) add(tr("“{name}” is a name the system keeps for itself: choose another for {field}.", { name: n, field: shown(f) }), scope, f.key);
      else if (seen.has(n)) add(tr("Two fields are called “{name}”: give each its own name.", { name: n }), scope, f.key);
      seen.add(n);
      if (f.type === "select" && !f.options.some((o) => o.trim())) add(tr("A choice needs choices: list them for {field}.", { field: shown(f) }), scope, f.key);
      if (f.type === "select" && new Set(f.options.map((o) => o.trim()).filter(Boolean)).size < f.options.map((o) => o.trim()).filter(Boolean).length) add(tr("{field} lists the same choice twice.", { field: shown(f) }), scope, f.key);
      if (f.type === "link" && !f.to) add(tr("Choose what {field} links to.", { field: shown(f) }), scope, f.key);
      for (const [k, w] of [["precision", tr("The digits after the point")], ["max_length", tr("The longest length")]] as const)
        if (f[k].trim() && !(whole(f[k]) !== undefined && Number.isInteger(Number(f[k])) && Number(f[k]) >= 0)) add(tr("{what} of {field} must be a whole number.", { what: w, field: shown(f) }), scope, f.key);
      for (const k of ["min", "max"] as const) if (f[k].trim() && whole(f[k]) === undefined) add(tr("The {which} of {field} must be a number.", { which: k === "min" ? tr("smallest value") : tr("largest value"), field: shown(f) }), scope, f.key);
      if (whole(f.min) !== undefined && whole(f.max) !== undefined && Number(f.min) > Number(f.max)) add(tr("The smallest value of {field} is larger than its largest.", { field: shown(f) }), scope, f.key);
      if (f.type === "check" && f.default && !["true", "false"].includes(f.default)) add(tr("The starting value of {field} is yes or no.", { field: shown(f) }), scope, f.key);
      if (f.type === "table") {
        const rows = f.lines;
        if (!rows || rows.extra.__missing) add(tr("The lines “{lines}” could not be read: its definition is missing.", { lines: shown(f) }), scope, f.key);
        else if (!rows.fields.length) add(tr("The lines “{lines}” need at least one field.", { lines: shown(f) }), f.key);
      }
    }
    if (x.title && !x.fields.some((f) => f.key === x.title)) add(tr("The title field of {entity} is not one of its fields.", { entity: label }), scope);
    const groups = new Set<string>();
    for (const g of x.unique) {
      const keys = [...new Set(g)];
      if (keys.length < 2) add(tr("A unique combination needs at least two different fields."), scope);
      else if (keys.some((k) => !x.fields.some((f) => f.key === k && f.type !== "table"))) add(tr("A unique combination names a field that is gone."), scope);
      else if (groups.has([...keys].sort().join())) add(tr("The same unique combination is listed twice."), scope);
      groups.add([...keys].sort().join());
    }
  };
  checkEntity(e, "", e.label.trim() || tr("this entity"));
  const sharing = new Map<string, number>();
  for (const f of tables) {
    if (f.lines?.extra.__missing) continue;
    if (f.lines?.saved) sharing.set(f.lines.name, (sharing.get(f.lines.name) ?? 0) + 1);
    if (f.lines) checkEntity(f.lines, f.key, f.label.trim() || tr("the lines"));
    if (f.lines && f.lines.fields.some((l) => l.type === "table")) add(tr("The lines “{lines}” cannot hold lines of their own.", { lines: f.label.trim() || "…" }), f.key);
  }
  for (const [name, n] of sharing) if (n > 1) add(tr("{name} is the lines of {n} tables: each lines table needs its own.", { name, n }), "");
  for (const f of e.fields.filter((x) => x.rollup)) {
    const r = f.rollup as NonNullable<DraftField["rollup"]>;
    const shown = f.label.trim() || f.name;
    const table = tables.find((t) => t.key === r.table);
    if (!table) add(tr("The total {field} needs a lines table to add up.", { field: shown }), "", f.key);
    else if (r.op === "sum") {
      const row = table.lines?.fields.find((l) => l.key === r.field);
      if (!row) add(tr("The total {field} needs a field of {lines} to add up.", { field: shown, lines: table.label.trim() || "…" }), "", f.key);
      else if (!isNumeric(row.type)) add(tr("The total {field} adds up “{row}”, which is not a number.", { field: shown, row: row.label.trim() || row.name }), "", f.key);
    }
    if (!isNumeric(f.type)) add(tr("The total {field} must be a number.", { field: shown }), "", f.key);
  }
  return out;
}

/** The friendly name of each type the designer offers (the order is the order shown). */
export const FIELD_TYPES: { type: string; label: () => string; hint?: () => string }[] = [
  { type: "data", label: () => tr("Text") },
  { type: "text", label: () => tr("Long text") },
  { type: "int", label: () => tr("Whole number") },
  { type: "decimal", label: () => tr("Decimal") },
  { type: "currency", label: () => tr("Money") },
  { type: "percent", label: () => tr("Percent") },
  { type: "date", label: () => tr("Date") },
  { type: "datetime", label: () => tr("Date and time") },
  { type: "check", label: () => tr("Yes / no") },
  { type: "select", label: () => tr("Choice") },
  { type: "link", label: () => tr("Link to…") },
  { type: "email", label: () => tr("Email") },
  { type: "phone", label: () => tr("Phone") },
  { type: "url", label: () => tr("Web address") },
  { type: "attach", label: () => tr("Attachment") },
  { type: "color", label: () => tr("Colour") },
];

/** Types the designer does not offer for a new field but keeps for one that has it. */
export const KEPT_TYPES: Record<string, () => string> = {
  markdown: () => tr("Formatted text"),
  code: () => tr("Code"),
  json: () => tr("Structured data (JSON)"),
};
