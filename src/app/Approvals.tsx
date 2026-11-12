// Mine to decide (BD-19): the approval requests waiting for the person, and their own still waiting for others.
// Each opens its record: the list carries a title and the action, not the record's amounts, so the decision is
// made on the record's page.

import { t, isolate } from "@ferrum/client";
import { formatDateTime, relativeTime } from "../lib/format";
import { useRecordsBase } from "../lib/recordsBase";
import { LoadFailed, ListSkeleton } from "../ui/patterns";
import { Queue, QueueItem } from "../ui/patterns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, docPath, errorMessage } from "../lib/api";
import { Alert, Button, confirmDialog, toast } from "../ui/kit";
import { Decide, Steps, useApproval, useMyApprovals, Who, type ApprovalItem } from "./ApprovalPanel";

interface Card {
  title: string;
  kind?: string;
  number?: string | null;
  state?: string | null;
  fields?: { name: string; label: string; type: string; value: unknown }[];
}

/** One request opened in place: the record's summary (its card), the trail of who answered, and what the person may do:
 * approve or reject with a reason when it waits for them, withdraw when it is their own. */
export function Detail({ item, mine }: { item: ApprovalItem; mine: "decide" | "withdraw" }) {
  const qc = useQueryClient();
  const card = useQuery({ queryKey: ["card", item.entity, item.record], queryFn: ({ signal }) => api.get<Card>(`/api/cards/${encodeURIComponent(item.entity)}/${encodeURIComponent(item.record)}`, undefined, signal) });
  const request = useApproval(item.entity, item.record, true);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["approvals"] });
    void qc.invalidateQueries({ queryKey: ["approval", item.entity, item.record] });
    void qc.invalidateQueries({ queryKey: ["work"] });
  };
  const withdraw = useMutation({
    mutationFn: () => api.post(docPath(item.entity, item.record, "approval/recall")),
    onSuccess: () => { toast(t("Withdrawn")); refresh(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const ask = async () => {
    if (withdraw.isPending) return;
    if (await confirmDialog({ title: t("Withdraw this request?"), message: t("Nothing is approved or refused; the record stays as it is."), confirmLabel: t("Withdraw") })) withdraw.mutate();
  };
  return (
    <div className="card stack" aria-label={t("Details of {title}", { title: item.title || item.entity_label })}>
      {card.isLoading || request.isLoading ? <ListSkeleton rows={2} /> : null}
      {card.error && <LoadFailed error={card.error} onRetry={() => void card.refetch()} />}
      {card.data && (
        <dl className="stack">
          {(card.data.fields ?? []).map((f) => (
            <div key={f.name}><dt className="muted">{isolate(f.label)}</dt><dd>{isolate(String(f.value ?? ""))}</dd></div>
          ))}
        </dl>
      )}
      {request.error && <LoadFailed error={request.error} onRetry={() => void request.refetch()} />}
      {request.data && (
        <>
          <Steps request={request.data} />
          {request.data.status !== "pending" && <p className="muted">{t("It is no longer waiting.")}</p>}
          {request.data.status === "pending" && mine === "decide" && <Decide request={request.data} onChanged={refresh} />}
        </>
      )}
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      {mine === "withdraw" && request.data?.status === "pending" && (
        <div><Button loading={withdraw.isPending} disabled={withdraw.isPending} onClick={() => void ask()}>{t("Withdraw my request")}</Button></div>
      )}
    </div>
  );
}

function Row({ i, base, who, mine }: { i: ApprovalItem; base: string; who: "requester" | "none"; mine: "decide" | "withdraw" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {rows([i], base, who, <Button size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t("Hide") : mine === "decide" ? t("Review") : t("Details")}</Button>)}
      {open && <li className="queue-item">{<Detail item={i} mine={mine} />}</li>}
    </>
  );
}

function rows(items: ApprovalItem[], base: string, who: "requester" | "none", action?: React.ReactNode) {
  return (
    items.map((i) => (
        <QueueItem
          key={i.request}
          action={action}
          to={`${base}/${i.entity}/${i.record}`}
          title={i.title || i.entity_label}
          meta={
            <>
              {isolate(i.entity_label)} · {isolate(i.action)} ({isolate(i.from)})
              {who === "requester" && <> · {i.requester_name ? isolate(i.requester_name) : <Who id={i.requester} />}</>}
              {" · "}
              <time dateTime={i.requested_at} title={formatDateTime(i.requested_at)}>
                {relativeTime(i.requested_at)}
              </time>
              {i.step && (
                <>
                  {" · "}
                  {isolate(i.step.label || t("Step {n}", { n: i.step.index + 1 }))}
                  {i.step.opened_at && (
                    <>
                      {": "}
                      {t("waiting since")}{" "}
                      <time dateTime={i.step.opened_at} title={formatDateTime(i.step.opened_at)}>
                        {relativeTime(i.step.opened_at)}
                      </time>
                    </>
                  )}
                </>
              )}
            </>
          }
        />
    ))
  );
}

export function ApprovalsPage() {
  const base = useRecordsBase();
  const q = useMyApprovals();
  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.error || !q.data) return <LoadFailed error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="stack">
      <h1 className="h2">{t("Approvals")}</h1>
      <Queue title={t("To decide")} count={q.data.to_decide.length} tone={q.data.to_decide.length ? "attention" : "default"} empty={t("Nothing is waiting for your decision.")}>
        {q.data.to_decide.map((i) => <Row key={i.request} i={i} base={base} who="requester" mine="decide" />)}
      </Queue>
      <Queue title={t("Waiting for others")} count={q.data.awaiting_others.length} empty={t("None of your requests is waiting.")}>
        {q.data.awaiting_others.map((i) => <Row key={i.request} i={i} base={base} who="none" mine="withdraw" />)}
      </Queue>
    </div>
  );
}
