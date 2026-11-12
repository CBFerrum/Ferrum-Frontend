// Every approval policy the workspace has set, across entities (Customize → Approval policies), each linking to the page that
// edits it. Policies a package ships are not in the customizations list: they show on each entity's own page.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { api } from "../lib/api";
import { approvalIndex, type PolicyRow } from "../lib/approvalDraft";
import { useMe, useMetaIndex } from "../lib/meta";
import { EmptyState, PageLoading } from "../ui/kit";
import { ListSkeleton, LoadFailed } from "../ui/patterns";

export function PolicyTable({ rows, label }: { rows: PolicyRow[]; label: (entity: string) => string }) {
  const what = (on: string) => (on === "submit" ? tr("Before submitting") : on === "cancel" ? tr("Before cancelling") : on.startsWith("action:") ? tr("Before “{action}” runs", { action: on.slice(7) }) : tr("On the transition {action}", { action: on.replace(/^transition /, "") }));
  return (
    <div className="table-scroll">
      <table className="table">
        <thead><tr><th>{tr("Record type")}</th><th>{tr("Asked")}</th><th>{tr("Steps")}</th><th><span className="sr-only">{tr("Change")}</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.entity}|${r.on}`}>
              <td>{isolate(label(r.entity))}</td>
              <td>{what(r.on)}</td>
              <td>{isolate(r.steps.join(" → "))}</td>
              <td className="num"><Link className="btn btn-default btn-sm" to={r.to} aria-label={tr("Open the policy of {entity}", { entity: label(r.entity) })}>{tr("Open")}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ApprovalPoliciesPage() {
  const me = useMe();
  const index = useMetaIndex();
  const q = useQuery({ queryKey: ["customize"], queryFn: ({ signal }) => api.get<{ customizations: Parameters<typeof approvalIndex>[0] }>("/api/customize", undefined, signal), enabled: !!me.data?.user.is_admin });
  if (me.isLoading) return <PageLoading />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can set up approvals. Ask one of them to make this change.")}</p>
      </EmptyState>
    );
  }
  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.error || !q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
  const rows = approvalIndex(q.data.customizations);
  const label = (e: string) => index.data?.entities.find((x) => x.name === e)?.label ?? e;
  return (
    <div className="stack">
      <div className="page-head"><h1 className="page-title">{tr("Approval policies")}</h1></div>
      <p className="muted">{tr("The policies this workspace has set. A policy a package ships shows on its record type's own page.")}</p>
      {rows.length === 0 ? (
        <EmptyState title={tr("No approval policy yet")} icon="edit">
          <p className="muted">{tr("Open a record type under Customize and choose its approvals.")}</p>
        </EmptyState>
      ) : (
        <PolicyTable rows={rows} label={label} />
      )}
    </div>
  );
}
