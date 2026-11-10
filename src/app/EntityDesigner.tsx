// Entity Designer (administrators): a workspace's own entities, made and changed without JSON: the basics, the
// fields, unique combinations, lines and totals, saved as one batch of `define_entity` / `redefine_entity`
// customizations (POST /api/customize/batch) that applies all or none. The logic is lib/entityDraft.ts.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode, useRef } from "react";
import { Link, useBlocker, useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError, errorMessage } from "../lib/api";
import {
  addField, buildBatch, checkDraft, FIELD_TYPES, fromDef, hasMaxLength, isDecimal, isNumeric, KEPT_TYPES, markSaved, moveField, nextNumber, numberingTemplate, patchField,
  removeField, savedDefs, setEntityLabel, setFieldLabel, signature, startDraft, startField, startLines, startTotal,
  type Draft, type DraftEntity, type DraftField, type Problem, type Raw,
} from "../lib/entityDraft";
import { formDesignerLink } from "../lib/formLayout";
import { useMe, useMetaIndex, type EntitySummary } from "../lib/meta";
import { workflowDesignerLink } from "../lib/workflowDraft";
import { Alert, Button, confirmDialog, EmptyState, ErrorState, Field, PageLoading } from "../ui/kit";
import { t as tr, isolate } from "@ferrum/client";
import { BatchRefused, useApplyBatch } from "./author/apply";
import { ExprInput } from "./author/ExprInput";
import { CheckGroup } from "./author/RoleSelect";

interface Customization {
  seq: number;
  entity: string;
  op: Raw;
  is_active: boolean;
}

/** The newest active definition of entity `name`: `define_entity`, or a `redefine_entity` after it. */
function definitionOf(list: Customization[], name: string): Raw | null {
  const defs = list.filter((c) => c.is_active && (c.op.op === "define_entity" || c.op.op === "redefine_entity") && (c.op.entity as Raw | undefined)?.name === name);
  return (defs.sort((a, b) => b.seq - a.seq)[0]?.op.entity as Raw | undefined) ?? null;
}

export function EntityDesignerPage() {
  const { entity } = useParams();
  const me = useMe();
  if (me.isLoading) return <PageLoading />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can design entities. Ask one of them to make this change.")}</p>
      </EmptyState>
    );
  }
  return <Loader key={entity ?? ""} entity={entity} />;
}

function NotFound({ title, children }: { title: string; children: ReactNode }) {
  return (
    <EmptyState title={title} icon="alert">
      <p className="muted">{children}</p>
      <Link className="btn" to="/customize">{tr("Back to Customize")}</Link>
    </EmptyState>
  );
}

