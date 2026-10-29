// The report builder: settings on the left (a sheet on small screens), a live preview from the
// server on the right, as a table or a chart. The state lives in the URL (`?q=`), so any view can be
// shared or bookmarked; undo and redo cover every change; leaving with unsaved changes asks first;
// a save that someone else beat offers to overwrite or load theirs. Saved reports open in a run view
// (report/ReportRun.tsx) with runtime filters; `?edit=1` opens them here.

import { useQueryClient } from "@tanstack/react-query";
import { Copy, Database, Download, Ellipsis, Link2, Play, Redo2, Save, Settings2, SlidersHorizontal, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams, type RouteObject } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api, ApiError, errorMessage, saveBlob } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { can, useMe, useMetaIndex, type Access, type EntityMeta } from "@/lib/meta";
import {
  buildSpec,
  chartIssues,
  fieldIssues,
  specIssues,
  STUDIO_ENTITY,
  studio,
  studioKeys,
  useDeleteStudioRecord,
  useSaveStudioRecord,
  useStudioFields,
  useStudioQuery,
  useStudioRecord,
  useStudioSources,
  type CellOptions,
  type ColumnSetting,
  type Issue,
  type QueryResult,
  type ReportRecord,
  type ResultColumn,
} from "@/lib/studio";
import { confirmDialog, ErrorState, PageLoading, toast, useDebounced } from "@/ui/kit";
import { BuilderPanel } from "./report/BuilderPanel";
import { ColumnDialog } from "./report/ColumnDialog";
import { EntityPicker } from "./report/pickers";
import { fileStem, NoRows, ResultNotices, ResultSkeleton, ResultView, settingOf, ViewToggle } from "./report/Preview";
import { ChartSettingsBar } from "./report/ResultChart";
import { ReportRun } from "./report/ReportRun";
import { ConflictDialog, SaveDialog, type SaveMeta, type SaveMode } from "./report/SaveDialog";
import {
  decodeParam,
  decodeState,
  defaultChart,
  displayColumns,
  emptyState,
  encodeState,
  filterIssues,
  historyReducer,
  moveColumn,
  patchColumn,
  recordFromState,
  startState,
  stateFromRecord,
  stateKey,
  toCsv,
  withFields,
  type BuilderState,
  type History,
  type HistoryAction,
  type ViewMode,
} from "./report/state";
import { useMediaQuery } from "./report/ui";
import { ReportList } from "./ReportList";

export const reportRoutes: RouteObject[] = [
  { path: "studio/reports", element: <ReportList /> },
  { path: "studio/reports/new", element: <ReportBuilder /> },
  { path: "studio/reports/:id", element: <ReportBuilder /> },
];

export { reportNav } from "./ReportList";

/** `studio/reports/new` and `studio/reports/:id` (the run view, or the editor with `?edit=1`). */
export function ReportBuilder() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  if (!id) return <Editor key="new" />;
  return sp.has("edit") ? <SavedEditor key={id} id={id} /> : <ReportRun key={id} id={id} />;
}

function SavedEditor({ id }: { id: string }) {
  const record = useStudioRecord("reports", id);
  if (record.isLoading) return <PageLoading label="Opening the report…" />;
  if (record.error || !record.data)
    return (
      <div className="grid gap-3">
        <ErrorState
          title={record.error instanceof ApiError && [403, 404].includes(record.error.status) ? "This report cannot be edited here" : "The report could not be opened"}
          error={record.error ?? new Error("Not found.")}
          onRetry={() => void record.refetch()}
        />
        <p className="text-center text-sm">
          <Link className="text-primary underline-offset-4 hover:underline" to={`/studio/reports/${encodeURIComponent(id)}`}>
            Open it to view instead
          </Link>
        </p>
      </div>
    );
  return <Editor record={record.data} />;
}

