// Customize (administrators): inspect fields, add custom fields, set field properties, add
// validation rules, toggle customizations, and export/import the change set.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorMessage, saveBlob } from "../lib/api";
import { formatDateTime, todayIso } from "../lib/format";
import { useEntityMeta, useMe, useMetaIndex, type EntityMeta, type Field, type FieldType } from "../lib/meta";
import { formDesignerLink } from "../lib/formLayout";
import { buttonsLink } from "../lib/buttonDraft";
import { listsLink } from "../lib/publishedListDraft";
import { targetsLink } from "../lib/targetDraft";
import { workflowDesignerLink } from "../lib/workflowDraft";
import { Alert, Badge, Button, confirmDialog, Dialog, EmptyState, ErrorState, Field as FieldWrap, PageLoading, toast } from "../ui/kit";
import { t as tr, isolate } from "@ferrum/client";
import { useApply } from "./author/apply";
import { CheckInput, checkText, startCheck } from "./author/CheckBuilder";
import { FormCard } from "./author/FormCard";

interface Customization {
  id: string;
  seq: number;
  entity: string;
  op: Record<string, unknown>;
  is_active: boolean;
  note?: string | null;
  created_at: string;
  /** The id of the later change that replaced this one: it no longer applies (an older server sends none). */
  superseded_by?: string | null;
}
interface Warning {
  entity?: string;
  message?: string;
}
/** A customization an update parted ways with (GET /api/customize/conflicts). */
interface Conflict {
  id: string;
  entity: string;
  note?: string | null;
  op: Record<string, unknown>;
  /** What the customization replaced when it was made, or last kept. */
  was: unknown;
  /** What the packages say now; null too when what it names is gone. */
  now: unknown;
  gone: boolean;
  /** Not applied until someone keeps it: the update made required what it made optional. */
  suspended: boolean;
}

const FIELD_TYPES: FieldType[] = [
  "data", "text", "markdown", "code", "int", "decimal", "currency", "percent", "date", "datetime",
  "check", "select", "link", "json", "email", "phone", "url", "attach", "color",
];
const BOOL_PROPS = new Set(["required", "hidden", "read_only", "in_list", "in_filter"]);
const PROPERTIES = [
  "label", "description", "required", "hidden", "read_only", "in_list", "in_filter", "default", "default_expr",
  "visible_if", "required_if", "read_only_if", "max_length", "min", "max",
];

const useCustomizations = () =>
  useQuery({
    queryKey: ["customize"],
    queryFn: ({ signal }) => api.get<{ customizations: Customization[]; warnings: (Warning | string)[] }>("/api/customize", undefined, signal),
  });

export function CustomizePage() {
  const { entity } = useParams();
  const me = useMe();
  const index = useMetaIndex().data;
  const navigate = useNavigate();
  if (me.isLoading) return <PageLoading />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can customize entities.")}</p>
      </EmptyState>
    );
  }
  const entities = [...(index?.entities ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="crumbs">{tr("Customize")}</p>
          <h1 className="page-title">{entity ? (index?.entities.find((e) => e.name === entity)?.label ?? entity) : tr("Customize")}</h1>
        </div>
        <div className="page-actions">
          <label className="sr-only" htmlFor="cz-entity">
            {tr("Entity to customize")}
          </label>
          <select id="cz-entity" className="select" style={{ width: 220 }} value={entity ?? ""} onChange={(e) => navigate(`/customize/${e.target.value}`)}>
            <option value="" disabled>
              {tr("Choose an entity…")}
            </option>
            {entities.map((e) => (
              <option key={e.name} value={e.name}>
                {isolate(e.label)}
              </option>
            ))}
            {entity && !entities.some((e) => e.name === entity) && <option value={entity}>{isolate(entity)}</option>}
          </select>
          {entity && (
            <Link className="btn" to={formDesignerLink(entity)}>
              {tr("Design form")}
            </Link>
          )}
          {entity && (
            <Link className="btn" to={workflowDesignerLink(entity)}>
              {tr("Design workflow")}
            </Link>
          )}
          {entity && (
            <Link className="btn" to={buttonsLink(entity)}>
              {tr("Buttons")}
            </Link>
          )}
          {entity && !["child", "ledger"].includes(index?.entities.find((e) => e.name === entity)?.kind ?? "") && (
            <Link className="btn" to={targetsLink(entity)}>
              {tr("Targets")}
            </Link>
          )}
          {entity && ["master", "document"].includes(index?.entities.find((e) => e.name === entity)?.kind ?? "") && (
            <Link className="btn" to={listsLink(entity)}>
              {tr("Public lists")}
            </Link>
          )}
          <Link className="btn" to="/customize/menus">
            {tr("Menus")}
          </Link>
          <Link className="btn" to="/customize/packs">
            {tr("Packs")}
          </Link>
          <ChangeSet />
        </div>
      </div>
      <Warnings />
      <UpdateConflicts />
      <YourEntities />
      {entity ? <CustomizeEntity key={entity} entity={entity} /> : <EmptyState title={tr("Choose an entity to customize")} icon="edit" />}
    </div>
  );
}

