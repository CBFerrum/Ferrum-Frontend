// Bulk actions on the list's selection: the bar shown while rows are selected (it can extend the
// selection to every record the filter matches, up to 500), the dialogs that ask what to do (set a
// field, assign, tags), and the run itself: `POST /api/v1/{E}/_bulk`, 500 records per request, each
// record in its own transaction. Failures are listed record by record, stay selected and can be
// retried.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, docPath, errorMessage } from "../../lib/api";
import { shortId } from "../../lib/format";
import { recordTitle, type Doc, type EntityMeta, type Field, type ListResponse, type Me } from "../../lib/meta";
import { Alert, Button, confirmDialog, Dialog, Field as FieldWrap, Icon, Spinner, toast } from "../../ui/kit";
import { usePeople } from "../Collab";
import { FieldControl } from "../widgets";
import { bulkActions, chunk, countOf, describeOp, MAX_BULK, mergeResults, parseTags, retryIds, rowErrorText, type BulkOp, type BulkResponse } from "./bulk";

/** A row's checkbox (or the header's); `onToggle(range)` gets whether Shift was held. */
export function SelectBox({
  id,
  label,
  checked,
  indeterminate,
  disabled,
  onToggle,
}: {
  id?: string;
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onToggle: (range: boolean) => void;
}) {
  return (
    // A 44px target on touch screens (.cell-check); Shift+click must not select text.
    <label className="cell-check" onMouseDown={(e) => e.shiftKey && e.preventDefault()}>
      <input
        id={id}
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        onChange={(e) => onToggle((e.nativeEvent as MouseEvent).shiftKey === true)}
      />
    </label>
  );
}


interface Run {
  op: BulkOp;
  ids: string[];
  /** Records sent so far. */
  sent: number;
  /** Set when the run has ended. */
  result?: BulkResponse;
  /** A request that failed as a whole (the records it carried, and later ones, were not attempted). */
  error?: unknown;
}

