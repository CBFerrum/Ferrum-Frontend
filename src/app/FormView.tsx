// Generic document form: layout from `form` sections (in tabs, shown on conditions), widgets per field type, conditional rules,
// live `_calc` totals, optimistic concurrency, lifecycle, custom actions, workflow, print, audit.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, docPath, errorMessage, newKey, openPrint, type FieldError } from "../lib/api";
import { asRows, calcBody, carryTitles, createBody, diffDoc, hasInvalidNumbers, mergeCalc, missingRequired } from "../lib/doc";
import { evaluate, evaluateValue } from "../lib/expr";
import { useLiveEntity, type LiveEvent } from "../lib/live";
import { formatDateTime, formatValue, humanize, shortId } from "../lib/format";
import { formSections } from "../lib/formTabs";
import {
  can,
  DOCSTATUS_LABEL,
  fieldLabel,
  fieldState,
  recordTitle,
  SYSTEM_FIELD_LABELS,
  useCurrencyPrecision,
  useEntityMeta,
  useMe,
  userScope,
  type ActionDef,
  type Doc,
  type EntityMeta,
  type Field,
  type FieldState,
  type Me,
  type PermKey,
} from "../lib/meta";
import {
  Alert,
  Badge,
  Button,
  confirmDialog,
  ErrorState,
  Field as FieldWrap,
  Icon,
  Menu,
  MenuItem,
  PageLoading,
  Spinner,
  statusTone,
  TabPanel,
  Tabs,
  toast,
} from "../ui/kit";
import { CollabPanel } from "./Collab";
import { FieldControl, LinkTitle, TableGrid, withValue } from "./widgets";

export function FormView() {
  const { entity = "", id = "" } = useParams();
  const meta = useEntityMeta(entity);
  const me = useMe();
  if (meta.error || me.error) return <ErrorState error={meta.error ?? me.error} onRetry={() => (meta.error ? meta.refetch() : me.refetch())} />;
  if (!meta.data || !me.data) return <PageLoading />;
  return <DocLoader key={`${entity}/${id}`} meta={meta.data} me={me.data} id={id} />;
}

function DocLoader({ meta, me, id }: { meta: EntityMeta; me: Me; id: string }) {
  const isNew = id === "new";
  const q = useQuery({
    queryKey: ["doc", meta.name, id],
    queryFn: ({ signal }) => api.get<Doc>(docPath(meta.name, id), undefined, signal),
    enabled: !isNew,
    staleTime: Infinity,
    gcTime: 0,
  });
  const reload = useCallback(async () => {
    const r = await q.refetch();
    if (r.error) throw r.error;
    return r.data;
  }, [q]);
  if (!isNew && q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} title={`Could not load this ${meta.label}`} />;
  if (!isNew && !q.data) return <PageLoading />;
  return <DocForm meta={meta} me={me} initial={isNew ? null : (q.data ?? null)} reload={reload} />;
}

const DECIMAL_TYPES = new Set(["decimal", "currency", "percent"]);

/**
 * Initial values of a new document: values from the URL (`?customer=<id>`, e.g. "New" from a
 * filtered list), else field defaults (literal `default`, or a simple `default_expr` such as
 * `today`). The server applies its own defaults again on save and in `_calc`.
 */
function prefill(meta: EntityMeta, sp: URLSearchParams, user: unknown): Doc {
  const doc: Doc = {};
  for (const f of meta.fields) {
    if (f.type === "table") continue;
    const v = f.can_write === true ? sp.get(f.name) : null;
    let value: unknown;
    if (v !== null) value = f.type === "check" ? v === "1" || v === "true" : f.type === "int" && /^-?\d+$/.test(v) ? Number(v) : v;
    else if (f.default !== undefined && f.default !== null) value = f.default;
    else if (f.default_expr) value = evaluateValue(f.default_expr, { doc, user });
    if (value === undefined || value === null) continue;
    doc[f.name] = DECIMAL_TYPES.has(f.type) && typeof value === "number" ? String(value) : value;
  }
  return doc;
}

/** A section tab's id; the untitled first tab keeps "details". */
const tabId = (tab: string | null) => (tab === null ? "details" : `tab:${tab}`);

