// Dashboards, charts and number cards: what the viewer may open, with creating, copying and
// deleting; and this feature's routes and sidebar entry. The screens behind the routes load on
// demand (charts and the grid stay out of the first download).

import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams, type RouteObject } from "react-router";
import { ChartColumn, Copy, Ellipsis, Hash, LayoutDashboard, Lock, Pencil, Plus, Search, Trash2, Users, Globe, type LucideIcon } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { can, useMetaIndex } from "@/lib/meta";
import { cn } from "@/lib/utils";
import { fieldIssues, issuesAt, studio, useDeleteStudioRecord, useSaveStudioRecord, useStudioList, type Sharing, type StudioListRow } from "@/lib/studio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/ui/kit";
import { duplicateOf } from "./dashboard/builder";
import { CHART_TYPE_LABEL } from "./dashboard/charts";
import { CHART_ICON } from "./dashboard/icons";

import { SharingFields } from "./dashboard/RecordFields";
import { EmptyBlock, ErrorBlock, Messages, PageHeader, plainLink, useConfirm } from "./dashboard/ui";

export const dashboardRoutes: RouteObject[] = [
  { path: "studio/dashboards", Component: DashboardsPage },
  { path: "studio/dashboards/:id", lazy: async () => ({ Component: (await import("./DashboardView")).DashboardViewPage }) },
  { path: "studio/charts/:id", lazy: async () => ({ Component: (await import("./ChartBuilder")).ChartBuilderPage }) },
  { path: "studio/cards/:id", lazy: async () => ({ Component: (await import("./NumberCardBuilder")).NumberCardBuilderPage }) },
];

/** Charts and number cards are tabs of the dashboards page (`?tab=charts`, `?tab=cards`). */
export const dashboardNav: { label: string; to: string; icon: string }[] = [{ label: "Dashboards", to: "/studio/dashboards", icon: "dashboard" }];

type Tab = "dashboards" | "charts" | "cards";
const ENTITY: Record<Tab, string> = { dashboards: "Dashboard", charts: "DashboardChart", cards: "NumberCard" };
const NOUN: Record<Tab, string> = { dashboards: "dashboard", charts: "chart", cards: "number card" };
const SHARING: Record<Sharing, { label: string; icon: LucideIcon }> = {
  private: { label: "Only me", icon: Lock },
  roles: { label: "Roles", icon: Users },
  everyone: { label: "Everyone", icon: Globe },
};

function usePermissions() {
  const entities = useMetaIndex().data?.entities;
  const perms = (t: Tab) => entities?.find((e) => e.name === ENTITY[t])?.permissions;
  return {
    create: (t: Tab) => can(perms(t), "create"),
    write: (t: Tab) => can(perms(t), "write"),
    remove: (t: Tab) => can(perms(t), "delete"),
    entityLabel: (name: string | null | undefined) => (name ? (entities?.find((e) => e.name === name)?.label ?? name) : ""),
  };
}

/** A copy of a record (package records are customized this way); its id. */
const copyOf = async <K extends Tab>(kind: K, id: string) => (await studio.save(kind, duplicateOf(await studio.get(kind, id)))).id;

const hrefOf = (t: Tab, id: string) => (t === "dashboards" ? `/studio/dashboards/${id}` : t === "charts" ? `/studio/charts/${id}` : `/studio/cards/${id}`);