const reducer = (h: History<BuilderState>, a: HistoryAction<BuilderState>) => historyReducer(h, a);
const META_FIELDS = new Set(["label", "description", "sharing", "roles", "module"]);
const AREA: Record<string, string> = { columns: "Columns", chart: "Chart", kind: "Report shape", spec: "Report settings" };
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const metaOf = (r: ReportRecord | undefined, label = ""): SaveMeta => ({
  label: r?.label ?? label,
  description: r?.description ?? "",
  sharing: r?.sharing ?? "private",
  roles: r?.roles?.map((x) => x.role) ?? [],
  module: r?.module ?? "",
});

function Editor({ record }: { record?: ReportRecord }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const me = useMe();
  const index = useMetaIndex();
  const wide = useMediaQuery("(min-width: 1024px)");
  const fy = me.data?.fiscal_year_start_month ?? 1;
  const options = useMemo<CellOptions>(() => ({ fyStartMonth: fy }), [fy]);

  // ── state: the saved record, the edited state (with undo), and whether they differ ──
  const [rec, setRec] = useState(record);
  const [start] = useState(() => {
    const q = sp.get("q");
    const fromLink = decodeState(q);
    const saved = record ? stateFromRecord(record) : null;
    const link = decodeParam(q) as { label?: unknown } | undefined;
    return {
      state: fromLink ?? saved ?? emptyState(),
      savedKey: stateKey(saved ?? emptyState()),
      badLink: !!q && !fromLink,
      badRecord: !!record && !saved,
      copyLabel: typeof link?.label === "string" ? link.label : "",
    };
  });
  const [history, dispatch] = useReducer(reducer, { past: [], present: start.state, future: [] });
  const state = history.present;
  const d = state.draft;
  const [savedKey, setSavedKey] = useState(start.savedKey);
  const currentKey = useMemo(() => stateKey(state), [state]);
  const dirty = currentKey !== savedKey;
  const [saveIssues, setSaveIssues] = useState<Issue[]>([]);
  const update = useCallback((recipe: (s: BuilderState) => BuilderState, key?: string) => {
    dispatch({ type: "set", recipe, key, at: Date.now() });
    setSaveIssues((x) => (x.length ? [] : x));
  }, []);

  // ── permissions ──
  const reportPerms = index.data?.entities.find((e) => e.name === STUDIO_ENTITY.reports)?.permissions;
  const owned = (a: Access | undefined) => a === "all" || (a === "own" && !!rec && rec.created_by === me.data?.user.id);
  const canCreate = can(reportPerms, "create");
  const canEdit = !!rec && !rec.is_standard && owned(reportPerms?.write);
  const canDelete = !!rec && !rec.is_standard && owned(reportPerms?.delete);
  const entityInfo = index.data?.entities.find((e) => e.name === d.entity);
  const canExport = can(entityInfo?.permissions, "export");

  // ── data ──
  const sources = useStudioSources();
  const catalog = useStudioFields(d.entity || undefined);
  const spec = useMemo(() => buildSpec(d), [d]);
  const localIssues = useMemo(() => (d.entity ? [...specIssues(spec, catalog.data), ...filterIssues(d.filters)] : []), [d, spec, catalog.data]);
  const debounced = useDebounced(d.entity && !localIssues.length ? spec : undefined, 350);
  const query = useStudioQuery(debounced);
  // The last result stays on screen (dimmed) while settings are incomplete or refused; another entity's never does.
  const last = useRef<QueryResult | undefined>(undefined);
  if (query.data && !query.isPlaceholderData) last.current = query.data;
  const candidate = query.data ?? last.current;
  const result = candidate?.meta.entity === d.entity ? candidate : undefined;
  const stale = !!result && (query.isPlaceholderData || result !== query.data);
  const queryIssues = useMemo(() => fieldIssues(query.error), [query.error]);
  const issues = useMemo(() => [...localIssues, ...queryIssues, ...saveIssues], [localIssues, queryIssues, saveIssues]);
  const shape = useMemo(() => recordFromState(state), [state]);
  const settings = useMemo(() => shape.columns ?? [], [shape.columns]);
  const { shown, hidden } = useMemo(() => (result ? displayColumns(result.columns, settings) : { shown: [], hidden: [] }), [result, settings]);
  const chart = state.chart ?? defaultChart(shown);
  const entityLabel = entityInfo?.label_plural ?? sources.data?.entities.find((e) => e.name === d.entity)?.label ?? d.entity;
  const title = rec?.label ?? (d.entity ? `New report on ${entityLabel}` : "New report");
  const [subtotals, setSubtotals] = useState(false);

  // ── choosing what to report on: the list's columns or a count by status, in one undo step ──
  const picks = useRef(0);
  const pickEntity = useCallback(
    async (entity: string) => {
      const seq = ++picks.current;
      const [meta, cat] = await Promise.all([
        qc
          .ensureQueryData({ queryKey: ["meta", entity], queryFn: ({ signal }) => api.get<EntityMeta>(`/api/meta/${encodeURIComponent(entity)}`, undefined, signal), staleTime: 5 * 60_000 })
          .catch(() => undefined),
        qc.ensureQueryData({ queryKey: studioKeys.fields(entity), queryFn: ({ signal }) => studio.fields(entity, signal), staleTime: 5 * 60_000 }).catch(() => undefined),
      ]);
      if (seq === picks.current) update((s) => startState(s, entity, meta?.list.columns, cat));
    },
    [qc, update],
  );
  // `/studio/reports/new?entity=SalesInvoice` starts on that entity.
  const startEntity = useRef(!sp.get("q") && !record ? sp.get("entity") : null);
  useEffect(() => {
    if (startEntity.current) void pickEntity(startEntity.current);
    startEntity.current = null;
  }, [pickEntity]);

  // ── the URL carries unsaved state (replaced, not pushed: Back leaves the builder) ──
  const setSpRef = useRef(setSp);
  setSpRef.current = setSp;
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      const want = dirty && state.draft.entity ? encodeState(state) : null;
      if (next.get("q") === want && !next.has("entity")) return;
      if (want) next.set("q", want);
      else next.delete("q");
      next.delete("entity");
      setSpRef.current(next, { replace: true, preventScrollReset: true });
    }, 300);
    return () => clearTimeout(t);
    // `state` is read through the key that summarizes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, dirty]);

  // ── leaving with unsaved changes ──
  const allowNav = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !allowNav.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: "Leave without saving?", message: "Your changes to this report will be lost.", confirmLabel: "Leave", danger: true }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ── saving ──
  const save = useSaveStudioRecord("reports");
  const del = useDeleteStudioRecord("reports");
  const [dialog, setDialog] = useState<SaveMode | null>(null);
  const [metaIssues, setMetaIssues] = useState<Issue[]>([]);
  const [general, setGeneral] = useState<string[]>([]);
  const [conflict, setConflict] = useState<SaveMeta | null>(null);
  const [rebasing, setRebasing] = useState(false);

  const body = (m: SaveMeta, asNew: boolean, version?: number): ReportRecord => {
    // A chart report always carries its chart (the one on screen); a chart that no longer fits is
    // kept only when it is what the report shows (the server then says why).
    const drawn = shape.chart ?? (shape.kind === "chart" ? chart : null);
    const chartFits = !!drawn && (state.view === "chart" || !chartIssues(drawn.type, result?.columns, drawn.x, drawn.y ?? []).length);
    return {
      ...(asNew || !rec ? {} : { id: rec.id, version: version ?? rec.version }),
      label: m.label,
      description: m.description || null,
      sharing: m.sharing,
      roles: m.sharing === "roles" ? m.roles.map((role) => ({ role })) : [],
      module: m.module || null,
      kind: shape.kind,
      spec: shape.spec,
      columns: shape.columns,
      chart: chartFits ? drawn : null,
    };
  };

  const persist = async (m: SaveMeta, asNew: boolean, version?: number) => {
    const sentKey = currentKey;
    try {
      const saved = await save.mutateAsync(body(m, asNew, version));
      setDialog(null);
      setConflict(null);
      setMetaIssues([]);
      setGeneral([]);
      setSaveIssues([]);
      toast(asNew ? `Saved “${saved.label}”` : "Changes saved");
      if (asNew || !rec) {
        allowNav.current = true;
        navigate(`/studio/reports/${encodeURIComponent(saved.id ?? "")}?edit=1`, { replace: !rec });
        return;
      }
      setRec(saved);
      setSavedKey(sentKey);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && !asNew && rec) {
        setDialog(null);
        setConflict(m);
        return;
      }
      const all = fieldIssues(e);
      const meta = all.filter((i) => META_FIELDS.has(i.path.split(/[.[]/)[0]));
      const specs = all.filter((i) => i.path.startsWith("spec.")).map((i) => ({ ...i, path: i.path.slice(5) }));
      const other = all.filter((i) => !meta.includes(i) && !i.path.startsWith("spec."));
      setMetaIssues(meta);
      setSaveIssues(specs);
      const messages = [...other.map((i) => `${AREA[i.path.split(/[.[]/)[0]] ?? i.path}: ${i.message}`), ...(specs.length ? ["Some report settings need a fix: they are marked in the settings panel."] : [])];
      setGeneral(all.length ? messages : [errorMessage(e)]);
      if (meta.length && !dialog) setDialog(asNew ? (rec ? "copy" : "create") : "settings");
      if (!dialog && !meta.length) toast(all.length ? messages.join(" ") : errorMessage(e), "error");
    }
  };

  const onSave = () => {
    if (save.isPending || dialog || !d.entity) return;
    if (!rec) return canCreate ? setDialog("create") : undefined;
    if (!canEdit) return canCreate ? setDialog("copy") : undefined;
    if (dirty) void persist(metaOf(rec), false);
  };
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const rebase = async (keepMine: boolean) => {
    if (!rec?.id || !conflict) return;
    setRebasing(true);
    try {
      const latest = await qc.fetchQuery({ queryKey: studioKeys.record("reports", rec.id), queryFn: ({ signal }) => studio.get("reports", rec.id ?? "", signal), staleTime: 0 });
      if (keepMine) await persist(conflict, false, latest.version);
      else {
        const theirs = stateFromRecord(latest) ?? emptyState();
        setRec(latest);
        dispatch({ type: "reset", present: theirs });
        setSavedKey(stateKey(theirs));
        setConflict(null);
        toast("Loaded the latest version", "info");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setRebasing(false);
    }
  };

  const onDelete = async () => {
    if (!rec?.id) return;
    const ok = await confirmDialog({ title: "Delete this report?", message: `“${rec.label}” will be deleted for everyone it is shared with. This cannot be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await del.mutateAsync({ id: rec.id, version: rec.version });
      allowNav.current = true;
      toast(`Deleted “${rec.label}”`);
      navigate("/studio/reports");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const viewReport = async () => {
    if (!rec?.id) return;
    if (dirty && !(await confirmDialog({ title: "Leave the editor?", message: "Your unsaved changes will be lost.", confirmLabel: "Leave", danger: true }))) return;
    allowNav.current = true;
    navigate(`/studio/reports/${encodeURIComponent(rec.id)}`);
  };

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    const name = fileStem(rec?.label ?? entityLabel);
    if (rec?.id && !dirty) {
      setExporting(true);
      try {
        await studio.exportReport(rec.id, {}, `${name}-${todayIso()}.csv`);
      } catch (e) {
        toast(errorMessage(e), "error");
      } finally {
        setExporting(false);
      }
    } else if (result) saveBlob(new Blob([toCsv(shown, result.rows, result.totals)], { type: "text/csv;charset=utf-8" }), `${name}-${todayIso()}.csv`);
  };

  const copyLink = async () => {
    const url = new URL(window.location.href);
    if (dirty && d.entity) url.searchParams.set("q", encodeState(state));
    try {
      await navigator.clipboard.writeText(url.toString());
      toast(dirty && rec ? "Link copied: it opens these unsaved settings in the editor" : "Link copied");
    } catch {
      toast("The link could not be copied; copy it from the address bar.", "error");
    }
  };

  // ── undo, redo, save from the keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        saveRef.current();
      } else if (!isTyping(e.target) && !document.querySelector("[role=dialog],[role=alertdialog]")) {
        if (k === "z") {
          e.preventDefault();
          dispatch({ type: e.shiftKey ? "redo" : "undo" });
        } else if (k === "y") {
          e.preventDefault();
          dispatch({ type: "redo" });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── columns edited from the table ──
  const [formatting, setFormatting] = useState<ResultColumn | null>(null);
  const patch = useCallback(
    (c: ResultColumn, p: Partial<ColumnSetting>, key?: string) => {
      const name = c.role === "pivot" ? (c.measure ?? c.name) : c.name;
      update((s) => {
        const t = withFields(s, shown);
        return { ...t, columns: patchColumn(recordFromState(t).columns ?? [], shown, name, p) };
      }, key);
    },
    [update, shown],
  );
  const editor = useMemo(
    () => ({
      hidden,
      onPatch: patch,
      onMove: shown.some((c) => c.role === "pivot") ? undefined : (from: string, to: string) => update((s) => moveColumn({ ...s, columns: recordFromState(s).columns ?? [] }, shown, from, to)),
      onFormat: (c: ResultColumn) => setFormatting(c),
    }),
    [hidden, patch, shown, update],
  );
  const formatTarget = formatting?.role === "pivot" ? (shown.find((c) => c.name === formatting.measure) ?? hidden.find((c) => c.name === formatting.measure) ?? formatting) : formatting;

  const setView = (view: ViewMode) => update((s) => ({ ...s, view, chart: view === "chart" && !s.chart ? defaultChart(shown) : s.chart }));
  const grouped = d.kind !== "table";
  const dims = shown.filter((c) => c.role === "dimension");
  const canSave = rec ? canEdit || canCreate : canCreate;

  const panel = (
    <BuilderPanel
      state={state}
      update={update}
      catalog={catalog.data}
      catalogLoading={catalog.isLoading}
      catalogError={catalog.error}
      onRetryCatalog={() => void catalog.refetch()}
      sources={sources.data}
      sourcesLoading={sources.isLoading}
      onPickEntity={(e) => void pickEntity(e)}
      issues={issues}
      columns={result?.columns ?? []}
      fyStartMonth={fy}
    />
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const pending = localIssues.length > 0;

  let preview: ReactNode;
  if (!d.entity)
    preview = (
      <Empty className="border border-border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Database aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>What do you want to report on?</EmptyTitle>
          <EmptyDescription>Pick a kind of record — invoices, orders, customers… Then choose columns, or group and measure them, filter, chart and save.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <EntityPicker large sources={sources.data} loading={sources.isLoading} value="" onChange={(e) => void pickEntity(e)} />
        </EmptyContent>
      </Empty>
    );
  else if (query.error && !queryIssues.length)
    preview = <ErrorState title="The preview could not be computed" error={query.error} onRetry={() => void query.refetch()} />;
  else if (!result) preview = pending || queryIssues.length ? null : <ResultSkeleton />;
  else
    preview = (
      <div className={pending || queryIssues.length || stale ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={query.isFetching || undefined}>
        <div className="grid gap-2">
          <ResultNotices meta={result.meta} entityLabel={entityLabel} onMoreRows={() => update((s) => ({ ...s, draft: { ...s.draft, limit: Math.min(10_000, Math.max(2000, (s.draft.limit ?? 500) * 4)) } }))} />
          {!result.rows.length ? (
            <NoRows />
          ) : (
            <ResultView
              view={state.view}
              chart={chart}
              columns={shown}
              rows={result.rows}
              totals={result.totals}
              sort={d.sort}
              onSort={(sort) => update((s) => ({ ...s, draft: { ...s.draft, sort } }))}
              editor={editor}
              subtotals={subtotals}
              options={options}
              entity={d.kind === "table" ? d.entity : undefined}
              title={title}
            />
          )}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {result.meta.row_count.toLocaleString()} {result.meta.row_count === 1 ? "row" : "rows"} · computed in {Math.round(result.meta.sql_ms)} ms
          </p>
        </div>
      </div>
    );

  const attention = [...localIssues, ...queryIssues];

  return (
    <div className="grid gap-4 pointer-coarse:[&_[data-slot=button]]:min-h-11 pointer-coarse:[&_[data-slot=button]]:min-w-11 pointer-coarse:[&_[data-slot=input]]:h-11 pointer-coarse:[&_[data-slot=select-trigger]]:min-h-11 pointer-coarse:[&_[data-slot=toggle-group-item]]:min-h-11">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="mb-1 text-xs text-muted-foreground">
            <Link to="/studio/reports" className="hover:text-foreground hover:underline">
              Reports
            </Link>
            {rec?.id && (
              <>
                {" / "}
                <Link
                  to={`/studio/reports/${encodeURIComponent(rec.id)}`}
                  className="hover:text-foreground hover:underline"
                  onClick={(e) => {
                    e.preventDefault();
                    void viewReport();
                  }}
                >
                  {rec.label}
                </Link>
              </>
            )}
          </nav>
          <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold">
            <span className="truncate">{title}</span>
            {dirty && (
              <Badge variant="secondary" className="shrink-0">
                Unsaved
              </Badge>
            )}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonGroup aria-label="History">
            <Button variant="outline" size="icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!history.past.length} onClick={() => dispatch({ type: "undo" })}>
              <Undo2 />
            </Button>
            <Button variant="outline" size="icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!history.future.length} onClick={() => dispatch({ type: "redo" })}>
              <Redo2 />
            </Button>
          </ButtonGroup>
          {rec?.id && (
            <Button variant="outline" onClick={() => void viewReport()}>
              <Play /> View
            </Button>
          )}
          {canExport && (
            <Button variant="outline" disabled={!result?.rows.length || exporting} onClick={() => void exportCsv()} title={rec?.id && !dirty ? "Every row (up to 10,000) as CSV" : "The rows shown, as CSV"}>
              {exporting ? <Spinner /> : <Download />} CSV
            </Button>
          )}
          {canSave && (
            <Button onClick={onSave} disabled={save.isPending || !d.entity || (!!rec && canEdit && !dirty)} title="Save (Ctrl+S)">
              {save.isPending ? <Spinner /> : <Save />}
              {rec && !canEdit ? "Save a copy" : "Save"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {rec && canEdit && (
                <DropdownMenuItem onSelect={() => setDialog("settings")}>
                  <Settings2 /> Name and sharing…
                </DropdownMenuItem>
              )}
              {canCreate && d.entity && (
                <DropdownMenuItem onSelect={() => setDialog(rec ? "copy" : "create")}>
                  <Copy /> {rec ? "Save a copy…" : "Save as…"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={!d.entity} onSelect={() => void copyLink()}>
                <Link2 /> Copy link
              </DropdownMenuItem>
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => void onDelete()}>
                    <Trash2 /> Delete report
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {start.badLink && (
        <Alert>
          <AlertTitle>The link’s report settings could not be read</AlertTitle>
          <AlertDescription>{rec ? "Showing the saved report instead." : "Start by choosing what to report on."}</AlertDescription>
        </Alert>
      )}
      {start.badRecord && (
        <Alert variant="destructive">
          <AlertTitle>This report’s settings could not be read</AlertTitle>
          <AlertDescription>Set it up again and save to repair it.</AlertDescription>
        </Alert>
      )}
      {rec?.is_standard && (
        <Alert>
          <AlertTitle>This report comes with an app</AlertTitle>
          <AlertDescription>It cannot be changed; save a copy to make it your own.</AlertDescription>
        </Alert>
      )}
      {!canSave && d.entity && (
        <Alert>
          <AlertDescription>You can explore freely, but saving reports needs permission to create them.</AlertDescription>
        </Alert>
      )}

      <div className={wide ? "grid grid-cols-[minmax(300px,360px)_minmax(0,1fr)] items-start gap-4" : "grid gap-3"}>
        {wide ? (
          <aside aria-label="Report settings" className="sticky top-[calc(var(--topbar-h)+1rem)] max-h-[calc(100dvh-var(--topbar-h)-2rem)] overflow-y-auto rounded-lg border border-border bg-card">
            {panel}
          </aside>
        ) : (
          <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
            <SheetContent side="left" className="w-[min(92vw,420px)] gap-0 overflow-y-auto p-0 sm:max-w-none">
              <SheetHeader className="border-b border-border">
                <SheetTitle>Report settings</SheetTitle>
                <SheetDescription>Changes show in the preview as you make them.</SheetDescription>
              </SheetHeader>
              {panel}
            </SheetContent>
          </Sheet>
        )}
        <section aria-label="Preview" className="grid min-w-0 gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {!wide && (
              <Button variant="outline" onClick={() => setPanelOpen(true)}>
                <SlidersHorizontal /> Settings
                {attention.length > 0 && (
                  <Badge variant="destructive" className="ml-1" aria-label={`${attention.length} to fix`}>
                    {attention.length}
                  </Badge>
                )}
              </Button>
            )}
            {d.entity && <ViewToggle value={state.view} onChange={setView} chartable={grouped} />}
            {state.view === "table" && dims.length >= 2 && (
              <Label className="h-9 gap-2 rounded-md border border-input px-2.5 font-normal">
                <Switch checked={subtotals} onCheckedChange={setSubtotals} />
                Subtotals by {dims[0].label}
              </Label>
            )}
            {query.isFetching && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <Spinner /> Updating…
              </span>
            )}
          </div>
          {state.view === "chart" && grouped && result && <ChartSettingsBar settings={chart} columns={shown} onChange={(c) => update((s) => ({ ...s, chart: c }))} />}
          {attention.length > 0 && (
            <Alert variant={pending ? "default" : "destructive"}>
              <AlertTitle>{pending ? "Finish the settings to update the preview" : "The server could not run these settings"}</AlertTitle>
              <AlertDescription>
                <ul className="grid gap-0.5">
                  {[...new Set(attention.map((i) => i.message))].slice(0, 6).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
                {!wide && (
                  <Button size="sm" variant="outline" className="mt-1" onClick={() => setPanelOpen(true)}>
                    Open the settings
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          {preview}
        </section>
      </div>

      {dialog && (
        <SaveDialog
          key={dialog}
          mode={dialog}
          initial={dialog === "copy" ? { ...metaOf(rec), label: rec ? `Copy of ${rec.label}`.slice(0, 140) : "", sharing: "private", roles: [] } : metaOf(rec, start.copyLabel)}
          busy={save.isPending}
          issues={metaIssues}
          general={general}
          onCancel={() => {
            setDialog(null);
            setMetaIssues([]);
            setGeneral([]);
          }}
          onSubmit={(m) => void persist(m, dialog !== "settings" && (dialog === "copy" || !rec))}
        />
      )}
      <ConflictDialog open={!!conflict} busy={rebasing} onOverwrite={() => void rebase(true)} onLoadTheirs={() => void rebase(false)} onCancel={() => setConflict(null)} />
      {formatTarget && (
        <ColumnDialog
          key={formatTarget.name}
          column={formatting?.role === "pivot" ? { ...formatting, label: formatTarget.label } : formatTarget}
          setting={settingOf(settings, formatting ?? formatTarget)}
          defaultLabel={result?.columns.find((c) => c.name === formatTarget.name)?.label ?? formatTarget.label}
          sample={result?.rows.find((r) => r[formatting?.name ?? formatTarget.name] != null)?.[formatting?.name ?? formatTarget.name]}
          options={options}
          onClose={() => setFormatting(null)}
          onApply={(p) => patch(formatTarget, p)}
        />
      )}
    </div>
  );
}
