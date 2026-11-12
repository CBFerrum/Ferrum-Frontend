// A workflow as the designer edits it (docs: Customize → Design workflow). The server's shape names a
// transition's states by name; here they are named by a key that does not change, so renaming or
// moving a state leaves every transition pointing at the same state. `fromMeta` and `toWorkflow` convert
// between the two; `checkDraft` says in plain words what would not work, before anything is sent. What the
// server additionally refuses (a condition it cannot read, a field that is gone) is shown as it words it.

import { t as tr } from "@ferrum/client";
import { checkPolicy, fromPolicy, newPolicy, toPolicy, type DraftPolicy } from "./approvalDraft";
import { checkActions, actionJson, fromAction, type DraftAction } from "./automationDraft";
import { checkParams, paramsFrom, paramsJson, type DraftParam } from "./buttonDraft";
import type { EntityMeta, Workflow } from "./meta";

export const MAX_TRANSITION_EFFECTS = 10;
/** What a transition carries that the screen has no control for stays as it was; the server's own marks are not part of it. */
const KNOWN = ["action", "from", "to", "roles", "condition", "not_creator", "not_creator_of", "params", "effects", "approval", "may_take", "may_run", "package"];

export interface DraftState {
  key: string;
  name: string;
  /** 0 draft, 1 submitted, 2 cancelled: only 0 where the entity cannot be submitted. */
  docstatus: number;
  edit_roles: string[];
  editable: string[];
  required: string[];
}

export interface DraftTransition {
  key: string;
  action: string;
  /** Keys of states. */
  from: string;
  to: string;
  roles: string[];
  condition: string;
  not_creator: boolean;
  not_creator_of: string[];
  /** What it asks for when taken. */
  params: DraftParam[];
  /** What it does after the move. */
  effects: DraftAction[];
  /** Who must agree first; null: nobody. */
  approval: DraftPolicy | null;
  extra: Record<string, unknown>;
}

export interface Draft {
  name: string;
  /** Key of the state a new record starts in. */
  initial: string;
  states: DraftState[];
  transitions: DraftTransition[];
}

/** What would not work, and where (a state's or a transition's key) so the screen can point at it. */
export interface Problem {
  message: string;
  state?: string;
  transition?: string;
  /** The key of an approval step, a question or an effect of the transition. */
  step?: string;
}

export { newPolicy };
export const workflowDesignerLink = (entity: string) => `/customize/${encodeURIComponent(entity)}/workflow`;

let counter = 0;
/** A key no other state or transition of the page has. */
export const newKey = (prefix: "s" | "t") => `${prefix}${++counter}`;

/** The workflow the server sent in an entity's meta (packaged or customized), as a draft. */
export function fromMeta(meta: Pick<EntityMeta, "name" | "label">, wf: Workflow): Draft {
  const states: DraftState[] = wf.states.map((s) => ({
    key: newKey("s"),
    name: s.name,
    docstatus: s.docstatus ?? 0,
    edit_roles: [...(s.edit_roles ?? [])],
    editable: [...(s.editable ?? [])],
    required: [...(s.required ?? [])],
  }));
  // A name no state has (a broken package) gets a key of its own, which checkDraft then reports.
  const keyOf = (name: string) => states.find((s) => s.name === name)?.key ?? `?${name}`;
  return {
    name: wf.name || `${meta.label} workflow`,
    initial: keyOf(wf.initial_state),
    states,
    transitions: wf.transitions.map((t) => ({
      key: newKey("t"),
      action: t.action,
      from: keyOf(t.from),
      to: keyOf(t.to),
      roles: [...(t.roles ?? [])],
      condition: t.condition ?? "",
      not_creator: !!t.not_creator,
      not_creator_of: [...(t.not_creator_of ?? [])],
      params: paramsFrom(t.params),
      effects: (Array.isArray(t.effects) ? t.effects : []).map(fromAction),
      approval: fromPolicy(t.approval, keyOf),
      extra: Object.fromEntries(Object.entries(t as unknown as Record<string, unknown>).filter(([k]) => !KNOWN.includes(k))),
    })),
  };
}

/** The first state of a workflow being started. */
export function startDraft(meta: Pick<EntityMeta, "name" | "label">): Draft {
  const key = newKey("s");
  return { name: `${meta.label} workflow`, initial: key, states: [{ key, name: tr("Draft"), docstatus: 0, edit_roles: [], editable: [], required: [] }], transitions: [] };
}

/** What `set_workflow` takes (the server's WorkflowDef), names in place of keys. */
export function toWorkflow(d: Draft, entity: string) {
  const name = (key: string) => d.states.find((s) => s.key === key)?.name.trim() ?? key;
  return {
    name: d.name.trim() || entity,
    entity,
    initial_state: name(d.initial),
    states: d.states.map((s) => ({ name: s.name.trim(), docstatus: s.docstatus, edit_roles: s.edit_roles, editable: s.editable, required: s.required })),
    transitions: d.transitions.map((t) => ({
      ...t.extra,
      action: t.action.trim(),
      from: name(t.from),
      to: name(t.to),
      roles: t.roles,
      condition: t.condition.trim() || null,
      not_creator: t.not_creator,
      not_creator_of: t.not_creator_of,
      ...(t.params.length ? { params: paramsJson(t.params) } : {}),
      ...(t.effects.length ? { effects: t.effects.map(actionJson) } : {}),
      ...(t.approval ? { approval: toPolicy(t.approval, name) } : {}),
    })),
  };
}

