// A service target (Customize → Targets) as the screen edits it: the `add_target` customization's target as a draft, and
// back. A target has a fixed set of properties, so the draft starts from those only: anything else in what the server
// sends (marks it adds for the reader) is dropped, as the server refuses definitions with properties it does not know.
// `within` reads back into "the same for every record" or "depends on a choice field" when it has exactly the shape the
// screen writes, else it stays an expression.

import { t as tr } from "@ferrum/client";
import { fieldName } from "./entityDraft";
import type { Field } from "./meta";

export type Raw = Record<string, unknown>;
export type Unit = "m" | "h" | "d";
export interface Dur { amount: string; unit: Unit }
export type How = "same" | "choice" | "advanced";

export const MAX_TARGETS = 8;
export { STATES, stateTone, stateWords } from "./targetState";
import { STATES } from "./targetState";

/** A target as `GET /api/meta/{Entity}` (and the definition) carries it. */
export interface TargetDef {
  name: string;
  label: string;
  calendar?: string;
  /** Where each record names its calendar (BD-41): a field of the record, or `link.field` of the record it links to. */
  calendar_field?: string;
  /** A date-time field of the record the clock starts from, rather than the save. */
  start_field?: string;
  start_when?: string;
  within: string;
  pause_when?: string;
  met_when: string;
  due_field: string;
  state_field: string;
}

