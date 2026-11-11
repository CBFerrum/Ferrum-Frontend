// Service targets (administrators): "this must happen within so much working time" on any record type. The platform
// keeps a due moment and a state on each record; this screen sets a target up as one `add_target` customization (with the
// two fields it keeps, when they are made here) after a dry run, and removes one with `remove_target`. The draft logic is
// lib/targetDraft.ts.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage } from "../lib/api";
import { useEntityMeta, useMe, type EntityMeta } from "../lib/meta";
import { checkTarget, eligible, fromTarget, madeNames, readWithin, removeBatch, saveBatch, setLabel, startTarget, withinOf, withinWords, type Dur, type TargetDraft, type TargetDef, type Unit } from "../lib/targetDraft";
import { Alert, Button, confirmDialog, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";
import { BatchRefused, useApplyBatch } from "./author/apply";
import { WhenInput, type CheckWords } from "./author/CheckBuilder";
import { ExprInput, linkChips } from "./author/ExprInput";
import { FormCard } from "./author/FormCard";
import { grow, optionsOf, Pick, wrap } from "./author/controls";

export function TargetsDesignerPage() {
  const { entity = "" } = useParams();
  const me = useMe();
  if (me.isLoading) return <PageLoading />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can set up targets. Ask one of them to make this change.")}</p>
      </EmptyState>
    );
  }
  return <Loader key={entity} entity={entity} />;
}

function Loader({ entity }: { entity: string }) {
  const meta = useEntityMeta(entity);
  if (meta.error) {
    if (meta.error instanceof ApiError && meta.error.status === 404) {
      return (
        <EmptyState title={tr("There is no such entity")} icon="alert">
          <p className="muted">{tr("Nothing called {entity} is installed in this workspace.", { entity: isolate(entity) })}</p>
          <Link className="btn" to="/customize">{tr("Back to Customize")}</Link>
        </EmptyState>
      );
    }
    return <ErrorState error={meta.error} onRetry={() => meta.refetch()} title={tr("Could not load {entity}", { entity: isolate(entity) })} />;
  }
  if (!meta.data) return <PageLoading />;
  return <Targets meta={meta.data} />;
}

const STARTS = (): CheckWords => ({ one: tr("The clock starts when this holds"), many: tr("The clock starts when"), advancedLabel: tr("Starts when (must be true)"), hint: tr("Variables: doc, user, today, now") });
const PAUSES = (): CheckWords => ({ one: tr("The clock stops while this holds"), many: tr("The clock stops while"), advancedLabel: tr("Stops while (must be true)"), hint: tr("Variables: doc, user, today, now") });
const MET = (): CheckWords => ({ one: tr("The target is met when this holds"), many: tr("The target is met when"), advancedLabel: tr("Met when (must be true)"), hint: tr("Variables: doc, user, today, now") });

