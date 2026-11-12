// An approval policy on a workflow transition (BD-19) as the designer edits it: ordered steps, each with its approvers,
// how many, and the rest of what the server takes. `fromPolicy` and `toPolicy` convert between the server's JSON and
// a draft so that opening and saving changes nothing the person did not touch (what the screen has no control for stays
// in `extra`). `checkPolicy` says in words what would not work; what the server refuses is shown as it words it.

import { t as tr } from "@ferrum/client";
import { newKey } from "./automationDraft";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const strings = (v: unknown) => (Array.isArray(v) ? v.map(str) : []);
const rest = (o: Raw, known: string[]): Raw => Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k)));

export const MAX_STEPS = 10;
export const WHO_KINDS = ["role", "field", "expr"] as const;
export type WhoKind = (typeof WHO_KINDS)[number];

/** Who may decide: a role, a field of the record holding a user, or an expression giving one. */
export interface DraftWho {
  kind: WhoKind;
  value: string;
  extra: Raw;
}

export interface DraftStep {
  key: string;
  label: string;
  who: DraftWho;
  need: "any" | "all" | "number";
  /** Whole number, when `need` is `number`. */
  count: string;
  when: string;
  with_next: boolean;
  not_earlier_deciders: boolean;
  /** Names of the workflow's actions. */
  not_who_took: string[];
  calendar: string;
  /** ISO 8601 durations, or a number of seconds the screen has no control for (kept as it was). */
  remind_after: string;
  escalate_after: string;
  escalate_to: DraftWho | null;
  extra: Raw;
}

export interface DraftPolicy {
  steps: DraftStep[];
  allow_requester: boolean;
  /** Names of fields. */
  reset_on: string[];
  /** Key of a state of the workflow ("" none: the record stays). */
  on_reject: string;
  /** While it is pending the record is not edited but for `reset_on` fields. */
  lock: boolean;
  /** On a document's submit or cancel: the system goes ahead without asking. */
  system_bypass: boolean;
  /** Fields an approver sees though a field group hides them. */
  show: string[];
  extra: Raw;
}

export const newWho = (): DraftWho => ({ kind: "role", value: "", extra: {} });
export const newStep = (): DraftStep => ({
  key: newKey(), label: "", who: newWho(), need: "any", count: "2", when: "", with_next: false, not_earlier_deciders: false, not_who_took: [], calendar: "",
  remind_after: "", escalate_after: "", escalate_to: null, extra: {},
});
export const newPolicy = (): DraftPolicy => ({ steps: [newStep()], allow_requester: false, reset_on: [], on_reject: "", lock: false, system_bypass: false, show: [], extra: {} });

function fromWho(v: unknown): DraftWho {
  const o = isObj(v) ? v : {};
  const kind = WHO_KINDS.find((k) => k in o) ?? "role";
  return { kind, value: str(o[kind]), extra: rest(o, [...WHO_KINDS]) };
}
const whoJson = (w: DraftWho): Raw => ({ ...w.extra, [w.kind]: w.value.trim() });

const STEP_KNOWN = ["label", "approvers", "need", "when", "with_next", "not_earlier_deciders", "not_who_took", "calendar", "remind_after", "escalate_after", "escalate_to"];

/** `keyOf`: a state's name to the key the designer knows it by. */
export function fromPolicy(raw: unknown, keyOf: (name: string) => string): DraftPolicy | null {
  if (!isObj(raw)) return null;
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).map((s): DraftStep => {
    const o = isObj(s) ? s : {};
    const need = o.need;
    return {
      key: newKey(),
      label: str(o.label),
      who: fromWho(o.approvers),
      need: need === "all" ? "all" : typeof need === "number" ? "number" : "any",
      count: typeof need === "number" ? String(need) : "2",
      when: str(o.when),
      with_next: o.with_next === true,
      not_earlier_deciders: o.not_earlier_deciders === true,
      not_who_took: strings(o.not_who_took),
      calendar: str(o.calendar),
      remind_after: str(o.remind_after),
      escalate_after: str(o.escalate_after),
      escalate_to: o.escalate_to === undefined || o.escalate_to === null ? null : fromWho(o.escalate_to),
      extra: rest(o, STEP_KNOWN),
    };
  });
  return {
    steps,
    allow_requester: raw.allow_requester === true,
    reset_on: strings(raw.reset_on),
    on_reject: raw.on_reject ? keyOf(str(raw.on_reject)) : "",
    lock: raw.lock === true,
    system_bypass: raw.system_bypass === true,
    show: strings(raw.show),
    extra: rest(raw, ["steps", "allow_requester", "reset_on", "on_reject", "lock", "system_bypass", "show"]),
  };
}

