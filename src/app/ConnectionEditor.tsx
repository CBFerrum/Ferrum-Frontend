// The description of a connection, edited two ways over one value: a structured form (base address, sign-in, headers, hosts,
// limits, who may use it, operations, what it takes in, what it pulls) and the raw JSON, whose faults are the server's to say.
// Secrets are write-only: password boxes nobody holds in state (read from the form when it is sent, emptied after), never
// read back. The logic is lib/connectionDraft.ts.

import { useState, type FormEvent, type ReactNode } from "react";
import { t, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage } from "../lib/api";
import {
  at, AUTH_KINDS, checkConnection, connectionBody, entries, lines, METHODS, NAME, number, parseDescription, put, secretNames, secretsToSend, tidy, type AuthKind, type ConnectionRow, type Desc,
} from "../lib/connectionDraft";
import { Alert, Button, Field } from "../ui/kit";

const KINDS: Record<AuthKind, () => string> = {
  none: () => t("No sign-in"),
  header: () => t("A header holding a secret"),
  basic: () => t("User name and password"),
  bearer: () => t("Bearer token"),
  signed: () => t("Signed request"),
  oauth: () => t("Signing in to an account"),
};

/** Rows of name and value, kept as a map; a row with no name is not yet part of it. */
function Pairs({ id, label, value, onChange, keyLabel, valueLabel, mono }: { id: string; label: string; value: unknown; onChange: (m: Record<string, string>) => void; keyLabel: string; valueLabel: string; mono?: boolean }) {
  const [rows, setRows] = useState<[string, string][]>(() => entries(value));
  const emit = (next: [string, string][]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])));
  };
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="field-label">{label}</legend>
      {rows.map(([k, v], i) => (
        <div className="row" key={i} style={{ flexWrap: "wrap" }}>
          <input id={`${id}-k${i}`} className="input mono" aria-label={`${label}: ${keyLabel} ${i + 1}`} value={k} onChange={(e) => emit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} style={{ flex: "1 1 140px" }} />
          <input className={`input${mono ? " mono" : ""}`} aria-label={`${label}: ${valueLabel} ${i + 1}`} value={v} onChange={(e) => emit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} style={{ flex: "2 1 200px" }} />
          <Button size="sm" variant="ghost" aria-label={t("Remove {label} {n}", { label, n: i + 1 })} onClick={() => emit(rows.filter((_, j) => j !== i))}>
            {t("Remove")}
          </Button>
        </div>
      ))}
      <div>
        <Button size="sm" onClick={() => emit([...rows, ["", ""]])}>
          {t("Add a row")}
        </Button>
      </div>
    </fieldset>
  );
}

const Text = ({ id, label, value, onChange, hint, mono, type }: { id: string; label: string; value: unknown; onChange: (v: string) => void; hint?: ReactNode; mono?: boolean; type?: string }) => (
  <Field label={label} htmlFor={id} hint={hint}>
    <input id={id} type={type} className={`input${mono ? " mono" : ""}`} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} />
  </Field>
);

const List = ({ id, label, value, onChange, hint }: { id: string; label: string; value: unknown; onChange: (v: string[]) => void; hint?: ReactNode }) => (
  <Field label={label} htmlFor={id} hint={hint}>
    <textarea id={id} className="textarea mono" rows={2} defaultValue={Array.isArray(value) ? value.join("\n") : ""} onChange={(e) => onChange(lines(e.target.value))} />
  </Field>
);

type Set = (path: string[], v: unknown) => void;