export function BulkBar({
  meta,
  me,
  selected,
  rows,
  total,
  hasMore,
  filters,
  q,
  sort,
  onSelect,
}: {
  meta: EntityMeta;
  me: Me | undefined;
  selected: ReadonlySet<string>;
  /** The rows loaded, in list order. */
  rows: Doc[];
  /** How many records the list's query matches, when counted. */
  total?: number | null;
  hasMore: boolean;
  /** The list's query, to select everything it matches. */
  filters?: string;
  q: string;
  sort: string;
  onSelect: (ids: Set<string>) => void;
}) {
  const E = meta.name;
  const qc = useQueryClient();
  const actions = bulkActions(meta, me);
  const [dialog, setDialog] = useState<"edit" | "assign" | "tags" | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  // The run's window can be closed while it works; its results then stay a click away.
  const [runOpen, setRunOpen] = useState(false);
  const runOpenRef = useRef(false);
  const showRun = (open: boolean) => {
    runOpenRef.current = open;
    setRunOpen(open);
  };
  const [matching, setMatching] = useState<string[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  const n = selected.size;
  const what = countOf(meta, n);
  const pageIds = rows.map((r) => String(r.id));
  const pageAll = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const allMatching = !!matching && matching.length === n && matching.every((id) => selected.has(id));
  const beyond = total != null ? total > pageIds.length : hasMore;
  const titles = new Map(rows.map((r) => [String(r.id), recordTitle(meta, r)]));

  const clear = () => onSelect(new Set());
  // The bar goes away with the selection, and focus with its buttons (or its open window): back to the list.
  useEffect(
    () => () => {
      if (document.activeElement === document.body || !document.activeElement)
        document.querySelector<HTMLElement>("#list-select-all:not(:disabled), .list-table tbody input[type=checkbox]")?.focus();
    },
    [],
  );

  const selectMatching = async () => {
    setSelecting(true);
    try {
      const res = await api.get<ListResponse>(docPath(E), { fields: "id", sort, limit: MAX_BULK, search: q || undefined, filters });
      const ids = res.rows.map((r) => String(r.id));
      setMatching(ids);
      onSelect(new Set(ids));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSelecting(false);
    }
  };

  const execute = async (op: BulkOp, ids: string[]) => {
    setDialog(null);
    setRun({ op, ids, sent: 0 });
    showRun(true);
    const parts: BulkResponse[] = [];
    let error: unknown;
    for (const part of chunk(ids)) {
      try {
        parts.push(await api.post<BulkResponse>(docPath(E, "_bulk"), { ids: part, ...op }));
      } catch (e) {
        error = e;
        break;
      }
      setRun((r) => r && { ...r, sent: r.sent + part.length });
    }
    const result = mergeResults(parts);
    for (const key of ["list", "view", "collab", "tags"]) void qc.invalidateQueries({ queryKey: [key, E] });
    const left = retryIds(ids, result);
    if (!error && !left.length) {
      toast(describeOp(op).done(countOf(meta, result.succeeded)));
      setRun(null);
      showRun(false);
      clear();
      return;
    }
    if (!runOpenRef.current) toast(`${countOf(meta, left.length)} could not be done; they stay selected.`, "error");
    setRun((r) => r && { ...r, result, error });
    onSelect(new Set(left)); // what is left to do stays selected
  };

  const confirmed = async (op: BulkOp, o: { title: string; message: string; confirmLabel: string; danger?: boolean }) => {
    if (await confirmDialog({ ...o, cancelLabel: "Back" })) void execute(op, [...selected]);
  };

  const failed = run?.result ? retryIds(run.ids, run.result).length : 0;

  return (
    <>
      {/* Phones (≤720px, as records.css): a bar along the bottom of the screen (.doc-actions, like the form's actions). */}
      <div
        role="group"
        aria-label={`Actions for the ${what} selected`}
        className="doc-actions flex items-center gap-2 [@media(width>720px)]:sticky [@media(width>720px)]:top-[calc(var(--topbar-h)+env(safe-area-inset-top,0px))] [@media(width>720px)]:z-10 [@media(width>720px)]:flex-wrap [@media(width>720px)]:border-b [@media(width>720px)]:border-border [@media(width>720px)]:bg-primary-soft [@media(width>720px)]:px-4 [@media(width>720px)]:py-2"
        onKeyDown={(e) => {
          if (e.key === "Escape") clear();
        }}
      >
        <span className="font-semibold whitespace-nowrap tabular-nums" role="status">
          {n.toLocaleString()} selected
        </span>
        {!pageAll && pageIds.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => onSelect(new Set([...selected, ...pageIds]))}>
            Select all {pageIds.length} shown
          </Button>
        )}
        {pageAll && beyond && !allMatching && (
          <Button size="sm" variant="ghost" loading={selecting} onClick={() => void selectMatching()}>
            {total == null ? `Select all matching (up to ${MAX_BULK})` : total > MAX_BULK ? `Select the first ${MAX_BULK} of ${total.toLocaleString()}` : `Select all ${total.toLocaleString()} matching`}
          </Button>
        )}
        {allMatching && total != null && total > n && <span className="text-[13px] whitespace-nowrap text-muted-foreground">of {total.toLocaleString()} matching</span>}
        <Button size="sm" variant="ghost" icon="x" onClick={clear}>
          Clear
        </Button>
        <span className="hidden flex-1 [@media(width>720px)]:block" aria-hidden="true" />
        {run?.result && !runOpen && failed > 0 && (
          <Button size="sm" variant="ghost" icon="alert" onClick={() => showRun(true)}>
            {failed.toLocaleString()} not done · details
          </Button>
        )}
        {actions.fields.length > 0 && (
          <Button size="sm" icon="edit" onClick={() => setDialog("edit")}>
            Edit
          </Button>
        )}
        <Button size="sm" icon="user" onClick={() => setDialog("assign")}>
          Assign
        </Button>
        <Button size="sm" onClick={() => setDialog("tags")}>
          Tags
        </Button>
        {actions.submit && (
          <Button
            size="sm"
            icon="check"
            onClick={() =>
              void confirmed(
                { op: "submit" },
                {
                  title: `Submit ${what}?`,
                  message: "Submitted documents can no longer be edited; to change one later, cancel and amend it. Records that cannot be submitted are listed afterwards.",
                  confirmLabel: "Submit",
                },
              )
            }
          >
            Submit
          </Button>
        )}
        {actions.cancel && (
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              void confirmed(
                { op: "cancel" },
                {
                  title: `Cancel ${what}?`,
                  message: "Cancelling reverses their postings and cannot be undone; you can amend each into a new draft. Records that cannot be cancelled are listed afterwards.",
                  confirmLabel: "Cancel them",
                  danger: true,
                },
              )
            }
          >
            Cancel
          </Button>
        )}
        {actions.workflow.map((action) => (
          <Button
            key={action}
            size="sm"
            onClick={() =>
              void confirmed(
                { op: "workflow", action },
                {
                  title: `${action}: ${what}?`,
                  message: `“${action}” is applied to each selected record whose state allows it; the others are listed afterwards.`,
                  confirmLabel: action,
                },
              )
            }
          >
            {action}
          </Button>
        ))}
        {actions.delete && (
          <Button
            size="sm"
            variant="danger"
            icon="trash"
            onClick={() =>
              void confirmed(
                { op: "delete" },
                {
                  title: `Delete ${what}?`,
                  message: "They are deleted permanently. Records that cannot be deleted (submitted documents, or ones you may not delete) are skipped and listed afterwards.",
                  confirmLabel: "Delete",
                  danger: true,
                },
              )
            }
          >
            Delete
          </Button>
        )}
      </div>

      <Dialog open={dialog === "edit"} onClose={() => setDialog(null)} title={`Edit ${what}`}>
        {dialog === "edit" && <EditForm fields={actions.fields} onCancel={() => setDialog(null)} onApply={(values) => void execute({ op: "update", values }, [...selected])} />}
      </Dialog>
      <Dialog open={dialog === "assign"} onClose={() => setDialog(null)} title={`Assign ${what}`}>
        {dialog === "assign" && <AssignForm onCancel={() => setDialog(null)} onApply={(body) => void execute({ op: "assign", ...body }, [...selected])} />}
      </Dialog>
      <Dialog open={dialog === "tags"} onClose={() => setDialog(null)} title={`Tags on ${what}`}>
        {dialog === "tags" && <TagsForm entity={E} onCancel={() => setDialog(null)} onApply={(op) => void execute(op, [...selected])} />}
      </Dialog>
      {run && (
        <RunDialog
          meta={meta}
          run={run}
          open={runOpen}
          titles={titles}
          onClose={() => showRun(false)}
          onRetry={(ids) => void execute(run.op, ids)}
        />
      )}
    </>
  );
}

