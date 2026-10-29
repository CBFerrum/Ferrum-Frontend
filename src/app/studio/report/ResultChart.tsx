// The result as a chart (Recharts through the shadcn chart container, so series follow the theme's
// --chart-* colors in light and dark): bars, stacked bars, lines, areas, pie, donut, a percentage
// bar, a funnel, a scatter, a calendar heatmap or one number. Tooltips and legends show the exact
// formatted values; numbers become floats only to be plotted.

import { ChartArea, ChartColumn, ChartColumnStacked, ChartLine, ChartPie, ChartScatter, Donut, Funnel as FunnelIcon, Hash, LayoutGrid, Percent, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList, Line, LineChart, Pie, PieChart, Scatter, ScatterChart, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { addDays, daysBetween, weekStart } from "@/lib/views";
import { chartColor, chartIssues, columnLabel, formatCell, isNumericColumn, toChart, type CellOptions, type ChartModel, type ChartSettings, type ChartType, type ResultColumn, type ResultLike } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { CHART_TYPES } from "./state";
import { useReducedMotion } from "./ui";

export const CHART_META: Record<ChartType, { label: string; icon: LucideIcon }> = {
  bar: { label: "Bars", icon: ChartColumn },
  stacked_bar: { label: "Stacked bars", icon: ChartColumnStacked },
  line: { label: "Line", icon: ChartLine },
  area: { label: "Area", icon: ChartArea },
  pie: { label: "Pie", icon: ChartPie },
  donut: { label: "Donut", icon: Donut },
  percentage: { label: "Percentage bar", icon: Percent },
  funnel: { label: "Funnel", icon: FunnelIcon },
  scatter: { label: "Scatter", icon: ChartScatter },
  heatmap: { label: "Calendar heatmap", icon: LayoutGrid },
  number: { label: "Number", icon: Hash },
};

const compactFormat = new Map<string, Intl.NumberFormat>();
function compact(n: unknown, locale?: string): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  const key = locale ?? "";
  let f = compactFormat.get(key);
  if (!f) compactFormat.set(key, (f = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 })));
  return f.format(n);
}

const clip = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A tooltip line: swatch, series, exact value. */
function TipRow({ color, label, value }: { color?: string; label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex w-full min-w-40 items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

interface Slice {
  name: string;
  value: number;
  fmt: string;
  fill: string;
}

/** Positive values of the first series, one per category, for part-of-a-whole charts. */
function slices(model: ChartModel, colors?: string[] | null): Slice[] {
  const s = model.series[0];
  if (!s) return [];
  return model.rows.flatMap((r, i) => {
    const v = r[s.key];
    return typeof v === "number" && v > 0 ? [{ name: r.label || "(not set)", value: v, fmt: r.fmt[s.key] ?? "", fill: chartColor(i, colors) }] : [];
  });
}

function SliceLegend({ items, total }: { items: Slice[]; total: number }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
      {items.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: s.fill }} aria-hidden="true" />
          <span className="max-w-48 truncate">{s.name}</span>
          <span className="text-muted-foreground tabular-nums">
            {s.fmt} · {total ? Math.round((s.value / total) * 1000) / 10 : 0}%
          </span>
        </li>
      ))}
    </ul>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <div className="grid h-full min-h-48 place-items-center p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

interface ResultChartProps {
  result: ResultLike;
  settings: ChartSettings;
  options: CellOptions;
  title: string;
  className?: string;
}