function Auth({ d, set }: { d: Desc; set: Set }) {
  const kind: AuthKind = (at(d, "auth", "type") as AuthKind) ?? "none";
  const a = (k: string) => at(d, "auth", k);
  return (
    <div className="stack">
      <Field label={t("Sign-in")} htmlFor="c-auth">
        <select id="c-auth" className="select" value={kind} onChange={(e) => set(["auth"], { type: e.target.value })}>
          {AUTH_KINDS.map((k) => (
            <option key={k} value={k}>{KINDS[k]()}</option>
          ))}
        </select>
      </Field>
      {(kind === "header" || kind === "signed") && <Text id="c-auth-header" label={t("Header")} value={a("header")} onChange={(v) => set(["auth", "header"], v)} mono />}
      {kind === "header" && <Text id="c-auth-prefix" label={t("Before the secret")} value={a("prefix")} onChange={(v) => set(["auth", "prefix"], v)} mono />}
      {kind === "basic" && <Text id="c-auth-user" label={t("User name")} value={a("username")} onChange={(v) => set(["auth", "username"], v)} />}
      {["header", "basic", "bearer", "signed"].includes(kind) && (
        <Text id="c-auth-secret" label={t("Secret used")} value={a("secret")} onChange={(v) => set(["auth", "secret"], v)} mono hint={t("The name of one of the secrets below.")} />
      )}
      {kind === "signed" && (
        <>
          <Text id="c-auth-ts" label={t("Timestamp header")} value={a("timestamp_header")} onChange={(v) => set(["auth", "timestamp_header"], v)} mono />
          <Field label={t("Written as")} htmlFor="c-auth-enc">
            <select id="c-auth-enc" className="select" value={a("encoding") ?? "hex"} onChange={(e) => set(["auth", "encoding"], e.target.value)}>
              <option value="hex">hex</option>
              <option value="base64">base64</option>
            </select>
          </Field>
        </>
      )}
      {kind === "oauth" && (
        <>
          <Field label={t("Whose account")} htmlFor="c-auth-owner">
            <select id="c-auth-owner" className="select" value={a("owner") ?? "workspace"} onChange={(e) => set(["auth", "owner"], e.target.value)}>
              <option value="workspace">{t("The workspace's, connected once by an administrator")}</option>
              <option value="person">{t("Each person's own")}</option>
            </select>
          </Field>
          {(["authorize_url", "token_url", "revoke_url", "client_id", "account_at"] as const).map((k) => (
            <Text key={k} id={`c-prov-${k}`} label={k} value={at(d, "auth", "provider", k)} onChange={(v) => set(["auth", "provider", k], v)} mono />
          ))}
          <Text id="c-prov-client_secret" label={t("Client secret used")} value={at(d, "auth", "provider", "client_secret")} onChange={(v) => set(["auth", "provider", "client_secret"], v)} mono hint={t("The name of one of the secrets below.")} />
          <List id="c-prov-scopes" label={t("Scopes")} value={at(d, "auth", "provider", "scopes")} onChange={(v) => set(["auth", "provider", "scopes"], v)} />
        </>
      )}
    </div>
  );
}

function Operation({ name, op, onChange, onRemove }: { name: string; op: Desc; onChange: (o: Desc) => void; onRemove: () => void }) {
  const id = `op-${name}`;
  const s = (k: string, v: unknown) => onChange(put(op, [k], v));
  const fixture = op.fixture === undefined ? "" : JSON.stringify(op.fixture, null, 2);
  const [fixtureText, setFixture] = useState(fixture);
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  return (
    <fieldset className="card stack" aria-label={t("Operation {name}", { name })}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong className="mono">{isolate(name)}</strong>
        <Button size="sm" variant="ghost" onClick={onRemove}>{t("Remove operation")}</Button>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label={t("Method")} htmlFor={`${id}-method`}>
          <select id={`${id}-method`} className="select" value={op.method ?? ""} onChange={(e) => s("method", e.target.value)}>
            <option value="">{t("Automatic")}</option>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <div style={{ flex: "1 1 240px" }}>
          <Text id={`${id}-path`} label={t("Path")} value={op.path} onChange={(v) => s("path", v)} mono hint={t("Starts with /. Values printed in it are encoded.")} />
        </div>
      </div>
      <List id={`${id}-inputs`} label={t("Inputs")} value={op.inputs} onChange={(v) => s("inputs", v)} hint={t("One per line. Empty: any input.")} />
      <Field label={t("Body")} htmlFor={`${id}-body`} hint={t("A template giving JSON.")}>
        <textarea id={`${id}-body`} className="textarea mono" rows={3} value={op.body ?? ""} onChange={(e) => s("body", e.target.value)} />
      </Field>
      <Pairs id={`${id}-result`} label={t("Result")} value={op.result} onChange={(m) => s("result", m)} keyLabel={t("name")} valueLabel={t("JSON pointer")} mono />
      <Text id={`${id}-err`} label={t("Error at")} value={op.error_at} onChange={(v) => s("error_at", v)} mono />
      <Text id={`${id}-idem`} label={t("Idempotency header")} value={op.idempotency_header} onChange={(v) => s("idempotency_header", v)} mono />
      <Field label={t("Fixture")} htmlFor={`${id}-fixture`} hint={t("What a test connection answers: {status, body}.")} error={fixtureError ?? undefined}>
        <textarea
          id={`${id}-fixture`}
          className="textarea mono"
          rows={3}
          value={fixtureText}
          onChange={(e) => {
            setFixture(e.target.value);
            if (!e.target.value.trim()) return setFixtureError(null), s("fixture", undefined);
            const r = parseDescription(e.target.value);
            setFixtureError(r.ok ? null : r.error);
            if (r.ok) s("fixture", r.value);
          }}
        />
      </Field>
    </fieldset>
  );
}

