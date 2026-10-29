// Dashboard widgets as the viewer sees them: a frame (title, menu, drag handle while editing) around
// a chart, number card, shortcut, list, note or heading resolved by the server, or an error in
// place of the one widget that broke.

import { createContext, useContext, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CheckCircle2, Circle, Ellipsis, Expand, ExternalLink, ListTree, Pencil, Table2, TriangleAlert, ChartColumn } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { formatDecimal } from "@/lib/format";
import { can, fieldLabel, recordTitle, useEntityMeta, useMetaIndex, type Doc } from "@/lib/meta";
import { cn } from "@/lib/utils";
import { filterList, isSafeColor, studio, useCardData, useChartData, type CardWidgetData, type ChartSummary, type ChartType, type DrillDown, type FilterDef, type FilterValues, type QueryResult, type BuiltinResult, type ResolvedWidget, type WidgetError } from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/ui/kit";
import { CellValue } from "../../widgets";
import { CHART_TYPE_LABEL } from "./charts";
import { ChartView, ResultTable } from "./ChartView";
import { listParams, type DrillPoint, type DrillTarget } from "./drill";
import { parseMarkdown, type Inline, type MdBlock } from "./markdown";
import { NumberCardView } from "./NumberCardView";
import { plainLink, SmartLink } from "./ui";

/** What widgets need from the dashboard they sit on. */
export interface WidgetEnv {
  /** The saved dashboard: lends its sharing to the widgets (absent in previews). */
  dashboardId?: string;
  values: FilterValues;
  filterDefs: FilterDef[];
  /** Opens the records behind a number or a point. */
  drill: (t: DrillTarget) => void;
}

const Env = createContext<WidgetEnv>({ values: {}, filterDefs: [], drill: () => {} });
export const WidgetEnvProvider = Env.Provider;

export function useCanWrite() {
  const entities = useMetaIndex().data?.entities;
  const perms = (name: string) => entities?.find((e) => e.name === name)?.permissions;
  return { charts: can(perms("DashboardChart"), "write"), cards: can(perms("NumberCard"), "write"), dashboards: can(perms("Dashboard"), "write") };
}

// ───────────────────────────── frame ─────────────────────────────