function Loader({ entity }: { entity?: string }) {
  const index = useMetaIndex();
  const customizations = useQuery({ queryKey: ["customize"], queryFn: ({ signal }) => api.get<{ customizations: Customization[] }>("/api/customize", undefined, signal) });
  const list = customizations.data?.customizations;
  // The definition as it is now, after every active change (a rule, button or field another screen added since the
  // last redefinition is in it). An older server has no such route: 404 or 405, and the newest definition row is used.
  const custom = !!entity && !!index.data?.entities.find((e) => e.name === entity)?.custom;
  const current = useQuery({
    queryKey: ["customize-definition", entity ?? ""],
    enabled: custom,
    retry: false,
    refetchOnMount: "always",
    queryFn: ({ signal }) => api.get<{ entity: Raw; lines?: Record<string, Raw> }>(`/api/customize/definition/${encodeURIComponent(entity ?? "")}`, undefined, signal),
  });
  const missing = current.error instanceof ApiError && (current.error.status === 404 || current.error.status === 405);
  // Only the first answer starts the draft: a cached one from before a save is stale, and later ones must not replace what is being edited.
  const settled = useRef(false);
  if (index.data && (!custom || !current.isFetching)) settled.current = true;
  const loaded = useMemo(() => {
    if (!index.data || !list) return null;
    const taken = [...new Set([...index.data.entities.map((e) => e.name), ...list.map((c) => ((c.op.entity as Raw | undefined)?.name as string | undefined) ?? "")].filter(Boolean))];
    if (!entity) return { status: "ok" as const, start: startDraft(taken) };
    const summary = index.data.entities.find((e) => e.name === entity);
    if (!summary) return { status: "missing" as const };
    const now = summary.custom && current.data?.entity ? current.data : null;
    const def = summary.custom ? (now?.entity ?? definitionOf(list, entity)) : null;
    if (!def) return { status: "unreadable" as const, custom: !!summary.custom, label: summary.label };
    const children: Record<string, Raw> = {};
    for (const f of (def.fields as Raw[] | undefined) ?? []) {
      const of = f.type === "table" ? String(f.of ?? "") : "";
      const child = of ? (now?.lines?.[of] ?? definitionOf(list, of)) : null;
      if (child) children[of] = child;
    }
    return { status: "ok" as const, start: fromDef(def, children, taken) };
  }, [index.data, list, entity, current.data]);

  const error = index.error ?? customizations.error ?? (missing ? null : current.error);
  if (error) return <ErrorState error={error} onRetry={() => void Promise.all([index.refetch(), customizations.refetch(), current.refetch()])} title={tr("Could not load the entity")} />;
  if (!loaded || !settled.current) return <PageLoading />;
  if (loaded.status === "missing") return <NotFound title={tr("There is no such entity")}>{tr("Nothing called {entity} is installed in this workspace.", { entity: isolate(entity ?? "") })}</NotFound>;
  if (loaded.status === "unreadable") {
    return loaded.custom ? (
      <NotFound title={tr("This entity's definition cannot be read")}>{tr("{entity} is switched off, or was defined in a way the designer cannot read. Look under Customizations on the Customize page.", { entity: isolate(loaded.label ?? entity ?? "") })}</NotFound>
    ) : (
      <NotFound title={tr("This entity comes with an app")}>{tr("{entity} is part of an app, so its definition is not changed here: add fields to it, and change their properties, with Customize's field tools.", { entity: isolate(loaded.label ?? entity ?? "") })}</NotFound>
    );
  }
  return <Designer start={loaded.start} />;
}

// ── the designer ──

