// A button set up by configuration (Customize → Buttons) as the screen edits it: the `add_action` customization's
// action as a draft whose rows have stable keys, and back. What the screen has no control for stays as it was
// (`extra`, and an effect of a kind it does not know is a "raw" card), so opening and saving changes nothing the
// person did not touch. `checkButton` says in words what would not work; what the server refuses is shown as it words it.

import { t as tr } from "@ferrum/client";
import { actionJson, checkActions, fromAction as fromEffect, newKey, type Capability, type DraftAction, type Problem } from "./automationDraft";
import { fieldName } from "./entityDraft";

export type Raw = Record<string, unknown>;

/** The kinds of question the form can ask (the record form's action dialog draws each). */
export const PARAM_TYPES = ["data", "text", "select", "int", "date", "link"] as const;
export const MAX_EFFECTS = 10;
export const MAX_REFUSALS = 10;

export interface DraftParam {
  key: string;
  name: string;
  nameTouched: boolean;
  label: string;
  type: string;
  options: string[];
  /** The entity a `link` question picks a record of. */
  to: string;
  required: boolean;
  description: string;
  extra: Raw;
}

export interface DraftRefusal {
  key: string;
  /** The expression that, when it holds, refuses. */
  when: string;
  message: string;
  extra: Raw;
}

export interface ButtonDraft {
  /** The server has it: its name is fixed. */
  saved: boolean;
  name: string;
  nameTouched: boolean;
  label: string;
  /** None: whoever may edit the record. */
  roles: string[];
  condition: string;
  confirm: string;
  refusals: DraftRefusal[];
  params: DraftParam[];
  effects: DraftAction[];
  /** What the screen has no control for (group, docstatus, …), kept as it was. */
  extra: Raw;
}

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const strings = (v: unknown) => (Array.isArray(v) ? v.map(str) : []);
const rest = (o: Raw, known: string[]): Raw => Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k)));

/** A button that is a configured one: it carries `effects` (a package's coded action has none to administrators). */
export const isConfigured = (a: { effects?: unknown }) => Array.isArray(a.effects);

export const startButton = (): ButtonDraft => ({ saved: false, name: "", nameTouched: false, label: "", roles: [], condition: "", confirm: "", refusals: [], params: [], effects: [], extra: {} });

export const newParam = (): DraftParam => ({ key: newKey(), name: "", nameTouched: false, label: "", type: "data", options: [], to: "", required: false, description: "", extra: {} });
export const newRefusal = (): DraftRefusal => ({ key: newKey(), when: "", message: "", extra: {} });

const KNOWN_PARAM = ["name", "label", "type", "options", "to", "required", "description"];
const KNOWN = ["name", "label", "condition", "confirm", "roles", "refuse_if", "params", "effects"];

/** The draft of an action as `GET /api/meta/{Entity}` describes it to an administrator. */
export function fromButton(a: Raw): ButtonDraft {
  return {
    saved: true,
    name: str(a.name),
    nameTouched: true,
    label: str(a.label),
    roles: strings(a.roles),
    condition: str(a.condition),
    confirm: str(a.confirm),
    refusals: (Array.isArray(a.refuse_if) ? a.refuse_if : []).map((r) => {
      const o = isObj(r) ? r : {};
      return { key: newKey(), when: str(o.when), message: str(o.message), extra: rest(o, ["when", "message"]) };
    }),
    params: (Array.isArray(a.params) ? a.params : []).map((p) => {
      const o = isObj(p) ? p : {};
      return {
        key: newKey(), name: str(o.name), nameTouched: true, label: str(o.label), type: str(o.type) || "data", options: strings(o.options), to: str(o.to),
        required: o.required === true, description: str(o.description), extra: rest(o, KNOWN_PARAM),
      };
    }),
    effects: (Array.isArray(a.effects) ? a.effects : []).map(fromEffect),
    // `may_run` and `package` are the server's marks, not part of the definition: sent back, they are refused.
    extra: rest(a, [...KNOWN, "may_run", "package"]),
  };
}

/** The action `add_action` takes. Only what is set is sent; what the screen does not know goes back as it was. */
export function toButton(d: ButtonDraft): Raw {
  const out: Raw = { ...d.extra, name: d.name.trim(), label: d.label.trim() };
  if (d.condition.trim()) out.condition = d.condition.trim();
  if (d.confirm.trim()) out.confirm = d.confirm.trim();
  if (d.roles.length) out.roles = d.roles;
  if (d.refusals.length) out.refuse_if = d.refusals.map((r) => ({ ...r.extra, when: r.when.trim(), message: r.message.trim() }));
  if (d.params.length) {
    out.params = d.params.map((p) => {
      const o: Raw = { ...p.extra, name: p.name.trim(), label: p.label.trim(), type: p.type };
      const options = p.options.map((x) => x.trim()).filter(Boolean);
      if (p.type === "select" && options.length) o.options = options;
      if (p.type === "link" && p.to) o.to = p.to;
      if (p.required) o.required = true;
      if (p.description.trim()) o.description = p.description.trim();
      return o;
    });
  }
  out.effects = d.effects.map(actionJson);
  return out;
}

