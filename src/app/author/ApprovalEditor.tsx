// The approval policy of a workflow transition (BD-19): who must agree before it is taken, as an ordered list of steps,
// and what the policy as a whole allows. The logic is lib/approvalDraft.ts. The server's refusal names a step by its
// number; `error` is shown on the step it points at.

import { t as tr, isolate } from "@ferrum/client";
import { useState } from "react";
import { MAX_STEPS, newStep, newWho, WHO_KINDS, type DraftPolicy, type DraftStep, type DraftWho, type WhoKind } from "../../lib/approvalDraft";
import { makeOffset, move, parseOffset, type Unit } from "../../lib/automationDraft";
import type { Field as MetaField } from "../../lib/meta";
import { Button, Field } from "../../ui/kit";
import { useCalendars } from "../TargetsDesigner";
import { ExprInput, linkChips } from "./ExprInput";
import { grow, Pick, Tools, wrap } from "./controls";
import { CheckGroup, useRoleNames } from "./RoleSelect";

const KIND_NAMES = (): Record<WhoKind, string> => ({ role: tr("A role"), field: tr("A field of the record"), expr: tr("An expression") });

/** A duration as a number and a unit, stored as ISO 8601 (`PT8H`). One the screen cannot show that way (`P1DT2H`, seconds) is kept as typed. */
function Duration({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (iso: string) => void }) {
  const parsed = parseOffset(value);
  const [unit, setUnit] = useState<Unit>(parsed?.unit ?? "hours");
  if (value && !parsed) {
    return (
      <Field label={label} htmlFor={id} hint={tr("Kept as it is: a form this screen has no number and unit for.")}>
        <input id={id} className="input mono" value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  const u = parsed?.unit ?? unit;
  return (
    <Field label={label} htmlFor={id}>
      <div className="row">
        <input id={id} className="input" type="number" min={1} step={1} style={{ width: 100 }} value={parsed?.amount ?? ""} onChange={(e) => onChange(e.target.value.trim() ? makeOffset(e.target.value.trim(), u, "after") : "")} />
        <select className="select" aria-label={tr("{label}: unit", { label })} value={u} onChange={(e) => { const next = e.target.value as Unit; setUnit(next); if (parsed) onChange(makeOffset(parsed.amount, next, "after")); }}>
          <option value="minutes">{tr("minutes")}</option>
          <option value="hours">{tr("hours")}</option>
          <option value="days">{tr("days")}</option>
        </select>
      </div>
    </Field>
  );
}

function Who({ id, legend, value, onChange, fields, entityFields }: { id: string; legend: string; value: DraftWho; onChange: (w: DraftWho) => void; fields: MetaField[]; entityFields: { name: string; label: string }[] }) {
  const roles = useRoleNames();
  const holders = fields.filter((f) => (f.type === "link" && f.to === "User") || f.type === "email");
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="field-label">{legend}</legend>
      <div className="row" style={wrap}>
        <div style={grow}>
          <select className="select" aria-label={tr("{legend}: kind", { legend })} value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value as WhoKind, value: "" })}>
            {WHO_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_NAMES()[k]}</option>
            ))}
          </select>
        </div>
        <div style={{ ...grow, flexBasis: 240 }}>
          {value.kind === "role" ? (
            <Pick label={tr("{legend}: role", { legend })} value={value.value} onChange={(v) => onChange({ ...value, value: v })} options={[...(roles.data?.roles ?? []).map((r) => ({ value: r.name, label: r.name })), ...(value.value && !(roles.data?.roles ?? []).some((r) => r.name === value.value) ? [{ value: value.value, label: value.value }] : [])]} />
          ) : value.kind === "field" ? (
            <Pick label={tr("{legend}: field", { legend })} value={value.value} onChange={(v) => onChange({ ...value, value: v })} options={[...holders.map((f) => ({ value: f.name, label: f.label || f.name })), ...(value.value && !holders.some((f) => f.name === value.value) ? [{ value: value.value, label: value.value }] : [])]} />
          ) : (
            <ExprInput id={`${id}-expr`} label={tr("{legend}: expression", { legend })} value={value.value} onChange={(v) => onChange({ ...value, value: v })} fields={entityFields} rows={1} hint={tr("Gives a user's id or e-mail address, or a list of them.")} />
          )}
        </div>
      </div>
    </fieldset>
  );
}

