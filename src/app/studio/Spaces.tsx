// Spaces: the list of module and team home pages the viewer may open, and the feature's entry
// (routes, sidebar entries, and the hooks a module's home uses to show its space).

import { Copy, LayoutGrid, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { can, useMetaIndex, type Access } from "@/lib/meta";
import { useDeleteStudioRecord, useStudioList, type StudioListRow } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { confirmDialog, toast } from "@/ui/kit";
import { SpaceIcon } from "./space/icons";
import { PATHS } from "./space/model";
import { t as tr, isolate } from "@ferrum/client";

export { useModuleSpace, useSpace, useSpaceNav } from "./space/hooks";

/** Routes relative to `/app/`; the view and the editor load on first use. */

/** Sidebar entry for the list; `useSpaceNav()` gives one per space the viewer may open. */
export { spaceNav } from "./nav";

const TAP = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";
const ALL = "__all__";

type Row = StudioListRow<"spaces">;

/** Whether a permission reaches this row: everything, or only what one created. */
const reaches = (a: Access | undefined, row: Row) => a === "all" || (a === "own" && row.mine);

export function SpacesPage() {
  const q = useStudioList("spaces");
  const meta = useMetaIndex().data;
  const perms = meta?.entities.find((e) => e.name === "Space")?.permissions;
  const [search, setSearch] = useState("");
  const [module, setModule] = useState(ALL);
  const moduleLabel = useMemo(() => new Map(meta?.modules.map((m) => [m.name, m.label])), [meta]);
  const rows = q.data ?? [];
  const modules = [...new Set(rows.map((r) => r.module).filter((m): m is string => !!m))].sort((a, b) => (moduleLabel.get(a) ?? a).localeCompare(moduleLabel.get(b) ?? b));
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter(
    (r) =>
      (module === ALL || r.module === module) &&
      terms.every((t) => `${r.label} ${r.description ?? ""} ${(r.module && moduleLabel.get(r.module)) ?? r.module ?? ""}`.toLowerCase().includes(t)),
  );
  const canCreate = can(perms, "create");

  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      <header className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="page-title">{tr("Spaces")}</h1>
          <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">
            {tr("Home pages for modules and teams: shortcuts with live counts, charts, number cards, recent records, notes and checklists.")}
          </p>
        </div>
        {canCreate && (
          <Button asChild className={TAP}>
            <Link to={PATHS.newSpace}>
              <Plus /> {tr("New space")}
            </Link>
          </Button>
        )}
      </header>

      {rows.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" role="search">
          <InputGroup className="max-w-sm min-w-0 flex-1 basis-56 pointer-coarse:h-11">
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Search spaces")} aria-label={tr("Search spaces")} />
            {search && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label={tr("Clear the search")} onClick={() => setSearch("")}>
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          {modules.length > 1 && (
            <Select value={module} onValueChange={setModule}>
              <SelectTrigger aria-label={tr("Module")} className={cn("w-48", TAP)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{tr("All modules")}</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m} value={m}>
                    {moduleLabel.get(m) ?? m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {q.isLoading ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label={tr("Loading spaces")}>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-24 w-full rounded-lg" />
            </li>
          ))}
        </ul>
      ) : q.error ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{tr("Spaces could not be loaded")}</EmptyTitle>
            <EmptyDescription>{isolate(errorMessage(q.error))}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => void q.refetch()}>
              {tr("Try again")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : !rows.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutGrid />
            </EmptyMedia>
            <EmptyTitle>{tr("No spaces yet")}</EmptyTitle>
            <EmptyDescription>
              {canCreate
                ? tr("A space gathers what a team needs on one page. Start from a module to get its shortcuts, links and recent records in one go.")
                : tr("No space has been shared with you yet.")}
            </EmptyDescription>
          </EmptyHeader>
          {canCreate && (
            <EmptyContent className="flex-row flex-wrap justify-center">
              <Button asChild>
                <Link to={PATHS.newSpace}>
                  <Plus /> {tr("New space")}
                </Link>
              </Button>
              <ModuleStart />
            </EmptyContent>
          )}
        </Empty>
      ) : !shown.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{tr("No space matches")}</EmptyTitle>
            <EmptyDescription>{tr("Try other words, or another module.")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setModule(ALL);
              }}
            >
              {tr("Clear the filters")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => (
            <SpaceCard key={r.id} row={r} moduleLabel={r.module ? (moduleLabel.get(r.module) ?? r.module) : undefined} canEdit={!r.is_standard && reaches(perms?.write, r)} canDelete={!r.is_standard && reaches(perms?.delete, r)} canCreate={canCreate} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SpaceCard({ row: r, moduleLabel, canEdit, canDelete, canCreate }: { row: Row; moduleLabel?: string; canEdit: boolean; canDelete: boolean; canCreate: boolean }) {
  const remove = useDeleteStudioRecord("spaces");
  const doDelete = async () => {
    const ok = await confirmDialog({ title: tr("Delete “{label}”?", { label: r.label }), message: tr("Everyone it is shared with loses it. This can’t be undone."), confirmLabel: tr("Delete"), danger: true });
    if (!ok) return;
    try {
      await remove.mutateAsync({ id: r.id });
      toast(tr("Space deleted"));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const audience = r.sharing === "everyone" ? tr("Everyone") : r.sharing === "roles" ? tr("Shared with roles") : r.mine ? tr("Only you") : tr("Private");
  return (
    <li className="relative">
      <Link
        to={PATHS.space(r.id)}
        className="flex h-full items-start gap-3 rounded-lg border bg-card p-4 pe-12 text-card-foreground transition-colors outline-none hover:bg-accent/50 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          <SpaceIcon name={r.icon} className="size-4" />
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="truncate font-medium">{isolate(r.label)}</span>
          {r.description && <span className="line-clamp-2 text-sm text-muted-foreground">{isolate(r.description)}</span>}
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {moduleLabel && <Badge variant="outline">{isolate(moduleLabel)}</Badge>}
            {r.is_standard && <Badge variant="secondary">{tr("Standard")}</Badge>}
            <span>{isolate(audience)}</span>
            <span aria-hidden="true">·</span>
            <span>{tr("Updated {value}", { value: relativeTime(r.updated_at) })}</span>
          </span>
        </span>
      </Link>
      <div className="absolute top-2 end-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className={TAP} aria-label={tr("Actions for {label}", { label: r.label })} disabled={remove.isPending}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={PATHS.space(r.id)}>
                <LayoutGrid /> {tr("Open")}
              </Link>
            </DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem asChild>
                <Link to={PATHS.editSpace(r.id)}>
                  <Pencil /> {tr("Edit")}
                </Link>
              </DropdownMenuItem>
            )}
            {canCreate && (
              <DropdownMenuItem asChild>
                <Link to={PATHS.copySpace(r.id)}>
                  <Copy /> {r.is_standard ? tr("Customize a copy") : tr("Duplicate")}
                </Link>
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void doDelete()}>
                  <Trash2 /> {tr("Delete")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

/** Opens the editor with a module's starter space (its shortcuts, links and recent records). */
function ModuleStart() {
  const meta = useMetaIndex().data;
  const navigate = useNavigate();
  const modules = useMemo(() => {
    const readable = new Set(meta?.entities.filter((e) => can(e.permissions, "read")).map((e) => e.name));
    return [...(meta?.modules ?? [])].sort((a, b) => a.order - b.order).filter((m) => m.items.some((i) => readable.has(i)));
  }, [meta]);
  if (!modules.length) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary">
          <LayoutGrid /> {tr("Start from a module")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0">
        <Command>
          <CommandInput placeholder={tr("Search modules…")} />
          <CommandList>
            <CommandEmpty>{tr("No module matches.")}</CommandEmpty>
            <CommandGroup>
              {modules.map((m) => (
                <CommandItem key={m.name} value={`${m.label} ${m.name}`} onSelect={() => navigate(`${PATHS.newSpace}?module=${encodeURIComponent(m.name)}`)}>
                  <SpaceIcon name={m.icon} className="size-4" />
                  {isolate(m.label)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