/** The `approval` a draft comes to (the server's policy), `name`: a state's key to its name. */
export function toPolicy(d: DraftPolicy, name: (key: string) => string): Raw {
  const out: Raw = {
    ...d.extra,
    steps: d.steps.map((s) => {
      const o: Raw = { ...s.extra };
      if (s.label.trim()) o.label = s.label.trim();
      o.approvers = whoJson(s.who);
      if (s.need === "all") o.need = "all";
      else if (s.need === "number") o.need = Number(s.count);
      if (s.when.trim()) o.when = s.when.trim();
      if (s.with_next) o.with_next = true;
      if (s.not_earlier_deciders) o.not_earlier_deciders = true;
      if (s.not_who_took.length) o.not_who_took = s.not_who_took;
      if (s.calendar.trim()) o.calendar = s.calendar.trim();
      if (s.remind_after.trim()) o.remind_after = s.remind_after.trim();
      if (s.escalate_after.trim()) o.escalate_after = s.escalate_after.trim();
      if (s.escalate_to) o.escalate_to = whoJson(s.escalate_to);
      return o;
    }),
  };
  if (d.allow_requester) out.allow_requester = true;
  if (d.reset_on.length) out.reset_on = d.reset_on;
  if (d.on_reject) out.on_reject = name(d.on_reject);
  if (d.lock) out.lock = true;
  if (d.system_bypass) out.system_bypass = true;
  if (d.show.length) out.show = d.show;
  return out;
}

export interface PolicyProblem {
  message: string;
  /** The key of the step it is about. */
  step?: string;
}

/** What is wrong with a policy, in words a person who is not a developer follows. */
export function checkPolicy(d: DraftPolicy): PolicyProblem[] {
  const out: PolicyProblem[] = [];
  if (!d.steps.length) return [{ message: tr("An approval needs at least one step: add one, or take the approval off.") }];
  if (d.steps.length > MAX_STEPS) out.push({ message: tr("Use at most {n} approval steps.", { n: MAX_STEPS }) });
  d.steps.forEach((s, i) => {
    const say = (m: string) => out.push({ message: tr("Approval step {n}: {message}", { n: i + 1, message: m }), step: s.key });
    if (!s.who.value.trim()) say(tr("say who decides."));
    if (s.need === "number" && !/^[1-9]\d*$/.test(s.count.trim())) say(tr("how many must agree is a whole number, 1 or more."));
    if (s.escalate_to && !s.escalate_to.value.trim()) say(tr("say who it is escalated to."));
    if (s.escalate_to && !s.escalate_after.trim()) say(tr("set when it is escalated, or take the escalation off."));
  });
  return out;
}

/** Where a refusal's words point: "transition Submit, approval step 2: …" names the step (counting from 1). */
export function stepAt(message: string, action: string, d: DraftPolicy): string | undefined {
  const m = /transition (.+?), approval step (\d+)/i.exec(message);
  return m && m[1].trim() === action.trim() ? d.steps[Number(m[2]) - 1]?.key : undefined;
}

/** What `set_approval` takes for a document's submit or cancel: the policy as a draft makes it, with no state to reject to and
 *  no transition to name (the server refuses both there); `null` takes the policy away. Unknown properties stay. */
export type DocOn = "submit" | "cancel" | { action: string };
/** How the server names it: `submit`, `cancel`, `action:<name>`. */
export const onKey = (on: DocOn): string => (typeof on === "string" ? on : `action:${on.action}`);

export const documentOp = (on: DocOn, d: DraftPolicy | null): Raw => ({
  op: "set_approval",
  on,
  approval: d ? toPolicy({ ...d, on_reject: "", steps: d.steps.map((s) => ({ ...s, not_who_took: [] })) }, (k) => k) : null,
});

/** The policy now on a document's submit or cancel, from the customizations list (`GET /api/customize`): the latest active
 *  `set_approval` of the entity for that action that nothing replaced; `null` when none (or it was taken away). A policy a
 *  package itself declares is not in that list. */
export function currentDocumentPolicy(list: { entity: string; op: Raw; is_active: boolean; seq: number; superseded_by?: string | null }[], entity: string, on: DocOn): Raw | null {
  const mine = list.filter((c) => c.entity === entity && c.is_active && !c.superseded_by && c.op.op === "set_approval" && (typeof on === "string" ? c.op.on === on : isObj(c.op.on) && c.op.on.action === on.action)).sort((a, b) => b.seq - a.seq);
  return isObj(mine[0]?.op.approval) ? (mine[0].op.approval as Raw) : null;
}

export const documentApprovalsLink = (entity: string) => `/customize/${encodeURIComponent(entity)}/approvals`;

/** What `GET /api/customize/definition/{Entity}` says of the policies a package ships: a package's entity answers
 * `approvals: [{on, policy, package, changed, workspace}]`; a custom entity `approvals: {key: policy}` and
 * `package_approvals: [{on, policy, package}]`. For one `on` key: the package, and whether an administrator changed it
 * (their policy differs from what ships, or is switched off); `null` when no package ships one there. */
