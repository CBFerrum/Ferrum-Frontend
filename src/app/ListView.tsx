// Generic list: columns from `list.columns` (else `in_list` fields) or the user's own choice (order,
// widths; list/ColumnChooser), filters on any field the viewer can read as chips (list/FilterBar), free-text search, sortable headers,
// cursor/offset pagination, CSV export, saved views (list/SavedViews), row selection with bulk
// actions (list/BulkBar) — and the same records as a board, calendar or timeline when the entity has
// fields for one (`?view=`). Settings are the user's preference `list:<Entity>` (lib/prefs).

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Link, NavigationType, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router";
import { api, docPath, download, errorMessage } from "../lib/api";
import { filterable, isWord, readFilters, serializeFilters, writeFilters } from "../lib/filters";
import { NUMERIC_TYPES } from "../lib/format";
import { useLiveEntity } from "../lib/live";
import { usePref, type Pref } from "../lib/prefs";
import { viewOptions, type ViewKind } from "../lib/views";
import {
  can,
  fieldLabel,
  recordTitle,
  singleRecord,
  SYSTEM_FIELD_LABELS,
  useCurrencyPrecision,
  useEntityMeta,
  useMe,
  type EntityMeta,
  type ListResponse,
} from "../lib/meta";
import { Button, EmptyState, ErrorState, Field as FieldWrap, Icon, PageLoading, toast, useDebounced } from "../ui/kit";
import { pageState, togglePage, toggleRow } from "./list/bulk";
import { BulkBar, SelectBox } from "./list/BulkBar";
import { ColumnChooser, ColumnResizer } from "./list/ColumnChooser";
import { FilterChips } from "./list/FilterBar";
import { ImportDialog } from "./list/ImportDialog";
import { RecordPeek } from "./list/RecordPeek";
import { SavedViews } from "./list/SavedViews";
import {
  applyView,
  columnChoices,
  layoutOf,
  listScope,
  newViewId,
  queryOf,
  readPrefs,
  readSharedView,
  resolveColumns,
  sameQuery,
  validSort,
  VIEW_PARAM,
  withLayout,
  withoutView,
  withWidth,
  type Layout,
  type ListPrefs,
  type SavedView,
} from "./list/settings";
import { t } from "../lib/i18n";
import { BoardView, CalendarView, TimelineView, VIEW_LABELS } from "./Views";
import { CellValue, NotInstalled, notInstalled } from "./widgets";
import { HelpLink } from "./HelpLink";
import { t as tr, isolate } from "@ferrum/client";

const PAGE = 50;
const noop = () => {};
const NO_PREFS: Record<string, unknown> = {};
const NO_VIEWS: Record<string, SavedView> = {};
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
  if (notInstalled(meta.error)) return <NotInstalled entity={entity} />;
  if (meta.error) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  if (!meta.data) return <PageLoading />;
  if (singleRecord(meta.data)) return <OneRecord key={entity} entity={meta.data.name} />;
  return <ListWithPrefs key={entity} meta={meta.data} />;
}

