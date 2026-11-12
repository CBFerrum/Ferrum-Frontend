// Mine to decide (BD-19): the approval requests waiting for the person, and their own still waiting for others.
// Each opens its record: the list carries a title and the action, not the record's amounts, so the decision is
// made on the record's page.

import { t, isolate } from "@ferrum/client";
import { formatDateTime, relativeTime } from "../lib/format";
import { useRecordsBase } from "../lib/recordsBase";
import { LoadFailed, ListSkeleton } from "../ui/patterns";
import { Queue, QueueItem } from "../ui/patterns";
import { useMyApprovals, Who, type ApprovalItem } from "./ApprovalPanel";

function rows(items: ApprovalItem[], base: string, who: "requester" | "none") {
  return (
    items.map((i) => (
        <QueueItem
          key={i.request}
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
        {rows(q.data.to_decide, base, "requester")}
      </Queue>
      <Queue title={t("Waiting for others")} count={q.data.awaiting_others.length} empty={t("None of your requests is waiting.")}>
        {rows(q.data.awaiting_others, base, "none")}
      </Queue>
    </div>
  );
}
