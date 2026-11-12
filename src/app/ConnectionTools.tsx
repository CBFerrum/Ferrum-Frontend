// What an administrator does with a saved connection besides describing it: try an operation, turn on a timed capture, read
// the call log, run a pull now, and copy the address it is called on. Every answer is the server's, masked there.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { t, isolate } from "@ferrum/client";
import { api, errorMessage, newKey } from "../lib/api";
import { captureMinutes, changes, parseInputs, type ConnectionRow } from "../lib/connectionDraft";
import { formatMoment } from "../lib/format";
import { Alert, Badge, Button, Field, toast } from "../ui/kit";
import { ListSkeleton, LoadFailed } from "../ui/patterns";
import { useLinkTitle } from "./widgets";

const Person = ({ id }: { id: string }) => <>{isolate(useLinkTitle("User", id) ?? "…")}</>;

const when = (v?: string | null) => (v ? formatMoment(v, { dateStyle: "medium", timeStyle: "medium" }) : "");

interface Tried {
  ok: boolean;
  result?: unknown;
  answer?: unknown;
  temporary?: boolean;
  error?: string;
}

export function Try({ row }: { row: ConnectionRow }) {
  const ops = Object.keys(row.description.operations ?? {});
  const [op, setOp] = useState(ops[0] ?? "");
  const [inputs, setInputs] = useState("{}");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (body: { operation: string; inputs: Record<string, unknown>; key?: string }) => api.post<Tried>(`/api/admin/connections/${row.id}/try`, body),
    onError: (e) => setError(errorMessage(e)),
  });
  const needsKey = changes(row.description.operations?.[op] ?? {});
  const go = () => {
    if (run.isPending) return;
    setError(null);
    const parsed = parseInputs(inputs);
    if (!parsed.ok) return setError(parsed.error);
    run.mutate({ operation: op, inputs: parsed.value, ...(key.trim() ? { key: key.trim() } : {}) });
  };
  if (!ops.length) return <p className="muted">{t("Describe an operation first, then try it here.")}</p>;
  const out = run.data;
  return (
    <div className="stack">
      <Field label={t("Operation")} htmlFor="try-op">
        <select id="try-op" className="select" value={op} onChange={(e) => setOp(e.target.value)}>
          {ops.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label={t("Inputs")} htmlFor="try-inputs" hint={t("A JSON object.")}>
        <textarea id="try-inputs" className="textarea mono" rows={3} value={inputs} onChange={(e) => setInputs(e.target.value)} />
      </Field>
      {needsKey && (
        <Field label={t("Key")} htmlFor="try-key" hint={t("This operation changes something at the service, so trying it needs a key.")}>
          <div className="row">
            <input id="try-key" className="input mono" value={key} onChange={(e) => setKey(e.target.value)} />
            <Button size="sm" onClick={() => setKey(`try:${newKey()}`)}>{t("Make one")}</Button>
          </div>
        </Field>
      )}
      <div><Button variant="primary" loading={run.isPending} onClick={go}>{t("Try it")}</Button></div>
      <div aria-live="polite" className="stack">
        {error && <Alert tone="error">{isolate(error)}</Alert>}
        {out && !out.ok && <Alert tone="error">{out.temporary ? t("The service said later: {error}", { error: out.error ?? "" }) : isolate(out.error ?? "")}</Alert>}
        {out?.ok && (
          <>
            <h4 className="field-label">{t("The mapped result")}</h4>
            <pre className="mono card" tabIndex={0}>{JSON.stringify(out.result, null, 2)}</pre>
            <h4 className="field-label">{t("The whole answer")}</h4>
            <pre className="mono card" tabIndex={0}>{JSON.stringify(out.answer, null, 2)}</pre>
          </>
        )}
      </div>
    </div>
  );
}

