// The print designer (PRINT-FORMATS-SPEC §7.3): a layout format on paper. The canvas is the SERVER's design-mode render (D4) in a
// frame that runs no script; over it this draws the selection, hover, drop places and column handles from the render's
// `data-b` / `data-slot` marks. Fields and blocks are dragged from the palette onto a place, blocks between sections and
// columns; everything drag does is also a key in the outline (Alt+arrows, Delete, Ctrl+D) and a "Move to" menu, each move
// announced. The layout is changed only through lib/printLayout.ts and every change can be undone. Saves with If-Match,
// "Save as" makes a copy, versions restore. A package's layout opens read-only with "Customize" (D8).

import { DndContext, DragOverlay, PointerSensor, pointerWithin, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, History as HistoryIcon, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useBlocker, useNavigate } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage, requestRaw, withPrintCsp } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import {
  blockFromCatalogue, BLOCK_NAMES, duplicateNode, locate, MM_PX, moveBlock, newBlock, nodeAt, nodeName, nudge, paperMm, parseSlot, refusedNode, removeNode, resizeColumns,
  insertBlock, toNeighbourColumn, toNewSectionAbove, toSave, validate, widthsOf, type Block, type BlockType, type Catalogue, type Id, type Layout, type PrintFormat, type Problem,
} from "../../lib/printLayout";
import { Alert, announce, Button, confirmDialog, Dialog, Field, toast, useDebounced } from "../../ui/kit";
import { SaveStatus, StatePanel } from "../../ui/patterns";
import { Toolbar, ToolbarButton, ToolbarGroup } from "../../ui/toolbar";
import { LinkInput } from "../widgets";
import { usePref } from "../../lib/prefs";
import { record, redo, startHistory, undo, type Undoable } from "../designer/logic";
import { Properties } from "./DesignerProps";
import { readMarks, type Box, type SlotBox } from "./marks";
import { useLetterheads } from "./LetterHeads";
import { formatLink, formatsLink, openPdf, PaperFrame, preview, readFormat, saveFormat, useCatalogue, useWidth, type FormatRead } from "./shared";

type DragData = { from: "palette"; label: string; make: (l: Layout) => Block } | { from: "canvas"; id: Id; label: string };

