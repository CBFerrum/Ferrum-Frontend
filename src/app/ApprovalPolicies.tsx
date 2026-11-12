// Every approval policy the workspace has set, across entities (Customize → Approval policies), each linking to the page that
// edits it. Policies a package ships are not in the customizations list: they show on each entity's own page.

import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { api } from "../lib/api";
import { approvalIndex, shippedRows, type PolicyRow } from "../lib/approvalDraft";
import { useMe, useMetaIndex } from "../lib/meta";
import { Badge, EmptyState, PageLoading } from "../ui/kit";
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
              <td>{isolate(r.steps.join(" → "))}{r.shipped && <> <Badge tone={r.shipped.changed ? "amber" : "blue"}>{r.shipped.changed ? tr("Shipped by {package}, changed here", { package: r.shipped.package }) : tr("Shipped by {package}", { package: r.shipped.package })}</Badge></>}</td>
              <td className="num"><Link className="btn btn-default btn-sm" to={r.to} aria-label={tr("Open the policy of {entity}", { entity: label(r.entity) })}>{tr("Open")}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ApprovalPoliciesPage({ embedded = false }: { embedded?: boolean } = {}) {
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
  // What packages ship is asked of each document type's definition (there is no one list of them); a failure only drops that one.
  const documents = (index.data?.entities ?? []).filter((e) => e.kind === "document");
  const defs = useQueries({
    queries: documents.map((e) => ({ queryKey: ["customize", "definition", e.name], queryFn: ({ signal }: { signal: AbortSignal }) => api.get<unknown>(`/api/customize/definition/${encodeURIComponent(e.name)}`, undefined, signal), enabled: !!me.data?.user.is_admin, retry: false, staleTime: 60_000 })),
  });
  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.error || !q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
  const rows = approvalIndex(q.data.customizations);
  const shipped = documents.flatMap((e, i) => shippedRows(e.name, defs[i]?.data));
  const checking = defs.filter((d) => d.isLoading).length;
  const label = (e: string) => index.data?.entities.find((x) => x.name === e)?.label ?? e;
  return (
    <div className="stack">
      {embedded ? null : <div className="page-head"><h1 className="page-title">{tr("Approval policies")}</h1></div>}
      <p className="muted">{tr("Every approval policy: those this workspace has set, and those packages ship, with what an administrator changed. Policies on actions of other record types show on those types' own pages.")}</p>
      {rows.length === 0 && shipped.length === 0 && !checking ? (
        <EmptyState title={tr("No approval policy yet")} icon="edit">
          <p className="muted">{tr("Open a record type under Customize and choose its approvals.")}</p>
        </EmptyState>
      ) : (
        <>
          <h2 className="h3">{tr("Set in this workspace")}</h2>
          {rows.length ? <PolicyTable rows={rows} label={label} /> : <p className="muted">{tr("This workspace has set none of its own.")}</p>}
          <h2 className="h3">{tr("Shipped by packages")}</h2>
          {checking > 0 && <p className="muted" role="status">{tr("Asking {n} record types what their packages ship…", { n: checking })}</p>}
          {shipped.length ? <PolicyTable rows={shipped} label={label} /> : !checking && <p className="muted">{tr("No package ships one on a document type.")}</p>}
        </>
      )}
    </div>
  );
}
