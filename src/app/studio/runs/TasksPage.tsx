// People's work (BUILDER_UX §7, §10): the tasks the person may decide, the cases they direct and, for an
// administrator, what needs recovering or looking at. A decision is bound to what was shown: if it changed,
// the server says so and the page offers to look again. A recovery resumes only where its process allows, or
// ends the run refused; there is no way to call it a success.

import { ArrowLeft, CheckCircle2, Download, Forward, Paperclip, RotateCcw, Search, Square, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  acknowledgeTask,
  attachEvidence,
  caseTaskDone,
  closeCase,
  decideTask,
  delegateTask,
  downloadEvidence,
  lookUpTask,
  recoverTask,
  useTask,
  useTasks,
  type FormField,
  type Lookup,
  type Task,
  type TaskEvent,
  type TaskKind,
} from "@/lib/solutions";
import { LoadingBlock, PageHeader } from "@/app/studio/dashboard/ui";
import { Alert, ErrorState, toast } from "@/ui/kit";
import { Field } from "@/app/studio/solutions/field";
import { useQueryClient } from "@tanstack/react-query";
import { t as tr, isolate } from "@ferrum/client";

const KIND: Record<TaskKind, string> = { task: "Decide", case: "Case", recovery: "Needs recovery", attention: "To look at" };

