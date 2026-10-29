// Draws a chart from a query or built-in report result: bar, stacked bar, line, area and scatter
// with Recharts (themed by the --chart-N tokens), pie and donut with a legend, percentage,
// funnel and heatmap as plain HTML/SVG, number charts as one value. A click on a point reports
// its dimension values (drill-down); the data table is the keyboard equivalent.

import { useMemo, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/meta";
import {
  chartColor,
  columnLabel,
  formatBucket,
  formatCell,
  isNumericColumn,
  toChart,
  totalsLine,
  type ChartModel,
  type ChartOptions,
  type ChartRow,
  type ChartType,
  type ResultColumn,
  type ResultLike,
  type ResultRow,
} from "@/lib/studio";
import { compactTick, describeChart, formatShare, shortLabel, toHeat, toScatter, toSingle, toSlices, type Slice } from "./charts";
import type { DrillPoint } from "./drill";
import { useReducedMotion } from "./ui";

export interface ChartViewProps {
  type: ChartType;
  data: ResultLike;
  x?: string | null;
  y?: string[] | null;
  colors?: string[] | null;
  title: string;
  /** A point, bar or slice was clicked: the dimension values it stands for (query results only). */
  onPoint?: (points: DrillPoint[]) => void;
  className?: string;
}

/** Chart options the viewer's workspace sets (fiscal quarters). */
export function useChartOptions(x?: string | null, y?: string[] | null, colors?: string[] | null): ChartOptions {
  const fy = useMe().data?.fiscal_year_start_month;
  return useMemo(() => ({ x, y, colors, fyStartMonth: fy }), [x, y, colors, fy]);
}

/** The dimension values of a result row (columns with a field path only: query results). */
function rowPoints(columns: ResultColumn[], row: ResultRow | undefined): DrillPoint[] | null {
  if (!row) return null;
  const dims = columns.filter((c) => c.role === "dimension" && c.field);
  return dims.length ? dims.map((c) => ({ column: c, value: row[c.name] ?? null })) : null;
}

const Center = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("flex h-full min-h-24 items-center justify-center p-4 text-center text-sm text-muted-foreground", className)}>{children}</div>
);

export function ChartView({ type, data, x, y, colors, title, onPoint, className }: ChartViewProps) {
  const o = useChartOptions(x, y, colors);
  const reduced = useReducedMotion();
  const body = (() => {
    if (!data.rows.length && type !== "number") return <Center>No data for these filters and this period.</Center>;
    switch (type) {
      case "pie":
      case "donut":
        return <SliceChart data={data} o={o} donut={type === "donut"} title={title} reduced={reduced} onPoint={onPoint} />;
      case "percentage":
        return <PercentageChart data={data} o={o} title={title} onPoint={onPoint} />;
      case "funnel":
        return <FunnelChart data={data} o={o} title={title} onPoint={onPoint} />;
      case "heatmap":
        return <HeatChart data={data} o={o} title={title} onPoint={onPoint} />;
      case "scatter":
        return <ScatterView data={data} o={o} title={title} reduced={reduced} onPoint={onPoint} />;
      case "number": {
        const s = toSingle(data, o);
        return (
          <div className="flex h-full flex-col items-center justify-center gap-1 @container">
            <span className="text-3xl font-semibold tabular-nums @xs:text-5xl" title={s.column ? columnLabel(s.column, o) : undefined}>
              {s.text}
            </span>
            {s.column && <span className="text-xs text-muted-foreground">{columnLabel(s.column, o)}</span>}
          </div>
        );
      }
      default:
        return <CartesianChart type={type} data={data} o={o} title={title} reduced={reduced} onPoint={onPoint} />;
    }
  })();
  return <div className={cn("h-full min-h-0 w-full @container", className)}>{body}</div>;
}

// ───────────────────────────── bar, line, area ─────────────────────────────

function SeriesTip({ active, payload, model }: { active?: boolean; payload?: readonly { dataKey?: unknown; payload?: unknown }[]; model: ChartModel }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as ChartRow | undefined;
  if (!row) return null;
  const keys = new Set(payload.map((p) => String(p.dataKey)));
  return (
    <div className="grid min-w-32 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{row.label}</div>
      {model.series
        .filter((s) => keys.has(s.key))
        .map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto pl-3 font-mono font-medium tabular-nums text-foreground">{row.fmt[s.key] || "—"}</span>
          </div>
        ))}
    </div>
  );
}

