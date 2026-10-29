// The chart builder: a DashboardChart over a query, a saved report or a built-in report, its type
// (bar, stacked bar, line, area, pie, donut, percentage, heatmap, scatter, funnel, number), axes,
// colours, the dashboard filters it takes and who may open it, with a live preview from the
// server. Opens as a page (/studio/charts/:id) or inside a dashboard's editor (`ChartBuilder`).

import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Copy, Ellipsis, Table2, Trash2, TriangleAlert } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { formatDecimal } from "@/lib/format";
import { useEntityMeta, useEntityPlural } from "@/lib/meta";
import { cn } from "@/lib/utils";
import {
  chartIssues,
  columnLabel,
  emptyDraft,
  fieldIssues,
  issuesAt,
  studio,
  toChart,
  useChartPreview,
  useDeleteStudioRecord,
  useStudioFields,
  useStudioList,
  useStudioRecord,
  useStudioSources,
  type ChartRecord,
  type ChartSource,
  type ChartType,
  type FilterDef,
  type FilterValues,
  type Issue,
  type ResultColumn,
  type SpecDraft,
} from "@/lib/studio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast, useDebounced } from "@/ui/kit";
import { LinkInput } from "../widgets";
import { BuilderToolbar, ConflictNotice, duplicateOf, specPart, StandardNotice, useBuilder } from "./dashboard/builder";
import { axisColumns, CHART_TYPE_LABEL, toSlices, valueColumns } from "./dashboard/charts";
import { ChartView, ResultTable } from "./dashboard/ChartView";
import { CHART_ICON } from "./dashboard/icons";
import { asRecordIssue, blankChart, chartDraft, chartIssuesLocal, chartRecord } from "./dashboard/records";
import { QueryEditor } from "./dashboard/QueryEditor";
import { AcceptsEditor, LabelFields, SharingFields } from "./dashboard/RecordFields";
import { EntityPicker, SearchSelect } from "./dashboard/pickers";
import { ErrorBlock, goBack, LoadingBlock, Messages, PageHeader, Section, SheetState, UnsavedGuard, useConfirm } from "./dashboard/ui";

/** The dashboard a builder was opened from: its filters, for previews and the accepts map. */
export interface BuilderContext {
  dashboardId?: string;
  filterDefs: FilterDef[];
  values: FilterValues;
}

const NO_CONTEXT: BuilderContext = { filterDefs: [], values: {} };

const TYPES = Object.keys(CHART_ICON) as ChartType[];
const toDraft = chartDraft;
const toRecord = chartRecord;
/** The theme's series colours (light), the starting point of a custom palette. */
const THEME_HEX = ["#2f5bea", "#0f8f80", "#b7791f", "#7c4ddb", "#d23f45", "#2f8a42", "#d55a06", "#5b6b80"];
const AUTO = "__auto";
const ANY = "__any";

// ───────────────────────────── page ─────────────────────────────

export function ChartBuilderPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const existing = useStudioRecord("charts", isNew ? undefined : id);
  if (!isNew && existing.error) return <ErrorBlock error={existing.error} onRetry={() => existing.refetch()} title="Could not open this chart" />;
  if (!isNew && !existing.data) return <LoadingBlock rows={4} />;
  return (
    <ChartEditor
      key={id ?? "new"}
      initial={isNew ? blankChart(sp) : existing.data!}
      context={NO_CONTEXT}
      onSaved={(saved, created) => created && navigate(`/studio/charts/${saved.id}`, { replace: true })}
      onClose={() => goBack(navigate, "/studio/dashboards?tab=charts")}
    />
  );
}

/** The builder inside a dashboard's editor: a chart by id, or a new one; `onSaved` gets the saved record. */
export function ChartBuilder({
  id,
  context,
  onSaved,
  onClose,
  cancelRef,
}: {
  id?: string;
  context: BuilderContext;
  onSaved: (r: ChartRecord) => void;
  onClose: () => void;
  /** Set to the builder's cancel (it asks before discarding changes), for the sheet's Escape key. */
  cancelRef?: { current: (() => void) | null };
}) {
  const existing = useStudioRecord("charts", id);
  if (id && !existing.data) {
    if (cancelRef) cancelRef.current = onClose;
    return (
      <SheetState title="Chart" onClose={onClose}>
        {existing.error ? <ErrorBlock error={existing.error} onRetry={() => existing.refetch()} title="Could not open this chart" /> : <LoadingBlock rows={4} />}
      </SheetState>
    );
  }
  return <ChartEditor key={id ?? "new"} initial={id ? existing.data! : blankChart()} context={context} embedded cancelRef={cancelRef} onSaved={(r) => onSaved(r)} onClose={onClose} />;
}

