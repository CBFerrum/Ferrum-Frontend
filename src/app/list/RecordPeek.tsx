// A record beside its list (`?peek=<id>`): read it, change a field where it stands, move on to the
// next row without losing the list. Each change is a PATCH against the version on screen, so the
// server refuses here exactly what it refuses in the full form; the form is one click away.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { api, docPath, errorMessage, isStale } from "../../lib/api";
import { evaluate } from "../../lib/expr";
import { formSections } from "../../lib/formTabs";
import { can, fieldState, recordTitle, useCurrencyPrecision, useMe, userScope, type Doc, type EntityMeta, type Field } from "../../lib/meta";
import { Badge, ErrorState, Icon, Spinner, statusTone, toast } from "../../ui/kit";
import { CollabPanel } from "../Collab";
import { CellValue, FieldControl } from "../widgets";
import { Related } from "./Related";

/** Field kinds edited in the full form: rows, files, long text, and values worked out elsewhere. */
const FORM_ONLY = new Set(["table", "attach", "image", "code", "json", "html", "markdown", "richtext", "secret"]);
/** Kinds where choosing is the whole edit; the others save when the person leaves the field. */
const SAVES_ON_CHANGE = new Set(["select", "link", "check", "date"]);

export function inlineEditable(f: Pick<Field, "type">): boolean {
  return !FORM_ONLY.has(f.type);
}

export function savesOnChange(f: Pick<Field, "type">): boolean {
  return SAVES_ON_CHANGE.has(f.type);
}

function EditValue({ field, doc, onDone, save }: { field: Field; doc: Doc; onDone: () => void; save: (value: unknown) => Promise<void> }) {
  const [value, setValue] = useState(doc[field.name]);
  const box = useRef<HTMLDivElement>(null);
  const finish = async (v: unknown) => {
    if (v !== doc[field.name]) await save(v);
    onDone();
  };
  useEffect(() => box.current?.querySelector<HTMLElement>("input,select,textarea")?.focus(), []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onDone();
    } else if (e.key === "Enter" && !(e.target as HTMLElement).matches("textarea")) {
      e.preventDefault();
      void finish(value);
    }
  };
  return (
    <div
      ref={box}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // Moving inside the control (a link's list of choices) is not leaving it.
        if (!savesOnChange(field) && !e.currentTarget.contains(e.relatedTarget)) void finish(value);
      }}
    >
      <FieldControl
        id={`peek-${field.name}`}
        field={field}
        value={value}
        title={doc._titles?.[field.name]}
        compact
        label={field.label}
        onChange={(v: unknown) => {
          setValue(v);
          if (savesOnChange(field)) void finish(v);
        }}
      />
    </div>
  );
}

function PeekField({ meta, field, doc, locked, user, precision, save }: {
  meta: EntityMeta;
  field: Field;
  doc: Doc;
  locked: boolean;
  user: unknown;
  precision?: number;
  save: (name: string, value: unknown) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const state = fieldState(field, { doc, user }, locked);
  if (!state.visible) return null;
  const empty = doc[field.name] === null || doc[field.name] === undefined || doc[field.name] === "";
  const cell = empty ? <span className="faint">—</span> : <CellValue field={field} value={doc[field.name]} title={doc._titles?.[field.name]} currencyPrecision={precision} />;
  const editable = !state.disabled && inlineEditable(field) && can(meta.permissions, "write");
  return (
    <div className="peek-row">
      <dt>{field.label}</dt>
      <dd>
        {editing ? (
          <EditValue field={field} doc={doc} onDone={() => setEditing(false)} save={(v) => save(field.name, v)} />
        ) : editable ? (
          <button type="button" className="peek-value" aria-label={`Change ${field.label}`} onClick={() => setEditing(true)}>
            {cell}
          </button>
        ) : (
          <span className="peek-value peek-readonly">{cell}</span>
        )}
      </dd>
    </div>
  );
}

/** A record, and a change to one of its fields against the version on screen. */
export function useRecord(meta: EntityMeta, id: string) {
  const E = meta.name;
  const qc = useQueryClient();
  const key = ["peek", E, id];
  const record = useQuery({ queryKey: key, queryFn: ({ signal }) => api.get<Doc>(docPath(E, id), { titles: true }, signal) });
  const save = async (name: string, value: unknown) => {
    try {
      const next = await api.patch<Doc>(docPath(E, id), { [name]: value }, { ifMatch: Number(record.data?.version) });
      qc.setQueryData(key, (old: Doc | undefined) => ({ ...next, _titles: { ...old?._titles, ...next._titles } }));
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["list", E] });
      void qc.invalidateQueries({ queryKey: ["view", E] });
    } catch (e) {
      // What was on screen is out of date: show what is true now rather than the failed edit.
      if (isStale(e)) {
        toast("Someone else changed this record; here it is as it stands now.", "error");
        void qc.invalidateQueries({ queryKey: key });
      } else toast(errorMessage(e), "error");
    }
  };
  return { record, save };
}