function CartesianChart({ type, data, o, title, reduced, onPoint }: { type: ChartType; data: ResultLike; o: ChartOptions; title: string; reduced: boolean; onPoint?: ChartViewProps["onPoint"] }) {
  const model = useMemo(() => toChart(data, o), [data, o]);
  if (!model.series.length) return <Center>Nothing to plot: the result has no number columns.</Center>;
  const drillable = !!onPoint && model.x?.role === "dimension" && !!model.x.field;
  const pointsAt = (row: ChartRow | undefined, dims?: Record<string, unknown>): DrillPoint[] | null => {
    if (!row || !model.x) return null;
    const extra = Object.entries(dims ?? {}).flatMap(([name, value]) => {
      const c = data.columns.find((col) => col.name === name);
      return c?.field ? [{ column: c, value }] : [];
    });
    return [{ column: model.x, value: row.x }, ...extra];
  };
  const clickAt = (state: { activeTooltipIndex?: unknown } | null | undefined) => {
    const i = Number(state?.activeTooltipIndex);
    const p = Number.isInteger(i) ? pointsAt(model.rows[i]) : null;
    if (p && onPoint) onPoint(p);
  };
  const common = {
    data: model.rows,
    accessibilityLayer: true,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
    onClick: drillable && type !== "bar" && type !== "stacked_bar" ? clickAt : undefined,
    className: drillable ? "cursor-pointer" : undefined,
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} tickFormatter={(v) => shortLabel(String(v))} />
      <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v) => compactTick(v, o.locale)} />
      <Tooltip content={(p) => <SeriesTip active={p.active} payload={p.payload} model={model} />} cursor={type === "line" || type === "area" ? true : { fill: "var(--muted)" }} />
      {model.series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
    </>
  );
  const dots = model.rows.length <= 24;
  const chart =
    type === "line" ? (
      <LineChart {...common}>
        {axes}
        {model.series.map((s) => (
          <Line key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={`var(--color-${s.key})`} strokeWidth={2} dot={dots ? { r: 3 } : false} activeDot={{ r: 4 }} isAnimationActive={!reduced} />
        ))}
      </LineChart>
    ) : type === "area" ? (
      <AreaChart {...common}>
        {axes}
        {model.series.map((s) => (
          <Area key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={`var(--color-${s.key})`} fill={`var(--color-${s.key})`} fillOpacity={0.18} strokeWidth={2} isAnimationActive={!reduced} />
        ))}
      </AreaChart>
    ) : (
      <BarChart {...common}>
        {axes}
        {model.series.map((s, n) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={`var(--color-${s.key})`}
            stackId={type === "stacked_bar" ? "stack" : undefined}
            radius={type === "stacked_bar" ? (n === model.series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]}
            maxBarSize={56}
            isAnimationActive={!reduced}
            onClick={
              drillable
                ? (_: unknown, i: number) => {
                    const p = pointsAt(model.rows[i], s.dims);
                    if (p) onPoint?.(p);
                  }
                : undefined
            }
          />
        ))}
      </BarChart>
    );
  return (
    <div className="flex h-full flex-col">
      <ChartContainer config={model.config} className="aspect-auto min-h-0 w-full flex-1" role="img" aria-label={describeChart(type, model, title, o)}>
        {chart}
      </ChartContainer>
      {model.truncated && <p className="pt-1 text-center text-xs text-muted-foreground">Showing the largest series only.</p>}
    </div>
  );
}

// ───────────────────────────── pie, donut, percentage, funnel ─────────────────────────────

