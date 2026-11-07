// Form Designer (administrators): arrange an entity's form (tabs, sections, fields) by drag and drop or
// "Move to…" menus, check it in a read-only preview, undo/redo, save it as one `form` customization, and
// restore earlier layouts. Built on the layout model the form itself renders from (lib/formLayout.ts).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, History, Redo2, Save, ShieldAlert, TriangleAlert, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { checkLayout, layoutOf, layoutOp, sameLayout, toForm, type LayoutSection } from "../lib/formLayout";
import { useEntityMeta, useMe, type EntityMeta } from "../lib/meta";
import { confirmDialog, ErrorState, PageLoading, toast } from "../ui/kit";
import { Canvas, useMedia } from "./designer/Canvas";
import { LayoutHistory, ORIGINAL } from "./designer/History";
import { SectionInspector } from "./designer/Inspector";
import { FormPreview } from "./designer/Preview";
import { layoutVersions, normalize, record, redo, restorePlan, saveProblem, startHistory, undo, type Customization, type SaveProblem } from "./designer/logic";
import { t as tr, isolate } from "@ferrum/client";

/** Where an entity's form designer lives (relative to the app's base). */
const metaPath = (entity: string) => `/api/meta/${encodeURIComponent(entity)}`;

const useCustomizations = () =>
  useQuery({
    queryKey: ["customize"],
    queryFn: ({ signal }) => api.get<{ customizations: Customization[]; warnings: unknown[] }>("/api/customize", undefined, signal),
  });

export function FormDesignerPage() {
  const { entity = "" } = useParams();
  const me = useMe();
  if (me.isLoading) return <PageLoading />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data?.user.is_admin) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldAlert aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{tr("Administrator access required")}</EmptyTitle>
          <EmptyDescription>{tr("Only administrators can change form layouts. Ask one of them to make this change.")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return <DesignerLoader key={entity} entity={entity} />;
}

function DesignerLoader({ entity }: { entity: string }) {
  const meta = useEntityMeta(entity);
  if (meta.error) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} title={tr("Could not load {entity}", { entity })} />;
  if (!meta.data) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label={tr("Loading the form layout")}>
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 xl:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)_minmax(16rem,20rem)]">
          <Skeleton className="h-72 max-xl:hidden" />
          <Skeleton className="h-96" />
          <Skeleton className="h-72 max-xl:hidden" />
        </div>
      </div>
    );
  }
  return <Designer meta={meta.data} />;
}