export function TasksPage() {
  const q = useTasks();
  return (
    <div className="mx-auto max-w-5xl p-4">
      <PageHeader
        title={tr("Tasks")}
        description={tr("What processes are waiting on you for.")}
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("Nothing waits on you.")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("Task")}</TableHead>
              <TableHead>{tr("Kind")}</TableHead>
              <TableHead>{tr("Due")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data!.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link className="font-medium underline-offset-2 hover:underline" to={`/studio/tasks/${t.id}`}>
                    {isolate(t.label)}
                  </Link>
                  {t.role && <div className="text-xs text-muted-foreground">{isolate(t.role)}</div>}
                </TableCell>
                <TableCell>
                  <Badge variant={t.kind === "recovery" ? "destructive" : "outline"}>{tr(KIND[t.kind])}</Badge>
                </TableCell>
                <TableCell>{t.deadline ? formatDateTime(t.deadline) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function TaskPage() {
  const { id = "" } = useParams();
  const q = useTask(id);
  // Deciding takes away the form that held focus: the keyboard goes on from the page, which now says the task is closed.
  const wasOpen = useRef<boolean | null>(null);
  const status = q.data?.status;
  useEffect(() => {
    if (!status) return;
    if (wasOpen.current && status !== "open") document.getElementById("main")?.focus();
    wasOpen.current = status === "open";
  }, [status]);
  if (q.isLoading) return <LoadingBlock className="p-4" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data!;
  return (
    <div className="mx-auto max-w-4xl p-4">
      <PageHeader
        eyebrow={
          <Link to="/studio/tasks" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" aria-hidden /> {tr("Tasks")}
          </Link>
        }
        title={isolate(t.label)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{tr(KIND[t.kind])}</Badge>
            <Badge variant={t.status === "open" ? "secondary" : "outline"}>{tr(t.status.replace(/_/g, " "))}</Badge>
            {t.deadline && (
              <span className="text-xs">
                {tr("due {when}", { when: formatDateTime(t.deadline) })}
                {t.deadline_basis?.calendar && ` · ${tr("{calendar} calendar, revision {n}", { calendar: t.deadline_basis.calendar, n: t.deadline_basis.revision ?? 0 })}`}
              </span>
            )}
            <Link className="text-xs underline-offset-2 hover:underline" to={`/studio/runs/${t.run}`}>
              {tr("Its run")}
            </Link>
          </span>
        }
      />
      {t.status !== "open" ? (
        <Alert tone="info">{tr("This is closed: {status}.", { status: tr(t.status.replace(/_/g, " ")) })}</Alert>
      ) : t.kind === "task" ? (
        <Decide task={t} onDone={() => q.refetch()} />
      ) : t.kind === "case" ? (
        <CaseWork task={t} onDone={() => q.refetch()} />
      ) : t.kind === "recovery" ? (
        <Recover task={t} onDone={() => q.refetch()} />
      ) : (
        <Acknowledge task={t} onDone={() => q.refetch()} />
      )}
      {(t.kind === "task" || t.kind === "case") && <Evidence task={t} onDone={() => q.refetch()} />}
      <History events={t.history ?? []} />
    </div>
  );
}

const DID: Record<TaskEvent["decision"], string> = {
  approve: "approved it",
  reject: "rejected it",
  delegate: "handed it to {to}",
  done: "did {part}",
  close: "closed the case",
  resume: "resumed the run",
  end: "ended the run refused",
  acknowledge: "acknowledged it",
};

/** Who did what on the task and why: what a closed task is read by. */
function History({ events }: { events: TaskEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="task-history" className="mt-6">
      <h2 id="task-history" className="mb-2 text-base font-semibold">
        {tr("What was done")}
      </h2>
      <ol className="grid gap-2 text-sm">
        {events.map((e, i) => (
          <li key={i} className="grid gap-0.5">
            <span>
              <span className="font-medium">{isolate(e.by)}</span> {tr(DID[e.decision] ?? e.decision, { to: isolate(e.to ?? ""), part: isolate(e.part) })}
              <span className="text-xs text-muted-foreground"> · {formatDateTime(e.at)}</span>
            </span>
            {e.reason && <span className="text-muted-foreground [overflow-wrap:anywhere]">{isolate(e.reason)}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Material({ value }: { value: unknown }) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return (
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground" dir="ltr">
              {k}
            </dt>
            <dd className="[overflow-wrap:anywhere]">{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "—")}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <pre className="overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

function FormInputs({ form, values, onChange }: { form: FormField[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  return (
    <div className="grid gap-3">
      {form.map((f) => (
        <Field key={f.name} label={f.label} required={f.required}>
          {f.type === "bool" ? (
            <input type="checkbox" checked={!!values[f.name]} onChange={(e) => onChange({ ...values, [f.name]: e.target.checked })} />
          ) : f.options?.length ? (
            <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={(values[f.name] as string) ?? ""} onChange={(e) => onChange({ ...values, [f.name]: e.target.value || undefined })}>
              <option value="">—</option>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <Input
              type={f.type === "date" ? "date" : "text"}
              inputMode={f.type === "int" || f.type === "decimal" ? "decimal" : undefined}
              value={(values[f.name] as string) ?? ""}
              onChange={(e) => onChange({ ...values, [f.name]: e.target.value === "" ? undefined : f.type === "int" ? Number(e.target.value) : e.target.value })}
            />
          )}
        </Field>
      ))}
    </div>
  );
}

function useAct(onDone: () => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const act = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setStale(null);
    try {
      await f();
      toast(done);
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "stale_approval") setStale(errorMessage(e));
      else toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return { busy, stale, act };
}

function Decide({ task, onDone }: { task: Task; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");
  const [to, setTo] = useState("");
  const { busy, stale, act } = useAct(onDone);
  return (
    <div className="grid gap-6">
      <section aria-labelledby="material-h">
        <h2 id="material-h" className="mb-2 text-base font-semibold">
          {tr("What you decide on")}
        </h2>
        <Material value={task.material} />
        {task.approvals > 1 && <p className="mt-2 text-xs text-muted-foreground">{tr("{n} different people must approve; one rejection rejects.", { n: task.approvals })}</p>}
      </section>
      {stale && (
        <Alert tone="warning" action={<Button size="sm" onClick={onDone}>{tr("Look again")}</Button>}>
          {stale}
        </Alert>
      )}
      {task.form.length > 0 && <FormInputs form={task.form} values={values} onChange={setValues} />}
      <Field label={tr("Reason")}>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => act(() => decideTask(task.id, { approve: true, digest: task.digest, values, reason }), tr("Approved"))}>
          <CheckCircle2 aria-hidden /> {tr("Approve")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => act(() => decideTask(task.id, { approve: false, digest: task.digest, values: {}, reason }), tr("Rejected"))}>
          <XCircle aria-hidden /> {tr("Reject")}
        </Button>
      </div>
      {(task.delegation ?? 0) > (task.handed_on ?? 0) && (
        <section aria-labelledby="delegate-h" className="rounded-md border p-3">
          <h2 id="delegate-h" className="mb-2 text-sm font-semibold">
            {tr("Hand it on")}
          </h2>
          <Field label={tr("To (their email)")} hint={tr("Someone holding the role, who has not had it before; never the requester.")}>
            <Input type="email" dir="ltr" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value.trim())} />
          </Field>
          <Button className="mt-2" size="sm" variant="outline" disabled={busy || !to} onClick={() => act(() => delegateTask(task.id, to, reason), tr("Handed on"))}>
            <Forward aria-hidden /> {tr("Hand it on")}
          </Button>
        </section>
      )}
    </div>
  );
}

function CaseWork({ task, onDone }: { task: Task; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const { busy, act } = useAct(onDone);
  const tasks = task.detail.tasks ?? [];
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{tr("Only these tasks belong to this case; each starts once what it needs is done. Other work needs a new reviewed definition.")}</p>
      {tasks.map((c) => (
        <section key={c.id} className="rounded-md border p-3" aria-label={c.label}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-medium">{isolate(c.label)}</span>
            {c.required && <Badge variant="outline">{tr("required")}</Badge>}
            {c.requires?.length ? <span className="text-xs text-muted-foreground">{tr("after {tasks}", { tasks: c.requires.join(", ") })}</span> : null}
          </div>
          {c.form?.length ? <FormInputs form={c.form} values={values[c.id] ?? {}} onChange={(v) => setValues({ ...values, [c.id]: v })} /> : null}
          <Button className="mt-2" size="sm" disabled={busy} onClick={() => act(() => caseTaskDone(task.id, c.id, values[c.id] ?? {}), tr("Done"))}>
            <CheckCircle2 aria-hidden /> {tr("Mark done")}
          </Button>
        </section>
      ))}
      <div>
        <Button variant="outline" disabled={busy} onClick={() => act(() => closeCase(task.id), tr("Closed"))}>
          <Square aria-hidden /> {tr("Close the case")}
        </Button>
      </div>
    </div>
  );
}

function Recover({ task, onDone }: { task: Task; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, act } = useAct(onDone);
  return (
    <div className="grid gap-4">
      <Alert tone="warning">{isolate(task.detail.reason ?? task.label)}</Alert>
      <p className="text-sm text-muted-foreground">{tr("Settle what happened first. A recovery says what was done, and resumes the run where its process allows or ends it refused: nothing marks it a success.")}</p>
      <LookUp task={task} onDone={onDone} />
      <Field label={tr("What was done about it")} required>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {!task.detail.resumable && (
        <p id="recover-why-not" className="text-sm text-muted-foreground">
          {tr("This step has nowhere to resume: it can only end.")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !reason.trim() || !task.detail.resumable}
          aria-describedby={!task.detail.resumable ? "recover-why-not" : undefined}
          onClick={() => act(() => recoverTask(task.id, true, reason), tr("Resumed"))}
        >
          <RotateCcw aria-hidden /> {tr("Resume")}
        </Button>
        <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => act(() => recoverTask(task.id, false, reason), tr("Ended"))}>
          <Square aria-hidden /> {tr("End it refused")}
        </Button>
      </div>
    </div>
  );
}

// Files given as evidence for this task's decision. They are added and read only by those who may decide this task,
// or administrators, and only through this task (FLC-HUMAN-006); a closed task's evidence stays as it was.
function Evidence({ task, onDone }: { task: Task; onDone: () => void }) {
  const { busy, act } = useAct(onDone);
  const files = task.evidence ?? [];
  const inputId = `evidence-${task.id}`;
  return (
    <section className="grid gap-2 rounded-md border p-3" aria-label={tr("Evidence")}>
      <span className="font-medium">{tr("Evidence")}</span>
      {files.length ? (
        <ul className="grid gap-1">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => act(() => downloadEvidence(task.id, f), tr("Downloaded"))}>
                <Download aria-hidden /> {isolate(f.file_name)}
              </Button>
              <span className="text-xs text-muted-foreground">
                {tr("{size} KB", { size: Math.max(1, Math.round(f.size / 1024)) })}
                {f.by ? ` · ${isolate(f.by)}` : ""} · {formatDateTime(f.at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{tr("No files yet. What is attached here is for this task alone.")}</p>
      )}
      {task.status === "open" && (
        <div>
          <input
            id={inputId}
            type="file"
            className="peer sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void act(() => attachEvidence(task.id, file), tr("Attached"));
            }}
          />
          <label
            htmlFor={inputId}
            className="inline-flex cursor-pointer items-center gap-2 rounded-sm text-sm underline-offset-2 hover:underline peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
          >
            <Paperclip aria-hidden /> {tr("Attach a file")}
          </label>
        </div>
      )}
    </section>
  );
}

// When a step's answer was lost after it may have run, its effect is looked up by its receipt, which every capability
// writes in the effect's own transaction. What was found is kept on the item, so it reads the same after a refresh
// or on another replica.
function LookUp({ task, onDone }: { task: Task; onDone: () => void }) {
  const { busy, act } = useAct(onDone);
  const found: Lookup | undefined = task.detail.lookup;
  return (
    <section className="grid gap-2 rounded-md border p-3" aria-label={tr("Was it done?")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{tr("Was it done?")}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => lookUpTask(task.id), tr("Looked up"))}>
          <Search aria-hidden /> {found ? tr("Look it up again") : tr("Look it up")}
        </Button>
      </div>
      {found ? (
        <ul className="grid gap-2" aria-live="polite">
          {found.effects.map((e) => (
            <li key={e.activation} className="text-sm">
              <Badge variant={e.on_record ? "outline" : "secondary"}>{e.on_record ? tr("On record") : tr("Not on record")}</Badge>{" "}
              <span className="font-medium">{isolate(e.activation)}</span>
              {e.capability ? <span className="text-muted-foreground"> · {isolate(e.capability)}</span> : null}
              {e.at ? <span className="text-muted-foreground"> · {formatDateTime(e.at)}</span> : null}
              <p className="text-muted-foreground">{tr(e.meaning)}</p>
            </li>
          ))}
          <li className="text-xs text-muted-foreground">{tr("Looked up {when}", { when: formatDateTime(found.at) })}</li>
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{tr("If a step's outcome came back unknown, this says whether it was done, by its receipt.")}</p>
      )}
    </section>
  );
}

function Acknowledge({ task, onDone }: { task: Task; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, act } = useAct(onDone);
  return (
    <div className="grid gap-4">
      <Alert tone="warning">{isolate(task.detail.why ?? task.label)}</Alert>
      {task.detail.evidence !== undefined && <Material value={task.detail.evidence} />}
      <Field label={tr("What was done about it")} required>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div>
        <Button disabled={busy || !reason.trim()} onClick={() => act(() => acknowledgeTask(task.id, reason), tr("Recorded"))}>
          <CheckCircle2 aria-hidden /> {tr("Record it")}
        </Button>
      </div>
    </div>
  );
}
