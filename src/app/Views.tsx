// Board, calendar and timeline views of any entity, chosen from its fields (lib/views.ts).
// They honour the list's search and filters; records open in the usual form.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type DragEvent } from "react";
import { Link } from "react-router";
import { api, docPath, errorMessage } from "../lib/api";
import { can, recordTitle, type Doc, type EntityMeta, type Field, type ListResponse } from "../lib/meta";
import { addDays, bar, dayOf, dayRangeFilters, monthGrid, weekStart } from "../lib/views";
import { Badge, Button, EmptyState, ErrorState, Icon, PageLoading, statusTone, toast } from "../ui/kit";
import { CellValue } from "./widgets";

/** The most records a view loads; filters narrow it. */
const LIMIT = 500;

interface ViewProps {
  meta: EntityMeta;
  /** The list's serialized filters and search. */
  filters?: string;
  q: string;
}

/** Fields shown on a card: the list columns without the title and the grouping field. */
function cardFields(meta: EntityMeta, skip: string[]): Field[] {
  const byName = new Map(meta.fields.map((f) => [f.name, f]));
  const names = meta.list.columns.length ? meta.list.columns : meta.fields.filter((f) => f.in_list).map((f) => f.name);
  return names
    .map((n) => byName.get(n))
    .filter((f): f is Field => !!f && f.can_read === true && !f.hidden && f.type !== "table" && f.name !== meta.title_field && !skip.includes(f.name))
    .slice(0, 3);
}

function useViewRows(meta: EntityMeta, key: unknown[], { filters, q }: Omit<ViewProps, "meta">, fields: string[], extra: unknown[] = [], sort?: string) {
  const all = JSON.stringify([...(filters ? (JSON.parse(filters) as unknown[]) : []), ...extra]);
  const wanted = [...new Set(["id", "version", "docstatus", ...(meta.title_field ? [meta.title_field] : []), ...fields])].join(",");
  return useQuery({
    queryKey: ["view", meta.name, ...key, all, q, wanted],
    queryFn: ({ signal }) =>
      api.get<ListResponse>(docPath(meta.name), { fields: wanted, filters: all === "[]" ? undefined : all, search: q || undefined, limit: LIMIT, titles: true, sort }, signal),
  });
}

function Truncated({ n }: { n: number }) {
  return n >= LIMIT ? <p className="faint view-note">Showing the first {LIMIT}. Filter to narrow the view.</p> : null;
}

function Card({ meta, row, fields }: { meta: EntityMeta; row: Doc; fields: Field[] }) {
  return (
    <>
      <Link className="cell-title" to={`/e/${meta.name}/${row.id}`}>
        {recordTitle(meta, row)}
      </Link>
      {fields.map((f) =>
        row[f.name] === null || row[f.name] === undefined || row[f.name] === "" ? null : (
          <div key={f.name} className="card-field">
            <span className="faint">{f.label}</span> <CellValue field={f} value={row[f.name]} title={row._titles?.[f.name]} />
          </div>
        ),
      )}
    </>
  );
}

// ── board ──