/** The workspace's own entities, with a way to make another and to change each. */
function YourEntities() {
  const index = useMetaIndex().data;
  const mine = (index?.entities ?? []).filter((e) => e.custom && e.kind !== "child").sort((a, b) => a.label.localeCompare(b.label));
  return (
    <section className="card" aria-labelledby="cz-mine">
      <div className="card-head">
        <h2 id="cz-mine">{tr("Your entities")}</h2>
        <span className="spacer" />
        <Link className="btn btn-sm" to="/customize/new">
          {tr("New entity")}
        </Link>
      </div>
      <div className="card-body">
        {!mine.length ? (
          <p className="muted">{tr("You have not made any entities yet. An entity is a kind of record of your own, with the fields, lines and totals you choose.")}</p>
        ) : (
          <ul className="stack">
            {mine.map((e) => (
              <li key={e.name} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <strong>{isolate(e.label)}</strong>
                <Badge>{e.kind === "document" ? tr("Document") : tr("List")}</Badge>
                <span className="spacer" />
                <Link className="btn btn-sm" to={`/customize/${encodeURIComponent(e.name)}/design`} aria-label={tr("Design {entity}", { entity: isolate(e.label) })}>
                  {tr("Design")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Warnings() {
  const q = useCustomizations();
  const warnings = q.data?.warnings ?? [];
  if (!warnings.length) return null;
  return (
    <Alert tone="warning">
      <strong>{tr("The server reported problems with customizations")}</strong>
      <ul>
        {warnings.map((w, i) => (
          <li key={i}>{typeof w === "string" ? w : `${w.entity ? `${w.entity}: ` : ""}${w.message ?? JSON.stringify(w)}`}</li>
        ))}
      </ul>
    </Alert>
  );
}

/** What a customization replaced, or what an update says in its place, in a few words. */
export function shownValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return tr("Not set");
  if (typeof v === "string") return v.length > 80 ? tr("{n} characters", { n: v.length }) : v;
  if (typeof v !== "object") return String(v);
  const states = (v as { states?: unknown }).states;
  if (Array.isArray(states)) return states.map((s) => String((s as { name?: unknown }).name ?? "?")).join(", ");
  const text = JSON.stringify(v);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** Customizations an update parted ways with: each kept (theirs stands, compared from now on with
 * what the update says) or switched off (the update's stands). Until then a field the update made
 * required stays required. */
function UpdateConflicts() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["customize", "conflicts"],
    queryFn: ({ signal }) => api.get<{ conflicts: Conflict[] }>("/api/customize/conflicts", undefined, signal),
  });
  const [pending, setPending] = useState<string | null>(null);
  const index = useMetaIndex().data;
  const conflicts = q.data?.conflicts ?? [];
  if (!conflicts.length) return null;
  const label = (entity: string) => index?.entities.find((e) => e.name === entity)?.label ?? entity;
  const decide = async (c: Conflict, keep: boolean) => {
    setPending(c.id);
    try {
      if (keep) await api.post(`/api/customize/${c.id}/keep`, {});
      else await api.put(`/api/customize/${c.id}/active`, { active: false });
      toast(keep ? tr("Kept: compared from now on with what the update says") : tr("Switched off: the update's stands"));
      await Promise.all([qc.invalidateQueries({ queryKey: ["meta"] }), qc.invalidateQueries({ queryKey: ["customize"] })]);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPending(null);
    }
  };
  return (
    <section className="card" aria-labelledby="cz-parted">
      <div className="card-head">
        <h2 id="cz-parted">{tr("Changed by an update")}</h2>
      </div>
      <div className="card-body">
        <p className="muted">
          {tr("An update changed what these customizations replace. Keep yours and it stands; switch it off and the update's does.")}
        </p>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{tr("Entity")}</th>
              <th scope="col">{tr("Change")}</th>
              <th scope="col">{tr("It replaced")}</th>
              <th scope="col">{tr("The update says")}</th>
              <th scope="col">
                <span className="sr-only">{tr("Decide")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => {
              const change = describeOp(c.op);
              return (
                <tr key={c.id}>
                  <td>{isolate(label(c.entity))}</td>
                  <td className="mono">
                    {isolate(change)}
                    {c.suspended && (
                      <>
                        {" "}
                        <Badge tone="amber">{tr("Suspended: the update requires it")}</Badge>
                      </>
                    )}
                  </td>
                  <td>{isolate(shownValue(c.was))}</td>
                  <td>{c.gone ? tr("Removed by the update") : isolate(shownValue(c.now))}</td>
                  <td className="nowrap">
                    {!c.gone && (
                      <Button size="sm" disabled={pending === c.id} onClick={() => void decide(c, true)} aria-label={tr("Keep mine: {change}", { change })}>
                        {tr("Keep mine")}
                      </Button>
                    )}{" "}
                    <Button size="sm" disabled={pending === c.id} onClick={() => void decide(c, false)} aria-label={tr("Switch off: {change}", { change })}>
                      {tr("Switch off")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChangeSet() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const exportSet = async () => {
    try {
      const data = await api.get<unknown>("/api/customize/export");
      saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `ferrum-customizations-${todayIso()}.json`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const importSet = async (file: File) => {
    try {
      const bundle = JSON.parse(await file.text()) as { customizations?: unknown[] };
      const n = Array.isArray(bundle.customizations) ? bundle.customizations.length : 0;
      if (!(await confirmDialog({ title: tr("Import customizations?"), message: tr("{name} contains {n} customization{value}.", { name: file.name, n, value: n === 1 ? "" : "s" }), confirmLabel: tr("Import") })))
        return;
      const res = await api.post<{ imported: number }>("/api/customize/import", bundle);
      toast(tr("Imported {imported} customization{value}", { imported: res.imported, value: res.imported === 1 ? "" : "s" }));
      await Promise.all([qc.invalidateQueries({ queryKey: ["meta"] }), qc.invalidateQueries({ queryKey: ["customize"] })]);
    } catch (e) {
      toast(e instanceof SyntaxError ? tr("That file is not valid JSON.") : errorMessage(e), "error");
    }
  };
  return (
    <div className="row" role="group" aria-label={tr("Only the customizations")} style={{ gap: 8, flexWrap: "wrap" }}>
      <span className="muted">{tr("Only the customizations")}</span>
      <Button icon="download" onClick={() => void exportSet()}>
        {tr("Export")}
      </Button>
      <Button icon="upload" onClick={() => input.current?.click()}>
        {tr("Import")}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importSet(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function CustomizeEntity({ entity }: { entity: string }) {
  const meta = useEntityMeta(entity);
  const [editing, setEditing] = useState<Field | null>(null);
  if (meta.error) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  if (!meta.data) return <PageLoading />;
  const m = meta.data;
  return (
    <div className="stack">
      <FieldsTable meta={m} onEdit={setEditing} />
      <div className="home-grid">
        <AddFieldCard meta={m} />
        <AddRuleCard meta={m} />
      </div>
      <ChangesCard entity={entity} />
      <PropertyDialog meta={m} field={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function FieldsTable({ meta, onEdit }: { meta: EntityMeta; onEdit: (f: Field) => void }) {
  const flags = (f: Field) =>
    (
      [
        [f.required, "required", "amber"],
        [f.hidden, "hidden", "neutral"],
        [f.read_only || f.computed, "read-only", "neutral"],
        [f.in_list, tr("in list"), "blue"],
        [f.in_filter, tr("in filter"), "blue"],
        [f.name.startsWith("x_"), "custom", "purple"],
        [f.locked, "locked", "red"],
        [f.visible_if, "conditional", "green"],
      ] as const
    ).filter(([on]) => !!on);
  return (
    <section className="card" aria-labelledby="cz-fields">
      <div className="card-head">
        <h2 id="cz-fields">{tr("Fields")}</h2>
        <span className="muted">{meta.fields.length}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{tr("Field")}</th>
              <th scope="col">{tr("Type")}</th>
              <th scope="col">{tr("Storage")}</th>
              <th scope="col">{tr("Properties")}</th>
              <th scope="col">
                <span className="sr-only">{tr("Actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {meta.fields.map((f) => (
              <tr key={f.name}>
                <td>
                  <div>{isolate(f.label)}</div>
                  <div className="mono faint">{isolate(f.name)}</div>
                </td>
                <td>
                  {isolate(f.type)}
                  {f.to ? <span className="faint"> → {isolate(f.to)}</span> : null}
                  {f.of ? <span className="faint"> {tr("of {of}", { of: f.of })}</span> : null}
                  {f.options?.length ? <span className="faint"> {tr("({length} options)", { length: f.options.length })}</span> : null}
                </td>
                <td>{f.storage ? <Badge tone={f.storage === "ext" ? "purple" : "neutral"}>{isolate(f.storage)}</Badge> : <span className="faint">{tr("child table")}</span>}</td>
                <td>
                  <div className="chips">
                    {flags(f).map(([, label, tone]) => (
                      <Badge key={label} tone={tone}>
                        {isolate(label)}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="nowrap">
                  <Button size="sm" icon="edit" onClick={() => onEdit(f)} aria-label={tr("Edit properties of {label}", { label: f.label })}>
                    {tr("Edit")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.keys(meta.children).length > 0 && (
        <div className="card-body row">
          <span className="muted">{tr("Child tables:")}</span>
          {Object.values(meta.children).flatMap((c) => [c, ...Object.values(c.children ?? {})]).map((c) => (
            <Link key={c.entity} className="chip" to={`/customize/${c.entity}`}>
              {isolate(c.label)}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function AddFieldCard({ meta }: { meta: EntityMeta }) {
  const apply = useApply(meta.name);
  const index = useMetaIndex().data;
  const empty = { name: "x_", label: "", type: "data" as FieldType, options: "", to: "", after: "", description: "", required: false, in_list: false, in_filter: false, note: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!/^x_[a-z][a-z0-9_]*$/.test(f.name)) return setError(tr("The name must start with x_ followed by lower-case letters, digits or underscores."));
    if (f.type === "link" && !f.to) return setError(tr("Choose the entity this link points to."));
    const options = f.options.split("\n").map((s) => s.trim()).filter(Boolean);
    if (f.type === "select" && !options.length) return setError(tr("Give at least one option."));
    const field: Record<string, unknown> = { name: f.name, label: f.label.trim() || undefined, type: f.type };
    if (f.type === "select") field.options = options;
    if (f.type === "link") field.to = f.to;
    if (f.description.trim()) field.description = f.description.trim();
    for (const k of ["required", "in_list", "in_filter"] as const) if (f[k]) field[k] = true;
    setBusy(true);
    setError(null);
    try {
      await apply({ op: "add_field", field, ...(f.after ? { after: f.after } : {}) }, f.note);
      toast(tr("Field {name} added", { name: f.name }));
      setF(empty);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormCard title={tr("Add a custom field")} onSubmit={submit} busy={busy} submitLabel={tr("Add field")} error={error}>
      <div className="form-grid">
        <FieldWrap label={tr("Name")} htmlFor="af-name" required hint={tr("Must start with x_")}>
          <input id="af-name" className="input mono" value={f.name} onChange={(e) => set("name", e.target.value.toLowerCase())} required pattern="x_[a-z][a-z0-9_]*" />
        </FieldWrap>
        <FieldWrap label={tr("Label")} htmlFor="af-label">
          <input id="af-label" className="input" value={f.label} onChange={(e) => set("label", e.target.value)} />
        </FieldWrap>
        <FieldWrap label={tr("Type")} htmlFor="af-type" required>
          <select id="af-type" className="select" value={f.type} onChange={(e) => set("type", e.target.value as FieldType)}>
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {isolate(t)}
              </option>
            ))}
          </select>
        </FieldWrap>
        <FieldWrap label={tr("Insert after")} htmlFor="af-after">
          <select id="af-after" className="select" value={f.after} onChange={(e) => set("after", e.target.value)}>
            <option value="">{tr("At the end")}</option>
            {meta.fields.map((x) => (
              <option key={x.name} value={x.name}>
                {isolate(x.label)}
              </option>
            ))}
          </select>
        </FieldWrap>
        {f.type === "link" && (
          <FieldWrap label={tr("Links to")} htmlFor="af-to" required>
            <select id="af-to" className="select" value={f.to} onChange={(e) => set("to", e.target.value)} required>
              <option value="">{tr("Choose…")}</option>
              {(index?.entities ?? []).map((e) => (
                <option key={e.name} value={e.name}>
                  {isolate(e.label)}
                </option>
              ))}
            </select>
          </FieldWrap>
        )}
        {f.type === "select" && (
          <FieldWrap label={tr("Options")} htmlFor="af-options" required hint={tr("One per line")} className="span-all">
            <textarea id="af-options" className="textarea" value={f.options} onChange={(e) => set("options", e.target.value)} />
          </FieldWrap>
        )}
        <FieldWrap label={tr("Description")} htmlFor="af-desc" className="span-all">
          <input id="af-desc" className="input" value={f.description} onChange={(e) => set("description", e.target.value)} />
        </FieldWrap>
      </div>
      <div className="row">
        {(["required", "in_list", "in_filter"] as const).map((k) => (
          <label key={k} className="check-field">
            <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />
            {k === "required" ? tr("Required") : k === "in_list" ? tr("Show in list") : tr("Filterable")}
          </label>
        ))}
      </div>
      <FieldWrap label={tr("Note")} htmlFor="af-note">
        <input id="af-note" className="input" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder={tr("Why this change? (optional)")} />
      </FieldWrap>
    </FormCard>
  );
}

function AddRuleCard({ meta }: { meta: EntityMeta }) {
  const apply = useApply(meta.name);
  const empty = { name: "", message: "", on: "save", note: "" };
  const [r, setR] = useState(empty);
  const [check, setCheck] = useState(startCheck);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof empty, v: string) => setR((s) => ({ ...s, [k]: v }));
  const submit = async () => {
    const expr = checkText(check, meta.fields);
    if (!expr) return setError(tr("Finish the check before adding the rule."));
    setBusy(true);
    setError(null);
    try {
      await apply({ op: "add_rule", rule: { name: r.name.trim(), check: expr, message: r.message.trim(), on: r.on } }, r.note);
      toast(tr("Rule {name} added", { name: r.name }));
      setR(empty);
      setCheck(startCheck());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormCard title={tr("Add a validation rule")} onSubmit={submit} busy={busy} submitLabel={tr("Add rule")} error={error}>
      {meta.rules.length > 0 && (
        <div>
          <p className="field-label">{tr("Existing rules")}</p>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {meta.rules.map((x) => (
              <li key={x.name}>
                <span className="mono">{isolate(x.name)}</span> <span className="faint">({isolate(x.on)})</span>: {isolate(x.message)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <FieldWrap label={tr("Name")} htmlFor="ar-name" required>
        <input id="ar-name" className="input mono" value={r.name} onChange={(e) => set("name", e.target.value)} required placeholder={tr("e.g. reference_required")} />
      </FieldWrap>
      <CheckInput fields={meta.fields} state={check} onChange={setCheck} />
      <p className="field-hint">
        {tr("Need to look at other records?")} <Link to="/studio/solutions">{tr("Use a rule in Studio")}</Link>
      </p>
      <FieldWrap label={tr("Message")} htmlFor="ar-message" required>
        <input id="ar-message" className="input" value={r.message} onChange={(e) => set("message", e.target.value)} required />
      </FieldWrap>
      <div className="form-grid">
        <FieldWrap label={tr("Checked on")} htmlFor="ar-on">
          <select id="ar-on" className="select" value={r.on} onChange={(e) => set("on", e.target.value)}>
            <option value="save">{tr("Save")}</option>
            <option value="submit">{tr("Submit")}</option>
          </select>
        </FieldWrap>
        <FieldWrap label={tr("Note")} htmlFor="ar-note">
          <input id="ar-note" className="input" value={r.note} onChange={(e) => set("note", e.target.value)} />
        </FieldWrap>
      </div>
    </FormCard>
  );
}

/** Parses a typed property value: booleans/numbers/JSON when it looks like one, else text. */
function propertyValue(property: string, raw: string, checked: boolean): unknown {
  if (BOOL_PROPS.has(property)) return checked;
  const t = raw.trim();
  if (!t) return null;
  if (property === "max_length") return Number.parseInt(t, 10);
  if (property === "default") {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return t;
}

function PropertyDialog({ meta, field, onClose }: { meta: EntityMeta; field: Field | null; onClose: () => void }) {
  const apply = useApply(meta.name);
  const [property, setProperty] = useState("label");
  const [raw, setRaw] = useState("");
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (p: string, f: Field | null = field) => {
    setProperty(p);
    const current = f ? (f as unknown as Record<string, unknown>)[p] : undefined;
    setChecked(current === true);
    setRaw(current === undefined || current === null ? "" : typeof current === "string" ? current : JSON.stringify(current));
    setError(null);
  };
  // Re-seed the inputs whenever a different field is opened.
  const [seenField, setSeenField] = useState<Field | null>(null);
  if (field !== seenField) {
    setSeenField(field);
    if (field) pick("label", field);
    setNote("");
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!field) return;
    setBusy(true);
    setError(null);
    try {
      await apply({ op: "set_property", field: field.name, property, value: propertyValue(property, raw, checked) }, note);
      toast(tr("{label}: {property} updated", { label: field.label, property }));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const expr = property.endsWith("_if") || property === "default_expr";
  return (
    <Dialog open={!!field} onClose={onClose} title={field ? tr("Edit {label}", { label: field.label }) : ""}>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{isolate(error)}</Alert>}
        <p className="muted">
          <span className="mono">{isolate(field?.name ?? "")}</span> · {isolate(field?.type ?? "")}
          {field?.locked ? tr(" · locked: packages only allow tightening its rules") : ""}
        </p>
        <FieldWrap label={tr("Property")} htmlFor="pd-prop">
          <select id="pd-prop" className="select" value={property} onChange={(e) => pick(e.target.value)}>
            {PROPERTIES.map((p) => (
              <option key={p} value={p}>
                {isolate(p)}
              </option>
            ))}
          </select>
        </FieldWrap>
        {BOOL_PROPS.has(property) ? (
          <label className="check-field">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {isolate(property)}
          </label>
        ) : (
          <FieldWrap
            label={tr("Value")}
            htmlFor="pd-value"
            hint={expr ? tr("CEL over doc (and parent in child rows), e.g. doc.status == 'Paid'. Empty clears it.") : tr("Empty clears it.")}
          >
            {expr ? (
              <textarea
                id="pd-value"
                className="textarea mono"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
            ) : (
              <input
                id="pd-value"
                className="input"
                inputMode={property === "max_length" || property === "min" || property === "max" ? "decimal" : undefined}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
            )}
          </FieldWrap>
        )}
        <FieldWrap label={tr("Note")} htmlFor="pd-note">
          <input id="pd-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </FieldWrap>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {tr("Apply")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function describeOp(op: Record<string, unknown>): string {
  const name = (v: unknown) => (v && typeof v === "object" && "name" in v ? String((v as { name: unknown }).name) : "?");
  switch (op.op) {
    case "add_field": {
      const f = op.field as { name?: string; type?: string } | undefined;
      return (op.after ? tr("Add field {name} ({type}) after {after}", { name: f?.name ?? "?", type: f?.type ?? "?", after: String(op.after) }) : tr("Add field {name} ({type})", { name: f?.name ?? "?", type: f?.type ?? "?" }));
    }
    case "set_property":
      return tr("Set {field}.{property} = {value}", { field: String(op.field), property: String(op.property), value: JSON.stringify(op.value) });
    case "add_rule":
      return tr("Add rule {value}", { value: name(op.rule) });
    case "add_options":
      return tr("Add options to {field}: {options}", { field: String(op.field), options: Array.isArray(op.options) ? op.options.join(", ") : "" });
    case "set_entity_property":
      return tr("Set entity {value}", { value: String(op.property) });
    case "define_entity":
      return tr("Define entity {value}", { value: name(op.entity) });
    case "redefine_entity":
      return tr("Change the design of entity {value}", { value: name(op.entity) });
    case "set_workflow":
      return tr("Set workflow {value}", { value: name(op.workflow) });
    case "add_action": {
      const a = op.action as { name?: string; label?: string } | undefined;
      return tr("Button: {label}", { label: a?.label || a?.name || "?" });
    }
    case "remove_action":
      return tr("Remove button {name}", { name: String(op.name) });
    case "add_target": {
      const a = op.target as { name?: string; label?: string } | undefined;
      return tr("Target: {label}", { label: a?.label || a?.name || "?" });
    }
    case "remove_target":
      return tr("Remove target {name}", { name: String(op.name) });
    case "publish_list": {
      const l = op.list as { name?: string; label?: string } | undefined;
      return tr("Published list: {label}", { label: l?.label || l?.name || "?" });
    }
    case "unpublish_list":
      return tr("Take down list {name}", { name: String(op.name) });
    case "define_module": {
      const m = op.module as { name?: string; label?: string } | undefined;
      return tr("Menu: {label}", { label: m?.label || m?.name || "?" });
    }
    case "remove_module":
      return tr("Remove menu {name}", { name: String(op.name) });
    case "set_print_template":
      return tr("Replace print template");
    default:
      return JSON.stringify(op);
  }
}

function ChangesCard({ entity }: { entity: string }) {
  const q = useCustomizations();
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const rows = (q.data?.customizations ?? []).filter((c) => all || c.entity === entity);
  const toggle = async (c: Customization) => {
    setPending(c.id);
    try {
      await api.put(`/api/customize/${c.id}/active`, { active: !c.is_active });
      toast(c.is_active ? tr("Customization turned off") : tr("Customization turned on"));
      await Promise.all([qc.invalidateQueries({ queryKey: ["meta"] }), qc.invalidateQueries({ queryKey: ["customize"] })]);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPending(null);
    }
  };
  return (
    <section className="card" aria-labelledby="cz-changes">
      <div className="card-head">
        <h2 id="cz-changes">{tr("Customizations")}</h2>
        <span className="spacer" />
        <label className="check-field">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {tr("All entities")}
        </label>
      </div>
      {q.isLoading ? (
        <PageLoading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <EmptyState title={tr("No customizations yet")} icon="edit" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                {all && <th scope="col">{tr("Entity")}</th>}
                <th scope="col">{tr("Change")}</th>
                <th scope="col">{tr("Note")}</th>
                <th scope="col">{tr("Created")}</th>
                <th scope="col">{tr("Active")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const later = c.superseded_by ? (q.data?.customizations ?? []).find((x) => x.id === c.superseded_by) : undefined;
                return (
                <tr key={c.id} className={c.superseded_by ? "faint" : undefined}>
                  <td className="faint">{c.seq}</td>
                  {all && <td>{isolate(c.entity)}</td>}
                  <td className="mono">
                    {isolate(describeOp(c.op))}
                    {c.superseded_by && (
                      <>
                        {" "}
                        <Badge>{later ? tr("Replaced by change {seq}", { seq: later.seq }) : tr("Replaced by a later change")}</Badge>
                      </>
                    )}
                  </td>
                  <td>{isolate(c.note ?? "")}</td>
                  <td className="nowrap">{isolate(formatDateTime(c.created_at))}</td>
                  <td>
                    <label className="check-field cell-check" style={{ minHeight: 0 }}>
                      <input type="checkbox" checked={c.is_active} disabled={pending === c.id} onChange={() => void toggle(c)} />
                      <span className="sr-only">{(c.is_active ? tr("Turn off customization {seq}", { seq: c.seq }) : tr("Turn on customization {seq}", { seq: c.seq }))}</span>
                    </label>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
