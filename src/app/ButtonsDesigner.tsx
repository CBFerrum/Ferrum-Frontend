// Buttons (administrators): the buttons an entity's record form shows, set up by configuration. Coded ones (an app's own)
// are listed and left alone; configured ones are made, changed and removed here, each saved as one `add_action` /
// `remove_action` customization after a dry run. What a button does is the automation editor's action cards. The logic
// is lib/buttonDraft.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useParams } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { ApiError, errorMessage } from "../lib/api";
import { move, type DraftAction } from "../lib/automationDraft";
import {
  checkButton, fromButton, isConfigured, MAX_EFFECTS, MAX_REFUSALS, newRefusal, pointAt, removeBatch, saveBatch, setLabel, startButton, toButton,
  type ButtonDraft, type ButtonProblem, type DraftRefusal, type Pointed, type Raw,
} from "../lib/buttonDraft";
import { useEntityMeta, useMe, useMetaIndex, type ActionDef, type EntityMeta, type Field as MetaField } from "../lib/meta";
import { Alert, Badge, Button, confirmDialog, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";
import { ActionCard, AddActions } from "./AutomationEditor";
import { BatchRefused, useApplyBatch } from "./author/apply";
import { WhenInput, type CheckWords } from "./author/CheckBuilder";
import { FormCard } from "./author/FormCard";
import { grow, Tools, wrap } from "./author/controls";
import { Questions } from "./author/Questions";
import { RoleSelect } from "./author/RoleSelect";
import { useCapabilities } from "./author/InvokeCard";

export function ButtonsDesignerPage() {
  const { entity = "" } = useParams();
  const me = useMe();
  if (me.isLoading) return <PageLoading />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can set up buttons. Ask one of them to make this change.")}</p>
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
  return <Buttons meta={meta.data} />;
}

const CONDITION_WORDS = (): CheckWords => ({ one: tr("The button shows when this holds"), many: tr("The button shows when"), advancedLabel: tr("Shown when (must be true)"), hint: tr("Variables: doc, user, today, now") });
const REFUSAL_WORDS = (): CheckWords => ({ one: tr("Refuse when this holds"), many: tr("Refuse when"), advancedLabel: tr("Refuse when (must be true)"), hint: tr("Variables: doc, user, params, today, now") });

function Buttons({ meta }: { meta: EntityMeta }) {
  const apply = useApplyBatch();
  const [editing, setEditing] = useState<ButtonDraft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const packaged = !meta.custom;
  const taken = meta.actions.map((a) => a.name);
  const label = isolate(meta.label);

  const remove = async (a: ActionDef) => {
    if (!(await confirmDialog({ title: tr("Remove the button?"), message: tr("“{label}” goes from the form of {entity}. Switch the change off under Customizations to bring it back.", { label: a.label, entity: meta.label }), confirmLabel: tr("Remove"), danger: true }))) return;
    setRemoving(a.name);
    try {
      const ops = removeBatch(meta.name, a.name, tr("Buttons"));
      await apply(ops, true);
      await apply(ops, false);
      toast(tr("Button removed"));
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
          <h1 className="page-title">{tr("Buttons of {entity}", { entity: label })}</h1>
        </div>
        {!editing && (
          <div className="page-actions">
            <Button variant="primary" icon="plus" onClick={() => setEditing(startButton())}>{tr("New button")}</Button>
          </div>
        )}
      </div>
      {editing ? (
        <ButtonForm key={editing.saved ? editing.name : "new"} meta={meta} start={editing} taken={taken} packaged={packaged} onClose={() => setEditing(null)} />
      ) : (
        <section className="card" aria-labelledby="bt-list">
          <div className="card-head">
            <h2 id="bt-list">{tr("Buttons on the record form")}</h2>
          </div>
          {!meta.actions.length ? (
            <EmptyState title={tr("No buttons yet")} icon="edit">
              <p className="muted">{tr("A button does something to the record it is pressed on: fills in fields, changes a linked record, creates one, tells someone.")}</p>
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Button")}</th>
                    <th scope="col">{tr("Name")}</th>
                    <th scope="col">{tr("Set up")}</th>
                    <th scope="col"><span className="sr-only">{tr("Change")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {meta.actions.map((a) => {
                    const mine = isConfigured(a);
                    return (
                      <tr key={a.name}>
                        <td>{isolate(a.label)}</td>
                        <td className="mono">{isolate(a.name)}</td>
                        <td>{mine ? <Badge tone="blue">{tr("Set up by configuration")}</Badge> : <Badge>{tr("Comes with the app")}</Badge>}{a.hidden && <span className="faint"> {tr("Called by code only, never a button")}</span>}</td>
                        <td className="nowrap">
                          {mine && (
                            <div className="row-actions">
                              <Button size="sm" onClick={() => setEditing(fromButton(a as unknown as Raw))} aria-label={tr("Edit {name}", { name: a.label })}>{tr("Edit")}</Button>
                              <Button size="sm" icon="trash" loading={removing === a.name} disabled={!!removing} onClick={() => void remove(a)} aria-label={tr("Remove {name}", { name: a.label })} />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Refusals({ rows, fields, onChange, error, flagged }: { rows: DraftRefusal[]; fields: MetaField[]; onChange: (r: DraftRefusal[]) => void; error?: string; flagged: Set<string | undefined> }) {
  const edit = (key: string, patch: Partial<DraftRefusal>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <section className="card" aria-labelledby="bt-refusals-h">
      <div className="card-head">
        <h3 className="card-title" id="bt-refusals-h">{tr("When it is refused")}</h3>
      </div>
      <div className="card-body stack">
        <p className="faint">{tr("Checked in order when the button is pressed. The first that holds refuses, and its message is what people see; the button also shows as unavailable on a record where one holds.")}</p>
        {error && <p className="field-error" role="alert">{isolate(error)}</p>}
        {rows.map((r, i) => (
          <fieldset key={r.key} className="stack" id={`bt-refusal-${r.key}`} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: 0, minWidth: 0, ...(flagged.has(r.key) ? { borderColor: "var(--danger)" } : {}) }}>
            <legend className="field-label">{tr("Refusal {n}", { n: i + 1 })}</legend>
            <WhenInput value={r.when} fields={fields} words={REFUSAL_WORDS()} onChange={(when) => edit(r.key, { when })} />
            <Field label={tr("Message people see")} htmlFor={`bt-msg-${r.key}`}>
              <input id={`bt-msg-${r.key}`} className="input" value={r.message} onChange={(e) => edit(r.key, { message: e.target.value })} />
            </Field>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Tools index={i} count={rows.length} what={tr("refusal {n}", { n: i + 1 })} onMove={(by) => onChange(move(rows, i, by))} onRemove={() => onChange(rows.filter((x) => x.key !== r.key))} />
            </div>
          </fieldset>
        ))}
        <div>
          <Button size="sm" icon="plus" disabled={rows.length >= MAX_REFUSALS} onClick={() => onChange([...rows, newRefusal()])}>{tr("Add a refusal")}</Button>
        </div>
      </div>
    </section>
  );
}

function ButtonForm({ meta, start, taken, packaged, onClose }: { meta: EntityMeta; start: ButtonDraft; taken: string[]; packaged: boolean; onClose: () => void }) {
  const index = useMetaIndex();
  const apply = useApplyBatch();
  const [d, setD] = useState(start);
  const [base] = useState(() => JSON.stringify(toButton(start)));
  const [problems, setProblems] = useState<ButtonProblem[]>([]);
  const [refusal, setRefusal] = useState<{ message: string; at: Pointed } | null>(null);
  const caps = useCapabilities(d.effects.some((a) => a.kind === "invoke"));
  const [busy, setBusy] = useState(false);
  const closing = useRef(false);
  const dirty = JSON.stringify(toButton(d)) !== base;
  const fields = meta.fields;
  const chips = fields.filter((f) => f.type !== "table");
  const entities = useMemo(() => [...(index.data?.entities ?? [])].sort((a, b) => a.label.localeCompare(b.label)).map((e) => ({ value: e.name, label: e.label })), [index.data]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => !closing.current && dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: tr("Leave without saving?"), message: tr("Your changes to this button will be lost."), confirmLabel: tr("Leave"), danger: true }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (next: ButtonDraft) => {
    setD(next);
    setProblems([]);
    setRefusal(null);
  };
  const patchEffect = (key: string, patch: Partial<DraftAction>) => set({ ...d, effects: d.effects.map((a) => (a.key === key ? ({ ...a, ...patch } as DraftAction) : a)) });

  const save = async () => {
    const found = checkButton(d, taken, packaged, caps.data?.capabilities);
    setProblems(found);
    setRefusal(null);
    if (found.length) return;
    setBusy(true);
    try {
      const ops = saveBatch(meta.name, d, tr("Buttons"));
      await apply(ops, true);
      await apply(ops, false);
      toast(d.saved ? tr("Button saved") : tr("Button created"));
      closing.current = true;
      onClose();
    } catch (e) {
      if (e instanceof BatchRefused && e.unchanged) {
        toast(tr("Nothing changed"));
        closing.current = true;
        return onClose();
      }
      const message = e instanceof BatchRefused ? e.message : errorMessage(e);
      const at = pointAt(message, d);
      setRefusal({ message, at });
      const id = at.effect ? `au-action-${at.effect}` : at.refusal ? `bt-refusal-${at.refusal}` : null;
      if (id) {
        requestAnimationFrame(() => {
          const el = document.getElementById(id);
          el?.scrollIntoView?.({ block: "center" });
          el?.focus();
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const flagged = new Set(problems.map((p) => p.action ?? p.row));
  const placedAt = refusal && (refusal.at.effect || refusal.at.refusal || refusal.at.param || refusal.at.condition);
  const taken2 = taken.filter((n) => n !== start.name);
  return (
    <FormCard title={start.saved ? tr("Change the button {name}", { name: start.label }) : tr("New button")} onSubmit={save} busy={busy} submitLabel={tr("Save button")} error={refusal && !placedAt ? refusal.message : null}>
      {problems.length > 0 && (
        <Alert tone="error">
          <strong>{tr("Fix these first")}</strong>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{isolate(p.message)}</li>
            ))}
          </ul>
        </Alert>
      )}
      {refusal && placedAt && <p className="field-error" role="alert">{isolate(refusal.message)}</p>}
      <div className="row" style={wrap}>
        <div style={{ ...grow, flexBasis: 220 }}>
          <Field label={tr("Label")} htmlFor="bt-label" required>
            <input id="bt-label" className="input" value={d.label} onChange={(e) => set(setLabel(d, e.target.value, taken2, packaged))} />
          </Field>
        </div>
        <div style={{ ...grow, flexBasis: 200 }}>
          <Field label={tr("Name")} htmlFor="bt-name" hint={d.saved ? tr("Fixed once the button is saved.") : packaged ? tr("Made from the label, starting x_ because the entity comes with an app. You can change it until the button is saved.") : tr("Made from the label. You can change it until the button is saved.")}>
            <input id="bt-name" className="input mono" value={d.name} readOnly={d.saved} spellCheck={false} autoCapitalize="none" onChange={(e) => set({ ...d, name: e.target.value, nameTouched: true })} />
          </Field>
        </div>
      </div>
      <RoleSelect legend={tr("Who may press it (none ticked: whoever may edit the record; administrators always may)")} value={d.roles} onChange={(roles) => set({ ...d, roles })} />
      <div className="stack">
        <WhenInput optional value={d.condition} fields={fields} words={CONDITION_WORDS()} onChange={(condition) => set({ ...d, condition })} />
        {refusal?.at.condition && <p className="field-error">{tr("The server refused the condition; see the message above.")}</p>}
        <p className="faint">{tr("Leave it empty to show the button on every record.")}</p>
      </div>
      <Field label={tr("Ask first (optional)")} htmlFor="bt-confirm" hint={tr("A question people confirm before the button runs, like “Accept taking this risk on?”")}>
        <input id="bt-confirm" className="input" value={d.confirm} onChange={(e) => set({ ...d, confirm: e.target.value })} />
      </Field>
      <Refusals rows={d.refusals} fields={fields} flagged={flagged} onChange={(refusals) => set({ ...d, refusals })} error={refusal?.at.refusal ? refusal.message : undefined} />
      <Questions d={d} onChange={set} entities={entities} flagged={flagged} />
      <section className="stack" aria-labelledby="bt-does-h">
        <h3 id="bt-does-h">{tr("What it does")}</h3>
        <p className="faint">{tr("In order, in one go: if any step is refused, nothing is changed.")}</p>
        {!d.effects.length && <p className="faint">{tr("Nothing yet: add what the button should do.")}</p>}
        {d.effects.map((a, i) => (
          <ActionCard
            key={a.key}
            a={a}
            index={i}
            count={d.effects.length}
            entities={entities}
            chips={chips}
            fields={fields}
            flagged={flagged.has(a.key)}
            error={refusal?.at.effect === a.key ? refusal.message : undefined}
            entity={meta.name}
            owner={d.name}
            inButton
            lines={meta.children}
            earlier={d.effects.slice(0, i)}
            onChange={(p) => patchEffect(a.key, p)}
            onMove={(by) => set({ ...d, effects: move(d.effects, i, by) })}
            onRemove={() => set({ ...d, effects: d.effects.filter((x) => x.key !== a.key) })}
          />
        ))}
        <AddActions hasTable={fields.some((f) => f.type === "table")} count={d.effects.length} max={MAX_EFFECTS} onAdd={(a) => set({ ...d, effects: [...d.effects, a] })} />
      </section>
      <div>
        <Button onClick={async () => { if (!dirty || (await confirmDialog({ title: tr("Leave without saving?"), message: tr("Your changes to this button will be lost."), confirmLabel: tr("Leave"), danger: true }))) onClose(); }}>{tr("Cancel")}</Button>
      </div>
      <p className="faint">
        {tr("Press the button on a record to try it. Who sees it follows the roles above; permission rules are under")} <Link to="/admin?tab=roles">{tr("Administration → Roles")}</Link>.
      </p>
    </FormCard>
  );
}
