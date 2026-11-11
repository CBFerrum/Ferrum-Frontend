// Shared patterns of @ferrum/kit (docs/design/PATTERNS.md): the one vocabulary for "nothing to show
// here, and why" (StatePanel), loading shaped like what is coming (the skeletons), where a change
// stands (SaveStatus) and the bar shown while rows are selected (SelectionToolbar).

import { CheckIcon, CircleHelpIcon, HardDriveIcon, InboxIcon, Loader2Icon, LockIcon, PencilIcon, SearchXIcon, TriangleAlertIcon, WifiOffIcon, XCircleIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "../lib/api";
import { formatMoment } from "../lib/format";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { Button } from "./kit";

// ── StatePanel ──

export type StateKind = "loading" | "empty" | "no-matches" | "denied" | "offline" | "failed";

// One icon size (the Empty media's size-6), one tone per kind: empty and no matches are neutral, denied
// and offline are cautions of their own, failed is the only red one.
const KIND: Record<StateKind, { icon: LucideIcon; tone: string; role?: "status" | "alert" }> = {
  loading: { icon: Loader2Icon, tone: "bg-muted text-muted-foreground", role: "status" },
  empty: { icon: InboxIcon, tone: "bg-muted text-muted-foreground" },
  "no-matches": { icon: SearchXIcon, tone: "bg-muted text-muted-foreground", role: "status" },
  denied: { icon: LockIcon, tone: "bg-purple-soft text-purple" },
  offline: { icon: WifiOffIcon, tone: "bg-warning-soft text-warning" },
  failed: { icon: TriangleAlertIcon, tone: "bg-destructive-soft text-destructive", role: "alert" },
};

function defaults(kind: StateKind): { title: string; hint?: string } {
  switch (kind) {
    case "loading":
      return { title: t("Loading…") };
    case "empty":
      return { title: t("Nothing here yet") };
    case "no-matches":
      return { title: t("No matches") };
    case "denied":
      return { title: t("You don't have access to this"), hint: t("Ask an administrator or its owner to give you access.") };
    case "offline":
      return { title: t("You're offline") };
    case "failed":
      return { title: t("Something went wrong") };
  }
}

/**
 * Why there is nothing to show: loading, first-use empty, no matches, denied, offline or failed, each
 * with its own icon, tone and words. `children` is the description: say what the caller knows (that
 * work is kept while offline, what to create first). `failed` shows `error`; `failed` and `offline` offer `onRetry`;
 * `no-matches` offers `onClear`. Denied never says what exists.
 */
export function StatePanel({
  kind,
  title,
  children,
  action,
  error,
  onRetry,
  onClear,
  clearLabel,
  className,
}: {
  kind: StateKind;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  error?: unknown;
  onRetry?: () => void;
  onClear?: () => void;
  /** What `onClear` undoes, when it is not filters: "Clear the search". */
  clearLabel?: string;
  className?: string;
}) {
  const { icon: Glyph, tone, role } = KIND[kind];
  const d = defaults(kind);
  const description = children ?? d.hint;
  return (
    <Empty data-state-kind={kind} role={role} aria-busy={kind === "loading" || undefined} className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon" className={tone}>
          <Glyph aria-hidden="true" className={kind === "loading" ? "animate-spin motion-reduce:animate-none" : undefined} />
        </EmptyMedia>
        <EmptyTitle>{title ?? d.title}</EmptyTitle>
        {(kind === "failed" && error !== undefined) || description ? (
          <EmptyDescription>
            {kind === "failed" && error !== undefined && <p>{errorMessage(error)}</p>}
            {description}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      {(onRetry || onClear || action) && (
        <EmptyContent>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {(kind === "failed" || kind === "offline") && onRetry && (
              <Button icon="refresh" onClick={onRetry}>
                {t("Try again")}
              </Button>
            )}
            {kind === "no-matches" && onClear && <Button onClick={onClear}>{clearLabel ?? t("Clear filters")}</Button>}
            {action}
          </div>
        </EmptyContent>
      )}
    </Empty>
  );
}

// ── content-shaped loading ──

// Widths vary, but the same way every time (no Math.random: snapshots and hydration stay stable).
const WIDTHS = ["w-3/4", "w-2/3", "w-5/6", "w-1/2", "w-4/5", "w-3/5"] as const;
const width = (i: number) => WIDTHS[i % WIDTHS.length];

/** The wrapper every skeleton shares: one status named "Loading…"; the shapes are hidden from assistive technology. */
function Loading({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-label={t("Loading…")} className={cn("motion-reduce:[&_[data-slot=skeleton]]:animate-none", className)}>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** Rows with a leading mark, two lines of text and a trailing value: a mail list, a file list, people. */
export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <Loading className={className}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className={cn("h-3.5", width(i))} />
            <Skeleton className={cn("h-3", width(i + 3))} />
          </div>
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
      ))}
    </Loading>
  );
}

/** A header row and `rows` rows of `columns` cells. */
export function TableSkeleton({ columns = 4, rows = 6, className }: { columns?: number; rows?: number; className?: string }) {
  const grid = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
  return (
    <Loading className={className}>
      <div className="grid gap-4 border-b border-border px-4 py-3" style={grid}>
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className={cn("h-3", c === 0 ? "w-1/2" : "w-2/5")} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-4 border-b border-border px-4 py-3" style={grid}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-3.5", width(r + c * 2))} />
          ))}
        </div>
      ))}
    </Loading>
  );
}

