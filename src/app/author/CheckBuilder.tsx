import { useId, useState } from "react";
import { t as tr, isolate } from "@ferrum/client";
import { buildCheck, checkable, checkProblems, newCheck, newCheckRow, openAs, opName, opsForType, parseCheck, type CheckDraft, type CheckRow } from "../../lib/checkBuilder";
import type { Field as MetaField } from "../../lib/meta";
import { Button } from "../../ui/kit";
import { ExprInput, linkChips } from "./ExprInput";
import { grow, optionsOf, Pick, wrap } from "./controls";

/** What the builder holds: rows, or (in "advanced") the expression as typed. */
export interface CheckState { advanced: boolean; draft: CheckDraft; text: string }
export const startCheck = (): CheckState => ({ advanced: false, draft: newCheck(), text: "" });
/** A state that opens an existing expression as rows when the builder wrote it, else as text. */
export function checkStateOf(expr: string, fields: MetaField[]): CheckState {
  // Nothing written yet: the builder with no rows, not a box to type an expression into.
  if (!expr.trim()) return { advanced: false, draft: { join: "all", rows: [] }, text: "" };
  const open = openAs(expr, fields);
  return open.mode === "builder" ? { advanced: false, draft: open.draft, text: expr } : { advanced: true, draft: newCheck(), text: expr };
}
/** The expression to send ("" while the rows are unfinished). */
export const checkText = (s: CheckState, fields: MetaField[]) => (s.advanced ? s.text.trim() : buildCheck(s.draft, fields));

