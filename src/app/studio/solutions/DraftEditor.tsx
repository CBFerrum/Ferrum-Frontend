// A solution's draft (BUILDER_UX §4): one definition in three views, Guided, Diagram and Source, with its
// checks and a simulator. Saving sends the version the editor read: another person's save in between is
// refused, and this page offers to keep one's own work as a new draft instead of losing either (FLC-UI-006).
// Unsaved text is kept in this browser too, and offered back when the page opens on the same version.

import { ArrowLeft, Check, CircleAlert, FlaskConical, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import {
  compile,
  createDraft,
  deleteDraft,
  keepRelease,
  outline,
  parseSource,
  printSource,
  saveDraft,
  stepAt,
  useDraft,
  type Compiled,
  type Diagnostic,
  type Source,
} from "@/lib/solutions";
import { LoadingBlock, PageHeader } from "@/app/studio/dashboard/ui";
import { Alert, confirmDialog, ErrorState, TabPanel, Tabs, toast } from "@/ui/kit";
import { t as tr, isolate } from "@ferrum/client";
import { Diagram } from "./Diagram";
import { GuidedEditor, type Selection } from "./GuidedEditor";
import { SimulatorPanel } from "./SimulatorPanel";

const LOCAL = (id: string) => `ferrum.solution-draft.${id}`;

function readLocal(id: string): { base: number; text: string } | null {
  try {
    const v = localStorage.getItem(LOCAL(id));
    return v ? (JSON.parse(v) as { base: number; text: string }) : null;
  } catch {
    return null;
  }
}

function writeLocal(id: string, v: { base: number; text: string } | null) {
  try {
    if (v) localStorage.setItem(LOCAL(id), JSON.stringify(v));
    else localStorage.removeItem(LOCAL(id));
  } catch {
    // A private window or a full store: the server's copy is the one that counts.
  }
}

export function DraftEditor() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const q = useDraft(id);
  const [text, setText] = useState("");
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [checked, setChecked] = useState<Compiled | null>(null);
  const [tab, setTab] = useState("guided");
  const [panel, setPanel] = useState<"diagnostics" | "simulate">("diagnostics");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restorable, setRestorable] = useState<string | null>(null);
  const loaded = useRef(false);
  const saveRef = useRef<HTMLButtonElement>(null);
  const checkRef = useRef<HTMLButtonElement>(null);
  // A notice's buttons go with the notice: the keyboard goes on from Save when there is something to save, else Check.
  const toToolbar = () => requestAnimationFrame(() => (saveRef.current && !saveRef.current.disabled ? saveRef.current : checkRef.current)?.focus());

  // The server's draft, once: later answers do not overwrite what the person is typing.
  useEffect(() => {
    if (!q.data || loaded.current) return;
    loaded.current = true;
    setText(q.data.source);
    setVersion(q.data.version);
    const local = readLocal(id);
    if (local && local.text !== q.data.source) setRestorable(local.base === q.data.version ? local.text : null);
  }, [q.data, id]);

  // Unsaved work is kept here as it is typed, and a page left with it asks first.
  useEffect(() => {
    if (!loaded.current) return;
    writeLocal(id, dirty ? { base: version, text } : null);
  }, [id, dirty, text, version]);
  useEffect(() => {
    if (!dirty) return;
    const ask = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [dirty]);

  const parsed = useMemo(() => parseSource(text), [text]);
  const edit = (next: string) => {
    setText(next);
    setDirty(true);
    setChecked(null);
  };
  const editSource = (s: Source) => edit(printSource(s));

  const save = async () => {
    // The button turns off while it saves, and after: the keyboard goes on from Check (or back to Save when
    // the save is refused), never from the top of the page.
    const hadFocus = document.activeElement === saveRef.current;
    setBusy("save");
    try {
      const r = await saveDraft(id, version, text);
      setVersion(r.version);
      setDirty(false);
      setConflict(null);
      writeLocal(id, null);
      toast(tr("Saved"));
      // When and by whom it was last saved; the text on the page stays what was typed.
      void q.refetch();
      if (hadFocus) requestAnimationFrame(() => checkRef.current?.focus());
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(errorMessage(e));
      else toast(errorMessage(e), "error");
      if (hadFocus) requestAnimationFrame(() => saveRef.current?.focus());
    } finally {
      setBusy(null);
    }
  };
  const keepMineAsNew = async () => {
    try {
      const d = await createDraft(text);
      writeLocal(id, null);
      setDirty(false);
      navigate(`/studio/solutions/drafts/${d.id}`);
      loaded.current = false;
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const openLatest = async () => {
    if (dirty && !(await confirmDialog({ title: tr("Discard your changes?"), message: tr("The latest saved draft replaces what you have here."), confirmLabel: tr("Discard"), danger: true }))) return;
    const latest = await q.refetch();
    if (latest.data) {
      setText(latest.data.source);
      setVersion(latest.data.version);
      setDirty(false);
      setConflict(null);
      writeLocal(id, null);
      toToolbar();
    }
  };
  const check = async () => {
    if (busy) return;
    setBusy("check");
    setPanel("diagnostics");
    try {
      setChecked(await compile(text));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const keep = async () => {
    setBusy("keep");
    try {
      const r = await keepRelease(id, version);
      toast(tr("Kept as a release: someone else reviews it before it runs."));
      navigate(`/studio/solutions/releases/${r.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: tr("Delete this draft?"), message: tr("Releases kept from it stay."), confirmLabel: tr("Delete"), danger: true }))) return;
    try {
      await deleteDraft(id, version);
      writeLocal(id, null);
      navigate("/studio/solutions");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const goTo = (d: Diagnostic) => {
    if (!parsed.source) return setTab("source");
    const at = stepAt(parsed.source, d);
    const p = at && parsed.source.processes?.[at.process];
    const item = p && outline(p).find((o) => o.step.id === at.step);
    if (p && item) {
      setSelected({ process: p.id, path: item.path, step: at.step });
      setTab("guided");
      // The keyboard goes to the step's settings, where the fault is mended.
      requestAnimationFrame(() => document.getElementById("guided-inspector")?.focus());
    } else setTab("source");
  };

  if (q.isLoading) return <LoadingBlock className="p-4" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const faults = checked?.diagnostics.filter((d) => d.fault) ?? [];
  const status = !checked ? null : checked.ok ? <Badge variant="secondary">{tr("Checked: no faults")}</Badge> : <Badge variant="destructive">{tr("{n} faults", { n: faults.length })}</Badge>;
  return (
    <div className="mx-auto max-w-7xl p-4">
      <PageHeader
        eyebrow={
          <Link to="/studio/solutions" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" aria-hidden /> {tr("Solutions")}
          </Link>
        }
        title={isolate(parsed.source?.label || parsed.source?.id || tr("Untitled"))}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{tr("Draft, version {n}", { n: version })}</span>
            <span aria-live="polite">{dirty ? <Badge variant="outline">{tr("Unsaved changes")}</Badge> : <Badge variant="secondary">{tr("Saved")}</Badge>}</span>
            {status}
            {q.data?.updated_at && <span className="text-xs">{tr("last saved {when}", { when: relativeTime(q.data.updated_at) })}</span>}
          </span>
        }
        actions={
          <>
            <Button ref={saveRef} onClick={save} disabled={!dirty || busy !== null}>
              <Save aria-hidden /> {tr("Save")}
            </Button>
            {/* Kept enabled while it runs: a disabled button would throw keyboard focus back to the page. */}
            <Button ref={checkRef} variant="outline" onClick={check} aria-busy={busy === "check"}>
              <Check aria-hidden /> {tr("Check")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPanel("simulate");
              }}
            >
              <FlaskConical aria-hidden /> {tr("Simulate")}
            </Button>
            <Button variant="outline" onClick={keep} disabled={dirty || busy !== null} title={dirty ? tr("Save first: a release is kept from a saved draft.") : undefined}>
              <ShieldCheck aria-hidden /> {tr("Keep as release")}
            </Button>
            <Button variant="ghost" size="icon" onClick={remove} aria-label={tr("Delete this draft")}>
              <Trash2 aria-hidden />
            </Button>
          </>
        }
      />
      {restorable && (
        <Alert
          tone="info"
          action={
            <span className="flex gap-2">
              <Button size="sm" onClick={() => (edit(restorable), setRestorable(null), toToolbar())}>
                {tr("Restore")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (writeLocal(id, null), setRestorable(null), toToolbar())}>
                {tr("Discard")}
              </Button>
            </span>
          }
        >
          {tr("This browser kept changes you had not saved on this version.")}
        </Alert>
      )}
      {conflict && (
        <Alert
          tone="warning"
          action={
            <span className="flex flex-wrap gap-2">
              <Button size="sm" onClick={keepMineAsNew}>
                {tr("Keep mine as a new draft")}
              </Button>
              <Button size="sm" variant="outline" onClick={openLatest}>
                {tr("Open the latest")}
              </Button>
            </span>
          }
        >
          {conflict}
        </Alert>
      )}
      <Tabs
        id="draft"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "guided", label: tr("Guided") },
          { id: "diagram", label: tr("Diagram") },
          { id: "source", label: tr("Source") },
        ]}
      />
      <TabPanel id="draft" tab={tab}>
        {tab === "guided" &&
          (parsed.source ? (
            <GuidedEditor source={parsed.source} onChange={editSource} selected={selected} onSelect={setSelected} types={checked?.release?.types} />
          ) : (
            <Alert tone="error">
              {tr("The source is not valid JSON, so the guided view cannot show it: {error}", { error: parsed.error ?? "" })}
            </Alert>
          ))}
        {tab === "diagram" &&
          (parsed.source ? (
            <Diagram source={parsed.source} onChange={editSource} selected={selected} onSelect={setSelected} />
          ) : (
            <Alert tone="error">
              {tr("The source is not valid JSON, so the diagram cannot show it: {error}", { error: parsed.error ?? "" })}
            </Alert>
          ))}
        {tab === "source" && (
          <Textarea
            aria-label={tr("Source")}
            className="min-h-[32rem] font-mono text-xs"
            spellCheck={false}
            dir="ltr"
            value={text}
            onChange={(e) => edit(e.target.value)}
          />
        )}
      </TabPanel>
      <section className="mt-6 rounded-md border p-3" aria-label={panel === "simulate" ? tr("Simulation") : tr("Diagnostics")}>
        <Tabs
          id="draft-panel"
          value={panel}
          onChange={(v) => setPanel(v as "diagnostics" | "simulate")}
          tabs={[
            { id: "diagnostics", label: tr("Diagnostics") },
            { id: "simulate", label: tr("Simulation") },
          ]}
        />
        <TabPanel id="draft-panel" tab={panel}>
          {panel === "diagnostics" && <Diagnostics checked={checked} onGo={goTo} />}
          {panel === "simulate" && <SimulatorPanel source={text} parsed={parsed.source} />}
        </TabPanel>
      </section>
    </div>
  );
}

function Diagnostics({ checked, onGo }: { checked: Compiled | null; onGo: (d: Diagnostic) => void }) {
  if (!checked) return <p className="text-sm text-muted-foreground">{tr("Check the draft to see what the compiler says about it.")}</p>;
  if (checked.diagnostics.length === 0) return <p className="text-sm">{tr("No faults and nothing to note.")}</p>;
  return (
    <ul className="grid gap-2" aria-live="polite">
      {checked.diagnostics.map((d, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <CircleAlert className={d.fault ? "mt-0.5 size-4 text-destructive" : "mt-0.5 size-4 text-muted-foreground"} aria-hidden />
          <div className="min-w-0 flex-1">
            <button type="button" className="text-start underline-offset-2 hover:underline" onClick={() => onGo(d)}>
              {isolate(d.message)}
            </button>
            <div className="text-xs text-muted-foreground" dir="ltr">
              {d.code} · {d.pointer || "/"}
              {d.fault ? "" : ` · ${tr("note")}`}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
