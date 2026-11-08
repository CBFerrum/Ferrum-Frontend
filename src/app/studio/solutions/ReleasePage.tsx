// A release and its review (BUILDER_UX §9): what it is, what runs now for its solution, what changed between
// them by meaning, and the changing capabilities it may use that what runs now cannot, which the reviewer
// consents to one by one. Approval is bound to the exact digest shown; nobody approves their own release, and
// this page does not offer it to them. An approved release is activated against the generation seen running,
// and the page says what that replaced and what stays as it was. Before that, the release can be compared with
// what runs now on recent work, replayed without running anything; and it can leave as a pack for another
// workspace, where it arrives as a draft.

import { ArrowLeft, CheckCircle2, Download, Play, Square, XCircle, Scale } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useMe } from "@/lib/meta";
import {
  activateRelease,
  deactivateSolution,
  releasePack,
  reviewRelease,
  shadowRelease,
  useReleaseReview,
  type Activated,
  type Change,
  type Shadow,
  type ShadowSide,
} from "@/lib/solutions";
import { LoadingBlock, PageHeader } from "@/app/studio/dashboard/ui";
import { Alert, ErrorState, toast } from "@/ui/kit";
import { Field } from "./field";
import { useQueryClient } from "@tanstack/react-query";
import { t as tr, isolate } from "@ferrum/client";

const AREA_LABEL: Record<Change["area"], string> = {
  parameter: "Parameter",
  rule: "Rule",
  decision: "Decision table",
  decision_row: "Decision row",
  process: "Process",
  step: "Step",
  capability: "Capability",
};
const KIND_LABEL: Record<Change["kind"], string> = { added: "added", removed: "removed", changed: "changed" };

