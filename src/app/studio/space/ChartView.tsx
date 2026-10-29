// Saved charts and number-card trends inside a space. Series come from `toChart`: numbers only to
// plot, exact formatted strings for tooltips, legends and the screen-reader table.

import { useMemo, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, Scatter, ScatterChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "@/components/ui/chart";
import { formatDate } from "@/lib/format";
import { useMe } from "@/lib/meta";
import { chartColor, toChart, toNumber, type ChartModel, type ChartRow, type ChartSummary, type ChartType, type ResultLike } from "@/lib/studio";
import { addDays, daysBetween, weekStart } from "@/lib/views";
import { useReducedMotion } from "./hooks";

const TYPE_LABEL: Record<ChartType, string> = {
  bar: "Bar",
  stacked_bar: "Stacked bar",
  line: "Line",
  area: "Area",
  pie: "Pie",
  donut: "Donut",
  percentage: "Percentage",
  heatmap: "Heatmap",
  scatter: "Scatter",
  funnel: "Funnel",
  number: "Number",
};

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const share = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const tick = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? compact.format(v) : String(v ?? ""));
const short = (v: unknown) => {
  const s = String(v ?? "");
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export type ChartInput = Pick<ChartSummary, "label" | "chart_type" | "x" | "y" | "colors">;

export function ChartView({ chart, data, height = 240 }: { chart: ChartInput; data: ResultLike; height?: number }) {
  const fyStartMonth = useMe().data?.fiscal_year_start_month;
  const animate = !useReducedMotion();
  const model = useMemo(() => toChart(data, { x: chart.x, y: chart.y, colors: chart.colors, fyStartMonth }), [data, chart.x, chart.y, chart.colors, fyStartMonth]);
  if (!model.rows.length || !model.series.length)
    return <p className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">No data to chart yet.</p>;
  const type = chart.chart_type;
  return (
    <figure className="m-0">
      <div role="img" aria-label={`${TYPE_LABEL[type] ?? "Chart"} chart: ${chart.label}. The data follows as a table.`}>
        {body(type, model, chart.colors, height, animate)}
      </div>
      {model.truncated && <figcaption className="mt-2 text-xs text-muted-foreground">Showing the {model.series.length} largest series.</figcaption>}
      <DataTable model={model} caption={chart.label} />
    </figure>
  );
}

function body(type: ChartType, model: ChartModel, colors: string[] | null | undefined, height: number, animate: boolean): ReactNode {
  switch (type) {
    case "pie":
    case "donut":
      return <PieView model={model} colors={colors} donut={type === "donut"} animate={animate} />;
    case "percentage":
      return <PercentageView model={model} colors={colors} />;
    case "funnel":
      return <FunnelView model={model} />;
    case "heatmap":
      return <HeatmapView model={model} />;
    case "scatter":
      return model.series.length > 1 ? <ScatterView model={model} height={height} animate={animate} /> : <CartesianView type="line" model={model} height={height} animate={animate} />;
    case "number":
      return <p className="py-6 text-center text-4xl font-semibold tracking-tight tabular-nums">{model.rows[0].fmt[model.series[0].key] || "—"}</p>;
    default:
      return <CartesianView type={type} model={model} height={height} animate={animate} />;
  }
}

type TipProps = { active?: boolean; payload?: ReadonlyArray<{ dataKey?: unknown; payload?: unknown }> };

function SeriesTooltip({ active, payload, model }: TipProps & { model: ChartModel }) {
  const row = payload?.[0]?.payload as ChartRow | undefined;
  if (!active || !row) return null;
  const shown = model.series.filter((s) => payload?.some((p) => p.dataKey === s.key));
  return (
    <div className="grid min-w-32 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{row.label}</div>
      {shown.map((s) => (
        <div key={s.key} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
          <span className="text-muted-foreground">{s.label}</span>
          <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">{row.fmt[s.key] || "—"}</span>
        </div>
      ))}
    </div>
  );
}

function CartesianView({ type, model, height, animate }: { type: ChartType; model: ChartModel; height: number; animate: boolean }) {
  const bars = type === "bar" || type === "stacked_bar";
  const axes = [
    <CartesianGrid key="grid" vertical={false} />,
    <XAxis key="x" dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={short} />,
    <YAxis key="y" tickLine={false} axisLine={false} width={44} tickFormatter={tick} />,
    <ChartTooltip key="tip" cursor={bars ? { fill: "var(--muted)" } : true} content={(p) => <SeriesTooltip {...(p as TipProps)} model={model} />} />,
    model.series.length > 1 ? <ChartLegend key="legend" content={<ChartLegendContent />} /> : null,
  ];
  const margin = { top: 8, right: 8, left: 0, bottom: 0 };
  const last = model.series.length - 1;
  return (
    <ChartContainer config={model.config} className="aspect-auto w-full" style={{ height }}>
      {bars ? (
        <BarChart data={model.rows} margin={margin}>
          {axes}
          {model.series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={`var(--color-${s.key})`}
              stackId={type === "stacked_bar" ? "stack" : undefined}
              radius={type === "stacked_bar" && i !== last ? 0 : [4, 4, 0, 0]}
              maxBarSize={48}
              isAnimationActive={animate}
            />
          ))}
        </BarChart>
      ) : type === "area" ? (
        <AreaChart data={model.rows} margin={margin}>
          {axes}
          {model.series.map((s) => (
            <Area key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} fill={`var(--color-${s.key})`} fillOpacity={0.15} strokeWidth={2} isAnimationActive={animate} />
          ))}
        </AreaChart>
      ) : (
        <LineChart data={model.rows} margin={margin}>
          {axes}
          {model.series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              dot={model.rows.length <= 31 ? { r: 3 } : false}
              activeDot={{ r: 4 }}
              isAnimationActive={animate}
            />
          ))}
        </LineChart>
      )}
    </ChartContainer>
  );
}

