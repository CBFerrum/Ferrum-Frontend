// A number card: the value in its format, the change since the previous period with its
// direction, a sparkline over the period, and the value as a button that opens the records.

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCardValue, formatChange, isSafeColor, toNumber, type CardWidgetData } from "@/lib/studio";
import { formatPeriod } from "./charts";

const COMPARED = { previous_period: "previous period", previous_year: "same period last year" } as const;

/** The trend as an SVG line (values only drawn; nothing to compute exactly). */
function Sparkline({ points, color, label }: { points: [string, unknown][]; color: string; label: string }) {
  const values = points.map(([, v]) => toNumber(v) ?? 0);
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const w = 100;
  const h = 28;
  const xy = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - lo) / span) * (h - 4)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full max-h-8 w-full overflow-visible" role="img" aria-label={label}>
      <path d={`${line}L${w},${h}L0,${h}Z`} style={{ fill: color, opacity: 0.12 }} />
      <path d={line} fill="none" style={{ stroke: color }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function NumberCardView({ data, title, onDrill, className }: { data: CardWidgetData; title: string; onDrill?: () => void; className?: string }) {
  const card = data.card;
  const value = formatCardValue(data.value, card);
  const compact = formatCardValue(data.value, card, { compact: true });
  const accent = isSafeColor(card.color) ? card.color : "var(--chart-1)";
  const range = data.meta.date_range;
  const period = range ? formatPeriod(range.from, range.to) : "";
  const cmp = data.meta.compare;
  const change = formatChange(data, card);
  const dir = data.direction;
  const Arrow = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  const previous = data.previous !== undefined ? formatCardValue(data.previous, card) : "";
  const against = cmp ? `${COMPARED[cmp.kind]} (${formatPeriod(cmp.previous_from, cmp.previous_to)})` : "";
  const number = (
    <>
      {/* The full value where it fits, the compact one in narrow cards. */}
      <span className="hidden @[12rem]:inline">{value}</span>
      <span className="@[12rem]:hidden">{compact}</span>
    </>
  );
  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-1 @container", className)}>
      <div className="min-w-0 shrink-0">
        {period && <p className="truncate text-xs text-muted-foreground">{period}</p>}
        {onDrill ? (
          <button
            type="button"
            onClick={onDrill}
            className="max-w-full truncate rounded text-left text-2xl font-semibold tabular-nums hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @xs:text-3xl"
            title={`${value}: view the records`}
            aria-label={`${title}: ${value}. View the records`}
          >
            {number}
          </button>
        ) : (
          <p className="truncate text-2xl font-semibold tabular-nums @xs:text-3xl" title={value}>
            {number}
          </p>
        )}
        {change && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs" title={previous ? `${previous} in the ${against}` : undefined}>
            <span className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", dir === "up" ? "text-success" : dir === "down" ? "text-destructive" : "text-muted-foreground")}>
              <Arrow className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{dir === "up" ? "Up" : dir === "down" ? "Down" : "No change"}</span>
              {change}
            </span>
            <span className="truncate text-muted-foreground">vs {cmp ? COMPARED[cmp.kind] : "before"}</span>
          </p>
        )}
      </div>
      {/* The trend takes the room left, and gives way in short cards. */}
      {data.sparkline && data.sparkline.length > 1 && (
        <div className="flex min-h-0 flex-1 items-end">
          <Sparkline points={data.sparkline} color={accent} label={`${title}: trend over ${data.sparkline.length} periods`} />
        </div>
      )}
      {data.sparkline_error && <p className="text-xs text-muted-foreground">The trend could not be drawn: {data.sparkline_error.message}</p>}
    </div>
  );
}