const ZOOMS = ["fit", "0.75", "1", "1.25"] as const;
const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function Designer({ read, fresh }: { read?: FormatRead & { etag: string | null }; fresh?: PrintFormat }) {
  const ids = useId();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const start = read?.template ?? fresh!;
  const [hist, setHist] = useState<Undoable<PrintFormat>>(() => startHistory(structuredClone(start)));
  const def = hist.present;
  const layout = def.layout!;
  const [etag, setEtag] = useState(read?.etag ?? null);
  const [base, setBase] = useState(() => (read ? JSON.stringify(toSave(read.template)) : ""));
  const [selected, setSelected] = useState<Id | null>(null);
  const [tab, setTab] = useState<"selected" | "page">("selected");
  const [state, setState] = useState<"draft" | "saving" | "saved" | "failed" | "conflict">(read ? "saved" : "draft");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [refused, setRefused] = useState<Problem[]>([]);
  const [checked, setChecked] = useState<Problem[] | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saveAs, setSaveAs] = useState(false);
  const [versions, setVersions] = useState(false);
  // The record the canvas shows: the sample until another is chosen, remembered per format and person.
  const recordPref = usePref<{ record?: string | null }>(`print-design:${def.key}`.slice(0, 120), {});
  const record_ = recordPref.value.record ?? null;
  const setRecord = (id: string | null) => recordPref.set({ record: id });
  const [ghosts, setGhosts] = useState<Set<Id>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [language, setLanguage] = useState("");
  const [letterhead, setLetterhead] = useState("none");
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>("fit");
  const closing = useRef(false);
  // A package's layout (source package or edited: `read.default` is the package's) cannot change in place (§13 g, D8).
  const readOnly = !!read?.default;
  const isNew = !read;
  const dirty = isNew || JSON.stringify(toSave(def)) !== base;
  const cat = useCatalogue(def.entity);
  const lhs = useLetterheads();
  const narrow = useNarrow();

  /** Every change goes through here: recorded for undo (a `group` of changes in a row, typing in one box, is one step). */
  const change = useCallback((next: PrintFormat, group?: string) => {
    setHist((h) => record(h, next, group ?? null));
    setState("draft");
    setRefused([]);
    setChecked(null);
  }, []);
  const setLayout = useCallback((l: Layout, group?: string) => change({ ...hist.present, layout: l }, group), [change, hist.present]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => !closing.current && dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: tr("Leave without saving?"), message: tr("Your changes to this format will be lost."), confirmLabel: tr("Leave"), danger: true }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ── keyboard: everything drag does ──
  const name = (id: Id) => {
    const w = locate(layout, id);
    return w ? nodeName(nodeAt(layout, w), cat.data) : id;
  };
  const where = (l: Layout, id: Id) => {
    const w = locate(l, id);
    if (!w || w.kind === "section") return w ? tr("section {n} of {total}", { n: w.s + 1, total: l.sections.length }) : "";
    const s = l.sections[w.s];
    return tr("{section}, column {c} of {cols}, place {n}", { section: nodeName(s), c: w.c + 1, cols: s.columns.length, n: w.kind === "block" ? w.b + 1 : 1 });
  };
  const act = (next: Layout, said: string, select?: Id) => {
    if (next === layout) return announce(tr("It cannot move further that way."));
    setLayout(next);
    if (select) setSelected(select);
    announce(said);
  };
  const flat = useMemo(() => layout.sections.flatMap((s) => [s.id, ...s.columns.flatMap((c) => [...(s.columns.length > 1 ? [c.id] : []), ...c.blocks.map((b) => b.id)])]), [layout]);
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const onKey = (e: ReactKeyboardEvent) => {
    if (editable(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") return (e.preventDefault(), e.shiftKey ? doRedo() : doUndo());
    if (mod && e.key.toLowerCase() === "y") return (e.preventDefault(), doRedo());
    if (!selected) return;
    const kind = locate(layout, selected)?.kind;
    if (!e.altKey && !mod && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const i = flat.indexOf(selected);
      const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSelected(next);
      return;
    }
    if (readOnly) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const next = nudge(layout, selected, e.key === "ArrowUp" ? -1 : 1);
      return act(next, tr("{name} moved to {where}", { name: name(selected), where: where(next, selected) }));
    }
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && kind === "block") {
      e.preventDefault();
      const back = (e.key === "ArrowLeft") !== rtl;
      if (e.shiftKey && back) {
        const r = toNewSectionAbove(layout, selected);
        return act(r.layout, tr("{name} moved to a new section above", { name: name(selected) }));
      }
      const next = toNeighbourColumn(layout, selected, back ? -1 : 1);
      return act(next, tr("{name} moved to {where}", { name: name(selected), where: where(next, selected) }));
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return remove(selected);
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      const r = duplicateNode(layout, selected);
      return act(r.layout, tr("{name} duplicated", { name: name(selected) }), r.id);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      setTab("selected");
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".pd-props .pd-scroll :is(input, select, textarea, button)")?.focus());
    }
    if (e.key === "Escape") setSelected(null);
  };
  const remove = (id: Id) => {
    const n = name(id);
    const next = removeNode(layout, id);
    if (next === layout) return announce(tr("The last section, or a section's last column, stays."));
    setLayout(next);
    setSelected(null);
    toast(tr("{name} removed", { name: n }), "success", { action: { label: tr("Undo"), onSelect: doUndo } });
  };
  const doUndo = () => (setHist((h) => undo(h)), setState("draft"), announce(tr("Undone")));
  const doRedo = () => (setHist((h) => redo(h)), setState("draft"), announce(tr("Done again")));

  // ── save ──
  const save = async (over?: string | null) => {
    const found = validate(layout, cat.data);
    if (found.length) {
      setChecked(found);
      const first = found.find((p) => p.id && locate(layout, p.id));
      if (first?.id) (setSelected(first.id), setTab("selected"));
      return;
    }
    setState("saving");
    try {
      const next = await saveFormat(toSave(def), over !== undefined ? over : etag);
      closing.current = true;
      setEtag(next);
      setBase(JSON.stringify(toSave(def)));
      setState("saved");
      setSavedAt(new Date().toISOString());
      setConflict(false);
      toast(tr("Format saved"));
      await qc.invalidateQueries({ queryKey: ["admin", "print", "formats"] });
      if (isNew) navigate(formatLink(def.key), { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return (setState("conflict"), setConflict(true));
      setState("failed");
      const fields = e instanceof ApiError ? e.fields : [];
      const problems = fields.length ? fields.map((f) => ({ id: refusedNode(f.field, f.message), message: f.message })) : [{ id: null, message: errorMessage(e) }];
      setRefused(problems);
      const first = problems.find((p) => p.id && locate(layout, p.id));
      if (first?.id) (setSelected(first.id), setTab("selected"));
    } finally {
      closing.current = false;
    }
  };

  // ── the canvas's render ──
  const sent = useDebounced(JSON.stringify(toSave(def)), 250);
  const ask = { template: JSON.parse(sent) as PrintFormat, record_id: record_, sample: !record_, mode: "design" as const, ...(showAll ? { design: "all" as const } : {}), ...(language ? { language } : {}), letterhead };
  const render = useQuery({ queryKey: ["admin", "print", "design", ask], queryFn: ({ signal }) => preview(ask, signal), placeholderData: keepPreviousData, retry: false, enabled: !narrow });
  // The last page drawn stays on the canvas while a change the server refuses is fixed (the refusal is said above it).
  const drawn = useRef<string | null>(null);
  if (render.data?.content) drawn.current = render.data.content;
  const latest = render.data?.latest_record ?? null;
  const testPrint = () => void openPdf(() => requestRaw("/api/admin/documents/preview", { method: "POST", body: { ...ask, mode: "print", format: "pdf" } })).catch((e) => toast(e instanceof ApiError && e.status === 503 ? tr("This server makes no PDFs: preview prints from the browser only.") : errorMessage(e), "error"));

  // ── drag and drop ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragging, setDragging] = useState<DragData | null>(null);
  const collide: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    return within.length ? within : closestCenter(args);
  };
  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current as DragData) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as DragData | undefined;
    setDragging(null);
    const slot = e.over ? parseSlot(String(e.over.id).replace(/^slot:/, "")) : null;
    if (!data || !slot || readOnly) return;
    if (data.from === "palette") {
      const r = insertBlock(layout, data.make(layout), slot.column, slot.index);
      act(r.layout, tr("{name} added at {where}", { name: data.label, where: where(r.layout, r.id) }), r.id);
    } else {
      const next = moveBlock(layout, data.id, slot.column, slot.index);
      if (next !== layout) act(next, tr("{name} moved to {where}", { name: data.label, where: where(next, data.id) }), data.id);
    }
  };
  /** A palette item's click: put it after the selected block (else at the end of the selected section's first column, else of the last). */
  const addHere = (make: (l: Layout) => Block, label: string) => {
    if (readOnly) return;
    const w = selected ? locate(layout, selected) : null;
    const s = w ? layout.sections[w.s] : layout.sections.at(-1)!;
    const col = w && w.kind !== "section" ? s.columns[w.c] : s.columns[0];
    const index = w && (w.kind === "block" || w.kind === "tcol") ? w.b + 1 : col.blocks.length;
    const r = insertBlock(layout, make(layout), col.id, index);
    act(r.layout, tr("{name} added at {where}", { name: label, where: where(r.layout, r.id) }), r.id);
  };

  const problemsHere = [...(checked ?? []), ...refused];
  const title = def.label || def.key;

  if (narrow)
    return (
      <div className="stack">
        <Head def={def} />
        <StatePanel kind="empty" title={tr("Use a wider screen to design a print format")} action={<Link className="btn" to={formatsLink(def.entity)}>{tr("Back to the print formats")}</Link>}>
          {tr("The designer needs a screen at least 1024 pixels wide. Here you can see how it prints.")}
        </StatePanel>
        <NarrowPreview def={def} />
      </div>
    );

  return (
    <div className="stack" onKeyDown={onKey}>
      <Head
        def={def}
        actions={
          <>
            <SaveStatus state={state === "saved" && dirty ? "draft" : state} at={state === "saved" ? savedAt : null} />
            {read && <Button onClick={() => setVersions(true)}><HistoryIcon size={16} aria-hidden="true" />{tr("Versions")}</Button>}
            {!readOnly && <Button onClick={() => setSaveAs(true)}>{tr("Save as…")}</Button>}
            {<Button variant="primary" loading={state === "saving"} disabled={state === "saving" || !dirty} onClick={() => void save()}>{tr("Save")}</Button>}
          </>
        }
      />
      {readOnly && (
        <Alert tone="info" action={<Button variant="primary" onClick={() => setSaveAs(true)}>{tr("Customize this format")}</Button>}>
          {tr("This is the package's format: its layout cannot be changed here, so a new release can still improve it. Its paper, letter head, copies, who may use it and whether it can be printed can (Page). Customize it to design your own copy.")}
        </Alert>
      )}
      {problemsHere.length > 0 && (
        <Alert tone="error">
          <strong>{checked ? tr("Fix these before saving") : tr("The server did not save the format")}</strong>
          <ul>
            {problemsHere.map((p, i) => (
              <li key={i}>
                {isolate(p.message)}
                {p.id && locate(layout, p.id) && <> <Button size="sm" variant="ghost" onClick={() => (setSelected(p.id), setTab("selected"))}>{tr("Show it")}</Button></>}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="pd-toolbar">
        <Toolbar label={tr("Designer tools")}>
          <ToolbarGroup id="history" keep>
            <ToolbarButton label={tr("Undo")} shortcut="Mod-z" icon={<Undo2 />} disabled={!hist.past.length || readOnly} onPress={doUndo} />
            <ToolbarButton label={tr("Redo")} shortcut="Mod-Shift-z" icon={<Redo2 />} disabled={!hist.future.length || readOnly} onPress={doRedo} />
          </ToolbarGroup>
        </Toolbar>
        <label className="sr-only" htmlFor={`${ids}-zoom`}>{tr("Zoom")}</label>
        <select id={`${ids}-zoom`} className="select" style={{ width: "auto" }} value={zoom} onChange={(e) => setZoom(e.target.value as (typeof ZOOMS)[number])}>
          <option value="fit">{tr("Fit the width")}</option>
          {ZOOMS.slice(1).map((z) => <option key={z} value={z}>{Math.round(Number(z) * 100)}%</option>)}
        </select>
        <div style={{ flex: "1 1 220px", minWidth: 180, maxWidth: 320 }}>
          <LinkInput to={def.entity} value={record_} onChange={(id) => setRecord(id)} label={tr("Preview with record")} placeholder={tr("The sample record")} />
        </div>
        {latest && latest.id !== record_ && <Button onClick={() => setRecord(latest.id)}>{tr("Latest: {title}", { title: latest.title })}</Button>}
        {record_ && <Button variant="ghost" onClick={() => setRecord(null)}>{tr("Sample")}</Button>}
        <Button aria-pressed={showAll} onClick={() => setShowAll(!showAll)} title={tr("Parts whose condition is false for this record are thin dashed strips; shown, they are drawn at full size, dimmed.")}>
          {showAll ? tr("Hide hidden parts") : tr("Show hidden parts")}
        </Button>
        <label className="sr-only" htmlFor={`${ids}-lh`}>{tr("Letter head in the preview")}</label>
        <select id={`${ids}-lh`} className="select" style={{ width: "auto" }} value={letterhead} onChange={(e) => setLetterhead(e.target.value)}>
          <option value="none">{tr("No letter head")}</option>
          <option value="default">{tr("The record's company's letter head")}</option>
          {(lhs.data ?? []).map((l) => <option key={l.id} value={l.id}>{isolate(l.letter_head_name)}</option>)}
        </select>
        <label className="sr-only" htmlFor={`${ids}-lang`}>{tr("Language of the preview")}</label>
        <input id={`${ids}-lang`} className="input" style={{ width: 90 }} dir="ltr" placeholder={tr("Language")} value={language} onChange={(e) => setLanguage(e.target.value.trim())} />
        <Button icon="printer" onClick={testPrint}>{tr("Test print")}</Button>
      </div>

      <DndContext
        accessibility={{
          // The designer says where a block went itself (announce), in words, not by the drop target's id.
          announcements: {
            onDragStart: ({ active }) => tr("Picked up {name}", { name: (active.data.current as DragData | undefined)?.label ?? "" }),
            onDragOver: () => undefined,
            onDragEnd: () => undefined,
            onDragCancel: () => tr("Put back"),
          },
          screenReaderInstructions: { draggable: tr("Drag it onto the page with the mouse or a finger; with the keyboard, use the outline: Alt and the arrow keys move a block.") },
        }}
        sensors={sensors}
        collisionDetection={collide} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="pd">
          <aside className="pd-side" aria-label={tr("Fields and outline")}>
            <Side layout={layout} ghosts={ghosts} cat={cat.data} catLoading={cat.isLoading} catError={cat.error} selected={selected} onSelect={(id) => (setSelected(id), setTab("selected"))} onAdd={addHere} readOnly={readOnly} onKey={onKey} />
          </aside>
          <Canvas
            html={render.data?.content ?? drawn.current}
            loading={render.isFetching}
            error={render.isError ? render.error : null}
            page={def.page}
            zoom={zoom}
            layout={layout}
            selected={selected}
            onSelect={(id) => (setSelected(id), id && setTab("selected"))}
            dragging={!!dragging}
            readOnly={readOnly}
            cat={cat.data}
            onGhosts={setGhosts}
            onResize={(sec, i, delta) => {
              const next = resizeColumns(layout, sec, i, delta);
              if (next !== layout) act(next, tr("Columns of {name} are {widths}", { name: name(sec), widths: widthsOf(next.sections[locate(next, sec)!.s]).join(" : ") }));
            }}
            title={tr("{name}, as it prints", { name: title })}
          />
          <aside className="pd-props" aria-label={tr("Properties")}>
            <div className="pd-head" role="tablist" aria-label={tr("Properties")}>
              {(["selected", "page"] as const).map((t) => (
                <button key={t} type="button" role="tab" id={`${ids}-tab-${t}`} aria-selected={tab === t} aria-controls={`${ids}-panel`} className="tab" onClick={() => setTab(t)}>
                  {t === "selected" ? tr("Selected") : tr("Page")}
                </button>
              ))}
            </div>
            <div className="pd-scroll" role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`}>
              <fieldset disabled={readOnly && tab !== "page"} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <Properties
                  tab={tab}
                  def={def}
                  layout={layout}
                  selected={selected}
                  cat={cat.data}
                  problems={problemsHere.filter((p) => p.id === selected)}
                  ghost={!!selected && ghosts.has(selected)}
                  showingAll={showAll}
                  letterheads={lhs.data ?? []}
                  pkg={readOnly}
                  onDef={(d, group) => change(d, group)}
                  onLayout={(l, group) => setLayout(l, group)}
                  onSelect={setSelected}
                  onRemove={remove}
                  onMove={(next, said, sel) => act(next, said, sel)}
                  name={name}
                  where={where}
                />
              </fieldset>
            </div>
          </aside>
        </div>
        <DragOverlay dropAnimation={null}>{dragging && <div className="pd-drag">{isolate(dragging.label)}</div>}</DragOverlay>
      </DndContext>
      <p className="faint">{tr("Keys in the outline: ↑ ↓ choose · Alt+↑ ↓ move · Alt+← → to the column before or after · Alt+Shift+← to a new section above · Delete · Ctrl+D duplicates · Ctrl+Z undoes · Enter edits.")}</p>

      {conflict && (
        <Dialog
          open
          onClose={() => setConflict(false)}
          title={tr("Someone else changed this format")}
          description={tr("They saved it while you were designing. Load theirs (yours is lost), or save yours over theirs.")}
          footer={
            <>
              <Button onClick={() => void readFormat(def.key).then((r) => { setHist(startHistory(structuredClone(r.template))); setEtag(r.etag); setBase(JSON.stringify(toSave(r.template))); setState("saved"); setConflict(false); }, (e) => toast(errorMessage(e), "error"))}>{tr("Load theirs")}</Button>
              <Button variant="primary" onClick={() => void save(null)}>{tr("Save mine over theirs")}</Button>
            </>
          }
        >
          <p>{tr("Your changes stay here until you choose.")}</p>
        </Dialog>
      )}
      {saveAs && <SaveAs def={def} saved={!!read && (!dirty || readOnly)} readOnly={readOnly} onClose={() => setSaveAs(false)} onDone={(key) => { closing.current = true; setSaveAs(false); navigate(formatLink(key)); closing.current = false; }} />}
      {versions && read && <Versions formatKey={def.key} dirty={dirty} etag={etag} onClose={() => setVersions(false)} onRestored={(t, tag) => { setHist(startHistory(structuredClone(t))); setEtag(tag); setBase(JSON.stringify(toSave(t))); setState("saved"); setSavedAt(new Date().toISOString()); setVersions(false); }} />}
    </div>
  );
}

function useNarrow() {
  const q = "(max-width: 1023px)";
  const [n, setN] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setN(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return n;
}

function Head({ def, actions }: { def: PrintFormat; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <p className="crumbs">
          <Link to="/customize">{tr("Customize")}</Link> / <Link to={formatsLink(def.entity)}>{tr("Print formats")}</Link>
        </p>
        <h1 className="page-title">{isolate(def.label || def.key)}</h1>
        <p className="page-sub">
          <span className="mono">{isolate(def.key)}</span> · {tr("Layout")}
          {def.based_on ? ` · ${tr("Based on {key}", { key: def.based_on })}` : ""}
        </p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

function NarrowPreview({ def }: { def: PrintFormat }) {
  const q = useQuery({ queryKey: ["admin", "print", "narrow", def.key], queryFn: ({ signal }) => preview({ template: toSave(def), sample: true, mode: "print" }, signal), retry: false });
  return <PaperFrame title={tr("{name}, as it prints", { name: def.label || def.key })} html={q.data?.content} page={def.page} loading={q.isFetching} error={q.isError ? q.error : null} />;
}

// ── the canvas ──

function Canvas({ html, loading, error, page, zoom, layout, selected, onSelect, dragging, readOnly, cat, onResize, onGhosts, title }: {
  html: string | null; loading: boolean; error: unknown; page?: PrintFormat["page"]; zoom: (typeof ZOOMS)[number]; layout: Layout; selected: Id | null; onSelect: (id: Id | null) => void;
  dragging: boolean; readOnly: boolean; cat?: Catalogue; onResize: (section: Id, i: number, delta: number) => void; onGhosts: (ids: Set<Id>) => void; title: string;
}) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const frame = useRef<HTMLIFrameElement>(null);
  const [marks, setMarks] = useState<{ boxes: Box[]; slots: SlotBox[]; height: number }>({ boxes: [], slots: [], height: 0 });
  const mm = paperMm(page);
  const pw = mm.width * MM_PX;
  const ph = mm.height * MM_PX;
  const scale = zoom === "fit" ? (width ? Math.max(0.3, Math.min(1.5, (width - 48) / pw)) : 0) : Number(zoom);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // The render's marks, read once it has loaded (same origin, no script runs in it): every data-b box and data-slot place.
  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    const height = Math.max(ph, doc.documentElement.scrollHeight);
    if (frame.current) frame.current.style.height = `${height}px`;
    const { boxes, slots, ghosts } = readMarks(doc, layoutRef.current);
    setMarks({ boxes, slots, height });
    onGhosts(ghosts);
  }, [ph]);
  useEffect(() => {
    const f = frame.current;
    const doc = f?.contentDocument;
    if (doc?.readyState === "complete") measure();
  }, [html, measure]);
  const srcDoc = useMemo(() => (html ? withPrintCsp(html) : undefined), [html]);
  const height = Math.max(ph, marks.height);
  const selWhere = selected ? locate(layout, selected) : null;
  const resizeSection = selWhere ? layout.sections[selWhere.s] : null;
  return (
    <div ref={wrap} className="pd-canvas" onClick={() => onSelect(null)}>
      {error ? (
        <div style={{ padding: 16 }}>
          <Alert tone="error">
            <strong>{tr("The page could not be drawn")}</strong>
            <div>{isolate(errorMessage(error))}</div>
            <div className="faint">{tr("You can keep editing; the page is drawn again after the next change.")}</div>
          </Alert>
        </div>
      ) : null}
      <div className="pd-canvas-inner">
        {scale > 0 && (
          <div className="pd-zoomed" style={{ width: pw * scale, height: height * scale }}>
            {/* Physical left/top on purpose: the overlay's boxes are measured in the frame's own pixels, whatever the page direction. */}
            <div className="pd-sheet" style={{ width: pw, height, transform: `scale(${scale})`, left: 0, top: 0 }}>
              {srcDoc ? (
                <iframe ref={frame} title={title} sandbox="allow-same-origin" srcDoc={srcDoc} onLoad={measure} style={{ height }} tabIndex={-1} />
              ) : (
                <PaperFrame title={title} page={page} />
              )}
              <div className="pd-overlay" aria-hidden="true">
                {marks.boxes.filter((b) => b.kind === "section").map((b) => <Hit key={b.id} box={b} selected={selected === b.id} onSelect={onSelect} />)}
                {marks.boxes.filter((b) => b.kind === "block").map((b) => <BlockHit key={b.id} box={b} layout={layout} cat={cat} selected={selected === b.id} onSelect={onSelect} readOnly={readOnly} />)}
                {marks.boxes.filter((b) => b.kind === "tcol").map((b) => <Hit key={b.id} box={b} selected={selected === b.id} onSelect={onSelect} />)}
                {marks.slots.map((s) => <Slot key={s.slot} s={s} active={dragging} empty={!layout.sections.some((x) => x.columns.some((c) => c.id === s.column && c.blocks.length))} />)}
                {!readOnly && !dragging && resizeSection && resizeSection.columns.length > 1 &&
                  resizeSection.columns.slice(0, -1).map((c, i) => {
                    const a = marks.boxes.find((b) => b.id === c.id);
                    const z = marks.boxes.find((b) => b.id === resizeSection.columns[i + 1].id);
                    const sec = marks.boxes.find((b) => b.id === resizeSection.id);
                    if (!a || !z || !sec) return null;
                    const units = widthsOf(resizeSection).reduce((x, y) => x + y, 0);
                    return <Resizer key={c.id} x={(a.x + a.w + z.x) / 2} y={sec.y} h={sec.h} unit={sec.w / units} scale={scale} onDone={(d) => onResize(resizeSection.id, i, d)} />;
                  })}
              </div>
            </div>
            {loading && (
              <div className="pf-busy" style={{ position: "absolute" }}>
                <span className="faint">{tr("Drawing…")}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Hit({ box, selected, onSelect }: { box: Box; selected: boolean; onSelect: (id: Id) => void }) {
  return <div className="pd-hit" data-kind={box.kind} data-ghost={box.ghost || undefined} data-selected={selected} style={{ left: box.x, top: box.y, width: box.w, height: box.h }} onClick={(e) => (e.stopPropagation(), onSelect(box.id))} />;
}

function BlockHit({ box, layout, cat, selected, onSelect, readOnly }: { box: Box; layout: Layout; cat?: Catalogue; selected: boolean; onSelect: (id: Id) => void; readOnly: boolean }) {
  const w = locate(layout, box.id);
  const label = w ? nodeName(nodeAt(layout, w), cat) : box.id;
  const d = useDraggable({ id: `block:${box.id}`, data: { from: "canvas", id: box.id, label } satisfies DragData, disabled: readOnly });
  return (
    <div ref={d.setNodeRef} {...d.listeners} {...d.attributes} tabIndex={-1} role={undefined} className="pd-hit" data-kind="block" data-ghost={box.ghost || undefined} data-selected={selected} data-dragging={d.isDragging} title={label} style={{ left: box.x, top: box.y, width: box.w, height: Math.max(box.h, 8), zIndex: 2 }} onClick={(e) => (e.stopPropagation(), onSelect(box.id))}>
      {selected && !readOnly && <span className="pd-handle"><GripVertical size={14} /></span>}
    </div>
  );
}

function Slot({ s, active, empty }: { s: SlotBox; active: boolean; empty: boolean }) {
  const d = useDroppable({ id: `slot:${s.slot}`, disabled: !active });
  // A place is a thin line between blocks: its target is taller than it looks, so it is easy to hit.
  const h = Math.max(s.h, empty ? 28 : 14);
  return <div ref={d.setNodeRef} className="pd-slot" data-active={active} data-over={d.isOver} data-empty={empty} style={{ left: s.x, top: s.y + s.h / 2 - h / 2, width: s.w, height: h, zIndex: 4, pointerEvents: active ? "auto" : "none" }} />;
}

/** The line between two columns: dragged sideways, the columns' widths change in twelfths. */
function Resizer({ x, y, h, unit, scale, onDone }: { x: number; y: number; h: number; unit: number; scale: number; onDone: (delta: number) => void }) {
  const [dx, setDx] = useState<number | null>(null);
  return (
    <div
      className="pd-resize"
      data-active={dx !== null}
      style={{ left: x + (dx ?? 0), top: y, height: h, zIndex: 5 }}
      title={tr("Drag to change the columns' widths")}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const move = (m: PointerEvent) => setDx((m.clientX - x0) / scale);
        const up = (u: PointerEvent) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          setDx(null);
          const d = Math.round((u.clientX - x0) / scale / unit);
          if (d) onDone(d);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}

// ── the palette and the outline ──

function Chip({ id, label, hint, make, onAdd, disabled }: { id: string; label: string; hint?: string; make: (l: Layout) => Block; onAdd: (make: (l: Layout) => Block, label: string) => void; disabled: boolean }) {
  const d = useDraggable({ id: `palette:${id}`, data: { from: "palette", label, make } satisfies DragData, disabled });
  return (
    <button ref={d.setNodeRef} {...d.listeners} {...d.attributes} type="button" className="pd-chip" disabled={disabled} aria-label={tr("Add {name}", { name: label })} title={tr("Drag onto the page, or press to add it after the selected block")} onClick={() => onAdd(make, label)}>
      <GripVertical size={14} className="grip" aria-hidden="true" />
      <span>{isolate(label)}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}

const BLOCK_TYPES: BlockType[] = ["heading", "text", "image", "table", "totals", "signature", "barcode", "copy_label", "divider", "spacer", "page_break"];

function Side({ layout, ghosts, cat, catLoading, catError, selected, onSelect, onAdd, readOnly, onKey }: {
  layout: Layout; ghosts: Set<Id>; cat?: Catalogue; catLoading: boolean; catError: unknown; selected: Id | null; onSelect: (id: Id) => void; onAdd: (make: (l: Layout) => Block, label: string) => void; readOnly: boolean; onKey: (e: ReactKeyboardEvent) => void;
}) {
  const ids = useId();
  const [tab, setTab] = useState<"fields" | "outline">("fields");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const field = (path: string, label: string, hint?: string, words?: boolean) =>
    match(label) || match(path) ? <Chip key={path + (words ? ":w" : "")} id={path + (words ? ":w" : "")} label={label} hint={hint} disabled={readOnly || !cat} make={(l) => blockFromCatalogue(path, cat!, l, words ? "words" : undefined)} onAdd={onAdd} /> : null;
  const group = (name: string, items: (React.ReactNode | null)[]) => (items.some(Boolean) ? <div key={name}><p className="pd-group">{name}</p><div className="pd-chips">{items}</div></div> : null);
  return (
    <>
      <div className="pd-head" role="tablist" aria-label={tr("Fields and outline")}>
        {(["fields", "outline"] as const).map((t) => (
          <button key={t} type="button" role="tab" id={`${ids}-t-${t}`} aria-selected={tab === t} aria-controls={`${ids}-p-${t}`} className="tab" onClick={() => setTab(t)}>{t === "fields" ? tr("Fields") : tr("Outline")}</button>
        ))}
      </div>
      {tab === "fields" ? (
        <div className="pd-scroll" role="tabpanel" id={`${ids}-p-fields`} aria-labelledby={`${ids}-t-fields`}>
          <input className="input" type="search" aria-label={tr("Find a field")} placeholder={tr("Find a field")} value={q} onChange={(e) => setQ(e.target.value)} />
          {catLoading ? <p className="faint">{tr("Loading the fields…")}</p> : catError ? <Alert tone="error">{isolate(errorMessage(catError))}</Alert> : cat ? (
            <>
              {group(tr("Fields"), [...cat.fields, ...cat.system].map((f) => field(f.path, f.label)))}
              {group(tr("Lines"), cat.tables.map((t) => field(t.path, t.label, tr("table"))))}
              {cat.links.length > 0 && (
                <div>
                  <p className="pd-group">{tr("Linked records")}</p>
                  {cat.links.map((l) => {
                    const items = l.fields.map((f) => field(f.path, f.label));
                    if (!items.some(Boolean)) return null;
                    const shown = open === l.path || !!q.trim();
                    return (
                      <div key={l.path}>
                        <button type="button" className="ref-item" aria-expanded={shown} onClick={() => setOpen(open === l.path ? null : l.path)}><span>{isolate(l.label)}</span><code>{shown ? "−" : "+"}</code></button>
                        {shown && <div className="pd-chips" style={{ paddingInlineStart: 12 }}>{items}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
              {group(tr("Company"), (cat.company ?? []).map((f) => field(f.path, f.label)))}
              {group(tr("Computed"), cat.computed.map((f) => field(f.path, f.label, undefined, f.format === "words")))}
              {group(tr("Print"), cat.print.map((f) => field(f.path, f.label)))}
            </>
          ) : null}
          <p className="pd-group">{tr("Blocks")}</p>
          <div className="pd-blocks">
            {BLOCK_TYPES.filter((t) => match(BLOCK_NAMES()[t])).map((t) => <Chip key={t} id={`type:${t}`} label={BLOCK_NAMES()[t]} disabled={readOnly} make={(l) => newBlock(t, l)} onAdd={onAdd} />)}
          </div>
        </div>
      ) : (
        <div className="pd-scroll" role="tabpanel" id={`${ids}-p-outline`} aria-labelledby={`${ids}-t-outline`}>
          <Outline layout={layout} ghosts={ghosts} cat={cat} selected={selected} onSelect={onSelect} onKey={onKey} />
        </div>
      )}
    </>
  );
}

function Outline({ layout, ghosts, cat, selected, onSelect, onKey }: { layout: Layout; ghosts: Set<Id>; cat?: Catalogue; selected: Id | null; onSelect: (id: Id) => void; onKey: (e: ReactKeyboardEvent) => void }) {
  const ids = useId();
  const tree = useRef<HTMLUListElement>(null);
  // The selection moves by keys (or a move re-renders the tree): focus follows it while it is in the tree.
  useEffect(() => {
    if (!tree.current?.contains(document.activeElement) || !selected) return;
    document.getElementById(`${ids}-${selected}`)?.focus();
  }, [selected, layout, ids]);
  // A part whose condition is false for the previewed record says so, and why (its condition).
  const extraOf = (id: Id, when?: string) => (ghosts.has(id) ? tr("hidden here") : when ? tr("when …") : undefined);
  const titleOf = (id: Id, when?: string) => (when ? (ghosts.has(id) ? tr("Hidden for this record: {condition} is false", { condition: when }) : tr("Prints when {condition}", { condition: when })) : undefined);
  const item = (id: Id, label: string, level: number, extra?: string, title?: string) => (
    <li key={id} role="none">
      <div role="treeitem" id={`${ids}-${id}`} aria-level={level} aria-selected={selected === id} tabIndex={selected === id || (!selected && id === layout.sections[0]?.id) ? 0 : -1} data-ghost={ghosts.has(id) || undefined} title={title} aria-description={title} style={{ paddingInlineStart: 6 + (level - 1) * 14 }} onClick={() => onSelect(id)} onFocus={() => selected !== id && onSelect(id)}>
        <span>{isolate(label)}</span>
        {extra && <span className="muted-id">{extra}</span>}
      </div>
    </li>
  );
  return (
    <ul ref={tree} role="tree" aria-label={tr("The layout, section by section")} className="pd-outline" onKeyDown={onKey}>
      {layout.sections.map((s, si) => [
        item(s.id, s.title || tr("Section {n}", { n: si + 1 }), 1, extraOf(s.id, s.when) ?? (s.columns.length > 1 ? tr("{n} columns", { n: s.columns.length }) : undefined), titleOf(s.id, s.when)),
        ...s.columns.flatMap((c, ci) => [
          ...(s.columns.length > 1 ? [item(c.id, tr("Column {n}", { n: ci + 1 }), 2)] : []),
          ...c.blocks.map((b) => item(b.id, nodeName(b, cat), s.columns.length > 1 ? 3 : 2, extraOf(b.id, b.when), titleOf(b.id, b.when))),
        ]),
      ])}
    </ul>
  );
}

// ── save as, versions ──

function SaveAs({ def, saved, readOnly, onClose, onDone }: { def: PrintFormat; saved: boolean; readOnly: boolean; onClose: () => void; onDone: (key: string) => void }) {
  const ids = useId();
  const [label, setLabel] = useState(tr("{name} (yours)", { name: def.label || def.key }));
  const [key, setKey] = useState<string | null>(null);
  const [makeDefault, setMakeDefault] = useState(readOnly);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const k = key ?? label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+|_+$/g, "").slice(0, 60);
  const go = async () => {
    if (!/^[a-z][a-z0-9_.]*$/.test(k)) return setProblem(tr("The key is lower case letters, digits, underscores and dots, starting with a letter."));
    setBusy(true);
    try {
      // Saved and unchanged: the server's duplicate is the copy (§13 e). Unsaved changes (or a format never saved) travel with
      // the copy: it is saved as it is on screen.
      if (saved) await api.post(`/api/admin/documents/templates/${encodeURIComponent(def.key)}/duplicate`, { key: k, label: label.trim() });
      else await saveFormat(toSave({ ...def, key: k, label: label.trim(), based_on: def.based_on ?? def.key, default: false }), null);
      if (makeDefault) await api.put(`/api/admin/documents/defaults/${encodeURIComponent(def.entity)}`, { key: k });
      toast(tr("{name} made", { name: label.trim() }));
      onDone(k);
    } catch (e) {
      setProblem(e instanceof ApiError && e.status === 409 ? tr("A format with this key already exists.") : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={readOnly ? tr("Customize {name}", { name: def.label || def.key }) : tr("Save as a new format")} footer={<><Button onClick={onClose} disabled={busy}>{tr("Cancel")}</Button><Button variant="primary" loading={busy} onClick={() => void go()}>{tr("Make the copy")}</Button></>}>
      <Field label={tr("Name of your copy")} htmlFor={`${ids}-l`} required>
        <input id={`${ids}-l`} data-autofocus className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label={tr("Key")} htmlFor={`${ids}-k`} error={problem ?? undefined}>
        <input id={`${ids}-k`} className="input mono" dir="ltr" value={k} onChange={(e) => (setKey(e.target.value), setProblem(null))} />
      </Field>
      <label className="check-field">
        <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
        {tr("Make it the default")}
      </label>
    </Dialog>
  );
}

function Versions({ formatKey, dirty, etag, onClose, onRestored }: { formatKey: string; dirty: boolean; etag: string | null; onClose: () => void; onRestored: (t: PrintFormat, etag: string | null) => void }) {
  const q = useQuery({ queryKey: ["admin", "print", "versions", formatKey], queryFn: ({ signal }) => api.get<{ versions: { n: number; saved_by?: string | null; saved_at: string }[] }>(`/api/admin/documents/templates/${encodeURIComponent(formatKey)}/versions`, undefined, signal), retry: false });
  const [busy, setBusy] = useState<number | null>(null);
  const restore = async (n: number) => {
    if (!(await confirmDialog({ title: tr("Restore version {n}?", { n }), message: dirty ? tr("It is saved as the newest version; your unsaved changes are lost.") : tr("It is saved as the newest version; the one now in use stays in the list."), confirmLabel: tr("Restore") }))) return;
    setBusy(n);
    try {
      const v = await api.get<{ template: PrintFormat }>(`/api/admin/documents/templates/${encodeURIComponent(formatKey)}/versions/${n}`);
      const tag = await saveFormat(toSave(v.template), etag);
      toast(tr("Version {n} restored", { n }));
      onRestored(v.template, tag);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open onClose={onClose} title={tr("Versions")} description={tr("Every save is kept (the last 50). Restoring one saves it again as the newest.")}>
      {q.isLoading ? (
        <p className="faint">{tr("Loading…")}</p>
      ) : q.error ? (
        <Alert tone="error">{q.error instanceof ApiError && q.error.status === 404 ? tr("This server keeps no versions yet.") : isolate(errorMessage(q.error))}</Alert>
      ) : !q.data?.versions.length ? (
        <p className="faint">{tr("No saved versions yet.")}</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {q.data.versions.map((v, i) => (
            <li key={v.n} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <strong>{tr("Version {n}", { n: v.n })}</strong>
                {i === 0 && <span className="faint"> · {tr("in use")}</span>}
                <div className="faint">{formatDateTime(v.saved_at)}{v.saved_by ? ` · ${v.saved_by}` : ""}</div>
              </span>
              {i > 0 && <Button size="sm" loading={busy === v.n} disabled={busy !== null} onClick={() => void restore(v.n)}>{tr("Restore")}</Button>}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

