// Administration: users, roles & permissions, packages, webhooks, automations, plugins, API keys, single sign-on, domains, personal data, workspace settings,
// and what needs a person: events, webhook deliveries and jobs that gave up.

import { placed } from "../lib/placed";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError, download as downloadFile, errorMessage, saveBlob, type FieldError } from "../lib/api";
import { formatDate, formatDateTime, relativeTime } from "../lib/format";
import { LANGUAGES } from "../lib/i18n";
import { ssoRedirectUri } from "../lib/sso";
import { useEntityMeta, useMe, useMetaIndex, type Field } from "../lib/meta";
import { Connections } from "./Connections";
import { InterfaceWords } from "./InterfaceWords";
import { LinkInput, LinkTitle } from "./widgets";
import {
  Alert,
  Badge,
  Button,
  confirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field as FieldWrap,
  Icon,
  PageLoading,
  TabPanel,
  Tabs,
  toast,
} from "../ui/kit";
import { t as tr, isolate } from "@ferrum/client";

const TABS = [
  { id: "users", get label() { return tr("Users"); } },
  { id: "roles", get label() { return tr("Roles & permissions"); } },
  { id: "packages", get label() { return tr("Packages"); } },
  { id: "connections", get label() { return tr("Connections"); } },
  { id: "webhooks", get label() { return tr("Webhooks"); } },
  { id: "automations", get label() { return tr("Automations"); } },
  { id: "plugins", get label() { return tr("Plugins"); } },
  { id: "keys", get label() { return tr("API keys"); } },
  { id: "sso", get label() { return tr("Single sign-on"); } },
  { id: "domains", get label() { return tr("Domains"); } },
  { id: "privacy", get label() { return tr("Personal data"); } },
  { id: "workspace", get label() { return tr("Workspace"); } },
  { id: "words", get label() { return tr("Interface words"); } },
  { id: "exceptions", get label() { return tr("Needs a person"); } },
];

export function AdminPage() {
  const me = useMe();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.id === sp.get("tab")) ? (sp.get("tab") as string) : "users";
  if (me.isLoading) return <PageLoading />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Ask an administrator if you need access to these settings.")}</p>
      </EmptyState>
    );
  }
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{tr("Administration")}</h1>
      </div>
      <Tabs id="admin" tabs={TABS} value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} />
      <TabPanel id="admin" tab={tab}>
        {tab === "users" && <Users />}
        {tab === "roles" && <Roles />}
        {tab === "packages" && <Packages />}
        {tab === "connections" && <Connections />}
        {tab === "webhooks" && <Webhooks />}
        {tab === "automations" && <Automations />}
        {tab === "plugins" && <Plugins />}
        {tab === "keys" && <ApiKeys />}
        {tab === "sso" && <SingleSignOn />}
        {tab === "domains" && <Domains />}
        {tab === "privacy" && <PersonalData />}
        {tab === "workspace" && <Workspace />}
        {tab === "words" && <InterfaceWords />}
        {tab === "exceptions" && <Exceptions />}
      </TabPanel>
    </div>
  );
}

// ── personal data ──

interface PersonRecord {
  entity: string;
  label: string;
  id: string;
  number?: string | null;
  /** Fields erasure blanks. */
  erases: string[];
  /** Matched by a table's rows: the table, and how many of its rows are theirs (the rest stay). */
  table?: string;
  rows?: number;
  data: Record<string, unknown>;
}

interface PersonData {
  email: string;
  /** The digits of the phone number asked with, if one was. */
  phone?: string | null;
  records: PersonRecord[];
  /** Records holding the name asked with, or the number with or without its country code: possibly
   *  theirs, for a person to judge, never erased for it. */
  possibly?: { entity: string; label: string; id: string; name?: string; phone?: string }[];
  account: { id: string; email: string; full_name: string; is_active: boolean; is_admin: boolean; roles: string[]; created_at: string; last_login_at?: string | null } | null;
}

/** Field names of an entity as their labels, in a list. */
function FieldLabels({ entity, names }: { entity: string; names: string[] }) {
  const fields = useEntityMeta(entity).data?.fields;
  return <>{isolate(names.map((n) => fields?.find((f) => f.name === n)?.label ?? n).join(", "))}</>;
}

/** Personal-data requests: what is kept about a person (by email, and their phone number and name
 * when given), a copy for them, and its erasure. */
