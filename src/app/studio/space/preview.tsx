// The editor's live preview: each block resolved in the browser the way the server resolves it for
// `GET /spaces/{id}/data` (counts, list rows, chart and card data), from the unsaved settings,
// debounced, with the editor's own permissions. Unfinished blocks show what they still need.

import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, ApiError, docPath, errorMessage } from "@/lib/api";
import type { ListResponse } from "@/lib/meta";
import {
  retryTransient,
  studio,
  studioKeys,
  useCardData,
  useChartData,
  type CardBlock,
  type ChartBlock,
  type ListBlock,
  type OnboardingBlock,
  type QueryResult,
  type ResolvedWidget,
  type ShortcutBlock,
  type SpaceBlock,
  type SpecFilter,
  type StudioKind,
  type WidgetError,
} from "@/lib/studio";
import { useDebounced } from "@/ui/kit";
import { BLOCK_ICON, BlockSkeleton, BlockView } from "./BlockView";
import { BLOCK_KINDS, blockIssues, cleanBlock, SHORTCUT_TARGETS, targetOf, type BlockType } from "./model";

export const widgetError = (e: unknown): WidgetError =>
  e instanceof ApiError ? { error: e.code, message: e.message, fields: e.fields } : { error: "error", message: errorMessage(e) };

const countOf = (r: QueryResult | undefined) => Number(r?.totals?.count ?? r?.rows[0]?.count ?? 0);

/** Records counted by a filter, shared by shortcut and onboarding previews. */
const countQuery = (entity: string, filters: SpecFilter[], enabled: boolean) => ({
  queryKey: [...studioKeys.data, "space-preview", "count", entity, filters] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => studio.query({ entity, filters, measures: [{ fn: "count" }] }, signal),
  enabled,
  retry: retryTransient,
});

/** Labels of saved records of a kind (the same cache as the lists elsewhere in the app). */
export function useRecordLabels(kind: StudioKind | undefined): Map<string, string> {
  const q = useQuery({ queryKey: studioKeys.list(kind ?? "reports"), queryFn: ({ signal }) => studio.list(kind ?? "reports", {}, signal), enabled: !!kind });
  return useMemo(() => new Map((q.data ?? []).map((r) => [r.id, r.label])), [q.data]);
}

function Unfinished({ type, message }: { type: BlockType; message: string }) {
  const Icon = BLOCK_ICON[type];
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed bg-muted/40 p-4 text-center text-sm">
      <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium">{BLOCK_KINDS[type].label}</span>
      <span className="text-muted-foreground">{message}</span>
    </div>
  );
}

export function BlockPreview({ block }: { block: SpaceBlock }) {
  const b = cleanBlock(useDebounced(block, 350));
  const issue = blockIssues(b)[0];
  if (issue) return <Unfinished type={b.type} message={issue.message} />;
  switch (b.type) {
    case "shortcut":
      return <ShortcutPreview b={b} />;
    case "list":
      return <ListPreview b={b} />;
    case "chart":
      return <ChartPreview b={b} />;
    case "card":
      return <CardPreview b={b} />;
    case "onboarding":
      return <OnboardingPreview b={b} />;
    case "links":
      return <BlockView widget={{ type: "links", label: b.label, items: b.items }} />;
    case "heading":
      return <BlockView widget={{ type: "heading", text: b.text, level: b.level ?? 2 }} />;
    case "markdown":
      return b.content.trim() ? <BlockView widget={{ type: "markdown", content: b.content }} /> : <Unfinished type="markdown" message="Write some text" />;
  }
}

function ShortcutPreview({ b }: { b: ShortcutBlock }) {
  const kind = targetOf(b, SHORTCUT_TARGETS);
  const filters = (b.filters ?? []) as SpecFilter[];
  const count = useQuery(countQuery(b.entity ?? "", filters, kind === "entity" && !!b.show_count));
  const titles = useRecordLabels(kind === "report" ? "reports" : kind === "dashboard" ? "dashboards" : undefined);
  const base = { type: "shortcut" as const, label: b.label, color: b.color };
  const w: ResolvedWidget =
    kind === "entity"
      ? { ...base, entity: b.entity ?? "", filters, count: count.data ? countOf(count.data) : undefined, error: count.error ? widgetError(count.error) : undefined }
      : kind === "report"
        ? { ...base, report: b.report ?? "", title: titles.get(b.report ?? "") }
        : kind === "dashboard"
          ? { ...base, dashboard: b.dashboard ?? "", title: titles.get(b.dashboard ?? "") }
          : { ...base, url: b.url };
  return <BlockView widget={w} pending={count.isFetching && !count.data} />;
}

function ListPreview({ b }: { b: ListBlock }) {
  const filters = (b.filters ?? []) as SpecFilter[];
  const q = useQuery({
    queryKey: [...studioKeys.data, "space-preview", "list", b.entity, filters, b.fields ?? [], b.sort ?? "", b.limit ?? 5],
    queryFn: ({ signal }) =>
      api.get<ListResponse>(
        docPath(b.entity),
        { filters: filters.length ? JSON.stringify(filters) : undefined, fields: b.fields?.length ? b.fields.join(",") : undefined, sort: b.sort || undefined, limit: b.limit ?? 5, titles: true },
        signal,
      ),
  });
  if (q.isLoading) return <BlockSkeleton type="list" />;
  return (
    <BlockView
      widget={q.error ? { type: "list", label: b.label, entity: b.entity, error: widgetError(q.error) } : { type: "list", label: b.label, entity: b.entity, fields: b.fields ?? [], rows: q.data?.rows ?? [] }}
    />
  );
}

function ChartPreview({ b }: { b: ChartBlock }) {
  const q = useChartData(b.chart);
  const label = useRecordLabels("charts").get(b.chart) ?? "Chart";
  if (q.isLoading) return <BlockSkeleton type="chart" />;
  if (!q.data) return <BlockView widget={{ type: "chart", chart: { label, chart_type: "bar" }, error: widgetError(q.error) }} />;
  return <BlockView widget={{ type: "chart", chart: q.data.chart, data: q.data.data }} />;
}

function CardPreview({ b }: { b: CardBlock }) {
  const q = useCardData(b.card);
  const label = useRecordLabels("cards").get(b.card) ?? "Number card";
  if (q.isLoading) return <BlockSkeleton type="card" />;
  if (!q.data) return <BlockView widget={{ type: "card", card: { label }, error: widgetError(q.error) }} />;
  return <BlockView widget={{ ...q.data, type: "card" }} />;
}

function OnboardingPreview({ b }: { b: OnboardingBlock }) {
  const counts = useQueries({ queries: b.steps.map((s) => countQuery(s.entity ?? "", (s.filters ?? []) as SpecFilter[], !!s.entity)) });
  return (
    <BlockView
      widget={{
        type: "onboarding",
        title: b.title,
        steps: b.steps.map((s, i) => ({
          label: s.label,
          description: s.description,
          url: s.url,
          ...(s.entity
            ? { entity: s.entity, done: counts[i].data ? countOf(counts[i].data) > 0 : undefined, error: counts[i].error ? widgetError(counts[i].error) : undefined }
            : {}),
        })),
      }}
    />
  );
}
