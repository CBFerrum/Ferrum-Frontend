// The designer's canvas: the form's tabs, their sections and each section's fields, plus the palette of
// fields no section places. Everything moves by drag and drop (pointer, touch on the grip handles, and
// the keyboard), and every move is also in a menu ("Move to…") for touch and keyboard users.

import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  Ellipsis,
  Eye,
  EyeOff,
  FolderInput,
  GripVertical,
  ListPlus,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { addSection, moveField, removeField, removeSection, renameTab, setSectionTab, tabsOf, unplaced, type LayoutSection } from "../../lib/formLayout";
import type { EntityMeta, Field } from "../../lib/meta";
import { toast } from "../../ui/kit";
import { containerOf, moveFieldToTab, normalize, nudgeField, nudgeSection, nudgeTab, placeSection, plural, removeTab, sectionTitle, tabLabel, tabNameProblem } from "./logic";

/** What a draggable or drop target is. Ids: `f:<field>`, `s:<section>`, `c:<section>|c:palette`, `t:<tab index>`. */
type DragData =
  | { type: "field"; name: string }
  | { type: "section"; key: string }
  | { type: "container"; key: string } // a section's field area, or "palette"
  | { type: "tab"; tab: string | null };

const dataOf = (x: { data: { current?: unknown } } | null | undefined) => x?.data.current as DragData | undefined;

/** Types the form shows across the whole section (FormView's WIDE, plus child tables). */
const WIDE = new Set(["text", "markdown", "code", "json", "table"]);
// The palette keeps the entity's field order: nothing shifts while a field passes over it.
const keepOrder: SortingStrategy = () => null;
const SUBMENU = "max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-auto";
const tabKey = (t: string | null) => t ?? "\u0000";

export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

interface TabDialogState {
  title: string;
  action: string;
  initial: string;
  /** The tab being renamed. */
  current?: string | null;
  /** Element to focus when the dialog is cancelled. */
  returnTo: string;
  onSubmit: (name: string) => void;
}

interface Ctx {
  meta: EntityMeta;
  /** The layout on screen: the drag preview while dragging. */
  layout: LayoutSection[];
  fields: Map<string, Field>;
  change: (next: LayoutSection[]) => void;
  select: (key: string) => void;
  selected: string | null;
  flagged: Set<string>;
  showTab: (tab: string | null) => void;
  /** Moves focus to an element once it renders (after a move), also when a menu closes. */
  focusAfter: (id: string, fromMenu?: boolean) => void;
  restoreFocus: (e: Event) => void;
  askTabName: (d: TabDialogState) => void;
  wide: boolean;
  /** What is being dragged: drop targets for the other kind are switched off meanwhile. */
  dragKind: DragData["type"] | null;
}
const CanvasContext = createContext<Ctx | null>(null);
const useCanvas = () => useContext(CanvasContext)!;

export interface CanvasProps {
  meta: EntityMeta;
  layout: LayoutSection[];
  onChange: (next: LayoutSection[]) => void;
  tab: string | null;
  onTab: (tab: string | null) => void;
  selected: string | null;
  onSelect: (key: string) => void;
  /** Sections with a problem to highlight. */
  flagged: Set<string>;
  /** Wide screens show the palette and `aside` (the inspector) beside the canvas. */
  wide: boolean;
  aside?: ReactNode;
}