function Operations({ d, set }: { d: Desc; set: Set }) {
  const [name, setName] = useState("");
  const ops: Desc = d.operations ?? {};
  const bad = name !== "" && (!NAME.test(name) || name in ops);
  return (
    <div className="stack">
      {Object.entries(ops).map(([n, op]) => (
        <Operation key={n} name={n} op={op} onChange={(o) => set(["operations", n], o)} onRemove={() => set(["operations"], Object.fromEntries(Object.entries(ops).filter(([k]) => k !== n)))} />
      ))}
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={t("New operation")} htmlFor="op-new" error={bad ? t("Lower case letters, digits and _, not used yet") : undefined}>
          <input id="op-new" className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button disabled={!name || bad} onClick={() => { set(["operations"], { ...ops, [name]: {} }); setName(""); }}>{t("Add operation")}</Button>
      </div>
    </div>
  );
}

function Mapping({ id, map, onChange }: { id: string; map: Desc | undefined; onChange: (m: Desc | undefined) => void }) {
  const m = map ?? {};
  const s = (k: string, v: unknown) => onChange(put(m, [k], v));
  return (
    <div className="stack">
      <Text id={`${id}-entity`} label={t("Record type")} value={m.entity} onChange={(v) => s("entity", v)} />
      <Text id={`${id}-items`} label={t("Items at")} value={m.items_at} onChange={(v) => s("items_at", v)} mono hint={t("A JSON pointer to a list; empty: the payload is one item.")} />
      <Pairs id={`${id}-by`} label={t("Find the record by")} value={m.by} onChange={(v) => s("by", v)} keyLabel={t("field")} valueLabel={t("expression")} mono />
      <Pairs id={`${id}-set`} label={t("Set")} value={m.set} onChange={(v) => s("set", v)} keyLabel={t("field")} valueLabel={t("expression")} mono />
      <Pairs id={`${id}-create`} label={t("Set only when made")} value={m.create} onChange={(v) => s("create", v)} keyLabel={t("field")} valueLabel={t("expression")} mono />
      <label className="check-field">
        <input type="checkbox" checked={!!m.update_only} onChange={(e) => s("update_only", e.target.checked)} />
        {t("Change records that exist; never make one")}
      </label>
    </div>
  );
}

