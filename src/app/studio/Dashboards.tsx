// Dashboards, charts and number cards: what the viewer may open, with creating, copying and
// deleting; and this feature's routes and sidebar entry. The screens behind the routes load on
// demand (charts and the grid stay out of the first download).

import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
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
import { t as tr, isolate } from "@ferrum/client";


/** Charts and number cards are tabs of the dashboards page (`?tab=charts`, `?tab=cards`). */
export { dashboardNav } from "./nav";

type Tab = "dashboards" | "charts" | "cards";
const ENTITY: Record<Tab, string> = { dashboards: "Dashboard", charts: "DashboardChart", cards: "NumberCard" };
/** What each tab says about what it lists, in whole sentences. */
const WORDS: Record<Tab, { failed: () => string; none: () => string; add: () => string; noMatch: (q: string) => string; list: () => string; search: () => string }> = {
  dashboards: { failed: () => tr("Could not load the dashboards"), none: () => tr("No dashboards yet"), add: () => tr("New dashboard"), noMatch: (q) => tr("No dashboards match “{q}”.", { q }), list: () => tr("Dashboards"), search: () => tr("Search dashboards") },
  charts: { failed: () => tr("Could not load the charts"), none: () => tr("No charts yet"), add: () => tr("New chart"), noMatch: (q) => tr("No charts match “{q}”.", { q }), list: () => tr("Charts"), search: () => tr("Search charts") },
  cards: { failed: () => tr("Could not load the number cards"), none: () => tr("No number cards yet"), add: () => tr("New number card"), noMatch: (q) => tr("No number cards match “{q}”.", { q }), list: () => tr("Number cards"), search: () => tr("Search number cards") },
};
const SHARING: Record<Sharing, { label: string; icon: LucideIcon }> = {
  private: { get label() { return tr("Only me"); }, icon: Lock },
  roles: { get label() { return tr("Roles"); }, icon: Users },
  everyone: { get label() { return tr("Everyone"); }, icon: Globe },
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
        title={tr("Dashboards")}
        description={tr("Charts, number cards, shortcuts and notes on one page, with filters that apply to all of them.")}
        actions={
          <>
            {(p.create("charts") || p.create("cards")) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Plus /> {tr("New…")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {p.create("charts") && (
                    <DropdownMenuItem asChild>
                      <Link to="/studio/charts/new" className={plainLink}>
                        <ChartColumn /> {tr("Chart")}
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {p.create("cards") && (
                    <DropdownMenuItem asChild>
                      <Link to="/studio/cards/new" className={plainLink}>
                        <Hash /> {tr("Number card")}
                      </Link>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {p.create("dashboards") && (
              <Button onClick={() => setCreating(true)}>
                <LayoutDashboard /> {tr("New dashboard")}
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
            <TabsTrigger value="dashboards">{tr("Dashboards")}</TabsTrigger>
            <TabsTrigger value="charts">{tr("Charts")}</TabsTrigger>
            <TabsTrigger value="cards">{tr("Number cards")}</TabsTrigger>
          </TabsList>
          <InputGroup className="h-9 w-full sm:ms-auto sm:w-64">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={WORDS[tab].search()} aria-label={WORDS[tab].search()} />
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
  const words = WORDS[tab];

  const copy = async (r: StudioListRow) => {
    setBusy(r.id);
    try {
      const made = await copyOf(tab, r.id);
      toast(tr("Copy made"));
      navigate(tab === "dashboards" ? `/studio/dashboards/${made}?edit=1` : hrefOf(tab, made ?? ""));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const del = async (r: StudioListRow) => {
    const ok = await confirm({
      title: tr("Delete “{label}”?", { label: r.label }),
      message: tab === "dashboards" ? tr("The dashboard is removed for everyone. Its charts and number cards stay.") : tab === "charts" ? tr("The chart is removed for everyone. Dashboards and spaces that show it must drop it first.") : tr("The number card is removed for everyone. Dashboards and spaces that show it must drop it first."),
      confirmLabel: tr("Delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync({ id: r.id });
      toast(tr("Deleted “{label}”", { label: r.label }));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  if (list.error) return <ErrorBlock error={list.error} onRetry={() => list.refetch()} title={words.failed()} />;
  if (!list.data)
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label={tr("Loading")}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    );
  if (!list.data.length)
    return (
      <EmptyBlock
        icon={tab === "dashboards" ? LayoutDashboard : tab === "charts" ? ChartColumn : Hash}
        title={words.none()}
        action={
          p.create(tab) &&
          (tab === "dashboards" ? (
            <Button onClick={onNew}>
              <Plus /> {tr("New dashboard")}
            </Button>
          ) : (
            <Button asChild>
              <Link to={hrefOf(tab, "new")} className={cn(plainLink, "text-primary-foreground")}>
                <Plus /> {words.add()}
              </Link>
            </Button>
          ))
        }
      >
        {tab === "dashboards" ? tr("A dashboard puts charts, number cards and notes on one page, with filters for all of them.") : tab === "charts" ? tr("A chart plots a query, a saved report or a built-in report.") : tr("A number card shows one count or total, with its change since the last period.")}
      </EmptyBlock>
    );
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">{words.noMatch(q)}</p>;

  return (
    <>
      {dialog}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={words.list()}>
        {rows.map((r) => {
          const s = SHARING[r.sharing] ?? SHARING.private;
          const type = tab === "charts" ? (r as StudioListRow<"charts">).chart_type : undefined;
          const Icon = type ? (CHART_ICON[type] ?? ChartColumn) : tab === "cards" ? Hash : LayoutDashboard;
          const entity = tab !== "dashboards" ? p.entityLabel((r as StudioListRow<"charts">).base_entity) : "";
          const canEdit = p.write(tab) && !r.is_standard;
          return (
            <li key={r.id} className="group relative flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-border-strong">
              <div className="flex items-start gap-3">
                {/* The icon only where it says something (a chart's type); the same mark on every dashboard or card would not. */}
                {type && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <Link to={hrefOf(tab, r.id)} className={cn(plainLink, "block truncate font-medium after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none")}>
                    {isolate(r.label)}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {[type && CHART_TYPE_LABEL[type], entity, tab === "dashboards" && (r as StudioListRow<"dashboards">).refresh_interval ? "auto-refresh" : ""].filter(Boolean).join(" · ") || " "}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="relative z-10 text-muted-foreground" aria-label={tr("Actions for {label}", { label: r.label })} disabled={busy === r.id}>
                      {busy === r.id ? <Spinner /> : <Ellipsis />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canEdit && (
                      <DropdownMenuItem asChild>
                        <Link to={tab === "dashboards" ? `/studio/dashboards/${r.id}?edit=1` : hrefOf(tab, r.id)} className={plainLink}>
                          <Pencil /> {tr("Edit")}
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {p.create(tab) && (
                      <DropdownMenuItem onSelect={() => void copy(r)}>
                        <Copy /> {tr("Make a copy")}
                      </DropdownMenuItem>
                    )}
                    {p.remove(tab) && !r.is_standard && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => void del(r)}>
                          <Trash2 /> {tr("Delete")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {r.description && <p className="line-clamp-2 text-sm text-muted-foreground">{isolate(r.description)}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <Badge variant="outline" className="gap-1">
                  <s.icon aria-hidden="true" /> {isolate(s.label)}
                </Badge>
                {r.is_standard && <Badge variant="secondary">{tr("Package")}</Badge>}
                {r.mine && <Badge variant="secondary">{tr("Yours")}</Badge>}
                <span className="ms-auto">{isolate(relativeTime(r.updated_at))}</span>
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
          <DialogHeader className="border-b p-4 pe-12">
            <DialogTitle>{tr("New dashboard")}</DialogTitle>
            <DialogDescription>{tr("You add its widgets next.")}</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="new-dash-label">
                {tr("Title")} <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input id="new-dash-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={140} required autoFocus aria-invalid={issuesAt(issues, "label").length > 0 || undefined} />
              <Messages list={issuesAt(issues, "label")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-dash-desc">{tr("Description")}</Label>
              <Textarea id="new-dash-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <SharingFields value={{ label, ...sharing }} onChange={(patch) => setSharing((s) => ({ ...s, ...(patch as Partial<typeof s>) }))} issues={issues} />
            {save.error && !issues.length ? <Messages list={[errorMessage(save.error)]} /> : null}
          </div>
          <DialogFooter className="border-t p-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {tr("Cancel")}
            </Button>
            <Button type="submit" disabled={!label.trim() || save.isPending}>
              {save.isPending && <Spinner />} {tr("Create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