// ── progress and results ──

function RunDialog({
  meta,
  run,
  open,
  titles,
  onClose,
  onRetry,
}: {
  meta: EntityMeta;
  run: Run;
  open: boolean;
  titles: Map<string, string>;
  onClose: () => void;
  onRetry: (ids: string[]) => void;
}) {
  const text = describeOp(run.op);
  const r = run.result;
  const failures = r?.results.filter((x) => !x.ok) ?? [];
  const lookup = useTitles(meta, failures.map((f) => String(f.id)).filter((id) => !titles.has(id)).slice(0, 50));
  const left = r ? retryIds(run.ids, r) : [];
  const unreached = left.length - failures.length;
  const title = (id: string) => titles.get(id) ?? lookup.get(id) ?? `Record ${shortId(id)}`;
  return (
    <Dialog open={open} onClose={onClose} wide title={r ? "Bulk action results" : text.running(countOf(meta, run.ids.length))}>
      {!r ? (
        <div className="row" role="status">
          <Spinner small />
          <span>
            {text.running(countOf(meta, run.ids.length))}
            {run.ids.length > MAX_BULK && ` ${run.sent.toLocaleString()} of ${run.ids.length.toLocaleString()} done.`}
          </span>
          <span className="w-full text-[13px] text-muted-foreground">You can close this window: the action carries on and its results stay available from the bar.</span>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <p role="status">
            {r.succeeded > 0 ? `${text.done(countOf(meta, r.succeeded))}.` : "Nothing was changed."}{" "}
            {failures.length > 0 && `${countOf(meta, failures.length)} could not be done.`}
          </p>
          {run.error != null && (
            <Alert tone="error">
              {errorMessage(run.error)}
              {unreached > 0 && ` ${countOf(meta, unreached)} were not attempted.`}
            </Alert>
          )}
          {failures.length > 0 && (
            <ul className="max-h-[50dvh] divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Records not done">
              {failures.map((f) => (
                <li key={f.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <Link to={`/e/${meta.name}/${f.id}`} className="font-medium">
                    {title(String(f.id))}
                  </Link>
                  <span className="text-[13px] text-muted-foreground">{rowErrorText(meta, f.error)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-muted-foreground">{left.length > 0 && "The records not done stay selected."}</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={onClose}>Close</Button>
            {left.length > 0 && (
              <Button variant="primary" icon="refresh" onClick={() => onRetry(left)}>
                Retry {countOf(meta, left.length)}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Titles of records not loaded in the list (selected through "select all matching"). */
function useTitles(meta: EntityMeta, ids: string[]): Map<string, string> {
  const readable = (n: string | null | undefined) => !!n && meta.fields.some((f) => f.name === n && f.can_read === true);
  const fields = ["id", ...(meta.numbering ? ["number"] : []), ...(readable(meta.title_field) ? [meta.title_field!] : [])];
  const q = useQuery({
    queryKey: ["bulk-titles", meta.name, ids],
    queryFn: ({ signal }) => api.get<ListResponse>(docPath(meta.name), { fields: fields.join(","), filters: JSON.stringify([["id", "in", ids]]), limit: ids.length }, signal),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
  return new Map((q.data?.rows ?? []).map((r) => [String(r.id), recordTitle(meta, r)]));
}

// ── what to do ──

function Actions({ onCancel, label, disabled }: { onCancel: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: "flex-end" }}>
      <Button onClick={onCancel}>Back</Button>
      <Button type="submit" variant="primary" disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

function EditForm({ fields, onCancel, onApply }: { fields: Field[]; onCancel: () => void; onApply: (values: Record<string, unknown>) => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [value, setValue] = useState<unknown>(null);
  const [title, setTitle] = useState<string>();
  const f = fields.find((x) => x.name === name);
  const empty = value === null || value === undefined || value === "";
  const pick = (next: string) => {
    setName(next);
    setValue(fields.find((x) => x.name === next)?.type === "check" ? false : null);
    setTitle(undefined);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (f && !(f.required && empty)) onApply({ [f.name]: value });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <FieldWrap label="Field" htmlFor={`${id}-field`} required>
        <select id={`${id}-field`} className="select" value={name} onChange={(e) => pick(e.target.value)} required>
          <option value="">Choose a field…</option>
          {fields.map((x) => (
            <option key={x.name} value={x.name}>
              {x.label}
            </option>
          ))}
        </select>
      </FieldWrap>
      {f && (
        <FieldWrap
          label="New value"
          htmlFor={`${id}-value`}
          required={f.required}
          hint={f.type === "check" ? undefined : f.required ? "Required: it cannot be cleared." : "Leave it empty to clear the field."}
        >
          <FieldControl
            field={f}
            value={value}
            title={title}
            id={`${id}-value`}
            required={f.required}
            describedBy={f.type === "check" ? undefined : `${id}-value-hint`}
            onChange={(v, t) => {
              setValue(v);
              setTitle(t);
            }}
          />
        </FieldWrap>
      )}
      <Actions onCancel={onCancel} label="Apply" disabled={!f || (f.required && empty)} />
    </form>
  );
}

function AssignForm({ onCancel, onApply }: { onCancel: () => void; onApply: (body: { user: string; note?: string; due_date?: string; priority: string }) => void }) {
  const id = useId();
  const people = usePeople();
  const [user, setUser] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("Medium");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (user) onApply({ user, note: note.trim() || undefined, due_date: due || undefined, priority });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <FieldWrap label="Person" htmlFor={`${id}-user`} required error={people.error ? errorMessage(people.error) : undefined}>
        <select id={`${id}-user`} className="select" value={user} onChange={(e) => setUser(e.target.value)} required disabled={people.isLoading}>
          <option value="">{people.isLoading ? "Loading people…" : "Choose…"}</option>
          {(people.data?.users ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}
            </option>
          ))}
        </select>
      </FieldWrap>
      <div className="form-grid">
        <FieldWrap label="Due" htmlFor={`${id}-due`}>
          <input id={`${id}-due`} type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Priority" htmlFor={`${id}-priority`}>
          <select id={`${id}-priority`} className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
          </select>
        </FieldWrap>
      </div>
      <FieldWrap label="Note" htmlFor={`${id}-note`}>
        <textarea id={`${id}-note`} className="textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </FieldWrap>
      <Actions onCancel={onCancel} label="Assign" disabled={!user} />
    </form>
  );
}

function TagsForm({ entity, onCancel, onApply }: { entity: string; onCancel: () => void; onApply: (op: BulkOp) => void }) {
  const id = useId();
  const [mode, setMode] = useState<"add_tags" | "remove_tags">("add_tags");
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const known = useQuery({
    queryKey: ["tags", entity],
    queryFn: ({ signal }) => api.get<{ tags: { tag: string; count: number }[] }>(`/api/tags/${encodeURIComponent(entity)}`, undefined, signal),
    staleTime: 60_000,
  });
  const all = (extra = draft) => parseTags([...tags, extra].join(","));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const list = all();
    if (!list.length) return setError("Enter at least one tag.");
    onApply({ op: mode, tags: list });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <div className="segmented self-start" role="group" aria-label="Tag action">
        <button type="button" aria-pressed={mode === "add_tags"} onClick={() => setMode("add_tags")}>
          Add tags
        </button>
        <button type="button" aria-pressed={mode === "remove_tags"} onClick={() => setMode("remove_tags")}>
          Remove tags
        </button>
      </div>
      <FieldWrap label="Tags" htmlFor={`${id}-tags`} error={error ?? undefined} hint="Press Enter or type a comma after each tag.">
        <div className="stack" style={{ gap: 8 }}>
          {tags.length > 0 && (
            <ul className="chips" aria-label="Tags to apply">
              {tags.map((t) => (
                <li key={t} className="chip-removable">
                  {t}
                  <button type="button" className="icon-btn" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>
                    <Icon name="x" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            id={`${id}-tags`}
            className="input"
            list={`${id}-known`}
            autoComplete="off"
            maxLength={60}
            value={draft}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? `${id}-tags-error` : `${id}-tags-hint`}
            onChange={(e) => {
              setError(null);
              const v = e.target.value;
              if (v.includes(",")) {
                setTags(all(v));
                setDraft("");
              } else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !draft.trim()) return;
              e.preventDefault();
              setTags(all());
              setDraft("");
            }}
          />
          <datalist id={`${id}-known`}>
            {(known.data?.tags ?? []).map((t) => (
              <option key={t.tag} value={t.tag} />
            ))}
          </datalist>
        </div>
      </FieldWrap>
      <Actions onCancel={onCancel} label={mode === "add_tags" ? "Add" : "Remove"} />
    </form>
  );
}
