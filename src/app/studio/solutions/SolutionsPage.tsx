// Customer solutions (Ferrum's docs/logic/studio.md, BUILDER_UX §3): the drafts people are editing and the
// releases kept, each with whether it runs, waits for review or was rejected. A new solution starts from a
// template or empty. The server lists only what the person may author; a release is reviewed by someone else.

import { CalendarDays, FileCode2, ListChecks, Plus, Workflow } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { createDraft, printSource, useSolutions, type ReleaseRow, type Source } from "@/lib/solutions";
import { LoadingBlock, PageHeader } from "@/app/studio/dashboard/ui";
import { Alert, ErrorState, toast } from "@/ui/kit";
import { t as tr, isolate } from "@ferrum/client";

/** What a new solution starts as: empty, or an approval with a person's decision and its two ends. */
export function template(kind: "empty" | "approval"): Source {
  const base: Source = { schema_version: "ferrum.solution/1", kind: "Solution", id: "workspace.new_solution", version: "0.1.0", label: "New solution", requires: [] };
  if (kind === "empty") return { ...base, processes: [] };
  return {
    ...base,
    id: "workspace.approval",
    label: "Approval",
    processes: [
      {
        id: "approval",
        label: "Approval",
        trigger: { event: "", business_key: "trigger.id" },
        entry: "review",
        max_steps: 100,
        nodes: [
          { type: "human_task", id: "review", label: "Approve the request", role: "", material: "trigger", timeout: "P2D", next: "completed", on_reject: "refused", on_timeout: "attention" },
          { type: "end", id: "completed", label: "Completed", outcome: "completed" },
          { type: "end", id: "refused", label: "Refused", outcome: "refused" },
          { type: "suspend", id: "attention", label: "Needs attention", reason: "Something did not go as planned: look into it before anything more is done." },
        ],
      },
    ],
  };
}

/** Where a release stands, from its reviews and whether it runs. */
export function releaseState(r: ReleaseRow): { label: string; tone: "default" | "secondary" | "destructive" | "outline" } {
  if (r.active) return { label: tr("Running (generation {n})", { n: r.generation ?? 1 }), tone: "default" };
  if (r.reviews.some((v) => v.decision === "rejected")) return { label: tr("Rejected"), tone: "destructive" };
  if (r.reviews.some((v) => v.decision === "approved" && v.digest === r.artifact_digest)) return { label: tr("Approved"), tone: "secondary" };
  return { label: tr("Waiting for review"), tone: "outline" };
}

export function SolutionsPage() {
  const q = useSolutions();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const start = async (kind: "empty" | "approval") => {
    setBusy(true);
    try {
      const d = await createDraft(printSource(template(kind)));
      navigate(`/studio/solutions/drafts/${d.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const header = (
    <PageHeader
      title={tr("Solutions")}
      description={tr("The rules, decisions and processes your workspace runs: built and tested here, reviewed by someone else before they run.")}
      actions={
        <>
          <Button variant="outline" asChild>
            <Link to="/studio/tasks">
              <ListChecks aria-hidden /> {tr("Tasks")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/studio/runs">
              <Workflow aria-hidden /> {tr("Runs")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/studio/calendars">
              <CalendarDays aria-hidden /> {tr("Calendars")}
            </Link>
          </Button>
        </>
      }
    />
  );
  if (q.isLoading)
    return (
      <div className="mx-auto max-w-6xl p-4">
        {header}
        <LoadingBlock />
      </div>
    );
  if (q.error)
    return (
      <div className="mx-auto max-w-6xl p-4">
        {header}
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  const { drafts, releases, profile } = q.data!;
  return (
    <div className="mx-auto max-w-6xl p-4">
      {header}
      {profile === "core" && <Alert tone="warning">{tr("This installation runs rules and decisions only: a process needs the Full Process profile, so one is refused when checked.")}</Alert>}
      <section aria-labelledby="drafts-heading" className="mb-8">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="drafts-heading" className="flex-1 text-base font-semibold">
            {tr("Drafts")}
          </h2>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => start("empty")}>
            <FileCode2 aria-hidden /> {tr("Empty solution")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => start("approval")}>
            <Plus aria-hidden /> {tr("New approval")}
          </Button>
        </div>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("No drafts yet. Start from an approval, or an empty solution.")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("Solution")}</TableHead>
                <TableHead>{tr("Version")}</TableHead>
                <TableHead>{tr("Saved")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link className="font-medium underline-offset-2 hover:underline" to={`/studio/solutions/drafts/${d.id}`}>
                      {isolate(d.label || d.solution || tr("Untitled"))}
                    </Link>
                    <div className="text-xs text-muted-foreground">{isolate(d.solution)}</div>
                  </TableCell>
                  <TableCell>{tr("draft {n}", { n: d.version })}</TableCell>
                  <TableCell>{relativeTime(d.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section aria-labelledby="releases-heading">
        <h2 id="releases-heading" className="mb-2 text-base font-semibold">
          {tr("Releases")}
        </h2>
        {releases.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("No release is kept yet. A draft becomes a release when its author keeps it; an administrator reviews it.")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("Solution")}</TableHead>
                <TableHead>{tr("Version")}</TableHead>
                <TableHead>{tr("State")}</TableHead>
                <TableHead>{tr("Kept")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {releases.map((r) => {
                const s = releaseState(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link className="font-medium underline-offset-2 hover:underline" to={`/studio/solutions/releases/${r.id}`}>
                        {isolate(r.solution)}
                      </Link>
                    </TableCell>
                    <TableCell>{isolate(r.version)}</TableCell>
                    <TableCell>
                      <Badge variant={s.tone}>{s.label}</Badge>
                    </TableCell>
                    <TableCell>{relativeTime(r.created_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