// ───────────────────────────── editor ─────────────────────────────

function ChartEditor({
  initial,
  context,
  embedded = false,
  cancelRef,
  onSaved,
  onClose,
}: {
  initial: ChartRecord;
  context: BuilderContext;
  embedded?: boolean;
  cancelRef?: { current: (() => void) | null };
  onSaved: (r: ChartRecord, created: boolean) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const leave = useRef(() => {});
  const b = useBuilder({
    kind: "charts",
    initial,
    toDraft,
    toRecord,
    onSaved: (r, created) => {
      if (created) leave.current(); // the page moves to the saved chart's address
      onSaved(r, created);
    },
    noun: "chart",
  });
  const { rec, query } = b.draft;
  const allowLeave = () => leave.current();
  const { confirm, dialog } = useConfirm();
  const remove = useDeleteStudioRecord("charts");
  const [tab, setTab] = useState("data");
  const [table, setTable] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  const setRec = (patch: Partial<ChartRecord>, key?: string) => b.set((d) => ({ ...d, rec: { ...d.rec, ...patch } }), key);
  const setQuery = (q: SpecDraft, key?: string) => b.set((d) => ({ ...d, query: q }), key);

  const sources = useStudioSources();
  const reports = useStudioList("reports");
  const plural = useEntityPlural();
  const builtinDef = sources.data?.builtin.find((r) => r.name === rec.builtin_report);
  const reportRow = reports.data?.find((r) => r.id === rec.report);
  const baseEntity = rec.source === "query" ? query.entity : rec.source === "report" ? (reportRow?.base_entity ?? undefined) : undefined;
  const catalog = useStudioFields(baseEntity || undefined);

  const local = chartIssuesLocal(b.draft, catalog.data, (builtinDef?.params ?? []).filter((p) => p.required).map((p) => p.name));
  const record = b.record;
  // Debounced by value (the record is rebuilt on every render).
  const reqKey = local.length ? "" : JSON.stringify({ record: { ...record, label: record.label || "Preview" }, filter_defs: context.filterDefs, values: context.values });
  const debouncedKey = useDebounced(reqKey, 400);
  const req = useMemo(() => (debouncedKey ? JSON.parse(debouncedKey) : undefined), [debouncedKey]);
  const preview = useChartPreview(req);
  const previewIssues = fieldIssues(preview.error).map(asRecordIssue);
  // What is still missing shows in the preview at once, and next to its setting after a save attempt.
  const missingLabel = rec.label.trim() ? [] : [{ path: "label", message: "Give the chart a title" }];
  const issues = [...b.serverIssues, ...previewIssues, ...(showIssues ? [...local, ...missingLabel] : [])];
  const columns: ResultColumn[] | undefined = preview.data?.data.columns;
  const typeIssues = chartIssues(rec.chart_type, columns, rec.x_field, rec.y_fields ?? [], rec.colors ?? []);

  const doSave = async () => {
    const missing = [...missingLabel, ...local];
    if (missing.length) {
      setShowIssues(true);
      if (missingLabel.length) document.getElementById("chart-label")?.focus();
      else if (local.some((i) => i.path.startsWith("spec") || i.path.startsWith("report") || i.path.startsWith("builtin"))) setTab("data");
      toast(missing[0].message, "error");
      return;
    }
    await b.save();
  };
  const cancel = async () => {
    if (b.dirty && !b.standard && !(await confirm({ title: "Discard your changes?", message: "The chart keeps its last saved settings.", confirmLabel: "Discard", danger: true }))) return;
    allowLeave();
    onClose();
  };
  if (cancelRef) cancelRef.current = () => void cancel();
  const duplicate = async () => {
    try {
      const copy = await studio.save("charts", duplicateOf(toRecord(b.draft)));
      toast("Copy made");
      if (embedded) onSaved(copy, true);
      else navigate(`/studio/charts/${copy.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const del = async () => {
    if (!b.base.id) return;
    const ok = await confirm({ title: `Delete “${b.base.label}”?`, message: "The chart is removed for everyone. Dashboards that show it must drop it first.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await remove.mutateAsync({ id: b.base.id, version: b.base.version });
      toast("Chart deleted");
      allowLeave();
      navigate("/studio/dashboards?tab=charts");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const toolbar = (
    <BuilderToolbar
      {...b}
      onSave={() => void doSave()}
      onCancel={() => void cancel()}
      cancelLabel={embedded ? "Cancel" : b.dirty ? "Cancel" : "Back"}
      saveLabel={embedded && !b.base.id ? "Save and add" : "Save"}
      extra={
        b.base.id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void duplicate()}>
                <Copy /> Make a copy
              </DropdownMenuItem>
              {!embedded && !b.standard && (
                <DropdownMenuItem variant="destructive" onSelect={() => void del()}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    />
  );

  const settings = (
    <div className="grid gap-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="chart">Chart</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="data" className="grid gap-5 pt-3">
          <SourcePicker value={rec.source} onChange={(source) => setRec({ source, x_field: null, y_fields: null })} />
          {rec.source === "query" && (
            <>
              <div className="grid gap-1.5">
                <Label>Report on</Label>
                <EntityChoice value={query.entity} onChange={(entity) => setQuery({ ...emptyDraft(entity, "group_by"), period: null })} />
                <Messages list={issuesAt(issues, "spec.entity")} />
              </div>
              {query.entity && <QueryEditor draft={query} onChange={setQuery} catalog={catalog.data} mode="chart" issues={specPart(issues)} columns={columns} />}
              <Messages list={issuesAt(issues, "spec").filter((m) => !specPart(issues).some((i) => i.path && i.message === m))} />
            </>
          )}
          {rec.source === "report" && (
            <div className="grid gap-1.5">
              <Label>Saved report</Label>
              <SearchSelect
                value={rec.report}
                loading={reports.isLoading}
                label="Saved report"
                placeholder="Choose a report…"
                fallbackLabel="A report you cannot open"
                options={(reports.data ?? []).map((r) => ({ value: r.id, label: r.label, hint: r.kind.replace("_", " "), group: r.base_entity ? plural(r.base_entity) : undefined }))}
                onChange={(report) => setRec({ report, x_field: null, y_fields: null })}
              />
              <p className="text-xs text-muted-foreground">The chart follows the report: its query, columns and labels.</p>
              <Messages list={issuesAt(issues, "report")} />
            </div>
          )}
          {rec.source === "builtin" && (
            <BuiltinSettings
              name={rec.builtin_report ?? null}
              params={rec.builtin_params ?? {}}
              sources={sources.data?.builtin ?? []}
              loading={sources.isLoading}
              issues={issues}
              onReport={(builtin_report) => setRec({ builtin_report, builtin_params: null, x_field: null, y_fields: null })}
              onParams={(builtin_params, key) => setRec({ builtin_params }, key)}
            />
          )}
        </TabsContent>
        <TabsContent value="chart" className="grid gap-5 pt-3">
          <Section title="Chart type">
            <ToggleGroup type="single" variant="outline" spacing={1} value={rec.chart_type} onValueChange={(t) => t && setRec({ chart_type: t as ChartType })} className="grid w-full grid-cols-3 gap-1.5 sm:grid-cols-4" aria-label="Chart type">
              {TYPES.map((t) => {
                const Icon = CHART_ICON[t];
                const fits = !columns || !chartIssues(t, columns, rec.x_field, rec.y_fields ?? []).length;
                return (
                  <ToggleGroupItem key={t} value={t} className={cn("h-auto flex-col gap-1 rounded-md py-2 text-xs", !fits && "opacity-55")} title={fits ? undefined : "Does not fit this data yet"}>
                    <Icon className="size-5" />
                    {CHART_TYPE_LABEL[t]}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            {typeIssues.length > 0 && (
              <Alert>
                <TriangleAlert />
                <AlertDescription>
                  {typeIssues.map((m) => (
                    <p key={m}>{m.charAt(0).toUpperCase() + m.slice(1)}.</p>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            <Messages list={issuesAt(issues, "chart_type")} />
          </Section>
          <AxesSettings type={rec.chart_type} columns={columns} x={rec.x_field ?? null} y={rec.y_fields ?? []} onX={(x_field) => setRec({ x_field })} onY={(y_fields) => setRec({ y_fields })} issues={issues} />
          <ColorsSettings colors={rec.colors ?? []} labels={seriesLabels(rec, preview.data?.data)} onChange={(colors, key) => setRec({ colors }, key)} issues={issues} />
        </TabsContent>
        <TabsContent value="settings" className="grid gap-5 pt-3">
          <AcceptsEditor value={rec.accepts} onChange={(accepts) => setRec({ accepts })} defs={context.filterDefs} catalog={catalog.data} params={rec.source === "builtin" ? builtinDef?.params : undefined} issues={issues} />
          <SharingFields value={rec} onChange={setRec} issues={issues} />
        </TabsContent>
      </Tabs>
    </div>
  );

  const meta = preview.data?.data && "meta" in preview.data.data ? (preview.data.data.meta as { row_count?: number; sql_ms?: number; truncated?: boolean } | undefined) : undefined;
  const previewPane = (
    <section aria-label="Preview" className="flex h-[22rem] flex-col rounded-xl border bg-card shadow-sm lg:sticky lg:top-4 lg:h-[min(36rem,calc(100vh-10rem))]">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{rec.label || "Preview"}</h2>
        {preview.isFetching && <Spinner className="text-muted-foreground" aria-label="Updating the preview" />}
        <Button type="button" variant={table ? "secondary" : "ghost"} size="sm" aria-pressed={table} onClick={() => setTable((t) => !t)} disabled={!preview.data}>
          <Table2 /> Table
        </Button>
      </header>
      <div className="relative min-h-0 flex-1 p-3" aria-live="polite" aria-busy={preview.isFetching || undefined}>
        {local.length > 0 ? (
          <div className="grid h-full place-content-center gap-1 text-center text-sm text-muted-foreground">
            <p>Finish the data settings to see a preview:</p>
            {local.slice(0, 4).map((i) => (
                <p key={i.path + i.message} className="text-xs">
                  {i.message}
                </p>
              ))}
          </div>
        ) : preview.error && !preview.data ? (
          <ErrorBlock error={preview.error} onRetry={() => preview.refetch()} title="The preview could not run" className="h-full" />
        ) : !preview.data ? (
          <Skeleton className="h-full w-full" />
        ) : table ? (
          <ResultTable data={preview.data.data} className="h-full" />
        ) : (
          <ChartView type={rec.chart_type} data={preview.data.data} x={rec.x_field} y={rec.y_fields} colors={rec.colors} title={rec.label || "Preview"} />
        )}
        {!!preview.error && !!preview.data && <p className="absolute inset-x-3 bottom-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{errorMessage(preview.error, false)}</p>}
      </div>
      {meta && (
        <footer className="flex flex-wrap gap-x-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
          {meta.row_count != null && <span>{formatDecimal(meta.row_count, 0)} rows</span>}
          {meta.sql_ms != null && <span>{formatDecimal(meta.sql_ms)} ms</span>}
          {meta.truncated && <span className="text-warning">More rows matched than the limit</span>}
        </footer>
      )}
    </section>
  );

  return (
    <div className={cn(embedded && "flex h-full min-h-0 flex-col")}>
      {dialog}
      {!embedded && <UnsavedGuard dirty={b.dirty && !b.standard} allowRef={leave} />}
      <div className={cn(embedded && "border-b p-4 pr-12")}>
        <PageHeader
          eyebrow={
            embedded ? undefined : (
              <Link to="/studio/dashboards?tab=charts" className="text-muted-foreground">
                Charts
              </Link>
            )
          }
          title={rec.label || (b.base.id ? "Untitled chart" : "New chart")}
          description={b.dirty && !b.standard ? "Unsaved changes" : undefined}
          actions={toolbar}
        />
      </div>
      <div className={cn(embedded && "min-h-0 flex-1 overflow-auto p-4")}>
        {b.standard && <StandardNotice noun="chart" onDuplicate={() => void duplicate()} />}
        {b.conflict && <ConflictNotice conflict={b.conflict} noun="chart" onDismiss={b.dismissConflict} />}
        <div className="grid gap-4 lg:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] lg:items-start">
          <div className={cn("order-2 grid gap-4 lg:order-1", b.standard && "pointer-events-none opacity-60")} inert={b.standard || undefined}>
            <LabelFields value={rec} onChange={setRec} issues={issues} labelId="chart-label" />
            {settings}
          </div>
          <div className="order-1 lg:order-2">{previewPane}</div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── parts ─────────────────────────────

const SOURCE_LABEL: Record<ChartSource, string> = { query: "A query", report: "A saved report", builtin: "A built-in report" };

function SourcePicker({ value, onChange }: { value: ChartSource; onChange: (s: ChartSource) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label id="chart-source">Data from</Label>
      <ToggleGroup type="single" variant="outline" value={value} onValueChange={(v) => v && onChange(v as ChartSource)} aria-labelledby="chart-source" className="w-full">
        {(Object.keys(SOURCE_LABEL) as ChartSource[]).map((s) => (
          <ToggleGroupItem key={s} value={s} className="flex-1 text-xs sm:text-sm">
            {SOURCE_LABEL[s]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function EntityChoice({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  const meta = useEntityMeta(value || undefined);
  return <EntityPicker value={value || null} label="Report on" fallbackLabel={meta.data?.label} onChange={onChange} />;
}

function BuiltinSettings({
  name,
  params,
  sources,
  loading,
  issues,
  onReport,
  onParams,
}: {
  name: string | null;
  params: Record<string, string>;
  sources: { name: string; label: string; module?: string; params: { name: string; label?: string; type: string; to?: string; options?: string[]; required?: boolean }[] }[];
  loading: boolean;
  issues: Issue[];
  onReport: (n: string) => void;
  onParams: (p: Record<string, string>, key?: string) => void;
}) {
  const def = sources.find((r) => r.name === name);
  const set = (k: string, v: string) => onParams({ ...params, [k]: v }, `param-${k}`);
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label>Built-in report</Label>
        <SearchSelect value={name} loading={loading} label="Built-in report" placeholder="Choose a report…" options={sources.map((r) => ({ value: r.name, label: r.label, group: r.module ?? "Other" }))} onChange={onReport} />
        <Messages list={issuesAt(issues, "builtin_report")} />
      </div>
      {def && def.params.length > 0 && (
        <Section title="Parameters" hint="Leave a parameter empty for the report's default. Dashboard filters fill them in too.">
          {def.params.map((p) => {
            const label = p.label ?? p.name.replace(/_/g, " ");
            const v = params[p.name] ?? "";
            return (
              <div key={p.name} className="grid gap-1">
                <Label className="text-xs font-normal text-muted-foreground">
                  {label}
                  {p.required && <span className="text-destructive"> *</span>}
                </Label>
                {p.type === "link" && p.to ? (
                  <div className="[&_.input]:h-9">
                    <LinkInput to={p.to} value={v || null} label={label} onChange={(id) => set(p.name, id ?? "")} />
                  </div>
                ) : p.type === "select" && p.options?.length ? (
                  <Select value={v || ANY} onValueChange={(x) => set(p.name, x === ANY ? "" : x)}>
                    <SelectTrigger aria-label={label} className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Default</SelectItem>
                      {p.options.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : p.type === "check" ? (
                  <Select value={v || ANY} onValueChange={(x) => set(p.name, x === ANY ? "" : x)}>
                    <SelectTrigger aria-label={label} className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Default</SelectItem>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input type={p.type === "date" ? "date" : "text"} inputMode={p.type === "int" ? "numeric" : undefined} value={v} aria-label={label} className="h-9" onChange={(e) => set(p.name, e.target.value)} />
                )}
              </div>
            );
          })}
          <Messages list={issuesAt(issues, "builtin_params")} />
        </Section>
      )}
    </div>
  );
}

function AxesSettings({ type, columns, x, y, onX, onY, issues }: { type: ChartType; columns: ResultColumn[] | undefined; x: string | null; y: string[]; onX: (x: string | null) => void; onY: (y: string[] | null) => void; issues: Issue[] }) {
  if (!columns) return <Section title="Axes" hint="The preview's columns appear here once it runs.">{null}</Section>;
  const axes = axisColumns(columns);
  const values = valueColumns(columns);
  const single = ["pie", "donut", "percentage", "funnel", "number", "heatmap"].includes(type);
  const toggle = (name: string, on: boolean) => {
    const current = y.length ? y : [];
    const next = single ? (on ? [name] : []) : on ? [...current, name] : current.filter((n) => n !== name);
    onY(next.length ? values.map((c) => c.name).filter((n) => next.includes(n)) : null);
  };
  return (
    <Section title="Axes" hint={type === "scatter" ? "The first value runs along the x axis, the second up the y axis." : undefined}>
      {type !== "number" && axes.length > 0 && (
        <div className="grid gap-1">
          <Label className="text-xs font-normal text-muted-foreground">{type === "pie" || type === "donut" || type === "percentage" || type === "funnel" ? "Slices" : "X axis"}</Label>
          <Select value={x ?? AUTO} onValueChange={(v) => onX(v === AUTO ? null : v)}>
            <SelectTrigger className="h-9 w-full" aria-label="X axis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Automatic (the first grouping)</SelectItem>
              {axes.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {columnLabel(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Messages list={issuesAt(issues, "x_field")} />
        </div>
      )}
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-xs text-muted-foreground">{single ? "Value" : "Values"} (none ticked: {single ? "the first" : "all of them"})</legend>
        {values.map((c) => (
          <Label key={c.name} className="flex items-center gap-2 text-sm font-normal">
            <Checkbox checked={y.includes(c.name)} onCheckedChange={(on) => toggle(c.name, on === true)} />
            {columnLabel(c)}
          </Label>
        ))}
        {!values.length && <p className="text-sm text-muted-foreground">The result has no number columns to plot.</p>}
        <Messages list={issuesAt(issues, "y_fields")} />
      </fieldset>
    </Section>
  );
}

/** Series names for the colour swatches, from the preview. */
function seriesLabels(rec: ChartRecord, data: Parameters<typeof toChart>[0] | undefined): string[] {
  if (!data) return [];
  if (["pie", "donut", "percentage", "funnel"].includes(rec.chart_type)) return toSlices(data, { x: rec.x_field, y: rec.y_fields, kind: rec.chart_type === "funnel" ? "funnel" : "pie" }).slices.map((s) => s.label);
  return toChart(data, { x: rec.x_field, y: rec.y_fields }).series.map((s) => s.label);
}

function ColorsSettings({ colors, labels, onChange, issues }: { colors: string[]; labels: string[]; onChange: (c: string[], key?: string) => void; issues: Issue[] }) {
  const custom = colors.length > 0;
  const count = Math.min(Math.max(labels.length, colors.length, 1), 20);
  return (
    <Section
      title="Colours"
      hint={custom ? "Fixed colours, the same in light and dark mode." : "The theme's palette, adjusted for light and dark mode."}
      action={
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(custom ? [] : THEME_HEX.slice(0, Math.min(count, 8)))}>
          {custom ? "Use the theme" : "Customize"}
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: custom ? count : Math.min(count, 8) }, (_, i) => {
          const label = labels[i] ?? `Series ${i + 1}`;
          return custom ? (
            <label key={i} className="flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(colors[i] ?? "") ? colors[i] : THEME_HEX[i % 8]}
                onChange={(e) => {
                  const next = Array.from({ length: Math.max(colors.length, i + 1) }, (_, n) => colors[n] ?? THEME_HEX[n % 8]);
                  next[i] = e.target.value.toLowerCase();
                  onChange(next, `color-${i}`);
                }}
                aria-label={`Colour of ${label}`}
                className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <span className="max-w-28 truncate">{label}</span>
            </label>
          ) : (
            <span key={i} className="flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs">
              <span className="size-5 rounded" style={{ background: `var(--chart-${(i % 8) + 1})` }} aria-hidden="true" />
              <span className="max-w-28 truncate">{label}</span>
            </span>
          );
        })}
      </div>
      <Messages list={issuesAt(issues, "colors")} />
    </Section>
  );
}