/** Settings open as their one record, or as a new one until it exists: not as a list of one. */
function OneRecord({ entity }: { entity: string }) {
  const navigate = useNavigate();
  const one = useQuery({
    queryKey: ["list", entity, "one"],
    queryFn: ({ signal }) => api.get<ListResponse>(docPath(entity), { fields: "id", limit: 1 }, signal),
  });
  const id = one.data?.rows[0]?.id;
  useEffect(() => {
    if (one.data) navigate(id ? encodeURIComponent(String(id)) : "new", { replace: true, relative: "path" });
  }, [one.data]); // react to the answer only
  return one.error ? <ErrorState error={one.error} onRetry={() => one.refetch()} /> : <PageLoading />;
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
  const qc = useQueryClient();
  const E = meta.name;

  // ── settings and saved views ──
  const prefs = useMemo(() => readPrefs(pref.value), [pref.value]);
  // Keys this version does not know (written by a newer one) are kept.
  const save = (fn: (p: ListPrefs) => ListPrefs) => pref.set((raw) => ({ ...raw, ...fn(readPrefs(raw)) }));
  const shared = useQuery({
    queryKey: ["views", E],
    queryFn: ({ signal }) => api.get<{ views: Parameters<typeof readSharedView>[0][] }>(`/api/views/${encodeURIComponent(E)}`, undefined, signal),
    select: (r) => Object.fromEntries(r.views.map((v) => [v.id, readSharedView(v)])) as Record<string, SavedView>,
  });
  const team = shared.data ?? NO_VIEWS;
  const active = prefs.views[sp.get(VIEW_PARAM) ?? ""] ?? team[sp.get(VIEW_PARAM) ?? ""] ?? null;
  const viewId = active?.id ?? null;
  // A shared view brings its own layout; changing columns on one is for whoever looks after it.
  const layout = active?.shared ? active : layoutOf(prefs, viewId);
  const choices = useMemo(() => columnChoices(meta), [meta]);
  const columns = useMemo(() => resolveColumns(meta, layout.columns), [meta, layout.columns]);
  const query = queryOf(sp);
  const modified = !!active && !sameQuery(query, active.query);
  const defaultView = prefs.default_view ? prefs.views[prefs.default_view] : undefined;
  // Opening the list (a link, the address bar, back or forward) without filters: the default view.
  const openDefault = !!defaultView && navType !== NavigationType.Replace && !Object.keys(query).length && !sp.has(VIEW_PARAM);
  const moving = useRef<string | null>(null); // a view on its way to the team, which the address names for a moment longer
  const staleView = sp.has(VIEW_PARAM) && !active && !shared.isLoading && sp.get(VIEW_PARAM) !== moving.current; // deleted, maybe on another device
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
    if (pref.error) toast(tr("Your list settings could not be saved: {value}", { value: errorMessage(pref.error) }), "error");
  }, [pref.error]);

  const filterFields = useMemo(() => filterable(meta.fields, meta.children), [meta]);
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

  // ── the record open beside the list ──
  const peek = phone ? null : sp.get("peek");
  const setPeek = (id: string | null) =>
    update((p) => {
      if (id) p.set("peek", id);
      else p.delete("peek");
    });

  const [search, setSearch] = useState(q);
  const [importing, setImporting] = useState(false);
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

  // ↑ and ↓ walk the rows while one is open; Esc closes it.
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input,select,textarea,[contenteditable],[role=dialog],[role=menu]")) return;
      if (e.key === "Escape") setPeek(null);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const at = ids.indexOf(peek) + (e.key === "ArrowDown" ? 1 : -1);
        if (ids[at]) {
          e.preventDefault();
          setPeek(ids[at]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek, ids]); // setPeek only writes the URL

  // ── column widths: `--cw-<column>` on the table; a header drag moves it directly, then saves ──
  const table = useRef<HTMLTableElement>(null);
  const [drag, setDrag] = useState<{ name: string; width: number } | null>(null);
  const widths: Record<string, number> = phone ? {} : { ...layout.widths, ...(drag && { [drag.name]: drag.width }) };
  const widthVars = Object.fromEntries(Object.entries(widths).map(([n, w]) => [`--cw-${n}`, `${w}px`])) as CSSProperties;
  const sized = (n: string): CSSProperties | undefined => (n in widths ? { width: `var(--cw-${n})` } : undefined);

  const setLayout = (patch: (l: Layout) => Layout) => {
    if (!active?.shared) return save((p) => withLayout(p, viewId, patch(layoutOf(p, viewId))));
    if (active.shared.can_change) void changeShared({ ...active, ...patch(active) });
    else toast(tr("This view is shared. Save it as a new view to make these changes your own."), "error");
  };
  const setColumns = (names: string[]) => setLayout(() => ({ columns: names }));
  const setWidth = (name: string, width: number | undefined) => {
    setDrag(null);
    setLayout((l) => ({ widths: withWidth(l.widths, name, width) }));
  };
  const resetLayout = () => setLayout(() => ({ columns: undefined, widths: undefined }));

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
    toast(tr("View “{name}” saved", { name }));
  };
  const viewBody = (v: SavedView) => ({ query: v.query, columns: v.columns, widths: v.widths });
  const refreshTeam = () => qc.invalidateQueries({ queryKey: ["views", E] });
  const changeShared = async (v: SavedView) => {
    try {
      await api.put(`/api/views/${encodeURIComponent(E)}/${v.id}`, { name: v.name, value: viewBody(v), version: v.shared?.version ?? 0 });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
    await refreshTeam();
  };
  const saveView = () => {
    if (!active) return;
    const v = { ...active, query: viewQuery() };
    if (v.shared) void changeShared(v);
    else save((p) => (p.views[v.id] ? { ...p, views: { ...p.views, [v.id]: { ...p.views[v.id], query: v.query } } } : p));
    showView(v);
    toast(tr("View “{name}” saved", { name: v.name }));
  };
  const renameView = (id: string, name: string) => {
    if (team[id]) void changeShared({ ...team[id], name });
    else save((p) => (p.views[id] ? { ...p, views: { ...p.views, [id]: { ...p.views[id], name } } } : p));
  };
  const deleteView = (id: string) => {
    if (team[id]) {
      api
        .del(`/api/views/${encodeURIComponent(E)}/${id}`)
        .catch((e: unknown) => toast(errorMessage(e), "error"))
        .finally(() => void refreshTeam());
    } else save((p) => withoutView(p, id));
    if (viewId === id) showView(null);
  };
  // Sharing moves the view: one copy, which everyone (its owner too) sees change.
  const shareView = async (v: SavedView) => {
    try {
      const made = await api.post<{ id: string }>(`/api/views/${encodeURIComponent(E)}`, { name: v.name, value: viewBody(v) });
      await refreshTeam();
      moving.current = v.id;
      setSp((p) => applyView(p, { ...v, id: made.id }), { replace: true });
      save((p) => withoutView(p, v.id));
      toast(tr("“{name}” is shared with everyone who can see this list", { name: v.name }));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const setDefault = (id: string | null) => save((p) => ({ ...p, default_view: id ?? undefined }));

  // "New" from a filtered list starts with the filtered link/select values.
  const newHref = useMemo(() => {
    const pre = new URLSearchParams();
    for (const f of filterFields) if ((f.type === "link" || f.type === "select") && fstate[f.name] && !isWord(fstate[f.name]) && f.can_write) pre.set(f.name, fstate[f.name]);
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
    <div className="list-page" data-peek={!!peek || undefined}>
      <div className="list-main">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {isolate(meta.label_plural)}
            <HelpLink meta={meta} />
          </h1>
          <p className="page-sub" aria-live="polite">
            {view === "board"
              ? t("Board by {field}", { field: boardField!.label.toLowerCase() })
              : view === "calendar"
                ? t("Calendar by {field}", { field: calendarField!.label.toLowerCase() })
                : view === "timeline"
                  ? t("Timeline from {from} to {to}", { from: span![0].label.toLowerCase(), to: span![1].label.toLowerCase() })
                  : list.isLoading
                    ? t("Loading…")
                    : total != null
                      ? t(total === 1 ? (filtered ? "1 record matches" : "1 record") : filtered ? "{n} records match" : "{n} records", { n: total.toLocaleString() })
                      : t("{n} shown", { n: rows.length })}
          </p>
        </div>
        <div className="page-actions list-actions">
          {views.length > 1 && (
            <div className="segmented" role="group" aria-label={t("View")}>
              {views.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  title={t(VIEW_LABELS[v])}
                  onClick={() =>
                    update((p) => {
                      p.delete("by");
                      if (v === "list") p.delete("view");
                      else p.set("view", v);
                    })
                  }
                >
                  <Icon name={v} />
                  <span className="seg-label">{t(VIEW_LABELS[v])}</span>
                </button>
              ))}
            </div>
          )}
          {me?.user.is_admin && (
            <Link className="btn btn-ghost btn-md" to={`/customize/${E}`}>
              <Icon name="edit" />
              {t("Customize")}
            </Link>
          )}
          {can(meta.permissions, "export") && (
            <Button icon="download" onClick={() => void exportCsv()}>
              {t("Export CSV")}
            </Button>
          )}
          {can(meta.permissions, "import") && canCreate && (
            <Button icon="upload" onClick={() => setImporting(true)}>
              {t("Import")}
            </Button>
          )}
          {canCreate && (
            <Link className="btn btn-primary btn-md" to={newHref}>
              <Icon name="plus" />
              {t("New {label}", { label: meta.label })}
            </Link>
          )}
        </div>
      </div>

      <div className="card">
        <div className="list-bar" role="search" aria-label={t("Filter {labels}", { labels: meta.label_plural })}>
          <div className="list-search">
            <Icon name="search" size={14} />
            <input
              id="list-search"
              className="input"
              type="search"
              aria-label={t("Search {labels}", { labels: meta.label_plural.toLowerCase() })}
              placeholder={t("Search…")}
              value={search}
              autoComplete="off"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <FilterChips fields={filterFields} state={fstate} onChange={setFilter} />
          {view !== "list" && (
            <ViewFieldPicker
              view={view}
              opts={opts}
              value={view === "board" ? boardField!.name : view === "calendar" ? calendarField!.name : `${span![0].name}..${span![1].name}`}
              onChange={(v) => update((p) => void p.set("by", v))}
            />
          )}
          {filtered && (
            <button type="button" className="chip-clear" onClick={clearFilters}>
              {tr("Clear")}
            </button>
          )}
          <div className="list-bar-end">
            {/* Phones: this replaces the column headers' sort buttons, which the card layout hides. */}
            {view === "list" && sortable.length > 0 && (
              <select className="select list-sort" aria-label={tr("Sort by")} value={`${sortField} ${sortDir}`} onChange={(e) => setSort(e.target.value)}>
                {!sortable.some((c) => c.name === sortField) && (
                  <option value={`${sortField} ${sortDir}`}>
                    {isolate(fieldLabel(meta, sortField))} {sortDir === "desc" ? "↓" : "↑"}
                  </option>
                )}
                {sortable.flatMap((c) => [
                  <option key={`${c.name} asc`} value={`${c.name} asc`}>
                    {isolate(c.label)} ↑
                  </option>,
                  <option key={`${c.name} desc`} value={`${c.name} desc`}>
                    {isolate(c.label)} ↓
                  </option>,
                ])}
              </select>
            )}
            <SavedViews
              views={prefs.views}
              team={team}
              active={active}
              modified={modified}
              defaultId={prefs.default_view}
              onApply={showView}
              onCreate={createView}
              onSave={saveView}
              onRename={renameView}
              onDelete={deleteView}
              onDefault={setDefault}
              onShare={(v) => void shareView(v)}
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
          <BoardView meta={meta} field={boardField!} filters={filters} q={q} onOpen={phone ? undefined : setPeek} open={peek} />
        ) : view === "calendar" ? (
          <CalendarView meta={meta} field={calendarField!} filters={filters} q={q} onOpen={phone ? undefined : setPeek} open={peek} />
        ) : view === "timeline" ? (
          <TimelineView meta={meta} start={span![0]} end={span![1]} filters={filters} q={q} onOpen={phone ? undefined : setPeek} />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.isLoading && !rows.length ? (
          <EmptyState title={filtered ? tr("No matching records") : tr("No {value} yet", { value: meta.label_plural.toLowerCase() })}>
            {filtered ? (
              <Button onClick={clearFilters}>{tr("Clear filters")}</Button>
            ) : (
              canCreate && (
                <Link className="btn btn-primary btn-md" to={newHref}>
                  <Icon name="plus" />
                  {tr("New {label}", { label: meta.label })}
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
                {isolate(meta.label_plural)}
              </caption>
              <thead role="rowgroup">
                <tr role="row">
                  {!phone && (
                    <th role="columnheader" scope="col" className="w-px">
                      <SelectBox
                        id="list-select-all"
                        label={tr("Select all {length} shown", { length: ids.length })}
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
                              {isolate(c.label)}
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
                          <td key={c.name} role="cell" data-label={isolate(c.label)}>
                            <div className="skeleton" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((r) => {
                      const id = String(r.id);
                      const on = selected.has(id);
                      const box = <SelectBox label={tr("Select {meta}", { meta: recordTitle(meta, r) })} checked={on} onToggle={(range) => toggle(id, range)} />;
                      return (
                        <tr
                          key={id}
                          role="row"
                          className="row-link [&[data-selected]>td]:bg-primary-soft"
                          data-selected={on || undefined}
                          data-peeked={peek === id || undefined}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("a,button,input,label")) return;
                            if (phone) navigate(`/e/${E}/${r.id}`);
                            else setPeek(peek === id ? null : id);
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
                              <td key={c.name} role="cell" data-label={isolate(c.label)} className={NUMERIC_TYPES.has(c.field.type) && c.name !== "docstatus" ? "num" : undefined}>
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
              {tr("Load more")}
            </Button>
          </div>
        )}
      </div>
      </div>
      {peek && <RecordPeek key={peek} meta={meta} id={peek} onClose={() => setPeek(null)} />}
      {importing && <ImportDialog meta={meta} onClose={() => setImporting(false)} />}
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
    <FieldWrap label={view === "board" ? tr("Group by") : view === "calendar" ? tr("Date") : tr("Dates")} htmlFor="view-by">
      <select id="view-by" className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {choices.map(([v, l]) => (
          <option key={v} value={v}>
            {isolate(l)}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}