/** Label and control pairs, in the record form's rhythm (a control is as tall as the density says). */
export function FormSkeleton({ fields = 4, className }: { fields?: number; className?: string }) {
  return (
    <Loading className={className}>
      <div className="flex flex-col gap-4">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className={cn("h-3", i % 2 ? "w-20" : "w-28")} />
            <Skeleton className="h-(--control-h) w-full" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** A title, a line about who and when, and paragraphs: a message, a document. */
export function ReaderSkeleton({ paragraphs = 2, className }: { paragraphs?: number; className?: string }) {
  return (
    <Loading className={className}>
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-6 w-2/3" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        {Array.from({ length: paragraphs }, (_, p) => (
          <div key={p} className="flex flex-col gap-2 pt-2">
            {[0, 1, 2, 3].map((l) => (
              <Skeleton key={l} className={cn("h-3.5", l === 3 ? "w-1/2" : l % 2 ? "w-11/12" : "w-full")} />
            ))}
          </div>
        ))}
      </div>
    </Loading>
  );
}

// ── SaveStatus ──

export type SaveState = "draft" | "saving" | "saved" | "local" | "conflict" | "failed" | "unknown";

const SAVE: Record<SaveState, { icon: LucideIcon; tone: string }> = {
  draft: { icon: PencilIcon, tone: "text-warning" },
  saving: { icon: Loader2Icon, tone: "text-muted-foreground" },
  saved: { icon: CheckIcon, tone: "text-success" },
  local: { icon: HardDriveIcon, tone: "text-warning" },
  conflict: { icon: TriangleAlertIcon, tone: "text-destructive" },
  failed: { icon: XCircleIcon, tone: "text-destructive" },
  unknown: { icon: CircleHelpIcon, tone: "text-muted-foreground" },
};

function saveWords(state: SaveState): string {
  switch (state) {
    case "draft":
      return t("Unsaved changes");
    case "saving":
      return t("Saving…");
    case "saved":
      return t("Saved");
    case "local":
      return t("Kept on this device, not saved yet");
    case "conflict":
      return t("Someone else changed this; yours is not saved");
    case "failed":
      return t("Could not save");
    case "unknown":
      return t("Could not confirm it was saved");
  }
}

/**
 * Where a change stands. Only `saved` says saved, and only once the server has confirmed it: `local`
 * (kept on this device) and `unknown` (no answer) never do. `at` is when that state was reached.
 */
export function SaveStatus({ state, at, className }: { state: SaveState; at?: string | number | Date | null; className?: string }) {
  const { icon: Glyph, tone } = SAVE[state];
  const when = at ? formatMoment(at, { dateStyle: "medium", timeStyle: "short" }) : "";
  return (
    <span role="status" aria-live="polite" data-save-state={state} className={cn("inline-flex items-center gap-1.5 text-sm whitespace-nowrap", tone, className)}>
      <Glyph aria-hidden="true" className={cn("size-4 shrink-0", state === "saving" && "animate-spin motion-reduce:animate-none")} />
      <span>{saveWords(state)}</span>
      {when && <time className="text-muted-foreground">{when}</time>}
    </span>
  );
}

// ── SelectionToolbar ──

/**
 * The bar shown while rows are selected. `count` says how many, `scope` what that is: the rows
 * shown, or everything the filter matches (then `of` is how many it matches; "All 240 matching
 * selected", or "500 selected of 1,200 matching" when the run is capped). `extend` holds the buttons
 * that widen the selection, `children` the actions. Escape clears. On phones it sits along the
 * bottom of the screen, as the form's actions do.
 */
export function SelectionToolbar({
  label,
  count,
  scope = "shown",
  of,
  onClear,
  extend,
  children,
}: {
  /** The toolbar's accessible name, e.g. "Actions for the 3 Customers selected". */
  label: string;
  count: number;
  scope?: "shown" | "matching";
  of?: number | null;
  onClear: () => void;
  extend?: ReactNode;
  children?: ReactNode;
}) {
  const all = scope === "matching" && (of == null || of <= count);
  return (
    // Phones (≤720px, as records.css): a bar along the bottom of the screen (.doc-actions, like the form's actions).
    <div
      role="toolbar"
      aria-label={label}
      className="doc-actions flex items-center gap-2 [@media(width>720px)]:sticky [@media(width>720px)]:top-[calc(var(--topbar-h)+env(safe-area-inset-top,0px))] [@media(width>720px)]:z-10 [@media(width>720px)]:flex-wrap [@media(width>720px)]:border-b [@media(width>720px)]:border-border [@media(width>720px)]:bg-primary-soft [@media(width>720px)]:px-4 [@media(width>720px)]:py-2 [@media(width>720px)]:[.list-bars_&]:absolute [@media(width>720px)]:[.list-bars_&]:inset-x-0 [@media(width>720px)]:[.list-bars_&]:top-0 [@media(width>720px)]:[.list-bars_&]:min-h-full"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClear();
      }}
    >
      <span className="font-semibold whitespace-nowrap tabular-nums" role="status">
        {all ? t("All {n} matching selected", { n: count.toLocaleString() }) : t("{n} selected", { n: count.toLocaleString() })}
      </span>
      {scope === "matching" && of != null && of > count && <span className="text-sm whitespace-nowrap text-muted-foreground">{t("of {total} matching", { total: of.toLocaleString() })}</span>}
      {extend}
      <Button size="sm" variant="ghost" icon="x" onClick={onClear}>
        {t("Clear selection")}
      </Button>
      <span className="hidden flex-1 [@media(width>720px)]:block" aria-hidden="true" />
      {children}
    </div>
  );
}