export function shippedPolicy(def: unknown, key: string): { package: string; changed: boolean } | null {
  const d = (isObj(def) ? def : {}) as Raw;
  const shipped = (Array.isArray(d.package_approvals) ? d.package_approvals : Array.isArray(d.approvals) ? d.approvals : []) as Raw[];
  const one = shipped.find((a) => isObj(a) && a.on === key);
  if (!one) return null;
  const now = typeof one.changed === "boolean" ? one.changed : JSON.stringify((isObj(d.approvals) ? (d.approvals as Raw)[key] : undefined) ?? null) !== JSON.stringify(one.policy);
  return { package: String(one.package ?? ""), changed: now };
}

/** The policy in force on one `on` key according to the definition (a package's own, until the workspace sets its own), or null. */
export function effectivePolicy(def: unknown, key: string): Raw | null {
  const d = (isObj(def) ? def : {}) as Raw;
  const p = Array.isArray(d.approvals) ? (d.approvals as Raw[]).find((a) => isObj(a) && a.on === key)?.workspace : isObj(d.approvals) ? (d.approvals as Raw)[key] : null;
  return isObj(p) ? p : null;
}

export interface PolicyRow {
  entity: string;
  /** `submit`, `cancel`, `action:<name>` or `transition <action>`. */
  on: string;
  steps: string[];
  /** The page that edits it. */
  to: string;
  /** Shipped by this package (a policy a package declares); `changed`: an administrator changed or switched it off. */
  shipped?: { package: string; changed: boolean };
}

/** Every approval policy the workspace itself has set, from the customizations list (`GET /api/customize`): the latest active
 * `set_approval` per entity and `on`, and each workflow transition that carries a policy. Policies only a package ships are not
 * in that list; each entity's page shows them. */
export function approvalIndex(list: { entity: string; op: Raw; is_active: boolean; seq: number; superseded_by?: string | null }[]): PolicyRow[] {
  const latest = new Map<string, { seq: number; row: PolicyRow | null }>();
  const labels = (a: unknown) => (isObj(a) && Array.isArray(a.steps) ? a.steps.map((x, i) => (isObj(x) && typeof x.label === "string" && x.label ? x.label : `${i + 1}`)) : []);
  for (const c of list) {
    if (!c.is_active || c.superseded_by) continue;
    let key = "";
    let row: PolicyRow | null = null;
    if (c.op.op === "set_approval") {
      const on = typeof c.op.on === "string" ? c.op.on : isObj(c.op.on) ? `action:${String(c.op.on.action)}` : "";
      key = `${c.entity}|${on}`;
      row = isObj(c.op.approval) ? { entity: c.entity, on, steps: labels(c.op.approval), to: documentApprovalsLink(c.entity) } : null;
    } else if (c.op.op === "set_workflow" && isObj(c.op.workflow) && Array.isArray(c.op.workflow.transitions)) {
      key = `${c.entity}|workflow`;
      const found = (c.op.workflow.transitions as Raw[]).filter((x) => isObj(x.approval));
      for (const x of found) latest.set(`${c.entity}|transition ${String(x.action)} ${String(x.from)}`, { seq: c.seq, row: { entity: c.entity, on: `transition ${String(x.action)}`, steps: labels(x.approval), to: `/customize/${encodeURIComponent(c.entity)}/workflow` } });
      continue;
    } else continue;
    const had = latest.get(key);
    if (!had || c.seq > had.seq) latest.set(key, { seq: c.seq, row });
  }
  return [...latest.values()].flatMap((v) => (v.row ? [v.row] : [])).sort((a, b) => a.entity.localeCompare(b.entity) || a.on.localeCompare(b.on));
}

/** The policies the packages ship on one entity, from `GET /api/customize/definition/{Entity}` (either shape), as index rows. */
export function shippedRows(entity: string, def: unknown): PolicyRow[] {
  const d = (isObj(def) ? def : {}) as Raw;
  const list = (Array.isArray(d.package_approvals) ? d.package_approvals : Array.isArray(d.approvals) ? d.approvals : []) as Raw[];
  return list.flatMap((a) => {
    if (!isObj(a) || typeof a.on !== "string") return [];
    const steps = isObj(a.policy) && Array.isArray(a.policy.steps) ? a.policy.steps.map((x, i) => (isObj(x) && typeof x.label === "string" && x.label ? x.label : `${i + 1}`)) : [];
    const now = typeof a.changed === "boolean" ? a.changed : JSON.stringify((isObj(d.approvals) ? (d.approvals as Raw)[a.on] : undefined) ?? null) !== JSON.stringify(a.policy);
    return [{ entity, on: a.on, steps, to: a.on.startsWith("transition") ? `/customize/${encodeURIComponent(entity)}/workflow` : documentApprovalsLink(entity), shipped: { package: String(a.package ?? ""), changed: now } }];
  });
}
