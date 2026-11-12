// The editor toolbar's governed pieces, with no editor in them (callers pass `pressed`, `onPress` and what a control shows): a toolbar
// that is one tab stop with arrow-key, Home and End movement (right to left too), groups that fold into a "More" popover by measured
// width, and a tool button that shows pressed (fill and a mark under it, so colour is never the only signal), keeps the caret where it
// is when pressed and names its shortcut in a tooltip. Docs and Mail each wrote these; docs/design/PATTERNS.md, "Toolbar".

import { EllipsisIcon } from "lucide-react";
import { Children, isValidElement, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { foldActions } from "./selectionFold";

/** A shortcut as the person's own keyboard names it: "Mod-Shift-b" as "Ctrl+Shift+B", or "⌘⇧B" on a Mac. */
export function shortcutLabel(keys: string, mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)): string {
  const names: Record<string, [string, string]> = { Mod: ["Ctrl", "⌘"], Shift: ["Shift", "⇧"], Alt: ["Alt", "⌥"] };
  const out = keys.split(/-(?=.)/).map((p) => (names[p] ? names[p][mac ? 1 : 0] : p.length === 1 ? p.toUpperCase() : p));
  return mac ? out.join("") : out.join("+");
}

/** Which control a key moves to along a row of `count`, from `at`: arrows by one (the start arrow goes back, flipped right to left), Home, End; null for any other key. */
export function rovingStep(key: string, at: number, count: number, rtl: boolean): number | null {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  return Math.max(0, Math.min(count - 1, at + ((key === "ArrowRight") !== rtl ? 1 : -1)));
}