/** A record's sections (or just the named ones), each field changing where it stands. */
export function RecordFields({ meta, doc, save, only }: { meta: EntityMeta; doc: Doc; save: (name: string, value: unknown) => Promise<void>; only?: string[] }) {
  const me = useMe().data;
  const user = useMemo(() => userScope(me), [me]);
  const precisionOf = useCurrencyPrecision();
  const sections = useMemo(() => formSections(meta).sections, [meta]);
  const locked = (doc.docstatus ?? 0) !== 0;
  return (
    <>
      {sections
        .filter((s) => (!only || (s.label && only.includes(s.label))) && (!s.visibleIf || evaluate(s.visibleIf, { doc, user }) !== false))
        .map((s) => {
          const fields = s.fields.filter((f) => f.type !== "table");
          if (!fields.length) return null;
          return (
            <section key={s.key} className="peek-section">
              {s.label && <h3>{s.label}</h3>}
              <dl>
                {fields.map((f) => (
                  <PeekField
                    key={f.name}
                    meta={meta}
                    field={f}
                    doc={doc}
                    locked={locked}
                    user={user}
                    precision={f.type === "currency" && f.currency && !f.currency.includes(".") ? precisionOf(doc[f.currency]) : undefined}
                    save={save}
                  />
                ))}
              </dl>
            </section>
          );
        })}
    </>
  );
}

export function RecordPeek({ meta, id, onClose }: { meta: EntityMeta; id: string; onClose: () => void }) {
  const E = meta.name;
  const { record: q, save } = useRecord(meta, id);
  const [tab, setTab] = useState<"details" | "related" | "discussion">("details");
  const doc = q.data;
  const tabs = [["details", "Details"], ...(meta.linked_from?.length ? [["related", "Related"]] : []), ["discussion", "Discussion"]] as ["details" | "related" | "discussion", string][];
  return (
    <aside className="peek" aria-label={doc ? recordTitle(meta, doc) : `${meta.label} details`}>
      <header className="peek-head">
        <div className="peek-title">
          <h2>{doc ? recordTitle(meta, doc) : "…"}</h2>
          {typeof doc?.status === "string" && <Badge tone={statusTone(doc.status)}>{doc.status}</Badge>}
        </div>
        <Link className="icon-btn" to={`/e/${E}/${id}`} aria-label="Open the full record" title="Open the full record">
          <Icon name="expand" size={15} />
        </Link>
        <button type="button" className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </header>
      <div className="peek-tabs" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      <div className="peek-body">
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !doc ? (
          <Spinner label="Loading" />
        ) : tab === "discussion" ? (
          <CollabPanel entity={E} id={id} canWrite={can(meta.permissions, "write")} />
        ) : tab === "related" ? (
          <Related meta={meta} id={id} />
        ) : (
          <RecordFields meta={meta} doc={doc} save={save} />
        )}
      </div>
    </aside>
  );
}