/** A tab's label with how many errors its fields have. */
function tabLabel(label: string, errors: number): ReactNode {
  if (!errors) return label;
  return (
    <>
      {label}
      <span className="tab-errors" aria-hidden="true">
        {errors}
      </span>
      <span className="sr-only">, {errors === 1 ? "1 error" : `${errors} errors`}</span>
    </>
  );
}

const WIDE = new Set(["text", "markdown", "code", "json"]);

function DocForm({ meta, me, initial, reload }: { meta: EntityMeta; me: Me; initial: Doc | null; reload: () => Promise<Doc | undefined> }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const isNew = !initial;
  const E = meta.name;
  const user = useMemo(() => userScope(me), [me]);
  const [base, setBase] = useState<Doc | null>(initial);
  const [doc, setDoc] = useState<Doc>(() => initial ?? prefill(meta, sp, user));
  const [touched, setTouched] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [calc, setCalc] = useState<{ pending: boolean; error?: string }>({ pending: false });
  const [tab, setTab] = useState("details");
  const [focusError, setFocusError] = useState(0);
  const precisionOf = useCurrencyPrecision();
  const layout = useMemo(() => formSections(meta), [meta]);

  const rev = useRef(0); // bumps on every edit; stale `_calc` responses are dropped
  const docRef = useRef(doc);
  docRef.current = doc;
  const allowNav = useRef(false);
  const calcTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const calcAbort = useRef<AbortController | null>(null);

  const id = base?.id;
  const docstatus = Number(doc.docstatus ?? 0);
  const perms = meta.permissions;
  const notMine = !!base && base.created_by !== me.user.id;
  const allowed = (k: PermKey) => can(perms, k) && !(perms[k] === "own" && notMine);
  const wf = meta.workflow ?? null;
  const wfState = wf ? String(doc.workflow_state ?? wf.initial_state) : null;
  const hasRole = (roles: string[]) => !roles.length || me.user.is_admin || roles.some((r) => me.user.roles.includes(r));
  const wfEditable = !wf || hasRole(wf.states.find((s) => s.name === wfState)?.edit_roles ?? []);
  const locked = docstatus !== 0 || meta.kind === "ledger" || (isNew ? !can(perms, "create") : !allowed("write")) || !wfEditable;

  const changes = useMemo(() => (base ? diffDoc(meta, base, doc) : null), [meta, base, doc]);
  const dirty = isNew ? touched : !!changes && Object.keys(changes).length > 0;

  // ── live totals ──

  const runCalc = useCallback(async () => {
    const sent = rev.current;
    const current = docRef.current;
    // Until the header is complete and numbers parse, the server cannot preview (it would answer 422).
    const required = (f: Field) => {
      const st = fieldState(f, { doc: current, user });
      return st.visible && st.required;
    };
    if (missingRequired(meta, current, required) || hasInvalidNumbers(meta, current)) return setCalc({ pending: false });
    calcAbort.current?.abort();
    const ctl = new AbortController();
    calcAbort.current = ctl;
    setCalc({ pending: true });
    try {
      const res = await api.post<Doc>(docPath(E, "_calc"), calcBody(meta, current), { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      setCalc({ pending: false });
      if (rev.current === sent) setDoc((d) => mergeCalc(meta, d, res));
    } catch (e) {
      if (!ctl.signal.aborted) setCalc({ pending: false, error: errorMessage(e) });
    }
  }, [E, meta, user]);

  const scheduleCalc = () => {
    if (locked) return;
    clearTimeout(calcTimer.current);
    calcTimer.current = setTimeout(() => void runCalc(), 400);
  };

  useEffect(() => {
    if (isNew && !locked) void runCalc(); // server defaults (default_expr, fetches) for a new document
    return () => {
      clearTimeout(calcTimer.current);
      calcAbort.current?.abort();
    };
  }, []); // mount only

  const edit = (update: (d: Doc) => Doc) => {
    rev.current++;
    setTouched(true);
    setDoc(update);
    scheduleCalc();
  };
  const setField = (name: string, value: unknown, title?: string) => {
    edit((d) => withValue(d, name, value, title));
    setErrors((es) => es.filter((e) => e.row || e.field !== name));
  };
  const setRows = (table: string, rows: Doc[], cell?: { row: number; field: string }) => {
    edit((d) => ({ ...d, [table]: rows }));
    setErrors((es) =>
      es.filter((e) => (cell ? !(e.row?.[0] === table && e.row[1] === cell.row && e.field === cell.field) : e.row?.[0] !== table && e.field !== table)),
    );
  };

  // ── persistence ──

  const load = (d: Doc, prev?: Doc) => {
    const next = prev ? carryTitles(meta, d, prev) : d;
    rev.current++;
    setBase(next);
    setDoc(next);
    setTouched(false);
    setErrors([]);
    setBanner(null);
    setConflict(false);
  };

  const invalidateLists = () => qc.invalidateQueries({ queryKey: ["list", E] });

  // Someone else changed this record: refresh quietly, or warn when there are unsaved edits.
  const latest = useRef({ dirty, id: base?.id as string | undefined, me: me.user.id, reload: async () => {} });
  latest.current = {
    dirty,
    id: base?.id as string | undefined,
    me: me.user.id,
    reload: async () => {
      try {
        const fresh = await reload();
        if (fresh) load(fresh, base ?? undefined);
      } catch {
        // Offline or gone: the next save reports the conflict.
      }
    },
  };
  const onLive = useCallback(
    (e: LiveEvent) => {
      const l = latest.current;
      if (e.id !== l.id) return;
      // Comments, assignments and tags refresh the discussion, not the record.
      if (/\.(commented|assigned|tagged)$/.test(e.event)) return void qc.invalidateQueries({ queryKey: ["collab", E, l.id] });
      if (e.actor === l.me || e.event.endsWith(".deleted")) return;
      if (l.dirty) setConflict(true);
      else void l.reload();
    },
    [qc, E],
  );
  useLiveEntity(isNew ? undefined : E, onLive);

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      setConflict(true);
      return;
    }
    if (e instanceof ApiError && e.fields.length) {
      setErrors(e.fields);
      setBanner(e.message);
      // The first tab with a failing field (the banner lists those no tab shows).
      setTab(e.fields.map((f) => tabOf.get(f.row ? f.row[0] : f.field)).find(Boolean) ?? tabs[0]?.id ?? "details");
      setFocusError((n) => n + 1);
      return;
    }
    toast(errorMessage(e), "error");
  };

  const save = async (): Promise<Doc | null> => {
    setBusy("save");
    setBanner(null);
    try {
      if (isNew) {
        // One key per attempt: the client's own retries on connection errors reuse it.
        const created = await api.post<Doc>(docPath(E), createBody(meta, doc), { idempotencyKey: newKey() });
        toast(`${meta.label} created`);
        allowNav.current = true;
        void invalidateLists();
        navigate(`/e/${E}/${created.id}`, { replace: true });
        return created;
      }
      if (!base || !changes || !Object.keys(changes).length) return base;
      const saved = await api.patch<Doc>(docPath(E, String(id)), changes, { ifMatch: base.version });
      load(saved, docRef.current);
      toast("Saved");
      void invalidateLists();
      return saved;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(null);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  /** Runs a server operation on the saved document (saving pending edits first). */
  const operate = async (key: string, run: (version: number | undefined) => Promise<void>) => {
    let current = base;
    if (dirty) {
      current = await save();
      if (!current) return;
    }
    setBusy(key);
    try {
      await run(current?.version);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const lifecycle = async (op: "submit" | "cancel") => {
    const ok = await confirmDialog(
      op === "submit"
        ? {
            title: `Submit this ${meta.label}?`,
            message: "Submitted documents can no longer be edited. To change one later, cancel it and amend it.",
            confirmLabel: "Submit",
          }
        : {
            title: `Cancel this ${meta.label}?`,
            message: "Cancelling reverses its postings and cannot be undone. You can amend it into a new draft afterwards.",
            confirmLabel: "Cancel document",
            danger: true,
          },
    );
    if (!ok) return;
    await operate(op, async (version) => {
      const d = await api.post<Doc>(docPath(E, String(id), op), undefined, { ifMatch: version });
      load(d, docRef.current);
      toast(op === "submit" ? `${meta.label} submitted` : `${meta.label} cancelled`);
      void invalidateLists();
    });
  };

  const amend = async () => {
    const ok = await confirmDialog({
      title: `Amend this ${meta.label}?`,
      message: "A new draft is created from this cancelled document; the original stays cancelled.",
      confirmLabel: "Amend",
    });
    if (!ok) return;
    await operate("amend", async () => {
      const d = await api.post<Doc>(docPath(E, String(id), "amend"));
      toast("Amended: you are now editing the new draft");
      void invalidateLists();
      navigate(`/e/${E}/${d.id}`);
    });
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete this ${meta.label}?`,
      message: "The record is deleted permanently.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await api.del(docPath(E, String(id)), { ifMatch: base?.version });
      toast(`${meta.label} deleted`);
      allowNav.current = true;
      void invalidateLists();
      navigate(`/e/${E}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const transitions =
    wf && !isNew
      ? wf.transitions.filter(
          (t) =>
            t.from === wfState &&
            hasRole(t.roles) &&
            !(t.not_creator && base?.created_by === me.user.id) &&
            (!t.condition || evaluate(t.condition, { doc, user }) !== false),
        )
      : [];

  const transition = async (action: string) => {
    const ok = await confirmDialog({ title: `${action}?`, message: `Apply “${action}” to this ${meta.label}.`, confirmLabel: action });
    if (!ok) return;
    await operate(`wf:${action}`, async (version) => {
      const d = await api.post<Doc>(docPath(E, String(id), "workflow", action), undefined, { ifMatch: version });
      load(d, docRef.current);
      toast(`${action}: done`);
      void invalidateLists();
    });
  };

  const actions = isNew
    ? []
    : meta.actions.filter(
        (a) =>
          (!a.docstatus.length || a.docstatus.includes(docstatus)) &&
          (a.permission in perms ? allowed(a.permission as PermKey) : true) &&
          (!a.condition || evaluate(a.condition, { doc, user }) !== false),
      );

  const runAction = async (a: ActionDef) => {
    if (a.confirm && !(await confirmDialog({ title: a.label, message: a.confirm, confirmLabel: a.label }))) return;
    await operate(`action:${a.name}`, async () => {
      const res = await api.post<unknown>(docPath(E, String(id), "actions", a.name), {});
      const r = (res && typeof res === "object" ? res : {}) as { entity?: unknown; id?: unknown };
      toast(`${a.label}: done`);
      if (typeof r.entity === "string" && typeof r.id === "string") navigate(`/e/${r.entity}/${r.id}`);
      else {
        const fresh = await reload();
        if (fresh) load(fresh);
      }
    });
  };

  const reloadLatest = async () => {
    if (dirty && !(await confirmDialog({ title: "Discard your changes?", message: "Reloading discards your unsaved edits.", confirmLabel: "Reload", danger: true })))
      return;
    try {
      const fresh = await reload();
      if (fresh) load(fresh);
      toast("Loaded the latest version", "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  // Move focus to the first invalid field once the errors have rendered.
  useEffect(() => {
    if (focusError) document.querySelector<HTMLElement>('main [aria-invalid="true"]')?.focus();
  }, [focusError]);

  // ── navigation guards & shortcuts ──

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !allowNav.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: "Leave without saving?", message: "Your unsaved changes will be lost.", confirmLabel: "Leave", danger: true }).then((ok) =>
      ok ? blocker.proceed() : blocker.reset(),
    );
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!locked && dirty && !busy) void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, dirty, busy]);

  // ── rendering ──

  const scope = { doc, user };
  const topErrors = new Map(errors.filter((e) => !e.row).map((e) => [e.field, e.message]));
  const states = new Map<string, FieldState>(meta.fields.map((f) => [f.name, fieldState(f, scope, locked)]));
  // Sections shown now (their condition holds and a field is visible), and the tabs that have one.
  const shown = layout.sections.flatMap((s) => {
    if (s.visibleIf && evaluate(s.visibleIf, scope) === false) return [];
    const items = s.fields.flatMap((f) => {
      const st = states.get(f.name);
      return st?.visible ? [{ f, st }] : [];
    });
    return items.length ? [{ s, items }] : [];
  });
  const tabOf = new Map(shown.flatMap(({ s, items }) => items.map(({ f }) => [f.name, tabId(s.tab)] as const)));
  const unplaced = errors.filter((e) => !tabOf.has(e.row ? e.row[0] : e.field));
  const tabs = [
    ...layout.tabs.filter((t) => shown.some(({ s }) => s.tab === t)).map((t) => ({ id: tabId(t), label: t ?? "Details" })),
    ...(isNew
      ? []
      : [
          { id: "discussion", label: "Discussion" },
          { id: "activity", label: "Activity" },
        ]),
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? "details");
  const currencyPrecision = (f: Field, row: Doc, parent?: Doc) =>
    f.type === "currency" && f.currency
      ? precisionOf(f.currency.startsWith("parent.") ? parent?.[f.currency.slice(7)] : row[f.currency])
      : undefined;

  const renderField = (f: Field, st: FieldState, soleInSection = false): ReactNode => {
    const err = topErrors.get(f.name);
    const fid = `f-${f.name}`;
    if (f.type === "table") {
      const child = meta.children[f.name];
      if (!child) return null;
      return (
        <div key={f.name} className="field span-all" role="group" aria-labelledby={`${fid}-label`}>
          <div className={soleInSection ? "sr-only" : "field-label"} id={`${fid}-label`}>
            {f.label}
            {st.required && (
              <span className="req" aria-hidden="true">
                *
              </span>
            )}
          </div>
          <TableGrid
            child={child}
            rows={asRows(doc[f.name])}
            onChange={(rows, cell) => setRows(f.name, rows, cell)}
            locked={st.disabled}
            errors={errors.filter((e) => e.row?.[0] === f.name)}
            parent={doc}
            user={user}
            precisionOf={(cf, row) => currencyPrecision(cf, row, doc)}
            entity={E}
            recordId={id}
          />
          {err && <p className="field-error">{err}</p>}
        </div>
      );
    }
    const control = (
      <FieldControl
        field={f}
        id={fid}
        value={doc[f.name]}
        title={doc._titles?.[f.name]}
        disabled={st.disabled}
        required={st.required}
        invalid={!!err}
        describedBy={err ? `${fid}-error` : f.description ? `${fid}-hint` : undefined}
        currencyPrecision={currencyPrecision(f, doc)}
        entity={E}
        recordId={id}
        onChange={(v, t) => setField(f.name, v, t)}
      />
    );
    if (f.type === "check") {
      return (
        <div key={f.name} className="field">
          <div className="check-field">
            {control}
            <label htmlFor={fid}>{f.label}</label>
          </div>
          {err ? (
            <p className="field-error" id={`${fid}-error`}>
              {err}
            </p>
          ) : (
            f.description && (
              <p className="field-hint" id={`${fid}-hint`}>
                {f.description}
              </p>
            )
          )}
        </div>
      );
    }
    return (
      <FieldWrap key={f.name} label={f.label} htmlFor={fid} required={st.required} error={err} hint={f.description} className={WIDE.has(f.type) ? "span-all" : ""}>
        {control}
      </FieldWrap>
    );
  };

  const details = (tab: string) => (
    <>
      {shown.map(({ s, items }) => {
        if (tabId(s.tab) !== tab) return null;
        const hasError = items.some(({ f }) => topErrors.has(f.name) || errors.some((e) => e.row?.[0] === f.name));
        return (
          <FormSection key={s.key} label={s.label} collapsible={s.collapsible} forceOpen={hasError}>
            <div className="form-grid" style={{ "--cols": Math.min(Math.max(s.columns, 1), 4) } as CSSProperties}>
              {items.map(({ f, st }) => renderField(f, st, items.length === 1 && f.label === s.label))}
            </div>
          </FormSection>
        );
      })}
    </>
  );

  const titleValue = meta.title_field ? doc[meta.title_field] : null;
  const heading = isNew ? `New ${meta.label}` : doc.number ? String(doc.number) : recordTitle(meta, doc);
  const sub = !isNew && doc.number && titleValue ? String(titleValue) : null;
  const status = meta.fields.some((f) => f.name === "status") ? doc.status : null;
  const canSubmit = !isNew && meta.submittable && !wf && docstatus === 0 && allowed("submit");
  const canCancel = !isNew && meta.submittable && !wf && docstatus === 1 && allowed("cancel");
  const canAmend = !isNew && meta.submittable && docstatus === 2 && can(perms, "create");
  const canDelete = !isNew && meta.kind !== "ledger" && docstatus !== 1 && allowed("delete");
  const busyAny = !!busy;

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="crumbs">
            <Link to={`/e/${E}`}>{meta.label_plural}</Link>
            <Icon name="chevronRight" size={12} />
          </div>
          <h1 className="page-title">{heading}</h1>
          {sub && <p className="page-sub">{sub}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            {meta.submittable && <Badge tone={statusTone(DOCSTATUS_LABEL[docstatus])}>{DOCSTATUS_LABEL[docstatus] ?? docstatus}</Badge>}
            {typeof status === "string" && status && status !== DOCSTATUS_LABEL[docstatus] && <Badge tone={statusTone(status)}>{status}</Badge>}
            {wfState && <Badge tone="purple">{wfState}</Badge>}
            {dirty && <Badge tone="amber">Not saved</Badge>}
            {calc.pending ? (
              <span className="row faint" role="status">
                <Spinner small /> Calculating…
              </span>
            ) : calc.error && touched ? (
              <span className="faint" title={calc.error}>
                Totals pending: {calc.error}
              </span>
            ) : null}
          </div>
        </div>
        <div className="page-actions doc-actions">
          {!locked && (
            <Button variant={dirty ? "primary" : "default"} onClick={() => void save()} loading={busy === "save"} disabled={busyAny || !dirty} title="Save (Ctrl+S)">
              {isNew ? "Create" : "Save"}
            </Button>
          )}
          {canSubmit && (
            <Button variant="primary" onClick={() => void lifecycle("submit")} loading={busy === "submit"} disabled={busyAny}>
              {dirty ? "Save & Submit" : "Submit"}
            </Button>
          )}
          {canCancel && (
            <Button variant="danger" onClick={() => void lifecycle("cancel")} loading={busy === "cancel"} disabled={busyAny}>
              Cancel
            </Button>
          )}
          {canAmend && (
            <Button onClick={() => void amend()} loading={busy === "amend"} disabled={busyAny}>
              Amend
            </Button>
          )}
          {transitions.map((t) => (
            <Button key={`${t.action}->${t.to}`} variant="primary" onClick={() => void transition(t.action)} loading={busy === `wf:${t.action}`} disabled={busyAny}>
              {t.action}
            </Button>
          ))}
          {actions.map((a) => (
            <Button key={a.name} onClick={() => void runAction(a)} loading={busy === `action:${a.name}`} disabled={busyAny}>
              {a.label}
            </Button>
          ))}
          {!isNew && (
            <Button icon="printer" onClick={() => openPrint(docPath(E, String(id), "print")).catch((e) => toast(errorMessage(e), "error"))}>
              Print
            </Button>
          )}
          {(canDelete || me.user.is_admin) && (
            <Menu ariaLabel="More actions" icon="chevronDown">
              {(close) => (
                <>
                  {me.user.is_admin && (
                    <MenuItem
                      onSelect={() => {
                        close();
                        navigate(`/customize/${E}`);
                      }}
                    >
                      Customize {meta.label}
                    </MenuItem>
                  )}
                  {canDelete && (
                    <MenuItem
                      danger
                      onSelect={() => {
                        close();
                        void remove();
                      }}
                    >
                      Delete
                    </MenuItem>
                  )}
                </>
              )}
            </Menu>
          )}
        </div>
      </div>

      {conflict && (
        <Alert tone="warning" action={<Button icon="refresh" onClick={() => void reloadLatest()}>Reload</Button>}>
          <strong>Changed by someone else.</strong> This {meta.label} was modified after you opened it. Reload to get the latest version, then
          re-apply your changes.
        </Alert>
      )}
      {banner && (
        <Alert tone="error">
          {banner}
          {unplaced.length > 0 && (
            <ul>
              {unplaced.map((e, i) => (
                <li key={i}>
                  {e.row
                    ? `${fieldLabel(meta, e.row[0])} row ${e.row[1] + 1}, ${meta.children[e.row[0]]?.fields.find((f) => f.name === e.field)?.label ?? humanize(e.field)}`
                    : fieldLabel(meta, e.field)}
                  : {e.message}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {!isNew && docstatus === 1 && meta.submittable && (
        <Alert tone="info">This document is submitted and can no longer be edited.{canCancel ? " Cancel it to make changes through an amendment." : ""}</Alert>
      )}
      {!isNew && docstatus === 2 && <Alert tone="warning">This document is cancelled.{canAmend ? " Amend it to create a corrected draft." : ""}</Alert>}
      {!isNew && !locked && docstatus === 0 && !wfEditable && <Alert tone="info">You cannot edit documents in the “{wfState}” state.</Alert>}

      {tabs.length > 1 ? (
        <>
          <Tabs
            id="doc"
            value={active}
            onChange={setTab}
            tabs={tabs.map((t) => ({ id: t.id, label: tabLabel(t.label, errors.filter((e) => tabOf.get(e.row ? e.row[0] : e.field) === t.id).length) }))}
          />
          <TabPanel id="doc" tab={active}>
            {active === "discussion" ? (
              <CollabPanel entity={E} id={String(id)} canWrite={can(meta.permissions, "write")} />
            ) : active === "activity" ? (
              <AuditPanel meta={meta} id={String(id)} />
            ) : (
              details(active)
            )}
          </TabPanel>
        </>
      ) : (
        details(active)
      )}
    </div>
  );
}

function FormSection({ label, collapsible, forceOpen, children }: { label: string | null; collapsible: boolean; forceOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!collapsible);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  if (!collapsible) {
    return (
      <section className="section" aria-label={label ?? undefined}>
        {label && <h2 className="section-title">{label}</h2>}
        <div className="section-body" style={label ? undefined : { paddingTop: 16 }}>
          {children}
        </div>
      </section>
    );
  }
  return (
    <details className="section" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Icon name="chevronRight" size={14} />
        {label ?? "More"}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

// ── audit trail ──

interface AuditEvent {
  id?: number;
  at: string;
  actor?: string | null;
  actor_name?: string | null;
  action: string;
  version?: number | null;
  diff?: Record<string, unknown> | null;
}

const AUDIT_SKIP = new Set(["id", "created_at", "created_by", "updated_at", "updated_by", "version"]);

function AuditPanel({ meta, id }: { meta: EntityMeta; id: string }) {
  const q = useQuery({
    queryKey: ["audit", meta.name, id],
    queryFn: ({ signal }) => api.get<{ events: AuditEvent[]; chain_valid: boolean; broken_at?: number | null }>(docPath(meta.name, id, "audit"), undefined, signal),
  });
  if (q.isLoading) return <PageLoading label="Loading history…" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { events, chain_valid, broken_at } = q.data;
  return (
    <div className="stack">
      {chain_valid ? (
        <Alert tone="success">
          <strong>Audit chain verified.</strong> {events.length} event{events.length === 1 ? "" : "s"}, none altered.
        </Alert>
      ) : (
        <Alert tone="error">
          <strong>Audit chain broken</strong>
          {broken_at != null ? ` at event ${broken_at}` : ""}: the stored history does not match its hash chain.
        </Alert>
      )}
      {!events.length ? (
        <p className="muted">No history recorded yet.</p>
      ) : (
        <ol className="timeline">
          {[...events].reverse().map((ev, i) => (
            <li key={ev.id ?? `${ev.at}-${i}`}>
              <div className="row">
                <strong>{humanize(ev.action)}</strong>
                <span className="muted">by {ev.actor_name ?? (ev.actor ? shortId(ev.actor) : "System")}</span>
                <span className="faint">{formatDateTime(ev.at)}</span>
                {ev.version != null && <Badge>v{ev.version}</Badge>}
              </div>
              <DiffTable meta={meta} diff={ev.diff} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DiffTable({ meta, diff }: { meta: EntityMeta; diff?: Record<string, unknown> | null }) {
  const entries = Object.entries(diff ?? {}).filter(([k]) => !AUDIT_SKIP.has(k));
  if (!entries.length) return null;
  return (
    <div className="table-wrap">
      <table className="diff">
        <tbody>
          {entries.map(([k, v]) => {
            const [before, after] = Array.isArray(v) && v.length === 2 ? v : [undefined, v];
            const f = meta.fields.find((x) => x.name === k);
            return (
              <tr key={k}>
                <td className="muted">{f?.label ?? SYSTEM_FIELD_LABELS[k] ?? humanize(k)}</td>
                <td className="old">{before != null && before !== "" && <DiffValue name={k} field={f} value={before} />}</td>
                <td className="new">
                  <DiffValue name={k} field={f} value={after} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DiffValue({ name, field, value }: { name: string; field?: Field; value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="faint">empty</span>;
  if (name === "docstatus" && typeof value === "number") return <>{DOCSTATUS_LABEL[value] ?? value}</>;
  if (Array.isArray(value)) return <>{`${value.length} row${value.length === 1 ? "" : "s"}`}</>;
  if (field?.type === "link" && field.to && typeof value === "string") return <LinkTitle to={field.to} id={value} />;
  return <>{field ? formatValue(field, value) : typeof value === "object" ? JSON.stringify(value) : String(value)}</>;
}