export function Designer({ start }: { start: Draft }) {
  const index = useMetaIndex();
  const apply = useApplyBatch();
  const [draft, setDraft] = useState(start);
  const [saved, setSaved] = useState(() => (start.entity.saved ? savedDefs(start) : {}));
  const [base, setBase] = useState(() => signature(start));
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [refusal, setRefusal] = useState<{ message: string; index: number | null } | null>(null);
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // Just created: the address is now the entity's own, and the page it opens on says so once.
  const arrived = (location.state as { created?: boolean } | null)?.created === true && start.entity.saved;
  const [done, setDone] = useState<{ name: string; label: string; created: boolean } | null>(() => (arrived ? { name: start.entity.name, label: start.entity.label.trim(), created: true } : null));
  const isNew = !draft.entity.saved;
  const dirty = signature(draft) !== base;
  const batch = buildBatch(draft, saved, tr("Entity designer"));
  const entity = draft.entity;

  const set = (next: Draft) => {
    setDraft(next);
    setProblems([]);
    setRefusal(null);
    setChecked(false);
    setDone(null);
  };
  const setEntity = (e: DraftEntity) => set({ ...draft, entity: e });

  // A new entity, once saved, lives at its own address: reloading /customize/new would show an empty form.
  const cameNew = !start.entity.saved;
  // Read when a navigation is judged, so the move after a save is never taken for leaving unsaved work
  // (the blocker may still hold the render before the save).
  const leaving = useRef(false);
  useEffect(() => {
    if (!(cameNew && done?.created && !dirty)) return;
    leaving.current = true;
    void navigate(`/customize/${done.name}/design`, { replace: true, state: { created: true } });
  }, [cameNew, done, dirty, navigate]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => !leaving.current && dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: tr("Leave without saving?"), message: tr("Your changes to this entity will be lost."), confirmLabel: tr("Leave"), danger: true }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const run = async (dryRun: boolean) => {
    const found = checkDraft(draft);
    setProblems(found);
    setRefusal(null);
    setChecked(false);
    setDone(null);
    if (found.length) return;
    setBusy(dryRun ? "check" : "save");
    try {
      await apply(batch.ops, dryRun);
      if (dryRun) setChecked(true);
      else {
        const after = markSaved(draft);
        setDraft(after);
        setSaved(savedDefs(after));
        setBase(signature(after));
        setDone({ name: after.entity.name, label: after.entity.label.trim(), created: isNew });
      }
    } catch (e) {
      setRefusal(e instanceof BatchRefused ? { message: e.message, index: e.index } : { message: errorMessage(e), index: null });
    } finally {
      setBusy(null);
    }
  };

  const targets = [...(index.data?.entities ?? [])].filter((e) => e.kind !== "child").sort((a, b) => a.label.localeCompare(b.label));
  const mine = (scope: string) => problems.filter((p) => p.scope === scope);
  const tables = entity.fields.filter((f) => f.type === "table");
  const plain = (f: DraftField) => f.type !== "table" && !f.rollup;
  const inList = refusal && refusal.index !== null && refusal.index >= 0 && refusal.index < batch.ops.length;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="crumbs"><Link to="/customize">{tr("Customize")}</Link></p>
          <h1 className="page-title">{isNew ? tr("New entity") : tr("Design {entity}", { entity: isolate(entity.label.trim() || entity.name) })}</h1>
        </div>
      </div>
      {dirty && <p className="faint" role="status">{tr("You have changes that are not saved.")}</p>}

      <Basics draft={draft} onChange={set} onEntity={setEntity} problems={mine("")} />

      <Card id="ed-fields" title={tr("Fields")} actions={<Button size="sm" icon="plus" onClick={() => setEntity(addField(entity, startField()))}>{tr("Add a field")}</Button>}>
        <FieldList entity={entity} scope="" shown={plain} onChange={setEntity} problems={problems} targets={targets} />
      </Card>

      <Card id="ed-unique" title={tr("Unique combinations")} actions={<Button size="sm" icon="plus" disabled={entity.fields.filter(plain).length < 2} onClick={() => setEntity({ ...entity, unique: [...entity.unique, []] })}>{tr("Add a combination")}</Button>}>
        <p className="muted">{tr("Groups of fields that must be unique together: no two records may have the same value in all of them. Empty values and cancelled documents are left out. To make one field unique on its own, tick “Each value only once” on it.")}</p>
        {!entity.unique.length ? (
          <p className="faint">{tr("No combinations yet.")}</p>
        ) : (
          <div className="stack">
            {entity.unique.map((g, i) => (
              <div key={i} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: "1 1 240px" }}>
                  <CheckGroup legend={tr("Combination {n}: unique together", { n: i + 1 })} options={entity.fields.filter(plain).map((f) => ({ value: f.key, label: f.label.trim() || f.name }))} value={g} onChange={(v) => setEntity({ ...entity, unique: entity.unique.map((x, j) => (j === i ? v : x)) })} />
                </div>
                <Button size="sm" icon="trash" aria-label={tr("Remove combination {n}", { n: i + 1 })} onClick={() => setEntity({ ...entity, unique: entity.unique.filter((_, j) => j !== i) })} />
              </div>
            ))}
          </div>
        )}
        {mine("").filter((p) => /combination/i.test(p.message)).map((p, i) => (
          <p key={i} className="field-error">{p.message}</p>
        ))}
      </Card>

      <LinesCard entity={entity} onChange={setEntity} problems={problems} targets={targets} tables={tables} />

      <Card id="ed-save" title={tr("What will be saved")}>
        {(problems.length > 0 || (refusal && !inList)) && (
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
            {refusal && !inList && (
              <>
                <strong>{tr("The server did not accept this")}</strong>
                <p>{isolate(refusal.message)}</p>
              </>
            )}
          </Alert>
        )}
        {!batch.plan.length ? (
          <p className="muted">{tr("Nothing has changed yet.")}</p>
        ) : (
          <ul className="stack" aria-label={tr("The entities this will create or change")}>
            {batch.plan.map((p, i) => (
              <li key={p.name}>
                <span>
                  {p.action === "create"
                    ? p.lines ? tr("Create the lines {name}", { name: isolate(p.label || p.name) }) : tr("Create the entity {name}", { name: isolate(p.label || p.name) })
                    : p.lines ? tr("Change the lines {name}", { name: isolate(p.label || p.name) }) : tr("Change the entity {name}", { name: isolate(p.label || p.name) })}
                </span>{" "}
                <span className="faint">({isolate(p.name)})</span>
                {refusal && refusal.index === i && (
                  <p className="field-error" role="alert">
                    {isolate(refusal.message)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {checked && <Alert tone="success">{tr("The server would accept this. Nothing was saved yet.")}</Alert>}
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Button loading={busy === "check"} disabled={!!busy || !batch.ops.length} onClick={() => void run(true)}>{tr("Check")}</Button>
          <Button variant="primary" loading={busy === "save"} disabled={!!busy || !batch.ops.length} onClick={() => void run(false)}>{isNew ? tr("Create") : tr("Save changes")}</Button>
        </div>
        {done && <Saved name={done.name} label={done.label} created={done.created} kind={entity.kind} />}
      </Card>
    </div>
  );
}

function Saved({ name, label, created, kind }: { name: string; label: string; created: boolean; kind: DraftEntity["kind"] }) {
  const e = encodeURIComponent(name);
  return (
    <Alert tone="success">
      <div className="stack" role="status">
        <strong>{created ? tr("{entity} is created.", { entity: isolate(label) }) : tr("The changes to {entity} are saved.", { entity: isolate(label) })}</strong>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Link className="btn" to={`/e/${e}`}>{tr("Open its records")}</Link>
          <Link className="btn" to={formDesignerLink(name)}>{tr("Design form")}</Link>
          {kind !== "master" && <Link className="btn" to={workflowDesignerLink(name)}>{tr("Design workflow")}</Link>}
        </div>
        <p>
          {tr("People see {entity} only once a role is given access to it:", { entity: isolate(label) })} <Link to="/admin?tab=roles">{tr("give one access under Administration → Roles")}</Link>.
        </p>
      </div>
    </Alert>
  );
}

function Card({ id, title, actions, children }: { id: string; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" aria-labelledby={`${id}-h`}>
      <div className="card-head">
        <h2 id={`${id}-h`}>{title}</h2>
        <span className="spacer" />
        {actions}
      </div>
      <div className="card-body stack">{children}</div>
    </section>
  );
}

// ── basics ──

function Basics({ draft, onChange, onEntity, problems }: { draft: Draft; onChange: (d: Draft) => void; onEntity: (e: DraftEntity) => void; problems: Problem[] }) {
  const e = draft.entity;
  const set = (patch: Partial<DraftEntity>) => onEntity({ ...e, ...patch });
  const bad = (re: RegExp) => problems.find((p) => re.test(p.message))?.message;
  const template = e.numbering ? numberingTemplate(e.numbering) : e.numberingRaw ? String(e.numberingRaw.template ?? "") : "";
  const kinds: { value: DraftEntity["kind"]; label: string }[] = [
    { value: "master", label: tr("A list of things") },
    { value: "document", label: tr("A document that is submitted, and can be cancelled") },
    ...(e.kind === "plain-document" ? [{ value: "plain-document" as const, label: tr("A document that is saved but never submitted") }] : []),
  ];
  return (
    <Card id="ed-basics" title={tr("Basics")}>
      <div className="form-grid">
        <Field label={tr("Label")} required error={bad(/label\./)} hint={tr("What one record is called, for example Membership.")}>
          <input className="input" value={e.label} onChange={(ev) => onChange(setEntityLabel(draft, ev.target.value))} />
        </Field>
        <Field label={tr("Label for several")} hint={tr("For example Memberships. Left empty, an s is added.")}>
          <input className="input" value={e.label_plural} onChange={(ev) => set({ label_plural: ev.target.value })} />
        </Field>
        <Field label={tr("Name")} error={bad(/name/)} hint={e.saved ? tr("The name cannot change once the entity exists.") : tr("Made from the label: X and then its words. You can change it until the entity is created.")}>
          <input className="input mono" value={e.name} readOnly={e.saved} spellCheck={false} autoCapitalize="none" onChange={(ev) => set({ name: ev.target.value, nameTouched: true })} />
        </Field>
        <Field label={tr("Title field")} hint={tr("The field that names a record where it is linked or listed.")}>
          <select className="select" value={e.title} onChange={(ev) => set({ title: ev.target.value })}>
            <option value="">{tr("(none)")}</option>
            {e.fields.filter((f) => f.type !== "table" && !f.rollup).map((f) => (
              <option key={f.key} value={f.key}>{isolate(f.label.trim() || f.name || tr("(no label)"))}</option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="field-label">{tr("What it is")}</legend>
        {kinds.map((k) => (
          <label key={k.value} className="check-field">
            <input type="radio" name="ed-kind" checked={e.kind === k.value} onChange={() => set({ kind: k.value })} />
            {k.label}
          </label>
        ))}
      </fieldset>
      <Field label={tr("Description")} hint={tr("What this kind of record is for.")}>
        <textarea className="textarea" rows={2} value={e.description} onChange={(ev) => set({ description: ev.target.value })} />
      </Field>
      <div className="stack">
        {e.numberingRaw ? (
          <p className="muted">{tr("This entity numbers its records with a pattern the designer keeps as it is: {template}", { template: isolate(template) })}</p>
        ) : (
          <label className="check-field">
            <input type="checkbox" checked={!!e.numbering} onChange={(ev) => set({ numbering: ev.target.checked ? { prefix: "", digits: 5 } : null })} />
            {tr("Number the records automatically")}
          </label>
        )}
        {e.numbering && (
          <div className="form-grid">
            <Field label={tr("Number starts with")} error={bad(/curly/)} hint={tr("For example MEM-")}>
              <input className="input" value={e.numbering.prefix} onChange={(ev) => set({ numbering: { ...(e.numbering as NonNullable<DraftEntity["numbering"]>), prefix: ev.target.value } })} />
            </Field>
            <Field label={tr("Digits")} error={bad(/digits/)}>
              <input className="input" type="number" min={1} max={12} value={e.numbering.digits} onChange={(ev) => set({ numbering: { ...(e.numbering as NonNullable<DraftEntity["numbering"]>), digits: Number(ev.target.value) } })} />
            </Field>
          </div>
        )}
        {template && (
          <p role="status">
            {tr("The next number would be")} <strong className="mono">{isolate(nextNumber(template))}</strong>
          </p>
        )}
      </div>
    </Card>
  );
}

// ── fields ──

/** Up, down and remove for one row. */
function RowTools({ first, last, what, onMove, onRemove }: { first: boolean; last: boolean; what: string; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <Button size="sm" icon="up" disabled={first} aria-label={tr("Move {name} up", { name: what })} onClick={() => onMove(-1)} />
      <Button size="sm" icon="down" disabled={last} aria-label={tr("Move {name} down", { name: what })} onClick={() => onMove(1)} />
      <Button size="sm" icon="trash" aria-label={tr("Remove {name}", { name: what })} onClick={onRemove} />
    </div>
  );
}

/** Taking a saved field out leaves its values in the records, out of sight. */
async function confirmRemove(f: DraftField): Promise<boolean> {
  if (!f.saved) return true;
  return confirmDialog({
    title: tr("Remove {name}?", { name: isolate(f.label.trim() || f.name) }),
    message: tr("Records that exist keep what they hold in this field, out of sight. If you add a field with the name {field} again, they come back.", { field: isolate(f.name) }),
    confirmLabel: tr("Remove it"),
    danger: true,
  });
}

function FieldList({ entity, scope, shown, onChange, problems, targets }: { entity: DraftEntity; scope: string; shown: (f: DraftField) => boolean; onChange: (e: DraftEntity) => void; problems: Problem[]; targets: EntitySummary[] }) {
  const list = entity.fields.filter(shown);
  if (!list.length) return <p className="faint">{tr("No fields yet.")}</p>;
  return (
    <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {list.map((f, i) => (
        <li key={f.key}>
          <FieldRow
            entity={entity} f={f} scope={scope} first={i === 0} last={i === list.length - 1} lines={entity.kind === "child"}
            problems={problems.filter((p) => p.scope === scope && p.field === f.key)} targets={targets}
            onChange={onChange}
            onMove={(by) => onChange(moveField(entity, f.key, by, shown))}
            onRemove={async () => (await confirmRemove(f)) && onChange(removeField(entity, f.key))}
          />
        </li>
      ))}
    </ol>
  );
}

function FieldRow({ entity, f, first, last, lines, problems, targets, onChange, onMove, onRemove }: {
  entity: DraftEntity; f: DraftField; scope: string; first: boolean; last: boolean; lines: boolean; problems: Problem[]; targets: EntitySummary[];
  onChange: (e: DraftEntity) => void; onMove: (by: -1 | 1) => void; onRemove: () => void;
}) {
  const patch = (p: Partial<DraftField>) => onChange(patchField(entity, f.key, p));
  const what = f.label.trim() || f.name || tr("a new field");
  const bad = (re: RegExp) => problems.find((p) => re.test(p.message))?.message;
  const known = FIELD_TYPES.some((x) => x.type === f.type);
  const retyped = f.saved && f.savedType && f.type !== f.savedType;
  const chips = entity.fields.filter((o) => o.type !== "table" && o.name && o.key !== f.key).map((o) => ({ name: o.name, label: o.label }));
  const options = f.options.map((o) => o.trim()).filter(Boolean);
  return (
    <fieldset className="card card-body stack" aria-invalid={problems.length ? true : undefined} style={{ margin: 0, minWidth: 0 }}>
      <legend className="field-label">{isolate(what)}</legend>
      <div className="form-grid" style={{ ["--cols" as string]: 3 }}>
        <Field label={tr("Label")} required error={bad(/label\./)}>
          <input className="input" value={f.label} onChange={(ev) => onChange(setFieldLabel(entity, f.key, ev.target.value))} />
        </Field>
        <Field label={tr("Name")} error={bad(/name|called|keeps/)} hint={f.saved ? tr("Fixed: records hold values under it.") : undefined}>
          <input className="input mono" value={f.name} readOnly={f.saved} spellCheck={false} autoCapitalize="none" onChange={(ev) => patch({ name: ev.target.value, nameTouched: true })} />
        </Field>
        <Field label={tr("Type")}>
          <select className="select" value={f.type} onChange={(ev) => patch({ type: ev.target.value })}>
            {FIELD_TYPES.map((x) => (
              <option key={x.type} value={x.type}>{x.label()}</option>
            ))}
            {!known && <option value={f.type}>{KEPT_TYPES[f.type]?.() ?? f.type}</option>}
          </select>
        </Field>
      </div>
      {retyped && <p className="field-hint" role="status">{tr("This field was saved as another type. Changing the type is offered, but the server refuses it when records already hold values that would not fit.")}</p>}
      <div className="row" style={{ flexWrap: "wrap", columnGap: 16 }}>
        <label className="check-field"><input type="checkbox" checked={f.required} onChange={(ev) => patch({ required: ev.target.checked })} />{tr("Required")}</label>
        <label className="check-field"><input type="checkbox" checked={f.in_list} onChange={(ev) => patch({ in_list: ev.target.checked })} />{tr("Shown in the list")}</label>
        <label className="check-field"><input type="checkbox" checked={f.in_filter} onChange={(ev) => patch({ in_filter: ev.target.checked })} />{tr("Usable as a filter")}</label>
        {!lines && <label className="check-field"><input type="checkbox" checked={f.unique} onChange={(ev) => patch({ unique: ev.target.checked })} />{tr("Each value only once")}</label>}
      </div>
      {problems.filter((p) => !/label\.|name|called|keeps/.test(p.message)).map((p, i) => (
        <p key={i} className="field-error">{p.message}</p>
      ))}
      <details>
        <summary>{tr("More about {field}", { field: isolate(what) })}</summary>
        <div className="stack">
          {f.type === "select" && (
            <Field label={tr("Choices")} hint={tr("One choice on each line.")}>
              <textarea className="textarea" rows={4} value={f.options.join("\n")} onChange={(ev) => patch({ options: ev.target.value.split("\n") })} />
            </Field>
          )}
          {f.type === "link" && (
            <Field label={tr("Links to")}>
              <select className="select" value={f.to} onChange={(ev) => patch({ to: ev.target.value })}>
                <option value="">{tr("Choose an entity…")}</option>
                {targets.map((t) => (
                  <option key={t.name} value={t.name}>{isolate(t.label)}</option>
                ))}
                {f.to && !targets.some((t) => t.name === f.to) && <option value={f.to}>{isolate(f.to)}</option>}
              </select>
            </Field>
          )}
          <div className="form-grid">
            {isDecimal(f.type) && (
              <Field label={tr("Digits after the point")}>
                <input className="input" inputMode="numeric" value={f.precision} onChange={(ev) => patch({ precision: ev.target.value })} />
              </Field>
            )}
            {isNumeric(f.type) && (
              <>
                <Field label={tr("Smallest value")}>
                  <input className="input" inputMode="decimal" value={f.min} onChange={(ev) => patch({ min: ev.target.value })} />
                </Field>
                <Field label={tr("Largest value")}>
                  <input className="input" inputMode="decimal" value={f.max} onChange={(ev) => patch({ max: ev.target.value })} />
                </Field>
              </>
            )}
            {hasMaxLength(f.type) && (
              <Field label={tr("Longest length")}>
                <input className="input" inputMode="numeric" value={f.max_length} onChange={(ev) => patch({ max_length: ev.target.value })} />
              </Field>
            )}
            {f.type === "check" ? (
              <Field label={tr("Starts as")}>
                <select className="select" value={f.default} onChange={(ev) => patch({ default: ev.target.value })}>
                  <option value="">{tr("(not set)")}</option>
                  <option value="true">{tr("Yes")}</option>
                  <option value="false">{tr("No")}</option>
                </select>
              </Field>
            ) : f.type === "select" ? (
              <Field label={tr("Starts as")}>
                <select className="select" value={f.default} onChange={(ev) => patch({ default: ev.target.value })}>
                  <option value="">{tr("(not set)")}</option>
                  {options.map((o) => (
                    <option key={o} value={o}>{isolate(o)}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={tr("Starts as")}>
                <input className="input" value={f.default} onChange={(ev) => patch({ default: ev.target.value })} />
              </Field>
            )}
          </div>
          <Field label={tr("Description")} hint={tr("Shown under the field on the form.")}>
            <input className="input" value={f.description} onChange={(ev) => patch({ description: ev.target.value })} />
          </Field>
          <ExprInput label={tr("Show only when")} value={f.visible_if} onChange={(v) => patch({ visible_if: v })} fields={chips} hint={tr("A condition, for example doc.status == \"Active\". Empty: always shown. The server checks it when you save.")} />
          <ExprInput label={tr("Required when")} value={f.required_if} onChange={(v) => patch({ required_if: v })} fields={chips} />
          <ExprInput label={tr("Read-only when")} value={f.read_only_if} onChange={(v) => patch({ read_only_if: v })} fields={chips} />
        </div>
      </details>
      <RowTools first={first} last={last} what={isolate(what)} onMove={onMove} onRemove={onRemove} />
    </fieldset>
  );
}

// ── lines and totals ──

/** What a total can add up: the number of each lines table's rows, or one of its numeric fields. */
function totalChoices(tables: DraftField[]) {
  return tables.flatMap((t) => {
    const name = t.label.trim() || t.name || tr("the lines");
    return [
      { value: `count:${t.key}:`, label: tr("Number of {lines}", { lines: name }) },
      ...(t.lines?.fields.filter((l) => isNumeric(l.type) && !l.rollup).map((l) => ({ value: `sum:${t.key}:${l.key}`, label: tr("Sum of {lines}.{field}", { lines: name, field: l.label.trim() || l.name }) })) ?? []),
    ];
  });
}

function LinesCard({ entity, onChange, problems, targets, tables }: { entity: DraftEntity; onChange: (e: DraftEntity) => void; problems: Problem[]; targets: EntitySummary[]; tables: DraftField[] }) {
  const totals = entity.fields.filter((f) => f.rollup);
  const isTotal = (f: DraftField) => !!f.rollup;
  const choices = totalChoices(tables);
  const addTotal = () => {
    const t = tables[0];
    const row = t.lines?.fields.find((l) => isNumeric(l.type) && !l.rollup) ?? null;
    onChange(addField(entity, startTotal(t, row)));
  };
  return (
    <Card id="ed-lines" title={tr("Lines")} actions={<Button size="sm" icon="plus" onClick={() => onChange(addField(entity, startLines(tr("Lines"))))}>{tr("Add a lines table")}</Button>}>
      <p className="muted">{tr("Lines are rows inside one record, such as the items of an order. Each lines table has its own fields and its own entity behind it.")}</p>
      {!tables.length && <p className="faint">{tr("No lines tables yet.")}</p>}
      {tables.map((t, i) => (
        <section key={t.key} className="card card-body stack" aria-label={tr("Lines {name}", { name: isolate(t.label.trim() || t.name) })} style={{ margin: 0 }}>
          <div className="form-grid">
            <Field label={tr("Label of the lines")} required error={problems.find((p) => p.scope === "" && p.field === t.key && /label\./.test(p.message))?.message}>
              <input className="input" value={t.label} onChange={(ev) => onChange(setFieldLabel(entity, t.key, ev.target.value))} />
            </Field>
            <Field label={tr("Name")} hint={t.saved ? tr("Fixed: records hold values under it.") : tr("Its entity is named from this entity and this name.")}>
              <input className="input mono" value={t.name} readOnly={t.saved} spellCheck={false} autoCapitalize="none" onChange={(ev) => onChange(patchField(entity, t.key, { name: ev.target.value, nameTouched: true }))} />
            </Field>
          </div>
          <h3 className="field-label">{tr("Fields of the lines")}</h3>
          {t.lines && (
            <>
              <FieldList entity={t.lines} scope={t.key} shown={() => true} problems={problems} targets={targets} onChange={(lines) => onChange(patchField(entity, t.key, { lines }))} />
              <div>
                <Button size="sm" icon="plus" onClick={() => onChange(patchField(entity, t.key, { lines: addField(t.lines as DraftEntity, startField()) }))}>{tr("Add a field to {name}", { name: isolate(t.label.trim() || t.name) })}</Button>
              </div>
            </>
          )}
          {problems.filter((p) => p.scope === t.key && !p.field).map((p, j) => (
            <p key={j} className="field-error">{p.message}</p>
          ))}
          <RowTools
            first={i === 0} last={i === tables.length - 1} what={isolate(t.label.trim() || t.name)}
            onMove={(by) => onChange(moveField(entity, t.key, by, (f) => f.type === "table"))}
            onRemove={async () => (await confirmRemove(t)) && onChange(removeField(entity, t.key))}
          />
        </section>
      ))}
      <h3 className="field-label">{tr("Totals")}</h3>
      <p className="muted">{tr("A total adds up the lines of each record. The server works it out whenever a record is saved, so nobody types it.")}</p>
      {!totals.length && <p className="faint">{tr("No totals yet.")}</p>}
      <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {totals.map((f, i) => {
          const r = f.rollup as NonNullable<DraftField["rollup"]>;
          const value = `${r.op}:${r.table}:${r.field}`;
          const prob = problems.filter((p) => p.scope === "" && p.field === f.key);
          return (
            <li key={f.key} className="card card-body stack" style={{ margin: 0 }}>
              <div className="form-grid">
                <Field label={tr("Label of the total")} required error={prob.find((p) => /label\./.test(p.message))?.message}>
                  <input className="input" value={f.label} onChange={(ev) => onChange(setFieldLabel(entity, f.key, ev.target.value))} />
                </Field>
                <Field label={tr("What it adds up")} error={prob.find((p) => !/label\./.test(p.message))?.message}>
                  <select
                    className="select" value={value}
                    onChange={(ev) => {
                      const [op, table, field] = ev.target.value.split(":");
                      const row = tables.find((t) => t.key === table)?.lines?.fields.find((l) => l.key === field);
                      onChange(patchField(entity, f.key, { rollup: { table, op: op === "sum" ? "sum" : "count", field }, type: row && op === "sum" ? row.type : "int" }));
                    }}
                  >
                    {!choices.some((c) => c.value === value) && <option value={value}>{tr("(something that is gone)")}</option>}
                    {choices.map((c) => (
                      <option key={c.value} value={c.value}>{isolate(c.label)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={tr("Value")} hint={tr("Worked out when a record is saved.")}>
                  <input className="input" disabled readOnly value={tr("Worked out by the server")} />
                </Field>
              </div>
              <RowTools first={i === 0} last={i === totals.length - 1} what={isolate(f.label.trim() || f.name)} onMove={(by) => onChange(moveField(entity, f.key, by, isTotal))} onRemove={async () => (await confirmRemove(f)) && onChange(removeField(entity, f.key))} />
            </li>
          );
        })}
      </ol>
      <div>
        <Button size="sm" icon="plus" disabled={!tables.length} onClick={addTotal}>{tr("Add a total")}</Button>
      </div>
    </Card>
  );
}