export interface TargetDraft {
  saved: boolean;
  name: string;
  nameTouched: boolean;
  label: string;
  /** A business calendar's name; none: plain elapsed time. */
  calendar: string;
  calendarField: string;
  startField: string;
  startWhen: string;
  pauseWhen: string;
  metWhen: string;
  how: How;
  same: Dur;
  /** The choice field a duration per choice follows, and each choice's duration (blank amount: no target for it). */
  field: string;
  per: Record<string, Dur>;
  /** The expression, when `how` is advanced. */
  within: string;
  dueField: string;
  stateField: string;
  /** Make the field, in the same save, instead of picking one. */
  makeDue: boolean;
  makeState: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const blank = (): Dur => ({ amount: "", unit: "h" });

export const startTarget = (): TargetDraft => ({
  saved: false, name: "", nameTouched: false, label: "", calendar: "", calendarField: "", startField: "", startWhen: "", pauseWhen: "", metWhen: "",
  how: "same", same: { amount: "", unit: "h" }, field: "", per: {}, within: "", dueField: "", stateField: "", makeDue: true, makeState: true,
});

// ── within ──

export const isoOf = (d: Dur) => (d.unit === "d" ? `P${d.amount}D` : `PT${d.amount}${d.unit === "h" ? "H" : "M"}`);
const durOf = (iso: string): Dur | null => {
  const m = /^(?:PT(\d+)([MH])|P(\d+)(D))$/.exec(iso);
  return m ? { amount: m[1] ?? m[3], unit: (m[2] ?? m[4]).toLowerCase() as Unit } : null;
};
const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const filled = (d: Dur | undefined): d is Dur => !!d && d.amount.trim() !== "";

/** The `within` expression a draft comes to; `options`: the choices of the field a duration per choice follows. */
export function withinOf(d: TargetDraft, options: string[] = []): string {
  if (d.how === "advanced") return d.within.trim();
  if (d.how === "same") return `'${isoOf({ ...d.same, amount: d.same.amount.trim() })}'`;
  const rows = [...options, ...Object.keys(d.per).filter((k) => !options.includes(k))].filter((o) => filled(d.per[o]));
  return `${rows.map((o) => `doc.${d.field} == ${quote(o)} ? '${isoOf({ ...d.per[o], amount: d.per[o].amount.trim() })}' : `).join("")}null`;
}

/** An existing `within` as the simple forms, when it has exactly the shape they write; else null. `fields`: the entity's. */
export function readWithin(expr: string, fields: Pick<Field, "name" | "type" | "options">[]): Pick<TargetDraft, "how" | "same" | "field" | "per"> | null {
  const text = expr.trim();
  const same = /^'([^']*)'$/.exec(text);
  const one = same && durOf(same[1]);
  if (one) return { how: "same", same: one, field: "", per: {} };
  const first = /^doc\.([A-Za-z_][A-Za-z0-9_]*) == '/.exec(text);
  const field = fields.find((f) => f.name === first?.[1] && f.type === "select");
  if (!field) return null;
  const per: Record<string, Dur> = {};
  const link = /^doc\.[A-Za-z_][A-Za-z0-9_]* == '((?:[^'\\]|\\.)*)' \? '([^']*)' : /;
  for (let rest = text; rest !== "null"; ) {
    const m = link.exec(rest);
    const dur = m && durOf(m[2]);
    if (!m || !dur) return null;
    per[m[1].replace(/\\(.)/g, "$1")] = dur;
    rest = rest.slice(m[0].length);
  }
  if (Object.keys(per).some((k) => !field.options?.includes(k))) return null;
  const out = { how: "choice" as const, same: blank(), field: field.name, per };
  return withinOf({ ...startTarget(), ...out }, field.options ?? []) === text ? out : null;
}

// ── definition ⇄ draft ──

/** The draft of a saved target: its own properties only, whatever else the server added is left behind. */
export function fromTarget(t: Raw, fields: Pick<Field, "name" | "type" | "options">[]): TargetDraft {
  const within = str(t.within);
  const simple = readWithin(within, fields);
  return {
    ...startTarget(), saved: true, name: str(t.name), nameTouched: true, label: str(t.label), calendar: str(t.calendar), calendarField: str(t.calendar_field), startField: str(t.start_field), startWhen: str(t.start_when), pauseWhen: str(t.pause_when),
    metWhen: str(t.met_when), within, ...(simple ?? { how: "advanced" as const }), dueField: str(t.due_field), stateField: str(t.state_field), makeDue: false, makeState: false,
  };
}

/** The names of the two fields a target makes: `x_` first on an entity that comes with a package. */
export function madeNames(d: TargetDraft, fields: { name: string }[], packaged: boolean): { due: string; state: string } {
  const taken = fields.map((f) => f.name);
  const base = `${packaged ? "x_" : ""}${d.name}`;
  const free = (suffix: string) => {
    let n = `${base}_${suffix}`;
    for (let i = 2; taken.includes(n); i++) n = `${base}_${i}_${suffix}`;
    return n;
  };
  return { due: free("by"), state: free("state") };
}

/** The target `add_target` takes (the fields it names are the made ones' when they are made). */
export function toTarget(d: TargetDraft, options: string[] = [], made?: { due: string; state: string }): TargetDef {
  const out: TargetDef = { name: d.name.trim(), label: d.label.trim(), within: withinOf(d, options), met_when: d.metWhen.trim(), due_field: d.makeDue && made ? made.due : d.dueField, state_field: d.makeState && made ? made.state : d.stateField };
  const opt: Partial<TargetDef> = {};
  if (d.calendar) opt.calendar = d.calendar;
  if (d.calendarField.trim()) opt.calendar_field = d.calendarField.trim();
  if (d.startField) opt.start_field = d.startField;
  if (d.startWhen.trim()) opt.start_when = d.startWhen.trim();
  if (d.pauseWhen.trim()) opt.pause_when = d.pauseWhen.trim();
  return { ...out, ...opt };
}

/** The target's name made from its label (one the entity's targets do not have). */
export const targetName = (label: string, taken: string[]) => fieldName(label, taken).slice(0, 50);
export function setLabel(d: TargetDraft, label: string, taken: string[]): TargetDraft {
  return { ...d, label, name: d.saved || d.nameTouched ? d.name : label.trim() ? targetName(label, taken) : "" };
}

// ── what can hold the two fields ──

const plain = (f: Field) => !f.computed && !f.rollup && !f.fetch_from && !f.hidden;
/** The fields that can keep the due moment (`kind` "due": a date-time) or the state (text or choice) of target `name`:
 *  not one another target keeps, and on an entity that comes with a package only the workspace's own (`x_…`). */
export function eligible(fields: Field[], kind: "due" | "state", name: string, packaged: boolean): Field[] {
  return fields.filter((f) => plain(f) && (kind === "due" ? f.type === "datetime" : f.type === "data" || f.type === "select") && (!f.kept_by_target || f.kept_by_target === name) && (!packaged || f.name.startsWith("x_")));
}

const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const POSITIVE = /^[1-9]\d*$/;
export interface Problem { message: string }

/** What is wrong with a draft, in words a person who is not a developer follows. `taken`: the names of the entity's other targets. */
export function checkTarget(d: TargetDraft, ctx: { taken: string[]; fields: Field[]; packaged: boolean }): Problem[] {
  const out: Problem[] = [];
  const say = (message: string) => out.push({ message });
  if (!d.label.trim()) say(tr("Give the target a label."));
  const n = d.name.trim();
  if (!NAME.test(n)) say(tr("The name “{name}” cannot be used: lower-case letters, digits and underscores, starting with a letter.", { name: n || "…" }));
  else if (!d.saved && ctx.taken.includes(n)) say(tr("The entity already has a target called “{name}”: choose another name.", { name: n }));
  if (!d.saved && ctx.taken.length >= MAX_TARGETS) say(tr("An entity has at most {n} targets.", { n: MAX_TARGETS }));
  if (d.how === "same" && !POSITIVE.test(d.same.amount.trim())) say(tr("Say how long: a whole number of minutes, hours or days."));
  if (d.how === "advanced" && !d.within.trim()) say(tr("Write the expression that gives how long."));
  if (d.how === "choice") {
    const rows = Object.values(d.per).filter(filled);
    if (!d.field) say(tr("Choose the field whose choices decide how long."));
    else if (!rows.length) say(tr("Give a duration for at least one choice."));
    if (rows.some((r) => !POSITIVE.test(r.amount.trim()))) say(tr("Each duration is a whole number of minutes, hours or days."));
  }
  if (!d.metWhen.trim()) say(tr("Say when the target is met."));
  if (d.calendarField.trim() && !/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(d.calendarField.trim())) say(tr("The calendar field is a field of the record, or a link and a field of the record it links to (agreement.calendar)."));
  if (d.startField && !ctx.fields.some((f) => f.name === d.startField && f.type === "datetime")) say(tr("“{name}” cannot start the clock: it is not a date and time field.", { name: d.startField }));
  const check = (kind: "due" | "state", made: boolean, value: string) => {
    if (made) return;
    const f = eligible(ctx.fields, kind, d.name, ctx.packaged).find((x) => x.name === value);
    if (!value) say(kind === "due" ? tr("Choose the field that keeps the due moment, or have one made.") : tr("Choose the field that keeps the state, or have one made."));
    else if (!f) say(kind === "due" ? tr("“{name}” cannot keep the due moment.", { name: value }) : tr("“{name}” cannot keep the state.", { name: value }));
    else if (kind === "state" && f.type === "select" && STATES.some((s) => !f.options?.includes(s))) say(tr("The state field must offer the choices running, paused, met, met_late and breached."));
  };
  check("due", d.makeDue, d.dueField);
  check("state", d.makeState, d.stateField);
  if (!d.makeDue && !d.makeState && d.dueField && d.dueField === d.stateField) say(tr("The due moment and the state need two different fields."));
  return out;
}

// ── saving ──

/** The operations of one save, the made fields first. A packaged entity gets `add_field`s; the workspace's own entity has
 *  its definition (`def`, from `GET /api/customize/definition/{Entity}`) sent back with the fields appended. */
export function saveBatch(entity: string, d: TargetDraft, ctx: { fields: Field[]; packaged: boolean; def?: Raw | null; note?: string }) {
  const options = ctx.fields.find((f) => f.name === d.field)?.options ?? [];
  const names = madeNames(d, ctx.fields, ctx.packaged);
  const made: Raw[] = [];
  if (d.makeDue) made.push({ name: names.due, type: "datetime", label: tr("{label} due", { label: d.label.trim() }) });
  if (d.makeState) made.push({ name: names.state, type: "select", label: tr("{label} state", { label: d.label.trim() }), options: [...STATES] });
  const note = ctx.note ? { note: ctx.note } : {};
  const ops: { entity: string; op: Raw; note?: string }[] = [];
  if (made.length && ctx.packaged) for (const field of made) ops.push({ entity, op: { op: "add_field", field }, ...note });
  else if (made.length) {
    const def = ctx.def ?? {};
    ops.push({ entity, op: { op: "redefine_entity", entity: { ...def, fields: [...(Array.isArray(def.fields) ? def.fields : []), ...made] } }, ...note });
  }
  ops.push({ entity, op: { op: "add_target", target: toTarget(d, options, names) as unknown as Raw }, ...note });
  return ops;
}

export const removeBatch = (entity: string, name: string, note = "") => [{ entity, op: { op: "remove_target", name } as Raw, ...(note ? { note } : {}) }];

/** A `within` in words: "4 hours", "1 hour (High), 4 hours (Normal)"; an expression it cannot put in words shows as written. */
export function withinWords(t: Pick<TargetDef, "within">, fields: Pick<Field, "name" | "type" | "options">[]): string {
  const dur = (d: Dur) => {
    const n = Number(d.amount);
    return d.unit === "d" ? tr("{n} days", { n }) : d.unit === "h" ? tr("{n} hours", { n }) : tr("{n} minutes", { n });
  };
  const r = readWithin(t.within, fields);
  if (r?.how === "same") return dur(r.same);
  if (r?.how === "choice") return Object.entries(r.per).map(([k, v]) => `${k}: ${dur(v)}`).join(", ");
  return t.within;
}

export const targetsLink = (entity: string) => `/customize/${encodeURIComponent(entity)}/targets`;

/** What a record shows of its targets: each one that has begun (its state is kept), with its due moment. `doc` is the record as the server sends it. */
export function targetsOf(targets: Pick<TargetDef, "name" | "label" | "due_field" | "state_field">[] | undefined, doc: Record<string, unknown>): { name: string; label: string; state: string; due: string | null }[] {
  return (targets ?? []).flatMap((t) => {
    const state = doc[t.state_field];
    const due = doc[t.due_field];
    return typeof state === "string" && state ? [{ name: t.name, label: t.label, state, due: typeof due === "string" && due ? due : null }] : [];
  });
}