function StepCard({ s, i, count, fields, actions, document, error, flagged, onChange, onMove, onRemove }: {
  s: DraftStep; i: number; count: number; fields: MetaField[]; actions: string[]; document?: boolean; error?: string; flagged: boolean;
  onChange: (p: Partial<DraftStep>) => void; onMove: (by: -1 | 1) => void; onRemove: () => void;
}) {
  const calendars = useCalendars();
  const id = `ap-${s.key}`;
  const plain = fields.filter((f) => f.type !== "table").map((f) => ({ name: f.name, label: f.label }));
  const names = (calendars.data ?? []).map((c) => ({ value: c.name, label: c.name }));
  return (
    <fieldset className="stack" aria-invalid={flagged || !!error || undefined} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: 0, minWidth: 0, ...(flagged || error ? { borderColor: "var(--danger)" } : {}) }}>
      <legend className="field-label">{tr("Step {n}", { n: i + 1 })}</legend>
      {error && <p className="field-error" role="alert">{isolate(error)}</p>}
      <Field label={tr("Label")} htmlFor={`${id}-label`}>
        <input id={`${id}-label`} className="input" value={s.label} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <Who id={`${id}-who`} legend={tr("Who decides")} value={s.who} onChange={(who) => onChange({ who })} fields={fields} entityFields={plain} />
      <div className="row" style={wrap}>
        <div style={grow}>
          <Field label={tr("How many must agree")} htmlFor={`${id}-need`}>
            <select id={`${id}-need`} className="select" value={s.need} onChange={(e) => onChange({ need: e.target.value as DraftStep["need"] })}>
              <option value="any">{tr("Any one of them")}</option>
              <option value="all">{tr("All of them")}</option>
              <option value="number">{tr("A number of them")}</option>
            </select>
          </Field>
        </div>
        {s.need === "number" && (
          <div style={grow}>
            <Field label={tr("Number")} htmlFor={`${id}-count`}>
              <input id={`${id}-count`} className="input" type="number" min={1} step={1} value={s.count} onChange={(e) => onChange({ count: e.target.value })} />
            </Field>
          </div>
        )}
      </div>
      <ExprInput id={`${id}-when`} label={tr("Only when (a condition, optional)")} value={s.when} onChange={(when) => onChange({ when })} fields={plain} links={linkChips(fields)} rows={1} hint={tr("A step whose condition is false is skipped.")} />
      <label className="check-field">
        <input type="checkbox" checked={s.with_next} onChange={(e) => onChange({ with_next: e.target.checked })} />
        {tr("At the same time as the next step")}
      </label>
      <label className="check-field">
        <input type="checkbox" checked={s.not_earlier_deciders} onChange={(e) => onChange({ not_earlier_deciders: e.target.checked })} />
        {tr("Not someone who decided an earlier step")}
      </label>
      {!document && <CheckGroup legend={tr("Not whoever took…")} options={actions.map((a) => ({ value: a, label: a }))} value={s.not_who_took} onChange={(not_who_took) => onChange({ not_who_took })} empty={tr("This workflow has no actions yet.")} />}
      <Field label={tr("Business calendar (working time for the times below)")} htmlFor={`${id}-cal`}>
        {names.length ? (
          <select id={`${id}-cal`} className="select" value={s.calendar} onChange={(e) => onChange({ calendar: e.target.value })}>
            <option value="">{tr("None: clock time")}</option>
            {names.map((c) => (
              <option key={c.value} value={c.value}>{isolate(c.label)}</option>
            ))}
            {s.calendar && !names.some((c) => c.value === s.calendar) && <option value={s.calendar}>{isolate(s.calendar)}</option>}
          </select>
        ) : (
          <input id={`${id}-cal`} className="input" value={s.calendar} onChange={(e) => onChange({ calendar: e.target.value })} />
        )}
      </Field>
      <div className="row" style={wrap}>
        <Duration id={`${id}-remind`} label={tr("Remind after")} value={s.remind_after} onChange={(remind_after) => onChange({ remind_after })} />
        <Duration id={`${id}-escalate`} label={tr("Escalate after")} value={s.escalate_after} onChange={(escalate_after) => onChange({ escalate_after })} />
      </div>
      {s.escalate_to ? (
        <div className="stack">
          <Who id={`${id}-to`} legend={tr("Escalate to")} value={s.escalate_to} onChange={(escalate_to) => onChange({ escalate_to })} fields={fields} entityFields={plain} />
          <div>
            <Button size="sm" onClick={() => onChange({ escalate_to: null })}>{tr("No escalation")}</Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="sm" onClick={() => onChange({ escalate_to: newWho() })}>{tr("Escalate to someone")}</Button>
        </div>
      )}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Tools index={i} count={count} what={tr("step {n}", { n: i + 1 })} onMove={onMove} onRemove={onRemove} />
      </div>
    </fieldset>
  );
}

