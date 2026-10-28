// Field widgets driven by field metadata: one control per field type, the link autocomplete,
// the editable child-table grid, attachments and read-only cell rendering.

import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { Link } from "react-router";
import { api, docPath, download, errorMessage, newKey, type FieldError } from "../lib/api";
import { formatValue, humanize, NUMERIC_TYPES, shortId } from "../lib/format";
import {
  DOCSTATUS_LABEL,
  fieldState,
  recordTitle,
  useEntityMeta,
  type ChildTable,
  type Doc,
  type Field,
  type ListResponse,
} from "../lib/meta";
import { Badge, Button, Dialog, Field as FieldWrap, Icon, Spinner, statusTone, toast, useDebounced, useDismiss } from "../ui/kit";

export interface ControlProps {
  field: Field;
  value: unknown;
  onChange: (value: unknown, title?: string) => void;
  id: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Known display title of a link value. */
  title?: string;
  currencyPrecision?: number;
  /** Rendered inside a grid cell: no visible label, so `label` becomes the accessible name. */
  compact?: boolean;
  label?: string;
  /** Owning record, for attachment uploads. */
  entity?: string;
  recordId?: string;
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const orNull = (s: string) => (s === "" ? null : s);

export function FieldControl(p: ControlProps) {
  const { field: f, value, onChange, disabled } = p;
  const common = {
    id: p.id,
    disabled,
    required: p.required,
    "aria-invalid": p.invalid || undefined,
    "aria-describedby": p.describedBy,
    "aria-label": p.compact ? p.label : undefined,
  };
  switch (f.type) {
    case "check":
      return <input type="checkbox" {...common} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "select": {
      const options = f.options ?? [];
      const v = text(value);
      return (
        <select className="select" {...common} value={v} onChange={(e) => onChange(orNull(e.target.value))}>
          <option value="">{disabled ? "" : "—"}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {v && !options.includes(v) && <option value={v}>{v}</option>}
        </select>
      );
    }
    case "link":
      return (
        <LinkInput
          to={f.to ?? ""}
          value={typeof value === "string" ? value : null}
          title={p.title}
          onChange={onChange}
          linkFilters={f.link_filters}
          id={p.id}
          disabled={disabled}
          invalid={p.invalid}
          describedBy={p.describedBy}
          label={p.compact ? p.label : undefined}
          required={p.required}
        />
      );
    case "date":
      return <input type="date" className="input" {...common} value={text(value)} onChange={(e) => onChange(orNull(e.target.value))} />;
    case "datetime":
      return <input type="datetime-local" className="input" {...common} value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} />;
    case "int":
      return (
        <input
          className="input num"
          inputMode="numeric"
          autoComplete="off"
          {...common}
          value={text(value)}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange(v === "" ? null : /^-?\d{1,15}$/.test(v) ? Number(v) : v);
          }}
        />
      );
    case "decimal":
    case "currency":
    case "percent":
      if (disabled) return <input className="input num" {...common} value={formatValue(f, value, { currencyPrecision: p.currencyPrecision })} readOnly />;
      return (
        <input
          className="input num"
          inputMode="decimal"
          autoComplete="off"
          {...common}
          value={text(value)}
          onChange={(e) => onChange(orNull(e.target.value.trim()))}
        />
      );
    case "text":
    case "markdown":
    case "code":
      return (
        <textarea
          className={`textarea ${f.type === "code" ? "mono" : ""}`}
          {...common}
          rows={p.compact ? 1 : f.type === "code" ? 6 : 3}
          maxLength={f.max_length}
          spellCheck={f.type !== "code"}
          value={text(value)}
          onChange={(e) => onChange(orNull(e.target.value))}
        />
      );
    case "json":
      return <JsonInput {...p} />;
    case "attach":
      return <AttachInput {...p} />;
    case "color": {
      const v = text(value);
      return (
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input
            type="color"
            aria-label={`${f.label} colour picker`}
            disabled={disabled}
            value={/^#[0-9a-f]{6}$/i.test(v) ? v : "#000000"}
            onChange={(e) => onChange(e.target.value)}
          />
          <input className="input" {...common} placeholder="#rrggbb" value={v} onChange={(e) => onChange(orNull(e.target.value.trim()))} />
        </div>
      );
    }
    case "secret":
      return <SecretInput {...p} />;
    case "table":
      return null; // rendered by TableGrid
    default: {
      const type = f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "url" ? "url" : "text";
      return <input className="input" type={type} {...common} maxLength={f.max_length} value={text(value)} onChange={(e) => onChange(orNull(e.target.value))} />;
    }
  }
}

