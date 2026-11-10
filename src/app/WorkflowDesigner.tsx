// Workflow Designer (administrators): an entity's states, the actions between them, who may make
// each and under what condition, saved as one `set_workflow` customization that replaces the
// workflow for this workspace. Plain tables and an outline, no canvas. The logic is lib/workflowDraft.ts.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, errorMessage } from "../lib/api";
import { useEntityMeta, useMe, type EntityMeta } from "../lib/meta";
import {
  checkDraft, creatorLinkChoices, fromMeta, move, newKey, removeState, reachable, startDraft, toWorkflow, workflowOp,
  type Draft, type DraftState, type DraftTransition, type Problem,
} from "../lib/workflowDraft";
import { Alert, Badge, Button, confirmDialog, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";
import { t as tr, isolate } from "@ferrum/client";
import { useApply } from "./author/apply";
import { ExprInput, linkChips } from "./author/ExprInput";
import { CheckGroup, RoleSelect } from "./author/RoleSelect";

export function WorkflowDesignerPage() {
  const { entity = "" } = useParams();
  const me = useMe();
  if (me.isLoading) return <PageLoading />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can change workflows. Ask one of them to make this change.")}</p>
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
  if (meta.data.kind !== "document" && meta.data.kind !== "master") {
    return (
      <EmptyState title={tr("This kind of record has no workflow")} icon="alert">
        <p className="muted">{tr("Only documents and master records can have a workflow.")}</p>
        <Link className="btn" to={`/customize/${encodeURIComponent(entity)}`}>{tr("Back to Customize")}</Link>
      </EmptyState>
    );
  }
  return <Designer meta={meta.data} />;
}

const sig = (d: Draft, entity: string) => JSON.stringify(toWorkflow(d, entity));

export function Designer({ meta }: { meta: EntityMeta }) {
  const E = meta.name;
  const apply = useApply(E);
  const customizations = useQuery({ queryKey: ["customize"], queryFn: ({ signal }) => api.get<{ customizations: { entity: string; is_active: boolean; op: Record<string, unknown> }[] }>("/api/customize", undefined, signal) });
  const serverDraft = useMemo(() => (meta.workflow ? fromMeta(meta, meta.workflow) : null), [meta]);
  const [draft, setDraft] = useState<Draft | null>(serverDraft);
  const [base, setBase] = useState(serverDraft ? sig(serverDraft, E) : "");
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const dirty = !!draft && sig(draft, E) !== base;
  const serverSig = serverDraft ? sig(serverDraft, E) : "";

  // Nothing pending: follow the server's workflow (after a save, or a change made elsewhere).
  useEffect(() => {
    if (dirty || serverSig === base) return;
    setDraft(serverDraft);
    setBase(serverSig);
  }, [dirty, serverSig, base, serverDraft]);

  if (!draft) {
    return (
      <Shell meta={meta}>
        <EmptyState title={tr("{entity} has no workflow yet", { entity: isolate(meta.label) })} icon="timeline">
          <p className="muted">{tr("A workflow decides the steps a record goes through, who may take each step, and what can be edited along the way.")}</p>
          <Button variant="primary" onClick={() => setDraft(startDraft(meta))}>{tr("Start a workflow")}</Button>
        </EmptyState>
      </Shell>
    );
  }

  const set = (d: Draft) => {
    setDraft(d);
    setProblems([]);
  };
  const ownWorkflow = (customizations.data?.customizations ?? []).some((c) => c.entity === E && c.is_active && c.op.op === "set_workflow");
  const replacesPackaged = !!meta.workflow && !ownWorkflow;

  const save = async () => {
    const found = checkDraft(draft, meta.submittable);
    setProblems(found);
    setServerError(null);
    if (found.length) return;
    if (replacesPackaged) {
      const ok = await confirmDialog({
        title: tr("Replace the workflow of {entity}?", { entity: isolate(meta.label) }),
        message: tr("This replaces the workflow that comes with the app, for this workspace only. You can switch yours off again under Customizations on the Customize page, and the app's comes back."),
        confirmLabel: tr("Replace it"),
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await apply(workflowOp(draft, E), tr("Workflow {name}", { name: draft.name }));
      setBase(sig(draft, E));
      toast(tr("Workflow saved"));
    } catch (e) {
      setServerError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell
      meta={meta}
      actions={
        <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
          {tr("Save workflow")}
        </Button>
      }
    >
      {replacesPackaged && <Alert tone="info">{tr("This entity comes with a workflow. Saving replaces it for this workspace; you can switch your version off again under Customizations on the Customize page.")}</Alert>}
      {dirty && <p className="faint" role="status">{tr("You have changes that are not saved.")}</p>}
      {(problems.length > 0 || serverError) && (
        <Alert tone="error">
          {problems.length > 0 && (
            <>
              <strong>{tr("Fix these first")}</strong>
              <ul>
                {problems.map((p, i) => (
                  <li key={i}>{isolate(p.message)}</li>
                ))}
              </ul>
            </>
          )}
          {serverError && (
            <>
              <strong>{tr("The server did not accept the workflow")}</strong>
              <p>{isolate(serverError)}</p>
            </>
          )}
        </Alert>
      )}
      <section className="card" aria-labelledby="wf-name-h">
        <div className="card-head">
          <h2 id="wf-name-h">{tr("Workflow")}</h2>
        </div>
        <div className="card-body">
          <Field label={tr("Name")} htmlFor="wf-name">
            <input id="wf-name" className="input" value={draft.name} onChange={(e) => set({ ...draft, name: e.target.value })} />
          </Field>
        </div>
      </section>
      <StatesTable meta={meta} draft={draft} problems={problems} onChange={set} />
      <TransitionsTable meta={meta} draft={draft} problems={problems} serverError={serverError} onChange={set} />
      <Outline draft={draft} />
    </Shell>
  );
}

function Shell({ meta, actions, children }: { meta: EntityMeta; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/customize">{tr("Customize")}</Link> / <Link to={`/customize/${encodeURIComponent(meta.name)}`}>{isolate(meta.label)}</Link>
          </p>
          <h1 className="page-title">{tr("Workflow of {entity}", { entity: isolate(meta.label) })}</h1>
        </div>
        <div className="page-actions">{actions}</div>
      </div>
      {children}
    </div>
  );
}

/** Up, down and remove for one row of a table. */
function RowTools({ index, count, what, onMove, onRemove }: { index: number; count: number; what: string; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <Button size="sm" icon="up" disabled={index === 0} aria-label={tr("Move {name} up", { name: what })} onClick={() => onMove(-1)} />
      <Button size="sm" icon="down" disabled={index === count - 1} aria-label={tr("Move {name} down", { name: what })} onClick={() => onMove(1)} />
      <Button size="sm" icon="trash" aria-label={tr("Remove {name}", { name: what })} onClick={onRemove} />
    </div>
  );
}

const docstatusName = (n: number) => (n === 1 ? tr("Submitted") : n === 2 ? tr("Cancelled") : tr("Draft"));

function StatesTable({ meta, draft, problems, onChange }: { meta: EntityMeta; draft: Draft; problems: Problem[]; onChange: (d: Draft) => void }) {
  const fields = meta.fields.filter((f) => f.type !== "table").map((f) => ({ value: f.name, label: f.label || f.name }));
  const edit = (key: string, patch: Partial<DraftState>) => onChange({ ...draft, states: draft.states.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const shown = (s: DraftState) => s.name.trim() || tr("(no name)");
  return (
    <section className="card" aria-labelledby="wf-states-h">
      <div className="card-head">
        <h2 id="wf-states-h">{tr("States")}</h2>
        <span className="spacer" />
        <Button size="sm" icon="plus" onClick={() => onChange({ ...draft, states: [...draft.states, { key: newKey("s"), name: "", docstatus: 0, edit_roles: [], editable: [], required: [] }] })}>
          {tr("Add a state")}
        </Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">{tr("The states a record goes through")}</caption>
          <thead>
            <tr>
              <th scope="col">{tr("Name")}</th>
              {meta.submittable && <th scope="col">{tr("Record is")}</th>}
              <th scope="col">{tr("Starts here")}</th>
              <th scope="col">{tr("Order")}</th>
            </tr>
          </thead>
          {draft.states.map((s, i) => {
            const bad = problems.some((p) => p.state === s.key);
            return (
              <tbody key={s.key}>
                <tr>
                  <td>
                    <input className="input" aria-label={tr("Name of state {n}", { n: i + 1 })} aria-invalid={bad || undefined} value={s.name} onChange={(e) => edit(s.key, { name: e.target.value })} />
                  </td>
                  {meta.submittable && (
                    <td>
                      <select className="select" aria-label={tr("Record is, in {name}", { name: shown(s) })} value={s.docstatus} onChange={(e) => edit(s.key, { docstatus: Number(e.target.value) })}>
                        {[0, 1, 2].map((n) => (
                          <option key={n} value={n}>{docstatusName(n)}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td>
                    <input type="radio" name="wf-initial" aria-label={tr("{name} is where new records start", { name: shown(s) })} checked={draft.initial === s.key} onChange={() => onChange({ ...draft, initial: s.key })} />
                  </td>
                  <td>
                    <RowTools index={i} count={draft.states.length} what={shown(s)} onMove={(by) => onChange({ ...draft, states: move(draft.states, i, by) })} onRemove={() => onChange(removeState(draft, s.key))} />
                  </td>
                </tr>
                <tr>
                  <td colSpan={meta.submittable ? 4 : 3}>
                    <details>
                      <summary>{tr("Who may edit, and which fields, in {name}", { name: isolate(shown(s)) })}</summary>
                      <div className="stack">
                        <RoleSelect legend={tr("Roles that may edit in this state")} value={s.edit_roles} onChange={(v) => edit(s.key, { edit_roles: v })} />
                        <CheckGroup legend={tr("Fields that can be changed (none chosen: whatever the form allows)")} options={fields} value={s.editable} onChange={(v) => edit(s.key, { editable: v })} />
                        <CheckGroup legend={tr("Fields that must be filled in")} options={fields} value={s.required} onChange={(v) => edit(s.key, { required: v })} />
                      </div>
                    </details>
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>
    </section>
  );
}

function TransitionsTable({ meta, draft, problems, serverError, onChange }: { meta: EntityMeta; draft: Draft; problems: Problem[]; serverError: string | null; onChange: (d: Draft) => void }) {
  const links = creatorLinkChoices(meta);
  const fieldChips = meta.fields.filter((f) => f.type !== "table").map((f) => ({ name: f.name, label: f.label }));
  const edit = (key: string, patch: Partial<DraftTransition>) => onChange({ ...draft, transitions: draft.transitions.map((t) => (t.key === key ? { ...t, ...patch } : t)) });
  const add = () => {
    const [a, b] = [draft.states[0]?.key ?? "", draft.states[1]?.key ?? draft.states[0]?.key ?? ""];
    onChange({ ...draft, transitions: [...draft.transitions, { key: newKey("t"), action: "", from: a, to: b, roles: [], condition: "", not_creator: false, not_creator_of: [] }] });
  };
  const stateOptions = (current: string) => (
    <>
      {draft.states.map((s) => (
        <option key={s.key} value={s.key}>{isolate(s.name.trim() || tr("(no name)"))}</option>
      ))}
      {!draft.states.some((s) => s.key === current) && <option value={current}>{tr("(a state that is gone)")}</option>}
    </>
  );
  return (
    <section className="card" aria-labelledby="wf-trans-h">
      <div className="card-head">
        <h2 id="wf-trans-h">{tr("Actions")}</h2>
        <span className="spacer" />
        <Button size="sm" icon="plus" disabled={!draft.states.length} onClick={add}>{tr("Add an action")}</Button>
      </div>
      {!draft.transitions.length ? (
        <p className="muted card-body">{tr("No actions yet: a record could never leave its first state.")}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{tr("The actions that move a record from one state to another")}</caption>
            <thead>
              <tr>
                <th scope="col">{tr("Action")}</th>
                <th scope="col">{tr("From")}</th>
                <th scope="col">{tr("To")}</th>
                <th scope="col">{tr("Order")}</th>
              </tr>
            </thead>
            {draft.transitions.map((t, i) => {
              const what = t.action.trim() || tr("(no name)");
              const bad = problems.some((p) => p.transition === t.key);
              // The server names the action whose condition it could not read.
              const conditionError = serverError && t.action.trim() && serverError.includes(`transition ${t.action.trim()}`) ? serverError : null;
              return (
                <tbody key={t.key}>
                  <tr>
                    <td>
                      <input className="input" aria-label={tr("Name of action {n}", { n: i + 1 })} aria-invalid={bad || undefined} value={t.action} onChange={(e) => edit(t.key, { action: e.target.value })} />
                    </td>
                    <td>
                      <select className="select" aria-label={tr("{name} starts from", { name: isolate(what) })} value={t.from} onChange={(e) => edit(t.key, { from: e.target.value })}>{stateOptions(t.from)}</select>
                    </td>
                    <td>
                      <select className="select" aria-label={tr("{name} leads to", { name: isolate(what) })} value={t.to} onChange={(e) => edit(t.key, { to: e.target.value })}>{stateOptions(t.to)}</select>
                    </td>
                    <td>
                      <RowTools index={i} count={draft.transitions.length} what={what} onMove={(by) => onChange({ ...draft, transitions: move(draft.transitions, i, by) })} onRemove={() => onChange({ ...draft, transitions: draft.transitions.filter((x) => x.key !== t.key) })} />
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4}>
                      <details open={!!conditionError || undefined}>
                        <summary>{tr("Who may do {name}, and when", { name: isolate(what) })}</summary>
                        <div className="stack">
                          <RoleSelect legend={tr("Roles that may do this")} value={t.roles} onChange={(v) => edit(t.key, { roles: v })} />
                          <ExprInput label={tr("Only when (a condition, optional)")} value={t.condition} onChange={(v) => edit(t.key, { condition: v })} fields={fieldChips} links={linkChips(meta.fields)} error={conditionError} hint={tr("For example doc.total < 1000. The server checks it when you save.")} />
                          <label className="check-field">
                            <input type="checkbox" checked={t.not_creator} onChange={(e) => edit(t.key, { not_creator: e.target.checked })} />
                            {tr("Not by whoever created the record")}
                          </label>
                          <CheckGroup legend={tr("Not by whoever is named in…")} options={links} value={t.not_creator_of} onChange={(v) => edit(t.key, { not_creator_of: v })} empty={tr("This entity has no link fields.")} />
                        </div>
                      </details>
                    </td>
                  </tr>
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </section>
  );
}

/** Each state with the ways out of it, as plain text (no canvas). */
export function Outline({ draft }: { draft: Draft }) {
  const reach = reachable(draft);
  const name = (key: string) => draft.states.find((s) => s.key === key)?.name.trim() || tr("(no name)");
  return (
    <section className="card" aria-labelledby="wf-outline-h">
      <div className="card-head">
        <h2 id="wf-outline-h">{tr("Outline")}</h2>
      </div>
      <div className="card-body">
        <ul className="stack">
          {draft.states.map((s) => {
            const out = draft.transitions.filter((t) => t.from === s.key);
            return (
              <li key={s.key}>
                <strong>{isolate(name(s.key))}</strong>{" "}
                {draft.initial === s.key && <Badge tone="green">{tr("Starts here")}</Badge>}{" "}
                {!reach.has(s.key) && <Badge tone="amber">{tr("Never reached")}</Badge>}
                {!out.length ? (
                  <p className="faint">{tr("No way out: the record stays here.")}</p>
                ) : (
                  <ul>
                    {out.map((t) => (
                      <li key={t.key}>
                        {tr("{action} → {to}", { action: isolate(t.action.trim() || tr("(no name)")), to: isolate(name(t.to)) })}
                        {t.roles.length > 0 && <span className="muted"> {tr("by {roles}", { roles: isolate(t.roles.join(", ")) })}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
