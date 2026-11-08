// Runs (BUILDER_UX §10): each process instance the person may see (an administrator all, anyone else those
// they started), kept up to date through the server's cursor, which never skips a change committed late. A
// run's page shows its state, what it waits on and how it ended, and lets whoever started it ask it to stop. An
// administrator can move a waiting run onto the release that runs now for its solution, by a mapping another
// administrator approves; the page keeps the record of each move planned, approved, made or refused.

import { ArrowLeft, ArrowRightLeft, Ban, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { formatDateTime, relativeTime } from "@/lib/format";
import { approveMove, cancelRun, FINISHED, planMove, useRun, useRuns, useSolutions, type ReleaseRow, type RunDetail, type RunStatus } from "@/lib/solutions";
import { useMe } from "@/lib/meta";
import { LoadingBlock, PageHeader } from "@/app/studio/dashboard/ui";
import { Alert, ErrorState, toast } from "@/ui/kit";
import { Field } from "@/app/studio/solutions/field";
import { t as tr, isolate } from "@ferrum/client";

export const STATUS_LABEL: Record<RunStatus, string> = {
  starting: "Starting",
  running: "Running",
  needs_attention: "Needs attention",
  cancelling: "Stopping",
  completed: "Completed",
  refused: "Refused",
  cancelled: "Cancelled",
};

export function statusBadge(s: RunStatus) {
  const variant = s === "needs_attention" || s === "refused" ? "destructive" : FINISHED.includes(s) ? "secondary" : "outline";
  return <Badge variant={variant}>{tr(STATUS_LABEL[s] ?? s)}</Badge>;
}

export function RunsPage() {
  const q = useRuns();
  const [show, setShow] = useState<"open" | "all">("open");
  const runs = useMemo(() => (q.data?.runs ?? []).filter((r) => show === "all" || !FINISHED.includes(r.status)), [q.data, show]);
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader
        title={tr("Runs")}
        description={tr("Processes running for your workspace, kept up to date as they move.")}
        actions={
          <select aria-label={tr("Show")} className="h-9 rounded-md border bg-transparent px-2 text-sm" value={show} onChange={(e) => setShow(e.target.value as "open" | "all")}>
            <option value="open">{tr("Not finished")}</option>
            <option value="all">{tr("All")}</option>
          </select>
        }
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{show === "open" ? tr("Nothing running now.") : tr("No runs yet.")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("Process")}</TableHead>
              <TableHead>{tr("About")}</TableHead>
              <TableHead>{tr("State")}</TableHead>
              <TableHead>{tr("Started")}</TableHead>
              <TableHead>{tr("Last change")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link className="font-medium underline-offset-2 hover:underline" to={`/studio/runs/${r.id}`}>
                    {isolate(r.process)}
                  </Link>
                  <div className="text-xs text-muted-foreground">{isolate(r.solution)}</div>
                </TableCell>
                <TableCell className="text-xs">{r.subject_entity ? `${isolate(r.subject_entity)} ${isolate(r.business_key ?? "")}` : isolate(r.business_key ?? "")}</TableCell>
                <TableCell>{statusBadge(r.status)}</TableCell>
                <TableCell>{relativeTime(r.accepted_at)}</TableCell>
                <TableCell>{relativeTime(r.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function RunPage() {
  const { id = "" } = useParams();
  const q = useRun(id);
  const me = useMe();
  const isAdmin = !!me.data?.user.is_admin;
  const solutions = useSolutions(isAdmin);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <LoadingBlock className="p-4" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data!;
  const active = solutions.data?.releases.find((x) => x.solution === r.solution && x.active);
  const stop = async () => {
    setBusy(true);
    try {
      await cancelRun(r.id, reason);
      toast(tr("Asked to stop: work already in hand still settles."));
      setReason("");
      await q.refetch();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl p-4">
      <PageHeader
        eyebrow={
          <Link to="/studio/runs" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" aria-hidden /> {tr("Runs")}
          </Link>
        }
        title={isolate(r.process)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {statusBadge(r.status)}
            <span className="text-xs">{tr("started {when}", { when: formatDateTime(r.accepted_at) })}</span>
            {r.finished_at && <span className="text-xs">{tr("finished {when}", { when: formatDateTime(r.finished_at) })}</span>}
            {r.release?.version && <span className="text-xs">{tr("under {version}", { version: r.release.version })}</span>}
          </span>
        }
      />
      <section aria-labelledby="run-tasks" className="mb-6">
        <h2 id="run-tasks" className="mb-2 text-base font-semibold">
          {tr("People's work")}
        </h2>
        {r.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("Nobody has been asked anything yet.")}</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {r.tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <Link className="underline-offset-2 hover:underline" to={`/studio/tasks/${t.id}`}>
                  {isolate(t.label)}
                </Link>
                <Badge variant="outline">{tr(t.status.replace(/_/g, " "))}</Badge>
                {t.deadline && <span className="text-xs text-muted-foreground">{tr("due {when}", { when: formatDateTime(t.deadline) })}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <WhatHappened state={r.state} attempts={r.attempts} />
      {r.output !== undefined && r.output !== null && (
        <section aria-labelledby="run-output" className="mb-6">
          <h2 id="run-output" className="mb-2 text-base font-semibold">
            {tr("What it handed back")}
          </h2>
          <pre className="overflow-auto rounded bg-muted p-2 text-xs" dir="ltr">
            {JSON.stringify(r.output, null, 2)}
          </pre>
        </section>
      )}
      <MovePanel run={r} active={active} meId={me.data?.user.id} isAdmin={isAdmin} onDone={() => q.refetch()} />
      {!FINISHED.includes(r.status) && r.status !== "cancelling" && (
        <section aria-labelledby="run-stop" className="rounded-md border p-3">
          <h2 id="run-stop" className="mb-2 text-base font-semibold">
            {tr("Stop it")}
          </h2>
          <Field label={tr("Why")} hint={tr("Work already in hand still settles, and what it did is kept; open tasks close.")}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button className="mt-2" variant="destructive" disabled={busy || !reason.trim()} onClick={stop}>
            <Ban aria-hidden /> {tr("Ask it to stop")}
          </Button>
        </section>
      )}
    </div>
  );
}

interface RunState {
  waiting?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  effects?: { activation: string; capability: string; compensated?: boolean; unwanted?: boolean }[];
}

/** Each step's outcome as the run recorded it, refusals and unknown outcomes first, and the effects it did:
 *  what an operator reads before recovering anything (BUILDER_UX §10). */
export function WhatHappened({ state, attempts }: { state: unknown; attempts?: RunDetail["attempts"] }) {
  const s = (state ?? {}) as RunState;
  const outputs = Object.entries(s.outputs ?? {});
  // Steps tried more than once, or whose last try did not finish: what an operator looks at first.
  const tries = Object.entries(attempts ?? {}).filter(([, a]) => a.attempts > 1 || a.last !== "done");
  if (outputs.length === 0 && !s.effects?.length && tries.length === 0) return null;
  const trouble = (v: unknown) => !!v && typeof v === "object" && ("error" in (v as object) || "unknown" in (v as object));
  const sorted = [...outputs.filter(([, v]) => trouble(v)), ...outputs.filter(([, v]) => !trouble(v))];
  return (
    <section aria-labelledby="run-happened" className="mb-6">
      <h2 id="run-happened" className="mb-2 text-base font-semibold">
        {tr("What happened")}
      </h2>
      <ul className="grid gap-1 text-sm">
        {sorted.map(([activation, v]) => {
          const o = (v ?? {}) as { error?: { code?: string; message?: string } | string; unknown?: string };
          const message = typeof o.error === "string" ? o.error : o.error ? `${o.error.code ?? ""}: ${o.error.message ?? ""}` : o.unknown ? tr("outcome unknown: {why}", { why: o.unknown }) : null;
          return (
            <li key={activation} className="grid gap-1 sm:grid-cols-[14rem_1fr]">
              <span className="font-medium" dir="ltr">
                {activation}
              </span>
              {message ? (
                <span className="text-destructive">{isolate(message)}</span>
              ) : (
                <span className="truncate text-xs text-muted-foreground" dir="ltr">
                  {JSON.stringify(v)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {tries.length > 0 && (
        <>
          <h3 className="mt-3 mb-1 text-sm font-semibold">{tr("How often steps were tried")}</h3>
          <ul className="grid gap-1 text-sm">
            {tries.map(([activation, a]) => (
              <li key={activation} className="grid gap-1 sm:grid-cols-[14rem_1fr]">
                <span className="font-medium" dir="ltr">
                  {activation}
                </span>
                <span>
                  {tr("tried {n} times", { n: a.attempts })} · <span className="[overflow-wrap:anywhere]">{a.last === "done" ? tr("last: done") : isolate(a.last)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!!s.effects?.length && (
        <>
          <h3 className="mt-3 mb-1 text-sm font-semibold">{tr("What it did")}</h3>
          <ul className="grid gap-1 text-sm">
            {s.effects.map((e) => (
              <li key={e.activation} className="flex flex-wrap items-center gap-2">
                <span dir="ltr">{e.activation}</span>
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {e.capability}
                </span>
                {e.compensated && <Badge variant="secondary">{tr("undone")}</Badge>}
                {e.unwanted && <Badge variant="destructive">{tr("settled after it was no longer wanted")}</Badge>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Moving a waiting run onto the release that runs now (administrators): a mapping of each step it waits at,
 *  checked and planned by one administrator, approved by another; and the record of every move. */
export function MovePanel({ run, active, meId, isAdmin, onDone }: { run: RunDetail; active?: ReleaseRow; meId?: string; isAdmin: boolean; onDone: () => unknown }) {
  const waiting = Object.keys(((run.state ?? {}) as RunState).waiting ?? {});
  const [map, setMap] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const moves = run.moves ?? [];
  const open = !FINISHED.includes(run.status) && run.status !== "cancelling";
  if (!isAdmin || (!moves.length && !open)) return null;
  // The newest plan nobody has approved yet, and whose it is.
  const settled = new Set(moves.filter((m) => m.action !== "plan_migration").map((m) => m.diff.digest ?? m.diff.to));
  const pending = [...moves].reverse().find((m) => m.action === "plan_migration" && !settled.has(m.diff.digest));
  const elsewhere = !!active && !!run.release && active.id !== run.release.id;
  const go = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setRefused(null);
    try {
      await f();
      toast(done);
      await onDone();
    } catch (e) {
      setRefused(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const said: Record<string, string> = {
    plan_migration: "Planned a move",
    approve_migration: "Approved the move",
    migrated: "Moved",
    migration_refused: "The move was refused",
  };
  return (
    <section aria-labelledby="run-move" className="mb-6 rounded-md border p-3">
      <h2 id="run-move" className="mb-2 text-base font-semibold">
        {tr("Move it to another release")}
      </h2>
      {open && pending ? (
        <div className="grid gap-2">
          <p className="text-sm">{tr("A move onto the release that runs now is planned. What moves:")}</p>
          <ul className="list-disc ps-5 text-sm">
            {(pending.diff.moved ?? []).map((m, i) => (
              <li key={i} dir="ltr">
                {m}
              </li>
            ))}
          </ul>
          {pending.by === meId ? (
            <p className="text-sm text-muted-foreground">{tr("You planned it: another administrator approves it.")}</p>
          ) : (
            <>
              <Field label={tr("Why it may move")}>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div>
                <Button disabled={busy} onClick={() => go(() => approveMove(run.id, pending.diff.digest ?? "", reason), tr("Approved: the run moves when its runtime takes it up"))}>
                  <CheckCircle2 aria-hidden /> {tr("Approve the move")}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : open && elsewhere && waiting.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm">
            {tr("It runs under {from}; {to} runs now. Say which step of {to} each step it waits at becomes; a step becomes one that waits the same way.", {
              from: run.release?.version ?? "",
              to: active!.version,
            })}
          </p>
          {waiting.map((step) => (
            <Field key={step} label={tr("{step} becomes", { step })}>
              <Input dir="ltr" value={map[step] ?? step} onChange={(e) => setMap({ ...map, [step]: e.target.value.trim() })} />
            </Field>
          ))}
          <div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => go(() => planMove(run.id, active!.id, Object.fromEntries(Object.entries(map).filter(([k, v]) => v && v !== k))), tr("Planned: another administrator approves it"))}
            >
              <ArrowRightLeft aria-hidden /> {tr("Check and plan the move")}
            </Button>
          </div>
        </div>
      ) : open ? (
        <p className="text-sm text-muted-foreground">{tr("It runs under the release that runs now: there is nothing to move it to.")}</p>
      ) : null}
      {refused && (
        <div className="mt-2">
          <Alert tone="warning">{refused}</Alert>
        </div>
      )}
      {moves.length > 0 && (
        <ul className="mt-3 grid gap-1 text-sm">
          {moves.map((m, i) => (
            <li key={i}>
              {tr(said[m.action] ?? m.action)} · {formatDateTime(m.at)}
              {m.action === "migration_refused" && m.diff.why && <span className="text-muted-foreground"> · {isolate(m.diff.why.join("; "))}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
