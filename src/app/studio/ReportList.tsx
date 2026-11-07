// Saved reports the viewer may open (their own, shared with their roles or with everyone), searchable,
// by shape and owner; each opens in its run view, and from its menu in the builder, as a copy or not at all.

import { ChartColumn, Copy, Ellipsis, Globe, Grid3x3, Lock, Pencil, Plus, Rows3, Search, Sigma, Trash2, Users, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { can, useMetaIndex } from "@/lib/meta";
import { STUDIO_ENTITY, studio, useDeleteStudioRecord, useStudioList, type ReportKind, type Sharing, type StudioListRow } from "@/lib/studio";
import { confirmDialog, ErrorState, toast } from "@/ui/kit";
import { encodeParam, recordFromState, stateFromRecord } from "./report/state";
import { t as tr, isolate } from "@ferrum/client";

const KIND_META: Record<ReportKind, { label: string; icon: LucideIcon }> = {
  table: { get label() { return tr("Records"); }, icon: Rows3 },
  group_by: { get label() { return tr("Summary"); }, icon: Sigma },
  pivot: { get label() { return tr("Pivot"); }, icon: Grid3x3 },
  chart: { get label() { return tr("Chart"); }, icon: ChartColumn },
};

const SHARING: Record<Sharing, { label: string; icon: LucideIcon }> = {
  private: { get label() { return tr("Only me"); }, icon: Lock },
  roles: { get label() { return tr("Shared with roles"); }, icon: Users },
  everyone: { get label() { return tr("Everyone"); }, icon: Globe },
};

type Scope = "all" | "mine" | "shared";

export { reportNav } from "./nav";

export function ReportList() {
  const list = useStudioList("reports");
  const index = useMetaIndex();
  const navigate = useNavigate();
  const del = useDeleteStudioRecord("reports");
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [kind, setKind] = useState<ReportKind | "any">("any");
  const perms = index.data?.entities.find((e) => e.name === STUDIO_ENTITY.reports)?.permissions;
  const canCreate = can(perms, "create");
  const entityLabel = useMemo(() => new Map(index.data?.entities.map((e) => [e.name, e.label_plural])), [index.data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data ?? []).filter(
      (r) =>
        (scope === "all" || (scope === "mine") === r.mine) &&
        (kind === "any" || r.kind === kind) &&
        (!needle || [r.label, r.description, r.base_entity && entityLabel.get(r.base_entity), r.base_entity].some((t) => t?.toLowerCase().includes(needle))),
    );
  }, [list.data, q, scope, kind, entityLabel]);

  const editable = (r: StudioListRow<"reports">) => !r.is_standard && (perms?.write === "all" || (perms?.write === "own" && r.mine));
  const deletable = (r: StudioListRow<"reports">) => !r.is_standard && (perms?.delete === "all" || (perms?.delete === "own" && r.mine));

  const duplicate = async (r: StudioListRow<"reports">) => {
    try {
      const rec = await studio.get("reports", r.id);
      const s = stateFromRecord(rec);
      if (!s) throw new Error("This report’s settings could not be read.");
      navigate(`/studio/reports/new?q=${encodeParam({ ...recordFromState(s), view: s.view, label: `Copy of ${rec.label}`.slice(0, 140) })}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const remove = async (r: StudioListRow<"reports">) => {
    const ok = await confirmDialog({ title: tr("Delete this report?"), message: tr("“{label}” will be deleted for everyone it is shared with. This cannot be undone.", { label: r.label }), confirmLabel: tr("Delete"), danger: true });
    if (!ok) return;
    try {
      await del.mutateAsync({ id: r.id });
      toast(tr("Deleted “{label}”", { label: r.label }));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 pointer-coarse:[&_[data-slot=button]]:min-h-11 pointer-coarse:[&_[data-slot=button]]:min-w-11 pointer-coarse:[&_[data-slot=input]]:h-11">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{tr("Reports")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tr("Tables, summaries, pivots and charts over any records. Each person sees only the data their permissions allow.")}</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link to="/studio/reports/new">
              <Plus /> {tr("New report")}
            </Link>
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-48 flex-1 sm:max-w-80">
          <Search className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" className="ps-8" placeholder={tr("Search reports…")} aria-label={tr("Search reports")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ToggleGroup type="single" variant="outline" value={scope} onValueChange={(v) => v && setScope(v as Scope)} aria-label={tr("Whose reports")}>
          <ToggleGroupItem value="all">{tr("All")}</ToggleGroupItem>
          <ToggleGroupItem value="mine">{tr("Mine")}</ToggleGroupItem>
          <ToggleGroupItem value="shared">{tr("Shared with me")}</ToggleGroupItem>
        </ToggleGroup>
        <Select value={kind} onValueChange={(v) => setKind(v as ReportKind | "any")}>
          <SelectTrigger className="w-40" aria-label={tr("Report shape")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{tr("Any shape")}</SelectItem>
            {(Object.keys(KIND_META) as ReportKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {isolate(KIND_META[k].label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {list.isLoading ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label={tr("Loading reports")}>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-28 rounded-lg" />
            </li>
          ))}
        </ul>
      ) : list.error ? (
        <ErrorState title={tr("The reports could not be loaded")} error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data?.length ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartColumn aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{tr("No reports yet")}</EmptyTitle>
            <EmptyDescription>{tr("Build one in a minute: pick what to report on, group it, chart it, save it, share it.")}</EmptyDescription>
          </EmptyHeader>
          {canCreate && (
            <EmptyContent>
              <Button asChild>
                <Link to="/studio/reports/new">
                  <Plus /> {tr("New report")}
                </Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : !rows.length ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyTitle>{tr("No report matches")}</EmptyTitle>
            <EmptyDescription>{tr("Try another search, or show every shape and owner.")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={() => {
                setQ("");
                setScope("all");
                setKind("any");
              }}
            >
              {tr("Show all reports")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={tr("{length} reports", { length: rows.length })}>
          {rows.map((r) => {
            const K = KIND_META[r.kind]?.icon ?? Rows3;
            const S = SHARING[r.sharing]?.icon ?? Lock;
            return (
              <li key={r.id} className="relative flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-xs transition-colors focus-within:ring-[3px] focus-within:ring-ring/50 hover:border-border-strong">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary-soft text-primary" aria-hidden="true">
                    <K className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-medium">
                      <Link to={`/studio/reports/${encodeURIComponent(r.id)}`} className="outline-none after:absolute after:inset-0 after:content-['']">
                        {isolate(r.label)}
                      </Link>
                    </h2>
                    <p className="truncate text-xs text-muted-foreground">
                      {KIND_META[r.kind]?.label ?? r.kind}
                      {r.base_entity && ` · ${entityLabel.get(r.base_entity) ?? r.base_entity}`}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="relative z-10 shrink-0" aria-label={tr("{label}: actions", { label: r.label })}>
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {editable(r) && (
                        <DropdownMenuItem onSelect={() => navigate(`/studio/reports/${encodeURIComponent(r.id)}?edit=1`)}>
                          <Pencil /> {tr("Edit")}
                        </DropdownMenuItem>
                      )}
                      {canCreate && (
                        <DropdownMenuItem onSelect={() => void duplicate(r)}>
                          <Copy /> {tr("Duplicate")}
                        </DropdownMenuItem>
                      )}
                      {deletable(r) && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => void remove(r)}>
                            <Trash2 /> {tr("Delete")}
                          </DropdownMenuItem>
                        </>
                      )}
                      {!editable(r) && !canCreate && !deletable(r) && <DropdownMenuItem disabled>{tr("No actions available")}</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {r.description && <p className="line-clamp-2 text-sm text-muted-foreground">{isolate(r.description)}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <S className="size-3.5" aria-hidden="true" />
                    {SHARING[r.sharing]?.label ?? r.sharing}
                  </span>
                  {r.is_standard && <Badge variant="outline">{tr("Standard")}</Badge>}
                  {!r.mine && !r.is_standard && <Badge variant="outline">{tr("Shared with me")}</Badge>}
                  <span className="ms-auto" title={r.updated_at}>
                    {tr("Updated {value}", { value: relativeTime(r.updated_at) })}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