export function ResultChart({ result, settings, options, title, className }: ResultChartProps) {
  const reduced = useReducedMotion();
  const anim = !reduced;
  const type = settings.type;
  const model = useMemo(() => toChart(result, { ...options, x: settings.x, y: settings.y, colors: settings.colors, maxSeries: 12 }), [result, options, settings.x, settings.y, settings.colors]);
  const height = settings.height ?? 360;
  const legend = settings.show_legend ?? model.series.length > 1;
  const box = cn("w-full aspect-auto", className);
  const style = { height: `min(${height}px, 70vh)` };
  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          formatter={(_v, _n, item) => {
            const key = String(item.dataKey ?? "");
            const row = item.payload as { fmt?: Record<string, string> } | undefined;
            return <TipRow color={item.color} label={model.config[key]?.label ?? key} value={row?.fmt?.[key] ?? String(item.value ?? "")} />;
          }}
        />
      }
    />
  );

  let chart: ReactNode;
  if (!result.rows.length) chart = <Message>No data to chart for these settings.</Message>;
  else if (type === "number") chart = <NumberView result={result} options={options} />;
  else if (!model.series.length) chart = <Message>Nothing to plot: add a measure (a count or a sum) to chart it.</Message>;
  else if (type === "pie" || type === "donut" || type === "funnel" || type === "percentage") {
    const parts = slices(model, settings.colors);
    // A funnel narrows: its stages go from the largest down.
    const items = type === "funnel" ? [...parts].sort((a, b) => b.value - a.value) : parts;
    const total = items.reduce((a, s) => a + s.value, 0);
    const sliceTip = (
      <ChartTooltip
        content={
          <ChartTooltipContent
            hideLabel
            formatter={(_v, _n, item) => {
              const s = item.payload as Slice;
              return <TipRow color={s.fill} label={s.name} value={s.fmt} />;
            }}
          />
        }
      />
    );
    if (!items.length) chart = <Message>Only positive values can be shown as parts of a whole.</Message>;
    else if (type === "percentage")
      chart = (
        <div className="grid content-center gap-4 py-6" style={{ minHeight: 160 }}>
          <div className="flex h-8 w-full overflow-hidden rounded-md" role="img" aria-label={`${title}: ${items.map((s) => `${s.name} ${s.fmt}`).join(", ")}`}>
            {items.map((s) => (
              <div key={s.name} className="h-full min-w-0.5 transition-[width] motion-reduce:transition-none" style={{ width: `${(s.value / total) * 100}%`, background: s.fill }} title={`${s.name}: ${s.fmt}`} />
            ))}
          </div>
          <SliceLegend items={items} total={total} />
        </div>
      );
    else
      chart = (
        <div className="grid gap-3">
          <ChartContainer config={model.config} className={box} style={style}>
            {type === "funnel" ? (
              <FunnelChart accessibilityLayer>
                {sliceTip}
                <Funnel dataKey="value" nameKey="name" data={items} isAnimationActive={anim} stroke="var(--card)">
                  {items.map((s) => (
                    <Cell key={s.name} fill={s.fill} />
                  ))}
                </Funnel>
              </FunnelChart>
            ) : (
              <PieChart accessibilityLayer>
                {sliceTip}
                <Pie data={items} dataKey="value" nameKey="name" innerRadius={type === "donut" ? "55%" : 0} outerRadius="85%" paddingAngle={type === "donut" ? 1 : 0} stroke="var(--card)" isAnimationActive={anim}>
                  {items.map((s) => (
                    <Cell key={s.name} fill={s.fill} />
                  ))}
                  {settings.show_values && <LabelList dataKey="fmt" position="outside" className="fill-foreground" fontSize={11} />}
                </Pie>
              </PieChart>
            )}
          </ChartContainer>
          <SliceLegend items={items} total={total} />
        </div>
      );
  } else if (type === "scatter") {
    const [sx, sy] = model.series;
    chart = !sy ? (
      <Message>A scatter chart plots two measures against each other: add a second measure.</Message>
    ) : (
      <ChartContainer config={model.config} className={box} style={style}>
        <ScatterChart accessibilityLayer margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" dataKey={sx.key} name={sx.label} tickFormatter={(v) => compact(v, options.locale)} tickLine={false} axisLine={false} />
          <YAxis type="number" dataKey={sy.key} name={sy.label} tickFormatter={(v) => compact(v, options.locale)} tickLine={false} axisLine={false} width={56} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(_v, _n, item, index) => {
                  const row = item.payload as { label: string; fmt: Record<string, string> };
                  const key = String(item.dataKey ?? "");
                  return (
                    <div className="grid w-full gap-1">
                      {index === 0 && <span className="font-medium">{row.label}</span>}
                      <TipRow color={`var(--color-${sx.key})`} label={model.config[key]?.label ?? key} value={row.fmt[key]} />
                    </div>
                  );
                }}
              />
            }
          />
          <Scatter data={model.rows} fill={`var(--color-${sx.key})`} isAnimationActive={anim} />
        </ScatterChart>
      </ChartContainer>
    );
  } else if (type === "heatmap") chart = <Heatmap model={model} title={title} />;
  else {
    const stacked = type === "stacked_bar" || !!settings.stacked;
    const common = (
      <>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={(v) => clip(String(v))} />
        <YAxis tickFormatter={(v) => compact(v, options.locale)} tickLine={false} axisLine={false} width={56} />
        {tooltip}
        {legend && <ChartLegend content={<ChartLegendContent />} />}
      </>
    );
    const values = (key: string, position: "top" | "insideTop" = "top") =>
      settings.show_values ? <LabelList dataKey={key} position={position} className="fill-foreground" fontSize={11} formatter={(v: unknown) => compact(v, options.locale)} /> : null;
    chart = (
      <ChartContainer config={model.config} className={box} style={style}>
        {type === "line" ? (
          <LineChart data={model.rows} accessibilityLayer margin={{ top: 16, right: 12, left: 4 }}>
            {common}
            {model.series.map((s) => (
              <Line key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} strokeWidth={2} dot={model.rows.length <= 31} isAnimationActive={anim}>
                {values(s.key)}
              </Line>
            ))}
          </LineChart>
        ) : type === "area" ? (
          <AreaChart data={model.rows} accessibilityLayer margin={{ top: 16, right: 12, left: 4 }}>
            {common}
            {model.series.map((s) => (
              <Area key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} fill={`var(--color-${s.key})`} fillOpacity={0.25} stackId={stacked ? "a" : undefined} isAnimationActive={anim}>
                {values(s.key)}
              </Area>
            ))}
          </AreaChart>
        ) : (
          <BarChart data={model.rows} accessibilityLayer margin={{ top: 16, right: 12, left: 4 }}>
            {common}
            {model.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} stackId={stacked ? "a" : undefined} radius={stacked ? (i === model.series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]} isAnimationActive={anim} maxBarSize={56}>
                {values(s.key, stacked ? "insideTop" : "top")}
              </Bar>
            ))}
          </BarChart>
        )}
      </ChartContainer>
    );
  }

  return (
    <figure className="grid gap-2" aria-label={`${title}: ${CHART_META[type]?.label ?? type} chart`}>
      {chart}
      {model.truncated && <figcaption className="text-xs text-muted-foreground">Showing the 12 largest series; the table lists every row.</figcaption>}
    </figure>
  );
}

