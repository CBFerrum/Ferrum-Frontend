// The workspace's connections to outside systems, one card each. Every part of a connection's health
// shows on its own, with what can be done about it beside it: there is no single "Connected".

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api, ApiError, errorMessage, type FieldError } from "../lib/api";
import { ago, connectionFacts, type ConnectionHealth, type Run, runWords } from "../lib/connections";
import { Alert, Badge, Button, confirmDialog, Dialog, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";

interface Connector {
  provider: string;
  label: string;
  family?: string;
  api_version?: string;
  requirements?: string;
  capabilities?: string[];
  streams?: string[];
}

interface ConnectionRow {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  linked?: number;
  last_error?: string | null;
  health: ConnectionHealth;
}

interface Drift {
  id: string;
  stream: string;
  external_id: string;
  kind: string;
  resolved_at?: string | null;
}

const KINDS: Record<string, string> = {
  conflict: "Changed on both sides",
  refused: "Refused here",
  differs: "Differs",
  missing_here: "Only at the provider",
  missing_there: "Only here",
};

const words = (capability: string) => capability.replace(/_/g, " ");

function Differences({ id, onChange }: { id: string; onChange: () => void }) {
  const q = useQuery({ queryKey: ["connection-drift", id], queryFn: ({ signal }) => api.get<{ drift: Drift[] }>(`/api/admin/connections/${id}/drift`, undefined, signal) });
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <PageLoading />;
  const open = q.data.drift.filter((d) => !d.resolved_at);
  if (!open.length) return <p className="muted">Nothing is waiting for a person.</p>;
  const resolve = async (d: Drift) => {
    try {
      await api.post(`/api/admin/connection-drift/${d.id}/resolve`, {});
      await q.refetch();
      onChange();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  return (
    <table className="table">
      <thead>
        <tr>
          <th>What</th>
          <th>Stream</th>
          <th>Their record</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {open.map((d) => (
          <tr key={d.id}>
            <td>{KINDS[d.kind] ?? d.kind}</td>
            <td>{d.stream}</td>
            <td className="mono">{d.external_id}</td>
            <td className="num">
              <Button size="sm" onClick={() => void resolve(d)}>
                Dealt with
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What the connection did lately (each read, send and comparison, and how it went) with a failed
 * one tried again, and how many records each stream links. */
function History({ id, onChange }: { id: string; onChange: () => void }) {
  const q = useQuery({
    queryKey: ["connection-activity", id],
    queryFn: ({ signal }) => api.get<{ runs: Run[]; streams: { stream: string; entity: string; records: number; last_synced?: string | null }[] }>(`/api/admin/connections/${id}/activity`, undefined, signal),
  });
  const [busy, setBusy] = useState<string | null>(null);
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <PageLoading />;
  const again = async (r: Run) => {
    setBusy(r.id);
    try {
      await api.post(`/api/jobs/${r.id}/retry`, {});
      toast("Tried again");
      await q.refetch();
      onChange();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const now = new Date();
  return (
    <div className="stack">
      {q.data.streams.length > 0 && (
        <p className="muted">
          {q.data.streams.map((s) => `${s.stream}: ${s.records.toLocaleString()} ${s.entity} records`).join(" · ")}
        </p>
      )}
      {q.data.runs.length === 0 ? (
        <p className="muted">It has done nothing yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>What</th>
              <th>How it went</th>
              <th>When</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data.runs.map((r) => {
              const w = runWords(r);
              return (
                <tr key={r.id}>
                  <td>{w.what}</td>
                  <td>
                    <Badge tone={w.tone}>{r.status}</Badge>
                    {r.last_error ? <span className="muted"> {r.last_error}</span> : null}
                  </td>
                  <td>{ago(r.finished_at ?? r.created_at, now)}</td>
                  <td className="num">
                    {w.again && (
                      <Button size="sm" loading={busy === r.id} onClick={() => void again(r)}>
                        Try again
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ConnectionCard({ c, connector, refresh }: { c: ConnectionRow; connector?: Connector; refresh: () => void }) {
  const [showing, setShowing] = useState(false);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const facts = connectionFacts(c.health, new Date());
  const run = async (what: string, call: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try {
      await call();
      toast(done);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const disconnect = async () => {
    const ok = await confirmDialog({
      title: `Disconnect ${c.name}?`,
      message: "It stops at once and its credentials are forgotten. What it brought in stays, and connecting again finds it.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (ok) await run("disconnect", () => api.del(`/api/admin/connections/${c.id}`), `${c.name} disconnected`);
  };
  return (
    <section className="card connection" aria-label={c.name}>
      <header className="connection-head">
        <div>
          <h3>{c.name}</h3>
          <p className="muted">
            {connector?.label ?? c.provider}
            {connector?.api_version ? ` · API ${connector.api_version}` : ""}
            {c.linked ? ` · ${c.linked.toLocaleString()} records linked` : ""}
          </p>
        </div>
        <div className="row">
          <Button size="sm" loading={busy === "test"} onClick={() => void run("test", () => api.post(`/api/admin/connections/${c.id}/test`, {}), "It works")}>
            Test
          </Button>
          <Button size="sm" disabled={!c.enabled} loading={busy === "sync"} onClick={() => void run("sync", () => api.post(`/api/admin/connections/${c.id}/sync`, {}), "Sync queued")}>
            Sync now
          </Button>
          <Button size="sm" disabled={!c.enabled} loading={busy === "compare"} onClick={() => void run("compare", () => api.post(`/api/admin/connections/${c.id}/reconcile`, {}), "Comparison queued")}>
            Compare
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void disconnect()}>
            Disconnect
          </Button>
        </div>
      </header>
      <dl className="connection-facts">
        {facts.map((f) => (
          <div key={f.label} data-tone={f.tone} title={f.detail}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {c.last_error && <Alert tone="error">{c.last_error}</Alert>}
      {!!c.health.drift && (
        <div className="connection-more">
          <button type="button" className="link-btn" aria-expanded={showing} onClick={() => setShowing((s) => !s)}>
            {showing ? "Hide the differences" : `See the ${c.health.drift} ${c.health.drift === 1 ? "difference" : "differences"}`}
          </button>
          {showing && <Differences id={c.id} onChange={refresh} />}
        </div>
      )}
      <div className="connection-more">
        <button type="button" className="link-btn" aria-expanded={history} onClick={() => setHistory((s) => !s)}>
          {history ? "Hide what it did" : "See what it did lately"}
        </button>
        {history && <History id={c.id} onChange={refresh} />}
      </div>
      {!!connector?.capabilities?.length && (
        <div className="connection-can">
          <span className="faint">Can</span>
          {connector.capabilities.map((k) => (
            <Badge key={k}>{words(k)}</Badge>
          ))}
        </div>
      )}
    </section>
  );
}

const asJson = (text: string, field: string) => {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(422, "invalid", `${field} is not valid JSON`, [{ field, message: "is not valid JSON" }] as FieldError[]);
  }
};

function AddConnection({ connector, onClose, onDone }: { connector: Connector; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(connector.label);
  const [config, setConfig] = useState("{}");
  const [credentials, setCredentials] = useState("{}");
  const [mapping, setMapping] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/connections", { provider: connector.provider, name, config: asJson(config, "config"), credentials: asJson(credentials, "credentials"), mapping: asJson(mapping, "mapping") ?? {} });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={`Connect ${connector.label}`}>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        {connector.requirements && <Alert tone="warning">{connector.requirements}</Alert>}
        <Field label="Name" htmlFor="connection-name" required>
          <input id="connection-name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Settings" htmlFor="connection-config" hint="As this connector's guide describes them, in JSON.">
          <textarea id="connection-config" className="textarea mono" rows={3} value={config} onChange={(e) => setConfig(e.target.value)} />
        </Field>
        <Field label="Credentials" htmlFor="connection-credentials" hint="Sealed when saved and never shown again.">
          <textarea id="connection-credentials" className="textarea mono" rows={3} autoComplete="off" spellCheck={false} value={credentials} onChange={(e) => setCredentials(e.target.value)} />
        </Field>
        <Field label="What goes where" htmlFor="connection-mapping" hint="Which of its streams land in which records, in JSON (docs/connectors.md).">
          <textarea id="connection-mapping" className="textarea mono" rows={5} value={mapping} onChange={(e) => setMapping(e.target.value)} />
        </Field>
        <p className="muted">It stays off until a test proves it works.</p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function Connections() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<Connector | null>(null);
  const connections = useQuery({ queryKey: ["connections"], queryFn: ({ signal }) => api.get<{ connections: ConnectionRow[] }>("/api/admin/connections", undefined, signal), refetchInterval: 30_000 });
  const connectors = useQuery({ queryKey: ["connectors"], queryFn: ({ signal }) => api.get<{ connectors: Connector[] }>("/api/admin/connectors", undefined, signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["connections"] });
  if (connections.error) return <ErrorState error={connections.error} onRetry={() => void connections.refetch()} />;
  if (!connections.data || !connectors.data) return <PageLoading />;
  const rows = connections.data.connections;
  const offered = connectors.data.connectors;
  return (
    <div className="stack">
      {rows.length ? (
        rows.map((c) => <ConnectionCard key={c.id} c={c} connector={offered.find((o) => o.provider === c.provider)} refresh={refresh} />)
      ) : (
        <EmptyState title="Nothing is connected yet" icon="file">
          <p className="muted">A connection links this workspace to an account at another system.</p>
        </EmptyState>
      )}
      <section aria-labelledby="connectors-available">
        <h3 id="connectors-available" className="connection-title">
          Available here
        </h3>
        {offered.length ? (
          <ul className="connector-list">
            {offered.map((o) => (
              <li key={o.provider} className="card">
                <div>
                  <strong>{o.label}</strong>
                  <p className="muted">
                    {o.family} · API {o.api_version}
                  </p>
                  {o.requirements && <p className="muted">{o.requirements}</p>}
                  <p className="connection-can">
                    {(o.capabilities ?? []).map((k) => (
                      <Badge key={k}>{words(k)}</Badge>
                    ))}
                  </p>
                </div>
                <Button size="sm" onClick={() => setAdding(o)}>
                  Connect
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No connector is installed in this workspace. They come with apps and plugins.</p>
        )}
      </section>
      {adding && (
        <AddConnection
          connector={adding}
          onClose={() => setAdding(null)}
          onDone={() => {
            setAdding(null);
            refresh();
            toast("Saved. Test it to turn it on.");
          }}
        />
      )}
    </div>
  );
}
