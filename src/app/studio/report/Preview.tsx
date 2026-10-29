// What the editor and the run view share around a result: notices about what the numbers cover
// (row limit, pivot columns, child-table rows, the period and its comparison), loading and empty
// states, and the table-or-chart switch.

import { ChartColumn, Info, SearchX, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate } from "@/lib/format";
import type { CellOptions, ChartSettings, ColumnSetting, ResultColumn, ResultMeta, ResultRow, Sort } from "@/lib/studio";
import { ResultChart } from "./ResultChart";
import { ResultTable, type ColumnEditor } from "./ResultTable";
import type { ViewMode } from "./state";

const range = (from: string | null | undefined, to: string | null | undefined) =>
  from && to ? `${formatDate(from)} – ${formatDate(to)}` : from ? `from ${formatDate(from)}` : to ? `until ${formatDate(to)}` : "";

/** A file name from a report's name (`Sales by month` → `Sales-by-month`). */
export const fileStem = (label: string) => label.trim().replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "report";

export function ResultNotices({ meta, entityLabel, onMoreRows }: { meta: ResultMeta; entityLabel?: string; onMoreRows?: () => void }) {
  const notes: ReactNode[] = [];
  if (meta.truncated)
    notes.push(
      <span key="t">
        More rows match than the first {meta.row_count.toLocaleString()} shown{meta.row_count < 10_000 ? "" : " (the most a report shows)"}.
        {onMoreRows && meta.row_count < 10_000 && (
          <Button variant="link" size="sm" className="h-auto px-1 py-0" onClick={onMoreRows}>
            Show more rows
          </Button>
        )}
      </span>,
    );
  if (meta.pivot_truncated) notes.push(<span key="p">Only the {meta.pivot_columns} largest pivot columns are shown; the totals still cover every value.</span>);
  if (meta.grain) notes.push(<span key="g">Counting rows of “{meta.grain}” (a child table of {entityLabel ?? meta.entity}), not whole records.</span>);
  if (meta.compare) notes.push(<span key="c">{range(meta.compare.from, meta.compare.to)}, compared with {range(meta.compare.previous_from, meta.compare.previous_to)}.</span>);
  else if (meta.date_range && (meta.date_range.from || meta.date_range.to)) notes.push(<span key="d">Period: {range(meta.date_range.from, meta.date_range.to)}.</span>);
  if (!notes.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground" role="note">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="grid gap-0.5">{notes}</div>
    </div>
  );
}

export function ResultSkeleton() {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-card p-3" aria-busy="true" aria-label="Loading results">
      <Skeleton className="h-8" />
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-6" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

export function NoRows({ children }: { children?: ReactNode }) {
  return (
    <Empty className="border border-border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>No rows match</EmptyTitle>
        <EmptyDescription>Widen the period, remove a filter or clear the search to see more.</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}

export function ViewToggle({ value, onChange, chartable }: { value: ViewMode; onChange: (v: ViewMode) => void; chartable: boolean }) {
  return (
    <ToggleGroup type="single" variant="outline" value={value} onValueChange={(v) => v && onChange(v as ViewMode)} aria-label="Show as">
      <ToggleGroupItem value="table" aria-label="Show as a table">
        <Table2 aria-hidden="true" /> Table
      </ToggleGroupItem>
      <ToggleGroupItem value="chart" disabled={!chartable} aria-label={chartable ? "Show as a chart" : "Show as a chart (summaries and pivots only)"} title={chartable ? undefined : "Group the rows (Summary or Pivot) to chart them"}>
        <ChartColumn aria-hidden="true" /> Chart
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export interface ResultViewProps {
  view: ViewMode;
  chart: ChartSettings;
  columns: ResultColumn[];
  rows: ResultRow[];
  totals?: Record<string, unknown> | null;
  sort: Sort[];
  onSort?: (s: Sort[]) => void;
  editor?: ColumnEditor;
  subtotals?: boolean;
  options: CellOptions;
  entity?: string;
  title: string;
}

export function ResultView(p: ResultViewProps) {
  if (p.view === "chart")
    return (
      <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
        <ResultChart result={{ columns: p.columns, rows: p.rows, totals: p.totals }} settings={p.chart} options={p.options} title={p.title} />
      </div>
    );
  return <ResultTable columns={p.columns} rows={p.rows} totals={p.totals} sort={p.sort} onSort={p.onSort} editor={p.editor} subtotals={p.subtotals} options={p.options} entity={p.entity} caption={p.title} />;
}

/** The setting of a column, if any (pivot cells are configured through their measure). */
export const settingOf = (settings: ColumnSetting[], c: ResultColumn) => settings.find((s) => s.name === (c.role === "pivot" ? c.measure : c.name));