/** The operation that replaces an entity's workflow. */
export const workflowOp = (d: Draft, entity: string) => ({ op: "set_workflow", workflow: toWorkflow(d, entity) });

/** Moves the item at `index` by `by` places (a no-op at the ends). */
export function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Takes a state out, with the actions into and out of it; the starting state falls to the first left. */
export function removeState(d: Draft, key: string): Draft {
  const states = d.states.filter((s) => s.key !== key);
  return { ...d, states, initial: d.initial === key ? (states[0]?.key ?? "") : d.initial, transitions: d.transitions.filter((t) => t.from !== key && t.to !== key) };
}

/** The states a record can reach from the starting one. */
export function reachable(d: Draft): Set<string> {
  const seen = new Set<string>();
  const known = new Set(d.states.map((s) => s.key));
  const queue = known.has(d.initial) ? [d.initial] : [];
  while (queue.length) {
    const k = queue.pop() as string;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const t of d.transitions) if (t.from === k && known.has(t.to)) queue.push(t.to);
  }
  return seen;
}

/** What is wrong with a draft, in words a person who is not a developer follows. */
export function checkDraft(d: Draft, submittable: boolean): Problem[] {
  const out: Problem[] = [];
  if (!d.states.length) return [{ message: tr("Add at least one state.") }];
  const label = (s: DraftState) => s.name.trim() || tr("a state with no name");
  const names = new Map<string, DraftState>();
  for (const s of d.states) {
    const n = s.name.trim();
    if (!n) out.push({ message: tr("Every state needs a name."), state: s.key });
    else if (names.has(n)) out.push({ message: tr("Two states are called “{name}”: give each its own name.", { name: n }), state: s.key });
    else names.set(n, s);
    if (s.docstatus !== 0 && !submittable) out.push({ message: tr("“{name}” cannot mean submitted or cancelled: this kind of record is never submitted.", { name: label(s) }), state: s.key });
  }
  const has = new Set(d.states.map((s) => s.key));
  if (!has.has(d.initial)) out.push({ message: tr("Choose the state a new record starts in.") });
  const seen = new Set<string>();
  for (const t of d.transitions) {
    const from = d.states.find((s) => s.key === t.from);
    const action = t.action.trim();
    if (!action) out.push({ message: tr("Every action needs a name."), transition: t.key });
    if (!from) out.push({ message: tr("The action “{action}” does not start from a state that exists.", { action: action || "…" }), transition: t.key });
    if (!has.has(t.to)) out.push({ message: tr("The action “{action}” does not lead to a state that exists.", { action: action || "…" }), transition: t.key });
    for (const p of checkParams(t.params)) out.push({ message: tr("Action “{action}”: {message}", { action: action || "…", message: p.message }), transition: t.key, step: p.row });
    for (const p of checkActions(t.effects, MAX_TRANSITION_EFFECTS).filter((p) => p.message !== tr("Add at least one action."))) out.push({ message: tr("Action “{action}”: {message}", { action: action || "…", message: p.message }), transition: t.key, step: p.action });
    if (t.approval) for (const p of checkPolicy(t.approval)) out.push({ message: tr("Action “{action}”: {message}", { action: action || "…", message: p.message }), transition: t.key, step: p.step });
    if (action && from) {
      const id = `${t.from}\n${action}`;
      if (seen.has(id)) out.push({ message: tr("“{state}” has two actions called “{action}”: rename one.", { state: label(from), action }), transition: t.key });
      seen.add(id);
    }
  }
  if (has.has(d.initial)) {
    const reach = reachable(d);
    for (const s of d.states) if (!reach.has(s.key)) out.push({ message: tr("“{name}” can never be reached: no action leads to it from the starting state.", { name: label(s) }), state: s.key });
  }
  return out;
}

/** The links a record's own creator (or those a link names) may be barred from acting on: the entity's
 *  link fields, and `table.field` for the links of a child table's rows, as the server accepts them. */
export function creatorLinkChoices(meta: Pick<EntityMeta, "fields" | "children">): { value: string; label: string }[] {
  const isLink = (f: { type: string; to?: string }) => f.type === "link" && !!f.to;
  const own = meta.fields.filter(isLink).map((f) => ({ value: f.name, label: f.label || f.name }));
  const rows = meta.fields
    .filter((f) => f.type === "table")
    .flatMap((t) => (meta.children?.[t.name]?.fields ?? []).filter(isLink).map((f) => ({ value: `${t.name}.${f.name}`, label: `${t.label || t.name} → ${f.label || f.name}` })));
  return [...own, ...rows];
}
