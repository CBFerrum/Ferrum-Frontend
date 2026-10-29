// An icon per chart type, for pickers and lists.

import { ChartArea, ChartColumn, ChartColumnStacked, ChartLine, ChartPie, ChartScatter, Donut, Funnel, Grid3x3, Hash, Percent, type LucideIcon } from "lucide-react";
import type { ChartType } from "@/lib/studio";

export const CHART_ICON: Record<ChartType, LucideIcon> = {
  bar: ChartColumn,
  stacked_bar: ChartColumnStacked,
  line: ChartLine,
  area: ChartArea,
  pie: ChartPie,
  donut: Donut,
  percentage: Percent,
  heatmap: Grid3x3,
  scatter: ChartScatter,
  funnel: Funnel,
  number: Hash,
};
