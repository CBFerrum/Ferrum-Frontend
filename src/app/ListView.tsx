// Generic list: columns from `list.columns` (else `in_list` fields), filters from `in_filter`
// fields, free-text search, sortable headers, cursor/offset pagination, CSV export.

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, docPath, download, errorMessage } from "../lib/api";
import { joinRange, readFilters, serializeFilters, splitRange, writeFilters } from "../lib/filters";
import { humanize, NUMERIC_TYPES } from "../lib/format";
import {
  can,
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
import { CellValue, LinkInput } from "./widgets";

const PAGE = 50;
const SYSTEM_TYPES: Record<string, Field["type"]> = { created_at: "datetime", updated_at: "datetime", docstatus: "int", version: "int" };

export function ListView() {
  const { entity = "" } = useParams();
  const meta = useEntityMeta(entity);
  if (meta.error) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  if (!meta.data) return <PageLoading />;
  return <ListInner key={entity} meta={meta.data} />;
}

interface Column {
  name: string;
  label: string;
  field: Pick<Field, "name" | "type"> & Partial<Field>;
  sortable: boolean;
}

function listColumns(meta: EntityMeta): Column[] {
  const byName = new Map(meta.fields.map((f) => [f.name, f]));
  const readable = (n: string) => {
    const f = byName.get(n);
    return f ? f.can_read === true && !f.hidden && f.type !== "table" : n in SYSTEM_FIELD_LABELS;
  };
  const names = meta.list.columns.length
    ? [...meta.list.columns]
    : [...(meta.numbering ? ["number"] : []), ...meta.fields.filter((f) => f.in_list).map((f) => f.name)];
  // Tenant custom fields marked "in list" appear even when the package defines explicit columns.
  for (const f of meta.fields) if (f.name.startsWith("x_") && f.in_list && !names.includes(f.name)) names.push(f.name);
  let cols = names.filter(readable);
  if (!cols.length) cols = [meta.title_field && readable(meta.title_field) ? meta.title_field : "id"];
  if (meta.workflow && !cols.includes("workflow_state")) cols.push("workflow_state");
  if (meta.submittable && !cols.includes("status") && !cols.includes("docstatus")) cols.push("docstatus");
  return cols.map((n) => {
    const f = byName.get(n);
    return {
      name: n,
      label: f?.label ?? SYSTEM_FIELD_LABELS[n] ?? humanize(n),
      field: f ?? { name: n, type: SYSTEM_TYPES[n] ?? "data" },
      sortable: f ? f.storage === "column" : n !== "id",
    };
  });
}

function ListInner({ meta }: { meta: EntityMeta }) {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const me = useMe().data;
  const precisionOf = useCurrencyPrecision();
  const E = meta.name;
  const columns = useMemo(() => listColumns(meta), [meta]);
  const filterFields = useMemo(() => meta.fields.filter((f) => f.in_filter && f.can_read === true && !f.hidden && f.type !== "table"), [meta]);
  const fstate = readFilters(sp);
  const filters = serializeFilters(filterFields, fstate);
  const q = sp.get("q") ?? "";
  const sort = sp.get("sort") ?? meta.list.sort ?? "created_at desc";
  const [sortField, sortDir = "asc"] = sort.split(/\s+/);

  const fields = useMemo(() => {
    const known = new Set([...meta.fields.filter((f) => f.type !== "table").map((f) => f.name), ...Object.keys(SYSTEM_FIELD_LABELS)]);
    const want = new Set(["id", "docstatus", ...columns.map((c) => c.name), sortField]);
    if (meta.title_field) want.add(meta.title_field);
    for (const c of columns) if (c.field.type === "currency" && c.field.currency && !c.field.currency.includes(".")) want.add(c.field.currency);
    return [...want].filter((n) => known.has(n)).join(",");
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
  });

  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = list.data?.pages[0]?.total;
  const filtered = !!q || Object.keys(fstate).length > 0;
  const canCreate = can(meta.permissions, "create") && meta.kind !== "ledger";

  const setFilter = (name: string, value: string) => update((p) => writeFilters(p, { ...readFilters(p), [name]: value }));
  const clearFilters = () => {
    setSearch("");
    update((p) => {
      const next = writeFilters(p, {});
      next.delete("q");
      return next;
    });
  };
  const toggleSort = (name: string) =>
    update((p) => {
      p.set("sort", `${name} ${sortField === name && sortDir === "asc" ? "desc" : "asc"}`);
    });

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

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{meta.label_plural}</h1>
          <p className="page-sub" aria-live="polite">
            {list.isLoading ? "Loading…" : total != null ? `${total.toLocaleString()} ${total === 1 ? "record" : "records"}${filtered ? " match" : ""}` : `${rows.length} shown`}
          </p>
        </div>
        <div className="page-actions">
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
              onChange={(e) => setSearch(e.target.value)}
            />
          </FieldWrap>
          {filterFields.map((f) => (
            <FilterControl key={f.name} field={f} value={fstate[f.name] ?? ""} onChange={(v) => setFilter(f.name, v)} />
          ))}
          {filtered && (
            <Button variant="ghost" icon="x" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>

        {list.error ? (
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
            <table className="table">
              <caption className="sr-only">{meta.label_plural}</caption>
              <thead>
                <tr>
                  {columns.map((c) => {
                    const active = sortField === c.name;
                    return (
                      <th
                        key={c.name}
                        scope="col"
                        className={NUMERIC_TYPES.has(c.field.type) ? "num" : undefined}
                        aria-sort={active ? (sortDir === "desc" ? "descending" : "ascending") : undefined}
                      >
                        {c.sortable ? (
                          <button type="button" className="sort-btn" onClick={() => toggleSort(c.name)}>
                            {c.label}
                            {active && <Icon name={sortDir === "desc" ? "down" : "up"} size={12} />}
                          </button>
                        ) : (
                          c.label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {list.isLoading
                  ? Array.from({ length: 6 }, (_, i) => (
                      <tr key={i}>
                        {columns.map((c) => (
                          <td key={c.name}>
                            <div className="skeleton" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((r) => (
                      <tr
                        key={String(r.id)}
                        className="row-link"
                        onClick={(e) => {
                          if (!(e.target as HTMLElement).closest("a,button")) navigate(`/e/${E}/${r.id}`);
                        }}
                      >
                        {columns.map((c, i) => {
                          const precision =
                            c.field.type === "currency" && c.field.currency && !c.field.currency.includes(".") ? precisionOf(r[c.field.currency]) : undefined;
                          const cell = <CellValue field={c.field} value={r[c.name]} title={r._titles?.[c.name]} currencyPrecision={precision} />;
                          return (
                            <td key={c.name} className={NUMERIC_TYPES.has(c.field.type) && c.name !== "docstatus" ? "num" : undefined}>
                              {i === 0 ? (
                                <Link className="cell-title" to={`/e/${E}/${r.id}`}>
                                  {r[c.name] === null || r[c.name] === undefined || r[c.name] === "" ? recordTitle(meta, r) : cell}
                                </Link>
                              ) : (
                                cell
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage && (
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