/** The name a new button gets from its label: lower-case words joined by underscores, `x_` first on an entity that comes
 *  with a package, and not one of `taken` (every action the entity already has). */
export function buttonName(label: string, taken: string[], packaged: boolean): string {
  const base = `${packaged ? "x_" : ""}${fieldName(label).slice(0, 50)}`;
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}_${n}`;
  return name;
}

/** A label: its name follows until it is typed or the button is saved. */
export function setLabel(d: ButtonDraft, label: string, taken: string[], packaged: boolean): ButtonDraft {
  return { ...d, label, name: d.saved || d.nameTouched ? d.name : label.trim() ? buttonName(label, taken, packaged) : "" };
}

/** A question's label: its name follows until it is typed. */
export function setParamLabel(d: ButtonDraft, key: string, label: string): ButtonDraft {
  return {
    ...d,
    params: d.params.map((p) => (p.key !== key ? p : { ...p, label, name: p.nameTouched ? p.name : fieldName(label, d.params.filter((o) => o.key !== key).map((o) => o.name)) })),
  };
}

const NAME = /^[a-z][a-z0-9_]{0,62}$/;

export interface ButtonProblem extends Problem {
  /** The key of the refusal or question it is about. */
  row?: string;
}

/** What is wrong with a draft, in words a person who is not a developer follows. `taken`: names of the actions the entity has. */
export function checkButton(d: ButtonDraft, taken: string[], packaged: boolean, catalog?: Capability[]): ButtonProblem[] {
  const out: ButtonProblem[] = [];
  const say = (message: string, row?: string) => out.push({ message, row });
  if (!d.label.trim()) say(tr("Give the button a label."));
  const n = d.name.trim();
  if (!NAME.test(n)) say(tr("The name “{name}” cannot be used: lower-case letters, digits and underscores, starting with a letter.", { name: n || "…" }));
  else if (packaged && !n.startsWith("x_")) say(tr("On an entity that comes with an app a button's name starts with x_."));
  else if (!d.saved && taken.includes(n)) say(tr("The entity already has an action called “{name}”: choose another name.", { name: n }));
  if (d.refusals.length > MAX_REFUSALS) say(tr("Use at most {n} refusals.", { n: MAX_REFUSALS }));
  d.refusals.forEach((r, i) => {
    if (!r.when.trim()) say(tr("Refusal {n}: say when it applies.", { n: i + 1 }), r.key);
    if (!r.message.trim()) say(tr("Refusal {n}: write the message people see.", { n: i + 1 }), r.key);
  });
  const seen = new Set<string>();
  d.params.forEach((p, i) => {
    const at = (m: string) => say(tr("Question {n}: {message}", { n: i + 1, message: m }), p.key);
    if (!p.label.trim()) at(tr("give it a label."));
    if (!NAME.test(p.name.trim())) at(tr("its name must be lower-case letters, digits and underscores, starting with a letter."));
    else if (seen.has(p.name.trim())) at(tr("“{name}” is used twice.", { name: p.name.trim() }));
    seen.add(p.name.trim());
    if (p.type === "select" && !p.options.some((o) => o.trim())) at(tr("list the choices."));
    if (p.type === "link" && !p.to) at(tr("choose what it links to."));
  });
  out.push(...checkActions(d.effects, MAX_EFFECTS, catalog).map((p) => ({ ...p, message: p.message === tr("Add at least one action.") ? tr("Add at least one thing the button does.") : p.message })));
  return out;
}

/** The operations of one save: `add_action` adds a button, or replaces the one of the same name where it stands. */
export function saveBatch(entity: string, d: ButtonDraft, note = "") {
  return [{ entity, op: { op: "add_action", action: toButton(d) } as Raw, ...(note ? { note } : {}) }];
}

/** The operations that remove a configured button. */
export function removeBatch(entity: string, name: string, note = "") {
  return [{ entity, op: { op: "remove_action", name } as Raw, ...(note ? { note } : {}) }];
}

/** Where a refusal's words point: the server names "effect 2" or "refuse_if 1" (counting from 1) and the question's name. */
export interface Pointed {
  effect?: string;
  refusal?: string;
  param?: string;
  condition?: boolean;
}
export function pointAt(message: string, d: ButtonDraft): Pointed {
  const nth = (word: string) => {
    const m = new RegExp(`\\b${word}\\s+#?(\\d+)\\b`, "i").exec(message);
    return m ? Number(m[1]) - 1 : -1;
  };
  const out: Pointed = {};
  out.effect = d.effects[nth("effect")]?.key;
  out.refusal = d.refusals[nth("refuse_if")]?.key;
  out.param = d.params.find((p) => p.name && new RegExp(`\\bparams?\\.?\\s*${p.name}\\b`, "i").test(message))?.key;
  if (/\bcondition\b/i.test(message) && !out.effect && !out.refusal) out.condition = true;
  return out;
}

export const buttonsLink = (entity: string) => `/customize/${encodeURIComponent(entity)}/buttons`;
