// Connections to outside services (Administration → Connections; BD-29 to BD-33): the workspace's list with each one's state,
// the editor (structured and raw), and for a saved one the tools: try an operation, a timed capture, the call log, pulls and
// the inbound address. `MyConnections` is a person's own: connect (the provider's page, by the broker's redirect), state,
// disconnect. The logic is lib/connectionDraft.ts.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { t, isolate } from "@ferrum/client";
import { api, errorMessage } from "../lib/api";
import { connectionState, personalState, STATE, type ConnectionRow, type PersonalConnection } from "../lib/connectionDraft";
import { formatMoment } from "../lib/format";
import { Alert, Badge, Button, confirmDialog, EmptyState, Tabs, TabPanel, toast } from "../ui/kit";
import { ListSkeleton, LoadFailed } from "../ui/patterns";
import { ConnectionEditor } from "./ConnectionEditor";
import { Capture, InboundAddress, Log, PullsPanel, Try } from "./ConnectionTools";

const TOOLS = () => [
  { id: "try", label: t("Try") },
  { id: "capture", label: t("Capture") },
  { id: "log", label: t("Call log") },
  { id: "pulls", label: t("Pulls") },
  { id: "inbound", label: t("Inbound") },
];

function Tools({ row, refresh }: { row: ConnectionRow; refresh: () => void }) {
  const [tab, setTab] = useState("try");
  return (
    <section className="card stack" aria-label={t("Tools for {name}", { name: row.label })}>
      <Tabs id="conn-tools" tabs={TOOLS()} value={tab} onChange={setTab} />
      <TabPanel id="conn-tools" tab={tab}>
        {tab === "try" && <Try row={row} />}
        {tab === "capture" && <Capture row={row} onChange={refresh} />}
        {tab === "log" && <Log row={row} />}
        {tab === "pulls" && <PullsPanel row={row} />}
        {tab === "inbound" && <InboundAddress row={row} />}
      </TabPanel>
    </section>
  );
}

function signInOf(c: ConnectionRow): "workspace" | "person" | null {
  const a = c.description.auth;
  return a?.type === "oauth" ? (a.owner === "person" ? "person" : "workspace") : null;
}