function NumberView({ result, options }: { result: ResultLike; options: CellOptions }) {
  const c = result.columns.find((x) => x.role === "measure") ?? result.columns.find(isNumericColumn);
  if (!c) return <Message>A number chart shows one measure.</Message>;
  const value = result.totals?.[c.name] ?? result.rows[0]?.[c.name];
  return (
    <div className="grid min-h-48 content-center justify-items-center gap-1 py-8 text-center">
      <span className="text-sm text-muted-foreground">{columnLabel(c, options)}</span>
      <span className="text-5xl font-semibold tracking-tight tabular-nums">{formatCell(c, value, undefined, options) || "—"}</span>
    </div>
  );
}

const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Days as cells in week columns (Monday first), shaded by the first series; other periods as a row of cells. */
function Heatmap({ model, title }: { model: ChartModel; title: string }) {
  const s = model.series[0];
  const cells = model.rows.filter((r) => typeof r.x === "string" && ISO.test(r.x as string));
  if (!s || !cells.length || !model.x || (model.x.bucket && model.x.bucket !== "day") || (!model.x.bucket && model.x.type !== "date")) {
    return <Message>A heatmap shows a measure by day: group by a date (each day) or use a daily trend.</Message>;
  }
  const max = Math.max(0, ...cells.map((r) => Math.abs((r[s.key] as number | null) ?? 0)));
  const byDay = new Map(cells.map((r) => [r.x as string, r]));
  const days = cells.map((r) => r.x as string).sort();
  const start = weekStart(days[0]);
  const weeks = Math.min(Math.floor(daysBetween(start, days[days.length - 1]) / 7) + 1, 106);
  const shade = (v: unknown) => {
    const n = typeof v === "number" ? Math.abs(v) : 0;
    return n && max ? `color-mix(in oklab, var(--chart-1) ${Math.round(18 + (82 * n) / max)}%, var(--muted))` : "var(--muted)";
  };
  return (
    <div className="overflow-x-auto py-2">
      <div className="inline-grid grid-flow-col gap-[3px] text-[10px] text-muted-foreground" style={{ gridTemplateRows: "repeat(7, 14px)" }} role="img" aria-label={`${title}: ${s.label} by day, ${days.length} days; the table lists every value`}>
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="pr-1 leading-[14px]" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const day = addDays(start, i);
          const r = byDay.get(day);
          return <span key={day} aria-hidden="true" className="size-[14px] rounded-[3px]" style={{ background: r ? shade(r[s.key]) : "transparent" }} title={r ? `${r.label}: ${r.fmt[s.key] ?? ""}` : undefined} />;
        })}
      </div>
    </div>
  );
}

