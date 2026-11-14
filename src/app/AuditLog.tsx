// Administration → Audit log: the workspace's audit events, newest first, paged, filtered by kind. GET /api/admin/audit
// (docs/api.md; the event is the one of docs/operations.md, "Sending the audit log elsewhere"). Read only: there is no export route.

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { t as tr, isolate } from "@ferrum/client";
import { api, errorMessage } from "../lib/api";
import { formatMoment } from "../lib/format";
import { Alert, Badge, Button, EmptyState, ErrorState, Field } from "../ui/kit";
import { TableSkeleton } from "../ui/patterns";
import { useState } from "react";

export interface AuditEvent {
  /** The installation-wide id, as text. */
  id: string;
  at: string;
  category: "sign_in" | "administration" | "records" | string;
  entity: string;
  record: string;
  action: string;
  actor: string | null;
  request_id: string | null;
  /** A sign-in's: `{address, user_agent, zone, method}`; any other event's: what changed. */
  details: Record<string, unknown> | null;
}

interface Page {
  events: AuditEvent[];
  /** The id the page ends at: pass it as `before` for the next. */
  next_before: number | null;
}

const PAGE = 50;
const CATEGORIES = () => [
  { id: "", label: tr("All events") },
  { id: "sign_in", label: tr("Sign-ins") },
  { id: "administration", label: tr("Administration") },
  { id: "records", label: tr("Record changes") },
];

const SIGN_IN = () => ({
  signed_in: tr("Signed in"),
  failed: tr("Sign-in failed"),
  refused: tr("Sign-in refused"),
  failed_summary: tr("Failed sign-ins, summarised"),
  break_glass: tr("Signed in with a password under single sign-on"),
  session_ended: tr("Session ended"),
}) as Record<string, string>;

/** What happened, in words: a sign-in's action named for people, anything else as the platform names it (entity and action). */
export function eventWords(e: Pick<AuditEvent, "category" | "entity" | "action">): string {
  if (e.category === "sign_in") return SIGN_IN()[e.action] ?? e.action.replaceAll("_", " ");
  return `${e.entity} ${e.action.replaceAll("_", " ")}`;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function AuditLog() {
  const [category, setCategory] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["admin", "audit", category],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) => api.get<Page>("/api/admin/audit", { category, before: pageParam, limit: PAGE }, signal),
    getNextPageParam: (last) => (last.events.length >= PAGE && last.next_before != null ? last.next_before : undefined),
  });
  // Who: people by name where the list of people can be read, else by the id the event carries.
  const people = useQuery({ queryKey: ["admin", "users"], queryFn: ({ signal }) => api.get<{ users: { id: string; email: string; full_name: string }[] }>("/api/admin/users", undefined, signal) });
  const names = new Map((people.data?.users ?? []).map((u) => [u.id, u.full_name || u.email]));
  const who = (e: AuditEvent) => (e.actor ? (names.get(e.actor) ?? e.actor) : tr("System"));
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Audit log")}</h2>
        <span className="spacer" />
        <Field label={tr("Show")} htmlFor="audit-category">
          <select id="audit-category" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES().map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {q.isLoading ? (
        <TableSkeleton columns={6} />
      ) : q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !events.length ? (
        <EmptyState title={category ? tr("No events of this kind yet") : tr("No events yet")} icon="file" />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tr("When")}</th>
                  <th scope="col">{tr("Who")}</th>
                  <th scope="col">{tr("What")}</th>
                  <th scope="col">{tr("Address")}</th>
                  <th scope="col">{tr("Zone")}</th>
                  <th scope="col">{tr("Method")}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const d = e.details ?? {};
                  return (
                    <tr key={e.id}>
                      <td className="nowrap">{isolate(formatMoment(e.at, { dateStyle: "medium", timeStyle: "medium" }))}</td>
                      <td>{isolate(who(e))}</td>
                      <td>
                        {isolate(eventWords(e))}
                        {e.category === "sign_in" && e.action === "refused" && d.by ? (
                          <>
                            {" "}
                            <Badge tone="amber">{isolate(text(d.by))}</Badge>
                          </>
                        ) : null}
                      </td>
                      <td className="mono">{isolate(text(d.address))}</td>
                      <td>{isolate(text(d.zone))}</td>
                      <td>{e.category === "sign_in" ? isolate(text(d.method)) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {q.error && (
            <div className="card-body">
              <Alert tone="error">{isolate(errorMessage(q.error))}</Alert>
            </div>
          )}
          {q.hasNextPage && (
            <div className="card-body">
              <Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {tr("Load more")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