/** `document`: a document's own submit or cancel, which has no states to reject to and no transitions to name, and where the system may be let through. */
export function ApprovalEditor({ policy, onChange, fields, actions, states, flagged, errorStep, error, document, idPrefix = "ap" }: {
  policy: DraftPolicy; onChange: (p: DraftPolicy) => void; fields: MetaField[]; actions: string[]; states: { value: string; label: string }[];
  flagged: Set<string | undefined>; errorStep?: string; error?: string; document?: boolean; idPrefix?: string;
}) {
  const edit = (key: string, patch: Partial<DraftStep>) => onChange({ ...policy, steps: policy.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const plain = fields.filter((f) => f.type !== "table").map((f) => ({ value: f.name, label: f.label || f.name }));
  return (
    <div className="stack">
      {error && !errorStep && <p className="field-error" role="alert">{isolate(error)}</p>}
      {policy.steps.map((s, i) => (
        <StepCard
          key={s.key}
          s={s}
          i={i}
          count={policy.steps.length}
          fields={fields}
          actions={actions}
          document={document}
          flagged={flagged.has(s.key)}
          error={errorStep === s.key ? error : undefined}
          onChange={(p) => edit(s.key, p)}
          onMove={(by) => onChange({ ...policy, steps: move(policy.steps, i, by) })}
          onRemove={() => onChange({ ...policy, steps: policy.steps.filter((x) => x.key !== s.key) })}
        />
      ))}
      <div>
        <Button size="sm" icon="plus" disabled={policy.steps.length >= MAX_STEPS} onClick={() => onChange({ ...policy, steps: [...policy.steps, newStep()] })}>{tr("Add a step")}</Button>
      </div>
      <label className="check-field">
        <input type="checkbox" checked={policy.allow_requester} onChange={(e) => onChange({ ...policy, allow_requester: e.target.checked })} />
        {tr("The person who asked may decide too")}
      </label>
      <CheckGroup legend={tr("A change to these fields cancels the decisions so far")} options={plain} value={policy.reset_on} onChange={(reset_on) => onChange({ ...policy, reset_on })} />
      {!document && (
        <Field label={tr("When it is rejected, the record moves to")} htmlFor={`${idPrefix}-reject`}>
          <select id={`${idPrefix}-reject`} className="select" value={policy.on_reject} onChange={(e) => onChange({ ...policy, on_reject: e.target.value })}>
            <option value="">{tr("Nowhere: it stays where it is")}</option>
            {states.map((s) => (
              <option key={s.value} value={s.value}>{isolate(s.label)}</option>
            ))}
          </select>
        </Field>
      )}
      <label className="check-field">
        <input type="checkbox" checked={policy.lock} onChange={(e) => onChange({ ...policy, lock: e.target.checked })} />
        {tr("Lock the record while it awaits approval (but for the fields above)")}
      </label>
      {document && (
        <label className="check-field">
          <input type="checkbox" checked={policy.system_bypass} onChange={(e) => onChange({ ...policy, system_bypass: e.target.checked })} />
          {tr("Let the system (an automation, another app) go ahead without approval")}
        </label>
      )}
      <CheckGroup legend={tr("Fields approvers see even where a field group hides them")} options={plain} value={policy.show} onChange={(show) => onChange({ ...policy, show })} />
    </div>
  );
}