function Designer({ meta }: { meta: EntityMeta }) {
  const qc = useQueryClient();
  const E = meta.name;
  const custom = useCustomizations();
  // Palette, canvas and inspector side by side need room; narrower screens fold the palette and use a sheet.
  const wide = useMedia("(min-width: 1280px)");

  // `base` is the server layout the edits started from; `hist.present` is the layout on screen.
  const serverLayout = useMemo(() => normalize(layoutOf(meta)), [meta]);
  const [base, setBase] = useState(serverLayout);
  const [hist, setHist] = useState(() => startHistory(serverLayout));
  const layout = hist.present;
  const dirty = !sameLayout(layout, base);
  const changedElsewhere = !sameLayout(serverLayout, base);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveProblem | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [mode, setMode] = useState<"design" | "preview">("design");
  const [tab, setTab] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Nothing pending: follow the server's layout (after a restore, or a save made elsewhere).
  useEffect(() => {
    if (dirty || !changedElsewhere) return;
    setBase(serverLayout);
    setHist(startHistory(serverLayout));
  }, [dirty, changedElsewhere, serverLayout]);

  const problems = useMemo(() => checkLayout(layout, meta), [layout, meta]);
  const flagged = useMemo(() => new Set([...problems.map((p) => p.section), ...(saveError?.sections ?? [])]), [problems, saveError]);
  const { versions, current } = useMemo(() => layoutVersions(custom.data?.customizations ?? [], E), [custom.data, E]);
  const warnings = (custom.data?.warnings ?? []).flatMap((w) => {
    const o = w && typeof w === "object" ? (w as { entity?: unknown; message?: unknown }) : null;
    return o?.entity === E && typeof o.message === "string" ? [o.message] : [];
  });

  const change = (next: LayoutSection[], group?: string) => {
    setHist((h) => record(h, normalize(next), group ?? null));
    setSaveError(null);
  };
  const step = (dir: "undo" | "redo") => {
    setHist(dir === "undo" ? undo : redo);
    setSaveError(null);
  };
  const select = (key: string) => {
    setSelected(key);
    if (!wide) setSettingsOpen(true);
  };

  const save = async (force = false) => {
    if (saving || !dirty) return;
    if (problems.length) return toast(problems[0].message, "error");
    setSaving(true);
    setSaveError(null);
    try {
      if (!force) {
        // Someone may have changed the layout since it was opened: then show that instead of overwriting it.
        const fresh = await qc.fetchQuery({
          queryKey: ["meta", E],
          queryFn: ({ signal }) => api.get<EntityMeta>(metaPath(E), undefined, signal),
          staleTime: 0,
        });
        if (!sameLayout(normalize(layoutOf(fresh)), base)) return;
      }
      const saved = layout;
      await api.post("/api/customize", { entity: E, op: layoutOp(saved) });
      // The form now renders this layout; keep the cache in step until the refetch lands.
      qc.setQueryData<EntityMeta>(["meta", E], (m) => (m ? { ...m, form: toForm(saved) } : m));
      setBase(saved);
      toast(tr("Form layout saved"));
      void qc.invalidateQueries({ queryKey: ["meta"] });
      void qc.invalidateQueries({ queryKey: ["customize"] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const p = saveProblem(e.message, layout);
        setSaveError(p);
        const first = layout.find((s) => p.sections.includes(s.key));
        if (first) {
          setTab(first.tab || null);
          setSelected(first.key);
          if (!wide) setSettingsOpen(true);
        }
      } else toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const loadLatest = async () => {
    if (!(await confirmDialog({ title: tr("Discard your changes?"), message: tr("The designer loads the layout as it is saved now."), confirmLabel: tr("Discard"), danger: true })))
      return;
    setBase(serverLayout);
    setHist(startHistory(serverLayout));
    setSaveError(null);
  };

  const restore = async (target: Customization | null) => {
    const ok = await confirmDialog({
      title: target ? tr("Restore the layout saved {value}?", { value: formatDateTime(target.created_at) }) : tr("Restore the original {label} layout?", { label: meta.label }),
      message: tr("{value}The form switches to this layout for everyone. Later layouts stay in the history, switched off.", { value: dirty ? "Your unsaved changes will be discarded. " : "" }),
      confirmLabel: tr("Restore"),
      danger: dirty,
    });
    if (!ok) return;
    setRestoring(target?.id ?? ORIGINAL);
    try {
      // Plan from the latest list (another administrator may have saved since), switching the target
      // on first (the server validates that), then later ones off: the form never shows a broken layout.
      const latest = await custom.refetch({ throwOnError: true });
      const fresh = layoutVersions(latest.data?.customizations ?? [], E).versions;
      const goal = target && (fresh.find((v) => v.id === target.id) ?? null);
      if (target && !goal) throw new Error("That layout is no longer in the history.");
      for (const s of restorePlan(fresh, goal)) await api.put(`/api/customize/${s.id}/active`, { active: s.active });
      setHist(startHistory(base)); // drop unsaved edits: the restored layout loads when the refetch lands
      setSaveError(null);
      setHistoryOpen(false);
      toast(tr("Layout restored"));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      await Promise.all([qc.invalidateQueries({ queryKey: ["meta"] }), qc.invalidateQueries({ queryKey: ["customize"] })]);
      setRestoring(null);
    }
  };

  // ── unsaved-changes guard and shortcuts ──

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: tr("Leave without saving?"), message: tr("Your changes to this layout will be lost."), confirmLabel: tr("Leave"), danger: true }).then((ok) =>
      ok ? blocker.proceed() : blocker.reset(),
    );
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const keys = useRef({ save, step });
  keys.current = { save, step };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void keys.current.save();
        return;
      }
      if (k !== "z" && k !== "y") return;
      // Text inputs keep their own undo; so do open dialogs and menus.
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable='true'], [role=dialog], [role=menu]")) return;
      e.preventDefault();
      keys.current.step(k === "y" || e.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── rendering ──

  const selectedSection = layout.find((s) => s.key === selected) ?? null;
  const inspector = (framed: boolean) => (
    <SectionInspector
      meta={meta}
      layout={layout}
      sectionKey={selectedSection?.key ?? null}
      onChange={change}
      onTab={setTab}
      problems={problems}
      saveError={saveError}
      framed={framed}
    />
  );

  return (
    <div className="min-w-0">
      <div className="page-head">
        <div className="min-w-0">
          <nav className="crumbs" aria-label={tr("Breadcrumb")}>
            <Link to="/customize">{tr("Customize")}</Link>
            <ChevronRight className="size-3" aria-hidden="true" />
            <Link to={`/customize/${encodeURIComponent(E)}`}>{isolate(meta.label)}</Link>
          </nav>
          <h1 className="page-title">{tr("{label} form layout", { label: meta.label })}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {custom.data &&
              (current ? (
                <Badge variant="outline" title={tr("The layout in use is a customization")}>
                  {tr("Customized · saved {value}", { value: formatDateTime(current.created_at) })}
                </Badge>
              ) : (
                <Badge variant="outline">{tr("Original layout")}</Badge>
              ))}
            {dirty && <Badge className="bg-warning-soft text-warning">{tr("Unsaved changes")}</Badge>}
          </div>
        </div>
        <div className="page-actions">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={tr("View")}
            value={mode}
            onValueChange={(v) => v && setMode(v as "design" | "preview")}
          >
            <ToggleGroupItem value="design" className="pointer-coarse:h-11">
              {tr("Design")}
            </ToggleGroupItem>
            <ToggleGroupItem value="preview" className="pointer-coarse:h-11">
              {tr("Preview")}
            </ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" size="sm" className="pointer-coarse:h-11" disabled={!hist.past.length} onClick={() => step("undo")} title={tr("Undo (Ctrl+Z)")}>
            <Undo2 aria-hidden="true" />
            <span className="max-sm:sr-only">{tr("Undo")}</span>
          </Button>
          <Button variant="outline" size="sm" className="pointer-coarse:h-11" disabled={!hist.future.length} onClick={() => step("redo")} title={tr("Redo (Ctrl+Shift+Z)")}>
            <Redo2 aria-hidden="true" />
            <span className="max-sm:sr-only">{tr("Redo")}</span>
          </Button>
          <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={() => setHistoryOpen(true)}>
            <History aria-hidden="true" />
            <span className="max-sm:sr-only">{tr("History")}</span>
          </Button>
          <Button size="sm" className="pointer-coarse:h-11" disabled={!dirty || saving || problems.length > 0} onClick={() => void save()} title={tr("Save (Ctrl+S)")}>
            {saving ? <Spinner /> : <Save aria-hidden="true" />} {tr("Save")}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 empty:hidden">
        {warnings.length > 0 && (
          <Alert>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{tr("The server skipped customizations of {label}", { label: meta.label })}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc ps-4">
                {warnings.map((w, i) => (
                  <li key={i}>{isolate(w)}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {dirty && changedElsewhere && !saving && (
          <Alert>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{tr("This layout was changed elsewhere")}</AlertTitle>
            <AlertDescription>
              <p>{tr("Another administrator saved or restored the {label} layout after you opened it. Saving now replaces their version with yours.", { label: meta.label })}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void loadLatest()}>
                  {tr("Load their version")}
                </Button>
                <Button size="sm" onClick={() => void save(true)}>
                  {tr("Save mine anyway")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {saveError && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{tr("The layout was not saved")}</AlertTitle>
            <AlertDescription>
              <p className="break-words">{isolate(saveError.message.split("\n")[0])}</p>
              {saveError.sections.length > 0 && <p>{tr("The section concerned is highlighted.")}</p>}
            </AlertDescription>
          </Alert>
        )}
        {problems.length > 0 && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{tr("Fix these before saving")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc ps-4">
                {problems.map((p, i) => (
                  <li key={i}>{isolate(p.message)}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>

      {mode === "preview" ? (
        <FormPreview meta={meta} layout={layout} unsaved={dirty} />
      ) : (
        <Canvas
          meta={meta}
          layout={layout}
          onChange={change}
          tab={tab}
          onTab={setTab}
          selected={selectedSection?.key ?? null}
          onSelect={select}
          flagged={flagged}
          wide={wide}
          aside={wide ? <div className="sticky top-[calc(var(--topbar-h)+1rem)]">{inspector(true)}</div> : undefined}
        />
      )}

      {!wide && (
        <Sheet open={settingsOpen && !!selectedSection} onOpenChange={setSettingsOpen}>
          <SheetContent
            side="right"
            className="w-full gap-0 overflow-y-auto sm:max-w-md"
            onCloseAutoFocus={(e) => {
              // The section may be gone (deleted from here): continue at "Add section".
              if (selectedSection && document.getElementById(`fd-st-${selectedSection.key}`)) return;
              e.preventDefault();
              document.getElementById("fd-add-section")?.focus();
            }}
          >
            <SheetHeader>
              <SheetTitle>{tr("Section settings")}</SheetTitle>
              <SheetDescription>{selectedSection ? tr("Label, columns, tab and condition of “{value}”.", { value: selectedSection.label?.trim() || "Untitled section" }) : ""}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">{inspector(false)}</div>
          </SheetContent>
        </Sheet>
      )}

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{tr("Layout history")}</SheetTitle>
            <SheetDescription>{tr("Every layout saved for the {label} form. Restoring one switches the form back to it.", { label: meta.label })}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <LayoutHistory
              meta={meta}
              loading={custom.isLoading}
              error={custom.error}
              onRetry={() => void custom.refetch()}
              versions={versions}
              current={current}
              restoring={restoring}
              onRestore={(t) => void restore(t)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