/** One measure's positive values by category, with their colors and shares (plotting only). */
function parts(model: ChartModel, colors: string[] | null | undefined) {
  const s = model.series[0];
  const list = model.rows.map((r, i) => ({ label: r.label, value: num(r[s.key]), fmt: r.fmt[s.key], color: chartColor(i, colors) })).filter((p) => p.value > 0);
  const total = list.reduce((a, p) => a + p.value, 0);
  return { list, total };
}

function Shares({ list, total }: ReturnType<typeof parts>) {
  return (
    <ul className="grid w-full gap-1.5 text-sm">
      {list.slice(0, 12).map((p, i) => (
        <li key={i} className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: p.color }} aria-hidden="true" />
          <span className="truncate">{p.label}</span>
          <span className="ml-auto shrink-0 tabular-nums">{p.fmt}</span>
          <span className="w-14 shrink-0 text-right text-muted-foreground tabular-nums">{share.format(p.value / total)}</span>
        </li>
      ))}
      {list.length > 12 && <li className="text-xs text-muted-foreground">and {list.length - 12} more</li>}
    </ul>
  );
}

function PieView({ model, colors, donut, animate }: { model: ChartModel; colors: string[] | null | undefined; donut: boolean; animate: boolean }) {
  const p = parts(model, colors);
  if (!p.list.length) return <p className="py-8 text-center text-sm text-muted-foreground">Nothing above zero to show.</p>;
  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <ChartContainer config={{}} className="aspect-square w-full max-w-[200px]">
        <PieChart>
          <ChartTooltip
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as (typeof p.list)[number] | undefined;
              if (!active || !d) return null;
              return (
                <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                  <div className="font-medium">{d.label}</div>
                  <div className="font-mono tabular-nums">
                    {d.fmt} · {share.format(d.value / p.total)}
                  </div>
                </div>
              );
            }}
          />
          <Pie data={p.list} dataKey="value" nameKey="label" innerRadius={donut ? "58%" : 0} outerRadius="92%" stroke="var(--card)" strokeWidth={2} isAnimationActive={animate}>
            {p.list.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="min-w-0 flex-1 basis-48">
        <Shares {...p} />
      </div>
    </div>
  );
}

function PercentageView({ model, colors }: { model: ChartModel; colors: string[] | null | undefined }) {
  const p = parts(model, colors);
  if (!p.list.length) return <p className="py-8 text-center text-sm text-muted-foreground">Nothing above zero to show.</p>;
  return (
    <div className="grid gap-3">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {p.list.map((d, i) => (
          <div key={i} style={{ width: `${(d.value / p.total) * 100}%`, background: d.color }} title={`${d.label}: ${d.fmt}`} />
        ))}
      </div>
      <Shares {...p} />
    </div>
  );
}

