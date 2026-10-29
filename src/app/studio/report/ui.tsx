// Small building blocks of the report builder: sortable rows (pointer, touch and keyboard, plus a
// menu for each move), row menus, section headings, inline issues, field-type icons, media queries.

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Calendar, Ellipsis, GripVertical, Hash, Link2, List, ToggleLeft, Trash2, Type } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon =
    type === "int" || type === "decimal" || type === "currency" || type === "percent"
      ? Hash
      : type === "date" || type === "datetime"
        ? Calendar
        : type === "link"
          ? Link2
          : type === "check"
            ? ToggleLeft
            : type === "select"
              ? List
              : Type;
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
}

/** Messages under a control; give the control `aria-describedby={id}` and `aria-invalid`. */
export function Issues({ id, messages }: { id?: string; messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div id={id} className="grid gap-0.5 text-xs text-destructive">
      {messages.map((m, i) => (
        <p key={i}>{m}</p>
      ))}
    </div>
  );
}

export function PanelSection({ title, action, children, hint }: { title: string; action?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="grid gap-2 border-b border-border px-4 py-3 last:border-b-0" aria-label={title}>
      <div className="flex min-h-7 items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        <span className="ml-auto flex items-center gap-1">{action}</span>
      </div>
      {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

interface SortableListProps {
  /** One stable id per row, in order. */
  ids: string[];
  /** Row names for screen-reader announcements. */
  labels: string[];
  onMove: (from: number, to: number) => void;
  children: ReactNode;
  className?: string;
}

/** A vertical list whose rows move by dragging their handle, or with Space and the arrow keys on it. */
export function SortableList({ ids, labels, onMove, children, className }: SortableListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const name = (id: unknown) => labels[ids.indexOf(String(id))] ?? "item";
  const position = (id: unknown) => `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} is over ${position(over.id)}.` : `${name(active.id)} is no longer over a position.`),
    onDragEnd: ({ active, over }) => (over ? `${name(active.id)} was dropped at ${position(over.id)}.` : `${name(active.id)} was dropped.`),
    onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={cn("grid gap-1.5", className)}>{children}</ul>
      </SortableContext>
    </DndContext>
  );
}

export function SortableItem({ id, label, children, className }: { id: string; label: string; children: ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex min-w-0 items-start gap-1 rounded-md border border-border bg-card p-1.5", isDragging && "relative z-10 shadow-lg", className)}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Move ${label}`}
        title="Drag to reorder (or focus and press Space, then the arrow keys)"
        className="mt-1.5 grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing pointer-coarse:mt-0 pointer-coarse:size-11"
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <div className="grid min-w-0 flex-1 gap-1.5">{children}</div>
    </li>
  );
}

/** A row's menu: the keyboard- and touch-friendly twin of dragging, plus removal. */
export function RowMenu({ label, index, count, onMove, onRemove, children }: { label: string; index: number; count: number; onMove: (to: number) => void; onRemove: () => void; children?: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="mt-0.5 shrink-0" aria-label={`${label}: more actions`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {children}
        <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index - 1)}>
          <ArrowUp /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(index + 1)}>
          <ArrowDown /> Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <Trash2 /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
