// The Space editor: blocks on the same grid the space shows, each previewed live from its unsaved
// settings; add, configure, resize, duplicate, remove and drag to reorder (keyboard and menu too),
// plus the space's own settings (name, icon, module, sidebar order, audience). Undo and redo,
// an unsaved-changes guard, inline errors from the server, and a rebase when someone saved first.

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  GripVertical,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Redo2,
  Save,
  Settings2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { can, useMe, useMetaIndex, useReports } from "@/lib/meta";
import { fieldIssues, studio, useDeleteStudioRecord, useSaveStudioRecord, useStudioRecord, type Issue, type SpaceBlock, type SpaceRecord } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { usePeople } from "../Collab";
import { BLOCK_ICON, SpaceGrid, useEntityLabels } from "./space/BlockView";
import { aria, BlockSettings, IntInput, Row } from "./space/BlockSettings";
import { useMediaQuery } from "./space/hooks";
import { IconPicker } from "./space/icons";
import {
  BLOCK_KINDS,
  BLOCK_TYPES,
  blockIssuesAt,
  blockTitle,
  commit,
  draftFromRecord,
  draftIssues,
  emptyDraft,
  newBlock,
  PATHS,
  placeIssues,
  rebase,
  recordBody,
  redo,
  sameDraft,
  spanClass,
  starterSpace,
  startHistory,
  undo,
  widthLabel,
  widthOf,
  WIDTHS,
  type BlockType,
  type EditorBlock,
  type History,
  type SpaceDraft,
} from "./space/model";
import { BlockPreview, useRecordLabels } from "./space/preview";
import { confirmDialog, toast } from "@/ui/kit";

let keySeq = 0;
const nextKey = () => `b${++keySeq}`;
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
const TAP = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

export function SpaceEditor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const from = id ? undefined : (sp.get("from") ?? undefined);
  const moduleName = id || from ? undefined : (sp.get("module") ?? undefined);
  const source = useStudioRecord("spaces", id ?? from);
  const meta = useMetaIndex().data;
  const reports = useReports();
  const perms = meta?.entities.find((e) => e.name === "Space")?.permissions;

  if (!can(perms, id ? "write" : "create"))
    return <Notice title={id ? "You can’t edit spaces" : "You can’t create spaces"} text="Ask an administrator for a role that may change spaces." />;
  if (source.isLoading || (moduleName && reports.isLoading)) return <EditorSkeleton />;
  if (source.error)
    return (
      <Notice
        title={source.error instanceof ApiError && source.error.status === 404 ? "This space doesn’t exist" : "The space could not be loaded"}
        text={source.error instanceof ApiError && source.error.status === 404 ? "It may have been deleted, or it isn’t shared with you." : errorMessage(source.error)}
        retry={() => void source.refetch()}
      />
    );
  if (id && source.data?.is_standard)
    return (
      <Notice title="This space comes with an app" text="Standard spaces can’t be changed. Make a copy to customize: the copy is yours to edit and share.">
        <Button asChild>
          <Link to={PATHS.copySpace(id)}>
            <Copy /> Duplicate to customize
          </Link>
        </Button>
      </Notice>
    );

  let initial: SpaceDraft;
  if (id && source.data) initial = draftFromRecord(source.data, nextKey);
  else if (source.data) initial = { ...draftFromRecord(source.data, nextKey), label: `${source.data.label} (copy)`.slice(0, 140), sharing: "private", roles: [] };
  else {
    const m = moduleName ? meta?.modules.find((x) => x.name === moduleName) : undefined;
    const readable = (meta?.entities ?? []).filter((e) => can(e.permissions, "read"));
    const s = m ? starterSpace(m, readable, reports.data?.reports) : undefined;
    initial = s ? { ...emptyDraft(), ...s, blocks: s.blocks.map((block) => ({ key: nextKey(), block })) } : emptyDraft();
  }
  return (
    <Editor
      key={id ?? `new:${from ?? moduleName ?? ""}`}
      id={id}
      record={id ? source.data : undefined}
      initial={initial}
      canDelete={can(perms, "delete")}
      canCreate={can(perms, "create")}
    />
  );
}