export function Canvas({ meta, layout, onChange, tab, onTab, selected, onSelect, flagged, wide, aside }: CanvasProps) {
  const [draft, setDraftState] = useState<LayoutSection[] | null>(null);
  const draftRef = useRef<LayoutSection[] | null>(null);
  const setDraft = (d: LayoutSection[] | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const [dragging, setDragging] = useState<DragData | null>(null);
  const shown = draft ?? layout;
  const fields = useMemo(() => new Map(meta.fields.map((f) => [f.name, f])), [meta.fields]);
  const tabs = tabsOf(shown);
  const current = tabs.includes(tab) ? tab : (tabs[0] ?? null);
  const sections = shown.filter((s) => (s.tab || null) === current);
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const [tabDialog, setTabDialog] = useState<TabDialogState | null>(null);

  // ── focus: after a move the moved item may render elsewhere (another section or tab) ──
  const pendingFocus = useRef<string | null>(null);
  const menuMoved = useRef(false);
  useEffect(() => {
    const el = pendingFocus.current ? document.getElementById(pendingFocus.current) : null;
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });
  const focusAfter = (id: string, fromMenu = true) => {
    pendingFocus.current = id;
    if (fromMenu) menuMoved.current = true;
  };
  // A menu or dialog that moved something keeps focus where the move put it, instead of on its trigger.
  const restoreFocus = (e: Event) => {
    if (!menuMoved.current) return;
    menuMoved.current = false;
    e.preventDefault();
    const el = pendingFocus.current ? document.getElementById(pendingFocus.current) : null;
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  };

  // ── drag and drop ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const movedAcross = useRef(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => (movedAcross.current = false));
    return () => cancelAnimationFrame(t);
  }, [draft]);

  // Hovering a tab while dragging opens it, so the item can be dropped at an exact place there.
  const hover = useRef<{ tab: string | null; timer: number } | null>(null);
  const hoverTab = (t: string | null | undefined) => {
    if (t !== undefined && hover.current?.tab === t) return;
    if (hover.current) window.clearTimeout(hover.current.timer);
    hover.current = t === undefined || t === current ? null : { tab: t, timer: window.setTimeout(() => onTab(t), 600) };
  };
  useEffect(() => () => void (hover.current && window.clearTimeout(hover.current.timer)), []);

  const collision: CollisionDetection = (args) => {
    const of = (...types: DragData["type"][]) => args.droppableContainers.filter((c) => types.includes(dataOf(c)?.type as DragData["type"]));
    const tabHits = pointerWithin({ ...args, droppableContainers: of("tab") });
    if (tabHits.length) return tabHits;
    if (dataOf(args.active)?.type === "section") return closestCenter({ ...args, droppableContainers: of("section") });
    const pool = of("field", "container");
    const hits = pointerWithin({ ...args, droppableContainers: pool });
    let overId = getFirstCollision(hits.length ? hits : rectIntersection({ ...args, droppableContainers: pool }), "id");
    if (overId != null) {
      // Over a section's area: aim at its closest field, so the drop lands between fields.
      const over = dataOf(pool.find((c) => c.id === overId));
      if (over?.type === "container") {
        const cur = draftRef.current ?? layout;
        const inside = pool.filter((c) => {
          const d = dataOf(c);
          return d?.type === "field" && containerOf(cur, d.name) === over.key;
        });
        if (inside.length) overId = closestCenter({ ...args, droppableContainers: inside })[0]?.id ?? overId;
      }
      lastOver.current = overId;
      return [{ id: overId }];
    }
    // Just moved to another section: its layout shifts for a frame; keep the item as the target meanwhile.
    if (movedAcross.current) lastOver.current = args.active.id;
    return lastOver.current != null ? [{ id: lastOver.current }] : [];
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setDragging(dataOf(active) ?? null);
    setDraft(layout);
    lastOver.current = active.id;
  };

  // A field moves between sections (and the palette) while it is dragged; the order within one is set on drop.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    const a = dataOf(active);
    const o = dataOf(over);
    if (o?.type === "tab") return hoverTab(o.tab);
    hoverTab(undefined);
    if (a?.type !== "field" || !over || !o) return;
    const cur = draftRef.current ?? layout;
    const from = containerOf(cur, a.name);
    const to = o.type === "field" ? containerOf(cur, o.name) : o.type === "container" ? o.key : null;
    if (!to || to === from) return;
    movedAcross.current = true;
    if (to === "palette") return setDraft(removeField(cur, a.name));
    const target = cur.find((s) => s.key === to);
    if (!target) return;
    let index = target.fields.length;
    if (o.type === "field") {
      const rect = active.rect.current.translated;
      index = target.fields.indexOf(o.name) + (rect && rect.top > over.rect.top + over.rect.height / 2 ? 1 : 0);
    }
    setDraft(moveField(cur, a.name, to, index));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    hoverTab(undefined);
    const cur = draftRef.current ?? layout;
    setDraft(null);
    setDragging(null);
    const a = dataOf(active);
    const o = dataOf(over);
    if (!a || !o) return; // dropped away from every target: nothing changes
    let next = cur;
    if (a.type === "field") {
      if (o.type === "tab") {
        next = moveFieldToTab(cur, a.name, o.tab);
        onTab(o.tab);
      } else if (o.type === "field" && o.name !== a.name) {
        const c = containerOf(cur, o.name);
        const s = cur.find((x) => x.key === c);
        if (s && c === containerOf(cur, a.name)) next = moveField(cur, a.name, c, s.fields.indexOf(o.name));
      }
    } else if (a.type === "section") {
      if (o.type === "tab") {
        next = setSectionTab(cur, a.key, o.tab);
        onTab(o.tab);
      } else if (o.type === "section") next = placeSection(cur, a.key, o.key);
    }
    onChange(next);
  };

  const onDragCancel = () => {
    hoverTab(undefined);
    setDraft(null);
    setDragging(null);
  };

  const describe = (d: DragData | undefined): string => {
    if (!d) return "item";
    if (d.type === "field") return `field ${fields.get(d.name)?.label ?? d.name}`;
    if (d.type === "tab") return `tab ${tabLabel(d.tab)}`;
    if (d.key === "palette") return "unplaced fields";
    const s = (draftRef.current ?? layout).find((x) => x.key === d.key);
    return `section ${s ? sectionTitle(s) : ""}`;
  };
  const position = (d: DragData | undefined): string => {
    if (d?.type !== "field") return describe(d);
    const cur = draftRef.current ?? layout;
    const s = cur.find((x) => x.key === containerOf(cur, d.name));
    return s ? `${describe(d)}, place ${s.fields.indexOf(d.name) + 1} of ${s.fields.length} in section ${sectionTitle(s)}` : `${describe(d)} in unplaced fields`;
  };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describe(dataOf(active))}.`,
    onDragOver: ({ active, over }) =>
      over ? `${cap(describe(dataOf(active)))} is over ${position(dataOf(over))}.` : `${cap(describe(dataOf(active)))} is not over a place to drop.`,
    onDragEnd: ({ active, over }) =>
      over ? `${cap(describe(dataOf(active)))} was dropped on ${describe(dataOf(over))}.` : `${cap(describe(dataOf(active)))} was put back.`,
    onDragCancel: ({ active }) => `Moving ${describe(dataOf(active))} was cancelled; it is back where it was.`,
  };

  const addHere = () => {
    const [next, key] = addSection(shown, current);
    onChange(next);
    onSelect(key);
    focusAfter(wide ? "fd-insp-label" : `fd-st-${key}`, false);
  };

  const ctx: Ctx = {
    meta,
    layout: shown,
    fields,
    change: onChange,
    select: onSelect,
    selected,
    flagged,
    showTab: onTab,
    focusAfter,
    restoreFocus,
    askTabName: setTabDialog,
    wide,
    dragKind: dragging?.type ?? null,
  };

  return (
    <CanvasContext.Provider value={ctx}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "To move this item, press Space or Enter, move it with the arrow keys, then press Space or Enter to drop it, or Escape to cancel. Its menu has the same moves.",
          },
        }}
      >
        <div className={cn("grid items-start gap-4", wide && "grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)_minmax(16rem,20rem)]")}>
          <Palette />
          <div className="min-w-0">
            <TabStrip tabs={tabs} current={current} />
            <div
              role={tabs.length ? "tabpanel" : undefined}
              id="fd-canvas-panel"
              aria-labelledby={tabs.length ? `fd-tab-${tabs.indexOf(current)}` : undefined}
              className="flex flex-col gap-3"
            >
              {shown.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  With no sections the form shows every field in one untitled section. Add a section to arrange them.
                </div>
              ) : (
                <SortableContext items={sections.map((s) => `s:${s.key}`)} strategy={verticalListSortingStrategy}>
                  {sections.map((s, i) => (
                    <SectionCard key={s.key} s={s} first={i === 0} last={i === sections.length - 1} />
                  ))}
                </SortableContext>
              )}
              <Button id="fd-add-section" variant="outline" className="w-full border-dashed pointer-coarse:h-11" onClick={addHere}>
                <Plus aria-hidden="true" /> Add section{tabs.length > 1 ? ` to ${tabLabel(current)}` : ""}
              </Button>
            </div>
          </div>
          {aside}
        </div>
        <DragOverlay dropAnimation={reducedMotion ? null : undefined}>{dragging && <DragPreview data={dragging} />}</DragOverlay>
      </DndContext>
      {tabDialog && <TabNameDialog state={tabDialog} layout={shown} onClose={() => setTabDialog(null)} onCloseAutoFocus={restoreFocus} />}
    </CanvasContext.Provider>
  );
}

// ── tabs ──

function TabStrip({ tabs, current }: { tabs: (string | null)[]; current: string | null }) {
  const c = useCanvas();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(current);
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (to === null || !tabs.length) return;
    e.preventDefault();
    const j = (to + tabs.length) % tabs.length;
    c.showTab(tabs[j]);
    c.focusAfter(`fd-tab-${j}`, false);
  };
  const addTab = () =>
    c.askTabName({
      title: "Add a tab",
      action: "Add tab",
      initial: "",
      returnTo: "fd-add-tab",
      onSubmit: (name) => {
        const [next, key] = addSection(c.layout, name);
        c.change(next);
        c.showTab(name);
        c.select(key);
        c.focusAfter(c.wide ? "fd-insp-label" : `fd-st-${key}`);
      },
    });
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1 border-b pb-2">
      <div role="tablist" aria-label="Form tabs" className="flex min-w-0 flex-1 gap-1 overflow-x-auto p-0.5" onKeyDown={onKeyDown}>
        {tabs.map((t, i) => (
          <TabButton key={tabKey(t)} tab={t} index={i} selected={t === current} />
        ))}
      </div>
      {tabs.length > 0 && <TabMenu tab={current} index={tabs.indexOf(current)} />}
      <Button id="fd-add-tab" variant="ghost" size="sm" className="pointer-coarse:h-11" onClick={addTab}>
        <Plus aria-hidden="true" /> Add tab
      </Button>
    </div>
  );
}

function TabButton({ tab, index, selected }: { tab: string | null; index: number; selected: boolean }) {
  const c = useCanvas();
  const { setNodeRef, isOver } = useDroppable({ id: `t:${index}`, data: { type: "tab", tab } satisfies DragData });
  const count = c.layout.filter((s) => (s.tab || null) === tab).reduce((n, s) => n + s.fields.length, 0);
  return (
    <button
      ref={setNodeRef}
      type="button"
      role="tab"
      id={`fd-tab-${index}`}
      aria-selected={selected}
      aria-controls="fd-canvas-panel"
      tabIndex={selected ? 0 : -1}
      onClick={() => c.showTab(tab)}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11",
        selected && "bg-accent text-foreground shadow-xs",
        isOver && "bg-primary-soft text-foreground ring-2 ring-primary",
      )}
    >
      {tabLabel(tab)}
      <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">
        {count}
      </span>
      <span className="sr-only">, {plural(count, "field")}</span>
    </button>
  );
}

function TabMenu({ tab, index }: { tab: string | null; index: number }) {
  const c = useCanvas();
  const left = nudgeTab(c.layout, tab, -1);
  const right = nudgeTab(c.layout, tab, 1);
  const rename = () => {
    c.focusAfter("fd-tab-name");
    c.askTabName({
      title: `Rename ${tabLabel(tab)}`,
      action: "Rename",
      initial: tab ?? "",
      current: tab,
      returnTo: "fd-tab-menu",
      onSubmit: (name) => {
        const next = normalize(renameTab(c.layout, tab, name));
        c.change(next);
        c.showTab(name);
        c.focusAfter(`fd-tab-${tabsOf(next).indexOf(name)}`);
      },
    });
  };
  const move = (next: LayoutSection[], to: number) => {
    c.change(next);
    c.focusAfter(`fd-tab-${to}`);
  };
  const remove = () => {
    if (tab === null) return;
    c.change(removeTab(c.layout, tab));
    c.showTab(null);
    c.focusAfter("fd-tab-0");
    toast(`Tab “${tab}” removed: its sections moved to Details.`, "info");
  };
  return (
    <DropdownMenu>
      <MenuButton id="fd-tab-menu" label={`Actions for tab ${tabLabel(tab)}`} />
      <DropdownMenuContent align="end" onCloseAutoFocus={c.restoreFocus}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">{tabLabel(tab)}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={rename}>
          <Pencil aria-hidden="true" /> Rename…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={left === c.layout} onSelect={() => move(left, index - 1)}>
          <ArrowLeft aria-hidden="true" /> Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={right === c.layout} onSelect={() => move(right, index + 1)}>
          <ArrowRight aria-hidden="true" /> Move right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={tab === null} onSelect={remove}>
          <Trash2 aria-hidden="true" /> Remove tab
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Asks for a tab name, checked like the server's labels are shown: unique, and not the first tab's "Details". */
export function TabNameDialog({
  state,
  layout,
  onClose,
  onCloseAutoFocus,
}: {
  state: TabDialogState;
  layout: LayoutSection[];
  onClose: () => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const [name, setName] = useState(state.initial);
  const [tried, setTried] = useState(false);
  const problem = tabNameProblem(name, layout, state.current);
  const submitted = useRef(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return setTried(true);
    submitted.current = true;
    state.onSubmit(name.trim());
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e);
          if (!e.defaultPrevented && !submitted.current) {
            e.preventDefault();
            document.getElementById(state.returnTo)?.focus();
          }
        }}
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{state.title}</DialogTitle>
            <DialogDescription>Sections in the same tab show together under it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="fd-tab-name">Tab name</Label>
            <Input
              id="fd-tab-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              maxLength={80}
              aria-invalid={tried && !!problem}
              aria-describedby={tried && problem ? "fd-tab-name-error" : undefined}
            />
            {tried && problem && (
              <p id="fd-tab-name-error" className="text-sm text-destructive">
                {problem}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{state.action}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── sections ──

function SectionCard({ s, first, last }: { s: LayoutSection; first: boolean; last: boolean }) {
  const c = useCanvas();
  const sortable = useSortable({
    id: `s:${s.key}`,
    data: { type: "section", key: s.key } satisfies DragData,
    disabled: { draggable: false, droppable: c.dragKind === "field" },
  });
  const area = useDroppable({ id: `c:${s.key}`, data: { type: "container", key: s.key } satisfies DragData, disabled: c.dragKind === "section" });
  const title = sectionTitle(s);
  const cols = Math.min(Math.max(s.columns, 1), 4);
  const selected = c.selected === s.key;
  const flagged = c.flagged.has(s.key);
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      role="group"
      aria-label={`Section ${title}`}
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-xs",
        selected && "border-primary ring-1 ring-primary",
        flagged && "border-destructive ring-1 ring-destructive",
        sortable.isDragging && "opacity-40",
      )}
    >
      <header className="flex min-w-0 items-center gap-1 border-b px-1 py-1">
        <DragHandle id={`fd-sh-${s.key}`} label={`Drag section ${title}`} ref={sortable.setActivatorNodeRef} {...sortable.attributes} {...sortable.listeners} />
        <button
          type="button"
          id={`fd-st-${s.key}`}
          onClick={() => c.select(s.key)}
          aria-pressed={c.wide ? selected : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm font-semibold outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
        >
          <span className={cn("truncate", !s.label?.trim() && "font-normal text-muted-foreground italic")}>{title}</span>
          <span className="sr-only">, settings</span>
          {flagged && <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />}
          {flagged && <span className="sr-only">, has a problem</span>}
        </button>
        <span className="flex shrink-0 items-center gap-1 max-sm:hidden" aria-hidden="true">
          <Badge variant="secondary">{plural(cols, "column")}</Badge>
          {s.collapsible && <Badge variant="outline">Collapsible</Badge>}
        </span>
        {s.visible_if?.trim() && (
          <Badge variant="outline" title={`Shows only if ${s.visible_if}`} className="max-w-32 shrink-0">
            <Eye aria-hidden="true" />
            <span className="truncate">Conditional</span>
          </Badge>
        )}
        <SectionMenu s={s} first={first} last={last} />
      </header>
      <div
        ref={area.setNodeRef}
        style={{ "--cols": cols } as CSSProperties}
        className={cn(
          "grid min-h-16 grid-cols-1 gap-2 rounded-b-lg p-2 min-[721px]:grid-cols-[repeat(var(--cols),minmax(0,1fr))]",
          area.isOver && "bg-primary-soft",
        )}
      >
        <SortableContext items={s.fields.map((f) => `f:${f}`)} strategy={cols === 1 ? verticalListSortingStrategy : rectSortingStrategy}>
          {s.fields.map((f, i) => (
            <FieldCard key={f} name={f} first={i === 0} last={i === s.fields.length - 1} />
          ))}
        </SortableContext>
        {!s.fields.length && (
          <p className="col-span-full self-center px-2 py-3 text-center text-sm text-muted-foreground">
            Drop fields here, or use a field’s menu to move it into this section. Empty sections are not saved.
          </p>
        )}
      </div>
    </div>
  );
}

function SectionMenu({ s, first, last }: { s: LayoutSection; first: boolean; last: boolean }) {
  const c = useCanvas();
  const title = sectionTitle(s);
  const tab = s.tab || null;
  const tabs = tabsOf(c.layout);
  const act = (next: LayoutSection[], focus = `fd-sm-${s.key}`) => {
    c.change(next);
    c.focusAfter(focus);
  };
  const toTab = (t: string | null) => {
    act(setSectionTab(c.layout, s.key, t));
    c.showTab(t);
  };
  const newTab = () => {
    c.focusAfter("fd-tab-name");
    c.askTabName({ title: "Move to a new tab", action: "Move", initial: "", returnTo: `fd-sm-${s.key}`, onSubmit: (name) => toTab(name) });
  };
  const addBelow = () => {
    const [next, key] = addSection(c.layout, tab, s.key);
    c.change(next);
    c.select(key);
    c.focusAfter(c.wide ? "fd-insp-label" : `fd-st-${key}`);
  };
  const remove = () => {
    act(removeSection(c.layout, s.key), "fd-add-section");
    if (s.fields.length) toast(`Section deleted: its ${plural(s.fields.length, "field")} moved to Unplaced fields.`, "info");
  };
  return (
    <DropdownMenu>
      <MenuButton id={`fd-sm-${s.key}`} label={`Actions for section ${title}`} />
      <DropdownMenuContent align="end" onCloseAutoFocus={c.restoreFocus}>
        <DropdownMenuItem
          onSelect={() => {
            c.select(s.key);
            c.focusAfter("fd-insp-label");
          }}
        >
          <Settings2 aria-hidden="true" /> Settings…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={first} onSelect={() => act(nudgeSection(c.layout, s.key, -1))}>
          <ArrowUp aria-hidden="true" /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => act(nudgeSection(c.layout, s.key, 1))}>
          <ArrowDown aria-hidden="true" /> Move down
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderInput aria-hidden="true" /> Move to tab
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={SUBMENU}>
            {(tabs.includes(null) ? tabs : [null, ...tabs]).map((t) => (
              <DropdownMenuItem key={tabKey(t)} disabled={t === tab} onSelect={() => toTab(t)}>
                {tabLabel(t)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={newTab}>
              <Plus aria-hidden="true" /> New tab…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={addBelow}>
          <ListPlus aria-hidden="true" /> Add section below
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={remove}>
          <Trash2 aria-hidden="true" /> Delete section
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── fields ──

function typeLabel(f: Field | undefined, meta: EntityMeta): string {
  if (!f) return "";
  if (f.type === "link" && f.to) return `link → ${f.to}`;
  if (f.type === "table") return `table of ${meta.children[f.name]?.label ?? "rows"}`;
  return f.type;
}

function FieldText({ name }: { name: string }) {
  const c = useCanvas();
  const f = c.fields.get(name);
  return (
    <div className="min-w-0 flex-1 py-1">
      <div className="flex min-w-0 items-center gap-1 text-sm font-medium">
        <span className="truncate">{f?.label ?? name}</span>
        {f?.required && (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        )}
        {f?.required && <span className="sr-only">, required</span>}
        {f?.hidden && <EyeOff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        {f?.hidden && <span className="sr-only">, hidden</span>}
        {f?.visible_if && <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        {f?.visible_if && <span className="sr-only">, shown on a condition</span>}
      </div>
      <div className="truncate font-mono text-xs text-muted-foreground">
        {name} · {typeLabel(f, c.meta)}
      </div>
    </div>
  );
}

function FieldCard({ name, first, last, inPalette }: { name: string; first: boolean; last: boolean; inPalette?: boolean }) {
  const c = useCanvas();
  const f = c.fields.get(name);
  const sortable = useSortable({
    id: `f:${name}`,
    data: { type: "field", name } satisfies DragData,
    disabled: { draggable: false, droppable: c.dragKind === "section" },
  });
  const label = f?.label ?? name;
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        "flex min-w-0 items-center gap-0.5 rounded-md border bg-background pr-0.5 shadow-xs",
        !inPalette && f && WIDE.has(f.type) && "col-span-full",
        sortable.isDragging && "opacity-40",
      )}
    >
      <DragHandle id={`fd-fh-${name}`} label={`Drag field ${label}`} ref={sortable.setActivatorNodeRef} {...sortable.attributes} {...sortable.listeners} />
      <FieldText name={name} />
      {inPalette ? <PaletteMenu name={name} label={label} /> : <FieldMenu name={name} label={label} first={first} last={last} />}
    </div>
  );
}

/** The sections of every tab, grouped by tab, for "Move to…" and "Add to…". */
function Destinations({ exclude, onPick }: { exclude?: string; onPick: (key: string) => void }) {
  const c = useCanvas();
  const tabs = tabsOf(c.layout);
  if (!tabs.length) return <DropdownMenuItem disabled>Add a section first</DropdownMenuItem>;
  return tabs.map((t, i) => (
    <DropdownMenuGroup key={tabKey(t)}>
      {i > 0 && <DropdownMenuSeparator />}
      <DropdownMenuLabel className="text-xs text-muted-foreground">{tabLabel(t)}</DropdownMenuLabel>
      {c.layout
        .filter((s) => (s.tab || null) === t)
        .map((s) => (
          <DropdownMenuItem key={s.key} disabled={s.key === exclude} onSelect={() => onPick(s.key)}>
            <span className={cn("truncate", !s.label?.trim() && "text-muted-foreground italic")}>{sectionTitle(s)}</span>
          </DropdownMenuItem>
        ))}
    </DropdownMenuGroup>
  ));
}

function useMoveTo(name: string) {
  const c = useCanvas();
  return (key: string) => {
    const target = c.layout.find((s) => s.key === key);
    if (!target) return;
    c.change(moveField(c.layout, name, key, target.fields.length));
    c.showTab(target.tab || null);
    c.focusAfter(`fd-fm-${name}`);
  };
}

function FieldMenu({ name, label, first, last }: { name: string; label: string; first: boolean; last: boolean }) {
  const c = useCanvas();
  const moveTo = useMoveTo(name);
  const act = (next: LayoutSection[], focus = `fd-fm-${name}`) => {
    c.change(next);
    c.focusAfter(focus);
  };
  return (
    <DropdownMenu>
      <MenuButton id={`fd-fm-${name}`} label={`Actions for field ${label}`} />
      <DropdownMenuContent align="end" onCloseAutoFocus={c.restoreFocus}>
        <DropdownMenuItem disabled={first} onSelect={() => act(nudgeField(c.layout, name, -1))}>
          <ArrowUp aria-hidden="true" /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => act(nudgeField(c.layout, name, 1))}>
          <ArrowDown aria-hidden="true" /> Move down
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderInput aria-hidden="true" /> Move to…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={SUBMENU}>
            <Destinations exclude={containerOf(c.layout, name)} onPick={moveTo} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => act(removeField(c.layout, name), "fd-palette")}>
          <Undo2 aria-hidden="true" /> Take off the layout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PaletteMenu({ name, label }: { name: string; label: string }) {
  const c = useCanvas();
  const moveTo = useMoveTo(name);
  return (
    <DropdownMenu>
      <MenuButton id={`fd-pm-${name}`} label={`Add field ${label} to a section`} icon={<Plus />} />
      <DropdownMenuContent align="end" onCloseAutoFocus={c.restoreFocus} className={SUBMENU}>
        <DropdownMenuLabel>Add {label} to…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <Destinations onPick={moveTo} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── palette ──

function Palette() {
  const c = useCanvas();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const area = useDroppable({ id: "c:palette", data: { type: "container", key: "palette" } satisfies DragData, disabled: c.dragKind === "section" });
  const all = unplaced(c.layout, c.meta);
  const q = query.trim().toLowerCase();
  const list = q ? all.filter((n) => n.toLowerCase().includes(q) || (c.fields.get(n)?.label ?? "").toLowerCase().includes(q)) : all;
  const title = (
    <>
      Unplaced fields
      <Badge variant="secondary" className="tabular-nums">
        {all.length}
      </Badge>
    </>
  );
  return (
    <aside
      ref={area.setNodeRef}
      aria-labelledby="fd-palette"
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-card text-card-foreground",
        c.wide && "sticky top-[calc(var(--topbar-h)+1rem)] max-h-[calc(100dvh-var(--topbar-h)-2rem)]",
        area.isOver && "ring-2 ring-primary",
      )}
    >
      {c.wide ? (
        <h2 id="fd-palette" tabIndex={-1} className="flex items-center gap-2 px-3 pt-3 text-sm font-semibold outline-none">
          {title}
        </h2>
      ) : (
        <button
          type="button"
          id="fd-palette"
          aria-expanded={open}
          aria-controls="fd-palette-list"
          onClick={() => setOpen(!open)}
          className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {title}
          <ChevronDown className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      )}
      {(c.wide || open) && (
        <div id="fd-palette-list" className="flex min-h-0 flex-col gap-2 p-3">
          <p className="text-xs text-muted-foreground">
            The form shows these under “Additional fields” at the end of its first tab. Drag one onto a section or use its + menu; drag a field here to take it
            off the layout.
          </p>
          {all.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input type="search" aria-label="Search unplaced fields" placeholder="Search fields" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
            </div>
          )}
          <div className="-mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1 py-0.5">
            <SortableContext items={list.map((n) => `f:${n}`)} strategy={keepOrder}>
              {list.map((n) => (
                <FieldCard key={n} name={n} first last inPalette />
              ))}
            </SortableContext>
            {!all.length && <p className="py-4 text-center text-sm text-muted-foreground">Every field has a place on the layout.</p>}
            {all.length > 0 && !list.length && <p className="py-4 text-center text-sm text-muted-foreground">No unplaced field matches “{query.trim()}”.</p>}
          </div>
        </div>
      )}
    </aside>
  );
}

// ── small parts ──

function DragHandle({ label, className, ...props }: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing pointer-coarse:size-11",
        className,
      )}
      {...props}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}

function MenuButton({ id, label, icon }: { id: string; label: string; icon?: ReactNode }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button id={id} variant="ghost" size="icon-sm" aria-label={label} className="shrink-0 pointer-coarse:size-11">
        {icon ?? <Ellipsis />}
      </Button>
    </DropdownMenuTrigger>
  );
}

function DragPreview({ data }: { data: DragData }) {
  const c = useCanvas();
  if (data.type === "field") {
    return (
      <div className="flex w-64 max-w-[80vw] cursor-grabbing items-center gap-0.5 rounded-md border bg-background pr-2 shadow-lg ring-2 ring-primary">
        <span className="inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground">
          <GripVertical className="size-4" aria-hidden="true" />
        </span>
        <FieldText name={data.name} />
      </div>
    );
  }
  if (data.type !== "section") return null;
  const s = c.layout.find((x) => x.key === data.key);
  if (!s) return null;
  return (
    <div className="flex w-72 max-w-[80vw] cursor-grabbing items-center gap-2 rounded-lg border bg-card px-2 py-2 shadow-lg ring-2 ring-primary">
      <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{sectionTitle(s)}</div>
        <div className="text-xs text-muted-foreground">{plural(s.fields.length, "field")}</div>
      </div>
    </div>
  );
}
