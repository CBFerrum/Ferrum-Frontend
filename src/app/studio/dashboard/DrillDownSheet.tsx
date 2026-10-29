// The records behind a number or a chart point, in a side sheet: exactly the widget's filters
// (and the point's dimension values), through the list API with the viewer's permissions.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ExternalLink } from "lucide-react";
import { api, docPath } from "@/lib/api";
import { fieldLabel, recordTitle, SYSTEM_FIELD_LABELS, useEntityMeta, useMe, type EntityMeta, type Field, type ListResponse } from "@/lib/meta";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CellValue } from "../../widgets";
import { listParams, pointFilters, type DrillTarget } from "./drill";
import { ErrorBlock, LoadingBlock, plainLink } from "./ui";

const LIMIT = 50;
const SYSTEM_TYPES: Record<string, string> = { created_at: "datetime", updated_at: "datetime", docstatus: "int", version: "int" };

function columnsOf(meta: EntityMeta): (Pick<Field, "name" | "type"> & Partial<Field>)[] {
  const byName = new Map(meta.fields.map((f) => [f.name, f]));
  const readable = (n: string) => {
    const f = byName.get(n);
    return f ? f.can_read === true && !f.hidden && f.type !== "table" : n in SYSTEM_FIELD_LABELS;
  };
  const names = meta.list.columns.length ? meta.list.columns : [...(meta.numbering ? ["number"] : []), ...meta.fields.filter((f) => f.in_list).map((f) => f.name)];
  const cols = [...new Set([...(meta.title_field ? [meta.title_field] : []), ...names])].filter(readable).slice(0, 5);
  return (cols.length ? cols : ["id"]).map((n) => byName.get(n) ?? { name: n, type: (SYSTEM_TYPES[n] ?? "data") as Field["type"] });
}

export function DrillDownSheet({ target, onClose }: { target: DrillTarget | null; onClose: () => void }) {
  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl">{target && <DrillBody target={target} />}</SheetContent>
    </Sheet>
  );
}

function DrillBody({ target }: { target: DrillTarget }) {
  const meta = useEntityMeta(target.entity);
  const me = useMe().data;
  const m = meta.data;
  const typeOf = (path: string) => (path.includes(".") ? undefined : (m?.fields.find((f) => f.name === path)?.type ?? SYSTEM_TYPES[path]));
  const filters = m ? [...target.filters, ...pointFilters(target.points ?? [], typeOf, me?.timezone)] : null;
  const columns = m ? columnsOf(m) : [];
  const fields = m ? [...new Set(["id", ...(m.title_field ? [m.title_field] : []), "number", ...columns.map((c) => c.name)])].filter((n) => n === "id" || n in SYSTEM_FIELD_LABELS || m.fields.some((f) => f.name === n)) : [];
  const rows = useQuery({
    queryKey: ["list", target.entity, "drill", filters, fields],
    queryFn: ({ signal }) =>
      api.get<ListResponse>(docPath(target.entity), { filters: JSON.stringify(filters), fields: fields.join(","), limit: LIMIT, titles: true, count: true, sort: m?.list.sort ?? undefined }, signal),
    enabled: !!filters,
  });
  const params = m && filters ? listParams(filters, m.fields.filter((f) => f.can_read && !f.hidden)) : null;
  const total = rows.data?.total;
  const shown = rows.data?.rows.length ?? 0;
  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle>{target.title}</SheetTitle>
        <SheetDescription aria-live="polite">
          {m ? `${m.label_plural}` : "Records"}
          {rows.data ? ` · ${total ?? shown} record${(total ?? shown) === 1 ? "" : "s"}` : ""}
          {target.points?.length ? ` · ${target.points.length === 1 ? "this point" : "this point's values"} only` : ""}
        </SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {meta.error ? (
          <ErrorBlock error={meta.error} onRetry={() => meta.refetch()} title="Could not open these records" />
        ) : rows.error ? (
          <ErrorBlock error={rows.error} onRetry={() => rows.refetch()} title="Could not load the records" />
        ) : !rows.data || !m ? (
          <LoadingBlock rows={5} />
        ) : !shown ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No records match.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.name}>{fieldLabel(m, c.name)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data.rows.map((r) => (
                <TableRow key={String(r.id)}>
                  {columns.map((c, i) => (
                    <TableCell key={c.name} className="max-w-56 truncate">
                      {i === 0 ? (
                        <Link to={`/e/${target.entity}/${String(r.id)}`} className="font-medium">
                          {c.name === m.title_field || c.name === "id" ? recordTitle(m, r) : <CellValue field={c} value={r[c.name]} title={r._titles?.[c.name]} />}
                        </Link>
                      ) : (
                        <CellValue field={c} value={r[c.name]} title={r._titles?.[c.name]} />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rows.data && total != null && total > shown && <p className="pt-3 text-center text-xs text-muted-foreground">Showing the first {shown}.</p>}
      </div>
      <SheetFooter className="flex-row flex-wrap justify-end border-t">
        {params ? (
          <Button asChild variant="outline">
            <Link to={`/e/${target.entity}${params.size ? `?${params}` : ""}`} className={plainLink}>
              <ExternalLink /> Open in the list
            </Link>
          </Button>
        ) : (
          m && <p className="mr-auto text-xs text-muted-foreground">The list page cannot apply all of these filters; the records are shown here.</p>
        )}
      </SheetFooter>
    </>
  );
}
