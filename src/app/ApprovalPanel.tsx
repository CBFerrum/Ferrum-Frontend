// The approval a record is waiting on or has had (BD-19): what was asked and by whom, each step with its state, who
// may decide and who has, and the buttons for whoever may decide (approve, reject with a reason) or recall it.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { t, isolate } from "@ferrum/client";
import { api, docPath, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { ApprovalRequest, Me } from "../lib/meta";
import { placed } from "../lib/placed";
import { Alert, Badge, Button, ErrorState, Field, PageLoading, type Tone } from "../ui/kit";
import { useLinkTitle } from "./widgets";

/** One request's worth of approvals: `GET /api/approvals`, what the person has to decide and what they are waiting on. */
export interface ApprovalItem {
  request: string;
  entity: string;
  entity_label: string;
  record: string;
  title: string;
  action: string;
  from: string;
  requester: string;
  requester_name?: string | null;
  requested_at: string;
  /** The open step awaiting the person (`to_decide`) or the first open one (`awaiting_others`). */
  step?: { index: number; label?: string | null; opened_at?: string | null } | null;
}
export interface MyApprovals {
  to_decide: ApprovalItem[];
  awaiting_others: ApprovalItem[];
}

/** The record's latest request (or null); asked only when its workflow has a policy. */
export function useApproval(entity: string, id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["approval", entity, id],
    queryFn: ({ signal }) => api.get<ApprovalRequest | null>(docPath(entity, id ?? "", "approval"), undefined, signal),
    enabled: enabled && !!id,
  });
}

export const useMyApprovals = (enabled = true) =>
  useQuery({ queryKey: ["approvals"], queryFn: ({ signal }) => api.get<MyApprovals>("/api/approvals", undefined, signal), enabled });

/** A person by their user id, as a name. */
export function Who({ id }: { id: string }) {
  const name = useLinkTitle("User", id);
  return <>{isolate(name ?? "…")}</>;
}

const People = ({ ids }: { ids: string[] }) => (
  <>
    {ids.map((id, i) => (
      <span key={id}>
        {i > 0 && ", "}
        <Who id={id} />
      </span>
    ))}
  </>
);

const STATUS: Record<ApprovalRequest["status"], { tone: Tone; get label(): string }> = {
  pending: { tone: "amber", get label() { return t("Waiting for approval"); } },
  approved: { tone: "green", get label() { return t("Approved"); } },
  rejected: { tone: "red", get label() { return t("Rejected"); } },
  recalled: { tone: "neutral", get label() { return t("Recalled"); } },
  cancelled: { tone: "neutral", get label() { return t("Cancelled"); } },
  failed: { tone: "red", get label() { return t("Not done"); } },
};
const STEP: Record<ApprovalRequest["steps"][number]["state"], { tone: Tone; get label(): string }> = {
  waiting: { tone: "neutral", get label() { return t("Not yet"); } },
  open: { tone: "amber", get label() { return t("Waiting"); } },
  skipped: { tone: "neutral", get label() { return t("Skipped"); } },
  approved: { tone: "green", get label() { return t("Approved"); } },
  rejected: { tone: "red", get label() { return t("Rejected"); } },
};

export function Decide({ request, onChanged }: { request: ApprovalRequest; onChanged: () => void }) {
  const [comment, setComment] = useState("");
  const [needReason, setNeedReason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (outcome: "approve" | "reject") => api.post(docPath(request.entity, request.record, "approval/decide"), { outcome, comment: comment.trim() || undefined }),
    onSuccess: onChanged,
    onError: (e) => setError(errorMessage(e)),
  });
  const go = (outcome: "approve" | "reject") => {
    setError(null);
    if (outcome === "reject" && !comment.trim()) return setNeedReason(true);
    setNeedReason(false);
    decide.mutate(outcome);
  };
  return (
    <div className="stack">
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      <Field label={t("Comment")} htmlFor="approval-comment" error={needReason ? t("Say why when you reject") : undefined}>
        <textarea id="approval-comment" className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div className="row">
        <Button variant="primary" loading={decide.isPending && decide.variables === "approve"} disabled={decide.isPending} onClick={() => go("approve")}>
          {t("Approve")}
        </Button>
        <Button variant="danger" loading={decide.isPending && decide.variables === "reject"} disabled={decide.isPending} onClick={() => go("reject")}>
          {t("Reject")}
        </Button>
      </div>
    </div>
  );
}