export function DashboardsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (["charts", "cards"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "dashboards") as Tab;
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const p = usePermissions();
  return (
    <div>
      <PageHeader
        title="Dashboards"
        description="Charts, number cards, shortcuts and notes on one page, with filters that apply to all of them."
        actions={
          <>
            {(p.create("charts") || p.create("cards")) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Plus /> New…
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {p.create("charts") && (
                    <DropdownMenuItem asChild>
                      <Link to="/studio/charts/new" className={plainLink}>
                        <ChartColumn /> Chart
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {p.create("cards") && (
                    <DropdownMenuItem asChild>
                      <Link to="/studio/cards/new" className={plainLink}>
                        <Hash /> Number card
                      </Link>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {p.create("dashboards") && (
              <Button onClick={() => setCreating(true)}>
                <LayoutDashboard /> New dashboard
              </Button>
            )}
          </>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(t) =>
          setSp(
            (prev) => {
              const n = new URLSearchParams(prev);
              if (t === "dashboards") n.delete("tab");
              else n.set("tab", t);
              return n;
            },
            { replace: true },
          )
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <TabsList>
            <TabsTrigger value="dashboards">Dashboards</TabsTrigger>
            <TabsTrigger value="charts">Charts</TabsTrigger>
            <TabsTrigger value="cards">Number cards</TabsTrigger>
          </TabsList>
          <InputGroup className="h-9 w-full sm:ml-auto sm:w-64">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${NOUN[tab]}s`} aria-label={`Search ${NOUN[tab]}s`} />
          </InputGroup>
        </div>
        {(["dashboards", "charts", "cards"] as Tab[]).map((t) => (
          <TabsContent key={t} value={t} className="pt-3">
            {t === tab && <RecordList tab={t} q={q} onNew={() => setCreating(true)} />}
          </TabsContent>
        ))}
      </Tabs>
      <NewDashboard open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function matches(r: StudioListRow, q: string) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${r.label} ${r.description ?? ""} ${r.module ?? ""} ${"base_entity" in r ? (r.base_entity ?? "") : ""}`.toLowerCase();
  return terms.every((w) => hay.includes(w));
}

function RecordList({ tab, q, onNew }: { tab: Tab; q: string; onNew: () => void }) {
  const list = useStudioList(tab);
  const p = usePermissions();
  const navigate = useNavigate();
  const remove = useDeleteStudioRecord(tab);
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const rows = useMemo(() => (list.data ?? []).filter((r) => matches(r, q)), [list.data, q]);
  const noun = NOUN[tab];

  const copy = async (r: StudioListRow) => {
    setBusy(r.id);
    try {
      const made = await copyOf(tab, r.id);
      toast("Copy made");
      navigate(tab === "dashboards" ? `/studio/dashboards/${made}?edit=1` : hrefOf(tab, made ?? ""));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const del = async (r: StudioListRow) => {
    const ok = await confirm({
      title: `Delete “${r.label}”?`,
      message: tab === "dashboards" ? "The dashboard is removed for everyone. Its charts and number cards stay." : `The ${noun} is removed for everyone. Dashboards and spaces that show it must drop it first.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync({ id: r.id });
      toast(`Deleted “${r.label}”`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  if (list.error) return <ErrorBlock error={list.error} onRetry={() => list.refetch()} title={`Could not load the ${noun}s`} />;
  if (!list.data)
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  if (!list.data.length)
    return (
      <EmptyBlock
        icon={tab === "dashboards" ? LayoutDashboard : tab === "charts" ? ChartColumn : Hash}
        title={`No ${noun}s yet`}
        action={
          p.create(tab) &&
          (tab === "dashboards" ? (
            <Button onClick={onNew}>
              <Plus /> New dashboard
            </Button>
          ) : (
            <Button asChild>
              <Link to={hrefOf(tab, "new")} className={cn(plainLink, "text-primary-foreground")}>
                <Plus /> New {noun}
              </Link>
            </Button>
          ))
        }
      >
        {tab === "dashboards" ? "A dashboard puts charts, number cards and notes on one page, with filters for all of them." : tab === "charts" ? "A chart plots a query, a saved report or a built-in report." : "A number card shows one count or total, with its change since the last period."}
      </EmptyBlock>
    );
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">No {noun}s match “{q}”.</p>;

  return (
    <>
      {dialog}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={`${noun}s`}>
        {rows.map((r) => {
          const s = SHARING[r.sharing] ?? SHARING.private;
          const type = tab === "charts" ? (r as StudioListRow<"charts">).chart_type : undefined;
          const Icon = type ? (CHART_ICON[type] ?? ChartColumn) : tab === "cards" ? Hash : LayoutDashboard;
          const entity = tab !== "dashboards" ? p.entityLabel((r as StudioListRow<"charts">).base_entity) : "";
          const canEdit = p.write(tab) && !r.is_standard;
          return (
            <li key={r.id} className="group relative flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-border-strong">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary" aria-hidden="true">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link to={hrefOf(tab, r.id)} className={cn(plainLink, "block truncate font-medium after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none")}>
                    {r.label}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {[type && CHART_TYPE_LABEL[type], entity, tab === "dashboards" && (r as StudioListRow<"dashboards">).refresh_interval ? "auto-refresh" : ""].filter(Boolean).join(" · ") || " "}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="relative z-10 text-muted-foreground" aria-label={`Actions for ${r.label}`} disabled={busy === r.id}>
                      {busy === r.id ? <Spinner /> : <Ellipsis />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canEdit && (
                      <DropdownMenuItem asChild>
                        <Link to={tab === "dashboards" ? `/studio/dashboards/${r.id}?edit=1` : hrefOf(tab, r.id)} className={plainLink}>
                          <Pencil /> Edit
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {p.create(tab) && (
                      <DropdownMenuItem onSelect={() => void copy(r)}>
                        <Copy /> Make a copy
                      </DropdownMenuItem>
                    )}
                    {p.remove(tab) && !r.is_standard && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => void del(r)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {r.description && <p className="line-clamp-2 text-sm text-muted-foreground">{r.description}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <Badge variant="outline" className="gap-1">
                  <s.icon aria-hidden="true" /> {s.label}
                </Badge>
                {r.is_standard && <Badge variant="secondary">Package</Badge>}
                {r.mine && <Badge variant="secondary">Yours</Badge>}
                <span className="ml-auto">{relativeTime(r.updated_at)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function NewDashboard({ open, onClose: close }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const save = useSaveStudioRecord("dashboards");
  const onClose = () => {
    save.reset();
    close();
  };
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [sharing, setSharing] = useState<{ sharing: Sharing; roles: { role: string }[]; module: string | null }>({ sharing: "private", roles: [], module: null });
  const issues = fieldIssues(save.error);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    try {
      const made = await save.mutateAsync({ label: label.trim(), description: description.trim() || null, sharing: sharing.sharing, roles: sharing.sharing === "roles" ? sharing.roles : [], module: sharing.module, layout: [], filters: [], refresh_interval: 0 });
      onClose();
      setLabel("");
      setDescription("");
      navigate(`/studio/dashboards/${made.id}?edit=1`);
    } catch (err) {
      if (!fieldIssues(err).length) toast(errorMessage(err), "error");
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[min(90vh,48rem)] flex-col gap-0 p-0 sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="border-b p-4 pr-12">
            <DialogTitle>New dashboard</DialogTitle>
            <DialogDescription>You add its widgets next.</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="new-dash-label">
                Title <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input id="new-dash-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={140} required autoFocus aria-invalid={issuesAt(issues, "label").length > 0 || undefined} />
              <Messages list={issuesAt(issues, "label")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-dash-desc">Description</Label>
              <Textarea id="new-dash-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <SharingFields value={{ label, ...sharing }} onChange={(patch) => setSharing((s) => ({ ...s, ...(patch as Partial<typeof s>) }))} issues={issues} />
            {save.error && !issues.length ? <Messages list={[errorMessage(save.error)]} /> : null}
          </div>
          <DialogFooter className="border-t p-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!label.trim() || save.isPending}>
              {save.isPending && <Spinner />} Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