function Value({ row, field, n, onChange }: { row: CheckRow; field: MetaField | undefined; n: number; onChange: (v: string) => void }) {
  const type = field?.type;
  const label = tr("Value of condition {n}", { n });
  if (row.op === "filled" || row.op === "empty") return null;
  if (type === "check")
    return (
      <select className="select" style={grow} aria-label={label} value={row.value === "false" ? "false" : "true"} onChange={(e) => onChange(e.target.value)}>
        <option value="true">{tr("Yes")}</option>
        <option value="false">{tr("No")}</option>
      </select>
    );
  if (type === "select" && field?.options?.length)
    return (
      <select className="select" style={grow} aria-label={label} value={row.value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{tr("Choose…")}</option>
        {field.options.map((o) => (
          <option key={o} value={o}>{isolate(o)}</option>
        ))}
      </select>
    );
  const kind = type === "date" ? "date" : type === "datetime" ? "datetime-local" : "text";
  return <input className="input" style={grow} type={kind} inputMode={type === "int" ? "numeric" : type === "decimal" || type === "currency" || type === "percent" ? "decimal" : undefined} aria-label={label} value={row.value} onChange={(e) => onChange(e.target.value)} />;
}

/** The words around a check; the builder is written for a rule on saving, a button's condition or refusal says its own. */
export interface CheckWords { one: string; many: string; advancedLabel: string; hint: string }
const saveWords = (): CheckWords => ({ one: tr("The save goes through when this holds"), many: tr("The save goes through when"), advancedLabel: tr("Check (must be true)"), hint: tr("Variables: doc, old, user, today, now") });

/** A check as rows (field, comparison, value) joined by "all of" or "any of", with the expression they come to shown;
 *  "Advanced" is the expression itself. */
export function CheckInput({ fields, state, onChange, words, optional }: { fields: MetaField[]; state: CheckState; onChange: (s: CheckState) => void; words?: CheckWords; /** Leaving it empty is an answer: no rows is not a fault. */ optional?: boolean }) {
  const w = { ...saveWords(), ...words };
  const id = useId();
  const [notice, setNotice] = useState<string | null>(null);
  const usable = checkable(fields);
  const { draft } = state;
  const setRows = (rows: CheckRow[]) => onChange({ ...state, draft: { ...draft, rows } });
  const edit = (key: string, patch: Partial<CheckRow>) => setRows(draft.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const expr = buildCheck(draft, fields);
  const problems = optional && !draft.rows.length ? [] : checkProblems(draft, fields);
  const toggle = (advanced: boolean) => {
    setNotice(null);
    if (advanced) return onChange({ ...state, advanced, text: expr || state.text });
    const back = parseCheck(state.text, fields);
    if (back) return onChange({ ...state, advanced, draft: back });
    // Typed by hand: it has no rows to show, and it stays as it is.
    if (state.text.trim()) return setNotice(tr("This check was not written with rows, so it has none to show. It stays as you typed it."));
    onChange({ ...state, advanced, draft: newCheck() });
  };
  return (
    <div className="stack">
      <label className="check-field">
        <input type="checkbox" checked={state.advanced} onChange={(e) => toggle(e.target.checked)} />
        {tr("Advanced: type the expression")}
      </label>
      {notice && <p className="field-hint" role="status">{notice}</p>}
      {state.advanced ? (
        <ExprInput label={w.advancedLabel} value={state.text} onChange={(text) => onChange({ ...state, text })} fields={usable} links={linkChips(fields)} hint={w.hint} functions />
      ) : (
        <div className="stack" role="group" aria-labelledby={`${id}-head`}>
          <div className="row" style={{ flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span className="field-label" id={`${id}-head`}>{draft.rows.length > 1 ? w.many : w.one}</span>
            {draft.rows.length > 1 && (
              <select className="select" style={{ width: "auto" }} aria-label={tr("Join the conditions with")} value={draft.join} onChange={(e) => onChange({ ...state, draft: { ...draft, join: e.target.value as "all" | "any" } })}>
                <option value="all">{tr("all of these hold")}</option>
                <option value="any">{tr("any of these holds")}</option>
              </select>
            )}
          </div>
          {draft.rows.map((r, i) => {
            const f = usable.find((x) => x.name === r.field);
            const ops = opsForType(f?.type);
            return (
              <div key={r.key} className="row" style={wrap}>
                <div style={grow}>
                  <Pick label={tr("Field of condition {n}", { n: i + 1 })} value={r.field} options={optionsOf(usable, r.field)} onChange={(v) => {
                    const type = usable.find((x) => x.name === v)?.type;
                    edit(r.key, { field: v, op: opsForType(type).includes(r.op) ? r.op : opsForType(type)[0], value: "" });
                  }} />
                </div>
                <select className="select" style={grow} aria-label={tr("Comparison of condition {n}", { n: i + 1 })} value={r.op} onChange={(e) => edit(r.key, { op: e.target.value as CheckRow["op"] })}>
                  {ops.map((o) => (
                    <option key={o} value={o}>{opName(o, f?.type)}</option>
                  ))}
                </select>
                <Value row={r} field={f} n={i + 1} onChange={(value) => edit(r.key, { value })} />
                <Button size="sm" icon="trash" aria-label={tr("Remove condition {n}", { n: i + 1 })} onClick={() => setRows(draft.rows.filter((x) => x.key !== r.key))} />
              </div>
            );
          })}
          <div>
            <Button size="sm" icon="plus" onClick={() => setRows([...draft.rows, newCheckRow()])}>{tr("Add a condition")}</Button>
          </div>
          <div aria-live="polite">
            {expr ? (
              <p className="field-hint">{tr("Written as")} <code className="mono" dir="ltr">{expr}</code></p>
            ) : (
              <ul className="field-hint" style={{ margin: 0, paddingInlineStart: 18 }}>
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            {expr && problems.length > 0 && <p className="field-error">{problems[0]}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A condition as rows or an expression; what it comes to is handed up as text. */
export function WhenInput({ value, onChange, fields, words, optional }: { value: string; onChange: (v: string) => void; fields: MetaField[]; words: CheckWords; optional?: boolean }) {
  const [state, setState] = useState<CheckState>(() => checkStateOf(value, fields));
  return <CheckInput fields={fields} state={state} words={words} optional={optional} onChange={(s) => { setState(s); onChange(checkText(s, fields)); }} />;
}
