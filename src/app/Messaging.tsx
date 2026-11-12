// Administration → Messaging (BD-20): the text-message and chat-app connections messages go out on (the secret is write-only), the
// workspace's calling code and quiet hours, and a person's opt-outs. What was sent is the log (lib: MessageLog). The connection
// as a form is lib/channelDraft.ts. The server's refusal is shown above the form it concerns.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage, type FieldError } from "../lib/api";
import {
  checkChannel, fromChannel, newChannel, newInbound, toChannelInput, type ChannelRow, type DraftChannel, type DraftInbound, type KV,
} from "../lib/channelDraft";
import { newKey } from "../lib/automationDraft";
import { Alert, Badge, Button, confirmDialog, Dialog, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";
import { SendsTable, useSends } from "./MessageLog";
import { useMessageTemplates } from "./author/MessageCard";

const KINDS = () => ({ text: tr("Text message"), chat: tr("Chat app") });

export function Messaging() {
  return (
    <div className="stack">
      <Channels />
      <MessageSettings />
      <OptOuts />
    </div>
  );
}

// ── connections ──

function Channels() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "messages", "channels"], queryFn: ({ signal }) => api.get<{ channels: ChannelRow[] }>("/api/admin/messages/channels", undefined, signal) });
  const [editing, setEditing] = useState<DraftChannel | null>(null);
  const [testing, setTesting] = useState<ChannelRow | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "messages", "channels"] });
  const remove = async (c: ChannelRow) => {
    if (!(await confirmDialog({ title: tr("Delete {name}?", { name: c.name }), message: tr("Messages on this channel stop going out. Its secrets are deleted with it."), confirmLabel: tr("Delete"), danger: true }))) return;
    try {
      await api.del(`/api/admin/messages/channels/${encodeURIComponent(c.id)}`);
      toast(tr("Connection deleted"));
      void refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  return (
    <section className="card" aria-labelledby="ms-channels">
      <div className="card-head">
        <h2 id="ms-channels">{tr("Channels")}</h2>
        <span className="spacer" />
        <Button icon="plus" onClick={() => setEditing(newChannel("text"))}>{tr("Add a connection")}</Button>
      </div>
      <div className="card-body">
        <p className="muted">{tr("E-mail goes as all mail does. A text message or chat-app message goes through a connection to the provider you use: one turned on for each kind. A test connection delivers into the log only.")}</p>
      </div>
      {q.isLoading ? (
        <PageLoading />
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.channels.length ? (
        <EmptyState title={tr("No connections yet")} icon="settings">
          <p className="muted">{tr("Add one for text messages or a chat app. Start with a test connection to see messages arrive in the log.")}</p>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tr("Name")}</th>
                <th scope="col">{tr("Kind")}</th>
                <th scope="col">{tr("State")}</th>
                <th scope="col">{tr("Address for delivery reports and replies")}</th>
                <th scope="col"><span className="sr-only">{tr("Actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {q.data.channels.map((c) => (
                <tr key={c.id}>
                  <td>{isolate(c.name)}</td>
                  <td>{KINDS()[c.kind]}</td>
                  <td>
                    <Badge tone={c.enabled ? "green" : "neutral"}>{c.enabled ? tr("Turned on") : tr("Turned off")}</Badge>
                    {c.description.test === true && <> <Badge tone="amber">{tr("Test connection")}</Badge></>}
                    {c.has_secrets && <> <Badge>{tr("Secrets stored")}</Badge></>}
                    {c.refused > 0 && <div className="faint">{tr("{n} refused calls", { n: c.refused })}</div>}
                  </td>
                  <td className="mono">{c.description.inbound ? isolate(c.inbound) : "—"}</td>
                  <td className="nowrap">
                    <Button size="sm" icon="edit" aria-label={tr("Edit {name}", { name: c.name })} onClick={() => setEditing(fromChannel(c))}>{tr("Edit")}</Button>{" "}
                    <Button size="sm" aria-label={tr("Send a test on {name}", { name: c.name })} disabled={!c.enabled} onClick={() => setTesting(c)}>{tr("Send a test")}</Button>{" "}
                    <Button size="sm" variant="danger" icon="trash" aria-label={tr("Delete {name}", { name: c.name })} onClick={() => void remove(c)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ChannelDialog start={editing} onClose={() => setEditing(null)} onDone={refresh} />}
      {testing && <TestDialog channel={testing} onClose={() => setTesting(null)} />}
    </section>
  );
}

const KVRows = ({ legend, rows, onChange, nameLabel, valueLabel, secret, hint }: { legend: string; rows: KV[]; onChange: (r: KV[]) => void; nameLabel: string; valueLabel: string; secret?: boolean; hint?: string }) => (
  <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <legend className="field-label">{legend}</legend>
    {hint && <p className="faint">{hint}</p>}
    {rows.map((r, i) => (
      <div key={r.key} className="row" style={{ flexWrap: "wrap" }}>
        <input className="input mono" dir="ltr" style={{ flex: "1 1 140px" }} spellCheck={false} autoCapitalize="none" aria-label={tr("{label} {n}", { label: nameLabel, n: i + 1 })} value={r.name} onChange={(e) => onChange(rows.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))} />
        <input className="input mono" dir="ltr" style={{ flex: "2 1 220px" }} type={secret ? "password" : "text"} autoComplete="off" spellCheck={false} aria-label={tr("{label} {n}", { label: valueLabel, n: i + 1 })} value={r.value} onChange={(e) => onChange(rows.map((x) => (x.key === r.key ? { ...x, value: e.target.value } : x)))} />
        <Button size="sm" icon="trash" aria-label={tr("Remove {label} {n}", { label: nameLabel, n: i + 1 })} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
      </div>
    ))}
    <div>
      <Button size="sm" icon="plus" onClick={() => onChange([...rows, { key: newKey(), name: "", value: "" }])}>{tr("Add")}</Button>
    </div>
  </fieldset>
);

const text = (id: string, label: string, value: string, set: (v: string) => void, o: { hint?: string; mono?: boolean; required?: boolean; type?: string } = {}): ReactNode => (
  <Field label={label} htmlFor={id} hint={o.hint} required={o.required}>
    <input id={id} className={`input ${o.mono === false ? "" : "mono"}`} dir="ltr" type={o.type} spellCheck={false} autoCapitalize="none" value={value} onChange={(e) => set(e.target.value)} />
  </Field>
);

export function ChannelDialog({ start, onClose, onDone }: { start: DraftChannel; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState(start);
  const [problems, setProblems] = useState<string[]>([]);
  const [refused, setRefused] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const isNew = !d.id;
  const set = (p: Partial<DraftChannel>) => (setD((x) => ({ ...x, ...p })), setProblems([]), setRefused([]));
  const inbound = (p: Partial<DraftInbound>) => set({ inbound: { ...(d.inbound ?? newInbound()), ...p } });
  const save = async () => {
    const found = checkChannel(d);
    setProblems(found.map((p) => p.message));
    setRefused([]);
    if (found.length) return;
    setBusy(true);
    try {
      if (d.id) await api.put(`/api/admin/messages/channels/${encodeURIComponent(d.id)}`, toChannelInput(d));
      else await api.post("/api/admin/messages/channels", toChannelInput(d));
      toast(tr("Connection saved"));
      onDone();
      onClose();
    } catch (e) {
      setRefused(e instanceof ApiError && e.fields.length ? e.fields : [{ field: "", message: errorMessage(e) }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={isNew ? tr("Add a connection") : tr("Edit {name}", { name: start.name })}
      footer={
        <>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>{tr("Save")}</Button>
        </>
      }
    >
      <div className="stack">
        {problems.length > 0 && (
          <Alert tone="error">
            <ul>
              {problems.map((p, i) => (
                <li key={i}>{isolate(p)}</li>
              ))}
            </ul>
          </Alert>
        )}
        {refused.length > 0 && <Alert tone="error">{refused.map((f) => (f.field ? `${f.field}: ${f.message}` : f.message)).join("; ")}</Alert>}
        <Field label={tr("Kind")} htmlFor="ch-kind" hint={isNew ? undefined : tr("Fixed once saved.")}>
          <select id="ch-kind" className="select" disabled={!isNew} value={d.kind} onChange={(e) => set({ kind: e.target.value as "text" | "chat" })}>
            <option value="text">{KINDS().text}</option>
            <option value="chat">{KINDS().chat}</option>
          </select>
        </Field>
        {text("ch-name", tr("Name"), d.name, (name) => set({ name }), { mono: false, required: true })}
        <label className="check-field">
          <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {tr("Turned on (only one of each kind can be)")}
        </label>
        <label className="check-field">
          <input type="checkbox" checked={d.test} onChange={(e) => set({ test: e.target.checked })} />
          {tr("A test connection: messages are delivered into the log only, nothing leaves the server")}
        </label>
        {!d.test && (
          <>
            <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: "3 1 280px" }}>{text("ch-url", tr("Address the request goes to"), d.url, (url) => set({ url }), { required: true, hint: tr("https://…, may use {{ to }} and {{ secret.name }}") })}</div>
              <Field label={tr("Method")} htmlFor="ch-method">
                <select id="ch-method" className="select" value={d.method} onChange={(e) => set({ method: e.target.value })}>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>GET</option>
                </select>
              </Field>
            </div>
            <KVRows legend={tr("Headers")} rows={d.headers} onChange={(headers) => set({ headers })} nameLabel={tr("Header name")} valueLabel={tr("Header value")} hint={tr("Each value is a template, like Bearer {{ secret.key }}.")} />
            <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, columnGap: 16, flexWrap: "wrap" }}>
              <legend className="field-label">{tr("The request body is")}</legend>
              <label className="check-field">
                <input type="radio" name="ch-shape" checked={d.shape === "form"} onChange={() => set({ shape: "form" })} />
                {tr("A form (fields)")}
              </label>
              <label className="check-field">
                <input type="radio" name="ch-shape" checked={d.shape === "json"} onChange={() => set({ shape: "json" })} />
                {tr("JSON")}
              </label>
            </fieldset>
            {d.shape === "form" ? (
              <KVRows legend={tr("Form fields")} rows={d.form} onChange={(form) => set({ form })} nameLabel={tr("Field name")} valueLabel={tr("Field value")} hint={tr("Values are templates over to, text, template_name, values, language, from and secret.name.")} />
            ) : (
              <Field label={tr("JSON body (a template)")} htmlFor="ch-body" hint={tr("Over to, text, template_name, values, language, from and secret.name; {{ value|json }} writes a value as JSON.")}>
                <textarea id="ch-body" className="textarea mono" dir="ltr" rows={5} spellCheck={false} value={d.body} onChange={(e) => set({ body: e.target.value })} />
              </Field>
            )}
          </>
        )}
        <div className="row" style={{ flexWrap: "wrap" }}>
          {text("ch-from", tr("Sender (from)"), d.from, (from) => set({ from }), { mono: false })}
          {text("ch-id", tr("Where the provider's id is in its answer"), d.id_at, (id_at) => set({ id_at }), { hint: tr("A JSON pointer, like /message_id") })}
          {text("ch-error", tr("Where its error is"), d.error_at, (error_at) => set({ error_at }), { hint: tr("A JSON pointer, like /error") })}
          {text("ch-later", tr("Statuses meaning “later”"), d.temporary, (temporary) => set({ temporary }), { hint: tr("Retried while the provider says one of these; empty: 408, 425, 429, 500, 502, 503, 504. Any other failure is final.") })}
        </div>
        <KVRows
          legend={tr("Secrets")}
          rows={d.secrets}
          onChange={(secrets) => set({ secrets })}
          nameLabel={tr("Secret name")}
          valueLabel={tr("Secret value")}
          secret
          hint={start.id ? tr("Never shown again. Entering any replaces every stored secret, so enter all of them; leave this empty to keep what is stored.") : tr("Never shown again once saved. Used as secret.name in the request and by the inbound check.")}
        />
        <label className="check-field">
          <input type="checkbox" checked={!!d.inbound} onChange={(e) => set({ inbound: e.target.checked ? newInbound() : null })} />
          {tr("The provider calls back with delivery reports and replies")}
        </label>
        {d.inbound && <InboundFields i={d.inbound} onChange={inbound} />}
      </div>
    </Dialog>
  );
}

function InboundFields({ i, onChange }: { i: DraftInbound; onChange: (p: Partial<DraftInbound>) => void }) {
  return (
    <fieldset className="stack" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: 0, minWidth: 0 }}>
      <legend className="field-label">{tr("Inbound")}</legend>
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={tr("Authenticated by")} htmlFor="ib-auth">
          <select id="ib-auth" className="select" value={i.auth} onChange={(e) => onChange({ auth: e.target.value as "hmac" | "token" })}>
            <option value="token">{tr("A shared token")}</option>
            <option value="hmac">{tr("An HMAC of the body")}</option>
          </select>
        </Field>
        {text("ib-header", tr("Header it arrives in"), i.header, (header) => onChange({ header }), { hint: i.auth === "hmac" ? tr("Required, like X-Signature.") : tr("Empty: the token query parameter.") })}
        {text("ib-secret", tr("Name of the secret"), i.secret, (secret) => onChange({ secret }), { required: true, hint: tr("One of the secrets above.") })}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {text("ib-id", tr("Where the id is"), i.id_at, (id_at) => onChange({ id_at }))}
        {text("ib-status", tr("Where the status is"), i.status_at, (status_at) => onChange({ status_at }))}
        {text("ib-from", tr("Where a reply's number is"), i.from_at, (from_at) => onChange({ from_at }))}
        {text("ib-text", tr("Where a reply's words are"), i.text_at, (text_at) => onChange({ text_at }))}
      </div>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="field-label">{tr("The provider's statuses")}</legend>
        {i.statuses.map((s, n) => (
          <div key={s.key} className="row">
            <input className="input mono" dir="ltr" aria-label={tr("Provider status {n}", { n: n + 1 })} value={s.name} onChange={(e) => onChange({ statuses: i.statuses.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)) })} />
            <select className="select" aria-label={tr("Becomes {n}", { n: n + 1 })} value={s.value} onChange={(e) => onChange({ statuses: i.statuses.map((x) => (x.key === s.key ? { ...x, value: e.target.value } : x)) })}>
              <option value="">{tr("Choose…")}</option>
              <option value="sent">{tr("Sent")}</option>
              <option value="delivered">{tr("Delivered")}</option>
              <option value="failed">{tr("Failed")}</option>
            </select>
            <Button size="sm" icon="trash" aria-label={tr("Remove provider status {n}", { n: n + 1 })} onClick={() => onChange({ statuses: i.statuses.filter((x) => x.key !== s.key) })} />
          </div>
        ))}
        <div>
          <Button size="sm" icon="plus" onClick={() => onChange({ statuses: [...i.statuses, { key: newKey(), name: "", value: "" }] })}>{tr("Add a status")}</Button>
        </div>
      </fieldset>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {text("ib-stop", tr("Words that opt a number out"), i.stop, (stop) => onChange({ stop }), { hint: tr("Separated by commas.") })}
        {text("ib-start", tr("Words that opt it back in"), i.start, (start) => onChange({ start }), { hint: tr("Separated by commas.") })}
      </div>
    </fieldset>
  );
}

