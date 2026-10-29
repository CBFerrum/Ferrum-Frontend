// A dashboard: its filters (in the URL, so a filtered view can be shared), its widgets on the
// grid (stacked in reading order on narrow screens), refreshed on its interval; and its editor —
// add, remove, drag, resize (or move and resize from the keyboard and menus), settings, undo/redo,
// save with a merge when someone else saved first.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChartColumn,
  Copy,
  Ellipsis,
  FileText,
  GripVertical,
  Hash,
  Heading,
  LayoutDashboard,
  Link2,
  List,
  Move,
  Pencil,
  Plus,
  RefreshCw,
  Scaling,
  Settings2,
  Share2,
  Trash2,
} from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  fieldIssues,
  studio,
  useDashboardData,
  useDeleteStudioRecord,
  useSaveStudioRecord,
  useStudioRecord,
  type DashboardBlock,
  type DashboardData,
  type DashboardRecord,
  type FilterDef,
  type FilterValues,
  type Issue,
} from "@/lib/studio";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/ui/kit";
import { ChartBuilder } from "./ChartBuilder";
import { NumberCardBuilder } from "./NumberCardBuilder";
import { BlockDialog, blankBlock, OWN_TITLE, WidgetPicker, type OwnBlock } from "./dashboard/BlockDialog";
import { BuilderToolbar, ConflictNotice, duplicateOf, StandardNotice, type Conflict } from "./dashboard/builder";
import { DashboardSettings, refreshLabel } from "./dashboard/DashboardSettings";
import { DrillDownSheet } from "./dashboard/DrillDownSheet";
import type { DrillTarget } from "./dashboard/drill";
import { FilterBar } from "./dashboard/FilterBar";
import { filterDefIssues, readValues, writeValues } from "./dashboard/filters";
import { GridEditor, GridView } from "./dashboard/GridView";
import { mergeRecord, stableJson, useHistory } from "./dashboard/history";
import { addItem, describePlace, mergeLayouts, moveBy, normalize, removeItem, resizeBy, updateBlock, withIds, type Placed } from "./dashboard/layout";
import { blockKey, blockOf, dashboardBody, dashboardDraft, type DashboardEdit } from "./dashboard/records";
import { CardById, ChartById, useCanWrite, WidgetEnvProvider, WidgetFrame, WidgetView, type WidgetEnv } from "./dashboard/Widget";
import { EmptyBlock, ErrorBlock, PageHeader, useConfirm, useUnsavedGuard } from "./dashboard/ui";

export function DashboardViewPage() {
  const { id = "" } = useParams();
  return <DashboardScreen key={id} id={id} />;
}

/** "Updated 2 minutes ago", kept current (re-rendering only itself). */
function UpdatedAgo({ at, fetching, refresh }: { at: number; fetching: boolean; refresh: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-xs text-muted-foreground" aria-live="polite">
      {fetching ? "Updating…" : `Updated ${relativeTime(new Date(at).toISOString(), Math.max(now, at))}`}
      {refresh >= 30 && <span className="hidden sm:inline"> · {refreshLabel(refresh).toLowerCase()}</span>}
    </span>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="status" aria-label="Loading the dashboard">
      {[3, 3, 3, 3, 6, 6].map((w, i) => (
        <Skeleton key={i} className={cn("h-32 rounded-xl", w === 6 ? "col-span-2 h-72" : "")} />
      ))}
    </div>
  );
}