function Targets({ meta }: { meta: EntityMeta }) {
  const apply = useApplyBatch();
  const [editing, setEditing] = useState<TargetDraft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const targets = meta.targets ?? [];
  const label = isolate(meta.label);

  const remove = async (t: TargetDef) => {
    if (!(await confirmDialog({ title: tr("Remove the target?"), message: tr("“{label}” stops being kept on the records of {entity}. The two fields stay, with what they hold. Switch the change off under Customizations to bring it back.", { label: t.label, entity: meta.label }), confirmLabel: tr("Remove"), danger: true }))) return;
    setRemoving(t.name);
    try {
      const ops = removeBatch(meta.name, t.name, tr("Targets"));
      await apply(ops, true);
      await apply(ops, false);
      toast(tr("Target removed"));
    } catch (e) {
      toast(e instanceof BatchRefused ? e.message : errorMessage(e), "error");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/customize">{tr("Customize")}</Link> / <Link to={`/customize/${encodeURIComponent(meta.name)}`}>{label}</Link>
          </p>
          <h1 className="page-title">{tr("Targets of {entity}", { entity: label })}</h1>
        </div>
        {!editing && (
          <div className="page-actions">
            <Button variant="primary" icon="plus" onClick={() => setEditing(startTarget())}>{tr("New target")}</Button>
          </div>
        )}
      </div>
      {editing ? (
        <TargetForm key={editing.saved ? editing.name : "new"} meta={meta} start={editing} taken={targets.map((t) => t.name)} onClose={() => setEditing(null)} />
      ) : (
        <section className="card" aria-labelledby="tg-list">
          <div className="card-head">
            <h2 id="tg-list">{tr("Service targets")}</h2>
          </div>
          {!targets.length ? (
            <EmptyState title={tr("No targets yet")} icon="edit">
              <p className="muted">{tr("A target says a record must reach a state within so much time, counted in working hours if you like. The platform keeps the due moment and whether it is running, met or breached.")}</p>
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Target")}</th>
                    <th scope="col">{tr("Within")}</th>
                    <th scope="col">{tr("Counted in")}</th>
                    <th scope="col"><span className="sr-only">{tr("Change")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.name}>
                      <td>{isolate(t.label)}</td>
                      <td>{isolate(withinWords(t, meta.fields))}</td>
                      <td>{t.calendar ? isolate(t.calendar) : tr("Plain time")}</td>
                      <td className="nowrap">
                        <div className="row-actions">
                          <Button size="sm" onClick={() => setEditing(fromTarget(t as unknown as Record<string, unknown>, meta.fields))} aria-label={tr("Edit {name}", { name: t.label })}>{tr("Edit")}</Button>
                          <Button size="sm" icon="trash" loading={removing === t.name} disabled={!!removing} onClick={() => void remove(t)} aria-label={tr("Remove {name}", { name: t.label })} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const UNITS = (): { value: Unit; label: string }[] => [{ value: "m", label: tr("minutes") }, { value: "h", label: tr("hours") }, { value: "d", label: tr("days") }];

function DurInput({ value, onChange, label, id }: { value: Dur; onChange: (d: Dur) => void; label: string; id: string }) {
  return (
    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <input id={id} className="input" type="number" min={1} step={1} inputMode="numeric" style={{ width: 90 }} aria-label={label} value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} />
      <select className="select" aria-label={tr("Unit of {label}", { label })} value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as Unit })}>
        {UNITS().map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
      </select>
    </span>
  );
}

/** The workspace's business calendars; none when the route is not there (404) or the workspace has none. */
function useCalendars() {
  return useQuery({
    queryKey: ["admin-calendars"],
    queryFn: async ({ signal }) => {
      try {
        return (await api.get<{ calendars: { name: string }[] }>("/api/admin/calendars", undefined, signal)).calendars;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return [];
        throw e;
      }
    },
  });
}

function TargetForm({ meta, start, taken, onClose }: { meta: EntityMeta; start: TargetDraft; taken: string[]; onClose: () => void }) {
  const apply = useApplyBatch();
  const calendars = useCalendars();
  const [d, setD] = useState(start);
  const [problems, setProblems] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const packaged = !meta.custom;
  const fields = meta.fields;
  const others = taken.filter((n) => n !== start.name);
  const choices = fields.filter((f) => f.type === "select" && f.options?.length);
  const options = fields.find((f) => f.name === d.field)?.options ?? [];
  const names = madeNames(d, fields, packaged);
  const set = (next: TargetDraft) => {
    setD(next);
    setProblems([]);
    setRefusal(null);
  };
  const setHow = (how: TargetDraft["how"]) => {
    if (how === "advanced") return set({ ...d, how, within: withinOf(d, options) });
    set({ ...d, ...(d.how === "advanced" ? readWithin(d.within, fields) : null), how });
  };
  const due = eligible(fields, "due", d.name, packaged);
  const state = eligible(fields, "state", d.name, packaged);

  const save = async () => {
    const found = checkTarget(d, { taken: others, fields, packaged }).map((p) => p.message);
    setProblems(found);
    setRefusal(null);
    if (found.length) return;
    setBusy(true);
    try {
      // The workspace's own entity: its definition as it is now goes back with the two fields appended.
      const def = !packaged && (d.makeDue || d.makeState) ? (await api.get<{ entity: Record<string, unknown> }>(`/api/customize/definition/${encodeURIComponent(meta.name)}`)).entity : null;
      const ops = saveBatch(meta.name, d, { fields, packaged, def, note: tr("Targets") });
      await apply(ops, true);
      await apply(ops, false);
      toast(d.saved ? tr("Target saved") : tr("Target created"));
      onClose();
    } catch (e) {
      if (e instanceof BatchRefused && e.unchanged) {
        toast(tr("Nothing changed"));
        return onClose();
      }
      setRefusal(e instanceof BatchRefused ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const hows: { how: TargetDraft["how"]; label: string }[] = [
    { how: "same", label: tr("The same for every record") },
    { how: "choice", label: tr("Depends on a choice field") },
    { how: "advanced", label: tr("Advanced: an expression") },
  ];
  const keep = (kind: "due" | "state") => {
    const made = kind === "due" ? d.makeDue : d.makeState;
    const key = kind === "due" ? "dueField" : "stateField";
    const make = kind === "due" ? "makeDue" : "makeState";
    const list = kind === "due" ? due : state;
    const label = kind === "due" ? tr("Keeps the due moment") : tr("Keeps the state");
    return (
      <div style={{ ...grow, flexBasis: 220 }}>
        <Field label={label} htmlFor={`tg-${kind}`} hint={made ? tr("Made for you: {name}", { name: kind === "due" ? names.due : names.state }) : kind === "due" ? tr("A date and time field.") : tr("A text or choice field offering running, paused, met, met_late and breached.")}>
          {made ? (
            <input id={`tg-${kind}`} className="input mono" readOnly value={kind === "due" ? names.due : names.state} />
          ) : (
            <Pick id={`tg-${kind}`} label={label} value={d[key]} options={optionsOf(list, d[key])} onChange={(v) => set({ ...d, [key]: v })} />
          )}
        </Field>
        {!d.saved && (
          <label className="check-field">
            <input type="checkbox" checked={made} onChange={(e) => set({ ...d, [make]: e.target.checked })} />
            {tr("Make one for me")}
          </label>
        )}
      </div>
    );
  };

  return (
    <FormCard title={start.saved ? tr("Change the target {name}", { name: start.label }) : tr("New target")} onSubmit={save} busy={busy} submitLabel={tr("Save target")} error={refusal}>
      {problems.length > 0 && (
        <Alert tone="error">
          <strong>{tr("Fix these first")}</strong>
          <ul>
            {problems.map((p, i) => <li key={i}>{isolate(p)}</li>)}
          </ul>
        </Alert>
      )}
      <div className="row" style={wrap}>
        <div style={{ ...grow, flexBasis: 220 }}>
          <Field label={tr("Label")} htmlFor="tg-label" required>
            <input id="tg-label" className="input" value={d.label} onChange={(e) => set(setLabel(d, e.target.value, others))} />
          </Field>
        </div>
        <div style={{ ...grow, flexBasis: 200 }}>
          <Field label={tr("Name")} htmlFor="tg-name" hint={d.saved ? tr("Fixed once the target is saved.") : tr("Made from the label. You can change it until the target is saved.")}>
            <input id="tg-name" className="input mono" value={d.name} readOnly={d.saved} spellCheck={false} autoCapitalize="none" onChange={(e) => set({ ...d, name: e.target.value, nameTouched: true })} />
          </Field>
        </div>
      </div>

      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="field-label">{tr("How long")}</legend>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          {hows.map((h) => (
            <label key={h.how} className="check-field">
              <input type="radio" name="tg-how" checked={d.how === h.how} onChange={() => setHow(h.how)} />
              {h.label}
            </label>
          ))}
        </div>
        {d.how === "same" && <DurInput id="tg-same" label={tr("How long")} value={d.same} onChange={(same) => set({ ...d, same })} />}
        {d.how === "choice" && (
          <div className="stack">
            {choices.length ? (
              <Field label={tr("Choice field")} htmlFor="tg-field">
                <Pick id="tg-field" label={tr("Choice field")} value={d.field} options={optionsOf(choices, d.field)} onChange={(field) => set({ ...d, field, per: {} })} />
              </Field>
            ) : (
              <p className="faint">{tr("This entity has no choice field. Add one, or use another way of saying how long.")}</p>
            )}
            {d.field && (
              <>
                <p className="faint">{tr("A duration for each choice; leave it blank and records with that choice have no target.")}</p>
                {options.map((o, i) => (
                  <div key={o} className="row" style={{ ...wrap, alignItems: "center", gap: 8 }}>
                    <span style={{ ...grow, flexBasis: 120 }}>{isolate(o)}</span>
                    <DurInput id={`tg-per-${i}`} label={tr("How long for {choice}", { choice: o })} value={d.per[o] ?? { amount: "", unit: "h" }} onChange={(v) => set({ ...d, per: { ...d.per, [o]: v } })} />
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        {d.how === "advanced" && (
          <ExprInput label={tr("How long (an ISO 8601 duration such as 'PT4H', or seconds)")} value={d.within} onChange={(within) => set({ ...d, within })} fields={fields.filter((f) => f.type !== "table")} links={linkChips(fields)} hint={tr("Variables: doc, user, today, now. Empty gives the record no target. Example: doc.priority == 'High' ? 'PT1H' : 'PT4H'")} />
        )}
      </fieldset>

      <Field label={tr("Counted in")} htmlFor="tg-calendar" hint={!calendars.data?.length && !calendars.isLoading ? tr("No business calendar yet: time counts as plain elapsed time. Calendars are made under Administration, Calendars.") : d.calendar ? tr("Time counts only while the calendar is open: a day here is 24 open hours, not a working day.") : undefined}>
        <select id="tg-calendar" className="select" value={d.calendar} onChange={(e) => set({ ...d, calendar: e.target.value })}>
          <option value="">{tr("Plain time")}</option>
          {(calendars.data ?? []).map((c) => <option key={c.name} value={c.name}>{isolate(c.name)}</option>)}
          {d.calendar && !calendars.data?.some((c) => c.name === d.calendar) && <option value={d.calendar}>{isolate(d.calendar)}</option>}
        </select>
      </Field>

      <div className="stack">
        <WhenInput optional value={d.startWhen} fields={fields} words={STARTS()} onChange={(startWhen) => set({ ...d, startWhen })} />
        <p className="faint">{tr("Leave it empty to start the clock when the record is created.")}</p>
      </div>
      <div className="stack">
        <WhenInput optional value={d.pauseWhen} fields={fields} words={PAUSES()} onChange={(pauseWhen) => set({ ...d, pauseWhen })} />
        <p className="faint">{tr("Optional: while it holds the clock is stopped, and the time left is kept.")}</p>
      </div>
      <WhenInput value={d.metWhen} fields={fields} words={MET()} onChange={(metWhen) => set({ ...d, metWhen })} />

      <div className="row" style={wrap}>
        {keep("due")}
        {keep("state")}
      </div>
      {packaged && <p className="faint">{tr("{entity} comes with an app, so the two fields are ones this workspace adds (their names start with x_).", { entity: meta.label })}</p>}

      <Alert tone="info">
        <ul>
          <li>{tr("Records that exist already start at their next save; nothing goes back over them.")}</li>
          <li>{tr("A reminder before the due moment is an automation “relative to” the due field.")}</li>
          <li>{tr("A breach sets the state to breached. An automation “when updated” with the condition “state is breached and was not” reacts to it.")}</li>
        </ul>
      </Alert>
      <div>
        <Button onClick={onClose}>{tr("Cancel")}</Button>
      </div>
    </FormCard>
  );
}