export function BoardView({ meta, field, ...rest }: ViewProps & { field: Field }) {
  const qc = useQueryClient();
  const shown = useMemo(() => cardFields(meta, [field.name]), [meta, field]);
  const res = useViewRows(meta, ["board", field.name], rest, [field.name, ...shown.map((f) => f.name)]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const rows = res.data?.rows ?? [];

  const columns = useMemo(() => {
    const cols = [...(field.options ?? [])];
    for (const r of rows) {
      const v = (r[field.name] as string | null) ?? "";
      if (!cols.includes(v)) cols[v === "" ? "unshift" : "push"](v);
    }
    return cols;
  }, [field, rows]);

  const movable = (r: Doc) => can(meta.permissions, "write") && field.can_write === true && !field.read_only && (r.docstatus ?? 0) === 0;
  const move = async (r: Doc, to: string) => {
    if (((r[field.name] as string | null) ?? "") === to) return;
    setMoving(String(r.id));
    try {
      await api.patch(docPath(meta.name, String(r.id)), { [field.name]: to || null }, { ifMatch: r.version });
      toast(`${recordTitle(meta, r)} moved to ${to || `no ${field.label.toLowerCase()}`}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setMoving(null);
      await qc.invalidateQueries({ queryKey: ["view", meta.name] });
      void qc.invalidateQueries({ queryKey: ["list", meta.name] });
    }
  };
  const drop = (col: string) => (e: DragEvent) => {
    e.preventDefault();
    const r = rows.find((x) => x.id === dragging);
    setDragging(null);
    setOver(null);
    if (r) void move(r, col);
  };

  if (res.error) return <ErrorState error={res.error} onRetry={() => res.refetch()} />;
  if (res.isLoading) return <PageLoading />;
  return (
    <>
      <div className="board">
        {columns.map((col) => {
          const items = rows.filter((r) => ((r[field.name] as string | null) ?? "") === col);
          return (
            <section
              key={col}
              className="board-col"
              aria-label={`${col || `No ${field.label}`}: ${items.length}`}
              data-over={over === col}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setOver(col);
              }}
              onDragLeave={() => setOver((o) => (o === col ? null : o))}
              onDrop={drop(col)}
            >
              <header className="board-col-head">
                <Badge tone={col ? statusTone(col) : "neutral"}>{col || `No ${field.label.toLowerCase()}`}</Badge>
                <span className="faint">{items.length}</span>
              </header>
              <ul className="board-cards">
                {items.map((r) => {
                  const id = String(r.id);
                  const canMove = movable(r);
                  return (
                    <li
                      key={id}
                      className="board-card"
                      draggable={canMove}
                      aria-busy={moving === id}
                      data-dragging={dragging === id}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", id);
                        setDragging(id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    >
                      <Card meta={meta} row={r} fields={shown} />
                      {/* Touch screens and keyboards cannot drag: the same move from a menu. */}
                      {canMove && (
                        <select
                          className="select board-move"
                          aria-label={`Move ${recordTitle(meta, r)} to`}
                          value={col}
                          disabled={moving === id}
                          onChange={(e) => void move(r, e.target.value)}
                        >
                          {columns.map((c) => (
                            <option key={c} value={c}>
                              {c || `No ${field.label.toLowerCase()}`}
                            </option>
                          ))}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <Truncated n={rows.length} />
    </>
  );
}

// ── calendar ──

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarView({ meta, field, ...rest }: ViewProps & { field: Field }) {
  const today = dayOf(new Date().toISOString())!;
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const grid = useMemo(() => monthGrid(y, m - 1), [y, m]);
  const shown = useMemo(() => cardFields(meta, [field.name]), [meta, field]);
  const res = useViewRows(meta, ["calendar", field.name, month], rest, [field.name, ...shown.map((f) => f.name)], dayRangeFilters(field, grid[0]!, grid[41]!), `${field.name} asc`);
  const byDay = useMemo(() => {
    const out = new Map<string, Doc[]>();
    for (const r of res.data?.rows ?? []) {
      const d = dayOf(r[field.name]);
      if (d) out.set(d, [...(out.get(d) ?? []), r]);
    }
    return out;
  }, [res.data, field]);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString();
    setMonth(d.slice(0, 7));
    setSelected(d.slice(0, 10));
  };
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const canCreate = can(meta.permissions, "create") && field.can_write === true && field.type === "date";
  const dayItems = byDay.get(selected) ?? [];

  if (res.error) return <ErrorState error={res.error} onRetry={() => res.refetch()} />;
  return (
    <div className="calendar">
      <div className="view-nav">
        <Button size="sm" icon="left" aria-label="Previous month" onClick={() => shift(-1)} />
        <h2 className="view-title" aria-live="polite">
          {title}
        </h2>
        <Button size="sm" icon="chevronRight" aria-label="Next month" onClick={() => shift(1)} />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setMonth(today.slice(0, 7));
            setSelected(today);
          }}
        >
          Today
        </Button>
        {res.isFetching && <span className="faint">Loading…</span>}
      </div>
      <div className="cal-grid" role="grid" aria-label={`${meta.label_plural} by ${field.label.toLowerCase()}, ${title}`}>
        <div className="cal-row" role="row">
          {WEEKDAYS.map((d) => (
            <div key={d} className="cal-weekday" role="columnheader">
              {d}
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, w) => (
          <div key={w} className="cal-row" role="row">
            {grid.slice(w * 7, w * 7 + 7).map((day) => {
              const items = byDay.get(day) ?? [];
              return (
                <div
                  key={day}
                  role="gridcell"
                  className="cal-day"
                  data-other={day.slice(0, 7) !== month}
                  data-today={day === today}
                  aria-selected={day === selected}
                >
                  <button type="button" className="cal-date" onClick={() => setSelected(day)} aria-label={`${day}: ${items.length} ${items.length === 1 ? "record" : "records"}`}>
                    {Number(day.slice(8))}
                    {items.length > 0 && <span className="cal-count">{items.length}</span>}
                  </button>
                  <ul className="cal-items">
                    {items.slice(0, 3).map((r) => (
                      <li key={String(r.id)}>
                        <Link to={`/e/${meta.name}/${r.id}`} className="cal-item" title={recordTitle(meta, r)}>
                          {recordTitle(meta, r)}
                        </Link>
                      </li>
                    ))}
                    {items.length > 3 && (
                      <li>
                        <button type="button" className="cal-more" onClick={() => setSelected(day)}>
                          +{items.length - 3} more
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <section className="cal-agenda" aria-label={`Records on ${selected}`}>
        <div className="row">
          <h3>{new Date(`${selected}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</h3>
          <span className="spacer" />
          {canCreate && (
            <Link className="btn btn-md" to={`/e/${meta.name}/new?${new URLSearchParams({ [field.name]: selected })}`}>
              <Icon name="plus" />
              New {meta.label}
            </Link>
          )}
        </div>
        {dayItems.length ? (
          <ul className="agenda-list">
            {dayItems.map((r) => (
              <li key={String(r.id)} className="board-card">
                <Card meta={meta} row={r} fields={shown} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing on this day.</p>
        )}
      </section>
      <Truncated n={res.data?.rows.length ?? 0} />
    </div>
  );
}

// ── timeline ──

const WEEKS = 6;

export function TimelineView({ meta, start, end, ...rest }: ViewProps & { start: Field; end: Field }) {
  const today = dayOf(new Date().toISOString())!;
  const [from, setFrom] = useState(() => addDays(weekStart(today), -7));
  const days = WEEKS * 7;
  const to = addDays(from, days - 1);
  const progress = meta.fields.find((f) => f.type === "percent" && f.can_read && /progress|complete/.test(f.name));
  const status = meta.fields.find((f) => f.name === "status" && f.can_read);
  const extra = [
    [start.name, "<=", dayRangeFilters(start, from, to)[1]![2]],
    [end.name, ">=", dayRangeFilters(end, from, to)[0]![2]],
  ];
  const res = useViewRows(meta, ["timeline", start.name, end.name, from], rest, [start.name, end.name, ...(progress ? [progress.name] : []), ...(status ? ["status"] : [])], extra, `${start.name} asc`);
  const rows = res.data?.rows ?? [];
  const todayAt = bar(today, today, from, days);
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(from, i * 7));

  if (res.error) return <ErrorState error={res.error} onRetry={() => res.refetch()} />;
  return (
    <div>
      <div className="view-nav">
        <Button size="sm" icon="left" aria-label="Earlier" onClick={() => setFrom(addDays(from, -28))} />
        <h2 className="view-title" aria-live="polite">
          {fmt(from)} – {fmt(to)}
        </h2>
        <Button size="sm" icon="chevronRight" aria-label="Later" onClick={() => setFrom(addDays(from, 28))} />
        <Button size="sm" variant="ghost" onClick={() => setFrom(addDays(weekStart(today), -7))}>
          Today
        </Button>
        {res.isFetching && <span className="faint">Loading…</span>}
      </div>
      {res.isLoading ? (
        <PageLoading />
      ) : !rows.length ? (
        <EmptyState title="Nothing in this period" icon="timeline">
          <p className="muted">
            Records appear here when their {start.label.toLowerCase()} and {end.label.toLowerCase()} overlap these weeks.
          </p>
        </EmptyState>
      ) : (
        <div className="timeline-wrap">
          <div className="timeline" style={{ ["--weeks" as string]: WEEKS }}>
            <div className="tl-row tl-head">
              <div className="tl-label faint">{meta.label}</div>
              <div className="tl-track">
                {weeks.map((w) => (
                  <span key={w} className="tl-week">
                    {fmt(w)}
                  </span>
                ))}
              </div>
            </div>
            {rows.map((r) => {
              const b = bar(dayOf(r[start.name]), dayOf(r[end.name]), from, days);
              const pct = progress ? Math.max(0, Math.min(100, Number(r[progress.name] ?? 0))) : null;
              const label = `${recordTitle(meta, r)}: ${dayOf(r[start.name]) ?? "?"} – ${dayOf(r[end.name]) ?? "?"}${pct != null ? `, ${pct}% complete` : ""}`;
              return (
                <div key={String(r.id)} className="tl-row">
                  <Link className="tl-label cell-title" to={`/e/${meta.name}/${r.id}`} title={recordTitle(meta, r)}>
                    {recordTitle(meta, r)}
                  </Link>
                  <div className="tl-track">
                    {todayAt && <span className="tl-today" style={{ left: `${todayAt.left + todayAt.width / 2}%` }} aria-hidden="true" />}
                    {b && (
                      <Link
                        to={`/e/${meta.name}/${r.id}`}
                        className="tl-bar"
                        data-tone={status ? statusTone(r.status) : "blue"}
                        data-before={b.before}
                        data-after={b.after}
                        style={{ left: `${b.left}%`, width: `${b.width}%` }}
                        title={label}
                        aria-label={label}
                        tabIndex={-1}
                      >
                        {pct != null && <span className="tl-fill" style={{ width: `${pct}%` }} />}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <Truncated n={rows.length} />
    </div>
  );
}

const fmt = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

export const VIEW_LABELS = { list: "List", board: "Board", calendar: "Calendar", timeline: "Timeline" } as const;
