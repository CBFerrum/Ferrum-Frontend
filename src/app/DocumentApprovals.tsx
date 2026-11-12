// Approval before a document is submitted or cancelled (administrators; BD-19, amended): on a submittable entity no workflow
// submits, each of the two asks the same policy a workflow transition does, with the options a document has (lock the record
// while it waits, let the system through, fields approvers see). Each is saved as one `set_approval` customization; the
// logic is lib/approvalDraft.ts. The server's refusal is shown on the step it names, else above the policy.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage } from "../lib/api";
import { checkPolicy, currentDocumentPolicy, documentOp, effectivePolicy, fromPolicy, newPolicy, onKey, shippedPolicy, type DocOn, type DraftPolicy } from "../lib/approvalDraft";
import { useEntityMeta, useMe, type EntityMeta } from "../lib/meta";
import { Alert, Badge, Button, EmptyState, ErrorState, PageLoading, toast } from "../ui/kit";
import { useApply } from "./author/apply";
import { ApprovalEditor } from "./author/ApprovalEditor";

export function DocumentApprovalsPage() {
  const { entity = "" } = useParams();
  const me = useMe();
  if (me.isLoading) return <PageLoading />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can set up approvals. Ask one of them to make this change.")}</p>
      </EmptyState>
    );
  }
  return <Loader key={entity} entity={entity} />;
}

function Loader({ entity }: { entity: string }) {
  const meta = useEntityMeta(entity);
  const list = useQuery({
    queryKey: ["customize"],
    queryFn: ({ signal }) => api.get<{ customizations: Parameters<typeof currentDocumentPolicy>[0] }>("/api/customize", undefined, signal),
  });
  if (meta.error) {
    if (meta.error instanceof ApiError && meta.error.status === 404) {
      return (
        <EmptyState title={tr("There is no such entity")} icon="alert">
          <p className="muted">{tr("Nothing called {entity} is installed in this workspace.", { entity: isolate(entity) })}</p>
          <Link className="btn" to="/customize">{tr("Back to Customize")}</Link>
        </EmptyState>
      );
    }
    return <ErrorState error={meta.error} onRetry={() => meta.refetch()} title={tr("Could not load {entity}", { entity: isolate(entity) })} />;
  }
  // What the packages ship, to mark the policies that follow them and those an administrator changed. Not needed to edit: a failure only drops the marks.
  const shipped = useQuery({ queryKey: ["customize", "definition", entity], queryFn: ({ signal }) => api.get<unknown>(`/api/customize/definition/${encodeURIComponent(entity)}`, undefined, signal), retry: false });
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (!meta.data || !list.data || shipped.isLoading) return <PageLoading />;
  return <DocumentApprovals meta={meta.data} list={list.data.customizations} shipped={shipped.data} />;
}

export function DocumentApprovals({ meta, list, shipped }: { meta: EntityMeta; list: Parameters<typeof currentDocumentPolicy>[0]; shipped?: unknown }) {
  const label = isolate(meta.label);
  const usable = meta.submittable && !meta.workflow;
  const actions = (meta.actions ?? []).filter((a) => !a.read_only && !a.hidden);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/customize">{tr("Customize")}</Link> / <Link to={`/customize/${encodeURIComponent(meta.name)}`}>{label}</Link>
          </p>
          <h1 className="page-title">{tr("Approval of {entity}", { entity: label })}</h1>
        </div>
      </div>
      {!usable ? (
        <EmptyState title={meta.workflow ? tr("This one has a workflow") : tr("This is not a document that is submitted")} icon="edit">
          <p className="muted">{meta.workflow ? tr("Its workflow submits it: put the approval on the transition, in the workflow designer.") : tr("Only a document that is submitted and cancelled can ask for approval before either.")}</p>
        </EmptyState>
      ) : (
        <>
          <Policy meta={meta} on="submit" title={tr("Approval before submitting")} list={list} shipped={shipped} />
          <Policy meta={meta} on="cancel" title={tr("Approval before cancelling")} list={list} shipped={shipped} />
        </>
      )}
      {actions.length > 0 ? (
        actions.map((a) => <Policy key={a.name} meta={meta} on={{ action: a.name }} title={tr("Approval before “{action}”", { action: a.label || a.name })} list={list} shipped={shipped} />)
      ) : (
        <p className="muted">{tr("This record type has no action that changes something, so no action asks for approval.")}</p>
      )}
    </div>
  );
}

function Policy({ meta, on, title, list, shipped }: { meta: EntityMeta; on: DocOn; title: string; list: Parameters<typeof currentDocumentPolicy>[0]; shipped?: unknown }) {
  const apply = useApply(meta.name);
  const [d, setD] = useState<DraftPolicy | null>(() => fromPolicy(currentDocumentPolicy(list, meta.name, on) ?? effectivePolicy(shipped, onKey(on)), (k) => k));
  const [problems, setProblems] = useState<string[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `da-${onKey(on).replace(/[^a-z0-9_-]/gi, "-")}`;
  const ships = shippedPolicy(shipped, onKey(on));
  const set = (next: DraftPolicy | null) => (setD(next), setProblems([]), setRefused(null));
  const save = async () => {
    const found = d ? checkPolicy(d) : [];
    setProblems(found.map((p) => p.message));
    setRefused(null);
    if (found.length) return;
    setBusy(true);
    try {
      await apply(documentOp(on, d), tr("Approval"));
      toast(d ? tr("Approval saved") : tr("Approval taken off"));
    } catch (e) {
      setRefused(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // The refusal names "approval step N" when it is about one step.
  const stepNo = refused ? Number(/approval step (\d+)/i.exec(refused)?.[1]) : NaN;
  const errorStep = d && stepNo >= 1 ? d.steps[stepNo - 1]?.key : undefined;
  return (
    <section className="card" aria-labelledby={`${id}-h`}>
      <div className="card-head">
        <h2 id={`${id}-h`}>{title}</h2>
        {ships && <Badge tone={ships.changed ? "amber" : "blue"}>{ships.changed ? tr("Changed from what {package} ships", { package: ships.package }) : tr("As {package} ships it", { package: ships.package })}</Badge>}
      </div>
      <div className="card-body stack">
        {problems.length > 0 && (
          <Alert tone="error">
            <strong>{tr("Fix these first")}</strong>
            <ul>
              {problems.map((p, i) => (
                <li key={i}>{isolate(p)}</li>
              ))}
            </ul>
          </Alert>
        )}
        {refused && !errorStep && <Alert tone="error">{isolate(refused)}</Alert>}
        {ships && ships.changed && !d && <p className="muted">{tr("An administrator switched off what {package} ships here.", { package: ships.package })}</p>}
        <label className="check-field">
          <input id={`${id}-on`} type="checkbox" checked={!!d} onChange={(e) => set(e.target.checked ? newPolicy() : null)} />
          {on === "submit" ? tr("Ask for approval before a {entity} is submitted", { entity: isolate(meta.label) }) : on === "cancel" ? tr("Ask for approval before a {entity} is cancelled", { entity: isolate(meta.label) }) : tr("Ask for approval before “{action}” runs", { action: on.action })}
        </label>
        {d && (
          <ApprovalEditor policy={d} onChange={set} fields={meta.fields} actions={[]} states={[]} flagged={new Set(problems.length ? d.steps.map((s) => s.key) : [])} errorStep={errorStep} error={errorStep ? (refused ?? undefined) : undefined} document idPrefix={id} />
        )}
        <div>
          <Button variant="primary" loading={busy} disabled={busy} onClick={() => void save()}>
            {tr("Save approval")}
          </Button>
        </div>
      </div>
    </section>
  );
}
