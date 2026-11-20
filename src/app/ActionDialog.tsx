import { useRef, useState, type FormEvent } from "react";
import { api, ApiError, errorMessage, type FieldError } from "../lib/api";
import type { ActionDef, ActionParam, Doc } from "../lib/meta";
import { Alert, Button, Dialog, Field } from "../ui/kit";
import { LinkInput } from "./widgets";
import { t, isolate } from "@ferrum/client";
import { blankCells, capOf, cellText, cellsFrom, encodeGroup, encodeScalar, isGroup, itemFields, missingIn, type ListState } from "../lib/actionParams";

/** One value of a declared type: the same controls whether it is a parameter, a field of a row or an item of a list. */
function ScalarControl({ f, id, value, set, label, required, mark, invalid }: { f: ActionParam; id: string; value: string; set: (v: string) => void; label?: string; required?: boolean; mark?: boolean; invalid?: boolean }) {
  const aria = { "aria-label": label, "aria-invalid": invalid || undefined, "aria-required": mark || undefined };
  switch (f.type) {
    case "text":
      return <textarea id={id} className="textarea mono" rows={6} value={value} onChange={(e) => set(e.target.value)} required={required} {...aria} />;
    case "select":
      return (
        <select id={id} className="select" value={value} onChange={(e) => set(e.target.value)} required={required} {...aria}>
          <option value="">{required ? t("Choose…") : "—"}</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {isolate(o)}
            </option>
          ))}
        </select>
      );
    case "int":
      return <input id={id} className="input" type="number" step={1} value={value} onChange={(e) => set(e.target.value)} required={required} {...aria} />;
    case "decimal":
      return <input id={id} className="input" inputMode="decimal" dir="ltr" value={value} onChange={(e) => set(e.target.value)} required={required} {...aria} />;
    case "date":
      return <input id={id} className="input" type="date" value={value} onChange={(e) => set(e.target.value)} required={required} {...aria} />;
    case "check":
      return <input id={id} type="checkbox" checked={value === "true"} onChange={(e) => set(e.target.checked ? "true" : "false")} {...aria} />;
    case "link":
      return <LinkInput to={f.to ?? ""} id={id} value={value || null} required={required} label={label} onChange={(v) => set(v ?? "")} />;
    default:
      return <input id={id} className="input" value={value} onChange={(e) => set(e.target.value)} required={required} {...aria} />;
  }
}

/** The fields of one list item or of a row parameter, each with its label and a mark when required. */
function Cells({ p, idBase, cells, set, errors }: { p: ActionParam; idBase: string; cells: Record<string, string>; set: (name: string, v: string) => void; errors: Record<string, string> }) {
  return (
    <>
      {itemFields(p).map((f) => (
        <Field key={f.name} label={isolate(f.label)} htmlFor={`${idBase}-${f.name}`} required={f.required} error={errors[f.name]} hint={isolate(f.description ?? undefined)}>
          <ScalarControl f={f} id={`${idBase}-${f.name}`} value={cells[f.name] ?? ""} set={(v) => set(f.name, v)} mark={f.required} invalid={!!errors[f.name]} />
        </Field>
      ))}
    </>
  );
}

/** A list: rows of the declared fields (or one control for each value), add and remove, up to the cap. */
function ListEditor({ p, state, setState, next, errors }: { p: ActionParam; state: ListState; setState: (s: ListState) => void; next: () => number; errors: Record<string, string> }) {
  const add = useRef<HTMLDivElement>(null);
  const cap = capOf(p);
  const full = state.items.length >= cap;
  const oneValue = !p.fields?.length;
  const edit = (key: number, name: string, v: string) => setState({ ...state, items: state.items.map((i) => (i.key === key ? { ...i, cells: { ...i.cells, [name]: v } } : i)) });
  return (
    <fieldset className="stack param-group" aria-describedby={errors[p.name] ? `action-${p.name}-err` : undefined}>
      <legend className="field-label">
        {isolate(p.label)}
        {p.required && (
          <span className="req" aria-hidden="true">
            *
          </span>
        )}
      </legend>
      {p.description && <p className="faint">{isolate(p.description)}</p>}
      {state.items.map((i, n) => (
        <div key={i.key} className="param-item" role="group" aria-label={t("{label} {n}", { label: p.label, n: n + 1 })}>
          <div className="stack param-cells">
            {oneValue ? (
              <ScalarControl f={itemFields(p)[0]} id={`action-${p.name}-${i.key}`} value={i.cells.value ?? ""} set={(v) => edit(i.key, "value", v)} label={t("{label} {n}", { label: p.label, n: n + 1 })} />
            ) : (
              <Cells p={p} idBase={`action-${p.name}-${i.key}`} cells={i.cells} set={(name, v) => edit(i.key, name, v)} errors={Object.fromEntries(itemFields(p).map((f) => [f.name, errors[`${p.name}.${i.key}.${f.name}`]]).filter(([, m]) => m))} />
            )}
          </div>
          <Button
            size="sm"
            icon="trash"
            aria-label={t("Remove {label} {n}", { label: p.label, n: n + 1 })}
            onClick={() => {
              setState({ items: state.items.filter((x) => x.key !== i.key), edited: true });
              add.current?.querySelector("button")?.focus();
            }}
          />
        </div>
      ))}
      {errors[p.name] && (
        <p id={`action-${p.name}-err`} className="field-error" role="alert">
          {errors[p.name]}
        </p>
      )}
      <div ref={add}>
        <Button size="sm" icon="plus" disabled={full} onClick={() => setState({ items: [...state.items, { key: next(), cells: blankCells(p) }], edited: true })}>
          {t("Add")}
        </Button>
      </div>
      {full && <p className="faint" role="status">{t("At most {max} items.", { max: cap })}</p>}
    </fieldset>
  );
}