export function Capture({ row, onChange }: { row: ConnectionRow; onChange: () => void }) {
  const [minutes, setMinutes] = useState("15");
  const [error, setError] = useState<string | null>(null);
  const live = row.debug_until && new Date(row.debug_until) > new Date();
  const set = useMutation({
    mutationFn: (m: number) => api.put(`/api/admin/connections/${row.id}/debug`, { minutes: m }),
    onSuccess: (_d, m) => { toast(m ? t("The capture is on") : t("The capture is off")); onChange(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const start = () => {
    const m = captureMinutes(minutes);
    if (m === null) return setError(t("Minutes: a whole number from 0 to 60"));
    setError(null);
    set.mutate(m);
  };
  return (
    <div className="stack">
      <p className="muted">{t("While it is on, the log keeps each request and answer, with secrets hidden. It turns itself off.")}</p>
      {live && <Alert tone="warning">{t("Capturing until {at}", { at: when(row.debug_until) })}</Alert>}
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label={t("Minutes (0 to 60)")} htmlFor="cap-min">
          <input id="cap-min" className="input" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} style={{ width: 100 }} />
        </Field>
        <Button variant="primary" loading={set.isPending} onClick={start}>{t("Capture")}</Button>
        {live && <Button loading={set.isPending} onClick={() => set.mutate(0)}>{t("Turn it off")}</Button>}
      </div>
    </div>
  );
}

interface Call { at: string; operation: string; outcome: string; status?: number | null; duration_ms?: number | null; entity?: string | null; record_id?: string | null; error?: string | null; debug?: unknown }
interface Received { delivery: string; received_at: string; state: string; error?: string | null }
const OUTCOME: Record<string, "green" | "red" | "amber" | "neutral"> = { ok: "green", refused: "red", no: "red", later: "amber" };

export function Log({ row }: { row: ConnectionRow }) {
  const q = useQuery({ queryKey: ["connection-log", row.id], queryFn: ({ signal }) => api.get<{ calls: Call[]; received: Received[] }>(`/api/admin/connections/${row.id}/log`, { limit: 100 }, signal) });
  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.error || !q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
  const { calls, received } = q.data;
  return (
    <div className="stack">
      <div className="row"><Button size="sm" icon="refresh" onClick={() => void q.refetch()}>{t("Refresh")}</Button></div>
      <h4 className="field-label">{t("Calls made")}</h4>
      {calls.length === 0 ? <p className="muted">{t("No call has been made yet.")}</p> : (
        <div className="table-scroll"><table className="table">
          <thead><tr><th>{t("When")}</th><th>{t("Operation")}</th><th>{t("Outcome")}</th><th className="num">{t("Status")}</th><th className="num">{t("Took (ms)")}</th><th>{t("About")}</th></tr></thead>
          <tbody>
            {calls.map((c, i) => (
              <tr key={i}>
                <td>{when(c.at)}</td>
                <td className="mono">{isolate(c.operation)}</td>
                <td><Badge tone={OUTCOME[c.outcome] ?? "neutral"}>{isolate(c.outcome)}</Badge>{c.error ? <span className="muted"> {isolate(c.error)}</span> : null}</td>
                <td className="num">{c.status ?? ""}</td>
                <td className="num">{c.duration_ms ?? ""}</td>
                <td>{c.entity ? isolate(`${c.entity} ${c.record_id ?? ""}`) : ""}
                  {c.debug ? <details><summary>{t("Captured")}</summary><pre className="mono" tabIndex={0}>{JSON.stringify(c.debug, null, 2)}</pre></details> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <h4 className="field-label">{t("Calls received")}</h4>
      {received.length === 0 ? <p className="muted">{t("Nothing has been received yet.")}</p> : (
        <div className="table-scroll"><table className="table">
          <thead><tr><th>{t("When")}</th><th>{t("Delivery")}</th><th>{t("State")}</th></tr></thead>
          <tbody>
            {received.map((r, i) => (
              <tr key={i}>
                <td>{when(r.received_at)}</td>
                <td className="mono">{isolate(r.delivery)}</td>
                <td><Badge tone={r.state === "done" ? "green" : r.state === "failed" ? "red" : "amber"}>{isolate(r.state)}</Badge>{r.error ? <span className="muted"> {isolate(r.error)}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

interface Pull { user?: string | null; name: string; cursor?: unknown; last_run?: string | null; next_run?: string | null; last_error?: string | null }

export function PullsPanel({ row }: { row: ConnectionRow }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["connection-pulls", row.id], queryFn: ({ signal }) => api.get<{ pulls: Pull[] }>(`/api/admin/connections/${row.id}/pulls`, undefined, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <ListSkeleton rows={2} />;
  if (q.error || !q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
  const run = async (name: string) => {
    if (busy) return;
    setBusy(name);
    setError(null);
    try {
      await api.post(`/api/admin/connections/${row.id}/pulls/${encodeURIComponent(name)}`);
      toast(t("Queued"));
      await qc.invalidateQueries({ queryKey: ["connection-pulls", row.id] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (!q.data.pulls.length) return <p className="muted">{t("This connection pulls nothing.")}</p>;
  return (
    <div className="stack">
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      <div className="table-scroll"><table className="table">
        <thead><tr><th>{t("Pull")}</th><th>{t("Runs as")}</th><th>{t("Last run")}</th><th>{t("Next run")}</th><th>{t("Cursor")}</th><th>{t("Failure")}</th><th><span className="sr-only">{t("Actions")}</span></th></tr></thead>
        <tbody>
          {q.data.pulls.map((p) => (
            <tr key={`${p.name}|${p.user ?? ""}`}>
              <td className="mono">{isolate(p.name)}</td>
              <td>{p.user ? <Person id={p.user} /> : t("The workspace")}</td>
              <td>{p.last_run ? when(p.last_run) : t("Never")}</td>
              <td>{when(p.next_run)}</td>
              <td className="mono">{p.cursor == null ? "" : isolate(typeof p.cursor === "string" ? p.cursor : JSON.stringify(p.cursor))}</td>
              <td>{p.last_error ? <Badge tone="red">{isolate(p.last_error)}</Badge> : ""}</td>
              <td className="num"><Button size="sm" loading={busy === p.name} disabled={!!busy} onClick={() => void run(p.name)}>{t("Run now")}</Button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export function InboundAddress({ row }: { row: ConnectionRow }) {
  const url = `${typeof location === "undefined" ? "" : location.origin}${row.inbound ?? `/api/connections/inbound/${row.id}`}`;
  if (!row.description.inbound) return <p className="muted">{t("This connection takes nothing in. Describe what it takes under “Called from outside”.")}</p>;
  return (
    <Field label={t("Address to give the caller")} htmlFor="inbound-url" hint={t("POST to it. A call that is not accepted gets the same refusal whatever the reason.")}>
      <div className="row">
        <input id="inbound-url" className="input mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <Button onClick={() => void navigator.clipboard?.writeText(url).then(() => toast(t("Copied")), () => toast(t("Could not copy"), "error"))}>{t("Copy")}</Button>
      </div>
    </Field>
  );
}
