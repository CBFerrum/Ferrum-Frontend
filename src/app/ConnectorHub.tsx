// The workspace's connections to outside systems, one card each. Every part of a connection's health
// shows on its own, with what can be done about it beside it: there is no single "Connected".

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api, ApiError, errorMessage, type FieldError } from "../lib/api";
import { ago, connectionFacts, type ConnectionHealth, type Run, runWords } from "../lib/connectorHub";
import { Alert, Badge, Button, confirmDialog, Dialog, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";
import { t, isolate } from "@ferrum/client";

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
  get conflict() { return t("Changed on both sides"); },
  get refused() { return t("Refused here"); },
  get differs() { return t("Differs"); },
  get missing_here() { return t("Only at the provider"); },
  get missing_there() { return t("Only here"); },
};

const words = (capability: string) => capability.replace(/_/g, " ");

function Differences({ id, onChange }: { id: string; onChange: () => void }) {
  const q = useQuery({ queryKey: ["connection-drift", id], queryFn: ({ signal }) => api.get<{ drift: Drift[] }>(`/api/admin/connector-instances/${id}/drift`, undefined, signal) });
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <PageLoading />;
  const open = q.data.drift.filter((d) => !d.resolved_at);
  if (!open.length) return <p className="muted">{t("Nothing is waiting for a person.")}</p>;
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
          <th>{t("What")}</th>
          <th>{t("Stream")}</th>
          <th>{t("Their record")}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {open.map((d) => (
          <tr key={d.id}>
            <td>{KINDS[d.kind] ?? d.kind}</td>
            <td>{isolate(d.stream)}</td>
            <td className="mono">{isolate(d.external_id)}</td>
            <td className="num">
              <Button size="sm" onClick={() => void resolve(d)}>
                {t("Dealt with")}
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
    queryFn: ({ signal }) => api.get<{ runs: Run[]; streams: { stream: string; entity: string; records: number; last_synced?: string | null }[] }>(`/api/admin/connector-instances/${id}/activity`, undefined, signal),
  });
  const [busy, setBusy] = useState<string | null>(null);
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <PageLoading />;
  const again = async (r: Run) => {
    setBusy(r.id);
    try {
      await api.post(`/api/jobs/${r.id}/retry`, {});
      toast(t("Tried again"));
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
          {isolate(q.data.streams.map((s) => `${s.stream}: ${s.records.toLocaleString()} ${s.entity} ${s.records === 1 ? "record" : "records"}`).join(" · "))}
        </p>
      )}
      {q.data.runs.length === 0 ? (
        <p className="muted">{t("It has done nothing yet.")}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("What")}</th>
              <th>{t("How it went")}</th>
              <th>{t("When")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data.runs.map((r) => {
              const w = runWords(r);
              return (
                <tr key={r.id}>
                  <td>{isolate(w.what)}</td>
                  <td>
                    <Badge tone={w.tone}>{isolate(r.status)}</Badge>
                    {r.last_error ? <span className="muted"> {isolate(r.last_error)}</span> : null}
                  </td>
                  <td>{isolate(ago(r.finished_at ?? r.created_at, now))}</td>
                  <td className="num">
                    {w.again && (
                      <Button size="sm" loading={busy === r.id} onClick={() => void again(r)}>
                        {t("Try again")}
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
      title: t("Disconnect {name}?", { name: c.name }),
      message: t("It stops at once and its credentials are forgotten. What it brought in stays, and connecting again finds it."),
      confirmLabel: t("Disconnect"),
      danger: true,
    });
    if (ok) await run("disconnect", () => api.del(`/api/admin/connector-instances/${c.id}`), t("{name} disconnected", { name: c.name }));
  };
  return (
    <section className="card connection" aria-label={c.name}>
      <header className="connection-head">
        <div>
          <h3>{isolate(c.name)}</h3>
          <p className="muted">
            {isolate(connector?.label ?? c.provider)}
            {connector?.api_version ? t(" · API {api_version}", { api_version: connector.api_version }) : ""}
            {c.linked ? (c.linked === 1 ? t(" · {value} record linked", { value: c.linked.toLocaleString() }) : t(" · {value} records linked", { value: c.linked.toLocaleString() })) : ""}
          </p>
        </div>
        <div className="row">
          <Button size="sm" loading={busy === "test"} onClick={() => void run("test", () => api.post(`/api/admin/connector-instances/${c.id}/test`, {}), t("It works"))}>
            {t("Test")}
          </Button>
          <Button size="sm" disabled={!c.enabled} loading={busy === "sync"} onClick={() => void run("sync", () => api.post(`/api/admin/connector-instances/${c.id}/sync`, {}), t("Sync queued"))}>
            {t("Sync now")}
          </Button>
          <Button size="sm" disabled={!c.enabled} loading={busy === "compare"} onClick={() => void run("compare", () => api.post(`/api/admin/connector-instances/${c.id}/reconcile`, {}), t("Comparison queued"))}>
            {t("Compare")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void disconnect()}>
            {t("Disconnect")}
          </Button>
        </div>
      </header>
      <dl className="connection-facts">
        {facts.map((f) => (
          <div key={f.label} data-tone={f.tone} title={f.detail}>
            <dt>{isolate(f.label)}</dt>
            <dd>{isolate(f.value)}</dd>
          </div>
        ))}
      </dl>
      {c.last_error && <Alert tone="error">{isolate(c.last_error)}</Alert>}
      {!!c.health.drift && (
        <div className="connection-more">
          <button type="button" className="link-btn" aria-expanded={showing} onClick={() => setShowing((s) => !s)}>
            {showing ? t("Hide the differences") : (c.health.drift === 1 ? t("See the {drift} difference", { drift: c.health.drift }) : t("See the {drift} differences", { drift: c.health.drift }))}
          </button>
          {showing && <Differences id={c.id} onChange={refresh} />}
        </div>
      )}
      <div className="connection-more">
        <button type="button" className="link-btn" aria-expanded={history} onClick={() => setHistory((s) => !s)}>
          {history ? t("Hide what it did") : t("See what it did lately")}
        </button>
        {history && <History id={c.id} onChange={refresh} />}
      </div>
      {!!connector?.capabilities?.length && (
        <div className="connection-can">
          <span className="faint">{t("Can")}</span>
          {connector.capabilities.map((k) => (
            <Badge key={k}>{isolate(words(k))}</Badge>
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
    throw new ApiError(422, "invalid", t("{field} is not valid JSON", { field }), [{ field, message: t("is not valid JSON") }] as FieldError[]);
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
      await api.post("/api/admin/connector-instances", { provider: connector.provider, name, config: asJson(config, "config"), credentials: asJson(credentials, "credentials"), mapping: asJson(mapping, "mapping") ?? {} });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={t("Connect {label}", { label: connector.label })}>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{isolate(error)}</Alert>}
        {connector.requirements && <Alert tone="warning">{isolate(connector.requirements)}</Alert>}
        <Field label={t("Name")} htmlFor="connection-name" required>
          <input id="connection-name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("Settings")} htmlFor="connection-config" hint={t("As this connector's guide describes them, in JSON.")}>
          <textarea id="connection-config" className="textarea mono" rows={3} value={config} onChange={(e) => setConfig(e.target.value)} />
        </Field>
        <Field label={t("Credentials")} htmlFor="connection-credentials" hint={t("Sealed when saved and never shown again.")}>
          <textarea id="connection-credentials" className="textarea mono" rows={3} autoComplete="off" spellCheck={false} value={credentials} onChange={(e) => setCredentials(e.target.value)} />
        </Field>
        <Field label={t("What goes where")} htmlFor="connection-mapping" hint={t("Which of its streams land in which records, in JSON (docs/connectors.md).")}>
          <textarea id="connection-mapping" className="textarea mono" rows={5} value={mapping} onChange={(e) => setMapping(e.target.value)} />
        </Field>
        <p className="muted">{t("It stays off until a test proves it works.")}</p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {t("Save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConnectorHub() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<Connector | null>(null);
  // Every few seconds while something waits to go (a queued sync or comparison), else twice a minute.
  const connections = useQuery({
    queryKey: ["connector-instances"],
    queryFn: ({ signal }) => api.get<{ connections: ConnectionRow[] }>("/api/admin/connector-instances", undefined, signal),
    refetchInterval: (q) => (q.state.data?.connections.some((c) => (c.health?.backlog ?? 0) > 0) ? 3000 : 30_000),
  });
  const connectors = useQuery({ queryKey: ["connectors"], queryFn: ({ signal }) => api.get<{ connectors: Connector[] }>("/api/admin/connectors", undefined, signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["connector-instances"] });
  if (connections.error) return <ErrorState error={connections.error} onRetry={() => void connections.refetch()} />;
  if (!connections.data || !connectors.data) return <PageLoading />;
  const rows = connections.data.connections;
  const offered = connectors.data.connectors;
  return (
    <div className="stack">
      {rows.length ? (
        rows.map((c) => <ConnectionCard key={c.id} c={c} connector={offered.find((o) => o.provider === c.provider)} refresh={refresh} />)
      ) : (
        <EmptyState title={t("Nothing is connected yet")} icon="file">
          <p className="muted">{t("A connection links this workspace to an account at another system.")}</p>
        </EmptyState>
      )}
      <section aria-labelledby="connectors-available">
        <h3 id="connectors-available" className="connection-title">
          {t("Available here")}
        </h3>
        {offered.length ? (
          <ul className="connector-list">
            {offered.map((o) => (
              <li key={o.provider} className="card">
                <div>
                  <strong>{isolate(o.label)}</strong>
                  <p className="muted">
                    {t("{family} · API {api_version}", { family: o.family ?? "", api_version: o.api_version ?? "" })}
                  </p>
                  {o.requirements && <p className="muted">{isolate(o.requirements)}</p>}
                  <p className="connection-can">
                    {(o.capabilities ?? []).map((k) => (
                      <Badge key={k}>{isolate(words(k))}</Badge>
                    ))}
                  </p>
                </div>
                <Button size="sm" onClick={() => setAdding(o)}>
                  {t("Connect")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("No connector is installed in this workspace. They come with apps and plugins.")}</p>
        )}
      </section>
      {adding && (
        <AddConnection
          connector={adding}
          onClose={() => setAdding(null)}
          onDone={() => {
            setAdding(null);
            refresh();
            toast(t("Saved. Test it to turn it on."));
          }}
        />
      )}
    </div>
  );
}