// ───────────────────────────── settings ─────────────────────────────

interface ChartSettingsBarProps {
  settings: ChartSettings;
  columns: ResultColumn[];
  onChange: (next: ChartSettings) => void;
}

/** Type, axis, series and display switches; problems the server would refuse on save are listed. */
export function ChartSettingsBar({ settings, columns, onChange }: ChartSettingsBarProps) {
  const dims = columns.filter((c) => c.role === "dimension");
  const values = columns.filter((c) => (c.role === "measure" || c.role === "previous") && isNumericColumn(c));
  const pivoted = columns.some((c) => c.role === "pivot");
  const issues = chartIssues(settings.type, columns, settings.x, settings.y ?? []);
  const set = (patch: Partial<ChartSettings>) => onChange({ ...settings, ...patch });
  const cartesian = ["bar", "stacked_bar", "line", "area"].includes(settings.type);
  const chosen = settings.y?.length ? settings.y : values.map((c) => c.name);
  const Icon = CHART_META[settings.type].icon;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={settings.type} onValueChange={(t) => set({ type: t as ChartType })}>
          <SelectTrigger className="w-44" aria-label="Chart type">
            <SelectValue>
              <Icon aria-hidden="true" /> {CHART_META[settings.type].label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CHART_TYPES.map((t) => {
              const I = CHART_META[t].icon;
              return (
                <SelectItem key={t} value={t}>
                  <I aria-hidden="true" /> {CHART_META[t].label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {dims.length > 1 && settings.type !== "number" && (
          <Select value={settings.x ?? dims[0].name} onValueChange={(x) => set({ x: x === dims[0].name ? undefined : x })}>
            <SelectTrigger className="w-48" aria-label="Along the axis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dims.map((d) => (
                <SelectItem key={d.name} value={d.name}>
                  Along: {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {!pivoted && values.length > 1 && settings.type !== "number" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" aria-label="Series plotted">
                Series ({chosen.length} of {values.length})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Plot these measures</DropdownMenuLabel>
              {values.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.name}
                  checked={chosen.includes(c.name)}
                  disabled={chosen.length === 1 && chosen.includes(c.name)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(on) => {
                    const next = on ? values.map((v) => v.name).filter((n) => n === c.name || chosen.includes(n)) : chosen.filter((n) => n !== c.name);
                    set({ y: next.length === values.length ? undefined : next });
                  }}
                >
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {settings.type === "area" && <SwitchField label="Stacked" checked={!!settings.stacked} onChange={(v) => set({ stacked: v || undefined })} />}
        {cartesian && <SwitchField label="Legend" checked={settings.show_legend ?? true} onChange={(v) => set({ show_legend: v })} />}
        {settings.type !== "number" && settings.type !== "heatmap" && <SwitchField label="Values" checked={!!settings.show_values} onChange={(v) => set({ show_values: v || undefined })} />}
      </div>
      {issues.length > 0 && (
        <ul className="grid gap-0.5 text-xs text-warning" aria-label="Chart problems">
          {issues.map((m) => (
            <li key={m}>{m.charAt(0).toUpperCase() + m.slice(1)}.</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Label className="h-9 gap-2 rounded-md border border-input px-2.5 font-normal">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </Label>
  );
}