/** RFC 3339 (UTC) ↔ the browser's local `datetime-local` value. */
function toLocalInput(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── link autocomplete ──

/**
 * Viewport-fixed placement under (or above) `anchor`, so the dropdown is never clipped by a
 * scrolling grid or dialog body. Follows scrolling and resizing while open.
 */
function useAnchoredStyle(anchor: RefObject<HTMLElement | null>, open: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(Math.max(r.width, 240), window.innerWidth - 16);
      const below = window.innerHeight - r.bottom;
      const above = below < 240 && r.top > below;
      setStyle({
        position: "fixed",
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        right: "auto",
        width,
        ...(above ? { top: "auto", bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4, bottom: "auto" }),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, open]);
  return open ? style : undefined;
}

/** Title of a linked record: the known title, else fetched once (cached) from the record. */
export function useLinkTitle(to: string, id: string | null | undefined, known?: string): string | undefined {
  const target = useEntityMeta(to || undefined);
  const q = useQuery({
    queryKey: ["record-title", to, id],
    queryFn: ({ signal }) => api.get<Doc>(docPath(to, id ?? ""), { titles: false }, signal),
    enabled: !!to && !!id && !known,
    staleTime: 10 * 60_000,
    retry: false,
  });
  if (!id) return undefined;
  if (known) return known;
  if (q.data) return recordTitle(target.data, q.data);
  return q.isError ? shortId(id) : undefined;
}

export function LinkTitle({ to, id, title }: { to: string; id: string; title?: string }) {
  const t = useLinkTitle(to, id, title);
  return <Link to={`/e/${to}/${id}`}>{t ?? "…"}</Link>;
}

export function LinkInput({
  to,
  value,
  title,
  onChange,
  linkFilters,
  id,
  disabled,
  invalid,
  describedBy,
  label,
  required,
  placeholder,
}: {
  to: string;
  value: string | null;
  title?: string;
  onChange: (id: string | null, title?: string) => void;
  linkFilters?: Record<string, unknown>;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const target = useEntityMeta(to || undefined);
  const resolved = useLinkTitle(to, value, title);
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const listStyle = useAnchoredStyle(input, open);
  const q = useDebounced(typed ?? "", 250);
  const titleField = target.data?.title_field;
  const filters = linkFilters && Object.keys(linkFilters).length ? JSON.stringify(linkFilters) : undefined;
  const results = useQuery({
    queryKey: ["link-search", to, q.trim(), filters],
    queryFn: ({ signal }) =>
      api.get<ListResponse>(
        docPath(to),
        { search: q.trim() || undefined, limit: 10, filters, fields: ["id", "number", ...(titleField ? [titleField] : [])].join(",") },
        signal,
      ),
    enabled: open && !disabled && !!to && !target.isLoading,
    staleTime: 30_000,
  });
  const rows = results.data?.rows ?? [];
  const close = () => {
    setOpen(false);
    setTyped(null);
  };
  useDismiss(wrap, open, close);

  const choose = (row: Doc | undefined) => {
    if (!row?.id) return;
    onChange(row.id, recordTitle(target.data, row));
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const n = rows.length || 1;
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      choose(rows[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation(); // keep an enclosing dialog open
      close();
    } else if (e.key === "Tab") close();
  };

  const name = target.data?.label ?? humanize(to);
  return (
    <div className="combo" ref={wrap}>
      <input
        ref={input}
        id={id}
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-label={label}
        aria-required={required || undefined}
        disabled={disabled}
        autoComplete="off"
        placeholder={disabled ? "" : (placeholder ?? `Search ${name}…`)}
        value={typed ?? resolved ?? (value ? "…" : "")}
        onChange={(e) => {
          setTyped(e.target.value);
          setOpen(true);
          setActive(0);
          if (e.target.value === "" && value) onChange(null, "");
        }}
        onClick={() => !disabled && setOpen(true)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onKeyDown}
      />
      {/* Out of the tab order while editable so Tab moves field to field (clear = select + Delete). */}
      <span className="combo-actions">
        {value && !disabled && (
          <button type="button" tabIndex={-1} className="icon-btn icon-btn-sm" aria-label={`Clear ${label ?? name}`} onClick={() => onChange(null, "")}>
            <Icon name="x" size={14} />
          </button>
        )}
        {value && (
          <Link
            className="icon-btn icon-btn-sm"
            tabIndex={disabled ? undefined : -1}
            to={`/e/${to}/${value}`}
            aria-label={`Open ${resolved ?? name}`}
            title={`Open ${name}`}
          >
            <Icon name="external" size={14} />
          </Link>
        )}
      </span>
      {open && (
        <ul className="listbox" role="listbox" id={listId} aria-label={`${name} matches`} style={listStyle}>
          {results.isLoading || target.isLoading ? (
            <li className="option-empty" role="presentation">
              Searching…
            </li>
          ) : results.error ? (
            <li className="option-empty" role="presentation">
              {errorMessage(results.error)}
            </li>
          ) : !rows.length ? (
            <li className="option-empty" role="presentation">
              No matches
            </li>
          ) : (
            rows.map((r, i) => {
              const t = recordTitle(target.data, r);
              return (
                <li
                  key={r.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(r);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span>{t}</span>
                  {r.number && r.number !== t ? <small>{String(r.number)}</small> : null}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

// ── attachments ──

function AttachInput({ value, onChange, id, disabled, invalid, entity, recordId }: ControlProps) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const v = typeof value === "string" ? value : "";

  const upload = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) return toast("Files must be 25 MB or smaller.", "error");
    const fd = new FormData();
    fd.append("file", file);
    if (entity) fd.append("entity", entity);
    if (recordId) fd.append("record_id", recordId);
    setBusy(true);
    try {
      const r = await api.post<{ url: string; file_name: string }>("/api/files", fd);
      setName(r.file_name);
      onChange(r.url);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (v) {
    return (
      <div className="row" style={{ flexWrap: "nowrap", minHeight: 34 }}>
        {v.startsWith("/files/") ? (
          <button type="button" className="link-btn row" onClick={() => download(v, name ?? "attachment").catch((e) => toast(errorMessage(e), "error"))}>
            <Icon name="download" />
            {name ?? "Download file"}
          </button>
        ) : (
          <a href={v} target="_blank" rel="noopener noreferrer">
            {v}
          </a>
        )}
        {!disabled && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="row" style={{ minHeight: 34 }}>
      <input
        type="file"
        id={id}
        disabled={disabled || busy}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      {busy && <Spinner small label="Uploading" />}
    </div>
  );
}

// ── JSON ──

function JsonInput({ value, onChange, id, disabled, invalid, describedBy, compact, label }: ControlProps) {
  const pretty = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v, null, 2));
  const [draft, setDraft] = useState(() => pretty(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Follow outside changes (calc, reload) unless the draft already says the same thing.
    setDraft((d) => {
      try {
        if (JSON.stringify(d.trim() ? JSON.parse(d) : null) === JSON.stringify(value ?? null)) return d;
      } catch {
        // invalid draft: replace it
      }
      return pretty(value);
    });
  }, [value]);
  if (disabled) return <pre className="code" id={id} aria-label={label}>{pretty(value) || "—"}</pre>;
  return (
    <>
      <textarea
        id={id}
        className="textarea mono"
        rows={compact ? 1 : 5}
        aria-invalid={invalid || !!error || undefined}
        aria-describedby={describedBy}
        aria-label={compact ? label : undefined}
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          try {
            onChange(draft.trim() ? JSON.parse(draft) : null);
            setError(null);
          } catch {
            setError("Not valid JSON");
          }
        }}
      />
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

// ── read-only cells (lists, reports) ──

export function CellValue({
  field,
  value,
  title,
  currencyPrecision,
}: {
  field: Pick<Field, "name" | "type"> & Partial<Field>;
  value: unknown;
  title?: string;
  currencyPrecision?: number;
}) {
  if (value === null || value === undefined || value === "") return null;
  if (field.name === "docstatus" && typeof value === "number") {
    const label = DOCSTATUS_LABEL[value] ?? String(value);
    return <Badge tone={statusTone(label)}>{label}</Badge>;
  }
  if (field.name === "status" || field.name === "workflow_state") return <Badge tone={statusTone(value)}>{String(value)}</Badge>;
  switch (field.type) {
    case "link":
      return <>{title ?? shortId(value)}</>;
    case "check":
      return value === true ? (
        <>
          <Icon name="check" />
          <span className="sr-only">Yes</span>
        </>
      ) : (
        <span className="sr-only">No</span>
      );
    default:
      return <>{formatValue(field as Field, value, { currencyPrecision })}</>;
  }
}

// ── child table grid ──

export function rowKey(r: Doc, i: number): string {
  return String(r.id ?? r._key ?? i);
}

export function withValue(r: Doc, name: string, value: unknown, title?: string): Doc {
  const next: Doc = { ...r, [name]: value };
  if (title !== undefined) next._titles = { ...r._titles, [name]: title };
  return next;
}

function newRow(fields: Field[]): Doc {
  const row: Doc = { _key: newKey() };
  for (const f of fields) if (f.default !== undefined && f.type !== "table") row[f.name] = f.default;
  return row;
}

export function TableGrid({
  child,
  rows,
  onChange,
  locked,
  errors,
  parent,
  user,
  precisionOf,
  entity,
  recordId,
}: {
  child: ChildTable;
  rows: Doc[];
  /** `cell` names the edited cell so its error can be cleared; structural edits omit it. */
  onChange: (rows: Doc[], cell?: { row: number; field: string }) => void;
  locked: boolean;
  errors: FieldError[];
  parent: Doc;
  user: unknown;
  precisionOf: (f: Field, row: Doc) => number | undefined;
  entity: string;
  recordId?: string;
}) {
  const gridId = useId();
  const [editing, setEditing] = useState<number | null>(null);
  const visible = child.fields.filter((f) => f.can_read === true && !f.hidden && f.type !== "table");
  const listed = visible.filter((f) => f.in_list);
  const cols = listed.length ? listed : visible.slice(0, 5);
  const cellId = (i: number, f: string) => `${gridId}-${i}-${f}`;
  // Focus moves after the re-render that creates/moves the row (not rAF: paused in background tabs).
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });
  const focusCell = (i: number, f?: string) => {
    pendingFocus.current = cellId(i, f ?? cols[0]?.name ?? "");
  };

  const update = (i: number, name: string, value: unknown, title?: string) =>
    onChange(
      rows.map((r, j) => (j === i ? withValue(r, name, value, title) : r)),
      { row: i, field: name },
    );
  const add = (at = rows.length) => {
    const next = [...rows];
    next.splice(at, 0, newRow(child.fields));
    onChange(next);
    focusCell(at);
  };
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const move = (i: number, d: number, focusField?: string) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    if (focusField) focusCell(j, focusField);
  };
  const onRowKey = (i: number) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (locked) return;
    const field = (e.target as HTMLElement).id?.slice(`${gridId}-${i}-`.length) || undefined;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(i, e.key === "ArrowUp" ? -1 : 1, field);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      add(i + 1);
    }
  };
  const labelOf = (name: string) => child.fields.find((f) => f.name === name)?.label ?? humanize(name);

  return (
    <div>
      <div className="grid-wrap">
        <table className="grid" aria-label={child.label}>
          <thead>
            <tr>
              <th className="grid-idx" scope="col">
                #
              </th>
              {cols.map((f) => (
                <th key={f.name} scope="col" className={NUMERIC_TYPES.has(f.type) ? "num" : undefined}>
                  {f.label}
                  {f.required && (
                    <span className="req" aria-hidden="true">
                      *
                    </span>
                  )}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const errs = errors.filter((e) => e.row?.[1] === i);
              const other = errs.filter((e) => !cols.some((c) => c.name === e.field));
              const scope = { doc: r, parent, user };
              return (
                <Fragment key={rowKey(r, i)}>
                  <tr onKeyDown={onRowKey(i)}>
                    <td className="grid-idx">{i + 1}</td>
                    {cols.map((f) => {
                      const st = fieldState(f, scope, locked);
                      const err = errs.find((e) => e.field === f.name);
                      return (
                        <td key={f.name}>
                          {st.visible ? (
                            <>
                              <FieldControl
                                field={f}
                                id={cellId(i, f.name)}
                                compact
                                label={`${f.label}, row ${i + 1}`}
                                value={r[f.name]}
                                title={r._titles?.[f.name]}
                                disabled={st.disabled}
                                required={st.required}
                                invalid={!!err}
                                currencyPrecision={precisionOf(f, r)}
                                entity={entity}
                                recordId={recordId}
                                onChange={(v, t) => update(i, f.name, v, t)}
                              />
                              {err && <div className="cell-error">{err.message}</div>}
                            </>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="grid-actions">
                      <button type="button" className="icon-btn icon-btn-sm" aria-label={`Show all fields of row ${i + 1}`} title="All fields" onClick={() => setEditing(i)}>
                        <Icon name="expand" size={14} />
                      </button>
                      {!locked && (
                        <>
                          <button type="button" className="icon-btn icon-btn-sm" aria-label={`Move row ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                            <Icon name="up" size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn-sm"
                            aria-label={`Move row ${i + 1} down`}
                            disabled={i === rows.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            <Icon name="down" size={14} />
                          </button>
                          <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove row ${i + 1}`} onClick={() => remove(i)}>
                            <Icon name="trash" size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {other.length > 0 && (
                    <tr className="row-errors">
                      <td colSpan={cols.length + 2}>
                        Row {i + 1}: {other.map((e) => `${labelOf(e.field)} ${e.message}`).join(" · ")}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={cols.length + 2} className="grid-empty">
                  No rows yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!locked && (
        <div className="grid-foot">
          <Button size="sm" icon="plus" onClick={() => add()}>
            Add row
          </Button>
          <span className="field-hint">Alt+↑/↓ moves a row · Ctrl+Enter inserts a row below</span>
        </div>
      )}
      <Dialog
        open={editing !== null && !!rows[editing]}
        onClose={() => setEditing(null)}
        title={`${child.label} — row ${(editing ?? 0) + 1}`}
        wide
        footer={
          <Button variant="primary" onClick={() => setEditing(null)}>
            Done
          </Button>
        }
      >
        {editing !== null && rows[editing] && (
          <div className="form-grid">
            {visible.map((f) => {
              const r = rows[editing];
              const st = fieldState(f, { doc: r, parent, user }, locked);
              if (!st.visible) return null;
              const err = errors.find((e) => e.row?.[1] === editing && e.field === f.name);
              const fid = `${gridId}-dlg-${f.name}`;
              const control = (
                <FieldControl
                  field={f}
                  id={fid}
                  value={r[f.name]}
                  title={r._titles?.[f.name]}
                  disabled={st.disabled}
                  required={st.required}
                  invalid={!!err}
                  currencyPrecision={precisionOf(f, r)}
                  entity={entity}
                  recordId={recordId}
                  onChange={(v, t) => update(editing, f.name, v, t)}
                />
              );
              return f.type === "check" ? (
                <div key={f.name} className="field">
                  <div className="check-field">
                    {control}
                    <label htmlFor={fid}>{f.label}</label>
                  </div>
                  {err && <p className="field-error">{err.message}</p>}
                </div>
              ) : (
                <FieldWrap key={f.name} label={f.label} htmlFor={fid} required={st.required} error={err?.message} hint={f.description}>
                  {control}
                </FieldWrap>
              );
            })}
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** Write-only secrets: the server only says whether one is set (`true`). Text sets it, `null`
 *  removes it, and leaving it alone keeps it. */
function SecretInput({ field: f, value, onChange, disabled, id, invalid, describedBy }: ControlProps) {
  const [editing, setEditing] = useState(false);
  if (value === true && !editing) {
    return (
      <div className="row" style={{ flexWrap: "nowrap", minHeight: 34 }}>
        <span className="mono faint" aria-label={`${f.label} is set`}>
          ••••••••
        </span>
        <Badge tone="green">Saved</Badge>
        {!disabled && (
          <>
            <button type="button" className="link-btn" onClick={() => setEditing(true)}>
              Replace
            </button>
            <button type="button" className="link-btn danger" onClick={() => onChange(null)}>
              Remove
            </button>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="row" style={{ flexWrap: "nowrap" }}>
      <input
        id={id}
        className="input"
        type="password"
        autoComplete="new-password"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={value === null && !editing ? "Not set" : "Enter a new value"}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? (editing ? true : null) : e.target.value)}
      />
      {editing && (
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setEditing(false);
            onChange(true);
          }}
        >
          Keep current
        </button>
      )}
    </div>
  );
}