/** A refusal's field errors split: those on the dialog's own parameters, shown beside them, and the
 * rest (another record's rows the action made, such as a delivery note's warehouse) as words, which
 * would otherwise show nowhere. */
export function splitErrors(fields: FieldError[], params: ActionParam[]): { own: FieldError[]; others: string } {
  const mine = (f: FieldError) => !f.row && params.some((p) => p.name === f.field);
  const others = fields.filter((f) => !mine(f)).map((f) => (f.row ? t("row {value} ", { value: f.row[1] + 1 }) : "") + `${f.field}: ${f.message}`);
  return { own: fields.filter(mine), others: others.join("; ") };
}

/** Asks for an action's parameters, prefilled from the record's fields of the same name, and runs it.
 * An action that asks to be confirmed says so here too, so it is one dialog, not two. */
export function ActionDialog({
  action,
  doc,
  path,
  ifMatch,
  onClose,
  onDone,
}: {
  action: ActionDef;
  doc: Doc;
  path: string;
  /** The version the record is at, for a workflow transition. */
  ifMatch?: number;
  onClose: () => void;
  onDone: (result: unknown) => void;
}) {
  const params: ActionParam[] = action.params ?? [];
  const keys = useRef(0);
  const next = () => ++keys.current;
  // Single values as typed; a list's items, and a row's cells, each in its own place.
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(params.filter((p) => !isGroup(p)).map((p) => [p.name, cellText(doc[p.name])])));
  const [lists, setLists] = useState<Record<string, ListState>>(() =>
    Object.fromEntries(
      params
        .filter((p) => p.type === "list")
        .map((p) => {
          const v = doc[p.name];
          return [p.name, { edited: false, items: Array.isArray(v) ? v.map((x) => ({ key: next(), cells: cellsFrom(p, x) })) : [] }];
        }),
    ),
  );
  const [rows, setRows] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(params.filter((p) => p.type === "row").map((p) => [p.name, cellsFrom(p, doc[p.name])])));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [missing, setMissing] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldError = (name: string) => errors.find((f) => f.field === name)?.message ?? missing[name];
  const state = (p: ActionParam) => (p.type === "list" ? lists[p.name] : rows[p.name]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // What it needs is said on the field before anything is sent.
    const lacking: Record<string, string> = {};
    for (const p of params) {
      if (isGroup(p)) Object.assign(lacking, missingIn(p, state(p)));
      else if (p.required && !(values[p.name] ?? "").trim()) lacking[p.name] = t("is needed");
    }
    setMissing(lacking);
    if (Object.keys(lacking).length) {
      setErrors([]);
      return;
    }
    setBusy(true);
    setErrors([]);
    const body: Record<string, unknown> = {};
    for (const p of params) {
      const v = isGroup(p) ? encodeGroup(p, state(p)) : encodeScalar(p, values[p.name] ?? "");
      if (v !== undefined) body[p.name] = v;
    }
    try {
      onDone(await api.post<unknown>(path, body, ifMatch === undefined ? undefined : { ifMatch }));
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) {
        const { own, others } = splitErrors(err.fields, params);
        setErrors(own);
        if (others) setError(others);
      } else setError(errorMessage(err));
      setBusy(false);
    }
  };

  const group = (p: ActionParam) =>
    p.type === "list" ? (
      <ListEditor key={p.name} p={p} state={lists[p.name]} setState={(s) => setLists((cur) => ({ ...cur, [p.name]: s }))} next={next} errors={missing} />
    ) : (
      <fieldset key={p.name} className="stack param-group">
        <legend className="field-label">
          {isolate(p.label)}
          {p.required && (
            <span className="req" aria-hidden="true">
              *
            </span>
          )}
        </legend>
        {p.description && <p className="faint">{isolate(p.description)}</p>}
        {missing[p.name] && <p className="field-error" role="alert">{missing[p.name]}</p>}
        <Cells
          p={p}
          idBase={`action-${p.name}`}
          cells={rows[p.name]}
          set={(name, v) => setRows((cur) => ({ ...cur, [p.name]: { ...cur[p.name], [name]: v } }))}
          errors={Object.fromEntries(itemFields(p).map((f) => [f.name, missing[`${p.name}.${f.name}`]]).filter(([, m]) => m))}
        />
      </fieldset>
    );

  return (
    <Dialog open onClose={onClose} title={isolate(action.label)}>
      <form className="stack" onSubmit={submit}>
        {action.confirm && <p className="muted">{isolate(action.confirm)}</p>}
        {error && <Alert tone="error">{isolate(error)}</Alert>}
        {params.map((p) =>
          isGroup(p) ? (
            group(p)
          ) : (
            <Field key={p.name} label={isolate(p.label)} htmlFor={`action-${p.name}`} required={p.required} error={fieldError(p.name)} hint={isolate(p.description ?? undefined)}>
              <ScalarControl f={p} id={`action-${p.name}`} value={values[p.name] ?? ""} set={(v) => setValues((cur) => ({ ...cur, [p.name]: v }))} required={p.required} />
            </Field>
          ),
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {isolate(action.label)}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
