// Space blocks as the viewer sees them, from a resolved widget (`GET /spaces/{id}/data`, or the
// editor's live preview): shortcut tiles with live counts, link cards, charts, number cards, quick
// lists, text, headings and onboarding checklists, laid out on a 12-column grid that answers to
// the width of its container.

import {
  ArrowUpRight,
  ChartColumn,
  Circle,
  CircleCheck,
  ExternalLink,
  FileChartColumn,
  Hash,
  Heading,
  LayoutDashboard,
  Link2,
  List,
  ListChecks,
  Minus,
  Table as TableIcon,
  Text,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatValue, humanize } from "@/lib/format";
import { recordTitle, SYSTEM_FIELD_LABELS, useCurrencyPrecision, useEntityMeta, useMetaIndex, type Doc, type Field } from "@/lib/meta";
import { formatCardValue, formatChange, isSafeColor, type LinkItem, type ResolvedWidget, type SpaceData, type WidgetError } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { CellValue } from "../../widgets";
import { ChartView, Sparkline } from "./ChartView";
import { parseMarkdown, type Inline, type MdBlock } from "./markdown";
import { listHref, PATHS, spanClass, urlTarget, widthOf, type BlockType, type Target } from "./model";

export const BLOCK_ICON: Record<BlockType, LucideIcon> = {
  shortcut: ArrowUpRight,
  card: Hash,
  chart: ChartColumn,
  list: List,
  links: Link2,
  onboarding: ListChecks,
  heading: Heading,
  markdown: Text,
};

const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** A link to a route, a page of this site or an external page (new tab); a plain box without a target. */
export function SmartLink({ target, children, ...rest }: { target: Target | null; children: ReactNode } & Omit<ComponentProps<"a">, "href" | "target">) {
  if (!target) return <div className={rest.className} style={rest.style}>{children}</div>;
  if ("to" in target)
    return (
      <Link to={target.to} {...rest}>
        {children}
      </Link>
    );
  const label = rest["aria-label"];
  return (
    <a
      href={target.href}
      {...(target.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...rest}
      aria-label={label && target.external ? `${label} (opens in a new tab)` : label}
    >
      {children}
      {target.external && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}

/** Plural labels of the entities the viewer can see. */
export function useEntityLabels(): (name: string) => string {
  const entities = useMetaIndex().data?.entities;
  return useMemo(() => {
    const m = new Map(entities?.map((e) => [e.name, e.label_plural]));
    return (name: string) => m.get(name) ?? humanize(name);
  }, [entities]);
}

/** The grid blocks sit on; it reads its own width (container queries), so it fits any page. */
export function SpaceGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("@container", className)}>
      <div className="grid grid-cols-12 gap-3 @xl:gap-4">{children}</div>
    </div>
  );
}

/** A space's resolved blocks. */
export function SpaceBlocks({ blocks }: { blocks: SpaceData["blocks"] }) {
  return (
    <SpaceGrid>
      {blocks.map((w, i) => (
        <div key={i} className={spanClass(w.type ? widthOf({ type: w.type, width: w.width }) : (w.width ?? 6))}>
          <BlockView widget={w} />
        </div>
      ))}
    </SpaceGrid>
  );
}

export function SpaceSkeleton() {
  const widths = [3, 3, 3, 3, 6, 6, 8, 4];
  return (
    <SpaceGrid>
      {widths.map((w, i) => (
        <div key={i} className={spanClass(w)}>
          <Skeleton className={cn("w-full rounded-xl", w <= 3 ? "h-24" : "h-64")} />
        </div>
      ))}
    </SpaceGrid>
  );
}

export function BlockSkeleton({ type }: { type: BlockType }) {
  return <Skeleton className={cn("w-full rounded-xl", type === "shortcut" || type === "card" ? "h-24" : type === "heading" ? "h-8" : "h-56")} />;
}

