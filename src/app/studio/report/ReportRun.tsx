// A saved report, run for the viewer with their own permissions: extra filters, a search, another
// period and the sort apply on top of the saved settings without changing them; they live in the
// URL (`?r=`) so a filtered run can be shared. Editors open the builder from here.

import { Copy, Download, Ellipsis, Link2, ListFilter, Pencil, RotateCcw, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, errorMessage } from "@/lib/api";
import { formatDate, todayIso } from "@/lib/format";
import { can, useMe, useMetaIndex, type Access } from "@/lib/meta";
import { DATE_PRESETS, fieldIssues, presetOf, resolveDate, STUDIO_ENTITY, studio, useReportRun, useStudioFields, useStudioRecord, type CellOptions, type SpecFilter } from "@/lib/studio";
import { ErrorState, PageLoading, toast, useDebounced } from "@/ui/kit";
import { filterFields, FilterEditor } from "./FilterEditor";
import { fileStem, NoRows, ResultNotices, ResultView, ViewToggle } from "./Preview";
import { decodeParam, defaultChart, displayColumns, encodeParam, filterIssues, recordFromState, sanitizeFilters, sanitizeRuntime, stateFromRecord, type RunState } from "./state";

export function ReportRun({ id }: { id: string }) {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const me = useMe();
  const index = useMetaIndex();
  const fy = me.data?.fiscal_year_start_month ?? 1;
  const options = useMemo<CellOptions>(() => ({ fyStartMonth: fy }), [fy]);

  const rt = useMemo(() => sanitizeRuntime(decodeParam(sp.get("r"))), [sp]);
  const { view, ...runtime } = rt;
  const setRt = (next: RunState) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        const clean = sanitizeRuntime(next);
        if (Object.keys(clean).length) n.set("r", encodeParam(clean));
        else n.delete("r");
        return n;
      },
      { replace: true, preventScrollReset: true },
    );
  const rtRef = useRef(rt);
  rtRef.current = rt;

  const run = useReportRun(id, runtime);
  // After a failed change (a filter the server refuses) the last good result stays, with the error above it.
  const last = useRef(run.data);
  if (run.data) last.current = run.data;
  const current = run.data ?? last.current;
  const report = current?.report;
  const data = current?.data;
  const entity = report?.base_entity ?? data?.meta.entity ?? undefined;
  const catalog = useStudioFields(entity);
  const record = useStudioRecord("reports", id);

  const reportPerms = index.data?.entities.find((e) => e.name === STUDIO_ENTITY.reports)?.permissions;
  const owned = (a: Access | undefined) => a === "all" || (a === "own" && record.data?.created_by === me.data?.user.id);
  const canEdit = !!record.data && !record.data.is_standard && owned(reportPerms?.write);
  const canCopy = !!record.data && can(reportPerms, "create");
  const entityInfo = index.data?.entities.find((e) => e.name === entity);
  const canExport = can(entityInfo?.permissions, "export");

  const settings = useMemo(() => report?.columns ?? [], [report]);
  const shown = useMemo(() => (data ? displayColumns(data.columns, settings).shown : []), [data, settings]);
  const grouped = !!report && report.kind !== "table";
  const viewMode = grouped ? (view ?? (report?.kind === "chart" ? "chart" : "table")) : "table";
  const chart = report?.chart ?? defaultChart(shown);

  // Typed filters and search apply together a moment after the last keystroke (filters once complete).
  const [filters, setFilters] = useState<SpecFilter[]>(() => sanitizeFilters(rt.filters));
  const [showFilters, setShowFilters] = useState(filters.length > 0);
  const [search, setSearch] = useState(rt.search ?? "");
  const incomplete = filterIssues(filters);
  const typed = useMemo(() => ({ filters: incomplete.length ? null : filters, search: search.trim() || undefined }), [filters, search, incomplete.length]);
  const applied = useDebounced(typed, 400);
  useEffect(() => {
    const cur = rtRef.current;
    const next = applied.filters ?? cur.filters ?? [];
    if (JSON.stringify(next) === JSON.stringify(cur.filters ?? []) && applied.search === cur.search) return;
    setRt({ ...cur, filters: next, search: applied.search });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  const [exporting, setExporting] = useState(false);
  const exportAs = async (format: "csv" | "xlsx") => {
    setExporting(true);
    try {
      await studio.exportReport(id, runtime, `${fileStem(report?.label ?? "report")}-${todayIso()}.${format}`, format);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setExporting(false);
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast(Object.keys(runtime).length ? "Link copied, with these filters" : "Link copied");
    } catch {
      toast("The link could not be copied; copy it from the address bar.", "error");
    }
  };
  const duplicate = () => {
    const s = record.data && stateFromRecord(record.data);
    if (!s || !record.data) return;
    navigate(`/studio/reports/new?q=${encodeParam({ ...recordFromState(s), view: s.view, label: `Copy of ${record.data.label}`.slice(0, 140) })}`);
  };
  const reset = () => {
    setFilters([]);
    setSearch("");
    setRt(view ? { view } : {});
  };

  if (!current) {
    if (run.error) {
      const gone = run.error instanceof ApiError && run.error.status === 404;
      return (
        <div className="grid gap-3">
          <ErrorState title={gone ? "This report does not exist or is not shared with you" : "The report could not be run"} error={run.error} onRetry={gone ? undefined : () => void run.refetch()} />
          <p className="flex justify-center gap-4 text-sm">
            <Link className="text-primary underline-offset-4 hover:underline" to="/studio/reports">
              All reports
            </Link>
            {canEdit && (
              <Link className="text-primary underline-offset-4 hover:underline" to={`/studio/reports/${encodeURIComponent(id)}?edit=1`}>
                Edit the report
              </Link>
            )}
          </p>
        </div>
      );
    }
    return <PageLoading label="Running the report…" />;
  }

  const runIssues = run.error ? fieldIssues(run.error) : [];
  const active = (runtime.filters?.length ?? 0) + (runtime.search ? 1 : 0) + (runtime.from || runtime.to ? 1 : 0) + (runtime.sort ? 1 : 0) + (runtime.limit ? 1 : 0);

  return (
    <div className="grid gap-4 pointer-coarse:[&_[data-slot=button]]:min-h-11 pointer-coarse:[&_[data-slot=button]]:min-w-11 pointer-coarse:[&_[data-slot=input]]:h-11 pointer-coarse:[&_[data-slot=select-trigger]]:min-h-11">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="mb-1 text-xs text-muted-foreground">
            <Link to="/studio/reports" className="hover:text-foreground hover:underline">
              Reports
            </Link>
            {entityInfo && <> · {entityInfo.label_plural}</>}
          </nav>
          <h1 className="truncate text-xl font-semibold">{report?.label}</h1>
          {report?.description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{report.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <>
              <Button variant="outline" disabled={exporting || !data?.rows.length} onClick={() => void exportAs("csv")} title="Every row (up to 10,000) as CSV, with the filters applied">
                {exporting ? <Spinner /> : <Download />} CSV
              </Button>
              <Button
                variant="outline"
                disabled={exporting || !data?.rows.length}
                onClick={() => void exportAs("xlsx")}
                title="Every row (up to 10,000) as an Excel workbook, with the filters applied"
              >
                {exporting ? <Spinner /> : <Download />} Excel
              </Button>
            </>
          )}
          {canEdit && (
            <Button asChild>
              <Link to={`/studio/reports/${encodeURIComponent(id)}?edit=1`}>
                <Pencil /> Edit
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void copyLink()}>
                <Link2 /> Copy link
              </DropdownMenuItem>
              {canCopy && (
                <DropdownMenuItem onSelect={duplicate}>
                  <Copy /> Duplicate to customize
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Run settings">
        {grouped && <ViewToggle value={viewMode} onChange={(v) => setRt({ ...rt, view: v })} chartable />}
        <Button variant="outline" aria-expanded={showFilters} aria-controls={`${id}-filters`} onClick={() => setShowFilters((x) => !x)}>
          <ListFilter /> Filters
          {!!runtime.filters?.length && (
            <Badge variant="secondary" className="ml-0.5">
              {runtime.filters.length}
            </Badge>
          )}
        </Button>
        <div className="relative min-w-40 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" className="pl-8" placeholder="Search…" aria-label="Search the report" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {data?.meta.date_range && <PeriodPicker key={`${runtime.from ?? ""}|${runtime.to ?? ""}`} rt={rt} setRt={setRt} saved={data.meta.date_range} fyStartMonth={fy} />}
        {active > 0 && (
          <Button variant="ghost" onClick={reset}>
            <RotateCcw /> Reset
          </Button>
        )}
        {run.isFetching && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <Spinner /> Updating…
          </span>
        )}
      </div>

      {showFilters && (
        <div id={`${id}-filters`} className="max-w-2xl rounded-lg border border-border bg-card p-3">
          <p className="mb-2 text-xs text-muted-foreground">These filters narrow this run only; the saved report keeps its own.</p>
          <FilterEditor filters={filters} fields={filterFields(catalog.data)} issues={incomplete} onChange={setFilters} disabled={!catalog.data} />
        </div>
      )}

      {!!run.error && (
        <Alert variant="destructive">
          <AlertTitle>These run settings could not be applied</AlertTitle>
          <AlertDescription>
            {runIssues.length ? runIssues.map((i) => i.message).join(" ") : errorMessage(run.error)}
            <Button size="sm" variant="outline" className="mt-1" onClick={reset}>
              Reset the run settings
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {data && (
        <div className={run.isFetching ? "grid gap-2 opacity-70 transition-opacity" : "grid gap-2 transition-opacity"}>
          <ResultNotices meta={data.meta} entityLabel={entityInfo?.label} onMoreRows={() => setRt({ ...rt, limit: Math.min(10_000, Math.max(2000, (rt.limit ?? data.meta.row_count) * 4)) })} />
          {!data.rows.length ? (
            <NoRows>
              {active > 0 && (
                <Button variant="outline" onClick={reset}>
                  <RotateCcw /> Reset the run settings
                </Button>
              )}
            </NoRows>
          ) : (
            <ResultView
              view={viewMode}
              chart={chart}
              columns={shown}
              rows={data.rows}
              totals={data.totals}
              sort={runtime.sort ?? []}
              onSort={(sort) => setRt({ ...rt, sort: sort.length ? sort : undefined })}
              subtotals={!!data.subtotals}
              subtotalRows={data.subtotals}
              options={options}
              entity={report?.kind === "table" ? (entity ?? undefined) : undefined}
              title={report?.label ?? "Report"}
            />
          )}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {data.meta.row_count.toLocaleString()} {data.meta.row_count === 1 ? "row" : "rows"} · computed in {Math.round(data.meta.sql_ms)} ms
          </p>
        </div>
      )}
    </div>
  );
}

interface PeriodPickerProps {
  rt: RunState;
  setRt: (rt: RunState) => void;
  saved: { from: string | null; to: string | null };
  fyStartMonth: number;
}

/** Another period for this run: a preset, or dates and expressions (`today-30d`). */
function PeriodPicker({ rt, setRt, saved, fyStartMonth }: PeriodPickerProps) {
  const id = useId();
  const preset = presetOf(rt.from, rt.to)?.id ?? (rt.from || rt.to ? "custom" : "saved");
  const [custom, setCustom] = useState(preset === "custom");
  const [from, setFrom] = useState(rt.from ?? "");
  const [to, setTo] = useState(rt.to ?? "");
  const bad = (v: string) => !!v.trim() && !resolveDate(v, todayIso(), fyStartMonth);
  const savedLabel = saved.from || saved.to ? `${saved.from ? formatDate(saved.from) : "…"} – ${saved.to ? formatDate(saved.to) : "…"}` : "all time";
  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (bad(from) || bad(to)) return;
    setRt({ ...rt, from: from.trim() || undefined, to: to.trim() || undefined });
  };
  return (
    <>
      <Select
        value={custom ? "custom" : preset}
        onValueChange={(v) => {
          if (v === "custom") return setCustom(true);
          setCustom(false);
          const p = DATE_PRESETS.find((x) => x.id === v);
          setRt({ ...rt, from: p?.from, to: p?.to });
        }}
      >
        <SelectTrigger className="w-auto min-w-44" aria-label="Period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="saved">Saved period ({savedLabel})</SelectItem>
          {DATE_PRESETS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom range…</SelectItem>
        </SelectContent>
      </Select>
      {custom && (
        <form className="flex flex-wrap items-center gap-1.5" onSubmit={apply} aria-label="Custom period">
          <Input id={`${id}-from`} className="w-36" aria-label="From (a date or an expression such as today-30d)" placeholder="From" value={from} aria-invalid={bad(from) || undefined} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input id={`${id}-to`} className="w-36" aria-label="To (a date or an expression such as today)" placeholder="To" value={to} aria-invalid={bad(to) || undefined} onChange={(e) => setTo(e.target.value)} />
          <Button type="submit" variant="outline" disabled={bad(from) || bad(to)}>
            Apply
          </Button>
        </form>
      )}
    </>
  );
}