function DashboardScreen({ id }: { id: string }) {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const editing = sp.get("edit") === "1";
  // Filter values in the URL are typed by the dashboard's filter definitions, which come with
  // its data: a first visit with filters in the URL asks for the definitions first.
  const [defs, setDefs] = useState<FilterDef[] | null>(null);
  const urlFilters = [...sp.keys()].some((k) => k.startsWith("f."));
  const probe = useDashboardData(!defs && urlFilters ? id : undefined, {});
  const known = defs ?? probe.data?.dashboard.filters ?? null;
  const values = useMemo(() => (known ? readValues(sp, known) : {}), [sp, known]);
  const main = useDashboardData(known || !urlFilters ? id : undefined, values);
  useEffect(() => {
    const next = main.data?.dashboard.filters;
    if (next) setDefs((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [main.data]);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const env = useMemo<WidgetEnv>(() => ({ dashboardId: id, values, filterDefs: known ?? [], drill: setDrill }), [id, values, known]);
  const data = main.data;
  const error = main.error ?? probe.error;

  if (error && !data) return <ErrorBlock error={error} onRetry={() => (main.error ? main.refetch() : probe.refetch())} title="Could not open this dashboard" />;
  if (!data) return <GridSkeleton />;

  const exitEdit = (allow?: () => void) => {
    allow?.();
    setSp(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete("edit");
        return n;
      },
      { replace: true },
    );
  };

  return (
    <WidgetEnvProvider value={env}>
      {editing ? (
        <EditLoader id={id} view={data} onExit={exitEdit} />
      ) : (
        <DashboardViewer
          id={id}
          data={data}
          values={values}
          fetching={main.isFetching}
          error={main.error}
          updatedAt={main.dataUpdatedAt}
          onRefresh={() => void main.refetch()}
          onValues={(v) => setSp((p) => writeValues(p, data.dashboard.filters, v), { replace: true })}
          onEdit={() => setSp((p) => new URLSearchParams([...p.entries(), ["edit", "1"]]))}
          onDeleted={() => navigate("/studio/dashboards")}
        />
      )}
      <DrillDownSheet target={drill} onClose={() => setDrill(null)} />
    </WidgetEnvProvider>
  );
}

// ───────────────────────────── viewing ─────────────────────────────

function DashboardViewer({
  id,
  data,
  values,
  fetching,
  error,
  updatedAt,
  onRefresh,
  onValues,
  onEdit,
  onDeleted,
}: {
  id: string;
  data: DashboardData;
  values: FilterValues;
  fetching: boolean;
  error: unknown;
  updatedAt: number;
  onRefresh: () => void;
  onValues: (v: FilterValues) => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const remove = useDeleteStudioRecord("dashboards");
  const { confirm, dialog } = useConfirm();
  const d = data.dashboard;
  const editable = canWrite.dashboards && !d.is_standard;
  const refresh = d.refresh_interval ?? 0;
  // Widgets re-render with their data only (not with the header's state).
  const grid = useMemo(() => <GridView items={data.items} render={(it) => <WidgetView widget={it.widget} />} />, [data.items]);

  const duplicate = async () => {
    try {
      const full = await studio.get("dashboards", id);
      const copy = await studio.save("dashboards", duplicateOf(full));
      toast("Copy made");
      navigate(`/studio/dashboards/${copy.id}?edit=1`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const del = async () => {
    const ok = await confirm({ title: `Delete “${d.label}”?`, message: "The dashboard is removed for everyone. Its charts and number cards stay.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await remove.mutateAsync({ id });
      toast("Dashboard deleted");
      onDeleted();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied, with the current filters");
    } catch {
      toast("Could not copy the link", "error");
    }
  };

  return (
    <div>
      {dialog}
      <PageHeader
        eyebrow={
          <Link to="/studio/dashboards" className="text-muted-foreground">
            Dashboards
          </Link>
        }
        title={d.label}
        description={d.description}
        actions={
          <>
            <UpdatedAgo at={updatedAt} fetching={fetching} refresh={refresh} />
            <Button variant="outline" size="icon" aria-label="Refresh now" onClick={onRefresh} disabled={fetching}>
              {fetching ? <Spinner /> : <RefreshCw />}
            </Button>
            {editable && (
              <Button variant="outline" onClick={onEdit}>
                <Pencil /> Edit
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void copyLink()}>
                  <Share2 /> Copy link
                </DropdownMenuItem>
                {canWrite.dashboards && (
                  <DropdownMenuItem onSelect={() => void duplicate()}>
                    <Copy /> Make a copy
                  </DropdownMenuItem>
                )}
                {editable && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void del()}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <FilterBar
        defs={d.filters}
        chosen={values}
        effective={data.filters}
        onChange={(name, v) => onValues({ ...values, [name]: v })}
        onReset={() => onValues({})}
      />
      {!!error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>The dashboard could not be updated</AlertTitle>
          <AlertDescription>
            <p>{errorMessage(error)} It shows the last data it had.</p>
            <Button variant="outline" size="sm" className="mt-1" onClick={onRefresh}>
              <RefreshCw /> Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data.items.length ? (
        grid
      ) : (
        <EmptyBlock
          icon={LayoutDashboard}
          title="Nothing here yet"
          action={
            editable && (
              <Button onClick={onEdit}>
                <Plus /> Add widgets
              </Button>
            )
          }
        >
          {editable ? "Add charts, number cards, shortcuts and notes." : "There is nothing on this dashboard you can see."}
        </EmptyBlock>
      )}
    </div>
  );
}

// ───────────────────────────── editing ─────────────────────────────

function EditLoader({ id, view, onExit }: { id: string; view: DashboardData; onExit: (allow?: () => void) => void }) {
  const rec = useStudioRecord("dashboards", id);
  if (rec.error)
    return (
      <div className="grid gap-3">
        <ErrorBlock error={rec.error} onRetry={() => rec.refetch()} title="This dashboard cannot be edited here" />
        <div>
          <Button variant="outline" onClick={() => onExit()}>
            <ArrowLeft /> Back to the dashboard
          </Button>
        </div>
      </div>
    );
  if (!rec.data) return <GridSkeleton />;
  return <DashboardEditor record={rec.data} view={view} onExit={onExit} />;
}

type EditDraft = DashboardEdit;
const toDraft = dashboardDraft;
const toBody = dashboardBody;

type Builder = { kind: "charts" | "cards"; id?: string };

function DashboardEditor({ record, view, onExit }: { record: DashboardRecord; view: DashboardData; onExit: (allow?: () => void) => void }) {
  const navigate = useNavigate();
  const [base, setBase] = useState(record);
  const [builder, setBuilder] = useState<Builder | null>(null);
  // While a chart or card builder is open, its own undo/redo has the keyboard.
  const h = useHistory<EditDraft>(() => toDraft(record), !builder);
  const draft = h.value;
  const baseline = useMemo(() => stableJson(toBody(toDraft(base))), [base]);
  const dirty = stableJson(toBody(draft)) !== baseline;
  const guard = useUnsavedGuard(dirty, ({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname || !new URLSearchParams(nextLocation.search).has("edit"));
  const allowLeave = guard.allowLeave;
  const { confirm, dialog } = useConfirm();
  const save = useSaveStudioRecord("dashboards");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [settings, setSettings] = useState(false);
  const [picker, setPicker] = useState<"charts" | "cards" | null>(null);
  const [editing, setEditing] = useState<{ i?: string; block: OwnBlock } | null>(null);
  const [said, say] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const builderCancel = useRef<(() => void) | null>(null);
  const items = draft.layout;

  const savedKeys = useMemo(() => new Map(withIds(base.layout ?? []).map((it) => [it.i, blockKey(it)])), [base]);
  const resolved = useMemo(() => new Map(view.items.map((it) => [it.i, it.widget])), [view]);
  const titleOf = (it: Placed) => {
    const w = resolved.get(it.i);
    if (w?.type === "chart") return w.chart.label;
    if (w?.type === "card") return w.card.label;
    if (it.type === "heading") return `heading ${it.text}`;
    if (it.type === "shortcut") return `shortcut ${it.label}`;
    if (it.type === "list") return it.label || "record list";
    return it.type === "markdown" ? "text" : it.type === "chart" ? "chart" : "number card";
  };

  useEffect(() => {
    if (!focusId) return;
    const el = document.querySelector<HTMLElement>(`[data-item="${CSS.escape(focusId)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el?.querySelector<HTMLElement>(".dash-drag")?.focus({ preventScroll: true });
    setFocusId(null);
  }, [focusId, items]);

  const setLayout = (layout: Placed[], key?: string) => h.set((d) => ({ ...d, layout }), key);
  const place = (block: DashboardBlock) => {
    const [layout, i] = addItem(items, block);
    setLayout(layout);
    setFocusId(i);
    say(`Added the ${block.type === "card" ? "number card" : block.type} at ${describePlace(layout.find((x) => x.i === i)!)}.`);
  };
  const moveItem = (it: Placed, dx: number, dy: number) => {
    const next = moveBy(items, it.i, dx, dy);
    setLayout(next, `move-${it.i}`);
    const now = next.find((x) => x.i === it.i)!;
    say(now.x === it.x && now.y === it.y ? "It cannot move further that way." : `Moved ${titleOf(it)} to ${describePlace(now)}.`);
  };
  const resizeItem = (it: Placed, dw: number, dh: number) => {
    const next = resizeBy(items, it.i, dw, dh);
    setLayout(next, `size-${it.i}`);
    const now = next.find((x) => x.i === it.i)!;
    say(now.w === it.w && now.h === it.h ? "It cannot change size further that way." : `Resized ${titleOf(it)}: ${describePlace(now)}.`);
  };
  const removeIt = (it: Placed) => {
    setLayout(removeItem(items, it.i));
    say(`Removed ${titleOf(it)}.`);
    addRef.current?.focus();
  };

  const doSave = async () => {
    const local = [...filterDefIssues(draft.filters), ...(draft.label.trim() ? [] : [{ path: "label", message: "Give the dashboard a title" }])];
    if (local.length) {
      setIssues(local);
      setSettings(true);
      return;
    }
    try {
      await save.mutateAsync({ ...toBody(draft), id: base.id, version: base.version });
      toast("Dashboard saved");
      onExit(allowLeave);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && base.id) {
        try {
          const latest = await studio.get("dashboards", base.id);
          const merged = mergeRecord(toBody(toDraft(base)), toBody(draft), toBody(toDraft(latest)), {
            layout: (b, m, t) => mergeLayouts((b ?? []) as Placed[], (m ?? []) as Placed[], (t ?? []) as Placed[]),
          });
          setBase(latest);
          h.set({ ...toDraft({ ...latest, ...merged.value }), layout: normalize(withIds(merged.value.layout ?? [])) });
          setConflict({ fields: merged.conflicts });
        } catch (e2) {
          toast(errorMessage(e2), "error");
        }
        return;
      }
      const list = fieldIssues(e);
      setIssues(list);
      if (list.some((i) => !i.path.startsWith("layout"))) setSettings(true);
      toast(list.length ? "The dashboard was not saved: please correct the highlighted settings." : errorMessage(e), "error");
    }
  };
  const cancel = async () => {
    if (dirty && !(await confirm({ title: "Discard your changes?", message: "The dashboard keeps its last saved layout.", confirmLabel: "Discard", danger: true }))) return;
    onExit(allowLeave);
  };
  const duplicateStandard = async () => {
    try {
      const copy = await studio.save("dashboards", duplicateOf({ ...base, ...toBody(draft) }));
      toast("Copy made");
      allowLeave();
      navigate(`/studio/dashboards/${copy.id}?edit=1`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  // The filters are checked as they are edited; the rest after a save attempt.
  const settingsIssues = [...issues.filter((i) => !i.path.startsWith("filters")), ...filterDefIssues(draft.filters), ...issues.filter((i) => i.path.startsWith("filters") && !filterDefIssues(draft.filters).length)];
  const layoutIssues = (n: number) => issues.filter((i) => i.path === `layout[${n}]` || i.path.startsWith(`layout[${n}]`)).map((i) => i.message);
  const general = issues.filter((i) => i.path === "layout" || (!i.path.startsWith("layout") && !settings)).map((i) => i.message);

  const handle = (it: Placed) => (
    <button
      type="button"
      className="dash-drag -ml-1.5 grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing pointer-coarse:size-10"
      aria-label={`Move ${titleOf(it)}: drag, or use the arrow keys; Shift and the arrow keys resize`}
      onKeyDown={(e: KeyboardEvent) => {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!d) return;
        e.preventDefault();
        if (e.shiftKey) resizeItem(it, d[0], d[1]);
        else moveItem(it, d[0], d[1]);
      }}
    >
      <GripVertical className="size-4" />
    </button>
  );
  const menu = (it: Placed) => (
    <>
      <DropdownMenuItem
        onSelect={() => {
          if (it.type === "chart") setBuilder({ kind: "charts", id: it.chart });
          else if (it.type === "card") setBuilder({ kind: "cards", id: it.card });
          else setEditing({ i: it.i, block: blockOf(it) as OwnBlock });
        }}
      >
        <Pencil /> {it.type === "chart" ? "Edit chart" : it.type === "card" ? "Edit number card" : "Edit"}
      </DropdownMenuItem>
      {(it.type === "chart" || it.type === "card") && (
        <DropdownMenuItem onSelect={() => setPicker(it.type === "chart" ? "charts" : "cards")}>
          <ChartColumn /> Add another {it.type === "chart" ? "chart" : "number card"}
        </DropdownMenuItem>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Move /> Move
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onSelect={() => moveItem(it, -1, 0)}>
            <ArrowLeft /> Left
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => moveItem(it, 1, 0)}>
            <ArrowRight /> Right
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => moveItem(it, 0, -1)}>
            <ArrowUp /> Up
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => moveItem(it, 0, 1)}>
            <ArrowDown /> Down
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Scaling /> Size
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onSelect={() => resizeItem(it, 1, 0)}>Wider</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => resizeItem(it, -1, 0)}>Narrower</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => resizeItem(it, 0, 1)}>Taller</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => resizeItem(it, 0, -1)}>Shorter</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => resizeItem(it, 12 - it.w, 0)}>Full width</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onSelect={() => place(blockOf(it))}>
        <Copy /> Duplicate
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => removeIt(it)}>
        <Trash2 /> Remove
      </DropdownMenuItem>
    </>
  );

  const content = (it: Placed, n: number): ReactNode => {
    const errs = layoutIssues(n);
    const w = savedKeys.get(it.i) === blockKey(it) ? resolved.get(it.i) : undefined;
    const body = w ? (
      <WidgetView widget={w} handle={handle(it)} editMenu={menu(it)} />
    ) : it.type === "chart" ? (
      <ChartById id={it.chart} handle={handle(it)} editMenu={menu(it)} />
    ) : it.type === "card" ? (
      <CardById id={it.card} handle={handle(it)} editMenu={menu(it)} />
    ) : it.type === "list" ? (
      <WidgetFrame title={it.label || "Record list"} label={it.label || "Record list"} handle={handle(it)} menu={menu(it)}>
        <p className="text-sm text-muted-foreground">The latest records appear here once the dashboard is saved.</p>
      </WidgetFrame>
    ) : (
      <WidgetView
        widget={
          it.type === "heading"
            ? { type: "heading", text: it.text, level: it.level ?? 2 }
            : it.type === "markdown"
              ? { type: "markdown", content: it.content }
              : { type: "shortcut", label: it.label, color: it.color, entity: it.entity ?? undefined, filters: it.filters, report: it.report ?? undefined, dashboard: it.dashboard ?? undefined, url: it.url }
        }
        handle={handle(it)}
        editMenu={menu(it)}
      />
    );
    return (
      <div className={cn("relative h-full", errs.length && "rounded-xl ring-2 ring-destructive")}>
        {body}
        {errs.length > 0 && (
          <p className="absolute inset-x-2 bottom-2 z-10 rounded bg-destructive px-2 py-1 text-xs text-white" role="alert">
            {errs.join(" ")}
          </p>
        )}
      </div>
    );
  };

  const ctx = { dashboardId: base.id, filterDefs: view.dashboard.filters, values: view.filters };
  const onBuilt = (saved: { id?: string }, kind: "charts" | "cards") => {
    const b = builder;
    setBuilder(null);
    if (!saved.id || b?.id) return; // an edited chart or card refreshes in place
    place(kind === "charts" ? { type: "chart", chart: saved.id } : { type: "card", card: saved.id });
  };

  return (
    <div>
      <PageHeader
        eyebrow={<span className="text-muted-foreground">Editing dashboard</span>}
        title={draft.label || "Untitled dashboard"}
        description={dirty ? "Unsaved changes" : "Drag widgets by their handle, resize them from the corner, or use each widget's menu."}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button ref={addRef}>
                  <Plus /> Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => setPicker("charts")}>
                  <ChartColumn /> Chart…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPicker("cards")}>
                  <Hash /> Number card…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setEditing({ block: blankBlock("heading") })}>
                  <Heading /> {OWN_TITLE.heading}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing({ block: blankBlock("markdown") })}>
                  <FileText /> {OWN_TITLE.markdown}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing({ block: blankBlock("shortcut") })}>
                  <Link2 /> {OWN_TITLE.shortcut}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing({ block: blankBlock("list") })}>
                  <List /> {OWN_TITLE.list}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setSettings(true)}>
              <Settings2 /> Settings
              {draft.filters.length > 0 && <Badge variant="secondary">{draft.filters.length}</Badge>}
            </Button>
            <BuilderToolbar canUndo={h.canUndo} canRedo={h.canRedo} undo={h.undo} redo={h.redo} dirty={dirty} saving={save.isPending} standard={!!base.is_standard} onSave={() => void doSave()} onCancel={() => void cancel()} />
          </>
        }
      />
      {guard.dialog}
      {dialog}
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {base.is_standard && <StandardNotice noun="dashboard" onDuplicate={() => void duplicateStandard()} />}
      {conflict && <ConflictNotice conflict={conflict} noun="dashboard" onDismiss={() => setConflict(null)} />}
      {general.length > 0 && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>The dashboard was not saved</AlertTitle>
          <AlertDescription>
            {general.map((m) => (
              <p key={m}>{m}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}
      <p className="mb-2 text-xs text-muted-foreground sm:hidden">The grid is wider than your screen while editing: scroll sideways, or use each widget's menu to move and resize it.</p>
      {items.length ? (
        <GridEditor items={items} onChange={(layout) => setLayout(layout)} render={(it) => content(it, items.indexOf(it))} />
      ) : (
        <EmptyBlock icon={LayoutDashboard} title="Add the first widget" action={<Button onClick={() => setPicker("charts")}><Plus /> Add a chart</Button>}>
          Charts, number cards, headings, notes, shortcuts and record lists go on a 12-column grid.
        </EmptyBlock>
      )}

      <DashboardSettings open={settings} onClose={() => setSettings(false)} value={draft} onChange={(patch, key) => h.set((d) => ({ ...d, ...patch }), key)} issues={settingsIssues} />
      <WidgetPicker
        kind={picker}
        onClose={() => setPicker(null)}
        onPick={(pid) => {
          const kind = picker;
          setPicker(null);
          place(kind === "cards" ? { type: "card", card: pid } : { type: "chart", chart: pid });
        }}
        onNew={() => {
          const kind = picker ?? "charts";
          setPicker(null);
          setBuilder({ kind });
        }}
      />
      <BlockDialog
        block={editing?.block ?? null}
        onClose={() => setEditing(null)}
        onSave={(block) => {
          const at = editing?.i;
          setEditing(null);
          if (at) {
            setLayout(updateBlock(items, at, block));
            setFocusId(at);
          } else place(block);
        }}
      />
      <Sheet open={!!builder} onOpenChange={(o) => !o && setBuilder(null)}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full gap-0 p-0 sm:max-w-[min(76rem,100vw)]"
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            builderCancel.current?.();
          }}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetTitle className="sr-only">{builder?.kind === "cards" ? "Number card" : "Chart"}</SheetTitle>
          <SheetDescription className="sr-only">Save to place it on the dashboard, or cancel.</SheetDescription>
          {builder?.kind === "charts" && <ChartBuilder id={builder.id} context={ctx} cancelRef={builderCancel} onSaved={(r) => onBuilt(r, "charts")} onClose={() => setBuilder(null)} />}
          {builder?.kind === "cards" && <NumberCardBuilder id={builder.id} context={ctx} cancelRef={builderCancel} onSaved={(r) => onBuilt(r, "cards")} onClose={() => setBuilder(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