function SliceLegend({ slices, onPick }: { slices: Slice[]; onPick?: (s: Slice) => void }) {
  return (
    <ul className="grid content-center gap-1 text-sm">
      {slices.map((s) => {
        const inner = (
          <>
            <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-left" title={s.label}>
              {s.label}
            </span>
            <span className="font-mono text-xs tabular-nums">{s.text}</span>
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{formatShare(s.share)}</span>
          </>
        );
        return (
          <li key={s.key}>
            {onPick && s.row ? (
              <button type="button" className="flex w-full items-center gap-2 rounded px-1 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => onPick(s)} title={`View the records for ${s.label}`}>
                {inner}
              </button>
            ) : (
              <div className="flex items-center gap-2 px-1 py-0.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const sliceSummary = (title: string, slices: Slice[]) => `${title}: ${slices.map((s) => `${s.label} ${s.text} (${formatShare(s.share)})`).join("; ")}.`;

function useSlices(data: ResultLike, o: ChartOptions, kind: "pie" | "funnel") {
  return useMemo(() => toSlices(data, { ...o, kind }), [data, o, kind]);
}

function SliceChart({ data, o, donut, title, reduced, onPoint }: { data: ResultLike; o: ChartOptions; donut: boolean; title: string; reduced: boolean; onPoint?: ChartViewProps["onPoint"] }) {
  const m = useSlices(data, o, "pie");
  if (!m.slices.length) return <Center>No positive values to show.</Center>;
  const config = Object.fromEntries(m.slices.map((s) => [s.key, { label: s.label, color: s.color }]));
  const pick = onPoint
    ? (s: Slice) => {
        const p = rowPoints(data.columns, s.row);
        if (p) onPoint(p);
      }
    : undefined;
  return (
    <div className="flex h-full flex-col gap-2 @md:flex-row @md:items-center">
      <div className="relative min-h-32 flex-1 self-stretch">
        <ChartContainer config={config} className="absolute inset-0 aspect-auto" role="img" aria-label={sliceSummary(title, m.slices)}>
          <PieChart accessibilityLayer>
            <Tooltip
              content={(p) => {
                const s = p.active ? (p.payload?.[0]?.payload as Slice | undefined) : undefined;
                return s ? (
                  <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                    <div className="font-medium">{s.label}</div>
                    <div className="font-mono tabular-nums">
                      {s.text} · {formatShare(s.share)}
                    </div>
                  </div>
                ) : null;
              }}
            />
            <Pie data={m.slices} dataKey="value" nameKey="label" innerRadius={donut ? "60%" : 0} outerRadius="88%" paddingAngle={donut && m.slices.length > 1 ? 1 : 0} stroke="var(--card)" isAnimationActive={!reduced} onClick={pick ? (_, i) => pick(m.slices[i]) : undefined}>
              {m.slices.map((s) => (
                <Cell key={s.key} fill={s.color} className={pick && s.row ? "cursor-pointer" : undefined} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        {donut && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center" aria-hidden="true">
            <div>
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="text-sm font-semibold tabular-nums @xs:text-base">{m.total}</div>
            </div>
          </div>
        )}
      </div>
      <div className="max-h-[45%] shrink-0 overflow-auto @md:max-h-full @md:w-1/2">
        <SliceLegend slices={m.slices} onPick={pick} />
      </div>
    </div>
  );
}

function PercentageChart({ data, o, title, onPoint }: { data: ResultLike; o: ChartOptions; title: string; onPoint?: ChartViewProps["onPoint"] }) {
  const m = useSlices(data, o, "pie");
  if (!m.slices.length) return <Center>No positive values to show.</Center>;
  const pick = onPoint
    ? (s: Slice) => {
        const p = rowPoints(data.columns, s.row);
        if (p) onPoint(p);
      }
    : undefined;
  return (
    <div className="flex h-full flex-col justify-center gap-3 overflow-auto p-1">
      <div className="flex h-5 w-full shrink-0 overflow-hidden rounded-full bg-muted" role="img" aria-label={sliceSummary(title, m.slices)}>
        {m.slices.map((s) => (
          <div key={s.key} className="h-full border-r border-card last:border-r-0" style={{ width: `${s.share}%`, background: s.color }} title={`${s.label}: ${s.text} (${formatShare(s.share)})`} />
        ))}
      </div>
      <SliceLegend slices={m.slices} onPick={pick} />
    </div>
  );
}

function FunnelChart({ data, o, title, onPoint }: { data: ResultLike; o: ChartOptions; title: string; onPoint?: ChartViewProps["onPoint"] }) {
  const m = useSlices(data, o, "funnel");
  if (!m.slices.length) return <Center>Nothing to plot.</Center>;
  const max = Math.max(...m.slices.map((s) => s.value), 0);
  const first = m.slices[0]?.value ?? 0;
  return (
    <ol className="flex h-full flex-col justify-center gap-1.5 overflow-auto p-1" aria-label={`${title}: funnel`}>
      {m.slices.map((s, i) => {
        const ofFirst = first > 0 ? (s.value / first) * 100 : 0;
        const p = onPoint ? rowPoints(data.columns, s.row) : null;
        const bar = (
          <div className="flex items-center justify-center">
            <div className="h-7 rounded-sm transition-[width]" style={{ width: `${max > 0 ? Math.max((Math.max(s.value, 0) / max) * 100, 1) : 1}%`, background: chartColor(0, o.colors), opacity: 1 - Math.min(i, 6) * 0.1 }} />
          </div>
        );
        return (
          <li key={s.key} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-sm @md:grid-cols-[minmax(0,10rem)_1fr_auto]">
            <span className="truncate" title={s.label}>
              {s.label}
            </span>
            {p ? (
              <button type="button" className="rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => onPoint?.(p)} aria-label={`View the records for ${s.label}`}>
                {bar}
              </button>
            ) : (
              bar
            )}
            <span className="text-right font-mono text-xs tabular-nums">
              {s.text}
              {i > 0 && <span className="ml-1.5 text-muted-foreground">{formatShare(ofFirst)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ───────────────────────────── heatmap ─────────────────────────────

const LEVEL_MIX = [0, 30, 55, 78, 100];
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

function HeatChart({ data, o, title, onPoint }: { data: ResultLike; o: ChartOptions; title: string; onPoint?: ChartViewProps["onPoint"] }) {
  const h = useMemo(() => toHeat(data, o), [data, o]);
  if (!h.cells.length || !h.dim || !h.column) return <Center>A heatmap needs a date dimension with values.</Center>;
  const base = chartColor(0, o.colors);
  const fill = (level: number) => (level === 0 ? "var(--muted)" : `color-mix(in oklab, ${base} ${LEVEL_MIX[level]}%, var(--muted))`);
  const click = onPoint
    ? (row: ResultRow | undefined) => {
        const p = rowPoints(data.columns, row);
        if (p) onPoint(p);
      }
    : undefined;
  const size = 12;
  const step = size + 3;
  const cellLabel = (date: string, text: string) => `${h.dim?.bucket ? formatBucket(date, h.dim.bucket, o.fyStartMonth) : formatCell(h.dim!, date)}: ${text}`;
  const total = `${title}: ${columnLabel(h.column, o)} per ${h.dim.bucket ?? "day"}, highest ${h.cells.reduce((a, c) => (c.value > a.value ? c : a), h.cells[0]).text}.`;
  if (!h.calendar) {
    const cells = h.weeks[0] ?? [];
    return (
      <div className="flex h-full items-center overflow-x-auto">
        <svg viewBox={`0 0 ${cells.length * step} ${step + 14}`} className="h-auto max-h-full w-full min-w-48" role="img" aria-label={total}>
          {cells.map((c, i) =>
            c ? (
              <g key={c.date} className={click && c.row ? "cursor-pointer" : undefined} onClick={click ? () => click(c.row) : undefined}>
                <rect x={i * step} y={0} width={size} height={size} rx={2} style={{ fill: fill(c.level) }}>
                  <title>{cellLabel(c.date, c.text)}</title>
                </rect>
              </g>
            ) : null,
          )}
        </svg>
      </div>
    );
  }
  const months: { x: number; label: string }[] = [];
  h.weeks.forEach((week, wi) => {
    const firstDay = week.find((c) => c)?.date;
    if (firstDay && (wi === 0 || firstDay.slice(8) <= "07")) {
      const label = new Intl.DateTimeFormat(o.locale, { month: "short" }).format(new Date(`${firstDay}T00:00:00`));
      if (!months.length || months[months.length - 1].label !== label) months.push({ x: 28 + wi * step, label });
    }
  });
  const width = 28 + h.weeks.length * step;
  return (
    <div className="flex h-full items-center overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${14 + 7 * step}`} className="h-auto max-h-full w-full min-w-64" role="img" aria-label={total}>
        {months.map((m) => (
          <text key={`${m.x}-${m.label}`} x={m.x} y={10} className="fill-muted-foreground" fontSize={9}>
            {m.label}
          </text>
        ))}
        {WEEKDAYS.map((d, i) =>
          d ? (
            <text key={d} x={0} y={14 + i * step + size - 2} className="fill-muted-foreground" fontSize={9}>
              {d}
            </text>
          ) : null,
        )}
        {h.weeks.map((week, wi) =>
          week.map((c, di) =>
            c ? (
              <rect
                key={c.date}
                x={28 + wi * step}
                y={14 + di * step}
                width={size}
                height={size}
                rx={2}
                style={{ fill: fill(c.level) }}
                className={click && c.row ? "cursor-pointer" : undefined}
                onClick={click && c.row ? () => click(c.row) : undefined}
              >
                <title>{cellLabel(c.date, c.text)}</title>
              </rect>
            ) : null,
          ),
        )}
      </svg>
    </div>
  );
}

// ───────────────────────────── scatter ─────────────────────────────

function ScatterView({ data, o, title, reduced, onPoint }: { data: ResultLike; o: ChartOptions; title: string; reduced: boolean; onPoint?: ChartViewProps["onPoint"] }) {
  const s = useMemo(() => toScatter(data, o), [data, o]);
  if (!s.x || !s.y) return <Center>A scatter chart needs two measures: one for each axis.</Center>;
  if (!s.points.length) return <Center>No rows have both values.</Center>;
  const color = chartColor(0, o.colors);
  const config = { s0: { label: columnLabel(s.y, o), color } };
  const pick = onPoint
    ? (i: number) => {
        const p = rowPoints(data.columns, s.points[i]?.row);
        if (p) onPoint(p);
      }
    : undefined;
  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full" role="img" aria-label={`${title}: ${columnLabel(s.y, o)} against ${columnLabel(s.x, o)} for ${s.points.length} points.`}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }} accessibilityLayer>
        <CartesianGrid />
        <XAxis type="number" dataKey="x" name={columnLabel(s.x, o)} tickLine={false} axisLine={false} tickFormatter={(v) => compactTick(v, o.locale)} />
        <YAxis type="number" dataKey="y" name={columnLabel(s.y, o)} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => compactTick(v, o.locale)} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={(p) => {
            const pt = p.active ? (p.payload?.[0]?.payload as (typeof s.points)[number] | undefined) : undefined;
            return pt ? (
              <div className="grid gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                {pt.label && <div className="font-medium">{pt.label}</div>}
                <div>
                  <span className="text-muted-foreground">{columnLabel(s.x!, o)}</span> <span className="font-mono tabular-nums">{pt.xText}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{columnLabel(s.y!, o)}</span> <span className="font-mono tabular-nums">{pt.yText}</span>
                </div>
              </div>
            ) : null;
          }}
        />
        <Scatter data={s.points} fill="var(--color-s0)" isAnimationActive={!reduced} className={pick ? "cursor-pointer" : undefined} onClick={pick ? (_: unknown, i: number) => pick(i) : undefined} />
      </ScatterChart>
    </ChartContainer>
  );
}

// ───────────────────────────── data table ─────────────────────────────

/** The result as a table (every chart's accessible equivalent); `onRow` adds a drill-down per row. */
export function ResultTable({ data, onRow, max = 200, className }: { data: ResultLike; onRow?: (points: DrillPoint[]) => void; max?: number; className?: string }) {
  const fy = useMe().data?.fiscal_year_start_month;
  const o = { fyStartMonth: fy };
  const columns = data.columns;
  const totals = totalsLine(data, o);
  const rows = data.rows.slice(0, max);
  return (
    <div className={cn("min-h-0 overflow-auto", className)}>
      <Table>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.name} className={isNumericColumn(c) ? "text-right" : undefined}>
                {columnLabel(c, o)}
              </TableHead>
            ))}
            {onRow && <TableHead className="w-0">
              <span className="sr-only">Records</span>
            </TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const p = onRow ? rowPoints(columns, r) : null;
            return (
              <TableRow key={i}>
                {columns.map((c) => (
                  <TableCell key={c.name} className={isNumericColumn(c) ? "text-right font-mono tabular-nums" : "max-w-64 truncate"}>
                    {formatCell(c, r[c.name], r, o)}
                  </TableCell>
                ))}
                {onRow && (
                  <TableCell className="py-0">
                    {p && (
                      <Button variant="ghost" size="xs" onClick={() => onRow(p)}>
                        Records
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
        {totals && (
          <TableFooter>
            <TableRow>
              {totals.map((t, i) => (
                <TableCell key={columns[i].name} className={isNumericColumn(columns[i]) ? "text-right font-mono tabular-nums" : undefined}>
                  {t}
                </TableCell>
              ))}
              {onRow && <TableCell />}
            </TableRow>
          </TableFooter>
        )}
      </Table>
      {data.rows.length > rows.length && <p className="p-2 text-center text-xs text-muted-foreground">Showing the first {rows.length} of {data.rows.length} rows.</p>}
    </div>
  );
}
