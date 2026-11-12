// Shared patterns of @ferrum/kit (docs/design/PATTERNS.md): the one vocabulary for "nothing to show
// here, and why" (StatePanel), loading shaped like what is coming (the skeletons), where a change
// stands (SaveStatus) and the bar shown while rows are selected (SelectionToolbar).

import { CheckIcon, CircleHelpIcon, HardDriveIcon, InboxIcon, Loader2Icon, LockIcon, MoreHorizontalIcon, PencilIcon, SearchXIcon, TriangleAlertIcon, WifiOffIcon, XCircleIcon, type LucideIcon } from "lucide-react";
import { Children, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "../lib/api";
import { formatMoment } from "../lib/format";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { Badge, Button, Icon, Menu, MenuItem } from "./kit";
import { stateTone, stateWords } from "../lib/targetState";
import { foldActions } from "./selectionFold";

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
  icon,
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
  /** The screen's own icon in place of the kind's (a module's glyph on its first-use empty state). */
  icon?: LucideIcon;
  className?: string;
}) {
  const { icon: kindIcon, tone, role } = KIND[kind];
  const Glyph = icon ?? kindIcon;
  const d = defaults(kind);
  const description = children ?? d.hint;
  return (
    <Empty data-state-kind={kind} role={role} aria-busy={kind === "loading" || undefined} className={cn("justify-start pt-12 md:pt-16", className)}>
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

/** What a failed request means for the person: refused (401, 403), no answer (status 0, or the browser is offline), or failed. */
export function failureKind(error: unknown): Extract<StateKind, "denied" | "offline" | "failed"> {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (status === 401 || status === 403) return "denied";
  if (status === 0 || (typeof navigator !== "undefined" && navigator.onLine === false)) return "offline";
  return "failed";
}

/**
 * The panel for a request that failed, so every screen tells refused, offline and failed apart the
 * same way. Denied offers no retry and shows no server text; failed shows the reason and "Try again".
 */
export function LoadFailed({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const kind = failureKind(error);
  return <StatePanel kind={kind} error={kind === "failed" ? error : undefined} onRetry={kind === "denied" ? undefined : onRetry} className={className} />;
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

// ── TargetCard ──

/**
 * A service target on a record (BD-04, BD-41): its label, its state as a word and a badge (running, paused, met, met late,
 * breached; the colour follows the state id, never the word) and the due moment. A paused clock is stopped, so no due moment
 * is promised; a breached or late one says it was due. `state` and `due` are what the record keeps in the target's
 * `state_field` and `due_field`.
 */
export function TargetCard({ label, state, due, className }: { label: string; state: string; due?: string | null; className?: string }) {
  const at = due ? formatMoment(due, { dateStyle: "medium", timeStyle: "short" }) : "";
  const line =
    state === "paused" ? t("The clock is stopped.")
    : !at ? ""
    : state === "running" ? t("Due {at}", { at })
    : state === "breached" ? t("Was due {at}", { at })
    : state === "met_late" ? t("Was due {at}, met late", { at })
    : state === "met" ? t("Due {at}, met", { at })
    : t("Due {at}", { at });
  return (
    <section data-target-state={state} aria-label={label} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card p-3 text-sm", className)}>
      <strong className="font-medium">{label}</strong>
      <Badge tone={stateTone(state)}>{stateWords()[state] ?? state}</Badge>
      {line && (due && state !== "paused" ? <time dateTime={due} className="text-muted-foreground">{line}</time> : <span className="text-muted-foreground">{line}</span>)}
    </section>
  );
}

// ── SelectionToolbar ──

/**
 * The bar shown while rows are selected. `count` says how many, `scope` what that is: the rows
 * shown, or everything the filter matches (then `of` is how many it matches; "All 240 matching
 * selected", or "500 selected of 1,200 matching" when the run is capped). `extend` holds the buttons
 * that widen the selection, `children` the actions (drawn as given, never folded). `actions` are the actions the bar
 * folds: it keeps the count, Clear and as many of them as fit the width, in the order given (the caller may mark one or two
 * `priority`: the last to fold), and puts the rest in one "More" menu, by measured width, so nothing is pushed off a phone's
 * screen. Escape clears. On phones it sits along the bottom of the screen, as the form's actions do. What fits is decided by the bar's
 * own width (it is a size container: draw it in a block of its own, full width, as every page does), not the screen's: in a 380px
 * list column the count stays, Clear is its icon (named "Clear selection") and the actions fold into More, which is never squeezed out.
 */
export function SelectionToolbar({
  label,
  count,
  scope = "shown",
  of,
  onClear,
  extend,
  actions,
  children,
}: {
  /** The toolbar's accessible name, e.g. "Actions for the 3 Customers selected". */
  label: string;
  count: number;
  scope?: "shown" | "matching";
  of?: number | null;
  onClear: () => void;
  extend?: ReactNode;
  /** Actions that fold into "More" when the bar is too narrow for them. */
  actions?: SelectionAction[];
  children?: ReactNode;
}) {
  const all = scope === "matching" && (of == null || of <= count);
  return (
    // Phones (≤720px, as records.css): a bar along the bottom of the screen (.doc-actions, like the form's actions).
    <div
      role="toolbar"
      aria-label={label}
      className="doc-actions @container flex items-center gap-2 [@media(width>720px)]:sticky [@media(width>720px)]:top-[calc(var(--topbar-h)+env(safe-area-inset-top,0px))] [@media(width>720px)]:z-10 [@media(width>720px)]:flex-wrap [@media(width>720px)]:border-b [@media(width>720px)]:border-border [@media(width>720px)]:bg-primary-soft [@media(width>720px)]:px-4 [@media(width>720px)]:py-2 [@media(width>720px)]:[.list-bars_&]:absolute [@media(width>720px)]:[.list-bars_&]:inset-x-0 [@media(width>720px)]:[.list-bars_&]:top-0 [@media(width>720px)]:[.list-bars_&]:min-h-full"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClear();
      }}
    >
      <span className="font-semibold whitespace-nowrap tabular-nums" role="status">
        {all ? t("All {n} matching selected", { n: count.toLocaleString() }) : t("{n} selected", { n: count.toLocaleString() })}
      </span>
      {scope === "matching" && of != null && of > count && <span className="text-sm whitespace-nowrap text-muted-foreground">{t("of {total} matching", { total: of.toLocaleString() })}</span>}
      {extend}
      <Button size="sm" variant="ghost" icon="x" className="shrink-0" title={actions?.length ? t("Clear selection") : undefined} onClick={onClear}>
        {/* With folding actions Clear is its icon while the bar itself (not the screen) is narrower than 28rem, its words kept for readers. */}
        {actions?.length ? <span className="sr-only @[28rem]:not-sr-only">{t("Clear selection")}</span> : t("Clear selection")}
      </Button>
      {actions?.length ? <FoldingActions actions={actions} /> : <span className="hidden flex-1 [@media(width>720px)]:block" aria-hidden="true" />}
      {children}
    </div>
  );
}

/** An action of `SelectionToolbar` that may fold into its "More" menu. */
export interface SelectionAction {
  id: string;
  label: string;
  /** A kit icon name; shown on the button and not in the menu. */
  icon?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  /** The last to fold (at most two count). */
  priority?: boolean;
}

/**
 * The bar's actions, folded by width. A hidden copy of every action and of the More button (not shown, not read, not focusable, out of
 * the layout and, being fixed, out of the bar's own scrolling) is measured before the browser paints and again whenever the room or the actions change (ResizeObserver), so the bar is
 * drawn right the first time and nothing jumps while measuring. Folded actions are menu items: arrow keys, Home/End, type-ahead.
 */
function FoldingActions({ actions }: { actions: SelectionAction[] }) {
  const box = useRef<HTMLDivElement>(null);
  const gauge = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState<string[]>([]);
  const key = actions.map((a) => `${a.id}\u0000${a.label}\u0000${a.icon ?? ""}\u0000${a.priority ? 1 : 0}`).join("\u0001");
  const latest = useRef(actions);
  latest.current = actions;
  useLayoutEffect(() => {
    const b = box.current;
    const g = gauge.current;
    if (!b || !g) return;
    const measure = () => {
      const kids = [...g.children] as HTMLElement[];
      const gap = parseFloat(getComputedStyle(g).columnGap) || 0;
      const list = latest.current;
      const r = foldActions(
        kids.slice(0, -1).map((k) => k.getBoundingClientRect().width),
        b.clientWidth,
        { gap, more: kids[kids.length - 1].getBoundingClientRect().width, priority: list.map((a) => !!a.priority) },
      );
      b.style.minWidth = `${Math.ceil(kids[kids.length - 1].getBoundingClientRect().width)}px`; // the More button always has its room: the bar wraps before it overlaps
      const next = r.folded.map((i) => list[i].id);
      setFolded((was) => (was.length === next.length && was.every((id, i) => id === next[i]) ? was : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(g);
    return () => ro.disconnect();
  }, [key]);
  const shown = actions.filter((a) => !folded.includes(a.id));
  const menu = actions.filter((a) => folded.includes(a.id));
  const button = (a: SelectionAction) => (
    <Button key={a.id} size="sm" variant={a.danger ? "danger" : "default"} icon={a.icon} disabled={a.disabled} title={a.title} onClick={a.onSelect}>
      {a.label}
    </Button>
  );
  const moreLabel = (
    <>
      <MoreHorizontalIcon size={16} aria-hidden="true" /> {t("More")}
    </>
  );
  return (
    <div ref={box} className="relative flex min-w-0 flex-1 items-center justify-end gap-2">
      {shown.map(button)}
      {menu.length > 0 && (
        // The kit's own menu (no Radix in the page's first load): arrow keys, Escape back to the button, and on a phone it opens upward from the bar.
        <Menu label={moreLabel} ariaLabel={t("More actions")} buttonClass="btn btn-default btn-sm">
          {(close) =>
            menu.map((a) => (
              <MenuItem
                key={a.id}
                danger={a.danger}
                refusal={a.disabled ? a.title || t("Not available") : null}
                onSelect={() => {
                  close();
                  a.onSelect();
                }}
              >
                {a.label}
              </MenuItem>
            ))
          }
        </Menu>
      )}
      <div ref={gauge} aria-hidden="true" inert className="pointer-events-none invisible fixed top-0 flex w-max items-center gap-2 whitespace-nowrap [&>*]:shrink-0" style={{ insetInlineStart: 0 }}>
        {actions.map(button)}
        <Button size="sm" aria-label={t("More actions")}>
          {moreLabel}
        </Button>
      </div>
    </div>
  );
}

// ── work home: queues and tiles ──

/** A link that looks like a button: the way a page head offers an action that opens a page ("New contract", with
 *  `icon="plus"`). A bare text link is never an action. Exactly one of `to` (a path in this app's router) or `href` (a
 *  destination outside it, such as another app's page or a file: a plain anchor); `download`, `target` and `rel` pass through
 *  to the anchor; `size` is `md` (default) or `sm`. Given both, `to` wins, given neither it draws nothing. */
export function ButtonLink({
  to,
  href,
  variant = "default",
  size = "md",
  icon,
  download,
  target,
  rel,
  children,
}: {
  variant?: "default" | "primary" | "ghost";
  size?: "sm" | "md";
  icon?: string;
  /** A file to save instead of opening (`true`, or the name to save it as). */
  download?: boolean | string;
  /** `_blank` opens a new tab; without a `rel`, `noopener noreferrer` is added. */
  target?: string;
  rel?: string;
  children: ReactNode;
} & ({ to: string; href?: never } | { href: string; to?: never })) {
  const cls = `btn btn-${variant} btn-${size}`;
  const inside = (
    <>
      {icon && <Icon name={icon} />}
      {children}
    </>
  );
  const extra = { download, target, rel: rel ?? (target === "_blank" ? "noopener noreferrer" : undefined) };
  if ((to === undefined) === (href === undefined)) console.error("ButtonLink takes exactly one of `to` or `href`");
  if (to !== undefined)
    return (
      <Link className={cls} to={to} {...extra}>
        {inside}
      </Link>
    );
  if (href === undefined) return null;
  return (
    <a className={cls} href={href} {...extra}>
      {inside}
    </a>
  );
}

/** The vertical rhythm of a page: the head, then its sections, `gap` apart (`md` 16px, `lg` 24px between unrelated groups);
 *  the head always sits 16px above the first section. Use it instead of wrapping content in a grid. */
export function PageStack({ children, gap = "md", className }: { children: ReactNode; gap?: "md" | "lg"; className?: string }) {
  return (
    <div className={cn("page-stack", className)} data-gap={gap === "lg" ? "lg" : undefined}>
      {children}
    </div>
  );
}

/** A main column and a narrower side column (about 2:1, the side 280 to 400px): one column under 900px, the main first. */
export function PageSplit({ main, aside, className }: { main: ReactNode; aside: ReactNode; className?: string }) {
  return (
    <div className={cn("page-split", className)}>
      <div className="page-split-main">{main}</div>
      <div className="page-split-aside">{aside}</div>
    </div>
  );
}

/** Queues side by side where there is room (three or four at 1440), one per row on a phone; their tops align and
 *  each is as tall as its rows, so an empty queue is one row high. `columns={1}`: a page that is one column of queues. */
export function QueueGrid({ children, columns, className }: { children: ReactNode; columns?: 1; className?: string }) {
  return (
    <div className={cn("queue-grid", className)} data-columns={columns}>
      {children}
    </div>
  );
}

/**
 * One list of what needs a person: a surface named by its heading (the section's name), the count as a quiet counter
 * beside it (outside the heading, so the name is read once), the rows (`QueueItem`s) as a list, and one line when
 * there are none. `tone="attention"` is for what is overdue or blocking. `link` is a header link ("All incidents");
 * `more` ("and 4 more") follows a capped list: the caller passes at most its limit of rows and the rest as a number.
 */
export function Queue({
  title,
  count,
  tone = "default",
  link,
  empty,
  more,
  progress,
  children,
}: {
  title: string;
  count?: number;
  tone?: "default" | "attention";
  link?: { to: string; label: string };
  empty?: string;
  more?: { to: string; count: number };
  progress?: { value: number; max?: number; label?: string; tone?: ProgressTone };
  children?: ReactNode;
}) {
  const id = useId();
  const rows = Children.toArray(children);
  return (
    <section className="queue" data-tone={tone === "attention" ? "attention" : undefined} aria-labelledby={id}>
      <header className="queue-head">
        <h2 id={id} className="queue-title">
          {title}
        </h2>
        {count !== undefined && <span className="queue-count">{count}</span>}
        {link && (
          <Link className="queue-link-all" to={link.to}>
            {link.label}
          </Link>
        )}
      </header>
      {progress && <QueueProgress {...progress} />}
      {rows.length ? (
        <ul className="queue-list">{rows}</ul>
      ) : (
        <p className="queue-empty">{empty ?? t("Nothing waiting")}</p>
      )}
      {more && more.count > 0 && (
        <Link className="queue-more" to={more.to}>
          {t("and {n} more", { n: more.count })}
        </Link>
      )}
    </section>
  );
}

export type ProgressTone = "default" | "good" | "attention" | "danger";

/**
 * The governed slim meter: how far along something is (`value` of `max`, default 100), named for assistive technology by
 * `label`. It is a block as wide as its container, 6px high, filling from the reading start (right to left in RTL), so it
 * needs no class: put it where it goes (a `Tile`'s or `Stat`'s `progress`, a `Queue`'s, or as a child of a `HomeSection`
 * or a flex cell). `tone` colours the fill: default the accent, `good`, `attention`, `danger`.
 */
export function Progress({ value, max = 100, label, tone = "default" }: { value: number; max?: number; label: string; tone?: ProgressTone }) {
  const top = max > 0 ? max : 100;
  const v = Math.max(0, Math.min(top, Number.isFinite(value) ? value : 0));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={top} aria-valuenow={Math.round(v * 100) / 100} className="meter" data-tone={tone === "default" ? undefined : tone}>
      <div className="meter-fill" style={{ inlineSize: `${(v / top) * 100}%` }} />
    </div>
  );
}

/** A slim meter with its percentage at the end (the queue's and the stat's `progress`). */
function QueueProgress({ value, max = 100, label, tone }: { value: number; max?: number; label?: string; tone?: ProgressTone }) {
  const top = max > 0 ? max : 100;
  const pct = Math.round((Math.max(0, Math.min(top, Number.isFinite(value) ? value : 0)) / top) * 100);
  return (
    <div className="queue-progress">
      <Progress value={Math.round(value)} max={max} label={label ?? t("Progress")} tone={tone} />
      <span aria-hidden="true">{pct}%</span>
    </div>
  );
}

/**
 * A row of a queue. `to`: the record's page; the name is the row's one link and the whole row is its target (no `to`: a
 * plain row, for when the only thing to do is its `action`). `lead`: a time, a room number or a thumbnail (`<img>`, drawn
 * 40px square) in a fixed column so leads align down the queue. `meta`: one quiet line under the name (a string is also its
 * tooltip; it may take two lines on a phone). `trailing`: a badge or mark that cannot be pressed. `action`: a button or
 * link the person presses ("Check in"), after the row link in the keyboard order and above it for the pointer.
 */
export function QueueItem({ to, title, meta, lead, trailing, action }: { to?: string; title: string; meta?: ReactNode; lead?: ReactNode; trailing?: ReactNode; action?: ReactNode }) {
  return (
    <li className="queue-item" data-plain={to ? undefined : ""}>
      {lead && <span className="queue-lead">{lead}</span>}
      <div className="queue-text">
        {to ? (
          <Link className="queue-name" to={to} title={title}>
            {title}
          </Link>
        ) : (
          <span className="queue-name" title={title}>
            {title}
          </span>
        )}
        {meta && (
          <span className="queue-meta" title={typeof meta === "string" ? meta : undefined}>
            {meta}
          </span>
        )}
      </div>
      {trailing && <span className="queue-trailing">{trailing}</span>}
      {action && <span className="queue-action">{action}</span>}
    </li>
  );
}

/** Things with a live state (tables, rooms, units, trips, sites), as tiles of equal height; `min` is the narrowest a tile
 *  gets: `sm` 200px, `md` 280px, `lg` 360px. */
export function TileGrid({ children, label, min = "sm", className }: { children: ReactNode; label?: string; min?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <ul className={cn("tile-grid", className)} aria-label={label} data-min={min === "sm" ? undefined : min}>
      {children}
    </ul>
  );
}

/** One tile: the title (the link when `to` is given, and then the whole tile opens it), up to two quiet `meta` lines and
 *  `figures` (labelled values, the value at the end in tabular numerals), `progress` (a full-width meter, named by `label`)
 *  and the `status` at its natural width at the foot; a long status or several badges wrap onto a second line.
 *  A long title takes two lines before it is cut. */
export function Tile({ to, title, meta, figures, progress, status }: { to?: string; title: string; meta?: ReactNode; figures?: { label: string; value: ReactNode }[]; progress?: { value: number; max?: number; label: string; tone?: ProgressTone }; status?: ReactNode }) {
  return (
    <li className="tile" data-link={to ? "" : undefined}>
      <span className="tile-title">
        {to ? (
          <Link className="tile-name" to={to} title={title}>
            {title}
          </Link>
        ) : (
          <span title={title}>{title}</span>
        )}
      </span>
      {meta && <span className="tile-meta">{meta}</span>}
      {figures && figures.length > 0 && (
        <dl className="tile-figures">
          {figures.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {progress && (
        <span className="tile-progress">
          <Progress {...progress} />
        </span>
      )}
      {status && <span className="tile-status">{status}</span>}
    </li>
  );
}

/**
 * A labelled group on a home that is not a queue: a heading (named section) with an optional quiet `count`, a header `link`
 * or `actions` (buttons) at the end, and `children` (a `TileGrid`, a table, a `StatGrid`); with no children it shows
 * `empty` as one quiet line.
 */
export function HomeSection({
  title,
  count,
  link,
  actions,
  empty,
  children,
}: {
  title: string;
  count?: number;
  link?: { to: string; label: string };
  actions?: ReactNode;
  empty?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const has = Children.toArray(children).length > 0;
  return (
    <section className="home-section" aria-labelledby={id}>
      <header className="home-section-head">
        <h2 id={id} className="home-section-title">
          {title}
        </h2>
        {count !== undefined && <span className="queue-count">{count}</span>}
        {(link || actions) && (
          <div className="home-section-end">
            {link && <Link to={link.to}>{link.label}</Link>}
            {actions}
          </div>
        )}
      </header>
      {has ? children : empty ? <p className="home-section-empty">{empty}</p> : null}
    </section>
  );
}

/** Linked figures for a home, a few across ("Applicants waiting 4"); `min` is the narrowest a stat gets: `sm` 11rem, `md` 15rem, `lg` 20rem. */
export function StatGrid({ children, min = "sm", className }: { children: ReactNode; min?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <div className={cn("stat-grid", className)} data-min={min === "sm" ? undefined : min}>
      {children}
    </div>
  );
}

const QUIET = /^[^\d]*0+([.,]0+)?[^\d]*$/;
/** A zero, an empty value or a dash is quiet: nothing there to look at. */
const nothing = (v: ReactNode) => v == null || v === false || v === "" || v === 0 || v === "—" || (typeof v === "string" && QUIET.test(v.trim()));

/**
 * One figure: `label` (quiet), `value` (large, tabular numerals, in the text colour; a zero or empty value is quiet and
 * regular), `hint` under it, `progress` (0 to 100) as a slim bar, and `to` to make the whole stat a link. `tone` colours the
 * value only when the number is itself a warning ("attention", "danger"); never by default.
 */
export function Stat({
  label,
  value,
  hint,
  to,
  tone,
  progress,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  to?: string;
  tone?: "attention" | "danger";
  progress?: { value: number; max?: number; label?: string; tone?: ProgressTone };
}) {
  const fit = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // A figure never breaks inside a number: if it does not fit on its line it steps down one type role.
    const el = fit.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      el.removeAttribute("data-fit");
      if (el.scrollWidth > el.clientWidth + 1) el.setAttribute("data-fit", "small");
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [value]);
  const inside = (
    <>
      <span className="stat-label">{label}</span>
      <span ref={fit} className="stat-value" data-quiet={nothing(value) ? "" : undefined} data-tone={tone}>
        {nothing(value) && (value == null || value === "" || value === false) ? "—" : value}
      </span>
      {progress && (
        <span className="stat-bar">
          <Progress value={progress.value} max={progress.max} label={progress.label ?? label} tone={progress.tone} />
        </span>
      )}
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  );
  return to ? (
    <Link className="stat" to={to} data-link="">
      {inside}
    </Link>
  ) : (
    <div className="stat">{inside}</div>
  );
}

/** A home while it loads: the head's shape and `queues` queues of three rows. */
export function HomeSkeleton({ queues = 3, className }: { queues?: number; className?: string }) {
  return (
    <Loading className={className}>
      <div className="home-skeleton">
        <div className="flex items-center justify-between gap-3 py-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-(--control-h) w-32" />
        </div>
        <div className="queue-grid">
          {Array.from({ length: queues }, (_, q) => (
            <div key={q} className="queue">
              <div className="queue-head">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-6" />
              </div>
              {[0, 1, 2].map((r) => (
                <div key={r} className="queue-item">
                  <div className="queue-text">
                    <Skeleton className={cn("h-3.5", width(q + r))} />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-5 w-14" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}