/** `pending`: the editor is still counting (the tile shows a placeholder for the number). */
export function BlockView({ widget: w, pending }: { widget: ResolvedWidget; pending?: boolean }) {
  switch (w.type) {
    case "shortcut":
      return <ShortcutTile w={w} pending={pending} />;
    case "links":
      return <LinksCard w={w} />;
    case "chart":
      return w.error ? (
        <BlockError title={w.chart.label} error={w.error} />
      ) : (
        <BlockCard title={w.chart.label} description={w.chart.description}>
          <ChartView chart={w.chart} data={w.data} />
        </BlockCard>
      );
    case "card":
      return w.error ? <BlockError title={w.card.label} error={w.error} /> : <NumberCard w={w} />;
    case "list":
      return w.error ? <BlockError title={w.label || humanize(w.entity)} error={w.error} /> : <QuickList w={w} />;
    case "markdown":
      return (
        <BlockCard>
          <Markdown source={w.content} />
        </BlockCard>
      );
    case "heading": {
      const level = Math.min(Math.max(Math.trunc(w.level) || 2, 1), 3);
      const H = (["h2", "h3", "h4"] as const)[level - 1];
      return <H className={cn("pt-3 font-semibold tracking-tight", ["text-xl", "text-lg", "text-base"][level - 1])}>{w.text}</H>;
    }
    case "onboarding":
      return <Onboarding w={w} />;
    default:
      return <BlockError error={w.error} />;
  }
}