function Inbound({ d, set }: { d: Desc; set: Set }) {
  const on = !!d.inbound;
  const v = (k: string) => at(d, "inbound", "verify", k);
  const kind = v("type") ?? "token";
  return (
    <div className="stack">
      <label className="check-field">
        <input id="c-in-on" type="checkbox" checked={on} onChange={(e) => set(["inbound"], e.target.checked ? { verify: { type: "token", header: "", secret: "" } } : undefined)} />
        {t("This connection is called from outside")}
      </label>
      {on && (
        <>
          <Field label={t("The caller proves itself by")} htmlFor="c-in-kind">
            <select id="c-in-kind" className="select" value={kind} onChange={(e) => set(["inbound", "verify"], e.target.value === "token" ? { type: "token" } : { type: "signature", timestamp_header: "" })}>
              <option value="token">{t("A secret both sides hold")}</option>
              <option value="signature">{t("A signature over the body")}</option>
            </select>
          </Field>
          <Text id="c-in-header" label={t("Header")} value={v("header")} onChange={(x) => set(["inbound", "verify", "header"], x)} mono />
          <Text id="c-in-secret" label={t("Secret used")} value={v("secret")} onChange={(x) => set(["inbound", "verify", "secret"], x)} mono hint={t("The name of one of the secrets below.")} />
          {kind === "signature" && (
            <>
              <Text id="c-in-ts" label={t("Timestamp header")} value={v("timestamp_header")} onChange={(x) => set(["inbound", "verify", "timestamp_header"], x)} mono />
              <Text id="c-in-prefix" label={t("Before the signature")} value={v("prefix")} onChange={(x) => set(["inbound", "verify", "prefix"], x)} mono />
              <Text id="c-in-window" label={t("Seconds either side of now")} type="number" value={v("window_secs")} onChange={(x) => set(["inbound", "verify", "window_secs"], number(x))} />
            </>
          )}
          <Text id="c-in-delivery" label={t("Delivery id header")} value={at(d, "inbound", "delivery_header")} onChange={(x) => set(["inbound", "delivery_header"], x)} mono />
          <Text id="c-in-delivery-at" label={t("Delivery id at")} value={at(d, "inbound", "delivery_at")} onChange={(x) => set(["inbound", "delivery_at"], x)} mono hint={t("A JSON pointer, when the id is in the body.")} />
          <Text id="c-in-handler" label={t("Handled by an app")} value={at(d, "inbound", "handler")} onChange={(x) => set(["inbound", "handler"], x)} hint={t("Instead of the mapping below.")} />
          <h4 className="field-label">{t("What becomes of a payload")}</h4>
          <Mapping id="c-in-map" map={at(d, "inbound", "map")} onChange={(m) => set(["inbound", "map"], m)} />
        </>
      )}
    </div>
  );
}

