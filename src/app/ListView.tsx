// Generic list: columns from `list.columns` (else `in_list` fields) or the user's own choice (order,
// widths; list/ColumnChooser), filters from `in_filter` fields, free-text search, sortable headers,
// cursor/offset pagination, CSV export, saved views (list/SavedViews), row selection with bulk
// actions (list/BulkBar) — and the same records as a board, calendar or timeline when the entity has
// fields for one (`?view=`). Settings are the user's preference `list:<Entity>` (lib/prefs).

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Link, NavigationType, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router";
import { api, docPath, download, errorMessage } from "../lib/api";
import { joinRange, readFilters, serializeFilters, splitRange, writeFilters } from "../lib/filters";
import { NUMERIC_TYPES } from "../lib/format";
import { useLiveEntity } from "../lib/live";
import { usePref, type Pref } from "../lib/prefs";
import { viewOptions, type ViewKind } from "../lib/views";
import {
  can,
  fieldLabel,
  recordTitle,
  SYSTEM_FIELD_LABELS,
  useCurrencyPrecision,
  useEntityMeta,
  useMe,
  type EntityMeta,
  type Field,
  type ListResponse,
} from "../lib/meta";
import { Button, EmptyState, ErrorState, Field as FieldWrap, Icon, PageLoading, toast, useDebounced } from "../ui/kit";
import { pageState, togglePage, toggleRow } from "./list/bulk";
import { BulkBar, SelectBox } from "./list/BulkBar";
import { ColumnChooser, ColumnResizer } from "./list/ColumnChooser";
import { SavedViews } from "./list/SavedViews";
import {
  applyView,
  columnChoices,
  layoutOf,
  listScope,
  newViewId,
  queryOf,
  readPrefs,
  resolveColumns,
  sameQuery,
  validSort,
  VIEW_PARAM,
  withLayout,
  withoutView,
  withWidth,
  type ListPrefs,
  type SavedView,
} from "./list/settings";
import { BoardView, CalendarView, TimelineView, VIEW_LABELS } from "./Views";
import { CellValue, LinkInput } from "./widgets";

const PAGE = 50;
const noop = () => {};
const NO_PREFS: Record<string, unknown> = {};
const NONE: ReadonlySet<string> = new Set();