function PersonalData() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [found, setFound] = useState<PersonData | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"find" | "erase" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const find = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("find");
    setError(null);
    setFound(null);
    try {
      const query: Record<string, string> = { email: email.trim() };
      if (phone.trim()) query.phone = phone.trim();
      if (name.trim()) query.name = name.trim();
      setFound(await api.get<PersonData>("/api/admin/personal-data", query));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  // The person's copy: never the records that only share their name, which may be someone else's.
  const download = () => {
    if (!found) return;
    const { possibly: _maybe, ...copy } = found;
    saveBlob(new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" }), `personal-data-${found.email}.json`);
  };
  const erase = async () => {
    if (!found) return;
    const what = `${found.records.length} ${found.records.length === 1 ? "record" : "records"}${found.account ? " and the login account" : ""}`;
    const message = tr("The person's details leave {what}, and their history. The workspace's stored exports, copies from before, are deleted too. This cannot be undone.", { what });
    if (!(await confirmDialog({ title: tr("Erase {email}?", { email: found.email }), message, confirmLabel: tr("Erase"), danger: true })))
      return;
    setBusy("erase");
    setError(null);
    try {
      const res = await api.post<{ erased: unknown[]; retained: unknown[]; account_erased: boolean; audit_events_redacted: number; exports_deleted: number }>(
        "/api/admin/personal-data/erase",
        {
          email: found.email,
          phone: found.phone ?? undefined,
          reason: reason.trim(),
        },
      );
      const n = res.erased.length;
      const said = [
        n === 1
          ? res.account_erased ? tr("Erased 1 record and the login account") : tr("Erased 1 record")
          : res.account_erased ? tr("Erased {n} records and the login account", { n }) : tr("Erased {n} records", { n }),
        tr("{n} history entries redacted", { n: res.audit_events_redacted }),
        ...(res.retained.length ? [tr("{n} kept for the reasons given", { n: res.retained.length })] : []),
        ...(res.exports_deleted ? [res.exports_deleted === 1 ? tr("1 stored export deleted") : tr("{n} stored exports deleted", { n: res.exports_deleted })] : []),
      ];
      toast(said.join("; "));
      setFound(null);
      setReason("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const nothing = found && !found.records.length && !found.account && !found.possibly?.length;
  return (
    <>
    <section className="card">
      <div className="card-head">
        <h2>{tr("Personal data")}</h2>
      </div>
      <div className="card-pad stack">
        <p className="muted">
          Find what is kept about a person by their email address (and their phone number, or their name, when records may hold those without it), give them a
          copy, or erase it. Erasure blanks their details on the records listed and in those
          records&apos; history, and closes their login account; submitted documents keep the names they carry, as bookkeeping law requires.
        </p>
        <form className="row" onSubmit={find}>
          <FieldWrap label={tr("Email")} htmlFor="pd-email">
            <input id="pd-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </FieldWrap>
          <FieldWrap label={tr("Phone (optional)")} htmlFor="pd-phone" hint={tr("Its digits as recorded; one held with or without a country code is listed apart")}>
            <input id="pd-phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FieldWrap>
          <FieldWrap label={tr("Name (optional)")} htmlFor="pd-name" hint={tr("Lists records holding it, for you to judge")}>
            <input id="pd-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </FieldWrap>
          <Button type="submit" variant="primary" icon="search" loading={busy === "find"} disabled={!email.trim()}>
            {tr("Find")}
          </Button>
        </form>
        {error && <Alert tone="error">{isolate(error)}</Alert>}
        {nothing && <p className="muted">{tr("Nothing is kept about {email}.", { email: found.email })}</p>}
        {found && !nothing && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Kind")}</th>
                    <th scope="col">{tr("Record")}</th>
                    <th scope="col">{tr("Erasure blanks")}</th>
                  </tr>
                </thead>
                <tbody>
                  {found.records.map((r) => (
                    <tr key={`${r.entity}/${r.id}`}>
                      <td>{isolate(r.label)}</td>
                      <td>
                        <a href={`/app/e/${encodeURIComponent(r.entity)}/${encodeURIComponent(r.id)}`}>{r.number || r.id.slice(0, 8)}</a>
                      </td>
                      <td className="muted">
                        {r.table ? (
                          <>
                            {placed(r.erases.includes(r.table) ? (r.rows === 1 ? tr("their row of {table}, removed") : tr("their {rows} rows of {table}, removed", { rows: String(r.rows) })) : r.rows === 1 ? tr("{value} in their row of {table}", { value: r.erases.map((f) => f.slice(r.table!.length + 1).replace(/_/g, " ")).join(", ") }) : tr("{value} in their {rows} rows of {table}", { value: r.erases.map((f) => f.slice(r.table!.length + 1).replace(/_/g, " ")).join(", "), rows: String(r.rows) }), { table: <FieldLabels entity={r.entity} names={[r.table]} /> })}
                          </>
                        ) : (
                          <FieldLabels entity={r.entity} names={r.erases} />
                        )}
                      </td>
                    </tr>
                  ))}
                  {found.account && (
                    <tr>
                      <td>{tr("Login account")}</td>
                      <td>
                        {found.account.full_name || found.account.email} {found.account.is_admin && <Badge tone="amber">{tr("administrator")}</Badge>}
                      </td>
                      <td className="muted">{tr("name, email, password and roles; the account is closed")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!!found.possibly?.length && (
              <>
                <h3 className="section-title">{tr("Possibly theirs: the same name, or the number with or without its country code")}</h3>
                <p className="muted">{tr("Not in the copy and never erased for that alone: open each, and if it is theirs, change or delete it there.")}</p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{tr("Kind")}</th>
                        <th scope="col">{tr("Record")}</th>
                        <th scope="col">{tr("Held")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {found.possibly.map((r) => (
                        <tr key={`${r.entity}/${r.id}`}>
                          <td>{isolate(r.label)}</td>
                          <td>
                            <a href={`/app/e/${encodeURIComponent(r.entity)}/${encodeURIComponent(r.id)}`}>{isolate(r.id.slice(0, 8))}</a>
                          </td>
                          <td>{r.name ?? r.phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="row">
              <Button icon="download" onClick={download}>
                {tr("Download a copy (JSON)")}
              </Button>
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void erase();
              }}
            >
              <FieldWrap label={tr("Reason")} htmlFor="pd-reason" hint={tr("Kept with the erasure, e.g. the request's reference")}>
                <input id="pd-reason" className="input" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </FieldWrap>
              <Button type="submit" variant="danger" icon="trash" loading={busy === "erase"} disabled={!reason.trim() || !!found.account?.is_admin}>
                {tr("Erase")}
              </Button>
            </form>
          </>
        )}
      </div>
    </section>
    <section className="card">
      <div className="card-head">
        <h2>{tr("Evidence for a review")}</h2>
      </div>
      <div className="card-pad stack">
        <p className="muted">
          {tr("What a reviewer asks for, read from the system now: who can reach what, who outside the workspace is involved, what happens to personal data, and whether its history is whole. These are facts, not a claim that the workspace meets any standard. Taking a copy is recorded.")}
        </p>
        <div className="row">
          <Button icon="download" onClick={() => downloadFile("/api/admin/evidence", "evidence.json").catch((e) => toast(errorMessage(e), "error"))}>
            {tr("Download the evidence pack")}
          </Button>
        </div>
      </div>
    </section>
    </>
  );
}

/** Wraps a query's loading/error states. */
function Loaded<T>({ q, children }: { q: { data?: T; error: unknown; isLoading: boolean; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  if (q.isLoading) return <PageLoading />;
  if (q.error || q.data === undefined) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <>{children(q.data)}</>;
}

/** Runs a mutation with toasts; returns whether it succeeded. */
async function attempt(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await fn();
    if (success) toast(success);
    return true;
  } catch (e) {
    toast(errorMessage(e), "error");
    return false;
  }
}

// ── what needs a person ──

interface DeadEvent {
  id: number;
  topic: string;
  entity: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

interface DeadDelivery {
  id: string;
  webhook_name: string;
  topic: string;
  attempts: number;
  response_code: number | null;
  last_error: string | null;
  updated_at: string;
}

interface FailedJob {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  finished_at: string | null;
}

interface Operation {
  operation: string;
  events: { id: number; topic: string; state: string; attempts: number; last_error: string | null }[];
  jobs: { id: string; kind: string; status: string; attempts: number; last_error: string | null }[];
  runs: { id: string; solution: string; process: string; status: string }[];
  effects: { capability: string; status: string }[];
  deliveries: { id: string; webhook_name: string; topic: string; status: string; attempts: number; last_error: string | null }[];
}

/** Everything one operation set off, found by the id a person was shown with an error. */
function FindOperation() {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Operation | null>(null);
  const find = async (e: FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return;
    setBusy(true);
    try {
      setFound(await api.get<Operation>(`/api/admin/operations/${encodeURIComponent(id.trim())}`));
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  const lines = found
    ? [
        ...found.events.map((e) => `${tr("Event")} ${e.topic}: ${e.state}${e.last_error ? ` (${e.last_error})` : ""}`),
        ...found.jobs.map((j) => `${tr("Job")} ${j.kind}: ${j.status}${j.last_error ? ` (${j.last_error})` : ""}`),
        ...found.runs.map((r) => `${tr("Process")} ${r.solution} ${r.process}: ${r.status}`),
        ...found.effects.map((f) => `${tr("Effect")} ${f.capability}: ${f.status}`),
        ...found.deliveries.map((d) => `${tr("Webhook")} ${d.webhook_name} ${d.topic}: ${d.status}${d.last_error ? ` (${d.last_error})` : ""}`),
      ]
    : [];
  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Find an operation")}</h2>
      </div>
      <div className="card-body stack">
        <p className="muted">{tr("Someone quoting an operation from an error: everything it set off, and how each stands.")}</p>
        <form className="row" onSubmit={find} aria-label={tr("Find an operation")}>
          <input className="input" aria-label={tr("Operation")} value={id} onChange={(e) => setId(e.target.value)} placeholder="0190f…" />
          <Button type="submit" loading={busy}>
            {tr("Find")}
          </Button>
        </form>
        {found &&
          (lines.length ? (
            <ul className="stack" style={{ gap: 4 }}>
              {lines.map((l, i) => (
                <li key={i} className="mono" style={{ overflowWrap: "anywhere" }}>
                  {isolate(l)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{tr("Nothing in this workspace carries that operation.")}</p>
          ))}
      </div>
    </section>
  );
}

/** The operator's exception queue: what the workspace's event handlers, webhooks and jobs gave up on and why,
 *  never what they carried, each to try again once what stopped it is put right. */
function Exceptions() {
  const qc = useQueryClient();
  const key = ["admin", "exceptions"];
  const events = useQuery({ queryKey: [...key, "events"], queryFn: ({ signal }) => api.get<{ events: DeadEvent[] }>("/api/admin/events/dead", { limit: 100 }, signal) });
  const deliveries = useQuery({
    queryKey: [...key, "deliveries"],
    queryFn: ({ signal }) => api.get<{ deliveries: DeadDelivery[] }>("/api/admin/webhook-deliveries/dead", { limit: 100 }, signal),
  });
  const jobs = useQuery({ queryKey: [...key, "jobs"], queryFn: ({ signal }) => api.get<{ jobs: FailedJob[] }>("/api/jobs", { limit: 200 }, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const again = async (id: string, url: string) => {
    setBusy(id);
    if (await attempt(() => api.post(url, {}), tr("Queued again"))) await qc.invalidateQueries({ queryKey: key });
    setBusy(null);
  };
  const why = (text: string | null) => <td style={{ overflowWrap: "anywhere" }}>{text ? isolate(text) : "—"}</td>;
  const tryAgain = (id: string, url: string, label: string, what: string) => (
    <td>
      <Button size="sm" loading={busy === id} onClick={() => void again(id, url)} aria-label={`${label}: ${what}`}>
        {label}
      </Button>
    </td>
  );
  return (
    <div className="stack">
      <FindOperation />
      <section className="card">
        <div className="card-head">
          <h2>{tr("Events handlers gave up on")}</h2>
        </div>
        <div className="card-body">
          <p className="muted">{tr("Put right what stopped each one, then replay it. Handlers that dealt with it already are not repeated.")}</p>
        </div>
        <Loaded q={events}>
          {(data) =>
            !data.events.length ? (
              <EmptyState title={tr("No events waiting")} icon="check" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{tr("Event")}</th>
                      <th scope="col">{tr("Record")}</th>
                      <th scope="col" className="num">
                        {tr("Attempts")}
                      </th>
                      <th scope="col">{tr("Why")}</th>
                      <th scope="col">{tr("Since")}</th>
                      <th scope="col">
                        <span className="sr-only">{tr("Actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((e) => (
                      <tr key={e.id}>
                        <td className="mono">{isolate(e.topic)}</td>
                        <td>{e.entity ? isolate(e.entity) : "—"}</td>
                        <td className="num">{e.attempts}</td>
                        {why(e.last_error)}
                        <td className="nowrap">{isolate(relativeTime(e.created_at))}</td>
                        {tryAgain(`event-${e.id}`, `/api/admin/events/${e.id}/replay`, tr("Replay"), e.topic)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </section>
      <section className="card">
        <div className="card-head">
          <h2>{tr("Webhook deliveries that gave up")}</h2>
        </div>
        <Loaded q={deliveries}>
          {(data) =>
            !data.deliveries.length ? (
              <EmptyState title={tr("No deliveries waiting")} icon="check" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{tr("Webhook")}</th>
                      <th scope="col">{tr("Event")}</th>
                      <th scope="col" className="num">
                        {tr("Attempts")}
                      </th>
                      <th scope="col">{tr("Why")}</th>
                      <th scope="col">{tr("Last tried")}</th>
                      <th scope="col">
                        <span className="sr-only">{tr("Actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deliveries.map((d) => (
                      <tr key={d.id}>
                        <td>{isolate(d.webhook_name)}</td>
                        <td className="mono">{isolate(d.topic)}</td>
                        <td className="num">{d.attempts}</td>
                        {why(d.response_code ? `HTTP ${d.response_code}${d.last_error ? `: ${d.last_error}` : ""}` : d.last_error)}
                        <td className="nowrap">{isolate(relativeTime(d.updated_at))}</td>
                        {tryAgain(`delivery-${d.id}`, `/api/admin/webhook-deliveries/${d.id}/replay`, tr("Replay"), d.topic)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </section>
      <section className="card">
        <div className="card-head">
          <h2>{tr("Jobs that failed")}</h2>
        </div>
        <div className="card-body">
          <p className="muted">{tr("A job tried again still runs with the rights its requester has now.")}</p>
        </div>
        <Loaded q={jobs}>
          {(data) => {
            const failed = data.jobs.filter((j) => j.status === "failed");
            return !failed.length ? (
              <EmptyState title={tr("No failed jobs")} icon="check" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{tr("Job")}</th>
                      <th scope="col" className="num">
                        {tr("Attempts")}
                      </th>
                      <th scope="col">{tr("Why")}</th>
                      <th scope="col">{tr("Ended")}</th>
                      <th scope="col">
                        <span className="sr-only">{tr("Actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {failed.map((j) => (
                      <tr key={j.id}>
                        <td className="mono">{isolate(j.kind)}</td>
                        <td className="num">{j.attempts}</td>
                        {why(j.last_error)}
                        <td className="nowrap">{j.finished_at ? isolate(relativeTime(j.finished_at)) : "—"}</td>
                        {tryAgain(`job-${j.id}`, `/api/jobs/${j.id}/retry`, tr("Try again"), j.kind)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </Loaded>
      </section>
    </div>
  );
}

// ── workspace settings ──

interface WorkspaceSettings {
  timezone: string;
  /** The interface's language for everyone who chose none (BCP 47); none: English. */
  language: string | null;
  fiscal_year_start_month: number;
  require_two_factor: boolean;
  require_sso: boolean;
  /** What devices may keep for people to work offline, and for how many hours (docs/offline.md). */
  offline?: { allowed?: boolean; hours?: number };
}

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString("en", { month: "long" }));

function Workspace() {
  const q = useQuery({ queryKey: ["admin", "settings"], queryFn: ({ signal }) => api.get<WorkspaceSettings>("/api/admin/settings", undefined, signal) });
  return (
    <div className="stack">
      <Loaded q={q}>{(s) => <WorkspaceForm key={`${s.timezone}|${s.language}|${s.fiscal_year_start_month}|${s.require_two_factor}|${s.require_sso}|${JSON.stringify(s.offline)}`} initial={s} />}</Loaded>
      <PlanAndUsage />
      <WorkspaceExport />
      <CloseWorkspace />
    </div>
  );
}

interface ExportJob {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: { step?: string; done?: number; total?: number } | null;
  result: { parts?: { id: string; file_name: string; size?: number }[]; expires_in_days?: number; deleted?: string; files_missing?: number } | null;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
}

const EXPORT_KIND = "platform.export";

/** Whether a finished export's files are gone: deleted by an erasure, or past the days it is kept. */
export function exportGone(job: Pick<ExportJob, "status" | "result" | "finished_at">, now: number): boolean {
  if (job.status !== "done") return false;
  const days = job.result?.expires_in_days ?? 7;
  return !!job.result?.deleted || (!!job.finished_at && now > new Date(job.finished_at).getTime() + days * 86_400_000);
}

/** The workspace's copy to take away: every record with its rows, files, history and settings, never
 *  a secret, as zip files an administrator downloads for some days; a personal-data erasure deletes
 *  them sooner, and the next export holds what it left. */
function WorkspaceExport() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "exports"],
    queryFn: ({ signal }) => api.get<{ jobs: ExportJob[] }>("/api/jobs", { limit: 50 }, signal),
    refetchInterval: (query) => (query.state.data?.jobs.some((j) => j.kind === EXPORT_KIND && (j.status === "queued" || j.status === "running")) ? 3000 : false),
  });
  const [busy, setBusy] = useState(false);
  const latest = (q.data?.jobs ?? []).filter((j) => j.kind === EXPORT_KIND).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const making = latest?.status === "queued" || latest?.status === "running";
  const start = async () => {
    setBusy(true);
    if (await attempt(() => api.post("/api/admin/export", {}), tr("The export is being made"))) await qc.invalidateQueries({ queryKey: ["admin", "exports"] });
    setBusy(false);
  };
  const save = (part: { id: string; file_name: string }) => void attempt(() => downloadFile(`/api/jobs/${latest!.id}/parts/${part.id}`, part.file_name));
  const days = latest?.result?.expires_in_days ?? 7;
  const gone = !!latest && exportGone(latest, Date.now());
  const parts = latest?.status === "done" && !gone ? (latest.result?.parts ?? []) : [];
  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Export the workspace")}</h2>
        <span className="spacer" />
        <Button size="sm" loading={busy} disabled={making} onClick={() => void start()}>
          {tr("Make an export")}
        </Button>
      </div>
      <div className="card-body stack" style={{ gap: 8 }}>
        <p className="muted">{tr("Every record with its rows, the files, the history and the settings, never a password or secret, in zip files you download here.")}</p>
        {making && (
          <p role="status">
            {tr("Being made")}{latest?.progress?.step ? `: ${latest.progress.step}${latest.progress.total ? tr(" ({value} of {total})", { value: latest.progress.done ?? 0, total: latest.progress.total }) : ""}` : ""}…
          </p>
        )}
        {latest?.status === "failed" && <Alert tone="error">{tr("The last export failed: {last_error}", { last_error: latest.last_error ?? "" })}</Alert>}
        {gone && (
          <p className="faint">
            {latest?.result?.deleted
              ? tr("The last export was deleted by a personal-data erasure, as every copy from before one is. Make another.")
              : tr("The last export was kept its {days} days and is gone. Make another.", { days })}
          </p>
        )}
        {latest?.status === "done" && !gone && (
          <>
            <p className="faint">
              {placed(tr("Made {p1}; kept {days} days, unless a personal-data erasure deletes it first."), { p1: latest.finished_at ? formatDateTime(latest.finished_at) : "", days: days })}
            </p>
            {latest.result?.files_missing ? (
              <Alert tone="warning">
                {latest.result.files_missing === 1
                  ? tr("1 file the storage no longer has was left out; the export's manifest names it.")
                  : tr("{n} files the storage no longer has were left out; the export's manifest names them.", { n: latest.result.files_missing })}
              </Alert>
            ) : null}
            <ul className="stack" style={{ gap: 4 }}>
              {parts.map((p) => (
                <li key={p.id}>
                  <Button size="sm" variant="ghost" onClick={() => save(p)}>
                    {tr("Download {file_name}", { file_name: p.file_name })}
                  </Button>
                  {p.size ? <span className="faint"> {isolate(size(p.size))}</span> : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

interface Usage {
  /** The workspace's address name. */
  slug: string;
  now: Record<string, number>;
  quotas: Record<string, number>;
  /** The operator's plan the workspace is on, by name. */
  plan: string | null;
  state: string;
  note: string | null;
}

/** What the workspace uses, beside what its plan allows. */
const METERS: { id: string; label: string; bytes?: boolean }[] = [
  { id: "people", get label() { return tr("People"); } },
  { id: "storage_bytes", get label() { return tr("Files"); }, bytes: true },
  { id: "ai_tokens_month", get label() { return tr("Assistant this month (tokens)"); } },
  { id: "jobs_month", get label() { return tr("Background jobs this month"); } },
];

function useUsage() {
  return useQuery({ queryKey: ["admin", "usage"], queryFn: ({ signal }) => api.get<Usage>("/api/admin/usage", undefined, signal) });
}

export function size(bytes: number): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  // Bytes are words ("0 bytes"); larger units their short forms ("1.5 kB").
  return new Intl.NumberFormat(undefined, { style: "unit", unit: units[i], unitDisplay: i === 0 ? "long" : "short", maximumFractionDigits: 1 }).format(n);
}

function PlanAndUsage() {
  const q = useUsage();
  const amount = (m: (typeof METERS)[number], n: number) => (m.bytes ? size(n) : n.toLocaleString());
  return (
    <section className="card card-pad stack" style={{ maxWidth: 560 }} aria-labelledby="ws-plan">
      <h2 id="ws-plan" className="section-title">
        {tr("Plan and usage")}
      </h2>
      <Loaded q={q}>
        {(u) => (
          <>
            <p className="muted">{u.plan ? tr("This workspace is on the {plan} plan.", { plan: u.plan }) : tr("This workspace is on no plan: its operator sets what it may use.")}</p>
            {u.state !== "active" && <Alert tone="warning">{(u.note ? tr("This workspace's account is {state}: {note}", { state: u.state, note: u.note }) : tr("This workspace's account is {state}.", { state: u.state }))}</Alert>}
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tr("What")}</th>
                  <th scope="col">{tr("Used")}</th>
                  <th scope="col">{tr("Allowed")}</th>
                </tr>
              </thead>
              <tbody>
                {METERS.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">{isolate(m.label)}</th>
                    <td>{isolate(amount(m, u.now[m.id] ?? 0))}</td>
                    <td>{u.quotas[m.id] === undefined ? tr("No limit") : amount(m, u.quotas[m.id])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Loaded>
    </section>
  );
}

/** Its administrator closes the workspace, typing its name: read-only and kept for a while, then gone. */
function CloseWorkspace() {
  const qc = useQueryClient();
  const q = useUsage();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<string | null>(null);
  const slug = q.data?.slug ?? "";
  const close = async (e: FormEvent) => {
    e.preventDefault();
    if (!(await confirmDialog({ title: tr("Close {slug}?", { slug }), message: tr("Everyone can still read and export it, and nobody can change anything. It is kept for 30 days; after that its operator may delete it."), confirmLabel: tr("Close it"), danger: true })))
      return;
    setBusy(true);
    try {
      const r = await api.post<{ retain_until: string }>("/api/admin/close", { confirm: typed });
      setClosed(r.retain_until);
      // The plan's panel says the account is closed now.
      await qc.invalidateQueries({ queryKey: ["admin", "usage"] });
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card card-pad stack" style={{ maxWidth: 560 }} aria-labelledby="ws-close">
      <h2 id="ws-close" className="section-title">
        {tr("Close this workspace")}
      </h2>
      {closed ? (
        <Alert tone="info">{tr("Closed. It is read-only, and kept until {closed}; ask its operator to open it again before then. Export what you need from each list.", { closed })}</Alert>
      ) : (
        <form className="stack" onSubmit={close}>
          <p className="muted">{tr("Closing makes the workspace read-only for everyone, with export still open, and keeps it for 30 days. Its operator can open it again until then.")}</p>
          <FieldWrap label={tr("Type {slug} to close it", { slug })} htmlFor="ws-close-name">
            <input id="ws-close-name" className="input" value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
          </FieldWrap>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button type="submit" variant="danger" loading={busy} disabled={!slug || typed.trim() !== slug}>
              {tr("Close the workspace")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function WorkspaceForm({ initial }: { initial: WorkspaceSettings }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  // The browser's list may lack the saved zone (an alias such as Asia/Kolkata), so it is always offered.
  const zones = [...new Set(["UTC", initial.timezone, ...Intl.supportedValuesOf("timeZone")])].sort();
  const fyChanged = form.fiscal_year_start_month !== initial.fiscal_year_start_month;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      fyChanged &&
      !(await confirmDialog({
        title: tr("Change when the fiscal year starts?"),
        message: tr("Number series that include the fiscal year, and fiscal-year report periods, use the new start from now on. Existing documents keep their numbers."),
        confirmLabel: tr("Change"),
      }))
    )
      return;
    setBusy(true);
    setErrors([]);
    try {
      await api.put("/api/admin/settings", form);
      toast(tr("Workspace settings saved"));
      // `me` carries the zone that today's date follows (lib/format todayIso).
      await Promise.all(["admin", "me"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) setErrors(err.fields);
      else toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  const fieldError = (name: string) => errors.find((f) => f.field === name)?.message;
  return (
    <form className="card card-pad stack" style={{ maxWidth: 560 }} onSubmit={submit}>
      <FieldWrap
        label={tr("Time zone")}
        htmlFor="ws-tz"
        error={fieldError("timezone")}
        hint={tr("Today's date, date-based number series and report periods follow it. This device uses {timeZone}.", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
      >
        <select id="ws-tz" className="select" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {isolate(z)}
            </option>
          ))}
        </select>
      </FieldWrap>
      <FieldWrap
        label={tr("Language")}
        htmlFor="ws-lang"
        error={fieldError("language")}
        hint={tr("The interface's language, direction and number and date formats for everyone who has not chosen their own.")}
      >
        <select id="ws-lang" className="select" value={form.language ?? ""} onChange={(e) => setForm({ ...form, language: e.target.value || null })}>
          <option value="">{tr("English")}</option>
          {LANGUAGES.filter((l) => l.tag !== "en").map((l) => (
            <option key={l.tag} value={l.tag} lang={l.tag}>
              {isolate(l.name)}
            </option>
          ))}
        </select>
      </FieldWrap>
      <FieldWrap label={tr("Fiscal year starts in")} htmlFor="ws-fy" error={fieldError("fiscal_year_start_month")}>
        <select id="ws-fy" className="select" value={form.fiscal_year_start_month} onChange={(e) => setForm({ ...form, fiscal_year_start_month: Number(e.target.value) })}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {isolate(m)}
            </option>
          ))}
        </select>
      </FieldWrap>
      <FieldWrap
        label={tr("Two-factor sign-in")}
        htmlFor="ws-2fa"
        error={fieldError("require_two_factor")}
        hint={tr("Everyone signs in with a code from an authenticator app too; those without one set it up at their next sign-in.")}
      >
        <label className="row" style={{ gap: 8 }}>
          <input id="ws-2fa" type="checkbox" checked={form.require_two_factor} onChange={(e) => setForm({ ...form, require_two_factor: e.target.checked })} />
          {tr("Require it of everyone")}
        </label>
      </FieldWrap>
      <FieldWrap
        label={tr("Single sign-on")}
        htmlFor="ws-sso"
        error={fieldError("require_sso")}
        hint={tr("Everyone but administrators signs in through a single sign-on provider; administrators keep their passwords for when the provider is down.")}
      >
        <label className="row" style={{ gap: 8 }}>
          <input id="ws-sso" type="checkbox" checked={form.require_sso} onChange={(e) => setForm({ ...form, require_sso: e.target.checked })} />
          {tr("Require it")}
        </label>
      </FieldWrap>
      <FieldWrap
        label={tr("Working offline")}
        htmlFor="ws-offline"
        error={fieldError("offline")}
        hint={tr("What a device keeps for someone to work from without a connection (a till's price book) is forgotten when the time is up, when someone else signs in there, or when they are signed out everywhere. Work done offline is kept until it is sent, whatever this says.")}
      >
        <label className="row" style={{ gap: 8 }}>
          <input
            id="ws-offline"
            type="checkbox"
            checked={form.offline?.allowed !== false}
            onChange={(e) => setForm({ ...form, offline: { ...form.offline, allowed: e.target.checked } })}
          />
          {tr("Devices may keep it for")}
          <input
            className="input"
            type="number"
            min={1}
            max={720}
            style={{ width: 90 }}
            aria-label={tr("Hours devices may keep it")}
            disabled={form.offline?.allowed === false}
            value={form.offline?.hours ?? 72}
            onChange={(e) => setForm({ ...form, offline: { ...form.offline, hours: Number(e.target.value) } })}
          />
          {tr("hours")}
        </label>
      </FieldWrap>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={
            !fyChanged &&
            form.timezone === initial.timezone &&
            form.language === initial.language &&
            form.require_two_factor === initial.require_two_factor &&
            form.require_sso === initial.require_sso &&
            JSON.stringify(form.offline) === JSON.stringify(initial.offline)
          }
        >
          {tr("Save")}
        </Button>
      </div>
    </form>
  );
}

function SecretDialog({ secret, title, note, onClose }: { secret: string | null; title: string; note: string; onClose: () => void }) {
  return (
    <Dialog
      open={!!secret}
      onClose={onClose}
      title={title}
      footer={
        <Button variant="primary" onClick={onClose}>
          {tr("I have stored it")}
        </Button>
      }
    >
      <div className="stack">
        <Alert tone="warning">{isolate(note)}</Alert>
        <div className="secret">
          <code className="mono" style={{ flex: 1 }}>
            {isolate(secret ?? "")}
          </code>
          <Button
            size="sm"
            data-autofocus
            onClick={() =>
              navigator.clipboard.writeText(secret ?? "").then(
                () => toast(tr("Copied to the clipboard")),
                () => toast(tr("Copy failed: select the text and copy it manually"), "error"),
              )
            }
          >
            {tr("Copy")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── users ──

interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_admin: boolean;
  locked: boolean;
  two_factor: boolean;
  /** Linked to an identity at a single sign-on provider. */
  sso: boolean;
  last_login_at?: string | null;
  roles: string[];
  /** The roles held only until a moment, and that moment; the others are held for good. */
  role_until?: Record<string, string>;
  /** member, portal (customers, suppliers: the portal's pages only), guest or service. */
  kind?: string;
}
interface Permission {
  entity: string;
  can_read: boolean;
  can_write: boolean;
  can_create: boolean;
  can_delete: boolean;
  can_submit: boolean;
  can_cancel: boolean;
  can_export: boolean;
  can_import: boolean;
  if_owner: boolean;
  read_groups: string[];
  write_groups: string[];
  /** Only records whose fields hold these values (`where`). */
  match_rule?: Record<string, unknown> | null;
  rule_key?: string;
  /** Own records reached through this path to the person's email (`patient.email`). */
  via?: string | null;
  /** The entity's actions its holders may run on the records it reaches. */
  actions?: string[];
}
interface Role {
  name: string;
  description?: string | null;
  package?: string | null;
  /** For the portal: portal people hold only such roles, which reach only their own records. */
  portal?: boolean;
  permissions: Permission[];
}

const useUsers = () =>
  useQuery({ queryKey: ["admin", "users"], queryFn: ({ signal }) => api.get<{ users: User[] }>("/api/admin/users", undefined, signal) });
const useRoles = () =>
  useQuery({ queryKey: ["admin", "roles"], queryFn: ({ signal }) => api.get<{ roles: Role[] }>("/api/admin/roles", undefined, signal) });

/** The day, in this browser's time, that a role given until `iso` is held through. */
export function throughDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** What is sent for the days the roles kept are held through: each day's close in this browser's
 * time, or the moment a role already ends at when its day was left as it was. */
export function roleEnds(roles: string[], through: Record<string, string>, held: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of roles) {
    const day = through[r];
    if (day) out[r] = held[r] && throughDay(held[r]) === day ? held[r] : new Date(`${day}T23:59:59`).toISOString();
  }
  return out;
}

function RoleChecks({ roles, value, onChange }: { roles: string[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!roles.length) return <p className="faint">{tr("No roles defined yet.")}</p>;
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label" style={{ marginBottom: 6 }}>
        {tr("Roles")}
      </legend>
      <div className="form-grid">
        {roles.map((r) => (
          <label key={r} className="check-field">
            <input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
            {isolate(r)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Users() {
  const users = useUsers();
  const roles = useRoles();
  const me = useMe().data;
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editRoles, setEditRoles] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const roleNames = (roles.data?.roles ?? []).map((r) => r.name);
  // Portal people hold only roles marked for the portal.
  const portalRoleNames = (roles.data?.roles ?? []).filter((r) => r.portal).map((r) => r.name);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const toggleActive = async (u: User) => {
    const ok = await confirmDialog({
      title: u.is_active ? tr("Deactivate {full_name}?", { full_name: u.full_name }) : tr("Activate {full_name}?", { full_name: u.full_name }),
      message: u.is_active ? tr("They will be signed out and can no longer sign in or use API keys.") : tr("They will be able to sign in again."),
      confirmLabel: u.is_active ? tr("Deactivate") : tr("Activate"),
      danger: u.is_active,
    });
    if (ok && (await attempt(() => api.put(`/api/admin/users/${u.id}/active`, { active: !u.is_active }), u.is_active ? tr("User deactivated") : tr("User activated"))))
      void refresh();
  };
  const resetTwoFactor = async (u: User) => {
    const ok = await confirmDialog({
      title: tr("Reset two-factor sign-in for {full_name}?", { full_name: u.full_name }),
      message: tr("For a lost phone: it turns their two-factor sign-in off, lifts a lockout and signs them out everywhere. If the workspace requires it, they set it up again at their next sign-in."),
      confirmLabel: tr("Reset"),
      danger: true,
    });
    if (ok && (await attempt(() => api.post(`/api/admin/users/${u.id}/two-factor/reset`), tr("Two-factor sign-in reset")))) void refresh();
  };
  const unlinkSso = async (u: User) => {
    const ok = await confirmDialog({
      title: tr("Unlink {full_name} from single sign-on?", { full_name: u.full_name }),
      message: tr("For an identity that changed at the provider, or an account handed to someone else: their next single sign-on links the identity it brings."),
      confirmLabel: tr("Unlink"),
    });
    if (ok && (await attempt(() => api.post(`/api/admin/users/${u.id}/sso/unlink`), tr("Unlinked")))) void refresh();
  };
  const changeKind = async (u: User) => {
    const toPortal = (u.kind ?? "member") === "member";
    const ok = await confirmDialog({
      title: toPortal ? tr("Make {full_name} a portal person?", { full_name: u.full_name }) : tr("Make {full_name} a member?", { full_name: u.full_name }),
      message: toPortal
        ? tr("They will see only the workspace's portal (their tickets, their invoices…), sign in with codes sent by email, and hold only portal roles: their other roles count for nothing. They are signed out everywhere now.")
        : tr("They will use the workspace's apps with the roles you give them. They are signed out everywhere now."),
      confirmLabel: toPortal ? tr("Make portal person") : tr("Make member"),
    });
    if (ok && (await attempt(() => api.put(`/api/admin/users/${u.id}/kind`, { kind: toPortal ? "portal" : "member" }), tr("Changed")))) void refresh();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Users")}</h2>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          {tr("New user")}
        </Button>
      </div>
      <Loaded q={users}>
        {(data) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tr("User")}</th>
                  <th scope="col">{tr("Roles")}</th>
                  <th scope="col">{tr("Status")}</th>
                  <th scope="col">{tr("Last sign-in")}</th>
                  <th scope="col">
                    <span className="sr-only">{tr("Actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div>
                        {isolate(u.full_name)} {u.is_admin && <Badge tone="purple">{tr("admin")}</Badge>}{isolate(" ")}
                        {u.kind && u.kind !== "member" && <Badge tone="amber">{isolate(u.kind)}</Badge>}
                      </div>
                      <div className="muted">{isolate(u.email)}</div>
                    </td>
                    <td>
                      <div className="chips">
                        {u.roles.length ? (
                          u.roles.map((r) => (
                            <Badge key={r}>
                              {isolate(r)}
                              {u.role_until?.[r] && tr(" through {value}", { value: formatDate(throughDay(u.role_until[r])) })}
                            </Badge>
                          ))
                        ) : (
                          <span className="faint">{tr("none")}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="chips">
                        <Badge tone={u.is_active ? "green" : "red"}>{u.is_active ? tr("active") : tr("inactive")}</Badge>
                        {u.locked && <Badge tone="red">{tr("locked")}</Badge>}
                        {u.two_factor && <Badge tone="blue">{tr("2FA")}</Badge>}
                        {u.sso && <Badge tone="purple">{tr("SSO")}</Badge>}
                      </div>
                    </td>
                    <td className="nowrap">{u.last_login_at ? relativeTime(u.last_login_at) : <span className="faint">{tr("never")}</span>}</td>
                    <td>
                      <div className="row">
                        <Button size="sm" onClick={() => setEditRoles(u)}>
                          {tr("Roles")}
                        </Button>
                        <Button size="sm" onClick={() => setResetting(u)}>
                          {tr("Reset password")}
                        </Button>
                        {u.two_factor && (
                          <Button size="sm" onClick={() => void resetTwoFactor(u)}>
                            {tr("Reset 2FA")}
                          </Button>
                        )}
                        {u.sso && (
                          <Button size="sm" onClick={() => void unlinkSso(u)}>
                            {tr("Unlink SSO")}
                          </Button>
                        )}
                        {u.id !== me?.user.id && (u.kind ?? "member") !== "service" && (
                          <Button size="sm" onClick={() => void changeKind(u)}>
                            {(u.kind ?? "member") === "member" ? tr("Make portal person") : tr("Make member")}
                          </Button>
                        )}
                        <Button size="sm" variant={u.is_active ? "danger" : "default"} disabled={u.id === me?.user.id} onClick={() => void toggleActive(u)}>
                          {u.is_active ? tr("Deactivate") : tr("Activate")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
      <NewUserDialog open={creating} roles={roleNames} portalRoles={portalRoleNames} onClose={() => setCreating(false)} onDone={refresh} />
      <EditRolesDialog user={editRoles} roles={editRoles?.kind === "portal" ? portalRoleNames : roleNames} onClose={() => setEditRoles(null)} onDone={refresh} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </section>
  );
}

function NewUserDialog({ open, roles, portalRoles, onClose, onDone }: { open: boolean; roles: string[]; portalRoles: string[]; onClose: () => void; onDone: () => void }) {
  const empty = { email: "", full_name: "", password: "", is_admin: false, roles: [] as string[], kind: "member" };
  const [u, setU] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setU(empty);
    setError(null);
    onClose();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const portal = u.kind === "portal";
      await api.post("/api/admin/users", {
        ...u,
        email: u.email.trim(),
        full_name: u.full_name.trim(),
        // Portal people sign in with emailed codes and hold only portal roles.
        password: portal ? undefined : u.password || undefined,
        roles: portal ? u.roles.filter((r) => portalRoles.includes(r)) : u.roles,
        is_admin: portal ? false : u.is_admin,
      });
      toast(tr("User created"));
      onDone();
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={close} title={tr("New user")}>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{isolate(error)}</Alert>}
        <FieldWrap label={tr("Email")} htmlFor="nu-email" required>
          <input id="nu-email" className="input" type="email" autoComplete="off" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} required />
        </FieldWrap>
        <FieldWrap label={tr("Full name")} htmlFor="nu-name" required>
          <input id="nu-name" className="input" value={u.full_name} onChange={(e) => setU({ ...u, full_name: e.target.value })} required />
        </FieldWrap>
        <FieldWrap
          label={tr("Kind")}
          htmlFor="nu-kind"
          hint={u.kind === "portal" ? tr("A customer or supplier: only the workspace's portal, signing in with codes sent to this email.") : tr("Someone of the workspace, using its apps.")}
        >
          <select id="nu-kind" className="input" value={u.kind} onChange={(e) => setU({ ...u, kind: e.target.value })}>
            <option value="member">{tr("Member")}</option>
            <option value="portal">{tr("Portal person")}</option>
          </select>
        </FieldWrap>
        {u.kind !== "portal" && (
          <>
            <FieldWrap label={tr("Initial password")} htmlFor="nu-pw" hint={tr("Optional. At least 10 characters with 3 of: lower, upper, digit, symbol.")}>
              <input id="nu-pw" className="input" type="password" autoComplete="new-password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} />
            </FieldWrap>
            <label className="check-field">
              <input type="checkbox" checked={u.is_admin} onChange={(e) => setU({ ...u, is_admin: e.target.checked })} />
              {tr("Administrator")}
            </label>
            <RoleChecks roles={roles} value={u.roles} onChange={(r) => setU({ ...u, roles: r })} />
          </>
        )}
        {u.kind === "portal" && portalRoles.length > 0 && <RoleChecks roles={portalRoles} value={u.roles} onChange={(r) => setU({ ...u, roles: r })} />}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={close}>{tr("Cancel")}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {tr("Create user")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditRolesDialog({ user, roles, onClose, onDone }: { user: User | null; roles: string[]; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState<string[]>([]);
  const [through, setThrough] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  if (user !== seen) {
    setSeen(user);
    setValue(user?.roles ?? []);
    setThrough(Object.fromEntries(Object.entries(user?.role_until ?? {}).map(([r, iso]) => [r, throughDay(iso)])));
  }
  const save = async () => {
    if (!user) return;
    setBusy(true);
    const until = roleEnds(value, through, user.role_until);
    const ok = await attempt(() => api.put(`/api/admin/users/${user.id}/roles`, { roles: value, until }), tr("Roles updated"));
    setBusy(false);
    if (ok) {
      onDone();
      onClose();
    }
  };
  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      title={tr("Roles of {value}", { value: user?.full_name ?? "" })}
      footer={
        <>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {tr("Save roles")}
          </Button>
        </>
      }
    >
      <RoleChecks roles={roles} value={value} onChange={setValue} />
      {value.length > 0 && (
        <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
          <legend className="field-label" style={{ marginBottom: 6 }}>
            {tr("Held through (optional)")}
          </legend>
          <div className="form-grid">
            {value.map((r) => (
              <FieldWrap key={r} label={r} htmlFor={`role-through-${r}`}>
                <input
                  id={`role-through-${r}`}
                  className="input"
                  type="date"
                  min={throughDay(new Date().toISOString())}
                  value={through[r] ?? ""}
                  onChange={(e) => setThrough({ ...through, [r]: e.target.value })}
                />
              </FieldWrap>
            ))}
          </div>
          <p className="faint">{tr("Empty: held for good. A role with a day ends when that day does, and what it allowed ends with it.")}</p>
        </fieldset>
      )}
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setPw("");
    setError(null);
    onClose();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/users/${user.id}/password`, { password: pw });
      toast(tr("Password reset for {full_name}", { full_name: user.full_name }));
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!user} onClose={close} title={tr("Reset password for {value}", { value: user?.full_name ?? "" })}>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{isolate(error)}</Alert>}
        <FieldWrap label={tr("New password")} htmlFor="rp-pw" required hint={tr("Their existing sessions are signed out.")}>
          <input id="rp-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} />
        </FieldWrap>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={close}>{tr("Cancel")}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {tr("Reset password")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── roles & permissions ──

const ACTIONS = ["read", "write", "create", "delete", "submit", "cancel", "export", "import"] as const;

/** Field types a rule's condition may test (the server checks the same list). */
const CONDITION_TYPES = new Set(["data", "select", "check", "link", "email", "int"]);

/** Values typed for a condition, as the field's JSON type. */
export function conditionValues(type: string | undefined, typed: string): unknown[] {
  const parts = typed
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (type === "check") return parts.map((v) => v.toLowerCase() === "true" || v === "1");
  if (type === "int") return parts.map((v) => Number(v)).filter((n) => Number.isInteger(n));
  return parts;
}

/** A stored condition in words (`Customer Type is Individual or Company`), links by title. */
function ConditionText({ entity, cond }: { entity: string; cond: Record<string, unknown> }) {
  const fields = useEntityMeta(entity).data?.fields;
  return (
    <span>
      {Object.entries(cond).map(([k, v], i) => {
        const f = fields?.find((x) => x.name === k);
        return (
          <span key={k}>
            {i > 0 && "; "}
            {f?.label ?? k} {tr("is")}{isolate(" ")}
            {(Array.isArray(v) ? v : [v]).map(String).map((x, j) => (
              <span key={x}>
                {j > 0 && tr(" or ")}
                {f?.type === "link" && f.to ? <LinkTitle to={f.to} id={x} /> : x}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

/** The values a rule's condition accepts, in the input that suits the field. */
function ConditionInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  if (field.type === "link" && field.to) {
    return (
      <FieldWrap label="is" htmlFor="perm-values">
        <LinkInput id="perm-values" to={field.to} linkFilters={field.link_filters} value={value || null} required onChange={(id) => onChange(id ?? "")} />
      </FieldWrap>
    );
  }
  if (field.type === "check") {
    return (
      <FieldWrap label="is" htmlFor="perm-values">
        <select id="perm-values" className="select" value={value || "true"} onChange={(e) => onChange(e.target.value)}>
          <option value="true">{tr("Ticked")}</option>
          <option value="false">{tr("Not ticked")}</option>
        </select>
      </FieldWrap>
    );
  }
  if (field.type === "select" && field.options?.length) {
    const options = field.options;
    const picked = new Set(value.split(",").filter(Boolean));
    const toggle = (o: string) => onChange(options.filter((x) => (x === o ? !picked.has(o) : picked.has(x))).join(","));
    return (
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, gap: 12 }}>
        <legend className="field-label">{tr("is one of")}</legend>
        {options.map((o) => (
          <label key={o} className="check-field">
            <input type="checkbox" checked={picked.has(o)} onChange={() => toggle(o)} /> {isolate(o)}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <FieldWrap label={tr("is one of")} htmlFor="perm-values" hint={tr("Comma-separated")}>
      <input id="perm-values" className="input" required value={value} onChange={(e) => onChange(e.target.value)} />
    </FieldWrap>
  );
}

function Roles() {
  const roles = useRoles();
  const index = useMetaIndex().data;
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>("");
  const [newRole, setNewRole] = useState("");
  const [extraRoles, setExtraRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [addEntity, setAddEntity] = useState("");
  const [addOwner, setAddOwner] = useState(false);
  const [addVia, setAddVia] = useState("");
  const [addActions, setAddActions] = useState<string[]>([]);
  const [addField, setAddField] = useState("");
  const [addValues, setAddValues] = useState("");
  const addMeta = useEntityMeta(addEntity && addEntity !== "*" ? addEntity : undefined).data;
  const conditionFields = (addMeta?.fields ?? []).filter((f) => CONDITION_TYPES.has(f.type));
  const conditionField = conditionFields.find((f) => f.name === addField);

  const all = roles.data?.roles ?? [];
  const names = [...all.map((r) => r.name), ...extraRoles.filter((n) => !all.some((r) => r.name === n))];
  const current = selected || names[0] || "";
  const role = all.find((r) => r.name === current);
  const perms = role?.permissions ?? [];

  const put = async (p: Permission, key: string) => {
    setSaving(key);
    const body = {
      entity: p.entity,
      read: p.can_read,
      write: p.can_write,
      create: p.can_create,
      delete: p.can_delete,
      submit: p.can_submit,
      cancel: p.can_cancel,
      export: p.can_export,
      import: p.can_import,
      if_owner: p.if_owner,
      read_groups: p.read_groups ?? [],
      write_groups: p.write_groups ?? [],
      where: p.match_rule ?? undefined,
      via: p.via || undefined,
      actions: p.actions ?? [],
    };
    const ok = await attempt(() => api.put(`/api/admin/roles/${encodeURIComponent(current)}/permissions`, body));
    if (ok) await qc.invalidateQueries({ queryKey: ["admin", "roles"] });
    setSaving(null);
    return ok;
  };

  const addRow = async (e: FormEvent) => {
    e.preventDefault();
    if (!addEntity) return;
    const ok = await put(
      {
        entity: addEntity,
        can_read: true,
        can_write: false,
        can_create: false,
        can_delete: false,
        can_submit: false,
        can_cancel: false,
        can_export: false,
        can_import: false,
        if_owner: addOwner || !!addVia.trim() || !!role?.portal,
        read_groups: [],
        write_groups: [],
        match_rule: conditionField ? { [conditionField.name]: conditionValues(conditionField.type, conditionField.type === "check" ? addValues || "true" : addValues) } : null,
        via: addVia.trim() || null,
        actions: addActions,
      },
      "add",
    );
    if (ok) {
      toast(tr("{addEntity} added to {current}", { addEntity, current }));
      setAddEntity("");
      setAddOwner(false);
      setAddVia("");
      setAddActions([]);
      setAddField("");
      setAddValues("");
    }
  };

  const entities = [...(index?.entities ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const label = (name: string) => (name === "*" ? tr("All entities (*)") : (index?.entities.find((e) => e.name === name)?.label ?? name));

  return (
    <Loaded q={roles}>
      {() => (
        <div className="stack">
          <div className="card card-pad row">
            <FieldWrap label={tr("Role")} htmlFor="role-pick">
              <select id="role-pick" className="select" style={{ minWidth: 240 }} value={current} onChange={(e) => setSelected(e.target.value)}>
                {names.map((n) => (
                  <option key={n} value={n}>
                    {isolate(n)}
                  </option>
                ))}
              </select>
            </FieldWrap>
            <form
              className="row"
              style={{ alignItems: "flex-end" }}
              onSubmit={(e) => {
                e.preventDefault();
                const n = newRole.trim();
                if (!n) return;
                setExtraRoles((r) => [...r, n]);
                setSelected(n);
                setNewRole("");
              }}
            >
              <FieldWrap label={tr("New role")} htmlFor="role-new" hint={tr("Created when you grant its first permission.")}>
                <input id="role-new" className="input" value={newRole} onChange={(e) => setNewRole(e.target.value)} maxLength={100} />
              </FieldWrap>
              <Button type="submit">{tr("Add role")}</Button>
            </form>
          </div>
          {role?.description && <p className="muted">{isolate(role.description)}</p>}
          {role && <PortalMark role={role} onChanged={() => void qc.invalidateQueries({ queryKey: ["admin", "roles"] })} />}
          <section className="card" aria-label={tr("Permissions of {current}", { current })}>
            <div className="table-wrap">
              <table className="table matrix">
                <thead>
                  <tr>
                    <th scope="col">{tr("Entity")}</th>
                    {ACTIONS.map((a) => (
                      <th key={a} scope="col">
                        {isolate(a)}
                      </th>
                    ))}
                    <th scope="col">{tr("Applies to")}</th>
                  </tr>
                </thead>
                <tbody>
                  {!perms.length && (
                    <tr>
                      <td colSpan={ACTIONS.length + 2} className="muted">
                        {tr("This role has no permissions yet.")}
                      </td>
                    </tr>
                  )}
                  {perms.map((p) => {
                    const key = `${p.entity}|${p.if_owner}|${p.rule_key ?? ""}`;
                    return (
                      <tr key={key}>
                        <td>{isolate(label(p.entity))}</td>
                        {ACTIONS.map((a) => {
                          const k = `can_${a}` as const;
                          return (
                            <td key={a}>
                              <label className="cell-check">
                                <input
                                  type="checkbox"
                                  aria-label={`${a} ${label(p.entity)}`}
                                  checked={p[k]}
                                  disabled={saving === key || (!!role?.portal && PORTAL_REFUSED.has(a) && !p[k])}
                                  onChange={(e) => void put({ ...p, [k]: e.target.checked }, key)}
                                />
                              </label>
                            </td>
                          );
                        })}
                        <td>
                          {p.if_owner && <Badge tone="amber">{tr("own only")}</Badge>}{isolate(" ")}
                          {p.via && (
                            <span className="muted">
                              {tr("through")} <code>{p.via}</code>{" "}
                            </span>
                          )}
                          {!!p.actions?.length && <span className="muted">{tr("may run {actions}", { actions: p.actions.join(", ") })} </span>}
                          {p.match_rule && Object.keys(p.match_rule).length > 0 ? (
                            <ConditionText entity={p.entity} cond={p.match_rule} />
                          ) : (
                            !p.if_owner && <span className="faint">{tr("all")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <form className="toolbar" style={{ borderBottom: 0, borderTop: "1px solid var(--border)" }} onSubmit={addRow}>
              <FieldWrap label={tr("Grant access to")} htmlFor="perm-entity" className="field-wide">
                <select id="perm-entity" className="select" value={addEntity} onChange={(e) => setAddEntity(e.target.value)}>
                  <option value="">{tr("Choose an entity…")}</option>
                  <option value="*">{tr("All entities (*)")}</option>
                  {entities.map((e) => (
                    <option key={e.name} value={e.name}>
                      {isolate(e.label)}
                    </option>
                  ))}
                </select>
              </FieldWrap>
              <label className="check-field">
                <input type="checkbox" checked={addOwner || !!role?.portal} disabled={!!role?.portal} onChange={(e) => setAddOwner(e.target.checked)} />
                {tr("Own records only")}
              </label>
              {addEntity && addEntity !== "*" && (
                <FieldWrap label={tr("Theirs through")} htmlFor="perm-via" hint={tr("Optional: a path from the record to their email, e.g. patient.email or student.guardians.email")}>
                  <input id="perm-via" className="input" value={addVia} onChange={(e) => setAddVia(e.target.value)} maxLength={200} spellCheck={false} />
                </FieldWrap>
              )}
              {!!addMeta?.actions?.length && (
                <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, gap: 12 }}>
                  <legend className="field-label">{tr("May run")}</legend>
                  {addMeta.actions.map((a) => (
                    <label key={a.name} className="check-field">
                      <input type="checkbox" checked={addActions.includes(a.name)} onChange={(e) => setAddActions(e.target.checked ? [...addActions, a.name] : addActions.filter((x) => x !== a.name))} /> {isolate(a.label)}
                    </label>
                  ))}
                </fieldset>
              )}
              {conditionFields.length > 0 && (
                <>
                  <FieldWrap label={tr("Only where")} htmlFor="perm-field" hint={tr("Optional: records whose field holds one of the values")}>
                    <select
                      id="perm-field"
                      className="select"
                      value={addField}
                      onChange={(e) => {
                        setAddField(e.target.value);
                        setAddValues("");
                      }}
                    >
                      <option value="">{tr("Any record")}</option>
                      {conditionFields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {isolate(f.label)}
                        </option>
                      ))}
                    </select>
                  </FieldWrap>
                  {conditionField && <ConditionInput field={conditionField} value={addValues} onChange={setAddValues} />}
                </>
              )}
              <Button type="submit" icon="plus" disabled={!addEntity || !current || (!!conditionField && conditionField.type !== "check" && !addValues)} loading={saving === "add"}>
                {tr("Add")}
              </Button>
            </form>
          </section>
          <RoleConflicts roles={names} />
          <ExplainAccess roles={names} entities={entities} />
        </div>
      )}
    </Loaded>
  );
}

/** What a portal role may not do (the server refuses the same). */
const PORTAL_REFUSED = new Set(["delete", "cancel", "export", "import"]);

/** Whether a role is for the portal: portal people hold only such roles, and such a role reaches only
 * its holders' own records, never deleting, cancelling, exporting or importing them. */
function PortalMark({ role, onChanged }: { role: Role; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async (portal: boolean) => {
    setBusy(true);
    const ok = await attempt(() => api.put(`/api/admin/roles/${encodeURIComponent(role.name)}/portal`, { portal }), portal ? tr("{name} is for the portal", { name: role.name }) : tr("{name} is no longer for the portal", { name: role.name }));
    setBusy(false);
    if (ok) onChanged();
  };
  return (
    <label className="check-field">
      <input type="checkbox" checked={!!role.portal} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
      {tr("For the portal")}
      <span className="faint">{tr("Portal people hold only such roles; each rule reaches only their own records, never deleting, cancelling, exporting or importing them.")}</span>
    </label>
  );
}

interface RoleConflict {
  role_a: string;
  role_b: string;
  reason: string;
  /** Who holds both, having held them before the pair was declared. */
  holders: { id: string; email: string; full_name: string }[];
}

/** Pairs of roles one person may not hold together (segregation of duties): from the moment one is
 * declared the server refuses any grant that would join them, whichever way it comes. */
function RoleConflicts({ roles }: { roles: string[] }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "role-conflicts"],
    queryFn: ({ signal }) => api.get<{ conflicts: RoleConflict[] }>("/api/admin/role-conflicts", undefined, signal),
  });
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "role-conflicts"] });
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await attempt(() => api.put("/api/admin/role-conflicts", { role_a: a, role_b: b, reason }), tr("No one is given both {a} and {b} from now", { a, b }));
    setBusy(false);
    if (ok) {
      setA("");
      setB("");
      setReason("");
      void refresh();
    }
  };
  const remove = async (c: RoleConflict) => {
    const ok = await confirmDialog({
      title: tr("Allow {role_a} and {role_b} together?", { role_a: c.role_a, role_b: c.role_b }),
      message: tr("One person may then be given both."),
      confirmLabel: tr("Allow together"),
      danger: true,
    });
    if (ok && (await attempt(() => api.del("/api/admin/role-conflicts", { query: { role_a: c.role_a, role_b: c.role_b } }), tr("Allowed together")))) void refresh();
  };
  return (
    <section className="card card-pad stack" aria-labelledby="conflicts-title">
      <h2 id="conflicts-title" className="section-title">
        {tr("Roles one person may not hold together")}
      </h2>
      <Loaded q={q}>
        {(d) =>
          d.conflicts.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{tr("Roles")}</th>
                    <th>{tr("Why")}</th>
                    <th>{tr("Held by both")}</th>
                    <th aria-label={tr("Actions")} />
                  </tr>
                </thead>
                <tbody>
                  {d.conflicts.map((c) => (
                    <tr key={`${c.role_a}\u0000${c.role_b}`}>
                      <td>
                        <Badge>{isolate(c.role_a)}</Badge> {tr("and")} <Badge>{isolate(c.role_b)}</Badge>
                      </td>
                      <td>{isolate(c.reason)}</td>
                      <td>
                        {c.holders.length ? (
                          <div className="chips">
                            {c.holders.map((h) => (
                              <Badge key={h.id} tone="red">
                                {h.full_name || h.email}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="faint">{tr("no one")}</span>
                        )}
                      </td>
                      <td>
                        <Button onClick={() => void remove(c)}>{tr("Allow together")}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{tr("None yet: anyone may be given any roles together.")}</p>
          )
        }
      </Loaded>
      <form className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }} onSubmit={(e) => void add(e)}>
        <FieldWrap label={tr("Role")} htmlFor="conflict-a">
          <select id="conflict-a" className="select" value={a} onChange={(e) => setA(e.target.value)} required>
            <option value="">{tr("Choose a role…")}</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {isolate(r)}
              </option>
            ))}
          </select>
        </FieldWrap>
        <FieldWrap label={tr("Is not held with")} htmlFor="conflict-b">
          <select id="conflict-b" className="select" value={b} onChange={(e) => setB(e.target.value)} required>
            <option value="">{tr("Choose a role…")}</option>
            {roles
              .filter((r) => r !== a)
              .map((r) => (
                <option key={r} value={r}>
                  {isolate(r)}
                </option>
              ))}
          </select>
        </FieldWrap>
        <FieldWrap label={tr("Because")} htmlFor="conflict-why" className="field-wide">
          <input
            id="conflict-why"
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={500}
            placeholder={tr("e.g. whoever adds suppliers does not pay them")}
          />
        </FieldWrap>
        <Button type="submit" icon="plus" loading={busy} disabled={!a || !b || !reason.trim()}>
          {tr("Add")}
        </Button>
      </form>
    </section>
  );
}

interface Explanation {
  allowed: boolean;
  reason: string;
  roles?: string[];
  rules?: { role: string; entity: string; if_owner: boolean; where?: Record<string, unknown> | null }[];
  /** The fields their scopes limit the records by (`id` for the scoped entity itself). */
  scoped_by?: string[];
  simulated?: boolean;
}

/** Why someone may or may not do something, as the server decides it, or what other roles would
 * let them do without changing anything. */
function ExplainAccess({ roles, entities }: { roles: string[]; entities: { name: string; label: string }[] }) {
  const users = useUsers();
  const [user, setUser] = useState("");
  const [action, setAction] = useState("read");
  const [entity, setEntity] = useState("");
  const [record, setRecord] = useState<string | null>(null);
  const [simulate, setSimulate] = useState(false);
  const [as, setAs] = useState<string[]>([]);
  const [answer, setAnswer] = useState<{ asked: string; is: Explanation } | null>(null);
  const [busy, setBusy] = useState(false);
  // Portal people and guests hold no roles: the pages apps give them answer for them.
  const people = (users.data?.users ?? []).filter((u) => u.kind !== "portal" && u.kind !== "guest");
  // An answer is shown only while the question is the one it answers.
  const asked = JSON.stringify([user, action, entity, record, simulate ? as : null]);
  const ask = async (e: FormEvent) => {
    e.preventDefault();
    const query: Record<string, string> = { user, entity, action };
    if (record) query.record = record;
    if (simulate) query.roles = as.join(",");
    setBusy(true);
    await attempt(async () => setAnswer({ asked, is: await api.get<Explanation>("/api/admin/access/explain", query) }));
    setBusy(false);
  };
  return (
    <section className="card card-pad stack" aria-labelledby="explain-title">
      <h2 id="explain-title" className="section-title">
        {tr("Why may they, or not?")}
      </h2>
      <form className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }} onSubmit={(e) => void ask(e)}>
        <FieldWrap label={tr("Person")} htmlFor="explain-user">
          <select id="explain-user" className="select" value={user} onChange={(e) => setUser(e.target.value)} required>
            <option value="">{tr("Choose someone…")}</option>
            {people.map((u) => (
              <option key={u.id} value={u.id}>
                {isolate(u.full_name)} ({isolate(u.email)})
              </option>
            ))}
          </select>
        </FieldWrap>
        <FieldWrap label={tr("Do")} htmlFor="explain-action">
          <select id="explain-action" className="select" value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {isolate(a)}
              </option>
            ))}
          </select>
        </FieldWrap>
        <FieldWrap label={tr("Entity")} htmlFor="explain-entity">
          <select
            id="explain-entity"
            className="select"
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setRecord(null);
            }}
            required
          >
            <option value="">{tr("Choose an entity…")}</option>
            {entities.map((e) => (
              <option key={e.name} value={e.name}>
                {isolate(e.label)}
              </option>
            ))}
          </select>
        </FieldWrap>
        {entity && (
          <FieldWrap label={tr("This record (optional)")} htmlFor="explain-record">
            <LinkInput id="explain-record" to={entity} value={record} onChange={(id) => setRecord(id)} />
          </FieldWrap>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!user || !entity}>
          {tr("Explain")}
        </Button>
      </form>
      {answer?.asked === asked && (
        <div role="status" className="stack">
          <div>
            <Badge tone={answer.is.allowed ? "green" : "red"}>{answer.is.allowed ? tr("allowed") : tr("not allowed")}</Badge> {answer.is.simulated && <Badge tone="amber">{tr("as if")}</Badge>}{isolate(" ")}
            {answer.is.reason.charAt(0).toUpperCase() + answer.is.reason.slice(1)}.
          </div>
          {answer.is.roles && <p className="muted">{tr("Roles:")} {answer.is.roles.length ? answer.is.roles.join(", ") : tr("none")}</p>}
          {!!answer.is.rules?.length && (
            <ul className="muted" style={{ margin: 0 }}>
              {answer.is.rules.map((r, i) => (
                <li key={i}>
                  {isolate(r.role)}: {r.entity === "*" ? tr("every entity") : r.entity}
                  {r.if_owner && tr(", their own records")}
                  {r.where && tr(", where {value}", { value: JSON.stringify(r.where) })}
                </li>
              ))}
            </ul>
          )}
          {!!answer.is.scoped_by?.length && <p className="muted">{tr("Limited by their scopes on: {value}", { value: answer.is.scoped_by.join(", ") })}</p>}
        </div>
      )}
      <label className="check-field">
        <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
        {tr("As if they held other roles (nothing changes)")}
      </label>
      {simulate && <RoleChecks roles={roles} value={as} onChange={setAs} />}
    </section>
  );
}

// ── packages ──

interface Package {
  name: string;
  label?: string | null;
  version: string;
  description?: string | null;
  depends: string[];
  installed: boolean;
}

function Packages() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "packages"], queryFn: ({ signal }) => api.get<{ packages: Package[] }>("/api/admin/packages", undefined, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const install = async (p: Package) => {
    const ok = await confirmDialog({
      title: tr("Install {value}?", { value: p.label ?? p.name }),
      message: (p.depends.length ? tr("This adds its entities, roles and data to the workspace (requires {value1}).", { value1: p.depends.join(", ") }) : tr("This adds its entities, roles and data to the workspace.")),
      confirmLabel: tr("Install"),
    });
    if (!ok) return;
    setBusy(p.name);
    if (await attempt(() => api.post("/api/admin/packages", { packages: [p.name] }), tr("{value} installed", { value: p.label ?? p.name }))) {
      await Promise.all(["admin", "meta", "me", "reports"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    }
    setBusy(null);
  };
  return (
    <div className="stack">
      <Loaded q={q}>
        {(data) => (
          <div className="home-grid">
            {data.packages.map((p) => (
              <section key={p.name} className="card">
                <div className="card-head">
                  <h2>{isolate(p.label ?? p.name)}</h2>
                  <span className="faint mono">
                    {isolate(p.name)}@{isolate(p.version)}
                  </span>
                  <span className="spacer" />
                  {p.installed ? (
                    <Badge tone="green">{tr("installed")}</Badge>
                  ) : (
                    <Button size="sm" variant="primary" loading={busy === p.name} onClick={() => void install(p)}>
                      {tr("Install")}
                    </Button>
                  )}
                </div>
                <div className="card-body stack" style={{ gap: 8 }}>
                  <p className="muted">{isolate(p.description ?? "")}</p>
                  {p.depends.length > 0 && <p className="faint">{tr("Requires: {value}", { value: p.depends.join(", ") })}</p>}
                </div>
              </section>
            ))}
          </div>
        )}
      </Loaded>
      <Backfills />
    </div>
  );
}

interface Backfill {
  package: string;
  name: string;
  state: "waiting" | "running" | "done";
  changed: number;
  remaining: number | null;
  finished_at: string | null;
  needing_now: number;
}

const BACKFILL_STATE: Record<Backfill["state"], { tone: "green" | "amber" | "neutral"; text: string }> = {
  waiting: { tone: "neutral", get text() { return tr("Waiting for the upkeep"); } },
  running: { tone: "amber", get text() { return tr("Running"); } },
  done: { tone: "green", get text() { return tr("Done"); } },
};

/** Data the installed packages' releases move in batches: how far each got, and the rows it could
 *  not change (put them right, then run it again). Nothing shows while no package moves any. */
function Backfills() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "backfills"], queryFn: ({ signal }) => api.get<{ backfills: Backfill[] }>("/api/admin/backfills", undefined, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const rerun = async (b: Backfill) => {
    const key = `${b.package}/${b.name}`;
    const ok = await confirmDialog({ title: tr("Run {key} again?", { key }), message: tr("It runs from the start at the next upkeep, over the rows that still need it."), confirmLabel: tr("Run again") });
    if (!ok) return;
    setBusy(key);
    if (await attempt(() => api.post(`/api/admin/backfills/${encodeURIComponent(b.package)}/${encodeURIComponent(b.name)}/rerun`, {}), tr("{key} runs again at the next upkeep", { key }))) {
      await qc.invalidateQueries({ queryKey: ["admin", "backfills"] });
    }
    setBusy(null);
  };
  return (
    <Loaded q={q}>
      {(data) =>
        data.backfills.length === 0 ? null : (
          <section className="card">
            <div className="card-head">
              <h2>{tr("Data moves")}</h2>
            </div>
            <div className="card-body table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Backfill")}</th>
                    <th scope="col">{tr("State")}</th>
                    <th scope="col">{tr("Rows changed")}</th>
                    <th scope="col">{tr("It could not change")}</th>
                    <th scope="col">{tr("Need it now")}</th>
                    <th scope="col">{tr("Finished")}</th>
                    <th scope="col">
                      <span className="sr-only">{tr("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.backfills.map((b) => {
                    const key = `${b.package}/${b.name}`;
                    return (
                      <tr key={key}>
                        <td className="mono">{isolate(key)}</td>
                        <td>
                          <Badge tone={BACKFILL_STATE[b.state].tone}>{isolate(BACKFILL_STATE[b.state].text)}</Badge>
                        </td>
                        <td>{b.changed}</td>
                        <td>{b.remaining ?? ""}</td>
                        <td>{b.needing_now}</td>
                        <td>{b.finished_at ? formatDateTime(b.finished_at) : ""}</td>
                        <td>
                          {b.state === "done" && (
                            <Button size="sm" loading={busy === key} onClick={() => void rerun(b)}>
                              {tr("Run again")}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      }
    </Loaded>
  );
}

// ── webhooks ──

interface Webhook {
  id: string;
  name: string;
  url: string;
  topics: string[];
  is_active: boolean;
  created_at: string;
  pending: number;
  dead: number;
  /** The app whose service hears of events through it: it goes with the app, not by hand. */
  app?: string | null;
}

// ── domains ──

interface Domain {
  host: string;
  kind: "subdomain" | "custom";
  target: string;
  is_primary: boolean;
  status: "verified" | "pending" | "failing" | "released";
  verified_at?: string | null;
  checked_at: string | null;
  released_at: string | null;
}

const TARGET_LABEL = (t: string, apps: { app: string; title: string }[]) =>
  t === "shell" ? tr("This workspace") : t === "portal" ? tr("The portal") : tr("{value}'s public site", { value: apps.find((a) => `site:${a.app}` === t)?.title ?? t.slice(5) });

const DOMAIN_STATUS: Record<Domain["status"], { tone: "green" | "amber" | "red" | "neutral"; text: string }> = {
  verified: { tone: "green", get text() { return tr("Working"); } },
  pending: { tone: "amber", get text() { return tr("Waiting for DNS"); } },
  failing: { tone: "red", get text() { return tr("Not reaching Ferrum"); } },
  released: { tone: "neutral", get text() { return tr("Released, redirecting"); } },
};

/** The workspace's own addresses: for itself, its portal and its apps' public sites. A custom
 *  domain works once it points at the cluster: Ferrum checks it every few minutes (or now). */
function Domains() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "domains"],
    queryFn: ({ signal }) => api.get<{ domains: Domain[]; point_to: string | null; sites?: { app: string; title: string }[] }>("/api/admin/domains", undefined, signal),
  });
  // Only the apps that serve a public site: the server says which.
  const sites = q.data?.sites ?? [];
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ host: "", target: "shell" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "domains"] });
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await api.post<Domain>("/api/admin/domains", { host: form.host.trim(), target: form.target });
      setAdding(false);
      setForm({ host: "", target: "shell" });
      // A name that can only reach this server (`*.localhost` on a developer's machine) works at once.
      toast(made.verified_at ? tr("Domain added, and working") : tr("Domain added: point it at Ferrum, and it starts working once checked"));
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const check = async (d: Domain) => {
    try {
      const r = await api.post<{ answers: boolean }>(`/api/admin/domains/${encodeURIComponent(d.host)}/check`);
      toast(r.answers ? tr("{host} reaches Ferrum", { host: d.host }) : tr("{host} does not reach Ferrum yet", { host: d.host }), r.answers ? "success" : "error");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
    void refresh();
  };
  const primary = async (d: Domain) => {
    if (await attempt(() => api.put(`/api/admin/domains/${encodeURIComponent(d.host)}/primary`), tr("{host} is now the main address", { host: d.host }))) void refresh();
  };
  const remove = async (d: Domain) => {
    const ok = await confirmDialog({
      title: tr("Remove {host}?", { host: d.host }),
      message: tr("If it worked, it keeps sending visitors to the workspace's main address for 90 days, and no other workspace can use it for a year."),
      confirmLabel: tr("Remove"),
      danger: true,
    });
    if (ok && (await attempt(() => api.del(`/api/admin/domains/${encodeURIComponent(d.host)}`), tr("Domain removed")))) void refresh();
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Domains")}</h2>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
          {tr("Add a domain")}
        </Button>
      </div>
      <Loaded q={q}>
        {(data) => (
          <div className="card-body stack">
            <p className="muted">
              {placed(tr("Use your own address for this workspace, its portal or an app's public site. {p1} Ferrum checks it within a few minutes and serves it with its own certificate."), { p1: data.point_to ? (
                <>
                  {placed(tr("Point the domain at {p1} with a CNAME record;"), { p1: <span className="mono">{isolate(data.point_to)}</span> })}
                </>
              ) : (
                <>{tr("Point the domain at this server;")}</>
              ) })}
            </p>
            {!data.domains.length ? (
              <EmptyState title={tr("No domains yet")} icon="external" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{tr("Domain")}</th>
                      <th scope="col">{tr("Serves")}</th>
                      <th scope="col">{tr("Status")}</th>
                      <th scope="col">{tr("Checked")}</th>
                      <th scope="col">
                        <span className="sr-only">{tr("Actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.domains.map((d) => (
                      <tr key={d.host}>
                        <td className="mono" style={{ overflowWrap: "anywhere" }}>
                          {isolate(d.host)} {d.is_primary && <Badge tone="blue">{tr("main")}</Badge>}
                        </td>
                        <td>{isolate(TARGET_LABEL(d.target, sites))}</td>
                        <td>
                          <Badge tone={DOMAIN_STATUS[d.status].tone}>{d.kind === "subdomain" && d.status === "verified" ? tr("Working") : DOMAIN_STATUS[d.status].text}</Badge>
                        </td>
                        <td className="muted">{d.checked_at ? relativeTime(d.checked_at) : d.kind === "subdomain" ? "—" : tr("not yet")}</td>
                        <td>
                          <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            {d.kind === "custom" && !d.released_at && (
                              <Button size="sm" onClick={() => void check(d)}>
                                {tr("Check now")}
                              </Button>
                            )}
                            {d.status === "verified" && !d.is_primary && !d.released_at && (
                              <Button size="sm" onClick={() => void primary(d)}>
                                {tr("Make main")}
                              </Button>
                            )}
                            {d.kind === "custom" && !d.released_at && (
                              <Button size="sm" variant="ghost" onClick={() => void remove(d)}>
                                {tr("Remove")}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Loaded>
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={tr("Add a domain")}
        footer={
          <>
            <Button onClick={() => setAdding(false)}>{tr("Cancel")}</Button>
            <Button variant="primary" type="submit" form="domain-form" loading={busy}>
              {tr("Add")}
            </Button>
          </>
        }
      >
        <form id="domain-form" className="stack" onSubmit={add}>
          {error && <Alert tone="error">{isolate(error)}</Alert>}
          <FieldWrap label={tr("Domain")} htmlFor="domain-host" required hint={tr("A name you own, such as erp.example.com")}>
            <input id="domain-host" className="input mono" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required autoFocus placeholder="erp.example.com" />
          </FieldWrap>
          <FieldWrap label={tr("Serves")} htmlFor="domain-target">
            <select id="domain-target" className="input" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}>
              <option value="shell">{tr("This workspace")}</option>
              <option value="portal">{tr("The portal (customers, suppliers)")}</option>
              {sites.map((a) => (
                <option key={a.app} value={`site:${a.app}`}>
                  {tr("{title}'s public site", { title: a.title })}
                </option>
              ))}
            </select>
          </FieldWrap>
        </form>
      </Dialog>
    </section>
  );
}

function Webhooks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "webhooks"], queryFn: ({ signal }) => api.get<{ webhooks: Webhook[] }>("/api/admin/webhooks", undefined, signal) });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", topics: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ secret: string; note?: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "webhooks"] });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const topics = form.topics.split(/[\s,]+/).filter(Boolean);
      const res = await api.post<{ id: string; secret: string; note?: string }>("/api/admin/webhooks", { name: form.name.trim(), url: form.url.trim(), topics });
      setCreating(false);
      setForm({ name: "", url: "", topics: "" });
      setSecret({ secret: res.secret, note: res.note });
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (w: Webhook) => {
    if (!(await confirmDialog({ title: tr("Delete webhook {name}?", { name: w.name }), message: tr("Pending deliveries are dropped."), confirmLabel: tr("Delete"), danger: true }))) return;
    if (await attempt(() => api.del(`/api/admin/webhooks/${w.id}`), tr("Webhook deleted"))) void refresh();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Webhooks")}</h2>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          {tr("New webhook")}
        </Button>
      </div>
      <Loaded q={q}>
        {(data) =>
          !data.webhooks.length ? (
            <EmptyState title={tr("No webhooks yet")} icon="external" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Name")}</th>
                    <th scope="col">{tr("URL")}</th>
                    <th scope="col">{tr("Topics")}</th>
                    <th scope="col" className="num">
                      {tr("Pending")}
                    </th>
                    <th scope="col" className="num">
                      {tr("Dead")}
                    </th>
                    <th scope="col">{tr("Created")}</th>
                    <th scope="col">
                      <span className="sr-only">{tr("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.webhooks.map((w) => (
                    <tr key={w.id}>
                      <td>
                        {isolate(w.name)} {!w.is_active && <Badge tone="red">{tr("inactive")}</Badge>}
                      </td>
                      <td className="mono" style={{ overflowWrap: "anywhere" }}>
                        {isolate(w.url)}
                      </td>
                      <td>
                        <div className="chips">
                          {w.topics.map((t) => (
                            <Badge key={t} tone="blue">
                              {isolate(t)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="num">{w.pending}</td>
                      <td className="num">{w.dead > 0 ? <Badge tone="red">{w.dead}</Badge> : w.dead}</td>
                      <td className="nowrap">{isolate(formatDateTime(w.created_at))}</td>
                      <td>
                        {w.app ? (
                          <span className="muted">The {w.app} app&apos;s</span>
                        ) : (
                          <Button size="sm" variant="danger" icon="trash" onClick={() => void remove(w)} aria-label={tr("Delete webhook {name}", { name: w.name })} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      <Dialog open={creating} onClose={() => setCreating(false)} title={tr("New webhook")}>
        <form className="stack" onSubmit={create}>
          {error && <Alert tone="error">{isolate(error)}</Alert>}
          <FieldWrap label={tr("Name")} htmlFor="wh-name" required>
            <input id="wh-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </FieldWrap>
          <FieldWrap label={tr("URL")} htmlFor="wh-url" required>
            <input id="wh-url" className="input" type="url" placeholder="https://example.com/hooks/ferrum" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
          </FieldWrap>
          <FieldWrap label={tr("Topics")} htmlFor="wh-topics" required hint={tr("Separated by commas or spaces, e.g. SalesInvoice.submitted, SalesInvoice.*, *")}>
            <input id="wh-topics" className="input mono" value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} required />
          </FieldWrap>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={() => setCreating(false)}>{tr("Cancel")}</Button>
            <Button type="submit" variant="primary" loading={busy}>
              {tr("Create webhook")}
            </Button>
          </div>
        </form>
      </Dialog>
      <SecretDialog
        secret={secret?.secret ?? null}
        title={tr("Webhook signing secret")}
        note={tr("This secret is shown only once. {value}", { value: secret?.note ?? tr("Use it to verify the X-Ferrum-Signature header.") })}
        onClose={() => setSecret(null)}
      />
    </section>
  );
}

// ── single sign-on ──

interface SsoProvider {
  id: string;
  label: string;
  protocol: "oidc" | "saml";
  /** SAML: the metadata as given, XML or the address it is published at. */
  saml_metadata: string | null;
  /** OpenID Connect: the issuer; SAML: the provider's entity ID. */
  issuer: string;
  client_id: string;
  has_secret: boolean;
  domains: string[];
  auto_create: boolean;
  default_roles: string[];
  enabled: boolean;
  linked_users: number;
}

/** This workspace as SAML providers know it; none when the server cannot do SAML. */
interface SamlServiceProvider {
  entity_id: string;
  acs_url: string;
  metadata_url: string;
}

function SingleSignOn() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "sso"],
    queryFn: ({ signal }) => api.get<{ providers: SsoProvider[]; saml: SamlServiceProvider | null }>("/api/admin/sso", undefined, signal),
  });
  const roles = useRoles();
  const [editing, setEditing] = useState<SsoProvider | "new" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "sso"] });
  const remove = async (p: SsoProvider) => {
    const ok = await confirmDialog({
      title: tr("Remove {label}?", { label: p.label }),
      message:
        p.linked_users === 1
          ? tr("Its button leaves the sign-in page and 1 linked account is unlinked. The accounts stay.")
          : tr("Its button leaves the sign-in page and {linked_users} linked accounts are unlinked. The accounts stay.", { linked_users: p.linked_users }),
      confirmLabel: tr("Remove"),
      danger: true,
    });
    if (ok && (await attempt(() => api.del(`/api/admin/sso/${p.id}`), tr("Provider removed")))) void refresh();
  };
  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(tr("{what} copied", { what }));
    } catch {
      toast(tr("Copy it manually"), "error");
    }
  };
  const copyable = (value: string, what: string, label?: string) => (
    <div className="stack" style={{ gap: 4 }}>
      {label && <span className="field-label">{isolate(label)}</span>}
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input className="input mono" readOnly value={value} aria-label={what} onFocus={(e) => e.currentTarget.select()} />
        <Button icon="copy" onClick={() => void copy(value, what)} aria-label={tr("Copy the {what}", { what: what.toLowerCase() })}>
          {tr("Copy")}
        </Button>
      </div>
    </div>
  );

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Single sign-on")}</h2>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
          {tr("New provider")}
        </Button>
      </div>
      <div className="card-pad stack">
        <p className="muted">
          {tr("People sign in with their account at an OpenID Connect provider (Microsoft Entra ID, Okta, Google Workspace, Keycloak, Auth0…). Register Ferrum there as a web application with this redirect URI, then add the provider here with the client ID and secret it gives you.")}
        </p>
        {copyable(ssoRedirectUri(), tr("Redirect URI"), q.data?.saml ? tr("Redirect URI (OpenID Connect)") : undefined)}
        {q.data?.saml && (
          <>
            <p className="muted">
              {tr("Or through a SAML 2.0 identity provider (AD FS, Entra ID, Okta, OneLogin, PingFederate, Keycloak…): give it this workspace's metadata address, or its entity ID and assertion consumer service, then add the provider here with its metadata.")}
            </p>
            {copyable(q.data.saml.metadata_url, tr("Metadata address"), q.data.saml.metadata_url === q.data.saml.entity_id ? tr("Metadata address, also its entity ID") : tr("Metadata address"))}
            {q.data.saml.metadata_url !== q.data.saml.entity_id && copyable(q.data.saml.entity_id, tr("Entity ID"), tr("Entity ID"))}
            {copyable(q.data.saml.acs_url, tr("Assertion consumer service"), tr("Assertion consumer service (HTTP-POST)"))}
          </>
        )}
      </div>
      <Loaded q={q}>
        {(data) =>
          !data.providers.length ? (
            <EmptyState title={tr("No providers yet")} icon="user" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Provider")}</th>
                    <th scope="col">{tr("Issuer")}</th>
                    <th scope="col">{tr("Email domains")}</th>
                    <th scope="col">{tr("New people")}</th>
                    <th scope="col" className="num">
                      {tr("Linked")}
                    </th>
                    <th scope="col">
                      <span className="sr-only">{tr("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.providers.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {isolate(p.label)} {p.protocol === "saml" && <Badge tone="purple">{tr("SAML")}</Badge>} {!p.enabled && <Badge tone="red">{tr("disabled")}</Badge>}
                      </td>
                      <td className="mono" style={{ overflowWrap: "anywhere" }}>
                        {isolate(p.issuer)}
                      </td>
                      <td>
                        <div className="chips">{p.domains.length ? p.domains.map((d) => <Badge key={d}>{isolate(d)}</Badge>) : <span className="faint">{tr("any it verifies")}</span>}</div>
                      </td>
                      <td>
                        {p.auto_create ? (
                          <span>{tr("get an account")}{p.default_roles.length ? ` (${p.default_roles.join(", ")})` : ""}</span>
                        ) : (
                          <span className="faint">{tr("need an account first")}</span>
                        )}
                      </td>
                      <td className="num">{p.linked_users}</td>
                      <td>
                        <div className="row">
                          <Button size="sm" onClick={() => setEditing(p)}>
                            {tr("Edit")}
                          </Button>
                          <Button size="sm" variant="danger" icon="trash" onClick={() => void remove(p)} aria-label={tr("Remove {label}", { label: p.label })} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {editing && (
        <SsoProviderDialog
          provider={editing === "new" ? null : editing}
          saml={Boolean(q.data?.saml)}
          roles={(roles.data?.roles ?? []).map((r) => r.name)}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}

function SsoProviderDialog({
  provider,
  saml,
  roles,
  onClose,
  onDone,
}: {
  provider: SsoProvider | null;
  /** Whether the server can do SAML. */
  saml: boolean;
  roles: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    label: provider?.label ?? "",
    protocol: provider?.protocol ?? "oidc",
    saml_metadata: provider?.saml_metadata ?? "",
    issuer: provider?.issuer ?? "",
    client_id: provider?.client_id ?? "",
    secret: "",
    noSecret: provider ? !provider.has_secret : false,
    domains: (provider?.domains ?? []).join(", "),
    auto_create: provider?.auto_create ?? false,
    default_roles: provider?.default_roles ?? [],
    enabled: provider?.enabled ?? true,
  });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldError = (name: string) => errors.find((f) => f.field === name)?.message;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    setError(null);
    const isSaml = form.protocol === "saml";
    const body = {
      label: form.label.trim(),
      protocol: form.protocol,
      issuer: isSaml ? undefined : form.issuer.trim(),
      client_id: isSaml ? undefined : form.client_id.trim(),
      saml_metadata: isSaml ? form.saml_metadata.trim() : undefined,
      // Left empty, an existing secret stays as it is.
      client_secret: isSaml ? undefined : form.noSecret ? "" : form.secret ? form.secret : undefined,
      domains: form.domains.split(/[\s,]+/).filter(Boolean),
      auto_create: form.auto_create,
      default_roles: form.auto_create ? form.default_roles : [],
      enabled: form.enabled,
    };
    try {
      if (provider) await api.put(`/api/admin/sso/${provider.id}`, body);
      else await api.post("/api/admin/sso", body);
      toast(provider ? tr("Provider saved") : tr("Provider added"));
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) setErrors(err.fields);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={provider ? tr("Edit {label}", { label: provider.label }) : tr("New single sign-on provider")} wide>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{isolate(error)}</Alert>}
        <FieldWrap label={tr("Name")} htmlFor="sso-label" required error={fieldError("label")} hint={tr("On the sign-in button: “Continue with …”.")}>
          <input id="sso-label" className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} maxLength={60} required />
        </FieldWrap>
        {(saml || provider?.protocol === "saml") && (
          <fieldset disabled={Boolean(provider)} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>
              {tr("Protocol")}
            </legend>
            <div className="row" style={{ gap: 16 }}>
              <label className="row" style={{ gap: 8 }}>
                <input type="radio" name="sso-protocol" checked={form.protocol === "oidc"} onChange={() => setForm({ ...form, protocol: "oidc" })} />
                {tr("OpenID Connect")}
              </label>
              <label className="row" style={{ gap: 8 }}>
                <input type="radio" name="sso-protocol" checked={form.protocol === "saml"} onChange={() => setForm({ ...form, protocol: "saml" })} />
                {tr("SAML 2.0")}
              </label>
            </div>
            {fieldError("protocol") && <p className="field-error">{isolate(fieldError("protocol") ?? "")}</p>}
          </fieldset>
        )}
        {form.protocol === "saml" ? (
          <FieldWrap
            label={tr("Identity provider metadata")}
            htmlFor="sso-metadata"
            required
            error={fieldError("saml_metadata")}
            hint={tr("Paste its metadata XML, or the https address it publishes it at (read again at each sign-in, so a new signing certificate is picked up). It must hold a signing certificate.")}
          >
            <textarea
              id="sso-metadata"
              className="textarea mono"
              rows={6}
              value={form.saml_metadata}
              onChange={(e) => setForm({ ...form, saml_metadata: e.target.value })}
              placeholder="https://… or <EntityDescriptor …>"
              required
            />
          </FieldWrap>
        ) : (
          <>
        <FieldWrap label={tr("Issuer URL")} htmlFor="sso-issuer" required error={fieldError("issuer")} hint="Its discovery document is read from here, e.g. https://login.microsoftonline.com/<tenant>/v2.0 or https://acme.okta.com.">
          <input
            id="sso-issuer"
            className="input mono"
            type="url"
            value={form.issuer}
            onChange={(e) => setForm({ ...form, issuer: e.target.value })}
            placeholder="https://"
            required
          />
        </FieldWrap>
        <div className="form-grid">
          <FieldWrap label={tr("Client ID")} htmlFor="sso-client" required error={fieldError("client_id")}>
            <input id="sso-client" className="input mono" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} required />
          </FieldWrap>
          <FieldWrap
            label={tr("Client secret")}
            htmlFor="sso-secret"
            error={fieldError("client_secret")}
            hint={provider?.has_secret && !form.noSecret ? tr("Stored; leave empty to keep it.") : tr("Sealed on the server and never shown again.")}
          >
            <input
              id="sso-secret"
              className="input mono"
              type="password"
              autoComplete="off"
              value={form.secret}
              disabled={form.noSecret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
            />
          </FieldWrap>
        </div>
        <label className="check-field">
          <input type="checkbox" checked={form.noSecret} onChange={(e) => setForm({ ...form, noSecret: e.target.checked, secret: "" })} />
          {tr("No client secret (a public client: PKCE only)")}
        </label>
          </>
        )}
        <FieldWrap
          label={tr("Email domains")}
          htmlFor="sso-domains"
          error={fieldError("domains")}
          required={form.protocol === "saml"}
          hint={
            form.protocol === "saml"
              ? tr("Separated by commas. Only these addresses sign in through it: SAML never says whether an address was checked, so the domains are required.")
              : tr("Separated by commas. Only these addresses sign in through it; leave empty to accept any address the provider has verified. Providers that do not say whether they verified an address (Microsoft Entra ID) need the domains listed.")
          }
        >
          <input id="sso-domains" className="input mono" value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} placeholder="example.com" />
        </FieldWrap>
        <label className="check-field">
          <input type="checkbox" checked={form.auto_create} onChange={(e) => setForm({ ...form, auto_create: e.target.checked })} />
          {tr("Create an account for someone signing in who has none")}
        </label>
        {form.auto_create && (
          <div>
            <RoleChecks roles={roles} value={form.default_roles} onChange={(v) => setForm({ ...form, default_roles: v })} />
            {fieldError("default_roles") && <p className="field-error">{isolate(fieldError("default_roles") ?? "")}</p>}
          </div>
        )}
        <label className="check-field">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          {tr("Enabled (its button shows on the sign-in page)")}
        </label>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {provider ? tr("Save") : tr("Add provider")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── automations ──

interface Automation {
  id: string;
  name: string;
  entity: string;
  event: string;
  condition?: string | null;
  actions: unknown;
  is_active: boolean;
  updated_at?: string;
}

const EVENTS = ["created", "updated", "submitted", "cancelled", "deleted"];
const TEMPLATES: Record<string, unknown> = {
  "Set fields": { type: "set_fields", values: { remarks: "'Updated by automation'" } },
  "Create document": { type: "create_document", entity: "Project", values: { project_name: "'Follow-up for ' + doc.number" } },
  Notify: { type: "notify", to: "owner", title: "'Document ' + doc.number + ' needs attention'", body: "doc.remarks" },
  Email: { type: "email", to: "doc.email", subject: "'Update on ' + doc.number", body: "'Hello, your document has changed.'" },
};

function Automations() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "automations"], queryFn: ({ signal }) => api.get<{ automations: Automation[] }>("/api/admin/automations", undefined, signal) });
  const [editing, setEditing] = useState<Partial<Automation> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "automations"] });
  const remove = async (a: Automation) => {
    if (!(await confirmDialog({ title: tr("Delete automation {name}?", { name: a.name }), confirmLabel: tr("Delete"), danger: true }))) return;
    if (await attempt(() => api.del(`/api/admin/automations/${a.id}`), tr("Automation deleted"))) void refresh();
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Automations")}</h2>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setEditing({ event: "submitted", is_active: true, actions: [] })}>
          {tr("New automation")}
        </Button>
      </div>
      <Loaded q={q}>
        {(data) =>
          !data.automations.length ? (
            <EmptyState title={tr("No automations yet")} icon="settings" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Name")}</th>
                    <th scope="col">{tr("When")}</th>
                    <th scope="col">{tr("Condition")}</th>
                    <th scope="col">{tr("Actions")}</th>
                    <th scope="col">{tr("Status")}</th>
                    <th scope="col">
                      <span className="sr-only">{tr("Edit")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.automations.map((a) => (
                    <tr key={a.id}>
                      <td>{isolate(a.name)}</td>
                      <td>
                        {isolate(a.entity)} {isolate(a.event)}
                      </td>
                      <td className="mono">{a.condition || <span className="faint">{tr("always")}</span>}</td>
                      <td>{Array.isArray(a.actions) ? a.actions.map((x) => (x as { type?: string }).type).join(", ") : "—"}</td>
                      <td>
                        <Badge tone={a.is_active ? "green" : "neutral"}>{a.is_active ? tr("active") : tr("off")}</Badge>
                      </td>
                      <td className="nowrap">
                        <Button size="sm" icon="edit" onClick={() => setEditing(a)}>
                          {tr("Edit")}
                        </Button>{isolate(" ")}
                        <Button size="sm" variant="danger" icon="trash" aria-label={tr("Delete automation {name}", { name: a.name })} onClick={() => void remove(a)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      <AutomationDialog value={editing} onClose={() => setEditing(null)} onDone={refresh} />
    </section>
  );
}

function AutomationDialog({ value, onClose, onDone }: { value: Partial<Automation> | null; onClose: () => void; onDone: () => void }) {
  const index = useMetaIndex().data;
  const [form, setForm] = useState({ name: "", entity: "", event: "submitted", condition: "", is_active: true, actions: "[]" });
  const [seen, setSeen] = useState<Partial<Automation> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (value !== seen) {
    setSeen(value);
    setError(null);
    if (value)
      setForm({
        name: value.name ?? "",
        entity: value.entity ?? "",
        event: value.event ?? "submitted",
        condition: value.condition ?? "",
        is_active: value.is_active ?? true,
        actions: JSON.stringify(value.actions ?? [], null, 2),
      });
  }

  const addTemplate = (name: string) => {
    try {
      const list = JSON.parse(form.actions || "[]") as unknown;
      const next = [...(Array.isArray(list) ? list : []), TEMPLATES[name]];
      setForm({ ...form, actions: JSON.stringify(next, null, 2) });
      setError(null);
    } catch {
      setError(tr("Fix the actions JSON before adding a template."));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let actions: unknown;
    try {
      actions = JSON.parse(form.actions);
    } catch {
      return setError(tr("Actions must be valid JSON (an array of action objects)."));
    }
    if (!Array.isArray(actions)) return setError(tr("Actions must be a JSON array."));
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/automations", { ...(value?.id ? { id: value.id } : {}), ...form, condition: form.condition.trim() || null, actions });
      toast(value?.id ? tr("Automation saved") : tr("Automation created"));
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!value} onClose={onClose} title={value?.id ? tr("Edit {name}", { name: String(value.name) }) : tr("New automation")} wide>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{isolate(error)}</Alert>}
        <div className="form-grid" style={{ ["--cols" as string]: 3 }}>
          <FieldWrap label={tr("Name")} htmlFor="au-name" required>
            <input id="au-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </FieldWrap>
          <FieldWrap label={tr("Entity")} htmlFor="au-entity" required>
            <select id="au-entity" className="select" value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} required>
              <option value="">{tr("Choose…")}</option>
              {[...(index?.entities ?? [])]
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((x) => (
                  <option key={x.name} value={x.name}>
                    {isolate(x.label)}
                  </option>
                ))}
            </select>
          </FieldWrap>
          <FieldWrap label={tr("Event")} htmlFor="au-event" required>
            <select id="au-event" className="select" value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })}>
              {EVENTS.map((x) => (
                <option key={x} value={x}>
                  {isolate(x)}
                </option>
              ))}
            </select>
          </FieldWrap>
        </div>
        <FieldWrap label={tr("Condition (CEL, optional)")} htmlFor="au-cond" hint="Runs only when true, e.g. doc.grand_total > 100000.0">
          <input
            id="au-cond"
            className="input mono"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={form.condition}
            onChange={(e) => setForm({ ...form, condition: e.target.value })}
          />
        </FieldWrap>
        <FieldWrap label={tr("Actions (JSON)")} htmlFor="au-actions" hint="Values are CEL expressions: quote literal text, e.g. &quot;'Approved'&quot;.">
          <textarea
            id="au-actions"
            className="textarea mono"
            rows={10}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={form.actions}
            onChange={(e) => setForm({ ...form, actions: e.target.value })}
          />
        </FieldWrap>
        <div className="row">
          <span className="muted">{tr("Insert template:")}</span>
          {Object.keys(TEMPLATES).map((t) => (
            <Button key={t} size="sm" icon="plus" onClick={() => addTemplate(t)}>
              {isolate(t)}
            </Button>
          ))}
        </div>
        <label className="check-field">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          {tr("Active")}
        </label>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {tr("Save automation")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── plugins (sandboxed WebAssembly: hooks, routes, sockets, events, schedules) ──

interface Hook {
  entity: string;
  stage: string;
}
interface Grant {
  entity: string;
  read?: boolean;
  write?: boolean;
  create?: boolean;
  delete?: boolean;
  submit?: boolean;
  cancel?: boolean;
}
/** What a plugin declares it does; the server enforces every part of it. */
export interface PluginManifest {
  hooks?: Hook[];
  routes?: { path: string; public?: boolean }[];
  sockets?: { path: string; public?: boolean; subprotocols?: string[] }[];
  subscriptions?: string[];
  schedules?: { name: string; every_seconds: number }[];
  permissions?: Grant[];
  http_hosts?: string[];
  entities?: { name: string; label?: string }[];
}
interface Plugin {
  id: string;
  name: string;
  version?: string | null;
  description?: string | null;
  sha256: string;
  manifest?: PluginManifest | null;
  config_keys?: string[];
  fuel_limit?: number | null;
  memory_limit_mb?: number | null;
  enabled: boolean;
  updated_at: string;
}

const VERBS = ["read", "write", "create", "delete", "submit", "cancel"] as const;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error(tr("Could not read the file")));
    r.readAsDataURL(file);
  });
}

/** One-line summary of what a plugin uses, for the list. */
export function pluginUses(m: PluginManifest | null | undefined): string[] {
  if (!m) return [];
  const n = (count: number | undefined, one: string, many = `${one}s`) => (count ? `${count} ${count === 1 ? one : many}` : null);
  const publicCount = [...(m.routes ?? []), ...(m.sockets ?? [])].filter((r) => r.public).length;
  return [
    n(m.hooks?.length, "hook"),
    n(m.routes?.length, "route"),
    n(m.sockets?.length, "socket"),
    n(m.subscriptions?.length, "subscription"),
    n(m.schedules?.length, "schedule"),
    n(m.entities?.length, "entity", "entities"),
    publicCount ? tr("{publicCount} public", { publicCount }) : null,
    m.http_hosts?.length ? tr("calls {value}", { value: m.http_hosts.join(", ") }) : null,
  ].filter((x): x is string => !!x);
}

/** Everything a manifest asks for, worded for the administrator approving it. */
function PluginAccess({ m }: { m: PluginManifest }) {
  const rows: [string, ReactNode][] = [];
  if (m.permissions?.length)
    rows.push([
      tr("Records"),
      m.permissions.map((p) => (
        <div key={p.entity}>
          <span className="mono">{isolate(p.entity)}</span>: {VERBS.filter((v) => p[v]).join(", ") || tr("no access")}
        </div>
      )),
    ]);
  if (m.entities?.length) rows.push([tr("Brings entities"), m.entities.map((e) => e.label ?? e.name).join(", ")]);
  if (m.hooks?.length) rows.push([tr("Runs on"), m.hooks.map((h) => `${h.entity === "*" ? "every entity" : h.entity} · ${h.stage}`).join("; ")]);
  if (m.routes?.length)
    rows.push([
      tr("HTTP routes"),
      m.routes.map((r) => (
        <div key={r.path}>
          <span className="mono">{isolate(r.path)}</span> {r.public ? <Badge tone="amber">{tr("public")}</Badge> : <span className="faint">{tr("signed in")}</span>}
        </div>
      )),
    ]);
  if (m.sockets?.length)
    rows.push([
      "WebSockets",
      m.sockets.map((s) => (
        <div key={s.path}>
          <span className="mono">{isolate(s.path)}</span> {s.public ? <Badge tone="amber">{tr("public")}</Badge> : <span className="faint">{tr("signed in")}</span>}
          {s.subprotocols?.length ? <span className="faint"> · {isolate(s.subprotocols.join(", "))}</span> : null}
        </div>
      )),
    ]);
  if (m.subscriptions?.length) rows.push([tr("Listens to"), m.subscriptions.join(", ")]);
  if (m.schedules?.length) rows.push(["Schedules", m.schedules.map((s) => tr("{name} every {n} min", { name: s.name, n: Math.round(s.every_seconds / 60) })).join("; ")]);
  rows.push([tr("Calls out to"), m.http_hosts?.length ? m.http_hosts.join(", ") : tr("nothing (no network access)")]);
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{isolate(k)}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Plugins() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "plugins"], queryFn: ({ signal }) => api.get<{ plugins: Plugin[] }>("/api/admin/plugins", undefined, signal) });
  const [installing, setInstalling] = useState<Partial<Plugin> | null>(null);
  const [settings, setSettings] = useState<Plugin | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "plugins"] });

  const toggle = async (p: Plugin) => {
    setPending(p.id);
    if (await attempt(() => api.put(`/api/admin/plugins/${p.id}/enabled`, { enabled: !p.enabled }), p.enabled ? tr("{name} disabled", { name: p.name }) : tr("{name} enabled", { name: p.name })))
      await refresh();
    setPending(null);
  };
  const remove = async (p: Plugin) => {
    const ok = await confirmDialog({
      title: tr("Delete plugin {name}?", { name: p.name }),
      message: tr("It stops at once and its private data is removed. Records it created stay."),
      confirmLabel: tr("Delete"),
      danger: true,
    });
    if (ok && (await attempt(() => api.del(`/api/admin/plugins/${p.id}`), tr("Plugin deleted")))) void refresh();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Plugins")}</h2>
        <span className="spacer" />
        <Button variant="primary" icon="upload" onClick={() => setInstalling({})}>
          {tr("Install plugin")}
        </Button>
      </div>
      <Loaded q={q}>
        {(data) =>
          !data.plugins.length ? (
            <EmptyState title={tr("No plugins installed")} icon="settings">
              <p className="muted">{tr("Plugins add hooks, pages, device connections and integrations without changing Ferrum.")}</p>
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Plugin")}</th>
                    <th scope="col">{tr("Uses")}</th>
                    <th scope="col">{tr("Updated")}</th>
                    <th scope="col">{tr("Enabled")}</th>
                    <th scope="col">
                      <span className="sr-only">{tr("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.plugins.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div>
                          <span className="mono">{isolate(p.name)}</span> {p.version && <span className="faint">v{isolate(p.version)}</span>}
                        </div>
                        {p.description && <div className="muted">{isolate(p.description)}</div>}
                        <div className="mono faint" title={tr("SHA-256 {sha256}", { sha256: p.sha256 })}>
                          {isolate(p.sha256.slice(0, 12))}…
                        </div>
                      </td>
                      <td>
                        <div className="chips">
                          {pluginUses(p.manifest).map((u) => (
                            <Badge key={u} tone={u.endsWith("public") ? "amber" : "blue"}>
                              {isolate(u)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="nowrap">{isolate(formatDateTime(p.updated_at))}</td>
                      <td>
                        <label className="check-field cell-check" style={{ minHeight: 0 }}>
                          <input type="checkbox" checked={p.enabled} disabled={pending === p.id} onChange={() => void toggle(p)} />
                          <span className="sr-only">{p.enabled ? tr("Disable") : tr("Enable")} {isolate(p.name)}</span>
                        </label>
                      </td>
                      <td>
                        <div className="row" style={{ flexWrap: "nowrap" }}>
                          <Button size="sm" icon="settings" onClick={() => setSettings(p)}>
                            {tr("Settings")}
                          </Button>
                          <Button size="sm" icon="upload" onClick={() => setInstalling(p)}>
                            {tr("New version")}
                          </Button>
                          <Button size="sm" variant="danger" icon="trash" aria-label={tr("Delete plugin {name}", { name: p.name })} onClick={() => void remove(p)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      <PluginDialog value={installing} onClose={() => setInstalling(null)} onDone={refresh} />
      <PluginSettings plugin={settings} onClose={() => setSettings(null)} onDone={refresh} />
    </section>
  );
}

const MANIFEST_TEMPLATE = { name: "", version: "0.1.0", description: "", hooks: [], permissions: [] };

/** Parses the manifest text; returns the object or a message for the administrator. */
export function parseManifest(text: string): { manifest?: Record<string, unknown>; error?: string } {
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { error: tr("The manifest must be a JSON object.") };
    if (typeof (v as { name?: unknown }).name !== "string" || !(v as { name: string }).name.trim()) return { error: tr("The manifest needs a name.") };
    return { manifest: v as Record<string, unknown> };
  } catch (e) {
    return { error: tr("Not valid JSON: {message}", { message: (e as Error).message }) };
  }
}

function PluginDialog({ value, onClose, onDone }: { value: Partial<Plugin> | null; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [seen, setSeen] = useState<Partial<Plugin> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  if (value !== seen) {
    setSeen(value);
    setMessage(null);
    setFieldErrors([]);
    setFile(null);
    // A new version starts from the installed manifest; its settings are kept unless the text adds `config`.
    const start = value?.id
      ? { name: value.name, version: value.version ?? "", description: value.description ?? "", fuel_limit: value.fuel_limit ?? undefined, memory_limit_mb: value.memory_limit_mb ?? undefined, ...value.manifest }
      : MANIFEST_TEMPLATE;
    setText(JSON.stringify(start, null, 2));
  }
  const parsed = parseManifest(text);

  const loadManifest = async (f: File | undefined) => {
    if (f) setText(await f.text());
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.manifest) return setMessage(parsed.error ?? tr("Check the manifest."));
    if (value?.id && parsed.manifest.name !== value.name) return setMessage(tr("A new version must keep the name {name}.", { name: String(value.name) }));
    if (!file) return setMessage(tr("Choose the plugin module (.wasm, or .wat text)."));
    if (file.size > 8 * 1024 * 1024) return setMessage(tr("Plugin modules are limited to 8 MB."));
    setBusy(true);
    setMessage(null);
    setFieldErrors([]);
    try {
      await api.post("/api/admin/plugins", { ...parsed.manifest, wasm_base64: await fileToBase64(file) });
      toast(tr("Plugin {value} installed", { value: String(parsed.manifest.name) }));
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fields);
      setMessage(errorMessage(err, false));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!value} onClose={onClose} title={value?.id ? tr("New version of {name}", { name: String(value.name) }) : tr("Install plugin")} wide>
      <form className="stack" onSubmit={submit}>
        {message && (
          <Alert tone="error">
            {isolate(message)}
            {fieldErrors.length > 0 && (
              <ul>
                {fieldErrors.map((f, i) => (
                  <li key={i}>
                    <span className="mono">{isolate([f.row?.join("."), f.field].filter(Boolean).join("."))}</span>: {isolate(f.message)}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <p className="muted">
          {tr("A plugin is a WebAssembly module and a manifest that declares what it may do. It runs sandboxed with only the access listed below; installing again with the same name upgrades it in place.")}
        </p>
        <div className="form-grid">
          <FieldWrap label={tr("Module")} htmlFor="pl-file" required>
            <input id="pl-file" type="file" accept=".wasm,.wat,application/wasm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </FieldWrap>
          <FieldWrap label={tr("Manifest file")} htmlFor="pl-manifest-file" hint={tr("Optional: loads a manifest.json into the editor")}>
            <input id="pl-manifest-file" type="file" accept=".json,application/json" onChange={(e) => void loadManifest(e.target.files?.[0])} />
          </FieldWrap>
        </div>
        <FieldWrap label={tr("Manifest")} htmlFor="pl-manifest" error={parsed.error}>
          <textarea
            id="pl-manifest"
            className="textarea mono"
            rows={12}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={!!parsed.error}
          />
        </FieldWrap>
        {parsed.manifest && (
          <div>
            <h3 className="field-label">{tr("This plugin will be able to")}</h3>
            <PluginAccess m={parsed.manifest as PluginManifest} />
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button type="submit" variant="primary" icon="upload" loading={busy} disabled={!parsed.manifest}>
            {tr("Install")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface ConfigRow {
  key: string;
  value: string;
  json: boolean;
}

/** Settings and secrets: values are write-only (the server lists keys, never values). */
function PluginSettings({ plugin, onClose, onDone }: { plugin: Plugin | null; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [seen, setSeen] = useState<Plugin | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (plugin !== seen) {
    setSeen(plugin);
    setRows([]);
    setRemoved([]);
    setMessage(null);
  }
  const setRow = (i: number, patch: Partial<ConfigRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!plugin) return;
    const config: Record<string, unknown> = {};
    for (const k of removed) config[k] = null;
    for (const r of rows) {
      const key = r.key.trim();
      if (!key) continue;
      if (r.json) {
        try {
          config[key] = JSON.parse(r.value);
        } catch {
          return setMessage(tr("The value of {key} is not valid JSON.", { key }));
        }
      } else config[key] = r.value;
    }
    if (!Object.keys(config).length) return onClose();
    setBusy(true);
    setMessage(null);
    try {
      await api.patch(`/api/admin/plugins/${plugin.id}/config`, { config });
      toast(tr("Settings saved"));
      onDone();
      onClose();
    } catch (err) {
      setMessage(errorMessage(err, false));
    } finally {
      setBusy(false);
    }
  };

  const keys = (plugin?.config_keys ?? []).filter((k) => !removed.includes(k));
  return (
    <Dialog open={!!plugin} onClose={onClose} title={plugin ? tr("{name} settings", { name: plugin.name }) : ""} wide>
      <form className="stack" onSubmit={save}>
        {message && <Alert tone="error">{isolate(message)}</Alert>}
        {plugin?.manifest && (
          <div>
            <h3 className="field-label">{tr("Access")}</h3>
            <PluginAccess m={plugin.manifest} />
          </div>
        )}
        <div>
          <h3 className="field-label">{tr("Settings")}</h3>
          <p className="muted">{tr("Saved values are never shown again. Enter a key to set or replace it.")}</p>
          {keys.length > 0 && (
            <div className="chips" style={{ margin: "8px 0" }}>
              {keys.map((k) => (
                <span key={k} className="chip-removable">
                  <span className="mono">{isolate(k)}</span>
                  <button type="button" className="icon-btn" aria-label={tr("Remove setting {k}", { k })} onClick={() => setRemoved((r) => [...r, k])}>
                    <Icon name="x" size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {removed.length > 0 && <p className="faint">{tr("Removing on save: {removed}", { removed: removed.join(", ") })}</p>}
          <div className="stack" style={{ gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
                <input
                  className="input mono"
                  aria-label={tr("Setting {value} key", { value: i + 1 })}
                  placeholder="key"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={r.key}
                  onChange={(e) => setRow(i, { key: e.target.value })}
                />
                <input
                  className="input"
                  aria-label={tr("Setting {value} value", { value: i + 1 })}
                  placeholder={r.json ? '{"json": true}' : tr("value")}
                  type={r.json ? "text" : "password"}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={r.value}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                />
                <label className="check-field nowrap" style={{ minHeight: 0 }}>
                  <input type="checkbox" checked={r.json} onChange={(e) => setRow(i, { json: e.target.checked })} /> {tr("JSON")}
                </label>
                <button type="button" className="icon-btn" aria-label={tr("Remove row {value}", { value: i + 1 })} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" icon="plus" style={{ marginTop: 8 }} onClick={() => setRows((rs) => [...rs, { key: "", value: "", json: false }])}>
            {tr("Add setting")}
          </Button>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {tr("Save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── API keys (the signed-in user's own; also reachable from the user menu) ──

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  last_used_at?: string | null;
  /** `dav`: an app password for calendar and contacts apps; `records:…`: a key to the records it
   * names; none: a key to the whole API. */
  scope?: string | null;
}

/** A records key's scope from what someone typed ("Customer=read; SalesInvoice=read+write"), or
 * nothing for a key to the whole API. The server checks the entities and what each may do. */
export function recordsScope(typed: string): string | undefined {
  const parts = typed
    .split(/[;\n]/)
    .map((p) => p.replace(/\s+/g, ""))
    .filter(Boolean);
  return parts.length ? `records:${parts.join(";")}` : undefined;
}

/** What a key reaches, in words. */
export function keyReaches(scope?: string | null): string {
  if (scope?.startsWith("records:")) return scope.slice("records:".length).split(";").join(", ").replaceAll("+", " and ").replaceAll("=", ": ");
  return tr("the whole API");
}

/** Your keys to the API, or (`scope="dav"`) your app passwords for calendar and contacts apps. */
export function ApiKeys({ scope }: { scope?: "dav" }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["api-keys"], queryFn: ({ signal }) => api.get<{ keys: ApiKey[] }>("/api/auth/api_keys", undefined, signal) });
  const app = scope === "dav";
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [records, setRecords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["api-keys"] });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ id: string; key: string }>("/api/auth/api_keys", {
        name: name.trim(),
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : undefined,
        scope: app ? scope : recordsScope(records),
      });
      setCreated(res.key);
      setName("");
      setExpires("");
      setRecords("");
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (k: ApiKey) => {
    const message = app ? tr("Apps using this password stop syncing immediately.") : tr("Integrations using this key stop working immediately.");
    if (!(await confirmDialog({ title: tr("Revoke {name}?", { name: k.name }), message, confirmLabel: tr("Revoke"), danger: true }))) return;
    if (await attempt(() => api.del(`/api/auth/api_keys/${k.id}`), app ? tr("App password revoked") : tr("API key revoked"))) void refresh();
  };

  return (
    <section className="card">
      <form className="toolbar" onSubmit={create} aria-label={app ? tr("Create an app password") : tr("Create an API key")}>
        <FieldWrap label={app ? tr("App or device") : tr("Key name")} htmlFor="key-name" className="field-wide">
          <input
            id="key-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            placeholder={app ? tr("e.g. iPhone") : tr("e.g. Warehouse scanner")}
          />
        </FieldWrap>
        <FieldWrap label={tr("Expires (optional)")} htmlFor="key-exp">
          <input id="key-exp" className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </FieldWrap>
        {!app && (
          <FieldWrap
            label={tr("Only these records (optional)")}
            htmlFor="key-records"
            className="field-wide"
            hint={tr("Entities and what the key may do with each, e.g. Customer=read; SalesInvoice=read+create. Empty: the whole API, as you.")}
          >
            <input
              id="key-records"
              className="input"
              value={records}
              onChange={(e) => setRecords(e.target.value)}
              placeholder={tr("Customer=read; SalesInvoice=read+create")}
            />
          </FieldWrap>
        )}
        <Button type="submit" variant="primary" icon="plus" loading={busy}>
          {app ? tr("Create app password") : tr("Create key")}
        </Button>
      </form>
      {error && (
        <div className="card-body">
          <Alert tone="error">{isolate(error)}</Alert>
        </div>
      )}
      <Loaded q={q}>
        {(all) => {
          const data = { keys: all.keys.filter((k) => (app ? k.scope === "dav" : !k.scope || k.scope.startsWith("records:"))) };
          return !data.keys.length ? (
            <EmptyState title={app ? tr("No app passwords") : tr("No API keys")} icon="settings" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Name")}</th>
                    <th scope="col">{tr("Key")}</th>
                    {!app && <th scope="col">{tr("Reaches")}</th>}
                    <th scope="col">{tr("Created")}</th>
                    <th scope="col">{tr("Expires")}</th>
                    <th scope="col">{tr("Last used")}</th>
                    <th scope="col">
                      <span className="sr-only">{tr("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.keys.map((k) => (
                    <tr key={k.id}>
                      <td>
                        {isolate(k.name)} {k.revoked_at && <Badge tone="red">{tr("revoked")}</Badge>}
                      </td>
                      <td className="mono">{isolate(k.prefix)}</td>
                      {!app && <td>{isolate(keyReaches(k.scope))}</td>}
                      <td className="nowrap">{isolate(formatDateTime(k.created_at))}</td>
                      <td className="nowrap">{k.expires_at ? formatDateTime(k.expires_at) : <span className="faint">{tr("never")}</span>}</td>
                      <td className="nowrap">{k.last_used_at ? relativeTime(k.last_used_at) : <span className="faint">{tr("never")}</span>}</td>
                      <td>
                        {!k.revoked_at && (
                          <Button size="sm" variant="danger" onClick={() => void revoke(k)}>
                            {tr("Revoke")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Loaded>
      <SecretDialog
        secret={created}
        title={app ? tr("Your new app password") : tr("Your new API key")}
        note={
          app
            ? tr("Enter it in the app as the password, with your email as the user name. It cannot be shown again.")
            : "Store this key now: it cannot be shown again. Send it as Authorization: Bearer <key>."
        }
        onClose={() => setCreated(null)}
      />
    </section>
  );
}

/** Calendar and contacts apps (CalDAV and CardDAV): what to enter in them, and their app passwords. */
export function CalendarApps({ email }: { email: string }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p>
        {tr("Add your Ferrum calendar and contacts to Apple Calendar and Contacts, Thunderbird, DAVx⁵ on Android or Outlook with a CalDAV add-in. In the app, add a CalDAV account (and a CardDAV one for contacts) with:")}
      </p>
      <dl className="drive-facts">
        <dt>{tr("Server")}</dt>
        <dd className="mono">{isolate(location.origin)}</dd>
        <dt>{tr("Full address")}</dt>
        <dd className="mono">{tr("{origin}/api/dav/comms/", { origin: location.origin })}</dd>
        <dt>{tr("User name")}</dt>
        <dd className="mono">{isolate(email)}</dd>
        <dt>{tr("Password")}</dt>
        <dd>{tr("an app password, made below for each app")}</dd>
      </dl>
      <p className="faint">
        {tr("Your calendar holds the events you organize and those you are invited to. Answering or deleting an invitation in the app answers it here. The address books Colleagues and Contacts are read-only.")}
      </p>
      <ApiKeys scope="dav" />
    </div>
  );
}