export function ReleasePage() {
  const { id = "" } = useParams();
  const q = useReleaseReview(id);
  const me = useMe();
  const qc = useQueryClient();
  const [consent, setConsent] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [activated, setActivated] = useState<Activated | null>(null);
  const [shadow, setShadow] = useState<Shadow | null>(null);
  const [shadowError, setShadowError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock className="p-4" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data!;
  const r = v.release;
  const isAuthor = !!me.data && me.data.user.id === r.created_by;
  const isAdmin = !!me.data?.user.is_admin;
  const approved = v.reviews.some((x) => x.decision === "approved" && x.digest === r.artifact_digest);
  const rejected = v.reviews.some((x) => x.decision === "rejected");
  const decided = !!me.data && v.reviews.some((x) => x.by === me.data!.user.id);
  const running = v.active?.release === r.id;
  const growth = v.diff.privilege_growth;
  const allConsented = growth.every((g) => consent.has(g));
  const refresh = () => qc.invalidateQueries({ queryKey: ["solutions"] });
  const act = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await f();
      toast(done);
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const blocked = !isAdmin
    ? tr("Only an administrator reviews a release.")
    : isAuthor
      ? tr("You kept this release: someone else reviews it.")
      : decided
        ? tr("You have decided on this release already.")
        : null;
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader
        eyebrow={
          <Link to="/studio/solutions" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" aria-hidden /> {tr("Solutions")}
          </Link>
        }
        title={`${isolate(r.solution)} ${isolate(r.version)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {running ? <Badge>{tr("Running")}</Badge> : rejected ? <Badge variant="destructive">{tr("Rejected")}</Badge> : approved ? <Badge variant="secondary">{tr("Approved")}</Badge> : <Badge variant="outline">{tr("Waiting for review")}</Badge>}
            <span className="text-xs">{tr("kept {when}", { when: formatDateTime(r.created_at) })}</span>
            <span className="text-xs" dir="ltr">
              {r.artifact_digest.slice(0, 19)}…
            </span>
          </span>
        }
      />
      {v.active && !running && (
        <Alert tone="info">{tr("Version {version} runs now (generation {n}). The changes below are against it.", { version: v.active.version, n: v.active.generation })}</Alert>
      )}
      <section aria-labelledby="changes-h" className="mb-6">
        <h2 id="changes-h" className="mb-2 text-base font-semibold">
          {tr("What changed")}
        </h2>
        {v.diff.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("Nothing: this release means the same as what runs now.")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("What")}</TableHead>
                <TableHead>{tr("Which")}</TableHead>
                <TableHead>{tr("How")}</TableHead>
                <TableHead>{tr("Settings")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {v.diff.changes.map((c, i) => (
                <TableRow key={i}>
                  <TableCell>{tr(AREA_LABEL[c.area])}</TableCell>
                  <TableCell dir="ltr">{c.id}</TableCell>
                  <TableCell>
                    <Badge variant={c.kind === "removed" ? "destructive" : c.kind === "added" ? "secondary" : "outline"}>{tr(KIND_LABEL[c.kind])}</Badge>
                    {c.changes_records && <Badge variant="outline">{tr("changes records")}</Badge>}
                  </TableCell>
                  <TableCell dir="ltr" className="text-xs">
                    {c.values && Object.keys(c.values).length > 0 ? (
                      <dl className="grid gap-1">
                        {Object.entries(c.values).map(([field, [was, now]]) => (
                          <div key={field} className="grid gap-0.5">
                            <dt className="font-medium">{field}</dt>
                            <dd className="[overflow-wrap:anywhere]">
                              <span className="sr-only">{tr("was")}: </span>
                              <del className="text-muted-foreground">{shownValue(was)}</del> <span aria-hidden="true">→</span>{" "}
                              <span className="sr-only">{tr("now")}: </span>
                              <ins className="no-underline">{shownValue(now)}</ins>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      (c.fields ?? []).join(", ")
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section aria-labelledby="caps-h" className="mb-6">
        <h2 id="caps-h" className="mb-2 text-base font-semibold">
          {tr("What it may use")}
        </h2>
        <ul className="grid gap-1 text-sm">
          {r.lock.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2">
              <span dir="ltr">
                {l.id} {l.version}
              </span>
              <Badge variant="outline">{l.effect.replace(/_/g, " ")}</Badge>
              {l.compensation && <span className="text-xs text-muted-foreground">{tr("undone by {capability}", { capability: l.compensation })}</span>}
            </li>
          ))}
        </ul>
      </section>
      {!running && !rejected && (
        <section aria-labelledby="review-h" className="mb-6 rounded-md border p-3">
          <h2 id="review-h" className="mb-2 text-base font-semibold">
            {tr("Review")}
          </h2>
          {growth.length > 0 && (
            <fieldset className="mb-3 grid gap-1">
              <legend className="mb-1 text-sm">{tr("It may change records with these, which what runs now cannot. Consent to each:")}</legend>
              {growth.map((g) => (
                <label key={g} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={consent.has(g)}
                    onChange={(e) => {
                      const next = new Set(consent);
                      if (e.target.checked) next.add(g);
                      else next.delete(g);
                      setConsent(next);
                    }}
                  />
                  <span dir="ltr">{g}</span>
                </label>
              ))}
            </fieldset>
          )}
          <Field label={tr("Reason (needed to reject)")}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {blocked && <p className="mt-2 text-sm text-muted-foreground">{blocked}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={busy || !!blocked || approved || !allConsented}
              title={!allConsented ? tr("Consent to each new capability first.") : undefined}
              onClick={() => act(() => reviewRelease(r.id, { digest: r.artifact_digest, privileges: growth.filter((g) => consent.has(g)), approve: true, reason }), tr("Approved"))}
            >
              <CheckCircle2 aria-hidden /> {tr("Approve")}
            </Button>
            <Button variant="outline" disabled={busy || !!blocked || !reason.trim()} onClick={() => act(() => reviewRelease(r.id, { digest: r.artifact_digest, privileges: [], approve: false, reason }), tr("Rejected"))}>
              <XCircle aria-hidden /> {tr("Reject")}
            </Button>
          </div>
        </section>
      )}
      {!running && (
        <section aria-labelledby="shadow-h" className="mb-6">
          <h2 id="shadow-h" className="mb-2 text-base font-semibold">
            {tr("Compare with what runs now")}
          </h2>
          <p className="mb-2 text-sm text-muted-foreground">
            {tr("Recent work is replayed against this release and against what runs now, with the answers, decisions and events it met. Nothing is run, changed or kept.")}
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setShadowError(null);
              try {
                setShadow(await shadowRelease(r.id, 20));
              } catch (e) {
                setShadow(null);
                setShadowError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Scale aria-hidden /> {tr("Compare on recent work")}
          </Button>
          {shadowError && (
            <div className="mt-2">
              <Alert tone="info">{shadowError}</Alert>
            </div>
          )}
          {shadow && <ShadowResult shadow={shadow} />}
        </section>
      )}
      <section aria-labelledby="run-h" className="mb-6">
        <h2 id="run-h" className="mb-2 text-base font-semibold">
          {tr("Running it")}
        </h2>
        {running ? (
          <Button variant="outline" disabled={busy || !isAdmin} onClick={() => act(() => deactivateSolution(r.solution, v.active!.generation), tr("Stopped"))}>
            <Square aria-hidden /> {tr("Stop running it")}
          </Button>
        ) : (
          <Button disabled={busy || !isAdmin || !approved || rejected} title={!approved ? tr("It runs once approved.") : undefined} onClick={() => act(async () => setActivated(await activateRelease(r.id, v.active?.generation ?? null)), tr("It runs now for new work"))}>
            <Play aria-hidden /> {v.active ? tr("Run it instead of {version}", { version: v.active.version }) : tr("Run it")}
          </Button>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{tr("Runs already going keep the release they started on; their completed work is not undone.")}</p>
        {activated && <ActivationNote activated={activated} version={r.version} />}
      </section>
      <section aria-labelledby="pack-h" className="mb-6">
        <h2 id="pack-h" className="mb-2 text-base font-semibold">
          {tr("Take it elsewhere")}
        </h2>
        <p className="mb-2 text-sm text-muted-foreground">
          {tr("A pack carries its source, its digests, what it needs and the evidence of its review; never a connection or a credential. In another workspace it arrives as a draft.")}
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            try {
              const pack = await releasePack(r.id);
              const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `${r.solution}-${r.version}.solution-pack.json`;
              a.click();
              URL.revokeObjectURL(url);
            } catch (e) {
              toast(errorMessage(e), "error");
            }
          }}
        >
          <Download aria-hidden /> {tr("Download as a pack")}
        </Button>
      </section>
      {v.reviews.length > 0 && (
        <section aria-labelledby="reviews-h">
          <h2 id="reviews-h" className="mb-2 text-base font-semibold">
            {tr("Decisions")}
          </h2>
          <ul className="grid gap-1 text-sm">
            {v.reviews.map((x, i) => (
              <li key={i}>
                {x.decision === "approved" ? tr("Approved") : tr("Rejected")} · {formatDateTime(x.at)}
                {x.reason && <span className="text-muted-foreground"> · {isolate(x.reason)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A changed setting's value as a reviewer reads it: text as it is, anything else as compact JSON, absence as a dash. */
function shownValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}

const DIFFERENCE_LABEL: Record<string, string> = {
  outcome: "how it ends",
  decisions: "what it decides",
  steps: "the steps it takes",
  effects: "what it changes",
  "whether it acts": "whether it acts",
};

function outcomeOf(side: ShadowSide): string {
  const known: Record<string, string> = {
    completed: "completed",
    refused: "refused",
    cancelled: "cancelled",
    needs_attention: "needs attention",
    running: "still waiting",
    acted: "acted",
    "passed it by": "passed it by",
  };
  return known[side.outcome] ? tr(known[side.outcome]) : side.outcome;
}

/** What an activation changed, in the reader's words: the release it replaced, the runs that keep theirs, and
 *  that nothing done is undone. */
export function ActivationNote({ activated, version }: { activated: Activated; version: string }) {
  const open = activated.open_elsewhere;
  return (
    <div className="mt-3" role="status">
      <Alert tone="info">
        <span className="grid gap-1">
          <span>{tr("New runs start under {version} (generation {n}).", { version, n: activated.generation })}</span>
          {activated.replaced && <span>{tr("It replaced {version}.", { version: activated.replaced.version })}</span>}
          {activated.handed_over && <span>{tr("The automation {name} is off now: each of its events is this solution's to run.", { name: isolate(activated.handed_over.name) })}</span>}
          <span>
            {open === 0
              ? tr("No run started under another release is still open.")
              : open === 1
                ? tr("The one run still open under another release goes on under it.")
                : tr("The {n} runs still open under other releases go on under theirs.", { n: open })}
          </span>
          <span>{tr("Nothing a run did is undone: an effect that happened stays, for a person to decide about.")}</span>
        </span>
      </Alert>
    </div>
  );
}

/** A shadow comparison's cases, those that differ first; each says what differs and how both sides went. */
export function ShadowResult({ shadow }: { shadow: Shadow }) {
  const [all, setAll] = useState(false);
  const cases = all ? shadow.cases : shadow.cases.filter((c) => !c.same);
  const against =
    shadow.against.kind === "release"
      ? tr("Against {version}, which runs now.", { version: shadow.against.version })
      : tr("Against the automation {name}, before this takes over from it.", { name: isolate(shadow.against.name) });
  return (
    <div className="mt-3 grid gap-2">
      <p className="text-sm" role="status">
        {against} {tr("{n} cases compared; {m} differ.", { n: shadow.compared, m: shadow.differing })}
      </p>
      <p className="text-xs text-muted-foreground">{tr("Nothing was run, changed or kept: both sides were simulated on what happened, with the answers, decisions and events met then.")}</p>
      {shadow.compared > shadow.differing && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {tr("Show the cases that come out the same")}
        </label>
      )}
      {cases.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("Case")}</TableHead>
              <TableHead>{tr("When")}</TableHead>
              <TableHead>{tr("What differs")}</TableHead>
              <TableHead>{tr("What runs now")}</TableHead>
              <TableHead>{tr("This release")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.map((c, i) => (
              <TableRow key={c.run ?? c.event ?? i}>
                <TableCell>
                  {c.run ? (
                    <Link className="underline-offset-2 hover:underline" to={`/studio/runs/${c.run}`}>
                      {tr("Run {id}", { id: c.run.slice(-8) })}
                    </Link>
                  ) : (
                    tr("Event {id}", { id: String(c.event ?? "") })
                  )}
                </TableCell>
                <TableCell>{formatDateTime(c.at)}</TableCell>
                <TableCell>{c.same ? tr("nothing") : c.differences.map((d) => tr(DIFFERENCE_LABEL[d] ?? d)).join(", ")}</TableCell>
                <TableCell>
                  {outcomeOf(c.now)} · {tr("{n} changes", { n: c.now.effects.length })}
                </TableCell>
                <TableCell>
                  {outcomeOf(c.candidate)} · {tr("{n} changes", { n: c.candidate.effects.length })}
                  {c.candidate.not_modelled.length > 0 && <span className="block text-xs text-muted-foreground">{tr("{n} steps with no answer on record", { n: c.candidate.not_modelled.length })}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