/** A tool: an icon (or text) that acts or, with `pressed`, switches. Pressing it does not take the focus off the text being edited. */
export function ToolbarButton({ label, icon, children, shortcut, pressed, disabled, onPress, className }: { label: string; icon?: ReactNode; children?: ReactNode; /** "Mod-Shift-b" */ shortcut?: string; pressed?: boolean; disabled?: boolean; onPress: () => void; className?: string }) {
  const keys = shortcut ? shortcutLabel(shortcut) : undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          aria-keyshortcuts={keys}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onPress}
          className={cn("relative aria-pressed:bg-primary-soft aria-pressed:text-primary aria-pressed:after:absolute aria-pressed:after:inset-x-2 aria-pressed:after:bottom-0.5 aria-pressed:after:h-0.5 aria-pressed:after:rounded-full aria-pressed:after:bg-current", className)}
        >
          {icon ?? children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {keys && <Kbd className="ms-2">{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function ToolbarSeparator() {
  return <span role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

/** A run of related tools. `keep` groups fold last (at most two count). The toolbar divides groups itself. */
export function ToolbarGroup({ children }: { id: string; keep?: boolean; children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-0.5">{children}</div>;
}

/** The "More" button and the popover holding what did not fit. The toolbar draws it; it is exported for a row that folds by its own rule. */
export function ToolbarOverflow({ label = t("More"), children }: { label?: string; children: ReactNode }) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={label} onMouseDown={(e) => e.preventDefault()}>
              <EllipsisIcon />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" aria-label={label} className="flex w-auto max-w-[calc(100vw-1rem)] flex-wrap items-center gap-1 p-1">
        {children}
      </PopoverContent>
    </Popover>
  );
}

const DIVIDER = "[&>*+*]:ms-1 [&>*+*]:border-s [&>*+*]:ps-1";
const ITEMS = "button:not(:disabled), input:not(:disabled), [role=combobox]";

/**
 * A row of `ToolbarGroup`s. One tab stop (the last control used, else the first); arrows, Home and End move along it and flip right to
 * left; Escape calls `onEscape` (back to the text). Groups that do not fit go to "More", last first, by measured width (a hidden copy
 * is measured before paint and by a ResizeObserver, so nothing shifts); under `scrollBelow` pixels nothing folds and the row scrolls
 * instead (its `scroll-cue` edge fade), as a phone's does.
 */
export function Toolbar({ label, children, onEscape, scrollBelow = 0, className }: { label: string; children: ReactNode; onEscape?: () => void; scrollBelow?: number; className?: string }) {
  const groups = Children.toArray(children).filter((c): c is ReactElement<{ id: string; keep?: boolean; children: ReactNode }> => isValidElement(c));
  const bar = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const gauge = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState<string[]>([]);
  const [scrolls, setScrolls] = useState(false);
  const key = groups.map((g) => `${g.props.id}${g.props.keep ? "!" : ""}`).join("|");
  const latest = useRef(groups);
  latest.current = groups;
  useLayoutEffect(() => {
    const b = bar.current;
    const g = gauge.current;
    if (!b || !g) return;
    const measure = () => {
      const list = latest.current;
      const cs = getComputedStyle(b);
      const room = b.clientWidth - (parseFloat(cs.paddingInlineStart) || 0) - (parseFloat(cs.paddingInlineEnd) || 0);
      const scroll = room < scrollBelow;
      setScrolls(scroll);
      const kids = [...g.children] as HTMLElement[];
      const next = scroll || room <= 0 /* not laid out (hidden): show everything until it is */ ? [] : foldActions(kids.slice(0, -1).map((k) => k.getBoundingClientRect().width), room, { gap: 2, more: kids[kids.length - 1].getBoundingClientRect().width, priority: list.map((x) => !!x.props.keep) }).folded.map((i) => list[i].props.id);
      setFolded((was) => (was.length === next.length && was.every((id, i) => id === next[i]) ? was : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(g);
    return () => ro.disconnect();
  }, [key, scrollBelow]);

  // One tab stop for the row.
  const active = useRef<HTMLElement | null>(null);
  const items = () => Array.from(row.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
  const settle = () => {
    const all = items();
    if (!active.current || !all.includes(active.current)) active.current = all[0] ?? null;
    for (const el of all) el.tabIndex = el === active.current ? 0 : -1;
  };
  useLayoutEffect(settle);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("[role=dialog], [role=menu], dialog")) return; // an event from a popover or dialog that React bubbles through the toolbar
    if (e.key === "Escape" && onEscape) {
      e.preventDefault();
      onEscape();
      return;
    }
    const all = items();
    const at = all.indexOf(target.closest<HTMLElement>(ITEMS) ?? target);
    if (at < 0) return;
    if (target instanceof HTMLInputElement) {
      // In a field the arrows move the caret until it is at the edge, and Home and End are the field's.
      if (e.key === "Home" || e.key === "End") return;
      const back = (e.key === "ArrowLeft") !== (getComputedStyle(target).direction === "rtl");
      if (!(back ? target.selectionStart === 0 && target.selectionEnd === 0 : target.selectionStart === target.value.length)) return;
    }
    const next = rovingStep(e.key, at, all.length, getComputedStyle(row.current!).direction === "rtl");
    if (next === null) return;
    e.preventDefault();
    all[next]?.focus();
  };
  const shown = groups.filter((g) => !folded.includes(g.props.id));
  const waiting = groups.filter((g) => folded.includes(g.props.id));
  return (
    <TooltipProvider delayDuration={400}>
      <div ref={bar} role="toolbar" aria-label={label} aria-orientation="horizontal" className={cn("relative flex items-center px-1 py-1", scrolls && "scroll-cue overflow-x-auto", className)} onFocusCapture={(e: FocusEvent<HTMLDivElement>) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>(ITEMS);
        if (el && row.current?.contains(el)) {
          active.current = el;
          settle();
        }
      }} onKeyDown={onKeyDown}>
        <div ref={row} className={cn("flex shrink-0 items-center gap-0.5", DIVIDER)}>
          {shown}
          {waiting.length > 0 && (
            <div className="flex items-center">
              <ToolbarOverflow>{waiting.map((g) => g.props.children)}</ToolbarOverflow>
            </div>
          )}
        </div>
        <div ref={gauge} aria-hidden="true" inert className={cn("pointer-events-none invisible fixed top-0 flex w-max items-center gap-0.5 [&>*]:shrink-0", DIVIDER)} style={{ insetInlineStart: 0 }}>
          {groups}
          <div className="flex items-center">
            <Button variant="ghost" size="icon-sm" tabIndex={-1}>
              <EllipsisIcon />
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
