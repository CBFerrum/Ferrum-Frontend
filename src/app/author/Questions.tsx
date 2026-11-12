// The questions a button or a workflow transition asks before it runs: the params editor both authoring screens share.

import { t as tr, isolate } from "@ferrum/client";
import { move } from "../../lib/automationDraft";
import { newParam, PARAM_TYPES, setParamLabel, type DraftParam } from "../../lib/buttonDraft";
import { Button, Field } from "../../ui/kit";
import { grow, optionsOf, Pick, Tools, wrap } from "./controls";

const PARAM_NAMES = (): Record<string, string> => ({ data: tr("Text"), text: tr("Long text"), select: tr("Choice"), int: tr("Whole number"), date: tr("Date"), link: tr("Link to…") });

/** The questions a button or a workflow transition asks first (name, label, kind of answer, choices, whether it must be answered). */
export function Questions<T extends { params: DraftParam[] }>({ d, onChange, entities, flagged, title, hint }: { d: T; onChange: (d: T) => void; entities: { value: string; label: string }[]; flagged: Set<string | undefined>; title?: string; hint?: string }) {
  const edit = (key: string, patch: Partial<DraftParam>) => onChange({ ...d, params: d.params.map((p) => (p.key === key ? { ...p, ...patch } : p)) });
  return (
    <section className="card" aria-labelledby="bt-params-h">
      <div className="card-head">
        <h3 className="card-title" id="bt-params-h">{title ?? tr("Questions asked when it is pressed")}</h3>
      </div>
      <div className="card-body stack">
        <p className="faint">{hint ?? tr("A dialog asks these before the button runs. The answers are params.name in the expressions below.")}</p>
        {d.params.map((p, i) => (
          <fieldset key={p.key} className="stack" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: 0, minWidth: 0, ...(flagged.has(p.key) ? { borderColor: "var(--danger)" } : {}) }}>
            <legend className="field-label">{tr("Question {n}", { n: i + 1 })}</legend>
            <div className="row" style={wrap}>
              <div style={{ ...grow, flexBasis: 200 }}>
                <Field label={tr("Label")} htmlFor={`bt-pl-${p.key}`}>
                  <input id={`bt-pl-${p.key}`} className="input" value={p.label} onChange={(e) => onChange(setParamLabel(d, p.key, e.target.value))} />
                </Field>
              </div>
              <div style={grow}>
                <Field label={tr("Name")} htmlFor={`bt-pn-${p.key}`} hint={tr("Written params.{name} in expressions.", { name: p.name || "name" })}>
                  <input id={`bt-pn-${p.key}`} className="input mono" spellCheck={false} autoCapitalize="none" value={p.name} onChange={(e) => edit(p.key, { name: e.target.value, nameTouched: true })} />
                </Field>
              </div>
              <div style={grow}>
                <Field label={tr("Kind of answer")} htmlFor={`bt-pt-${p.key}`}>
                  <select id={`bt-pt-${p.key}`} className="select" value={p.type} onChange={(e) => edit(p.key, { type: e.target.value })}>
                    {PARAM_TYPES.map((t) => (
                      <option key={t} value={t}>{PARAM_NAMES()[t]}</option>
                    ))}
                    {!(PARAM_TYPES as readonly string[]).includes(p.type) && <option value={p.type}>{isolate(p.type)}</option>}
                  </select>
                </Field>
              </div>
            </div>
            {p.type === "select" && (
              <Field label={tr("Choices, one per line")} htmlFor={`bt-po-${p.key}`}>
                <textarea id={`bt-po-${p.key}`} className="textarea" rows={3} value={p.options.join("\n")} onChange={(e) => edit(p.key, { options: e.target.value.split("\n") })} />
              </Field>
            )}
            {p.type === "link" && (
              <Field label={tr("Pick a record of")} htmlFor={`bt-pk-${p.key}`}>
                <Pick label={tr("Pick a record of")} id={`bt-pk-${p.key}`} value={p.to} options={optionsOf(entities.map((e) => ({ name: e.value, label: e.label })), p.to)} onChange={(to) => edit(p.key, { to })} />
              </Field>
            )}
            <Field label={tr("Explanation (optional)")} htmlFor={`bt-pd-${p.key}`}>
              <input id={`bt-pd-${p.key}`} className="input" value={p.description} onChange={(e) => edit(p.key, { description: e.target.value })} />
            </Field>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <label className="check-field">
                <input type="checkbox" checked={p.required} onChange={(e) => edit(p.key, { required: e.target.checked })} />
                {tr("It must be answered")}
              </label>
              <Tools index={i} count={d.params.length} what={tr("question {n}", { n: i + 1 })} onMove={(by) => onChange({ ...d, params: move(d.params, i, by) })} onRemove={() => onChange({ ...d, params: d.params.filter((x) => x.key !== p.key) })} />
            </div>
          </fieldset>
        ))}
        <div>
          <Button size="sm" icon="plus" onClick={() => onChange({ ...d, params: [...d.params, newParam()] })}>{tr("Add a question")}</Button>
        </div>
      </div>
    </section>
  );
}