function BlockCard({ title, description, action, children }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="h-full gap-3 py-4">
      {(title || action) && (
        <CardHeader className="gap-1 px-4">
          {title && (
            <CardTitle>
              <h3 className="text-sm font-semibold leading-snug">{title}</h3>
            </CardTitle>
          )}
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      <CardContent className="min-w-0 flex-1 px-4">{children}</CardContent>
    </Card>
  );
}

export function BlockError({ title, error }: { title?: string; error: WidgetError }) {
  return (
    <div className="flex h-full min-h-24 flex-col gap-1 rounded-xl border border-dashed bg-card p-4 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
        {title || "This block can’t be shown"}
      </span>
      <span className="text-muted-foreground">{error.message}</span>
    </div>
  );
}

type ShortcutWidget = Extract<ResolvedWidget, { type: "shortcut" }>;

function shortcutTarget(w: ShortcutWidget): Target | null {
  if (w.entity) return { to: listHref(w.entity, w.filters) };
  if (w.report) return { to: PATHS.report(w.report) };
  if (w.dashboard) return { to: PATHS.dashboard(w.dashboard) };
  return w.url ? urlTarget(w.url) : null;
}

function ShortcutTile({ w, pending }: { w: ShortcutWidget; pending?: boolean }) {
  const label = useEntityLabels();
  const target = shortcutTarget(w);
  const external = !!target && "href" in target && target.external;
  const Icon = w.entity ? List : w.report ? TableIcon : w.dashboard ? LayoutDashboard : external ? ExternalLink : ArrowUpRight;
  const sub = w.entity ? label(w.entity) : (w.title ?? (w.url ? w.url.replace(/^https?:\/\//, "") : ""));
  const count = typeof w.count === "number" || typeof w.count === "string" ? formatValue({ type: "int" }, w.count) : "";
  const accent = isSafeColor(w.color) ? w.color : undefined;
  return (
    <SmartLink
      target={target}
      aria-label={[w.label, count && `${count} records`, sub].filter(Boolean).join(", ")}
      className={cn(
        "group flex h-full min-h-24 flex-col justify-between gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-xs transition-colors hover:bg-accent hover:no-underline",
        FOCUS,
        accent && "border-l-[3px]",
      )}
      style={accent ? ({ borderLeftColor: accent } as CSSProperties) : undefined}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-medium leading-snug">{w.label}</span>
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" style={accent ? { color: accent } : undefined} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 items-end justify-between gap-2">
        {count ? (
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{count}</span>
        ) : w.error ? (
          <span className="text-xs text-destructive">{w.error.message}</span>
        ) : pending ? (
          <Skeleton className="h-7 w-12" />
        ) : (
          <span />
        )}
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      </span>
    </SmartLink>
  );
}

function linkTarget(l: LinkItem): Target | null {
  if (l.entity) return { to: PATHS.list(l.entity) };
  if (l.report) return { to: PATHS.report(l.report) };
  if (l.dashboard) return { to: PATHS.dashboard(l.dashboard) };
  if (l.builtin) return { to: PATHS.builtin(l.builtin) };
  return l.url ? urlTarget(l.url) : null;
}

function LinksCard({ w }: { w: Extract<ResolvedWidget, { type: "links" }> }) {
  return (
    <BlockCard title={w.label}>
      <ul className="-mx-2 grid gap-0.5">
        {w.items.map((l, i) => {
          const target = linkTarget(l);
          const external = !!target && "href" in target && target.external;
          const Icon = l.entity ? List : l.report ? TableIcon : l.dashboard ? LayoutDashboard : l.builtin ? FileChartColumn : external ? ExternalLink : ArrowUpRight;
          return (
            <li key={i}>
              <SmartLink
                target={target}
                className={cn("flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent hover:no-underline pointer-coarse:min-h-11", FOCUS)}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate">{l.label}</span>
              </SmartLink>
            </li>
          );
        })}
      </ul>
    </BlockCard>
  );
}

function NumberCard({ w }: { w: Extract<ResolvedWidget, { type: "card"; error?: undefined }> }) {
  const { card } = w;
  const value = formatCardValue(w.value, card);
  const change = formatChange(w, card);
  const accent = isSafeColor(card.color) ? card.color : undefined;
  const vs = w.meta?.compare?.kind === "previous_year" ? "vs last year" : "vs previous period";
  const Trend = w.direction === "up" ? TrendingUp : w.direction === "down" ? TrendingDown : Minus;
  const tone = w.direction === "up" ? "text-success" : w.direction === "down" ? "text-destructive" : "text-muted-foreground";
  const target = w.drill_down?.entity ? { to: listHref(w.drill_down.entity, w.drill_down.filters) } : null;
  return (
    <SmartLink
      target={target}
      aria-label={`${card.label}: ${value}${change ? `, ${change} ${vs}` : ""}. Open the records.`}
      className={cn("flex h-full min-h-24 flex-col gap-1.5 rounded-xl border bg-card p-4 text-card-foreground shadow-xs transition-colors hover:bg-accent/60 hover:no-underline", FOCUS, accent && "border-t-[3px]")}
      style={accent ? { borderTopColor: accent } : undefined}
    >
      <span className="text-sm font-medium text-muted-foreground">{card.label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums @xl:text-3xl">{value}</span>
      {change && (
        <span className={cn("flex flex-wrap items-center gap-1 text-xs font-medium", tone)}>
          <Trend className="size-3.5" aria-hidden="true" />
          {change}
          <span className="font-normal text-muted-foreground">{vs}</span>
        </span>
      )}
      {w.sparkline && w.sparkline.length > 1 && (
        <span className="mt-auto block pt-1">
          <Sparkline points={w.sparkline} color={accent ?? "var(--chart-1)"} />
        </span>
      )}
    </SmartLink>
  );
}

const sysField = (name: string): Field => ({ name, label: SYSTEM_FIELD_LABELS[name] ?? humanize(name), type: name.endsWith("_at") ? "datetime" : "data", can_read: true });

function QuickList({ w }: { w: Extract<ResolvedWidget, { type: "list"; error?: undefined }> }) {
  const metaQuery = useEntityMeta(w.entity);
  const meta = metaQuery.data;
  const precisionOf = useCurrencyPrecision();
  const label = useEntityLabels();
  if (metaQuery.isLoading) return <BlockSkeleton type="list" />;
  const titled = (r: Doc) => !!meta && ((!!meta.title_field && r[meta.title_field] != null && r[meta.title_field] !== "") || !!r.number);
  // Without the title among the chosen fields, the first field names the record.
  const named = w.rows.every(titled);
  const chosen = w.fields.length ? w.fields : (meta?.list.columns ?? []).slice(0, 4);
  const names = chosen.filter((n) => n !== "id" && (!named || n !== meta?.title_field));
  const head = named ? null : names[0];
  const columns = (head ? names.slice(1) : names).map((n) => meta?.fields.find((f) => f.name === n) ?? sysField(n));
  const headField = head ? (meta?.fields.find((f) => f.name === head) ?? sysField(head)) : undefined;
  const cell = (f: Field, r: Doc) => (
    <CellValue field={f} value={r[f.name]} title={r._titles?.[f.name]} currencyPrecision={f.type === "currency" && f.currency ? precisionOf(r[f.currency]) : undefined} />
  );
  return (
    <BlockCard
      title={w.label || label(w.entity)}
      action={
        <Link to={PATHS.list(w.entity)} className={cn("rounded-sm text-xs font-medium", FOCUS)}>
          View all
        </Link>
      }
    >
      {!w.rows.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No records yet.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{headField?.label ?? meta?.fields.find((f) => f.name === meta.title_field)?.label ?? meta?.label ?? "Record"}</TableHead>
                {columns.map((f) => (
                  <TableHead key={f.name} className={cn(["int", "decimal", "currency", "percent"].includes(f.type) && "text-right", "last:pr-4")}>
                    {f.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {w.rows.map((r, i) => (
                <TableRow key={String(r.id ?? i)}>
                  <TableCell className="max-w-56 truncate pl-4 font-medium">
                    <Link to={PATHS.record(w.entity, String(r.id))} className={cn("rounded-sm", FOCUS)}>
                      {headField ? formatValue(headField, r[headField.name]) || r._titles?.[headField.name] || recordTitle(meta, r) : recordTitle(meta, r)}
                    </Link>
                  </TableCell>
                  {columns.map((f) => (
                    <TableCell key={f.name} className={cn(["int", "decimal", "currency", "percent"].includes(f.type) && "text-right tabular-nums", "last:pr-4")}>
                      {cell(f, r)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </BlockCard>
  );
}

function Onboarding({ w }: { w: Extract<ResolvedWidget, { type: "onboarding" }> }) {
  const done = w.steps.filter((s) => s.done).length;
  const total = w.steps.length;
  return (
    <BlockCard title={w.title || "Get started"} description={`${done} of ${total} done`}>
      {/* The wrapper draws `value` but does not hand it to the progressbar role: set it here. */}
      <Progress
        value={total ? (done / total) * 100 : 0}
        aria-valuenow={total ? Math.round((done / total) * 100) : 0}
        aria-valuetext={`${done} of ${total} steps done`}
        aria-label="Progress"
        className="mb-3 h-1.5"
      />
      <ol className="-mx-2 grid gap-0.5">
        {w.steps.map((s, i) => {
          const action: Target | null = s.done ? null : s.url ? urlTarget(s.url) : s.entity ? { to: PATHS.newRecord(s.entity) } : null;
          return (
            <li key={i} className="flex items-start gap-3 rounded-md px-2 py-2">
              {s.done ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", s.done && "text-muted-foreground line-through")}>
                  {s.label}
                  <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                </p>
                {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                {s.error && <p className="text-xs text-destructive">{s.error.message}</p>}
              </div>
              {action && (
                <SmartLink target={action} className={cn("shrink-0 rounded-sm text-xs font-medium", FOCUS)}>
                  {s.url ? "Open" : "Create"}
                </SmartLink>
              )}
            </li>
          );
        })}
      </ol>
    </BlockCard>
  );
}

// ───────────────────────────── markdown ─────────────────────────────

export function Markdown({ source, className }: { source: string; className?: string }) {
  const doc = useMemo(() => parseMarkdown(source), [source]);
  return <div className={cn("grid gap-3 text-sm leading-relaxed break-words", className)}>{doc.map((b, i) => mdBlock(b, i))}</div>;
}

function mdBlock(b: MdBlock, key: number): ReactNode {
  switch (b.t) {
    case "h": {
      const H = (["h3", "h4", "h5"] as const)[b.level - 1];
      return (
        <H key={key} className={cn("font-semibold leading-snug", b.level === 1 ? "text-base" : "text-sm")}>
          {inlines(b.c)}
        </H>
      );
    }
    case "p":
      return <p key={key}>{inlines(b.c)}</p>;
    case "ul":
      return (
        <ul key={key} className="list-disc space-y-1 pl-5">
          {b.items.map((c, i) => (
            <li key={i}>{inlines(c)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} start={b.start} className="list-decimal space-y-1 pl-5">
          {b.items.map((c, i) => (
            <li key={i}>{inlines(c)}</li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote key={key} className="grid gap-2 border-l-2 pl-3 text-muted-foreground">
          {b.c.map((x, i) => mdBlock(x, i))}
        </blockquote>
      );
    case "code":
      return (
        <pre key={key} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          <code>{b.v}</code>
        </pre>
      );
    case "hr":
      return <hr key={key} className="border-border" />;
  }
}

function inlines(list: Inline[]): ReactNode {
  return list.map((x, i) => {
    switch (x.t) {
      case "text":
        return x.v;
      case "br":
        return <br key={i} />;
      case "code":
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {x.v}
          </code>
        );
      case "strong":
        return (
          <strong key={i} className="font-semibold">
            {inlines(x.c)}
          </strong>
        );
      case "em":
        return <em key={i}>{inlines(x.c)}</em>;
      case "del":
        return <del key={i}>{inlines(x.c)}</del>;
      case "link": {
        const target: Target = x.href.startsWith("#") || /^mailto:/i.test(x.href) ? { href: x.href, external: false } : urlTarget(x.href);
        return (
          <SmartLink key={i} target={target} className="font-medium text-primary underline underline-offset-4">
            {inlines(x.c)}
          </SmartLink>
        );
      }
    }
  });
}
