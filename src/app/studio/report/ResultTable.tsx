// The result as a grid: TanStack Table for column sizing, virtualized rows (thousands stay smooth),
// a sticky header and totals line, optional subtotals by the first group. In the builder, headers
// reorder (drag, keyboard or menu), resize (drag or arrow keys) and open a menu to sort, format,
// rename or hide; sorting asks the server, which sorts every row, not only the ones shown.

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getCoreRowModel, useReactTable, type ColumnDef, type ColumnSizingState, type Header } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Columns3, EyeOff, GripVertical, Paintbrush, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { columnLabel, formatCell, groupRows, isNumericColumn, ruleColor, toNumber, type CellOptions, type ColumnSetting, type ResultColumn, type ResultRow, type Sort } from "@/lib/studio";
import { cn } from "@/lib/utils";

export interface ColumnEditor {
  hidden: ResultColumn[];
  onPatch: (c: ResultColumn, patch: Partial<ColumnSetting>, key?: string) => void;
  /** Absent when the order is fixed (pivots). */
  onMove?: (from: string, to: string) => void;
  onFormat: (c: ResultColumn) => void;
}

interface ResultTableProps {
  columns: ResultColumn[];
  rows: ResultRow[];
  totals?: Record<string, unknown> | null;
  sort: Sort[];
  onSort?: (sort: Sort[]) => void;
  editor?: ColumnEditor;
  subtotals?: boolean;
  /** The server's subtotal rows (exact), when the query asked for them. */
  subtotalRows?: ResultRow[];
  options: CellOptions;
  /** Record reports: each row opens its record. */
  entity?: string;
  caption: string;
  className?: string;
}

type DisplayRow = { kind: "row"; row: ResultRow; n: number } | { kind: "subtotal"; label: string; totals: Record<string, unknown> };

export function defaultWidth(c: ResultColumn): number {
  if (c.role === "pivot" || isNumericColumn(c)) return 140;
  if (c.bucket || c.type === "date") return 130;
  if (c.type === "datetime") return 180;
  if (c.type === "check") return 90;
  if (c.type === "text") return 280;
  return 200;
}

/** Pivot cells and previous-period columns are not columns the server can sort by. */
const sortable = (c: ResultColumn) => c.role !== "pivot" && c.role !== "previous";