export function Connections() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "connections"], queryFn: ({ signal }) => api.get<{ connections: ConnectionRow[] }>("/api/admin/connections", undefined, signal) });
  const [editing, setEditing] = useState<ConnectionRow | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tookUp, setTookUp] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin", "connections"] });
  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.error || !q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data.connections;
  if (editing) {
    return (
      <ConnectionEditor
        key={editing === "new" ? "new" : (editing.id ?? editing.name)}
        tookUp={tookUp}
        row={editing === "new" ? null : editing}
        onClose={() => { setEditing(null); setTookUp(false); }}
        onSaved={(id) => {
          setEditing(null);
          setTookUp(false);
          if (id) setOpen(id);
          refresh();
          toast(t("Saved"));
        }}
      />
    );
  }
  const act = async (key: string, call: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const r = await call();
      if (done) toast(done);
      return r;
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  // What the package offers is saved exactly as offered, off; then it opens for secrets and turning on. The form never rebuilds it.
  const takeUp = (c: ConnectionRow) =>
    void act(`take:${c.name}`, async () => {
      const { id } = await api.post<{ id: string }>("/api/admin/connections", { name: c.name, label: c.label, enabled: false, description: c.description });
      const saved = (await api.get<{ connections: ConnectionRow[] }>("/api/admin/connections")).connections.find((x) => x.id === id);
      if (saved) { setTookUp(true); setEditing(saved); }
    });
  const remove = async (c: ConnectionRow) => {
    const ok = await confirmDialog({ title: t("Delete {name}?", { name: c.label }), message: t("Apps and buttons that call it stop working. Its secrets and sign-ins are forgotten."), confirmLabel: t("Delete"), danger: true });
    if (ok) await act(`del:${c.id}`, () => api.del(`/api/admin/connections/${c.id}`), t("Deleted"));
  };
  const connect = (c: ConnectionRow) =>
    void act(`connect:${c.id}`, async () => {
      const { url } = await api.post<{ url: string }>(`/api/connections/${c.id}/connect`);
      location.assign(url);
    });
  const disconnect = async (c: ConnectionRow) => {
    const ok = await confirmDialog({ title: t("Disconnect {name}?", { name: c.label }), message: t("Its sign-in is forgotten, and revoked at the provider where it allows that."), confirmLabel: t("Disconnect"), danger: true });
    if (ok) await act(`disconnect:${c.id}`, () => api.del(`/api/connections/${c.id}/connect`), t("Disconnected"));
  };
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <p className="muted">{t("One described service the workspace calls, is called by, pulls from and signs in to.")}</p>
        <Button variant="primary" onClick={() => setEditing("new")}>{t("New connection")}</Button>
      </div>
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      {rows.length === 0 && (
        <EmptyState title={t("Nothing is connected yet")} icon="file">
          <p className="muted">{t("Describe a service, or install a package that offers one.")}</p>
        </EmptyState>
      )}
      <ul className="stack" aria-label={t("Connections")} style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {rows.map((c) => {
          const s = connectionState(c);
          const who = signInOf(c);
          const key = c.id ?? `offered:${c.name}`;
          return (
            <li key={key} className="stack">
              <section className="card connection" aria-label={c.label}>
                <header className="connection-head">
                  <div>
                    <h3>{isolate(c.label)}</h3>
                    <p className="muted mono">{isolate(c.name)}{c.source ? <span className="faint"> · {isolate(c.source)}</span> : null}</p>
                  </div>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    {c.offered ? <Badge>{t("Offered by a package")}</Badge> : <Badge tone={STATE[s].tone}>{STATE[s].label}</Badge>}
                    {c.account?.account && <span className="muted">{isolate(c.account.account)}</span>}
                    {c.account?.expires_at && <span className="faint">{t("Sign-in until {at}", { at: formatMoment(c.account.expires_at, { dateStyle: "medium", timeStyle: "short" }) })}</span>}
                  </div>
                </header>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <Button size="sm" loading={busy === `take:${c.name}`} disabled={!!busy} onClick={() => (c.offered ? takeUp(c) : setEditing(c))}>{c.offered ? t("Take it up") : t("Edit")}</Button>
                  {!c.offered && <Button size="sm" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>{t("Try, log and pulls")}</Button>}
                  {!c.offered && who === "workspace" && (
                    <Button size="sm" loading={busy === `connect:${c.id}`} disabled={!!busy} onClick={() => connect(c)}>{s === "reconnect" ? t("Connect again") : c.account ? t("Reconnect") : t("Connect")}</Button>
                  )}
                  {!c.offered && c.description.auth?.type === "session" && (
                    <Button size="sm" loading={busy === `session:${c.id}`} disabled={!!busy} onClick={() => void act(`session:${c.id}`, () => api.post(`/api/admin/connections/${c.id}/session`), t("Signed in"))}>{t("Sign in again")}</Button>
                  )}
                  {!c.offered && who === "workspace" && c.account && (
                    <Button size="sm" variant="ghost" loading={busy === `disconnect:${c.id}`} disabled={!!busy} onClick={() => void disconnect(c)}>{t("Disconnect")}</Button>
                  )}
                  {!c.offered && <Button size="sm" variant="danger" loading={busy === `del:${c.id}`} disabled={!!busy} onClick={() => void remove(c)}>{t("Delete")}</Button>}
                </div>
                {!c.offered && !!c.refused && <p className="muted">{t("{n} calls to its inbound address were refused.", { n: c.refused })}</p>}
                {c.secrets.length > 0 && <p className="faint">{t("Secrets set: {names}", { names: c.secrets.join(", ") })}</p>}
              </section>
              {open === c.id && c.id && <Tools row={c} refresh={refresh} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A person's own connections: the accounts they sign in to for themselves (their mailbox), connected from here. */
export function MyConnections() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["connections", "mine"], queryFn: ({ signal }) => api.get<{ connections: PersonalConnection[] }>("/api/connections", undefined, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <ListSkeleton rows={2} />;
  if (q.error || !q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
  const go = async (c: PersonalConnection, kind: "connect" | "disconnect") => {
    if (busy) return;
    if (kind === "disconnect" && !(await confirmDialog({ title: t("Disconnect {name}?", { name: c.label }), message: t("Your sign-in is forgotten, and revoked at the provider where it allows that."), confirmLabel: t("Disconnect"), danger: true }))) return;
    setBusy(c.id);
    setError(null);
    try {
      if (kind === "connect") {
        const { url } = await api.post<{ url: string }>(`/api/connections/${c.id}/connect`);
        location.assign(url);
        return;
      }
      await api.del(`/api/connections/${c.id}/connect`);
      toast(t("Disconnected"));
      await qc.invalidateQueries({ queryKey: ["connections", "mine"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (!q.data.connections.length) return <p className="muted">{t("Nothing here asks you to connect an account.")}</p>;
  return (
    <div className="stack">
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      <ul className="stack" aria-label={t("My connections")} style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {q.data.connections.map((c) => {
          const s = personalState(c);
          return (
            <li key={c.id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <div>
                <strong>{isolate(c.label)}</strong>{" "}
                <Badge tone={s === "connected" ? "green" : s === "reconnect" ? "amber" : "neutral"}>{s === "connected" ? t("Connected") : s === "reconnect" ? t("Needs reconnecting") : t("Not connected")}</Badge>
                {c.account && <span className="muted"> {isolate(c.account)}</span>}
              </div>
              <div className="row">
                <Button size="sm" variant={s === "connected" ? "default" : "primary"} loading={busy === c.id} disabled={!!busy} onClick={() => void go(c, "connect")}>
                  {s === "connected" ? t("Reconnect") : s === "reconnect" ? t("Connect again") : t("Connect")}
                </Button>
                {s !== "none" && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void go(c, "disconnect")}>{t("Disconnect")}</Button>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