export interface FrameProps {
  title?: ReactNode;
  /** Accessible name of the widget region. */
  label: string;
  accent?: string | null;
  /** Menu items (DropdownMenuItem) for the widget's own actions and, while editing, the editor's. */
  menu?: ReactNode;
  /** The drag handle while editing. */
  handle?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function WidgetFrame({ title, label, accent, menu, handle, children, className, bodyClassName }: FrameProps) {
  return (
    <section
      aria-label={label}
      className={cn("relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm", className)}
      style={accent && isSafeColor(accent) ? { borderTop: `3px solid ${accent}` } : undefined}
    >
      {(title || menu || handle) && (
        <header className="flex min-h-9 shrink-0 items-center gap-1 py-1 pr-1 pl-3">
          {handle}
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={typeof title === "string" ? title : undefined}>
            {title}
          </h2>
          {menu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`} className="text-muted-foreground pointer-coarse:size-10">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {menu}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 px-3 pb-3", !(title || menu || handle) && "pt-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A widget that could not be shown: the reason, in its place. */
export function WidgetErrorBody({ error }: { error: WidgetError | unknown }) {
  const e = error as Partial<WidgetError>;
  const message = typeof e?.message === "string" ? e.message : errorMessage(error);
  const fields = Array.isArray(e?.fields) ? e.fields : [];
  return (
    <div className="flex h-full items-start gap-2 overflow-auto text-sm text-muted-foreground" role="alert">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0">
        <p>{message}</p>
        {fields.map((f, i) => (
          <p key={i} className="text-xs">
            {f.field}: {f.message}
          </p>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── charts ─────────────────────────────

/** A chart widget's body and menu. `drillDown`: the chart's own filters when known (fetched on demand otherwise). */
export function ChartWidget({
  chart,
  data,
  drillDown,
  handle,
  editMenu,
}: {
  chart: Pick<ChartSummary, "id" | "label" | "chart_type" | "x" | "y" | "colors" | "source">;
  data: QueryResult | BuiltinResult;
  drillDown?: DrillDown | null;
  handle?: ReactNode;
  editMenu?: ReactNode;
}) {
  const env = useContext(Env);
  const writable = useCanWrite().charts;
  const [table, setTable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const drillable = chart.source !== "builtin" && (drillDown !== null || !!chart.id);
  const drill = async (points: DrillPoint[] | undefined) => {
    try {
      let dd = drillDown;
      if (dd === undefined && chart.id) dd = (await studio.chartData(chart.id, { dashboard: env.dashboardId, values: env.values, ...(env.dashboardId ? {} : { filter_defs: env.filterDefs }) })).drill_down;
      if (!dd) return;
      env.drill({ ...dd, title: chart.label, points });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const onPoint = drillable ? (p: DrillPoint[]) => void drill(p) : undefined;
  const view = (big = false) =>
    table ? (
      <ResultTable data={data} onRow={onPoint} className="h-full" />
    ) : (
      <ChartView type={chart.chart_type} data={data} x={chart.x} y={chart.y} colors={chart.colors} title={chart.label} onPoint={onPoint} className={big ? "min-h-[50vh]" : undefined} />
    );
  const menu = (
    <>
      <DropdownMenuItem onSelect={() => setTable((t) => !t)}>
        {table ? <ChartColumn /> : <Table2 />}
        {table ? "Show as chart" : "Show as table"}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setExpanded(true)}>
        <Expand /> Expand
      </DropdownMenuItem>
      {drillable && (
        <DropdownMenuItem onSelect={() => void drill(undefined)}>
          <ListTree /> View records
        </DropdownMenuItem>
      )}
      {writable && chart.id && !editMenu && (
        <DropdownMenuItem asChild>
          <Link to={`/studio/charts/${chart.id}`} className={plainLink}>
            <Pencil /> Edit chart
          </Link>
        </DropdownMenuItem>
      )}
      {editMenu && (
        <>
          <DropdownMenuSeparator />
          {editMenu}
        </>
      )}
    </>
  );
  return (
    <>
      <WidgetFrame title={chart.label} label={`${chart.label}, ${CHART_TYPE_LABEL[chart.chart_type as ChartType]?.toLowerCase() ?? ""} chart`} menu={menu} handle={handle}>
        {view()}
      </WidgetFrame>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[min(85vh,52rem)] max-w-[calc(100%-2rem)] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{chart.label}</DialogTitle>
            <DialogDescription className="sr-only">The chart, enlarged</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">{expanded && view(true)}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────────────────────── number cards ─────────────────────────────

export function CardWidget({ data, handle, editMenu }: { data: CardWidgetData; handle?: ReactNode; editMenu?: ReactNode }) {
  const env = useContext(Env);
  const writable = useCanWrite().cards;
  const label = data.card.label;
  const open = () => env.drill({ ...data.drill_down, title: label });
  const menu = (
    <>
      <DropdownMenuItem onSelect={open}>
        <ListTree /> View records
      </DropdownMenuItem>
      {writable && data.card.id && !editMenu && (
        <DropdownMenuItem asChild>
          <Link to={`/studio/cards/${data.card.id}`} className={plainLink}>
            <Pencil /> Edit number card
          </Link>
        </DropdownMenuItem>
      )}
      {editMenu && (
        <>
          <DropdownMenuSeparator />
          {editMenu}
        </>
      )}
    </>
  );
  return (
    <WidgetFrame title={label} label={`${label}, number card`} accent={data.card.color} menu={menu} handle={handle}>
      <NumberCardView data={data} title={label} onDrill={open} />
    </WidgetFrame>
  );
}

// ───────────────────────────── shortcuts and lists ─────────────────────────────

function ShortcutBody({ w }: { w: Extract<ResolvedWidget, { type: "shortcut" }> }) {
  const env = useContext(Env);
  const meta = useEntityMeta(w.entity);
  const accent = isSafeColor(w.color) ? w.color : "var(--primary)";
  const count = w.count != null ? formatDecimal(w.count, 0) : null;
  const inner = (
    <span className="flex h-full min-h-0 flex-col justify-between gap-1 text-left">
      <span className="line-clamp-2 text-sm font-medium">{w.label}</span>
      {count !== null ? (
        <span className="text-2xl font-semibold tabular-nums" style={{ color: accent }}>
          {count}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ExternalLink className="size-3.5" aria-hidden="true" /> {w.title ?? (w.entity ? meta.data?.label_plural : w.url) ?? "Open"}
        </span>
      )}
    </span>
  );
  const tile = cn("block h-full rounded-lg p-1 text-foreground no-underline hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none");
  if (w.entity) {
    const filters = filterList(w.filters);
    const params = filters.length ? (meta.data ? listParams(filters, meta.data.fields.filter((f) => f.can_read && !f.hidden)) : null) : new URLSearchParams();
    if (params)
      return (
        <Link to={`/e/${w.entity}${params.size ? `?${params}` : ""}`} className={tile}>
          {inner}
        </Link>
      );
    return (
      <button type="button" className={cn(tile, "w-full")} onClick={() => env.drill({ entity: w.entity!, filters, title: w.label })}>
        {inner}
      </button>
    );
  }
  const href = w.report ? `/studio/reports/${w.report}` : w.dashboard ? `/studio/dashboards/${w.dashboard}` : w.url;
  return href ? (
    <SmartLink href={href} className={tile}>
      {inner}
    </SmartLink>
  ) : (
    inner
  );
}

function ListBody({ w }: { w: Extract<ResolvedWidget, { type: "list"; error?: undefined }> }) {
  const meta = useEntityMeta(w.entity);
  const m = meta.data;
  const fields = w.fields.length ? w.fields : m ? [...(m.title_field ? [m.title_field] : []), ...m.list.columns].filter((n, i, a) => a.indexOf(n) === i).slice(0, 3) : [];
  if (!w.rows.length) return <p className="py-4 text-center text-sm text-muted-foreground">Nothing here yet.</p>;
  return (
    <ul className="divide-y text-sm">
      {w.rows.map((r: Doc) => (
        <li key={String(r.id)} className="flex min-w-0 items-baseline gap-3 py-1.5">
          <Link to={`/e/${w.entity}/${String(r.id)}`} className="min-w-0 flex-1 truncate font-medium">
            {recordTitle(m, r)}
          </Link>
          {fields
            .filter((f) => f !== m?.title_field)
            .slice(0, 2)
            .map((f) => {
              const def = m?.fields.find((x) => x.name === f) ?? { name: f, type: "data" as const };
              return (
                <span key={f} className="hidden shrink-0 truncate text-xs text-muted-foreground @sm:inline" title={m ? fieldLabel(m, f) : f}>
                  <CellValue field={def} value={r[f]} title={r._titles?.[f]} />
                </span>
              );
            })}
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────────── markdown ─────────────────────────────

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.t === "text" ? (
          <span key={i}>{n.v}</span>
        ) : n.t === "code" ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">
            {n.v}
          </code>
        ) : n.t === "a" ? (
          <SmartLink key={i} href={n.href} className="text-primary underline underline-offset-2">
            <InlineView nodes={n.c} />
          </SmartLink>
        ) : n.t === "b" ? (
          <strong key={i}>
            <InlineView nodes={n.c} />
          </strong>
        ) : (
          <em key={i}>
            <InlineView nodes={n.c} />
          </em>
        ),
      )}
    </>
  );
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks: MdBlock[] = parseMarkdown(source);
  return (
    <div className={cn("space-y-2 text-sm leading-relaxed [overflow-wrap:anywhere]", className)}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": {
            const H = (["h3", "h4", "h5"] as const)[b.level - 1];
            return (
              <H key={i} className={cn("font-semibold", b.level === 1 ? "text-lg" : b.level === 2 ? "text-base" : "text-sm")}>
                <InlineView nodes={b.c} />
              </H>
            );
          }
          case "p":
            return (
              <p key={i}>
                <InlineView nodes={b.c} />
              </p>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 pl-3 text-muted-foreground">
                <InlineView nodes={b.c} />
              </blockquote>
            );
          case "hr":
            return <hr key={i} className="border-border" />;
          default: {
            const L = b.t;
            return (
              <L key={i} className={cn("space-y-0.5 pl-5", L === "ul" ? "list-disc" : "list-decimal")}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <InlineView nodes={it} />
                  </li>
                ))}
              </L>
            );
          }
        }
      })}
    </div>
  );
}

// ───────────────────────────── by id (while editing) ─────────────────────────────

/** A placed chart not yet saved on the dashboard: its data with the dashboard's filters. */
export function ChartById({ id, handle, editMenu }: { id: string; handle?: ReactNode; editMenu?: ReactNode }) {
  const env = useContext(Env);
  const q = useChartData(id, { values: env.values, filter_defs: env.filterDefs });
  if (!q.data)
    return (
      <WidgetFrame title="Chart" label="Chart" handle={handle} menu={editMenu}>
        {q.error ? <WidgetErrorBody error={q.error} /> : <Skeleton className="h-full w-full" />}
      </WidgetFrame>
    );
  return <ChartWidget chart={q.data.chart} data={q.data.data} drillDown={q.data.drill_down} handle={handle} editMenu={editMenu} />;
}

export function CardById({ id, handle, editMenu }: { id: string; handle?: ReactNode; editMenu?: ReactNode }) {
  const env = useContext(Env);
  const q = useCardData(id, { values: env.values, filter_defs: env.filterDefs });
  if (!q.data)
    return (
      <WidgetFrame title="Number card" label="Number card" handle={handle} menu={editMenu}>
        {q.error ? <WidgetErrorBody error={q.error} /> : <Skeleton className="h-full w-full" />}
      </WidgetFrame>
    );
  return <CardWidget data={q.data} handle={handle} editMenu={editMenu} />;
}

// ───────────────────────────── any widget ─────────────────────────────

/** A widget resolved by the server; `handle` and `editMenu` while editing. */
export function WidgetView({ widget, handle, editMenu, title }: { widget: ResolvedWidget; handle?: ReactNode; editMenu?: ReactNode; title?: string }) {
  const menu = editMenu ? <>{editMenu}</> : undefined;
  if (widget.type === "chart") {
    if (widget.error) {
      return (
        <WidgetFrame title={widget.chart.label} label={widget.chart.label} handle={handle} menu={menu}>
          <WidgetErrorBody error={widget.error} />
        </WidgetFrame>
      );
    }
    return <ChartWidget chart={widget.chart} data={widget.data} handle={handle} editMenu={editMenu} />;
  }
  if (widget.type === "card") {
    if (widget.error) {
      return (
        <WidgetFrame title={widget.card.label} label={widget.card.label} handle={handle} menu={menu}>
          <WidgetErrorBody error={widget.error} />
        </WidgetFrame>
      );
    }
    return <CardWidget data={widget} handle={handle} editMenu={editMenu} />;
  }
  switch (widget.type) {
    case "shortcut":
      return (
        <WidgetFrame label={`${widget.label}, shortcut`} accent={widget.color} handle={handle} menu={menu} title={handle || menu ? widget.label : undefined}>
          {widget.error ? <WidgetErrorBody error={widget.error} /> : <ShortcutBody w={widget} />}
        </WidgetFrame>
      );
    case "list": {
      const label = widget.label || title || "Latest records";
      return (
        <WidgetFrame title={label} label={label} handle={handle} menu={menu} bodyClassName="overflow-auto @container">
          {widget.error ? <WidgetErrorBody error={widget.error} /> : <ListBody w={widget} />}
        </WidgetFrame>
      );
    }
    case "markdown":
      return (
        <WidgetFrame label={title ?? "Note"} handle={handle} menu={menu} title={handle || menu ? (title ?? "Note") : undefined} bodyClassName="overflow-auto">
          <Markdown source={widget.content} />
        </WidgetFrame>
      );
    case "heading": {
      const H = (["h2", "h3", "h4"] as const)[Math.min(Math.max(widget.level, 1), 3) - 1];
      return (
        <div className={cn("flex h-full min-h-0 items-end gap-1", (handle || menu) && "rounded-xl border border-dashed bg-card/50 px-1")}>
          {handle}
          <H className={cn("min-w-0 flex-1 truncate pb-0.5 font-semibold", widget.level <= 1 ? "text-lg" : widget.level === 2 ? "text-base" : "text-sm text-muted-foreground")}>{widget.text}</H>
          {menu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for heading ${widget.text}`} className="text-muted-foreground">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {menu}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      );
    }
    case "links":
      return (
        <WidgetFrame title={widget.label} label={widget.label} handle={handle} menu={menu} bodyClassName="overflow-auto">
          <ul className="space-y-1 text-sm">
            {widget.items.map((l, i) => {
              const href = l.entity ? `/e/${l.entity}` : l.report ? `/studio/reports/${l.report}` : l.dashboard ? `/studio/dashboards/${l.dashboard}` : l.builtin ? `/r/${l.builtin}` : l.url;
              return <li key={i}>{href ? <SmartLink href={href}>{l.label}</SmartLink> : l.label}</li>;
            })}
          </ul>
        </WidgetFrame>
      );
    case "onboarding":
      return (
        <WidgetFrame title={widget.title ?? "Getting started"} label={widget.title ?? "Getting started"} handle={handle} menu={menu} bodyClassName="overflow-auto">
          <ol className="space-y-1.5 text-sm">
            {widget.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                {s.done ? <CheckCircle2 className="mt-0.5 size-4 text-success" aria-label="Done" /> : <Circle className="mt-0.5 size-4 text-muted-foreground" aria-label="To do" />}
                <span>{s.url ? <SmartLink href={s.url}>{s.label}</SmartLink> : s.label}</span>
              </li>
            ))}
          </ol>
        </WidgetFrame>
      );
    default:
      return (
        <WidgetFrame title={title ?? "Widget"} label={title ?? "Widget"} handle={handle} menu={menu}>
          <WidgetErrorBody error={widget.error} />
        </WidgetFrame>
      );
  }
}