export function ResultTable({ columns, rows, totals, sort, onSort, editor, subtotals, subtotalRows, options, entity, caption, className }: ResultTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sizing, setSizing] = useState<ColumnSizingState>({});
  const byName = useMemo(() => new Map(columns.map((c) => [c.name, c])), [columns]);
  const dims = columns.filter((c) => c.role === "dimension");
  const groupBy = subtotals && dims.length >= 2 ? dims[0].name : undefined;

  const display = useMemo<DisplayRow[]>(() => {
    if (!groupBy) return rows.map((row, i) => ({ kind: "row", row, n: i + 1 }));
    const out: DisplayRow[] = [];
    let n = 0;
    for (const g of groupRows({ columns, rows, subtotals: subtotalRows }, groupBy, options)) {
      for (const row of g.rows) out.push({ kind: "row", row, n: ++n });
      out.push({ kind: "subtotal", label: `${g.label} total`, totals: g.totals });
    }
    return out;
  }, [rows, columns, groupBy, options, subtotalRows]);

  // The largest magnitude of each data-bar column, for the bars' lengths (plotting only).
  const barMax = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of columns)
      if (c.format?.style === "bar" && isNumericColumn(c)) out.set(c.name, rows.reduce((m, r) => Math.max(m, Math.abs(toNumber(r[c.name]) ?? 0)), 0));
    return out;
  }, [columns, rows]);

  const defs = useMemo<ColumnDef<DisplayRow>[]>(
    () => columns.map((c) => ({ id: c.name, header: columnLabel(c, options), size: c.width ?? defaultWidth(c), minSize: 40, maxSize: 2000 })),
    [columns, options],
  );
  const table = useReactTable({
    data: display,
    columns: defs,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    state: { columnSizing: sizing },
    onColumnSizingChange: setSizing,
  });

  // A resize is saved once, when the drag ends; the saved width then takes over from the local one.
  const resizing = table.getState().columnSizingInfo.isResizingColumn;
  const wasResizing = useRef<string | false>(false);
  const commitRef = useRef<(name: string, width: number | undefined) => void>(() => {});
  commitRef.current = (name, width) => {
    const c = byName.get(name);
    if (!c || !editor) return;
    editor.onPatch(c, { width: width === undefined ? undefined : Math.round(width) }, `width:${name}`);
    setSizing((s) => {
      const next = { ...s };
      delete next[name];
      return next;
    });
  };
  useEffect(() => {
    const name = wasResizing.current;
    if (name && !resizing && sizing[name]) commitRef.current(name, sizing[name]);
    wasResizing.current = resizing;
  }, [resizing, sizing]);

  const virtual = useVirtualizer({ count: display.length, getScrollElement: () => scrollRef.current, estimateSize: () => 37, overscan: 12 });
  const items = virtual.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtual.getTotalSize() - items[items.length - 1].end : 0;
  const span = columns.length + 1;
  const width = table.getTotalSize() + 52;

  const primary = sort[0];
  const toggleSort = (c: ResultColumn) => {
    if (!onSort) return;
    if (primary?.by !== c.name) onSort([{ by: c.name, dir: isNumericColumn(c) ? "desc" : "asc" }]);
    else if (primary.dir === "desc" && isNumericColumn(c)) onSort([{ by: c.name, dir: "asc" }]);
    else if (primary.dir === "asc" && !isNumericColumn(c)) onSort([{ by: c.name, dir: "desc" }]);
    else onSort([]);
  };

  const totalsShown = !!totals && columns.some((c) => c.name in totals);
  const headers = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div className={cn("grid gap-2", className)}>
      {editor && <ColumnsMenu columns={columns} editor={editor} />}
      <div
        ref={scrollRef}
        role="region"
        aria-label={`${caption}: results`}
        tabIndex={0}
        className="max-h-[min(70vh,760px)] overflow-auto rounded-lg border border-border bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <table className="border-separate border-spacing-0 text-sm" style={{ width, minWidth: "100%", tableLayout: "fixed" }} aria-rowcount={display.length + 1 + (totalsShown ? 1 : 0)}>
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col style={{ width: 52 }} />
            {headers.map((h) => (
              <col key={h.id} style={{ width: h.getSize() }} />
            ))}
          </colgroup>
          <thead>
            <HeaderRow headers={headers} byName={byName} sort={primary} onSort={onSort ? toggleSort : undefined} onSortTo={onSort} editor={editor} setSizing={setSizing} commit={(n, w) => commitRef.current(n, w)} />
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr aria-hidden="true">
                <td colSpan={span} style={{ height: padTop, padding: 0, border: 0 }} />
              </tr>
            )}
            {items.map((v) => {
              const d = display[v.index];
              return (
                <tr
                  key={v.key}
                  data-index={v.index}
                  ref={virtual.measureElement}
                  aria-rowindex={v.index + 2}
                  className={cn("group/row", d.kind === "subtotal" ? "bg-muted font-medium" : "hover:bg-muted/50")}
                >
                  <td className="border-b border-border px-2 py-[var(--cell-py)] text-right text-xs text-muted-foreground tabular-nums">
                    {d.kind === "row" && entity && d.row._id ? (
                      <Link to={`/e/${entity}/${d.row._id}`} className="inline-flex items-center gap-0.5 rounded hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`Open record ${d.n}`}>
                        {d.n}
                        <SquareArrowOutUpRight className="size-3 opacity-0 group-hover/row:opacity-100" aria-hidden="true" />
                      </Link>
                    ) : d.kind === "row" ? (
                      d.n
                    ) : null}
                  </td>
                  {columns.map((c, i) =>
                    d.kind === "row" ? (
                      <BodyCell key={c.name} c={c} row={d.row} options={options} max={barMax.get(c.name)} />
                    ) : (
                      <td key={c.name} className={cn("truncate border-b border-border px-3 py-[var(--cell-py)]", isNumericColumn(c) && "text-right tabular-nums")}>
                        {c.name in d.totals ? formatCell(c, d.totals[c.name], undefined, options) : i === 0 ? d.label : ""}
                      </td>
                    ),
                  )}
                </tr>
              );
            })}
            {padBottom > 0 && (
              <tr aria-hidden="true">
                <td colSpan={span} style={{ height: padBottom, padding: 0, border: 0 }} />
              </tr>
            )}
          </tbody>
          {totalsShown && (
            <tfoot>
              <tr aria-rowindex={display.length + 2}>
                <td className="sticky bottom-0 z-10 border-t border-border bg-muted px-2 py-2" />
                {columns.map((c, i) => (
                  <td key={c.name} className={cn("sticky bottom-0 z-10 truncate border-t border-border bg-muted px-3 py-2 font-semibold", isNumericColumn(c) && "text-right tabular-nums")}>
                    {c.name in totals ? formatCell(c, totals[c.name], undefined, options) : i === 0 ? "Total" : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function BodyCell({ c, row, options, max }: { c: ResultColumn; row: ResultRow; options: CellOptions; max?: number }) {
  const v = row[c.name];
  const text = formatCell(c, v, row, options);
  const color = ruleColor(c, v);
  const numeric = isNumericColumn(c);
  const title = row._titles?.[c.name];
  let content: ReactNode = text;
  if (c.to && title && typeof v === "string")
    content = (
      <Link to={`/e/${c.to}/${v}`} className="hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        {text}
      </Link>
    );
  if (max !== undefined) {
    const n = toNumber(v);
    const pct = n === null || !max ? 0 : (Math.abs(n) / max) * 100;
    content = (
      <span className="relative block">
        <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 rounded-sm", n !== null && n < 0 ? "bg-destructive/20" : "bg-primary/20")} style={{ width: `${pct}%` }} />
        <span className="relative">{text}</span>
      </span>
    );
  }
  return (
    <td className={cn("truncate border-b border-border px-3 py-[var(--cell-py)]", numeric && "text-right tabular-nums", color && "font-medium")} style={color ? { color } : undefined} title={text.length > 24 ? text : undefined}>
      {content}
    </td>
  );
}

interface HeaderRowProps {
  headers: Header<DisplayRow, unknown>[];
  byName: Map<string, ResultColumn>;
  sort: Sort | undefined;
  onSort?: (c: ResultColumn) => void;
  onSortTo?: (s: Sort[]) => void;
  editor?: ColumnEditor;
  setSizing: (fn: (s: ColumnSizingState) => ColumnSizingState) => void;
  /** Saves a column's width (undefined: back to the default). */
  commit: (name: string, width: number | undefined) => void;
}

function HeaderRow({ headers, byName, sort, onSort, onSortTo, editor, setSizing, commit }: HeaderRowProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = headers.map((h) => h.id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) editor?.onMove?.(String(active.id), String(over.id));
  };
  const label = (id: unknown) => byName.get(String(id))?.label ?? "column";
  const cells = (
    <tr>
      <th scope="col" className="sticky top-0 z-20 border-b border-border bg-muted px-2 py-2 text-right text-xs font-medium text-muted-foreground">
        <span aria-hidden="true">#</span>
        <span className="sr-only">Row number</span>
      </th>
      {headers.map((h, i) => {
        const c = byName.get(h.id);
        return c ? <HeaderCell key={h.id} h={h} c={c} index={i} count={headers.length} ids={ids} sort={sort} onSort={onSort} onSortTo={onSortTo} editor={editor} setSizing={setSizing} commit={commit} /> : null;
      })}
    </tr>
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        // Its live region is a <div>: inside <thead> it must live elsewhere.
        container: typeof document === "undefined" ? undefined : document.body,
        announcements: {
          onDragStart: ({ active }) => `Picked up column ${label(active.id)}.`,
          onDragOver: ({ active, over }) => (over ? `Column ${label(active.id)} is over ${label(over.id)}.` : `Column ${label(active.id)} is no longer over a column.`),
          onDragEnd: ({ active, over }) => (over ? `Column ${label(active.id)} was dropped at ${label(over.id)}.` : `Column ${label(active.id)} was dropped.`),
          onDragCancel: ({ active }) => `Moving column ${label(active.id)} was cancelled.`,
        },
      }}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        {cells}
      </SortableContext>
    </DndContext>
  );
}

interface HeaderCellProps extends Omit<HeaderRowProps, "headers" | "byName"> {
  h: Header<DisplayRow, unknown>;
  c: ResultColumn;
  index: number;
  count: number;
  ids: string[];
}

function HeaderCell({ h, c, index, count, ids, sort, onSort, onSortTo, editor, setSizing, commit }: HeaderCellProps) {
  const movable = !!editor?.onMove;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: c.name, disabled: !movable });
  const numeric = isNumericColumn(c);
  const active = sort?.by === c.name ? sort.dir : undefined;
  const canSort = !!onSort && sortable(c);
  const label = String(h.column.columnDef.header ?? c.label);
  const size = h.getSize();
  const resizeBy = (delta: number) => {
    const next = Math.min(2000, Math.max(40, size + delta));
    if (editor) commit(c.name, next);
    else setSizing((s) => ({ ...s, [c.name]: next }));
  };
  const onResizeKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      resizeBy((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 64 : 16));
    }
  };
  return (
    <th
      ref={setNodeRef}
      scope="col"
      aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : canSort ? "none" : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group/head sticky top-0 z-20 border-b border-border bg-muted p-0 text-left font-medium", isDragging && "z-30 opacity-80 shadow-lg")}
    >
      <div className={cn("flex h-full min-w-0 items-center gap-0.5 py-1 pr-2 pl-1", numeric && "flex-row-reverse pr-1 pl-2")}>
        {movable && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Move column ${label}`}
            title="Drag to move the column"
            className="grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground opacity-60 group-hover/head:opacity-100 hover:bg-accent focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:size-9"
          >
            <GripVertical className="size-3.5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          disabled={!canSort}
          onClick={() => onSort?.(c)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 enabled:hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default",
            numeric && "flex-row-reverse text-right",
          )}
          title={canSort ? `${label}: sort` : label}
        >
          <span className="truncate">{label}</span>
          {active === "asc" ? <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" /> : active === "desc" ? <ArrowDown className="size-3.5 shrink-0" aria-hidden="true" /> : canSort ? <ArrowUpDown className="size-3.5 shrink-0 opacity-0 group-hover/head:opacity-40" aria-hidden="true" /> : null}
        </button>
        {editor && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="shrink-0 opacity-60 group-hover/head:opacity-100 focus-visible:opacity-100 pointer-coarse:size-9" aria-label={`Column ${label}: actions`}>
                <Columns3 aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={numeric ? "end" : "start"}>
              <DropdownMenuLabel className="max-w-64 truncate">{label}</DropdownMenuLabel>
              {canSort && onSortTo && (
                <>
                  <DropdownMenuItem onSelect={() => onSortTo([{ by: c.name, dir: "asc" }])}>
                    <ArrowUp /> Sort ascending
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onSortTo([{ by: c.name, dir: "desc" }])}>
                    <ArrowDown /> Sort descending
                  </DropdownMenuItem>
                  {active && (
                    <DropdownMenuItem onSelect={() => onSortTo([])}>
                      <X /> Clear sort
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              {movable && (
                <>
                  <DropdownMenuItem disabled={index === 0} onSelect={() => editor.onMove?.(c.name, ids[index - 1])}>
                    <ArrowLeft /> Move left
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={index === count - 1} onSelect={() => editor.onMove?.(c.name, ids[index + 1])}>
                    <ArrowRight /> Move right
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onSelect={() => editor.onFormat(c)}>
                <Paintbrush /> {c.role === "pivot" ? "Format these columns…" : "Rename and format…"}
              </DropdownMenuItem>
              {c.role !== "pivot" && (
                <DropdownMenuItem onSelect={() => editor.onPatch(c, { hidden: true })}>
                  <EyeOff /> Hide column
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize column ${label}`}
        aria-valuenow={Math.round(size)}
        aria-valuemin={40}
        aria-valuemax={2000}
        tabIndex={0}
        onMouseDown={h.getResizeHandler()}
        onTouchStart={h.getResizeHandler()}
        onDoubleClick={() => (editor ? commit(c.name, undefined) : setSizing((s) => ({ ...s, [c.name]: c.width ?? defaultWidth(c) })))}
        onKeyDown={onResizeKey}
        title="Drag to resize (or focus and use the arrow keys); double-click to reset"
        className={cn(
          "absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-primary/30 focus-visible:bg-primary/50 focus-visible:outline-none pointer-coarse:w-4",
          h.column.getIsResizing() && "bg-primary/50",
        )}
      />
    </th>
  );
}

/** Shows and hides columns (pivot cells come and go with their pivot). */
function ColumnsMenu({ columns, editor }: { columns: ResultColumn[]; editor: ColumnEditor }) {
  const all = [...columns.filter((c) => c.role !== "pivot"), ...editor.hidden];
  if (!all.length) return null;
  const hiddenNames = new Set(editor.hidden.map((c) => c.name));
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Columns3 /> Columns{editor.hidden.length ? ` (${editor.hidden.length} hidden)` : ""}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80">
          <DropdownMenuLabel>Shown columns</DropdownMenuLabel>
          {all.map((c) => (
            <DropdownMenuCheckboxItem key={c.name} checked={!hiddenNames.has(c.name)} onSelect={(e) => e.preventDefault()} onCheckedChange={(on) => editor.onPatch(c, { hidden: !on })}>
              <span className="max-w-64 truncate">{c.label}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