function Notice({ title, text, retry, children }: { title: string; text: string; retry?: () => void; children?: ReactNode }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutGrid />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        {children}
        {retry && (
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        )}
        <Button variant="ghost" asChild>
          <Link to={PATHS.spaces}>All spaces</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function EditorSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading the space">
      <Skeleton className="h-10 w-72" />
      <div className="flex gap-6">
        <div className="grid flex-1 grid-cols-12 gap-4">
          {[3, 3, 3, 3, 6, 6].map((w, i) => (
            <Skeleton key={i} className={cn(spanClass(w), w <= 3 ? "h-28" : "h-64", "rounded-xl")} />
          ))}
        </div>
        <Skeleton className="hidden h-96 w-[22rem] rounded-xl lg:block" />
      </div>
    </div>
  );
}

/** Server and client problems: block ones stay on their block (by key) when blocks move. */
interface Placed {
  key?: string;
  path: string;
  message: string;
}

function Editor({ id, record, initial, canDelete, canCreate }: { id?: string; record?: SpaceRecord; initial: SpaceDraft; canDelete: boolean; canCreate: boolean }) {
  const navigate = useNavigate();
  const save = useSaveStudioRecord("spaces");
  const remove = useDeleteStudioRecord("spaces");
  const [hist, setHist] = useState<History<SpaceDraft>>(() => startHistory(initial));
  const draft = hist.present;
  // What the server has: the baseline for "unsaved", and the version a save must match.
  const [saved, setSaved] = useState(() => ({ draft: id ? initial : emptyDraft(), version: record?.version, id, record }));
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"space" | "block">("space");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverIssues, setServerIssues] = useState<Placed[]>([]);
  const [conflict, setConflict] = useState<{ conflicts: string[]; by?: string } | null>(null);
  const [said, setSaid] = useState("");
  const wide = useMediaQuery("(min-width: 1024px)");
  const allowNav = useRef(false);
  // The latest state, for work that finishes after a request (edits may have happened meanwhile).
  const histNow = useRef(hist);
  useEffect(() => {
    histNow.current = hist;
  });
  const dirty = !sameDraft(draft, saved.draft);
  const busy = save.isPending || remove.isPending;

  const people = usePeople().data?.users;
  const nameOf = (userId: string | undefined) => (userId ? people?.find((p) => p.id === userId)?.full_name || undefined : undefined);
  const entityLabel = useEntityLabels();
  const charts = useRecordLabels("charts");
  const cards = useRecordLabels("cards");
  const titleOf = useCallback((b: SpaceBlock) => blockTitle(b, { entity: entityLabel, record: (rid) => charts.get(rid) ?? cards.get(rid) }), [entityLabel, charts, cards]);

  // ── problems ──
  const clientIssues = useMemo(() => (attempted ? draftIssues(draft) : []), [attempted, draft]);
  const issuesOf = (key: string): Issue[] => {
    const n = draft.blocks.findIndex((b) => b.key === key);
    return [...blockIssuesAt(clientIssues, n), ...serverIssues.filter((i) => i.key === key)];
  };
  const spaceIssues = (path: string) => [...clientIssues, ...serverIssues].filter((i) => !("key" in i && i.key) && (i.path === path || i.path.startsWith(`${path}[`))).map((i) => i.message);
  const generalServer = [...clientIssues.filter((i) => i.path === "blocks"), ...serverIssues.filter((i) => !i.key && !["label", "icon", "module", "sequence", "sharing", "roles", "description"].includes(i.path))];

  // ── edits ──
  const change = useCallback((fn: (d: SpaceDraft) => SpaceDraft, tag?: string) => setHist((h) => commit(h, fn(h.present), tag)), []);
  const editSpace = (fn: (d: SpaceDraft) => SpaceDraft, tag?: string, path?: string) => {
    change(fn, tag);
    if (path) setServerIssues((list) => list.filter((i) => i.key || i.path !== path));
  };
  const updateBlock = (key: string, block: SpaceBlock, tag?: string) => {
    change((d) => ({ ...d, blocks: d.blocks.map((b) => (b.key === key ? { key, block } : b)) }), tag);
    setServerIssues((list) => list.filter((i) => i.key !== key));
  };
  /** Moves focus into a settings panel once it has rendered: its first invalid control, else its first one. */
  const focusIn = (panelId: string) =>
    requestAnimationFrame(() => {
      const el = document.getElementById(panelId);
      (el?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? el?.querySelector<HTMLElement>("input, textarea, [role=combobox], button:not([disabled])"))?.focus();
    });
  const select = (key: string, focus = false) => {
    setSelected(key);
    setTab("block");
    if (!wide) setSheetOpen(true);
    else if (focus) focusIn(`settings-${key}`);
  };
  const addBlock = (type: BlockType) => {
    const key = nextKey();
    change((d) => {
      const at = selected ? d.blocks.findIndex((b) => b.key === selected) + 1 : 0;
      const blocks = [...d.blocks];
      blocks.splice(at > 0 ? at : blocks.length, 0, { key, block: newBlock(type) });
      return { ...d, blocks };
    });
    setSaid(`${BLOCK_KINDS[type].label} added.`);
    select(key, true);
  };
  const removeBlock = (key: string) => {
    const i = draft.blocks.findIndex((b) => b.key === key);
    const b = draft.blocks[i];
    if (!b) return;
    change((d) => ({ ...d, blocks: d.blocks.filter((x) => x.key !== key) }));
    if (selected === key) {
      setSelected(null);
      setTab("space");
      setSheetOpen(false);
    }
    setServerIssues((list) => list.filter((x) => x.key !== key));
    setSaid(`${titleOf(b.block)} removed. Press ${MOD}Z to undo.`);
    const next = draft.blocks[i + 1] ?? draft.blocks[i - 1];
    requestAnimationFrame(() => document.getElementById(next ? `handle-${next.key}` : "add-block")?.focus());
  };
  const moveBlock = (key: string, to: number) => {
    const from = draft.blocks.findIndex((b) => b.key === key);
    if (from < 0 || to < 0 || to >= draft.blocks.length || from === to) return;
    change((d) => ({ ...d, blocks: arrayMove(d.blocks, from, to) }));
    setSaid(`${titleOf(draft.blocks[from].block)} moved to position ${to + 1} of ${draft.blocks.length}.`);
  };
  const duplicateBlock = (key: string) => {
    const i = draft.blocks.findIndex((b) => b.key === key);
    if (i < 0) return;
    const copy: EditorBlock = { key: nextKey(), block: structuredClone(draft.blocks[i].block) };
    change((d) => ({ ...d, blocks: [...d.blocks.slice(0, i + 1), copy, ...d.blocks.slice(i + 1)] }));
    setSaid(`${titleOf(copy.block)} duplicated.`);
    select(copy.key, true);
  };
  const setWidth = (key: string, width: number | undefined) => {
    const b = draft.blocks.find((x) => x.key === key)?.block;
    if (!b) return;
    const { width: _old, ...rest } = b;
    updateBlock(key, (width === undefined ? rest : { ...rest, width }) as SpaceBlock);
  };
  const applyStarter = (s: ReturnType<typeof starterSpace>) => {
    change((d) => ({ ...d, label: d.label || s.label, icon: d.icon || s.icon, module: d.module || s.module, blocks: [...d.blocks, ...s.blocks.map((block) => ({ key: nextKey(), block }))] }));
    setSaid(`${s.blocks.length} blocks added.`);
  };
  const step = (fn: typeof undo) => {
    const next = fn(hist);
    if (next === hist) return;
    setHist(next);
    if (selected && !next.present.blocks.some((b) => b.key === selected)) {
      setSelected(null);
      setTab("space");
    }
    setSaid(fn === undo ? "Undone." : "Redone.");
  };

  // ── saving ──
  const doSave = async () => {
    if (busy) return;
    const problems = draftIssues(draft);
    setAttempted(true);
    if (problems.length) {
      toast(`Fix ${problems.length === 1 ? "the problem" : `the ${problems.length} problems`} marked in red before saving.`, "error");
      const m = /^blocks\[(\d+)\]/.exec(problems[0].path);
      if (m) select(draft.blocks[Number(m[1])].key, true);
      else {
        setSelected(null);
        setTab("space");
        if (!wide) setSheetOpen(true);
        else focusIn("space-settings");
      }
      return;
    }
    try {
      const out = await save.mutateAsync({ id: saved.id, version: saved.version, ...recordBody(draft) });
      setSaved({ draft, version: out.version, id: out.id, record: out });
      setServerIssues([]);
      setConflict(null);
      setAttempted(false);
      toast("Space saved");
      if (!saved.id && out.id) {
        allowNav.current = true;
        navigate(PATHS.editSpace(out.id), { replace: true });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && saved.id) return void (await rebaseOnLatest(saved.id));
      if (e instanceof ApiError && e.fields.length) {
        const placed = placeIssues(fieldIssues(e), draft.blocks.map((b) => b.block)).map((i): Placed => {
          const m = /^blocks\[(\d+)\]\.?/.exec(i.path);
          const key = m ? draft.blocks[Number(m[1])]?.key : undefined;
          return key ? { key, path: i.path.slice(m![0].length), message: i.message } : i;
        });
        setServerIssues(placed);
        const first = placed.find((i) => i.key);
        if (first?.key) select(first.key, true);
        else if (wide) focusIn("space-settings");
        toast(`${e.message}. The problems are marked in red.`, "error");
      } else toast(errorMessage(e), "error");
    }
  };

  const rebaseOnLatest = async (spaceId: string) => {
    try {
      const latest = await studio.get("spaces", spaceId);
      const theirs = draftFromRecord(latest, nextKey);
      // Mine as it is now: edits made while the save was on its way are kept.
      const { merged, conflicts } = rebase(saved.draft, histNow.current.present, theirs);
      setHist((h) => commit(h, merged));
      setSaved({ draft: theirs, version: latest.version, id: spaceId, record: latest });
      setConflict({ conflicts, by: nameOf(latest.updated_by) });
      setSelected((s) => (s && !merged.blocks.some((b) => b.key === s) ? null : s));
      toast("Someone else saved this space first. Their changes are merged in: review, then save again.", "info");
    } catch (err) {
      toast(`Someone else saved this space first, and it could not be reloaded: ${errorMessage(err)}`, "error");
    }
  };

  const doDelete = async () => {
    if (!saved.id) return;
    const ok = await confirmDialog({ title: `Delete “${draft.label || "this space"}”?`, message: "Everyone it is shared with loses it. This can’t be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await remove.mutateAsync({ id: saved.id, version: saved.version });
      toast("Space deleted");
      allowNav.current = true;
      navigate(PATHS.spaces, { replace: true });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  // ── guards and shortcuts ──
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !allowNav.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: "Leave without saving?", message: "Your changes to this space will be lost.", confirmLabel: "Leave", danger: true }).then((ok) =>
      ok ? blocker.proceed() : blocker.reset(),
    );
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const saveRef = useRef(doSave);
  useEffect(() => {
    saveRef.current = doSave;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s") {
        e.preventDefault();
        void saveRef.current();
      } else if (mod && !e.altKey && !isTyping(e.target) && (k === "z" || k === "y")) {
        // Inside a text field the browser's own undo applies.
        e.preventDefault();
        step(k === "y" || e.shiftKey ? redo : undo);
      } else if (e.key === "Escape" && !isTyping(e.target) && !document.querySelector("[role=dialog], [role=alertdialog], [role=menu], dialog[open]")) {
        setSelected(null);
        setTab("space");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── drag and drop ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const keys = draft.blocks.map((b) => b.key);
  const nameAt = (id: UniqueIdentifier) => {
    const b = draft.blocks.find((x) => x.key === id);
    return b ? titleOf(b.block) : "Block";
  };
  const position = (id: UniqueIdentifier) => keys.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameAt(active.id)}, position ${position(active.id)} of ${keys.length}.`,
    onDragOver: ({ active, over }) => (over ? `${nameAt(active.id)} is over position ${position(over.id)} of ${keys.length}.` : `${nameAt(active.id)} is not over a position.`),
    onDragEnd: ({ active, over }) => (over ? `${nameAt(active.id)} dropped at position ${position(over.id)} of ${keys.length}.` : `${nameAt(active.id)} dropped.`),
    onDragCancel: ({ active }) => `Moving ${nameAt(active.id)} was cancelled.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) change((d) => ({ ...d, blocks: arrayMove(d.blocks, keys.indexOf(String(active.id)), keys.indexOf(String(over.id))) }));
  };

  const selectedBlock = draft.blocks.find((b) => b.key === selected);
  const panel = (
    <Tabs value={selectedBlock ? tab : "space"} onValueChange={(v) => setTab(v as "space" | "block")} className="gap-4">
      <TabsList className="w-full">
        <TabsTrigger value="space" className={TAP}>
          Space
        </TabsTrigger>
        <TabsTrigger value="block" disabled={!selectedBlock} className={TAP}>
          Block
        </TabsTrigger>
      </TabsList>
      <TabsContent value="space">
        <SpaceSettings draft={draft} issues={spaceIssues} onChange={editSpace} />
      </TabsContent>
      <TabsContent value="block">
        {selectedBlock && (
          <BlockPanel
            eb={selectedBlock}
            title={titleOf(selectedBlock.block)}
            issues={issuesOf(selectedBlock.key)}
            onChange={(b, tag) => updateBlock(selectedBlock.key, b, tag)}
            onWidth={(w) => setWidth(selectedBlock.key, w)}
            onDone={() => {
              setSelected(null);
              setTab("space");
              setSheetOpen(false);
              document.getElementById(`handle-${selectedBlock.key}`)?.focus();
            }}
          />
        )}
      </TabsContent>
    </Tabs>
  );

  const updated = saved.record?.updated_at;
  const by = nameOf(saved.record?.updated_by);
  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="ghost" size="sm" asChild className={TAP}>
          <Link to={saved.id ? PATHS.space(saved.id) : PATHS.spaces}>
            <ArrowLeft /> {saved.id ? "Back to the space" : "Spaces"}
          </Link>
        </Button>
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="truncate text-xl font-semibold tracking-tight">{saved.id ? `Edit ${draft.label.trim() || "space"}` : "New space"}</h1>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {save.isPending ? "Saving…" : dirty ? "Unsaved changes" : saved.id ? `Saved${updated ? ` ${relativeTime(updated)}` : ""}${by ? ` by ${by}` : ""}` : "Not saved yet"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="icon" className={TAP} aria-label="Undo" title={`Undo (${MOD}Z)`} disabled={!hist.past.length} onClick={() => step(undo)}>
            <Undo2 />
          </Button>
          <Button variant="outline" size="icon" className={TAP} aria-label="Redo" title={`Redo (${MOD}${MOD === "⌘" ? "⇧Z" : "Y"})`} disabled={!hist.future.length} onClick={() => step(redo)}>
            <Redo2 />
          </Button>
          {!wide && (
            <Button
              variant="outline"
              className={TAP}
              onClick={() => {
                setTab(selectedBlock ? tab : "space");
                setSheetOpen(true);
              }}
            >
              <Settings2 /> Settings
            </Button>
          )}
          {saved.id && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className={TAP} aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={PATHS.space(saved.id)}>
                    <Eye /> View the space
                  </Link>
                </DropdownMenuItem>
                {canCreate && (
                  <DropdownMenuItem asChild>
                    <Link to={PATHS.copySpace(saved.id)}>
                      <Copy /> Duplicate
                    </Link>
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void doDelete()}>
                      <Trash2 /> Delete space
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button onClick={() => void doSave()} disabled={busy || (!dirty && !!saved.id)} title={`Save (${MOD}S)`} className={TAP}>
            <Save /> {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {said}
      </p>

      {conflict && (
        <Alert className="mb-4">
          <AlertTitle>{conflict.by ? `${conflict.by} saved this space while you were editing` : "Someone else saved this space while you were editing"}</AlertTitle>
          <AlertDescription>
            <p>
              Their changes are merged with yours.{" "}
              {conflict.conflicts.length
                ? `You both changed: ${conflict.conflicts.join(", ").toLowerCase()}. Yours are kept there; check them before saving again.`
                : "Nothing clashed. Save again to keep both."}
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setConflict(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {generalServer.length > 0 && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>The space wasn’t saved</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {generalServer.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-start gap-6">
        <section aria-label="Blocks" className="min-w-0 flex-1">
          {draft.blocks.length ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
              accessibility={{
                announcements,
                screenReaderInstructions: { draggable: "To move a block, press Space or Enter, then use the arrow keys. Press Space or Enter again to drop it, or Escape to cancel." },
              }}
            >
              <SortableContext items={keys} strategy={rectSortingStrategy}>
                <SpaceGrid>
                  {draft.blocks.map((b, i) => (
                    <SortableBlock
                      key={b.key}
                      eb={b}
                      index={i}
                      count={draft.blocks.length}
                      title={titleOf(b.block)}
                      selected={selected === b.key}
                      issues={issuesOf(b.key).map((x) => x.message)}
                      onSelect={() => select(b.key)}
                      onSettings={() => select(b.key, true)}
                      onMove={(to) => moveBlock(b.key, to)}
                      onDuplicate={() => duplicateBlock(b.key)}
                      onRemove={() => removeBlock(b.key)}
                      onWidth={(w) => setWidth(b.key, w)}
                    />
                  ))}
                </SpaceGrid>
              </SortableContext>
            </DndContext>
          ) : (
            <EmptyCanvas onAdd={addBlock} onStarter={applyStarter} />
          )}
          {draft.blocks.length > 0 && (
            <div className="mt-4">
              <AddBlockMenu onAdd={addBlock} after={selectedBlock ? titleOf(selectedBlock.block) : undefined} />
            </div>
          )}
        </section>
        {wide && (
          <aside aria-label="Settings" className="sticky top-[calc(var(--topbar-h)+1rem)] w-[22rem] shrink-0">
            <div className="max-h-[calc(100dvh-var(--topbar-h)-2rem)] overflow-y-auto rounded-xl border bg-card p-4 shadow-xs">{panel}</div>
          </aside>
        )}
      </div>
      {!wide && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
            <SheetHeader className="pb-2">
              <SheetTitle>{selectedBlock && tab === "block" ? titleOf(selectedBlock.block) : "Space settings"}</SheetTitle>
              <SheetDescription>Changes show in the space as you make them; save to keep them.</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">{panel}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

// ───────────────────────────── canvas ─────────────────────────────

function SortableBlock({
  eb,
  index,
  count,
  title,
  selected,
  issues,
  onSelect,
  onSettings,
  onMove,
  onDuplicate,
  onRemove,
  onWidth,
}: {
  eb: EditorBlock;
  index: number;
  count: number;
  title: string;
  selected: boolean;
  issues: string[];
  onSelect: () => void;
  onSettings: () => void;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onWidth: (w: number | undefined) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: eb.key });
  const Icon = BLOCK_ICON[eb.block.type];
  // The menu moves focus itself after removing (its button is gone).
  const ownFocus = useRef(false);
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(spanClass(widthOf(eb.block)), "min-w-0", isDragging && "relative z-20")}>
      <div
        role="group"
        aria-label={`${title}, block ${index + 1} of ${count}`}
        className={cn(
          "flex h-full flex-col rounded-xl ring-offset-2 ring-offset-background",
          selected ? "ring-2 ring-primary" : issues.length ? "ring-2 ring-destructive" : "",
          isDragging && "opacity-90 shadow-lg",
        )}
      >
        <div className="flex items-center gap-0.5 rounded-t-xl border border-b-0 bg-muted/70 px-1 py-0.5">
          <Button
            ref={setActivatorNodeRef}
            id={`handle-${eb.key}`}
            variant="ghost"
            size="icon-sm"
            className={cn("cursor-grab touch-none active:cursor-grabbing", TAP)}
            aria-label={`Move ${title}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical />
          </Button>
          <button
            type="button"
            onClick={onSettings}
            className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
            aria-label={`Settings of ${title}`}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{title}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className={TAP} aria-label={`Actions for ${title}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-52"
              onCloseAutoFocus={(e) => {
                if (ownFocus.current) e.preventDefault();
                ownFocus.current = false;
              }}
            >
              <DropdownMenuItem onSelect={onSettings}>
                <Settings2 /> Settings
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Width: {widthLabel(widthOf(eb.block)).toLowerCase()}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={eb.block.width ? String(eb.block.width) : "auto"} onValueChange={(v) => onWidth(v === "auto" ? undefined : Number(v))}>
                    <DropdownMenuRadioItem value="auto">Automatic ({widthLabel(BLOCK_KINDS[eb.block.type].width).toLowerCase()})</DropdownMenuRadioItem>
                    {WIDTHS.map((w) => (
                      <DropdownMenuRadioItem key={w.value} value={String(w.value)}>
                        {w.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index - 1)}>
                <ChevronUp /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(index + 1)}>
                <ChevronDown /> Move down
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(0)}>
                <ArrowUpToLine /> Move to the top
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(count - 1)}>
                <ArrowDownToLine /> Move to the bottom
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  ownFocus.current = true;
                  onDuplicate();
                }}
              >
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  ownFocus.current = true;
                  onRemove();
                }}
              >
                <Trash2 /> Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Clicking the preview selects the block; its links and controls stay inert while editing. */}
        <div className="min-h-0 flex-1 cursor-pointer" onClick={onSelect}>
          <div inert className="h-full [&>*]:rounded-t-none">
            <BlockPreview block={eb.block} />
          </div>
        </div>
        {issues.length > 0 && (
          <p className="mt-1 px-1 text-xs text-destructive">
            {issues[0]}
            {issues.length > 1 && ` (and ${issues.length - 1} more)`}
          </p>
        )}
      </div>
    </div>
  );
}

function AddBlockMenu({ onAdd, after }: { onAdd: (t: BlockType) => void; after?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id="add-block" variant="outline" className={cn("border-dashed", TAP)}>
          <Plus /> Add block
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{after ? `Adds after ${after}` : "Adds at the end"}</DropdownMenuLabel>
        {BLOCK_TYPES.map((t) => {
          const Icon = BLOCK_ICON[t];
          return (
            <DropdownMenuItem key={t} onSelect={() => onAdd(t)} className="items-start gap-3 py-2">
              <Icon className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-medium">{BLOCK_KINDS[t].label}</span>
                <span className="text-xs text-muted-foreground">{BLOCK_KINDS[t].hint}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Modules the viewer can start a space from (those with something readable). */
function useStarterModules() {
  const meta = useMetaIndex().data;
  const reports = useReports().data?.reports;
  return useMemo(() => {
    const readable = (meta?.entities ?? []).filter((e) => can(e.permissions, "read"));
    return [...(meta?.modules ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((m) => ({ module: m, starter: starterSpace(m, readable, reports) }))
      .filter((x) => x.starter.blocks.length);
  }, [meta, reports]);
}

function EmptyCanvas({ onAdd, onStarter }: { onAdd: (t: BlockType) => void; onStarter: (s: ReturnType<typeof starterSpace>) => void }) {
  const modules = useStarterModules();
  const [open, setOpen] = useState(false);
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutGrid />
        </EmptyMedia>
        <EmptyTitle>Add the first block</EmptyTitle>
        <EmptyDescription>Shortcuts with live counts, charts, number cards, quick lists of recent records, notes and getting-started checklists.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        <AddBlockMenu onAdd={onAdd} />
        {modules.length > 0 && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="secondary" className={TAP}>
                <LayoutGrid /> Start from a module
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0">
              <Command>
                <CommandInput placeholder="Search modules…" />
                <CommandList>
                  <CommandEmpty>No module matches.</CommandEmpty>
                  <CommandGroup heading="Shortcuts, links and recent records of">
                    {modules.map(({ module, starter }) => (
                      <CommandItem
                        key={module.name}
                        value={`${module.label} ${module.name}`}
                        onSelect={() => {
                          onStarter(starter);
                          setOpen(false);
                        }}
                      >
                        {module.label}
                        <span className="ml-auto text-xs text-muted-foreground">{starter.blocks.length} blocks</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </EmptyContent>
    </Empty>
  );
}

// ───────────────────────────── settings panels ─────────────────────────────

function BlockPanel({
  eb,
  title,
  issues,
  onChange,
  onWidth,
  onDone,
}: {
  eb: EditorBlock;
  title: string;
  issues: Issue[];
  onChange: (b: SpaceBlock, tag?: string) => void;
  onWidth: (w: number | undefined) => void;
  onDone: () => void;
}) {
  const general = issues.filter((i) => !i.path).map((i) => i.message);
  const auto = BLOCK_KINDS[eb.block.type].width;
  const width = eb.block.width;
  const id = `blk-${eb.key}`;
  return (
    <div id={`settings-${eb.key}`} className="grid gap-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        <Button variant="ghost" size="sm" className={TAP} onClick={onDone}>
          Done
        </Button>
      </div>
      {general.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>{general.join(" ")}</AlertDescription>
        </Alert>
      )}
      <BlockSettings block={eb.block} onChange={onChange} issues={issues} id={id} />
      <FieldGroup>
        <Row id={`${id}-width`} label="Width" errors={issues.filter((i) => i.path === "width").map((i) => i.message)} hint="On phones, small blocks pair up and the rest take the full width.">
          <Select value={width ? String(width) : "auto"} onValueChange={(v) => onWidth(v === "auto" ? undefined : Number(v))}>
            <SelectTrigger id={`${id}-width`} className={cn("w-full", TAP)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic ({widthLabel(auto).toLowerCase()})</SelectItem>
              {[...WIDTHS.map((w) => w.value), ...(width && !WIDTHS.some((w) => w.value === width) ? [width] : [])].map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {widthLabel(w)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </FieldGroup>
    </div>
  );
}

const NO_MODULE = "__none__";

function SpaceSettings({
  draft,
  issues,
  onChange,
}: {
  draft: SpaceDraft;
  issues: (path: string) => string[];
  onChange: (fn: (d: SpaceDraft) => SpaceDraft, tag?: string, path?: string) => void;
}) {
  const modules = useMetaIndex().data?.modules;
  const set = <K extends keyof SpaceDraft>(key: K, value: SpaceDraft[K], tag?: string) => onChange((d) => ({ ...d, [key]: value }), tag, key);
  const sorted = useMemo(() => [...(modules ?? [])].sort((a, b) => a.order - b.order), [modules]);
  const known = !draft.module || sorted.some((m) => m.name === draft.module);
  return (
    <FieldGroup id="space-settings" className="gap-5">
      <Row id="space-label" label="Name" errors={issues("label")}>
        <Input id="space-label" value={draft.label} maxLength={140} placeholder="Selling" onChange={(e) => set("label", e.target.value, "space:label")} className={TAP} {...aria("space-label", issues("label"))} />
      </Row>
      <Row id="space-icon" label="Icon" errors={issues("icon")}>
        <IconPicker id="space-icon" value={draft.icon} onChange={(v) => set("icon", v)} />
      </Row>
      <Row id="space-module" label="Module" optional errors={issues("module")} hint="The module whose home page shows this space.">
        <Select value={draft.module || NO_MODULE} onValueChange={(v) => set("module", v === NO_MODULE ? "" : v)}>
          <SelectTrigger id="space-module" className={cn("w-full", TAP)} {...aria("space-module", issues("module"), true)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_MODULE}>No module</SelectItem>
            {!known && <SelectItem value={draft.module}>{draft.module}</SelectItem>}
            {sorted.map((m) => (
              <SelectItem key={m.name} value={m.name}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row id="space-sequence" label="Order in the sidebar" errors={issues("sequence")} hint="Lower numbers come first.">
        <IntInput id="space-sequence" value={draft.sequence} onChange={(v) => set("sequence", v ?? 0, "space:sequence")} errors={issues("sequence")} hint className="w-28" />
      </Row>
      <Row id="space-sharing" label="Who can open it" errors={issues("sharing")}>
        <RadioGroup id="space-sharing" value={draft.sharing} onValueChange={(v) => set("sharing", v as SpaceDraft["sharing"])} aria-labelledby="space-sharing-label" className="gap-2">
          {(
            [
              ["private", "Only you", "Administrators and Studio managers can open every space."],
              ["roles", "People with chosen roles", "Each of them sees the blocks with their own permissions."],
              ["everyone", "Everyone in the workspace", "Each person sees the blocks with their own permissions."],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} htmlFor={`space-sharing-${value}`} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft/40">
              <RadioGroupItem id={`space-sharing-${value}`} value={value} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </Row>
      {draft.sharing === "roles" && (
        <Row id="space-roles" label="Roles" errors={issues("roles")}>
          <RolesPicker id="space-roles" value={draft.roles} errors={issues("roles")} onChange={(roles) => set("roles", roles)} />
        </Row>
      )}
      <Row id="space-description" label="Description" optional errors={issues("description")}>
        <Textarea id="space-description" rows={3} value={draft.description} onChange={(e) => set("description", e.target.value, "space:description")} />
      </Row>
    </FieldGroup>
  );
}

function RolesPicker({ id, value, onChange, errors }: { id: string; value: string[]; onChange: (v: string[]) => void; errors: string[] }) {
  const me = useMe().data;
  const admin = !!me?.user.is_admin;
  // Administrators see every role; others choose among their own or type one.
  const all = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: ({ signal }) => api.get<{ roles: { name: string }[] }>("/api/admin/roles", undefined, signal),
    enabled: admin,
    staleTime: 5 * 60_000,
  });
  const [q, setQ] = useState("");
  const options = useMemo(
    () => [...new Set([...(all.data?.roles ?? []).map((r) => r.name), ...(me?.user.roles ?? [])])].filter((r) => !r.startsWith("plugin:")).sort((a, b) => a.localeCompare(b)),
    [all.data, me],
  );
  const typed = q.trim();
  const toggle = (r: string) => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r]);
  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen roles">
          {value.map((r) => (
            <li key={r}>
              <Badge variant="secondary" className="gap-1 py-1 pr-1">
                {r}
                <button type="button" aria-label={`Remove ${r}`} onClick={() => toggle(r)} className="rounded-sm p-0.5 hover:bg-background">
                  <X className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Popover onOpenChange={(o) => !o && setQ("")}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" size="sm" className={cn("justify-self-start", TAP)} aria-labelledby={`${id}-label ${id}`} {...aria(id, errors)}>
            <Plus /> Add roles
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search or type a role…" value={q} onValueChange={setQ} />
            <CommandList>
              <CommandEmpty>{all.isLoading ? "Loading roles…" : "No role matches."}</CommandEmpty>
              {typed && !options.includes(typed) && !value.includes(typed) && (
                <CommandGroup>
                  <CommandItem value={`add ${typed}`} onSelect={() => (toggle(typed), setQ(""))}>
                    <Plus /> Add “{typed}”
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup>
                {options.map((r) => (
                  <CommandItem key={r} value={r} onSelect={() => toggle(r)}>
                    <Check className={cn("size-4", value.includes(r) ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                    {r}
                    {value.includes(r) && <span className="sr-only"> (chosen)</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