/** The request's steps: each with its state, who may decide and who has (the trail), reminders and escalations. */
export function Steps({ request }: { request: ApprovalRequest }) {
  const decisions = request.decisions.filter((d) => !d.void);
  return (
    <ol className="stack" aria-label={t("Steps")}>
        {request.steps.map((s, n) => {
          const made = decisions.filter((d) => d.step === n);
          return (
            <li key={n} className="stack">
              <div className="row" style={{ flexWrap: "wrap" }}>
                <strong>{isolate(s.label || t("Step {n}", { n: n + 1 }))}</strong>
                <Badge tone={STEP[s.state].tone}>{STEP[s.state].label}</Badge>
                {s.state !== "skipped" && (
                  <span className="muted">{t("needs {need} of", { need: s.need === "any" ? 1 : s.need === "all" ? t("all") : String(s.need) })} <People ids={s.approvers} /></span>
                )}
              </div>
              {made.map((d, i) => (
                <p key={i} className="muted">
                  {d.on_behalf_of ? placed(t("{person} for {other}"), { person: <Who id={d.decider} />, other: <Who id={d.on_behalf_of} /> }) : <Who id={d.decider} />}{" "}
                  {d.outcome === "approve" ? t("approved") : t("rejected")} <time dateTime={d.at}>{isolate(formatDateTime(d.at))}</time>
                  {d.comment ? <>: {isolate(d.comment)}</> : null}
                </p>
              ))}
              {!!s.escalated?.length && (
                <p className="muted">
                  {t("Escalated to")} <People ids={s.escalated} />
                </p>
              )}
              {s.reminded_at && (
                <p className="muted">
                  {t("Reminded")} <time dateTime={s.reminded_at}>{isolate(formatDateTime(s.reminded_at))}</time>
                </p>
              )}
              {s.escalated_at && (
                <p className="muted">
                  {t("Escalated")} <time dateTime={s.escalated_at}>{isolate(formatDateTime(s.escalated_at))}</time>
                </p>
              )}
              {s.state === "open" && s.remind_at && !s.reminded_at && <p className="faint">{t("Reminder due {at}", { at: formatDateTime(s.remind_at) })}</p>}
              {s.state === "open" && s.escalate_at && !s.escalated_at && !s.escalated?.length && <p className="faint">{t("Escalates {at}", { at: formatDateTime(s.escalate_at) })}</p>}
            </li>
          );
        })}
    </ol>
  );
}

export function ApprovalPanel({ entity, id, request, me, onChanged }: { entity: string; id: string; request: ApprovalRequest; me: Me; onChanged: () => void }) {
  const qc = useQueryClient();
  const mine = useMyApprovals(request.status === "pending");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["approval", entity, id] });
    void qc.invalidateQueries({ queryKey: ["approvals"] });
    void qc.invalidateQueries({ queryKey: ["work"] });
    onChanged();
  };
  const recall = useMutation({
    mutationFn: () => api.post(docPath(entity, id, "approval/recall")),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const pending = request.status === "pending";
  // Whether the person decides, themselves or for someone away, is the server's to say (`to_decide`).
  const mayDecide = pending && !!mine.data?.to_decide.some((i) => i.request === request.id);
  const mayRecall = pending && (request.requester === me.user.id || me.user.is_admin);
  const status = STATUS[request.status];
  const decisions = request.decisions.filter((d) => !d.void);
  const voided = request.decisions.length - decisions.length;
  return (
    <section className="card approval-panel stack" aria-labelledby="approval-title">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2 id="approval-title" className="h3">
          {t("Approval of “{action}”", { action: request.action })}
        </h2>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="muted">
        {placed(t("Asked by {person} on {at}: {from} to {to}."), { person: <Who id={request.requester} />, at: isolate(formatDateTime(request.requested_at)), from: isolate(request.from), to: isolate(request.to) })}
      </p>
      {request.status === "failed" && (
        <Alert tone="error">
          {t("Everyone agreed, but it could not be done: {reason}", { reason: isolate(request.failure || t("no reason was given")) })}{" "}
          {request.requester === me.user.id
            ? request.document
              ? t("Fix what it names and press {action} on the record again to ask again.", { action: request.action })
              : t("Fix what it names and take “{action}” again to ask again.", { action: request.action })
            : t("The person who asked can ask again.")}
        </Alert>
      )}
      {voided > 0 && <p className="muted">{t("{voided} earlier decision(s) were cancelled when a field that matters changed, and the steps opened again.", { voided })}</p>}
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      <Steps request={request} />
      {pending && mine.isLoading && <PageLoading />}
      {pending && mine.error && <ErrorState error={mine.error} onRetry={() => mine.refetch()} />}
      {mayDecide && <Decide request={request} onChanged={refresh} />}
      {mayRecall && (
        <div className="row">
          <Button loading={recall.isPending} disabled={recall.isPending} onClick={() => recall.mutate()}>
            {t("Recall this request")}
          </Button>
        </div>
      )}
    </section>
  );
}