// Phones show rows as cards (records.css): no checkbox column (each card has its own) and no widths.
const PHONE = "(max-width: 720px)";
const onPhoneChange = (cb: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const usePhone = () =>
  useSyncExternalStore(
    onPhoneChange,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );

export function ListView() {
  const { entity = "" } = useParams();
  const meta = useEntityMeta(entity);
  if (meta.error) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  if (!meta.data) return <PageLoading />;
  return <ListWithPrefs key={entity} meta={meta.data} />;
}

/** The user's settings for this list (columns, sort, views) load first, so it opens with them. */
function ListWithPrefs({ meta }: { meta: EntityMeta }) {
  const pref = usePref(listScope(meta.name), NO_PREFS);
  return pref.ready ? <ListInner meta={meta} pref={pref} /> : <PageLoading />;
}

function ListInner({ meta, pref }: { meta: EntityMeta; pref: Pref<Record<string, unknown>> }) {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const navType = useNavigationType();
  const me = useMe().data;
  const precisionOf = useCurrencyPrecision();
  const phone = usePhone();
  const E = meta.name;

  // ── settings and saved views ──
  const prefs = useMemo(() => readPrefs(pref.value), [pref.value]);
  // Keys this version does not know (written by a newer one) are kept.
  const save = (fn: (p: ListPrefs) => ListPrefs) => pref.set((raw) => ({ ...raw, ...fn(readPrefs(raw)) }));
  const active = prefs.views[sp.get(VIEW_PARAM) ?? ""] ?? null;
  const viewId = active?.id ?? null;
  const layout = layoutOf(prefs, viewId);
  const choices = useMemo(() => columnChoices(meta), [meta]);
  const columns = useMemo(() => resolveColumns(meta, layout.columns), [meta, layout.columns]);
  const query = queryOf(sp);
  const modified = !!active && !sameQuery(query, active.query);
  const defaultView = prefs.default_view ? prefs.views[prefs.default_view] : undefined;
  // Opening the list (a link, the address bar, back or forward) without filters: the default view.
  const openDefault = !!defaultView && navType !== NavigationType.Replace && !Object.keys(query).length && !sp.has(VIEW_PARAM);
  const staleView = sp.has(VIEW_PARAM) && !active; // deleted, maybe on another device
  useEffect(() => {
    if (openDefault) setSp((p) => applyView(p, defaultView!), { replace: true });
    else if (staleView)
      setSp(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete(VIEW_PARAM);
          return next;
        },
        { replace: true },
      );
  }, [openDefault, staleView]); // react to the conditions only
  useEffect(() => {
    if (pref.error) toast(`Your list settings could not be saved: ${errorMessage(pref.error)}`, "error");
  }, [pref.error]);

  const filterFields = useMemo(() => meta.fields.filter((f) => f.in_filter && f.can_read === true && !f.hidden && f.type !== "table"), [meta]);
  const fstate = readFilters(sp);
  const filters = serializeFilters(filterFields, fstate);
  const q = sp.get("q") ?? "";
  // A view keeps its sort in its query; the standard view uses the user's last choice.
  const sort = sp.get("sort") ?? (active ? undefined : validSort(meta, prefs.sort)) ?? meta.list.sort ?? "created_at desc";
  const [sortField, sortDir = "asc"] = sort.split(/\s+/);

  // Changes by anyone show up here: the shell refreshes this entity's lists on each event.
  useLiveEntity(E, noop);
  const opts = useMemo(() => viewOptions(meta.fields), [meta]);
  const by = sp.get("by") ?? "";
  const boardField = opts.board.find((f) => f.name === by) ?? opts.board[0];
  const calendarField = opts.calendar.find((f) => f.name === by) ?? opts.calendar.find((f) => f.in_list) ?? opts.calendar[0];
  const span = opts.timeline.find(([s, e]) => `${s.name}..${e.name}` === by) ?? opts.timeline[0];
  const wanted = sp.get("view");
  const view: ViewKind =
    wanted === "board" && boardField ? "board" : wanted === "calendar" && calendarField ? "calendar" : wanted === "timeline" && span ? "timeline" : "list";
  const views: ViewKind[] = ["list", ...(opts.board.length ? ["board" as const] : []), ...(opts.calendar.length ? ["calendar" as const] : []), ...(opts.timeline.length ? ["timeline" as const] : [])];

  const fields = useMemo(() => {
    const known = new Set([...meta.fields.filter((f) => f.type !== "table").map((f) => f.name), ...Object.keys(SYSTEM_FIELD_LABELS)]);
    const want = new Set(["id", "docstatus", ...columns.map((c) => c.name), sortField]);
    if (meta.title_field) want.add(meta.title_field);
    for (const c of columns) if (c.field.type === "currency" && c.field.currency && !c.field.currency.includes(".")) want.add(c.field.currency);
    // Sorted: reordering columns needs no new request.
    return [...want].filter((n) => known.has(n)).sort().join(",");
  }, [meta, columns, sortField]);

  const update = (fn: (p: URLSearchParams) => URLSearchParams | void) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        return fn(next) ?? next;
      },
      { replace: true },
    );

  const [search, setSearch] = useState(q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debounced = useDebounced(search, 300);
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    if (debounced.trim() === q) return;
    update((p) => {
      if (debounced.trim()) p.set("q", debounced.trim());
      else p.delete("q");
    });
  }, [debounced]); // react to the debounced value only

  const list = useInfiniteQuery({
    enabled: view === "list" && !openDefault,
    queryKey: ["list", E, { q, sort, filters, fields }],
    initialPageParam: { offset: 0 } as { offset: number; cursor?: string },
    queryFn: ({ pageParam, signal }) =>
      api.get<ListResponse>(
        docPath(E),
        {
          fields,
          sort,
          limit: PAGE,
          search: q || undefined,
          filters,
          titles: true,
          count: pageParam.offset === 0 ? true : undefined,
          cursor: pageParam.cursor,
          offset: pageParam.cursor ? undefined : pageParam.offset || undefined,
        },
        signal,
      ),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      if (last.next_cursor) return { offset: loaded, cursor: last.next_cursor };
      const total = pages[0]?.total;
      if (last.rows.length < PAGE || (total != null && loaded >= total)) return undefined;
      return { offset: loaded };
    },
    // Showing or hiding a column asks for other fields: the rows stay meanwhile.
    placeholderData: (prev, prevQuery) => {
      const k = prevQuery?.queryKey[2] as { q?: string; sort?: string; filters?: string } | undefined;
      return k && k.q === q && k.sort === sort && k.filters === filters ? prev : undefined;
    },
  });

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.rows) ?? [], [list.data]);
  const ids = useMemo(() => rows.map((r) => String(r.id)), [rows]);
  const total = list.data?.pages[0]?.total;
  const filtered = !!q || Object.keys(fstate).length > 0;
  const canCreate = can(meta.permissions, "create") && meta.kind !== "ledger";
  const sortable = columns.filter((c) => c.sortable);

  // ── selection: cleared whenever the list shows other records, so nothing unseen is acted on ──
  const selKey = `${view}|${q}|${filters ?? ""}`;
  const [sel, setSel] = useState({ key: selKey, ids: NONE });
  const selected = sel.key === selKey ? sel.ids : NONE;
  const setSelected = (next: ReadonlySet<string>) => setSel({ key: selKey, ids: next });
  const anchor = useRef<string | null>(null); // the row clicked last, where a shift-click range starts
  const toggle = (id: string, range: boolean) => {
    setSelected(toggleRow(selected, ids, id, anchor.current, range));
    anchor.current = id;
  };
  const page = pageState(selected, ids);

  // ── column widths: `--cw-<column>` on the table; a header drag moves it directly, then saves ──
  const table = useRef<HTMLTableElement>(null);
  const [drag, setDrag] = useState<{ name: string; width: number } | null>(null);
  const widths: Record<string, number> = phone ? {} : { ...layout.widths, ...(drag && { [drag.name]: drag.width }) };
  const widthVars = Object.fromEntries(Object.entries(widths).map(([n, w]) => [`--cw-${n}`, `${w}px`])) as CSSProperties;
  const sized = (n: string): CSSProperties | undefined => (n in widths ? { width: `var(--cw-${n})` } : undefined);

  const setColumns = (names: string[]) => save((p) => withLayout(p, viewId, { columns: names }));
  const setWidth = (name: string, width: number | undefined) => {
    setDrag(null);
    save((p) => withLayout(p, viewId, { widths: withWidth(layoutOf(p, viewId).widths, name, width) }));
  };
  const resetLayout = () => save((p) => withLayout(p, viewId, { columns: undefined, widths: undefined }));

  const setFilter = (name: string, value: string) => update((p) => writeFilters(p, { ...readFilters(p), [name]: value }));
  const clearFilters = () => {
    setSearch("");
    update((p) => {
      const next = writeFilters(p, {});
      next.delete("q");
      return next;
    });
  };
  const setSort = (value: string) => {
    update((p) => void p.set("sort", value));
    if (!active) save((p) => ({ ...p, sort: value }));
  };
  const toggleSort = (name: string) => setSort(`${name} ${sortField === name && sortDir === "asc" ? "desc" : "asc"}`);

  // ── saved views ──
  const showView = (v: SavedView | null) => setSp((p) => applyView(p, v), { replace: true });
  const viewQuery = () => ({ ...query, sort });
  const createView = (name: string, makeDefault: boolean) => {
    const v: SavedView = { id: newViewId(), name, query: viewQuery(), columns: layout.columns, widths: layout.widths };
    save((p) => ({ ...p, views: { ...p.views, [v.id]: v }, default_view: makeDefault ? v.id : p.default_view }));
    showView(v);
    toast(`View “${name}” saved`);
  };
  const saveView = () => {
    if (!active) return;
    const v = { ...active, query: viewQuery() };
    save((p) => (p.views[v.id] ? { ...p, views: { ...p.views, [v.id]: { ...p.views[v.id], query: v.query } } } : p));
    showView(v);
    toast(`View “${v.name}” saved`);
  };
  const renameView = (id: string, name: string) => save((p) => (p.views[id] ? { ...p, views: { ...p.views, [id]: { ...p.views[id], name } } } : p));
  const deleteView = (id: string) => {
    save((p) => withoutView(p, id));
    if (viewId === id) showView(null);
  };
  const setDefault = (id: string | null) => save((p) => ({ ...p, default_view: id ?? undefined }));

  // "New" from a filtered list starts with the filtered link/select values.
  const newHref = useMemo(() => {
    const pre = new URLSearchParams();
    for (const f of filterFields) if ((f.type === "link" || f.type === "select") && fstate[f.name] && f.can_write) pre.set(f.name, fstate[f.name]);
    const s = pre.toString();
    return `/e/${E}/new${s ? `?${s}` : ""}`;
  }, [E, filterFields, fstate]);

  const exportCsv = async () => {
    try {
      await download(docPath(E, "_export"), `${E}.csv`, { filters, search: q || undefined });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  if (openDefault) return <PageLoading />; // the default view's address is on its way

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{meta.label_plural}</h1>
          <p className="page-sub" aria-live="polite">
            {view === "board"
              ? `Board by ${boardField!.label.toLowerCase()}`
              : view === "calendar"
                ? `Calendar by ${calendarField!.label.toLowerCase()}`
                : view === "timeline"
                  ? `Timeline from ${span![0].label.toLowerCase()} to ${span![1].label.toLowerCase()}`
                  : list.isLoading
                    ? "Loading…"
                    : total != null
                      ? `${total.toLocaleString()} ${total === 1 ? "record" : "records"}${filtered ? " match" : ""}`
                      : `${rows.length} shown`}
          </p>
        </div>
        <div className="page-actions list-actions">
          {views.length > 1 && (
            <div className="segmented" role="group" aria-label="View">
              {views.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  title={VIEW_LABELS[v]}
                  onClick={() =>
                    update((p) => {
                      p.delete("by");
                      if (v === "list") p.delete("view");
                      else p.set("view", v);
                    })
                  }
                >
                  <Icon name={v} />
                  <span className="seg-label">{VIEW_LABELS[v]}</span>
                </button>
              ))}
            </div>
          )}
          {me?.user.is_admin && (
            <Link className="btn btn-ghost btn-md" to={`/customize/${E}`}>
              <Icon name="edit" />
              Customize
            </Link>
          )}
          {can(meta.permissions, "export") && (
            <Button icon="download" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          )}
          {canCreate && (
            <Link className="btn btn-primary btn-md" to={newHref}>
              <Icon name="plus" />
              New {meta.label}
            </Link>
          )}
        </div>
      </div>

      <div className="card">
        <div className="toolbar" role="search" aria-label={`Filter ${meta.label_plural}`}>
          <FieldWrap label="Search" htmlFor="list-search" className="field-wide">
            <input
              id="list-search"
              className="input"
              type="search"
              placeholder={`Search ${meta.label_plural.toLowerCase()}…`}
              value={search}
              autoComplete="off"
              onChange={(e) => setSearch(e.target.value)}
            />
          </FieldWrap>
          {(filterFields.length > 0 || view !== "list") && (
            // Phones show the search box and fold the other filters behind this button.
            <Button className="filters-toggle" icon="settings" aria-expanded={filtersOpen} aria-controls="list-filters" onClick={() => setFiltersOpen((o) => !o)}>
              Filters{Object.keys(fstate).length ? ` (${Object.keys(fstate).length})` : ""}
            </Button>
          )}
          {/* Phones: this replaces the column headers' sort buttons, which the card layout hides. */}
          {view === "list" && sortable.length > 0 && (
            <FieldWrap label="Sort" htmlFor="list-sort" className="list-sort">
              <select id="list-sort" className="select" value={`${sortField} ${sortDir}`} onChange={(e) => setSort(e.target.value)}>
                {!sortable.some((c) => c.name === sortField) && (
                  <option value={`${sortField} ${sortDir}`}>
                    {fieldLabel(meta, sortField)} {sortDir === "desc" ? "↓" : "↑"}
                  </option>
                )}
                {sortable.flatMap((c) => [
                  <option key={`${c.name} asc`} value={`${c.name} asc`}>
                    {c.label} ↑
                  </option>,
                  <option key={`${c.name} desc`} value={`${c.name} desc`}>
                    {c.label} ↓
                  </option>,
                ])}
              </select>
            </FieldWrap>
          )}
          <div id="list-filters" className="toolbar-more" data-open={filtersOpen}>
            {filterFields.map((f) => (
              <FilterControl key={f.name} field={f} value={fstate[f.name] ?? ""} onChange={(v) => setFilter(f.name, v)} />
            ))}
            {view !== "list" && (
              <ViewFieldPicker
                view={view}
                opts={opts}
                value={view === "board" ? boardField!.name : view === "calendar" ? calendarField!.name : `${span![0].name}..${span![1].name}`}
                onChange={(v) => update((p) => void p.set("by", v))}
              />
            )}
          </div>
          {filtered && (
            <Button variant="ghost" icon="x" onClick={clearFilters}>
              Clear
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <SavedViews
              views={prefs.views}
              active={active}
              modified={modified}
              defaultId={prefs.default_view}
              onApply={showView}
              onCreate={createView}
              onSave={saveView}
              onRename={renameView}
              onDelete={deleteView}
              onDefault={setDefault}
            />
            {view === "list" && (
              <ColumnChooser
                choices={choices}
                shown={columns.map((c) => c.name)}
                widths={layout.widths ?? {}}
                viewName={active?.name}
                customized={!!(layout.columns || layout.widths)}
                onColumns={setColumns}
                onWidth={setWidth}
                onReset={resetLayout}
              />
            )}
          </div>
        </div>

        {view === "list" && selected.size > 0 && (
          <BulkBar meta={meta} me={me} selected={selected} rows={rows} total={total} hasMore={!!list.hasNextPage} filters={filters} q={q} sort={sort} onSelect={setSelected} />
        )}

        {view === "board" ? (
          <BoardView meta={meta} field={boardField!} filters={filters} q={q} />
        ) : view === "calendar" ? (
          <CalendarView meta={meta} field={calendarField!} filters={filters} q={q} />
        ) : view === "timeline" ? (
          <TimelineView meta={meta} start={span![0]} end={span![1]} filters={filters} q={q} />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.isLoading && !rows.length ? (
          <EmptyState title={filtered ? "No matching records" : `No ${meta.label_plural.toLowerCase()} yet`}>
            {filtered ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : (
              canCreate && (
                <Link className="btn btn-primary btn-md" to={newHref}>
                  <Icon name="plus" />
                  New {meta.label}
                </Link>
              )
            )}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            {/* Explicit roles: the phone card layout changes `display`, which drops native table semantics. */}
            {/* The row shows what a card would (data-ferrum-nocard: the shell draws none here). */}
            <table ref={table} className="table list-table" role="table" style={widthVars} data-ferrum-nocard="">
              <caption className="sr-only" role="caption">
                {meta.label_plural}
              </caption>
              <thead role="rowgroup">
                <tr role="row">
                  {!phone && (
                    <th role="columnheader" scope="col" className="w-px">
                      <SelectBox
                        id="list-select-all"
                        label={`Select all ${ids.length} shown`}
                        checked={page === "all"}
                        indeterminate={page === "some"}
                        disabled={!ids.length}
                        onToggle={() => setSelected(togglePage(selected, ids))}
                      />
                    </th>
                  )}
                  {columns.map((c) => {
                    const sorted = sortField === c.name;
                    return (
                      <th
                        key={c.name}
                        role="columnheader"
                        scope="col"
                        className={NUMERIC_TYPES.has(c.field.type) ? "num" : undefined}
                        aria-sort={sorted ? (sortDir === "desc" ? "descending" : "ascending") : undefined}
                      >
                        <div data-col className={c.name in widths ? "truncate" : undefined} style={sized(c.name)}>
                          {c.sortable ? (
                            <button type="button" className="sort-btn" onClick={() => toggleSort(c.name)}>
                              {c.label}
                              {sorted && <Icon name={sortDir === "desc" ? "down" : "up"} size={12} />}
                            </button>
                          ) : (
                            c.label
                          )}
                        </div>
                        {!phone && <ColumnResizer name={c.name} table={table} onStart={(name, width) => setDrag({ name, width })} onCommit={setWidth} />}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {list.isLoading
                  ? Array.from({ length: 6 }, (_, i) => (
                      <tr key={i} role="row">
                        {!phone && <td role="cell" />}
                        {columns.map((c) => (
                          <td key={c.name} role="cell" data-label={c.label}>
                            <div className="skeleton" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((r) => {
                      const id = String(r.id);
                      const on = selected.has(id);
                      const box = <SelectBox label={`Select ${recordTitle(meta, r)}`} checked={on} onToggle={(range) => toggle(id, range)} />;
                      return (
                        <tr
                          key={id}
                          role="row"
                          className="row-link [&[data-selected]>td]:bg-primary-soft"
                          data-selected={on || undefined}
                          onClick={(e) => {
                            if (!(e.target as HTMLElement).closest("a,button,input,label")) navigate(`/e/${E}/${r.id}`);
                          }}
                        >
                          {!phone && (
                            <td role="cell" className="w-px">
                              {box}
                            </td>
                          )}
                          {columns.map((c, i) => {
                            const precision =
                              c.field.type === "currency" && c.field.currency && !c.field.currency.includes(".") ? precisionOf(r[c.field.currency]) : undefined;
                            const cell = <CellValue field={c.field} value={r[c.name]} title={r._titles?.[c.name]} currencyPrecision={precision} />;
                            const title = i === 0 && (
                              <Link className="cell-title" to={`/e/${E}/${r.id}`}>
                                {r[c.name] === null || r[c.name] === undefined || r[c.name] === "" ? recordTitle(meta, r) : cell}
                              </Link>
                            );
                            const content = i !== 0 ? cell : phone ? <span className="flex items-center gap-1">{box}{title}</span> : title;
                            return (
                              <td key={c.name} role="cell" data-label={c.label} className={NUMERIC_TYPES.has(c.field.type) && c.name !== "docstatus" ? "num" : undefined}>
                                {c.name in widths ? (
                                  <div className="truncate" style={sized(c.name)}>
                                    {content}
                                  </div>
                                ) : (
                                  content
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        )}
        {view === "list" && list.hasNextPage && (
          <div className="load-more">
            <Button onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Which field drives the board, calendar or timeline, when there is a choice. */
function ViewFieldPicker({ view, opts, value, onChange }: { view: ViewKind; opts: ReturnType<typeof viewOptions>; value: string; onChange: (v: string) => void }) {
  const choices: [string, string][] =
    view === "board"
      ? opts.board.map((f) => [f.name, f.label])
      : view === "calendar"
        ? opts.calendar.map((f) => [f.name, f.label])
        : opts.timeline.map(([s, e]) => [`${s.name}..${e.name}`, `${s.label} – ${e.label}`]);
  if (choices.length < 2) return null;
  return (
    <FieldWrap label={view === "board" ? "Group by" : view === "calendar" ? "Date" : "Dates"} htmlFor="view-by">
      <select id="view-by" className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {choices.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

function FilterControl({ field: f, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const id = `flt-${f.name}`;
  switch (f.type) {
    case "select":
      return (
        <FieldWrap label={f.label} htmlFor={id}>
          <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">All</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </FieldWrap>
      );
    case "check":
      return (
        <FieldWrap label={f.label} htmlFor={id}>
          <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">All</option>
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </FieldWrap>
      );
    case "link":
      return (
        <FieldWrap label={f.label} htmlFor={id} className="field-wide">
          <LinkInput to={f.to ?? ""} id={id} value={value || null} linkFilters={f.link_filters} placeholder="Any" onChange={(v) => onChange(v ?? "")} />
        </FieldWrap>
      );
    case "date":
    case "datetime": {
      const [from, to] = splitRange(value);
      return (
        <FieldWrap label={f.label} htmlFor={id} className="field-wide">
          <div className="range">
            <input id={id} className="input" type="date" aria-label={`${f.label} from`} value={from} onChange={(e) => onChange(joinRange(e.target.value, to))} />
            <input className="input" type="date" aria-label={`${f.label} to`} value={to} onChange={(e) => onChange(joinRange(from, e.target.value))} />
          </div>
        </FieldWrap>
      );
    }
    default:
      return <TextFilter id={id} label={f.label} value={value} onChange={onChange} />;
  }
}

function TextFilter({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const debounced = useDebounced(draft, 300);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
  }, [debounced]); // react to the debounced value only
  return (
    <FieldWrap label={label} htmlFor={id}>
      <input id={id} className="input" value={draft} onChange={(e) => setDraft(e.target.value)} />
    </FieldWrap>
  );
}
