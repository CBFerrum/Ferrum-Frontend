// Customize (administrators): inspect fields, add custom fields, set field properties, add
// validation rules, toggle customizations, and export/import the change set.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorMessage, saveBlob } from "../lib/api";
import { formatDateTime, todayIso } from "../lib/format";
import { useEntityMeta, useMe, useMetaIndex, type EntityMeta, type Field, type FieldType } from "../lib/meta";
import { Alert, Badge, Button, confirmDialog, Dialog, EmptyState, ErrorState, Field as FieldWrap, PageLoading, toast } from "../ui/kit";

interface Customization {
  id: string;
  seq: number;
  entity: string;
  op: Record<string, unknown>;
  is_active: boolean;
  note?: string | null;
  created_at: string;
}
interface Warning {
  entity?: string;
  message?: string;
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

function useApply(entity: string) {
  const qc = useQueryClient();
  return async (op: Record<string, unknown>, note?: string) => {
    await api.post("/api/customize", { entity, op, note: note?.trim() || undefined });
    await Promise.all([qc.invalidateQueries({ queryKey: ["meta"] }), qc.invalidateQueries({ queryKey: ["customize"] })]);
  };
}

export function CustomizePage() {
  const { entity } = useParams();
  const me = useMe();
  const index = useMetaIndex().data;
  const navigate = useNavigate();
  if (me.isLoading) return <PageLoading />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title="Administrator access required" icon="alert">
        <p className="muted">Only administrators can customize entities.</p>
      </EmptyState>
    );
  }
  const entities = [...(index?.entities ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="crumbs">Customize</p>
          <h1 className="page-title">{entity ? (index?.entities.find((e) => e.name === entity)?.label ?? entity) : "Customize"}</h1>
        </div>
        <div className="page-actions">
          <label className="sr-only" htmlFor="cz-entity">
            Entity to customize
          </label>
          <select id="cz-entity" className="select" style={{ width: 220 }} value={entity ?? ""} onChange={(e) => navigate(`/customize/${e.target.value}`)}>
            <option value="" disabled>
              Choose an entity…
            </option>
            {entities.map((e) => (
              <option key={e.name} value={e.name}>
                {e.label}
              </option>
            ))}
            {entity && !entities.some((e) => e.name === entity) && <option value={entity}>{entity}</option>}
          </select>
          <ChangeSet />
        </div>
      </div>
      <Warnings />
      {entity ? <CustomizeEntity key={entity} entity={entity} /> : <EmptyState title="Choose an entity to customize" icon="edit" />}
    </div>
  );
}