/** A test through the connection: a template sent to oneself on its kind of channel. */
function TestDialog({ channel, onClose }: { channel: ChannelRow; onClose: () => void }) {
  const templates = useMessageTemplates();
  const [template, setTemplate] = useState("");
  const [phone, setPhone] = useState("");
  const usable = (templates.data?.templates ?? []).filter((t) => t.channels.includes(channel.kind));
  const send = useMutation({ mutationFn: () => api.post<{ sent: { channel: string; state: string; reason?: string | null }[] }>("/api/admin/messages/test", { template, channel: channel.kind, ...(phone.trim() ? { phone: phone.trim() } : {}) }) });
  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("Send a test on {name}", { name: channel.name })}
      footer={
        <>
          <Button onClick={onClose}>{tr("Close")}</Button>
          <Button variant="primary" loading={send.isPending} disabled={!template || send.isPending} onClick={() => send.mutate()}>{tr("Send a test to me")}</Button>
        </>
      }
    >
      <div className="stack">
        <Field label={tr("Template")} htmlFor="tt-template" hint={usable.length ? undefined : tr("No template has a body for this kind of channel.")}>
          <select id="tt-template" className="select" value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">{tr("Choose…")}</option>
            {usable.map((t) => (
              <option key={t.key} value={t.key}>{isolate(t.label ? `${t.label} (${t.key})` : t.key)}</option>
            ))}
          </select>
        </Field>
        <Field label={tr("Your number")} htmlFor="tt-phone" hint={tr("Otherwise the one on your account. A number without + gets the workspace's calling code.")}>
          <input id="tt-phone" className="input" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {send.error && <Alert tone="error">{isolate(errorMessage(send.error))}</Alert>}
        {send.data && (
          <ul aria-label={tr("What the test came to")}>
            {send.data.sent.map((s, n) => (
              <li key={n}>{tr("{channel}: {state}", { channel: s.channel, state: s.state })}{s.reason ? ` (${s.reason})` : ""}</li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

// ── the workspace's settings for messages ──

interface MessagesSettings {
  calling_code?: string;
  trunk_prefix?: string;
  quiet_hours?: { from: string; to: string };
  per_hour?: number;
  per_recipient_hour?: number;
}

function MessageSettings() {
  const q = useQuery({ queryKey: ["admin", "settings"], queryFn: ({ signal }) => api.get<{ messages?: MessagesSettings }>("/api/admin/settings", undefined, signal) });
  return (
    <section className="card" aria-labelledby="ms-settings">
      <div className="card-head">
        <h2 id="ms-settings">{tr("Numbers, quiet hours and limits")}</h2>
      </div>
      {q.isLoading ? <PageLoading /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <SettingsForm initial={q.data.messages ?? {}} />}
    </section>
  );
}

export function SettingsForm({ initial }: { initial: MessagesSettings }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    calling_code: initial.calling_code ?? "", trunk_prefix: initial.trunk_prefix ?? "", from: initial.quiet_hours?.from ?? "", to: initial.quiet_hours?.to ?? "",
    per_hour: initial.per_hour?.toString() ?? "", per_recipient_hour: initial.per_recipient_hour?.toString() ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => (setV((x) => ({ ...x, [k]: e.target.value })), setError(null));
  const half = !!v.from !== !!v.to;
  const save = async () => {
    if (half) return setError(tr("Quiet hours need both a start and an end, or neither."));
    const messages: MessagesSettings = {
      ...(v.calling_code.trim() ? { calling_code: v.calling_code.trim() } : {}),
      ...(v.trunk_prefix.trim() ? { trunk_prefix: v.trunk_prefix.trim() } : {}),
      ...(v.from && v.to ? { quiet_hours: { from: v.from, to: v.to } } : {}),
      ...(v.per_hour.trim() ? { per_hour: Number(v.per_hour) } : {}),
      ...(v.per_recipient_hour.trim() ? { per_recipient_hour: Number(v.per_recipient_hour) } : {}),
    };
    setBusy(true);
    try {
      await api.put("/api/admin/settings", { messages });
      // The Workspace form sends its settings back whole: it must not send an old copy of these.
      qc.setQueryData(["admin", "settings"], (old: object | undefined) => ({ ...(old ?? {}), messages }));
      toast(tr("Saved"));
    } catch (e) {
      setError(e instanceof ApiError && e.fields.length ? e.fields.map((f) => f.message).join("; ") : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card-body stack" onSubmit={(e) => (e.preventDefault(), void save())}>
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={tr("Calling code")} htmlFor="mset-code" hint={tr("Completes a number written without +, like +49. With none set, such a number is refused, never guessed.")}>
          <input id="mset-code" className="input mono" dir="ltr" style={{ width: 110 }} value={v.calling_code} onChange={set("calling_code")} />
        </Field>
        <Field label={tr("Trunk prefix")} htmlFor="mset-trunk" hint={tr("What numbers start with nationally and drop, like 0.")}>
          <input id="mset-trunk" className="input mono" dir="ltr" style={{ width: 90 }} value={v.trunk_prefix} onChange={set("trunk_prefix")} />
        </Field>
      </div>
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={tr("Quiet hours from")} htmlFor="mset-from" hint={tr("Promotional text and chat-app messages wait until they end, in the recipient's time zone when known.")}>
          <input id="mset-from" className="input" type="time" style={{ width: 130 }} value={v.from} onChange={set("from")} />
        </Field>
        <Field label={tr("Quiet hours to")} htmlFor="mset-to">
          <input id="mset-to" className="input" type="time" style={{ width: 130 }} value={v.to} onChange={set("to")} />
        </Field>
      </div>
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={tr("Most messages an hour")} htmlFor="mset-hour" hint={tr("Text and chat-app messages together; empty: the server's limit.")}>
          <input id="mset-hour" className="input" type="number" min={0} style={{ width: 130 }} value={v.per_hour} onChange={set("per_hour")} />
        </Field>
        <Field label={tr("Most to one recipient an hour")} htmlFor="mset-recipient">
          <input id="mset-recipient" className="input" type="number" min={0} style={{ width: 130 }} value={v.per_recipient_hour} onChange={set("per_recipient_hour")} />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="primary" loading={busy}>{tr("Save")}</Button>
      </div>
    </form>
  );
}

// ── opt-outs ──

const OPT_CHANNELS = () => ({ email: tr("E-mail"), text: tr("Text message"), chat: tr("Chat app") });

/** Staff recording a person's choice for promotional messages. The server keeps these with the consent records and offers no list of them, so what is shown for an address is what was sent to it. */
function OptOuts() {
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const [channel, setChannel] = useState<"email" | "text" | "chat">("email");
  const [looked, setLooked] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const sends = useSends({ recipient: looked }, !!looked);
  const record = useMutation({
    mutationFn: (opted_out: boolean) => api.put("/api/admin/messages/opt-outs", { address: address.trim(), channel, opted_out }),
    onSuccess: (_, opted_out) => setDone(opted_out ? tr("{address} will receive no promotional {channel}.", { address: address.trim(), channel: OPT_CHANNELS()[channel] }) : tr("{address} may receive promotional {channel} again.", { address: address.trim(), channel: OPT_CHANNELS()[channel] })),
    onError: () => setDone(null),
  });
  return (
    <section className="card" aria-labelledby="ms-optouts">
      <div className="card-head">
        <h2 id="ms-optouts">{tr("Opt-outs")}</h2>
      </div>
      <form className="card-body stack" onSubmit={(e) => (e.preventDefault(), setLooked(address.trim()), void qc.invalidateQueries({ queryKey: ["messages", "log"] }))}>
        <p className="muted">{tr("Operational messages always go. A promotional one respects the choice recorded for an address or number on its channel: from the link in the message, a reply with a stop word, or here.")}</p>
        {record.error && <Alert tone="error">{isolate(errorMessage(record.error))}</Alert>}
        {done && <Alert tone="success">{isolate(done)}</Alert>}
        <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label={tr("Address or number")} htmlFor="oo-address">
            <input id="oo-address" className="input" dir="ltr" style={{ width: 260 }} value={address} onChange={(e) => (setAddress(e.target.value), setDone(null))} />
          </Field>
          <Field label={tr("Channel")} htmlFor="oo-channel">
            <select id="oo-channel" className="select" value={channel} onChange={(e) => (setChannel(e.target.value as typeof channel), setDone(null))}>
              {(Object.entries(OPT_CHANNELS()) as [string, string][]).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </Field>
          <Button type="button" variant="danger" disabled={!address.trim() || record.isPending} onClick={() => record.mutate(true)}>{tr("Opt out")}</Button>
          <Button type="button" disabled={!address.trim() || record.isPending} onClick={() => record.mutate(false)}>{tr("Opt back in")}</Button>
          <Button type="submit" disabled={!address.trim()}>{tr("Show what was sent to it")}</Button>
        </div>
        {looked && (sends.isLoading ? <PageLoading /> : sends.error ? <ErrorState error={sends.error} onRetry={() => sends.refetch()} /> : !sends.data?.sends.length ? <p className="muted">{tr("Nothing was sent to {address}.", { address: looked })}</p> : <SendsTable sends={sends.data.sends} label={tr("Messages sent to {address}", { address: looked })} />)}
      </form>
    </section>
  );
}