function Pulls({ d, set }: { d: Desc; set: Set }) {
  const pulls: Desc[] = d.pulls ?? [];
  const change = (i: number, p: Desc) => set(["pulls"], pulls.map((x, j) => (j === i ? p : x)));
  return (
    <div className="stack">
      {pulls.map((p, i) => {
        const id = `pull-${i}`;
        const s = (k: string, v: unknown) => change(i, put(p, [k], v));
        return (
          <fieldset className="card stack" key={i} aria-label={t("Pull {n}", { n: i + 1 })}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{isolate(p.name || t("Pull {n}", { n: i + 1 }))}</strong>
              <Button size="sm" variant="ghost" onClick={() => set(["pulls"], pulls.filter((_, j) => j !== i))}>{t("Remove pull")}</Button>
            </div>
            <Text id={`${id}-name`} label={t("Name")} value={p.name} onChange={(v) => s("name", v)} mono />
            <Field label={t("Operation")} htmlFor={`${id}-op`} hint={t("One that only reads.")}>
              <select id={`${id}-op`} className="select" value={p.operation ?? ""} onChange={(e) => s("operation", e.target.value)}>
                <option value="">{t("Choose")}</option>
                {Object.keys(d.operations ?? {}).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Text id={`${id}-every`} label={t("Every (minutes)")} type="number" value={p.every_minutes} onChange={(v) => s("every_minutes", number(v))} />
            <Text id={`${id}-items`} label={t("Items at")} value={p.items_at} onChange={(v) => s("items_at", v)} mono hint={t("A JSON pointer to a list in each answer.")} />
            <Field label={t("Cursor")} htmlFor={`${id}-cursor`}>
              <select id={`${id}-cursor`} className="select" value={p.cursor ?? "token"} onChange={(e) => s("cursor", e.target.value)}>
                <option value="token">{t("A token the answer gives")}</option>
                <option value="time">{t("The moment the last run began")}</option>
              </select>
            </Field>
            <Text id={`${id}-next`} label={t("Next token at")} value={p.next_at} onChange={(v) => s("next_at", v)} mono />
            <Text id={`${id}-cin`} label={t("Cursor given as input")} value={p.cursor_input} onChange={(v) => s("cursor_input", v)} mono />
            <Text id={`${id}-pages`} label={t("Most pages a run")} type="number" value={p.max_pages} onChange={(v) => s("max_pages", number(v))} />
            <h4 className="field-label">{t("What each item becomes")}</h4>
            <Mapping id={`${id}-map`} map={p.map} onChange={(m) => s("map", m)} />
          </fieldset>
        );
      })}
      <div>
        <Button onClick={() => set(["pulls"], [...pulls, { name: "", operation: "", every_minutes: 15, items_at: "" }])}>{t("Add a pull")}</Button>
      </div>
    </div>
  );
}

/** Secrets by name: set or not, never shown; a new value is typed into a password box nobody holds. */
function Secrets({ names, set: setNames, extra, addName }: { names: string[]; set: string[]; extra: string[]; addName: (n: string) => void }) {
  const [name, setName] = useState("");
  const bad = name !== "" && (!NAME.test(name) || names.includes(name));
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="field-label">{t("Secrets")}</legend>
      <p className="muted">{t("Sealed when saved and never shown again. Saving new values replaces every secret, so enter all of them.")}</p>
      {names.length === 0 && <p className="muted">{t("No secret is named yet.")}</p>}
      {names.map((n) => (
        <Field key={n} label={<span className="mono">{isolate(n)}</span>} htmlFor={`secret-${n}`} hint={setNames.includes(n) ? t("Set. Type to replace it.") : t("Not set.")}>
          <input id={`secret-${n}`} name={`secret:${n}`} type="password" className="input" autoComplete="new-password" spellCheck={false} defaultValue="" />
        </Field>
      ))}
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={t("Another secret")} htmlFor="secret-new" error={bad ? t("Lower case letters, digits and _, not used yet") : undefined}>
          <input id="secret-new" className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button disabled={!name || bad} onClick={() => { addName(name); setName(""); }}>{t("Add")}</Button>
      </div>
      {extra.length > 0 && <p className="faint">{t("Added here: {names}", { names: extra.join(", ") })}</p>}
    </fieldset>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="card stack" aria-label={title}>
    <h3 className="h3">{title}</h3>
    {children}
  </section>
);

export function ConnectionEditor({ row, onClose, onSaved }: { row: ConnectionRow | null; onClose: () => void; onSaved: (id: string | null) => void }) {
  const fresh = !row || row.id === null;
  const [name, setName] = useState(row?.name ?? "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [enabled, setEnabled] = useState(row?.enabled ?? false);
  const [d, setD] = useState<Desc>(() => row?.description ?? { base: "https://", auth: { type: "none" } });
  const [view, setView] = useState<"form" | "json">("form");
  const [raw, setRaw] = useState("");
  const [rev, setRev] = useState(0);
  const [extra, setExtra] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set: Set = (path, v) => setD((cur) => put(cur, path, v));
  const setNow = row?.secrets ?? [];
  const referenced = secretNames(d);
  const names = [...new globalThis.Set([...referenced, ...setNow, ...extra])];

  const show = (next: "form" | "json") => {
    if (next === "json") setRaw(JSON.stringify(tidy(d), null, 2));
    else {
      const r = parseDescription(raw);
      if (!r.ok) return setProblems([r.error]);
      setD(r.value);
      setRev((n) => n + 1);
    }
    setProblems([]);
    setView(next);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    let desc = d;
    if (view === "json") {
      const r = parseDescription(raw);
      if (!r.ok) return setProblems([r.error]);
      desc = r.value;
    }
    const fault = checkConnection({ name, label });
    const typed: Record<string, string> = {};
    for (const n of names) typed[n] = (form.elements.namedItem(`secret:${n}`) as HTMLInputElement | null)?.value ?? "";
    const secrets = secretsToSend(names, typed);
    if (secrets.error) fault.push(secrets.error);
    setProblems(fault);
    setRefused(null);
    if (fault.length) return;
    setBusy(true);
    try {
      const body = connectionBody({ name, label, enabled, description: desc }, secrets.send);
      let id = row?.id ?? null;
      if (id) await api.put(`/api/admin/connections/${id}`, body);
      else id = (await api.post<{ id: string }>("/api/admin/connections", body)).id;
      onSaved(id);
    } catch (err) {
      // The server's plain refusal, on the description or on a name, as it says it.
      setRefused(err instanceof ApiError && err.fields?.length ? err.fields.map((f) => `${f.field}: ${f.message}`).join(" · ") : errorMessage(err));
    } finally {
      for (const el of Array.from(form.elements)) if (el instanceof HTMLInputElement && el.type === "password") el.value = "";
      setBusy(false);
    }
  };

  const v = (k: string) => at(d, k);
  return (
    <form className="stack" onSubmit={submit} aria-label={row ? t("Edit {name}", { name: row.label }) : t("New connection")}>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Button onClick={onClose}>{t("Back to the list")}</Button>
        <div role="group" aria-label={t("View")} className="row">
          <Button variant={view === "form" ? "primary" : "default"} aria-pressed={view === "form"} onClick={() => show("form")}>{t("Form")}</Button>
          <Button variant={view === "json" ? "primary" : "default"} aria-pressed={view === "json"} onClick={() => show("json")}>{t("JSON")}</Button>
        </div>
      </div>
      {problems.length > 0 && (
        <Alert tone="error">
          <ul>{problems.map((p, i) => <li key={i}>{isolate(p)}</li>)}</ul>
        </Alert>
      )}
      {refused && <Alert tone="error">{isolate(refused)}</Alert>}
      <Section title={t("Connection")}>
        <Field label={t("Name")} htmlFor="c-name" required hint={t("Lower case letters, digits and _. Apps and buttons call it by this name.")}>
          <input id="c-name" className="input mono" value={name} onChange={(e) => setName(e.target.value)} disabled={!fresh && !!row?.source?.startsWith("package")} />
        </Field>
        <Field label={t("Label")} htmlFor="c-label" required>
          <input id="c-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <label className="check-field">
          <input id="c-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t("On")}
        </label>
        {row?.source && <p className="muted">{isolate(row.source.replace(/^package:/, t("From the package ")).replace(/^pack:/, t("From the pack ")))}</p>}
      </Section>
      {view === "json" ? (
        <Section title={t("Description")}>
          <Field label={t("The description, in JSON")} htmlFor="c-raw" hint={t("The server checks it when you save and says what is wrong.")}>
            <textarea id="c-raw" className="textarea mono" rows={24} spellCheck={false} value={raw} onChange={(e) => setRaw(e.target.value)} />
          </Field>
        </Section>
      ) : (
        <div className="stack" key={rev}>
          <Section title={t("Where it calls")}>
            <Text id="c-base" label={t("Base address")} value={v("base")} onChange={(x) => set(["base"], x)} mono hint={t("https only, to this host and the hosts allowed below.")} />
            <Auth d={d} set={set} />
            <Pairs id="c-headers" label={t("Headers sent with every call")} value={v("headers")} onChange={(m) => set(["headers"], m)} keyLabel={t("header")} valueLabel={t("value")} />
            <List id="c-hosts" label={t("Other hosts it may reach")} value={v("allowed_hosts")} onChange={(x) => set(["allowed_hosts"], x)} hint={t("One per line.")} />
            <div className="row" style={{ flexWrap: "wrap" }}>
              <Text id="c-timeout" label={t("Time limit (ms)")} type="number" value={v("timeout_ms")} onChange={(x) => set(["timeout_ms"], number(x))} />
              <Text id="c-bytes" label={t("Answer size limit (bytes)")} type="number" value={v("max_bytes")} onChange={(x) => set(["max_bytes"], number(x))} />
            </div>
            <label className="check-field">
              <input type="checkbox" checked={!!v("test")} onChange={(e) => set(["test"], e.target.checked || undefined)} />
              {t("A test connection: answer from each operation's fixture and call nobody")}
            </label>
          </Section>
          <Section title={t("Who may use it")}>
            <p className="muted">{t("Administrators and configuration always may.")}</p>
            <List id="c-roles" label={t("Roles")} value={v("roles")} onChange={(x) => set(["roles"], x)} hint={t("One per line.")} />
            <List id="c-apps" label={t("Apps")} value={v("apps")} onChange={(x) => set(["apps"], x)} hint={t("One per line.")} />
          </Section>
          <Section title={t("Operations")}>
            <Operations d={d} set={set} />
          </Section>
          <Section title={t("Called from outside")}>
            <Inbound d={d} set={set} />
          </Section>
          <Section title={t("Pulls")}>
            <Pulls d={d} set={set} />
          </Section>
        </div>
      )}
      <section className="card stack" aria-label={t("Secrets")}>
        <Secrets names={names} set={setNow} extra={extra} addName={(n) => setExtra((x) => [...x, n])} />
      </section>
      <div className="row">
        <Button type="submit" variant="primary" loading={busy}>{t("Save")}</Button>
        <Button onClick={onClose}>{t("Cancel")}</Button>
      </div>
      {fresh && <p className="muted">{t("Turn it on when you have tried an operation.")}</p>}
    </form>
  );
}