function Warnings() {
  const q = useCustomizations();
  const warnings = q.data?.warnings ?? [];
  if (!warnings.length) return null;
  return (
    <Alert tone="warning">
      <strong>The server reported problems with customizations</strong>
      <ul>
        {warnings.map((w, i) => (
          <li key={i}>{typeof w === "string" ? w : `${w.entity ? `${w.entity}: ` : ""}${w.message ?? JSON.stringify(w)}`}</li>
        ))}
      </ul>
    </Alert>
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
      if (!(await confirmDialog({ title: "Import customizations?", message: `${file.name} contains ${n} customization${n === 1 ? "" : "s"}.`, confirmLabel: "Import" })))
        return;
      const res = await api.post<{ imported: number }>("/api/customize/import", bundle);
      toast(`Imported ${res.imported} customization${res.imported === 1 ? "" : "s"}`);
      await Promise.all([qc.invalidateQueries({ queryKey: ["meta"] }), qc.invalidateQueries({ queryKey: ["customize"] })]);
    } catch (e) {
      toast(e instanceof SyntaxError ? "That file is not valid JSON." : errorMessage(e), "error");
    }
  };
  return (
    <>
      <Button icon="download" onClick={() => void exportSet()}>
        Export
      </Button>
      <Button icon="upload" onClick={() => input.current?.click()}>
        Import
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
    </>
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
        [f.in_list, "in list", "blue"],
        [f.in_filter, "in filter", "blue"],
        [f.name.startsWith("x_"), "custom", "purple"],
        [f.locked, "locked", "red"],
        [f.visible_if, "conditional", "green"],
      ] as const
    ).filter(([on]) => !!on);
  return (
    <section className="card" aria-labelledby="cz-fields">
      <div className="card-head">
        <h2 id="cz-fields">Fields</h2>
        <span className="muted">{meta.fields.length}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Type</th>
              <th scope="col">Storage</th>
              <th scope="col">Properties</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {meta.fields.map((f) => (
              <tr key={f.name}>
                <td>
                  <div>{f.label}</div>
                  <div className="mono faint">{f.name}</div>
                </td>
                <td>
                  {f.type}
                  {f.to ? <span className="faint"> → {f.to}</span> : null}
                  {f.of ? <span className="faint"> of {f.of}</span> : null}
                  {f.options?.length ? <span className="faint"> ({f.options.length} options)</span> : null}
                </td>
                <td>{f.storage ? <Badge tone={f.storage === "ext" ? "purple" : "neutral"}>{f.storage}</Badge> : <span className="faint">child table</span>}</td>
                <td>
                  <div className="chips">
                    {flags(f).map(([, label, tone]) => (
                      <Badge key={label} tone={tone}>
                        {label}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="nowrap">
                  <Button size="sm" icon="edit" onClick={() => onEdit(f)} aria-label={`Edit properties of ${f.label}`}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.keys(meta.children).length > 0 && (
        <div className="card-body row">
          <span className="muted">Child tables:</span>
          {Object.entries(meta.children).map(([name, c]) => (
            <Link key={name} className="chip" to={`/customize/${c.entity}`}>
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function FormCard({ title, onSubmit, busy, submitLabel, children, error }: { title: string; onSubmit: () => Promise<void>; busy: boolean; submitLabel: string; children: ReactNode; error?: string | null }) {
  const id = title.toLowerCase().replace(/\W+/g, "-");
  return (
    <form
      className="card"
      aria-labelledby={id}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <div className="card-head">
        <h2 id={id}>{title}</h2>
      </div>
      <div className="card-body stack">
        {error && <Alert tone="error">{error}</Alert>}
        {children}
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
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
    if (!/^x_[a-z][a-z0-9_]*$/.test(f.name)) return setError("The name must start with x_ followed by lower-case letters, digits or underscores.");
    if (f.type === "link" && !f.to) return setError("Choose the entity this link points to.");
    const options = f.options.split("\n").map((s) => s.trim()).filter(Boolean);
    if (f.type === "select" && !options.length) return setError("Give at least one option.");
    const field: Record<string, unknown> = { name: f.name, label: f.label.trim() || undefined, type: f.type };
    if (f.type === "select") field.options = options;
    if (f.type === "link") field.to = f.to;
    if (f.description.trim()) field.description = f.description.trim();
    for (const k of ["required", "in_list", "in_filter"] as const) if (f[k]) field[k] = true;
    setBusy(true);
    setError(null);
    try {
      await apply({ op: "add_field", field, ...(f.after ? { after: f.after } : {}) }, f.note);
      toast(`Field ${f.name} added`);
      setF(empty);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormCard title="Add a custom field" onSubmit={submit} busy={busy} submitLabel="Add field" error={error}>
      <div className="form-grid">
        <FieldWrap label="Name" htmlFor="af-name" required hint="Must start with x_">
          <input id="af-name" className="input mono" value={f.name} onChange={(e) => set("name", e.target.value.toLowerCase())} required pattern="x_[a-z][a-z0-9_]*" />
        </FieldWrap>
        <FieldWrap label="Label" htmlFor="af-label">
          <input id="af-label" className="input" value={f.label} onChange={(e) => set("label", e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Type" htmlFor="af-type" required>
          <select id="af-type" className="select" value={f.type} onChange={(e) => set("type", e.target.value as FieldType)}>
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FieldWrap>
        <FieldWrap label="Insert after" htmlFor="af-after">
          <select id="af-after" className="select" value={f.after} onChange={(e) => set("after", e.target.value)}>
            <option value="">At the end</option>
            {meta.fields.map((x) => (
              <option key={x.name} value={x.name}>
                {x.label}
              </option>
            ))}
          </select>
        </FieldWrap>
        {f.type === "link" && (
          <FieldWrap label="Links to" htmlFor="af-to" required>
            <select id="af-to" className="select" value={f.to} onChange={(e) => set("to", e.target.value)} required>
              <option value="">Choose…</option>
              {(index?.entities ?? []).map((e) => (
                <option key={e.name} value={e.name}>
                  {e.label}
                </option>
              ))}
            </select>
          </FieldWrap>
        )}
        {f.type === "select" && (
          <FieldWrap label="Options" htmlFor="af-options" required hint="One per line" className="span-all">
            <textarea id="af-options" className="textarea" value={f.options} onChange={(e) => set("options", e.target.value)} />
          </FieldWrap>
        )}
        <FieldWrap label="Description" htmlFor="af-desc" className="span-all">
          <input id="af-desc" className="input" value={f.description} onChange={(e) => set("description", e.target.value)} />
        </FieldWrap>
      </div>
      <div className="row">
        {(["required", "in_list", "in_filter"] as const).map((k) => (
          <label key={k} className="check-field">
            <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />
            {k === "required" ? "Required" : k === "in_list" ? "Show in list" : "Filterable"}
          </label>
        ))}
      </div>
      <FieldWrap label="Note" htmlFor="af-note">
        <input id="af-note" className="input" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Why this change? (optional)" />
      </FieldWrap>
    </FormCard>
  );
}

function AddRuleCard({ meta }: { meta: EntityMeta }) {
  const apply = useApply(meta.name);
  const empty = { name: "", check: "", message: "", on: "save", note: "" };
  const [r, setR] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof empty, v: string) => setR((s) => ({ ...s, [k]: v }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apply({ op: "add_rule", rule: { name: r.name.trim(), check: r.check.trim(), message: r.message.trim(), on: r.on } }, r.note);
      toast(`Rule ${r.name} added`);
      setR(empty);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormCard title="Add a validation rule" onSubmit={submit} busy={busy} submitLabel="Add rule" error={error}>
      {meta.rules.length > 0 && (
        <div>
          <p className="field-label">Existing rules</p>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {meta.rules.map((x) => (
              <li key={x.name}>
                <span className="mono">{x.name}</span> <span className="faint">({x.on})</span>: {x.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <FieldWrap label="Name" htmlFor="ar-name" required>
        <input id="ar-name" className="input mono" value={r.name} onChange={(e) => set("name", e.target.value)} required placeholder="e.g. reference_required" />
      </FieldWrap>
      <FieldWrap label="Check (CEL, must be true)" htmlFor="ar-check" required hint="Variables: doc, old, user, today, now">
        <textarea id="ar-check" className="textarea mono" value={r.check} onChange={(e) => set("check", e.target.value)} required placeholder="e.g. doc.status != 'Closed' || doc.remarks != ''" />
      </FieldWrap>
      <FieldWrap label="Message" htmlFor="ar-message" required>
        <input id="ar-message" className="input" value={r.message} onChange={(e) => set("message", e.target.value)} required />
      </FieldWrap>
      <div className="form-grid">
        <FieldWrap label="Checked on" htmlFor="ar-on">
          <select id="ar-on" className="select" value={r.on} onChange={(e) => set("on", e.target.value)}>
            <option value="save">Save</option>
            <option value="submit">Submit</option>
          </select>
        </FieldWrap>
        <FieldWrap label="Note" htmlFor="ar-note">
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
      toast(`${field.label}: ${property} updated`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const expr = property.endsWith("_if") || property === "default_expr";
  return (
    <Dialog open={!!field} onClose={onClose} title={field ? `Edit ${field.label}` : ""}>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        <p className="muted">
          <span className="mono">{field?.name}</span> · {field?.type}
          {field?.locked ? " · locked: packages only allow tightening its rules" : ""}
        </p>
        <FieldWrap label="Property" htmlFor="pd-prop">
          <select id="pd-prop" className="select" value={property} onChange={(e) => pick(e.target.value)}>
            {PROPERTIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </FieldWrap>
        {BOOL_PROPS.has(property) ? (
          <label className="check-field">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {property}
          </label>
        ) : (
          <FieldWrap
            label="Value"
            htmlFor="pd-value"
            hint={expr ? "CEL over doc (and parent in child rows), e.g. doc.status == 'Paid'. Empty clears it." : "Empty clears it."}
          >
            {expr ? (
              <textarea id="pd-value" className="textarea mono" value={raw} onChange={(e) => setRaw(e.target.value)} />
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
        <FieldWrap label="Note" htmlFor="pd-note">
          <input id="pd-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </FieldWrap>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Apply
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
      return `Add field ${f?.name ?? "?"} (${f?.type ?? "?"})${op.after ? ` after ${String(op.after)}` : ""}`;
    }
    case "set_property":
      return `Set ${String(op.field)}.${String(op.property)} = ${JSON.stringify(op.value)}`;
    case "add_rule":
      return `Add rule ${name(op.rule)}`;
    case "add_options":
      return `Add options to ${String(op.field)}: ${Array.isArray(op.options) ? op.options.join(", ") : ""}`;
    case "set_entity_property":
      return `Set entity ${String(op.property)}`;
    case "define_entity":
      return `Define entity ${name(op.entity)}`;
    case "set_workflow":
      return `Set workflow ${name(op.workflow)}`;
    case "set_print_template":
      return "Replace print template";
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
      toast(c.is_active ? "Customization turned off" : "Customization turned on");
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
        <h2 id="cz-changes">Customizations</h2>
        <span className="spacer" />
        <label className="check-field" style={{ minHeight: 0 }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          All entities
        </label>
      </div>
      {q.isLoading ? (
        <PageLoading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <EmptyState title="No customizations yet" icon="edit" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                {all && <th scope="col">Entity</th>}
                <th scope="col">Change</th>
                <th scope="col">Note</th>
                <th scope="col">Created</th>
                <th scope="col">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="faint">{c.seq}</td>
                  {all && <td>{c.entity}</td>}
                  <td className="mono">{describeOp(c.op)}</td>
                  <td>{c.note}</td>
                  <td className="nowrap">{formatDateTime(c.created_at)}</td>
                  <td>
                    <label className="check-field" style={{ minHeight: 0 }}>
                      <input type="checkbox" checked={c.is_active} disabled={pending === c.id} onChange={() => void toggle(c)} />
                      <span className="sr-only">{c.is_active ? "Turn off" : "Turn on"} customization {c.seq}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
