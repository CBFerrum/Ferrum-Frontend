import { useState, type FormEvent } from "react";
import { api, ApiError, errorMessage, type FieldError } from "../lib/api";
import type { ActionDef, ActionParam, Doc } from "../lib/meta";
import { Alert, Button, Dialog, Field } from "../ui/kit";

function initial(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

/** Asks for an action's parameters, prefilled from the record's fields of the same name, and runs it. */
export function ActionDialog({
  action,
  doc,
  path,
  onClose,
  onDone,
}: {
  action: ActionDef;
  doc: Doc;
  path: string;
  onClose: () => void;
  onDone: (result: unknown) => void;
}) {
  const params: ActionParam[] = action.params ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(params.map((p) => [p.name, initial(doc[p.name])])));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldError = (name: string) => errors.find((f) => f.field === name)?.message;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    setError(null);
    const body: Record<string, unknown> = {};
    for (const p of params) {
      const v = (values[p.name] ?? "").trim();
      if (v !== "") body[p.name] = p.type === "int" ? Number(v) : v;
    }
    try {
      onDone(await api.post<unknown>(path, body));
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) setErrors(err.fields);
      else setError(errorMessage(err));
      setBusy(false);
    }
  };

  const control = (p: ActionParam) => {
    const id = `action-${p.name}`;
    const set = (v: string) => setValues((cur) => ({ ...cur, [p.name]: v }));
    const value = values[p.name] ?? "";
    switch (p.type) {
      case "text":
        return <textarea id={id} className="textarea mono" rows={6} value={value} onChange={(e) => set(e.target.value)} required={p.required} />;
      case "select":
        return (
          <select id={id} className="select" value={value} onChange={(e) => set(e.target.value)} required={p.required}>
            <option value="">{p.required ? "Choose…" : "—"}</option>
            {(p.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case "int":
        return <input id={id} className="input" type="number" step={1} value={value} onChange={(e) => set(e.target.value)} required={p.required} />;
      case "date":
        return <input id={id} className="input" type="date" value={value} onChange={(e) => set(e.target.value)} required={p.required} />;
      default:
        return <input id={id} className="input" value={value} onChange={(e) => set(e.target.value)} required={p.required} />;
    }
  };

  return (
    <Dialog open onClose={onClose} title={action.label}>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        {params.map((p) => (
          <Field key={p.name} label={p.label} htmlFor={`action-${p.name}`} required={p.required} error={fieldError(p.name)} hint={p.description ?? undefined}>
            {control(p)}
          </Field>
        ))}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {action.label}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