function FunnelView({ model }: { model: ChartModel }) {
  const s = model.series[0];
  const values = model.rows.map((r) => Math.max(0, num(r[s.key])));
  const max = Math.max(...values, 0);
  return (
    <ol className="grid gap-2.5">
      {model.rows.map((r, i) => (
        <li key={i} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums">
              {r.fmt[s.key] || "—"}
              {i > 0 && values[0] > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{share.format(values[i] / values[0])}</span>}
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-muted" aria-hidden="true">
            <div className="mx-auto h-full rounded-full" style={{ width: `${max ? Math.max((values[i] / max) * 100, 1) : 0}%`, background: s.color }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

/** A calendar of the last year: one cell per day, darker for more. */
function HeatmapView({ model }: { model: ChartModel }) {
  const s = model.series[0];
  const days = new Map<string, { v: number; fmt: string }>();
  for (const r of model.rows) if (typeof r.x === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.x)) days.set(r.x.slice(0, 10), { v: num(r[s.key]), fmt: r.fmt[s.key] });
  if (!days.size) return <p className="py-8 text-center text-sm text-muted-foreground">A heatmap needs dates to place values on.</p>;
  const sorted = [...days.keys()].sort();
  const end = sorted[sorted.length - 1];
  const from = weekStart(sorted[0] > addDays(end, -370) ? sorted[0] : addDays(end, -370));
  const total = daysBetween(from, end) + 1;
  const max = Math.max(...[...days.values()].map((d) => d.v), 0);
  const cells = Array.from({ length: total }, (_, i) => {
    const day = addDays(from, i);
    const d = days.get(day);
    const level = d && max > 0 && d.v > 0 ? 20 + Math.round((d.v / max) * 80) : 0;
    return { day, level, title: `${formatDate(day)}: ${d?.fmt || "0"}` };
  });
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <div className="grid shrink-0 grid-rows-7 gap-[3px] text-[10px] leading-none text-muted-foreground" aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="flex h-3 items-center">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridAutoColumns: "0.75rem" }} aria-hidden="true">
        {cells.map((c) => (
          <span
            key={c.day}
            title={c.title}
            className="size-3 rounded-[2px]"
            style={{ background: c.level ? `color-mix(in oklab, ${s.color} ${c.level}%, var(--muted))` : "var(--muted)" }}
          />
        ))}
      </div>
    </div>
  );
}

function ScatterView({ model, height, animate }: { model: ChartModel; height: number; animate: boolean }) {
  const [xs, ys] = model.series;
  return (
    <ChartContainer config={model.config} className="aspect-auto w-full" style={{ height }}>
      <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid />
        <XAxis type="number" dataKey={xs.key} name={xs.label} tickLine={false} axisLine={false} tickFormatter={tick} />
        <YAxis type="number" dataKey={ys.key} name={ys.label} tickLine={false} axisLine={false} width={44} tickFormatter={tick} />
        <ChartTooltip cursor={{ strokeDasharray: "3 3" }} content={(p) => <SeriesTooltip {...(p as TipProps)} model={model} />} />
        <Scatter data={model.rows} fill={`var(--color-${xs.key})`} isAnimationActive={animate} />
      </ScatterChart>
    </ChartContainer>
  );
}

function DataTable({ model, caption }: { model: ChartModel; caption: string }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{model.x?.label ?? ""}</th>
          {model.series.map((s) => (
            <th key={s.key} scope="col">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {model.rows.slice(0, 200).map((r, i) => (
          <tr key={i}>
            <th scope="row">{r.label}</th>
            {model.series.map((s) => (
              <td key={s.key}>{r.fmt[s.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A number card's trend: decorative (the number is the content). `color` must be a safe CSS color. */
export function Sparkline({ points, color }: { points: [string, unknown][]; color: string }) {
  const animate = !useReducedMotion();
  const data = useMemo(() => points.map(([x, v]) => ({ x, v: toNumber(v) ?? 0 })), [points]);
  return (
    <div aria-hidden="true">
      <ChartContainer config={{ v: { label: "Trend", color } }} className="aspect-auto h-10 w-full">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area dataKey="v" type="monotone" stroke="var(--color-v)" fill="var(--color-v)" fillOpacity={0.15} strokeWidth={1.5} dot={false} isAnimationActive={animate} />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
