// The list's column chooser: show and hide columns, reorder them (drag, the keyboard, or the move
// buttons) and set their widths; plus the handle that resizes a column from its header's edge.

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, Columns3, GripVertical, RotateCcw } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { clampWidth, MAX_WIDTH, MIN_WIDTH, type Column } from "./settings";

interface Props {
  /** Every column that can be shown. */
  choices: Column[];
  /** The columns shown, in order. */
  shown: string[];
  widths: Record<string, number>;
  /** The saved view these columns belong to; none for the personal layout. */
  viewName?: string;
  /** The columns or widths differ from the defaults (Reset is offered). */
  customized: boolean;
  onColumns: (names: string[]) => void;
  onWidth: (name: string, width: number | undefined) => void;
  onReset: () => void;
}

const INSTRUCTIONS =
  "To move a column, press Space or Enter on its handle, use the up and down arrow keys, then press Space or Enter again to drop it, or Escape to cancel.";

const ICON_BTN =
  "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-35 aria-disabled:hover:bg-transparent pointer-coarse:size-11";

export function ColumnChooser({ choices, shown, widths, viewName, customized, onColumns, onWidth, onReset }: Props) {
  const uid = useId();
  const [find, setFind] = useState("");
  const [dragging, setDragging] = useState(false);
  const focusNext = useRef<string | null>(null);
  const byName = new Map(choices.map((c) => [c.name, c]));
  const label = (n: UniqueIdentifier) => byName.get(String(n))?.label ?? String(n);
  const hidden = choices.filter((c) => !shown.includes(c.name)).sort((a, b) => a.label.localeCompare(b.label));
  const needle = find.trim().toLowerCase();
  const matches = needle ? hidden.filter((c) => c.label.toLowerCase().includes(needle)) : hidden;
  const boxId = (list: "on" | "off", name: string) => `${uid}-${list}-${name}`;

  // Showing or hiding moves a column to the other list: focus stays in the list it left.
  useLayoutEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const move = (name: string, by: number) => {
    const i = shown.indexOf(name);
    if (i < 0 || i + by < 0 || i + by >= shown.length) return;
    onColumns(arrayMove(shown, i, i + by));
  };
  const hide = (name: string) => {
    if (shown.length < 2) return; // a list shows at least one column
    const i = shown.indexOf(name);
    const next = shown[i + 1] ?? shown[i - 1];
    focusNext.current = next ? boxId("on", next) : null;
    onColumns(shown.filter((n) => n !== name));
  };
  const show = (name: string) => {
    const i = matches.findIndex((c) => c.name === name);
    const next = matches[i + 1] ?? matches[i - 1];
    focusNext.current = next ? boxId("off", next.name) : boxId("on", name);
    onColumns([...shown, name]);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const at = (id: UniqueIdentifier) => `position ${shown.indexOf(String(id)) + 1} of ${shown.length}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${label(active.id)}, at ${at(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${label(active.id)} is over ${at(over.id)}.` : `${label(active.id)} is outside the list.`),
    onDragEnd: ({ active, over }) => (over ? `${label(active.id)} dropped at ${at(over.id)}.` : `${label(active.id)} put back.`),
    onDragCancel: ({ active }) => `Moving ${label(active.id)} was cancelled.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false);
    if (over && active.id !== over.id) onColumns(arrayMove(shown, shown.indexOf(String(active.id)), shown.indexOf(String(over.id))));
  };

  return (
    <Popover onOpenChange={(open) => !open && setFind("")}>
      <PopoverTrigger className="btn btn-default btn-md">
        <Columns3 className="size-4" aria-hidden="true" />
        Columns
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Columns"
        className="flex max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-2rem))] flex-col p-0"
        // Escape while moving a column with the keyboard cancels the move, not the chooser.
        onEscapeKeyDown={(e) => dragging && e.preventDefault()}
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Columns</h2>
            <p className="truncate text-xs text-muted-foreground">{viewName ? `Saved with the view “${viewName}”` : "Only you see these choices"}</p>
          </div>
          {/* aria-disabled, not removed or disabled: focus stays on it after a reset. */}
          <button
            type="button"
            className="btn btn-ghost btn-sm aria-disabled:cursor-default aria-disabled:opacity-50"
            aria-disabled={!customized || undefined}
            title={customized ? "Back to the default columns and widths" : "The default columns are shown"}
            onClick={() => customized && onReset()}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          <h3 id={`${uid}-shown`} className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
            Shown
          </h3>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
            onDragStart={() => setDragging(true)}
            onDragCancel={() => setDragging(false)}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={shown} strategy={verticalListSortingStrategy}>
              <ul aria-labelledby={`${uid}-shown`} className="flex flex-col gap-0.5">
                {shown.map((name, i) => (
                  <ShownColumn
                    key={name}
                    name={name}
                    label={label(name)}
                    boxId={boxId("on", name)}
                    first={i === 0}
                    last={i === shown.length - 1}
                    only={shown.length === 1}
                    width={widths[name]}
                    onMove={(by) => move(name, by)}
                    onHide={() => hide(name)}
                    onWidth={(w) => onWidth(name, w)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          <h3 id={`${uid}-hidden`} className="px-2 pt-4 pb-1.5 text-xs font-medium text-muted-foreground">
            Hidden
          </h3>
          {(hidden.length > 8 || find !== "") && (
            <div className="px-2 pb-2">
              <Input
                type="search"
                className="h-8 pointer-coarse:h-11"
                placeholder="Find a column…"
                aria-label="Find a hidden column"
                value={find}
                onChange={(e) => setFind(e.target.value)}
              />
            </div>
          )}
          <ul aria-labelledby={`${uid}-hidden`} className="flex flex-col gap-0.5">
            {matches.map((c) => (
              <li key={c.name}>
                <label className="flex min-h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent pointer-coarse:min-h-11">
                  <input id={boxId("off", c.name)} type="checkbox" checked={false} onChange={() => show(c.name)} />
                  <span className="min-w-0 truncate">{c.label}</span>
                </label>
              </li>
            ))}
            {!matches.length && <li className="px-2 py-1.5 text-sm text-muted-foreground">{hidden.length ? "No hidden column matches." : "Every column is shown."}</li>}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ShownColumn(p: {
  name: string;
  label: string;
  boxId: string;
  first: boolean;
  last: boolean;
  only: boolean;
  width?: number;
  onMove: (by: number) => void;
  onHide: () => void;
  onWidth: (width: number | undefined) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: p.name });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex items-center gap-1 rounded-md bg-popover", isDragging && "relative z-10 shadow-md ring-1 ring-border")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className={cn(ICON_BTN, "cursor-grab touch-none active:cursor-grabbing")}
        {...attributes}
        {...listeners}
        aria-label={`Move ${p.label}`}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <label className="flex min-h-8 min-w-0 flex-1 items-center gap-2 text-sm pointer-coarse:min-h-11" title={p.only ? "A list shows at least one column" : undefined}>
        <input id={p.boxId} type="checkbox" checked aria-disabled={p.only || undefined} onChange={p.onHide} />
        <span className="min-w-0 truncate">{p.label}</span>
      </label>
      <WidthInput label={p.label} width={p.width} onChange={p.onWidth} />
      <button type="button" className={ICON_BTN} aria-label={`Move ${p.label} up`} aria-disabled={p.first || undefined} onClick={() => !p.first && p.onMove(-1)}>
        <ChevronUp className="size-4" aria-hidden="true" />
      </button>
      <button type="button" className={ICON_BTN} aria-label={`Move ${p.label} down`} aria-disabled={p.last || undefined} onClick={() => !p.last && p.onMove(1)}>
        <ChevronDown className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Width in pixels, applied on Enter or leaving the field; empty means automatic. Phones show cards: no widths. */
function WidthInput({ label, width, onChange }: { label: string; width?: number; onChange: (width: number | undefined) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    onChange(draft.trim() === "" || !Number.isFinite(n) ? undefined : clampWidth(n));
    setDraft(null);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={MIN_WIDTH}
      max={MAX_WIDTH}
      step={10}
      placeholder="Auto"
      aria-label={`Width of ${label} in pixels; empty for automatic`}
      className="h-8 w-[4.75rem] shrink-0 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums placeholder:text-muted-foreground [@media(max-width:720px)]:hidden pointer-coarse:h-11"
      value={draft ?? width ?? ""}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        commit();
      }}
    />
  );
}

/**
 * Resizes a column by dragging its header's right edge (double-click: back to automatic). The width
 * follows the pointer through the table's `--cw-<column>` variable and is saved on release.
 * Keyboard users set widths in the column chooser.
 */
export function ColumnResizer({
  name,
  table,
  onStart,
  onCommit,
}: {
  name: string;
  table: RefObject<HTMLTableElement | null>;
  onStart: (name: string, width: number) => void;
  onCommit: (name: string, width: number | undefined) => void;
}) {
  const down = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const cell = handle.parentElement!;
    const start = (cell.querySelector<HTMLElement>("[data-col]") ?? cell).getBoundingClientRect().width;
    const x0 = e.clientX;
    let width = clampWidth(start);
    handle.setPointerCapture(e.pointerId);
    onStart(name, width);
    const move = (ev: PointerEvent) => {
      width = clampWidth(start + ev.clientX - x0);
      table.current?.style.setProperty(`--cw-${name}`, `${width}px`);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      onCommit(name, width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 right-0 z-[1] w-2.5 cursor-col-resize touch-none select-none after:absolute after:inset-y-2 after:right-0 after:w-px after:bg-border hover:after:w-0.5 hover:after:bg-primary"
      onPointerDown={down}
      onDoubleClick={() => onCommit(name, undefined)}
    />
  );
}
