// The description of a connection, edited two ways over one value: a structured form (base address, sign-in, headers, hosts,
// limits, who may use it, operations, what it takes in, what it pulls) and the raw JSON, whose faults are the server's to say.
// Secrets are write-only: password boxes nobody holds in state (read from the form when it is sent, emptied after), never
// read back. The logic is lib/connectionDraft.ts.

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { t, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage } from "../lib/api";
import {
  at, AUTH_KINDS, checkConnection, connectionBody, entries, lines, makePick, METHODS, NAME, number, parseDescription, PICK_KINDS, put, readPick, secretNames, secretsPatch, signatureNeedsDelivery, typedSecrets, undrawn, type PickKind, type ResultPick, type AuthKind, type ConnectionRow, type Desc,
} from "../lib/connectionDraft";
import { Alert, Button, confirmDialog, Field, toast } from "../ui/kit";

const KINDS: Record<AuthKind, () => string> = {
  none: () => t("No sign-in"),
  header: () => t("A header holding a secret"),
  basic: () => t("User name and password"),
  bearer: () => t("Bearer token"),
  signed: () => t("Signed request"),
  oauth: () => t("Signing in to an account"),
  session: () => t("A session: log in, then refresh"),
};

const KEPT = () => t("Kept as it is: this has no control here. Edit it in the JSON view.");
const asText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** Rows of name and value, kept as a map; a row with no name is not yet part of it. A value that is not text (a pick, a file part)
 * is shown as JSON and kept exactly as it is. */
function Pairs({ id, label, value, onChange, keyLabel, valueLabel, mono }: { id: string; label: string; value: unknown; onChange: (m: Record<string, unknown>) => void; keyLabel: string; valueLabel: string; mono?: boolean }) {
  const [rows, setRows] = useState<[string, unknown][]>(() => entries(value));
  const emit = (next: [string, unknown][]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])));
  };
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="field-label">{label}</legend>
      {rows.map(([k, v], i) => (
        <div className="row" key={i} style={{ flexWrap: "wrap" }}>
          <input id={`${id}-k${i}`} className="input mono" aria-label={`${label}: ${keyLabel} ${i + 1}`} value={k} onChange={(e) => emit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} style={{ flex: "1 1 140px" }} />
          <input className={`input${mono || typeof v !== "string" ? " mono" : ""}`} aria-label={`${label}: ${valueLabel} ${i + 1}`} title={typeof v === "string" ? undefined : KEPT()} readOnly={typeof v !== "string"} value={asText(v)} onChange={(e) => emit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} style={{ flex: "2 1 200px" }} />
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

const PICK_NAMES: Record<PickKind, () => string> = { at: () => t("Pointer into the answer"), header: () => t("A header of the answer"), link: () => t("A Link relation"), expr: () => t("An expression") };

/** The result of an operation: each name picked from the answer (BD-46): a pointer, a header, a Link's rel or an expression, each
 * perhaps required. A file pick has no control here and is kept as it is. */
function PickRows({ id, label, value, onChange }: { id: string; label: string; value: unknown; onChange: (m: Record<string, unknown>) => void }) {
  const [rows, setRows] = useState<[string, unknown][]>(() => entries(value));
  const emit = (next: [string, unknown][]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])));
  };
  const edit = (i: number, patch: Partial<ResultPick>) =>
    emit(rows.map((r, j) => (j === i ? [r[0], makePick({ ...(readPick(r[1]) ?? { kind: "at", value: "", required: false }), ...patch })] : r)));
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="field-label">{label}</legend>
      {rows.map(([k, v], i) => {
        const p = readPick(v);
        return (
          <div className="row" key={i} style={{ flexWrap: "wrap", alignItems: "center" }}>
            <input id={`${id}-k${i}`} className="input mono" aria-label={`${label}: ${t("name")} ${i + 1}`} value={k} onChange={(e) => emit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} style={{ flex: "1 1 120px" }} />
            {p ? (
              <>
                <select className="select" aria-label={`${label}: ${t("taken from")} ${i + 1}`} value={p.kind} onChange={(e) => edit(i, { kind: e.target.value as PickKind })}>
                  {PICK_KINDS.map((x) => <option key={x} value={x}>{PICK_NAMES[x]()}</option>)}
                </select>
                <input className="input mono" aria-label={`${label}: ${t("value")} ${i + 1}`} value={p.value} onChange={(e) => edit(i, { value: e.target.value })} style={{ flex: "2 1 160px" }} />
                <label className="check-field"><input type="checkbox" checked={p.required} onChange={(e) => edit(i, { required: e.target.checked })} />{t("Required")}</label>
              </>
            ) : (
              <input className="input mono" readOnly aria-label={`${label}: ${t("value")} ${i + 1}`} title={KEPT()} value={asText(v)} style={{ flex: "3 1 260px" }} />
            )}
            <Button size="sm" variant="ghost" aria-label={t("Remove {label} {n}", { label, n: i + 1 })} onClick={() => emit(rows.filter((_, j) => j !== i))}>{t("Remove")}</Button>
          </div>
        );
      })}
      <div><Button size="sm" onClick={() => emit([...rows, ["", ""]])}>{t("Add a row")}</Button></div>
    </fieldset>
  );
}

const Text = ({ id, label, value, onChange, hint, mono, type }: { id: string; label: string; value: unknown; onChange: (v: string) => void; hint?: ReactNode; mono?: boolean; type?: string }) =>
  value && typeof value === "object" ? (
    <Field label={label} htmlFor={id} hint={KEPT()}>
      <input id={id} className="input mono" readOnly value={JSON.stringify(value)} />
    </Field>
  ) : (
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
      {kind === "session" && (
        <>
          <p className="faint">{t("The service gives a token for a login, and another to refresh it. Describe the two operations under Operations (they are never called as operations); their bodies may use secret.<name>.")}</p>
          {(["login", "refresh"] as const).map((k) => (
            <Field key={k} label={k === "login" ? t("Login operation") : t("Refresh operation")} htmlFor={`c-session-${k}`}>
              <select id={`c-session-${k}`} className="select" value={a(k) ?? ""} onChange={(e) => set(["auth", k], e.target.value)}>
                <option value="">{t("Choose")}</option>
                {Object.keys(d.operations ?? {}).map((o) => <option key={o} value={o}>{o}</option>)}
                {a(k) && !(a(k) in (d.operations ?? {})) && <option value={a(k)}>{a(k)}</option>}
              </select>
            </Field>
          ))}
          <Text id="c-session-token" label={t("Token at")} value={a("token_at")} onChange={(v) => set(["auth", "token_at"], v)} mono hint={t("A JSON pointer into the login answer.")} />
          <Text id="c-session-refresh-at" label={t("Refresh token at")} value={a("refresh_at")} onChange={(v) => set(["auth", "refresh_at"], v)} mono />
          <Text id="c-session-expires" label={t("Expiry at")} value={a("expires_at")} onChange={(v) => set(["auth", "expires_at"], v)} mono />
          <Text id="c-session-header" label={t("Header it is sent in")} value={a("header")} onChange={(v) => set(["auth", "header"], v)} mono />
          <Text id="c-session-prefix" label={t("Before the token")} value={a("prefix")} onChange={(v) => set(["auth", "prefix"], v)} mono />
        </>
      )}
      {kind === "oauth" && (
        <>
          <label className="check-field">
            <input type="checkbox" checked={!!at(d, "auth", "provider", "dpop")} onChange={(e) => set(["auth", "provider", "dpop"], e.target.checked || undefined)} />
            {t("Bind tokens to this connection's own key (DPoP)")}
          </label>
          <Text id="c-prov-registration_url" label="registration_url" value={at(d, "auth", "provider", "registration_url")} onChange={(v) => set(["auth", "provider", "registration_url"], v)} mono hint={t("Without a client id, the platform registers its client here once.")} />
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
      {op.body && typeof op.body === "object" ? (
        <Field label={t("Body")} htmlFor={`${id}-body`} hint={t("The file sent as the whole body. {kept}", { kept: KEPT() })}>
          <input id={`${id}-body`} className="input mono" readOnly value={JSON.stringify(op.body)} />
        </Field>
      ) : (
        <Field label={t("Body")} htmlFor={`${id}-body`} hint={t("A template giving JSON.")}>
          <textarea id={`${id}-body`} className="textarea mono" rows={3} value={op.body ?? ""} onChange={(e) => s("body", e.target.value)} />
        </Field>
      )}
      <Pairs id={`${id}-form`} label={t("Form parts")} value={op.form} onChange={(m) => s("form", m)} keyLabel={t("part")} valueLabel={t("template")} mono />
      <PickRows id={`${id}-result`} label={t("Result")} value={op.result} onChange={(m) => s("result", m)} />
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

/** What is wrong with a name being typed, or nothing: the rule is a hint until an entry breaks it (never red before anything is typed). */
const nameProblem = (name: string, taken: boolean): string | undefined =>
  name === "" ? undefined : !NAME.test(name) ? t("A name has lower case letters, digits and _, and starts with a letter") : taken ? t("Already used: choose another name") : undefined;
const NAME_HINT = () => t("Lower case letters, digits and _, not used yet");

function Operations({ d, set }: { d: Desc; set: Set }) {
  const [name, setName] = useState("");
  const ops: Desc = d.operations ?? {};
  const bad = nameProblem(name, name in ops);
  return (
    <div className="stack">
      {Object.entries(ops).map(([n, op]) => (
        <Operation key={n} name={n} op={op} onChange={(o) => set(["operations", n], o)} onRemove={() => set(["operations"], Object.fromEntries(Object.entries(ops).filter(([k]) => k !== n)))} />
      ))}
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={t("New operation")} htmlFor="op-new" hint={NAME_HINT()} error={bad}>
          <input id="op-new" className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button disabled={!name || !!bad} onClick={() => { set(["operations"], { ...ops, [name]: {} }); setName(""); }}>{t("Add operation")}</Button>
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
      <label className="check-field">
        <input type="checkbox" checked={!!m.outside} onChange={(e) => s("outside", e.target.checked || undefined)} />
        {t("Mark what it writes as fetched from outside, so a pulled record does not set going what a new one would")}
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
              <Text id="c-in-ts" label={t("Timestamp header")} value={v("timestamp_header")} onChange={(x) => set(["inbound", "verify", "timestamp_header"], x)} mono hint={t("May be left empty when the caller's delivery id is named below.")} />
          {signatureNeedsDelivery(d) && <Alert tone="warning">{t("A signature without a timestamp is saved only with a delivery id header or pointer: name one below.")}</Alert>}
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
            <Text id={`${id}-items`} label={t("Items at")} value={p.items_at} onChange={(v) => change(i, { ...p, items_at: v })} mono hint={t("A JSON pointer to a list in each answer; empty: the whole answer is the list.")} />
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
/** The description's own `meta` (BD-50): an object the platform keeps and gives back without reading it, 16 KB at most. */
function Meta({ d, set }: { d: Desc; set: Set }) {
  const [text, setText] = useState(() => (d.meta === undefined ? "" : JSON.stringify(d.meta, null, 2)));
  const [error, setError] = useState<string | null>(null);
  return (
    <Field label={t("Notes kept with the description (meta), in JSON")} htmlFor="c-meta" hint={t("An object, 16 KB at most. The platform keeps it and reads none of it.")} error={error ?? undefined}>
      <textarea
        id="c-meta"
        className="textarea mono"
        rows={4}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) return setError(null), set(["meta"], undefined);
          const r = parseDescription(e.target.value);
          setError(r.ok ? null : r.error);
          if (r.ok) set(["meta"], r.value);
        }}
      />
    </Field>
  );
}

/** Secrets of a new connection: password boxes nobody holds in state, sent with the first save. */
/** A saved connection's secrets, by name (`PATCH …/secrets`): which are set (never their values), set or replace one, remove one: each its
 * own call, the rest kept. The password boxes are uncontrolled and emptied after each call, so no value is held in state. */
export function SecretsPanel({ row, referenced }: { row: ConnectionRow; referenced: string[] }) {
  const [held, setHeld] = useState<string[]>(row.secrets);
  const [added, setAdded] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxes = useRef<Record<string, HTMLInputElement | null>>({});
  const names = [...new globalThis.Set([...held, ...referenced, ...added])];
  const bad = nameProblem(name, names.includes(name));
  const call = async (key: string, body: ReturnType<typeof secretsPatch>, done: string) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const r = await api.patch<{ secrets: string[] }>(`/api/admin/connections/${row.id}/secrets`, body);
      setHeld(r.secrets);
      setAdded((a) => a.filter((n) => !r.secrets.includes(n) && body.remove.indexOf(n) < 0));
      toast(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      for (const b of Object.values(boxes.current)) if (b) b.value = "";
      setBusy(null);
    }
  };
  const set = (n: string) => {
    const v = boxes.current[n]?.value ?? "";
    if (!v) return setError(t("Type a value for {name} first.", { name: n }));
    void call(`set:${n}`, secretsPatch({ [n]: v }), t("{name} is set", { name: n }));
  };
  const remove = async (n: string) => {
    if (await confirmDialog({ title: t("Remove the secret {name}?", { name: n }), message: t("Calls that use it will fail until it is set again."), confirmLabel: t("Remove"), danger: true })) void call(`remove:${n}`, secretsPatch({}, [n]), t("{name} is removed", { name: n }));
  };
  return (
    <section className="card stack" aria-label={t("Secrets")}>
      <h3 className="h3">{t("Secrets")}</h3>
      <p className="muted">{t("Sealed when saved and never shown again. Each is set, replaced or removed on its own; the others stay.")}</p>
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      {names.length === 0 && <p className="muted">{t("No secret is named yet.")}</p>}
      {names.map((n) => (
        <div key={n} className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label={<span className="mono">{isolate(n)}</span>} htmlFor={`secret-${n}`} hint={held.includes(n) ? t("Set. Type to replace it.") : t("Not set.")}>
            <input id={`secret-${n}`} ref={(el) => { boxes.current[n] = el; }} type="password" className="input" autoComplete="new-password" spellCheck={false} defaultValue="" />
          </Field>
          <Button size="sm" variant="primary" loading={busy === `set:${n}`} disabled={!!busy} aria-label={held.includes(n) ? t("Replace {name}", { name: n }) : t("Set {name}", { name: n })} onClick={() => set(n)}>{held.includes(n) ? t("Replace") : t("Set")}</Button>
          {held.includes(n) && <Button size="sm" variant="danger" loading={busy === `remove:${n}`} disabled={!!busy} aria-label={t("Remove {name}", { name: n })} onClick={() => void remove(n)}>{t("Remove")}</Button>}
        </div>
      ))}
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={t("Another secret")} htmlFor="secret-new" hint={NAME_HINT()} error={bad}>
          <input id="secret-new" className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button disabled={!name || !!bad} onClick={() => { setAdded((a) => [...a, name]); setName(""); }}>{t("Add")}</Button>
      </div>
    </section>
  );
}

function Secrets({ names, set: setNames, extra, addName }: { names: string[]; set: string[]; extra: string[]; addName: (n: string) => void }) {
  const [name, setName] = useState("");
  const bad = nameProblem(name, names.includes(name));
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="field-label">{t("Secrets")}</legend>
      <p className="muted">{t("Sealed when saved and never shown again.")}</p>
      {names.length === 0 && <p className="muted">{t("No secret is named yet.")}</p>}
      {names.map((n) => (
        <Field key={n} label={<span className="mono">{isolate(n)}</span>} htmlFor={`secret-${n}`} hint={setNames.includes(n) ? t("Set. Type to replace it.") : t("Not set.")}>
          <input id={`secret-${n}`} name={`secret:${n}`} type="password" className="input" autoComplete="new-password" spellCheck={false} defaultValue="" />
        </Field>
      ))}
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={t("Another secret")} htmlFor="secret-new" hint={NAME_HINT()} error={bad}>
          <input id="secret-new" className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button disabled={!name || !!bad} onClick={() => { addName(name); setName(""); }}>{t("Add")}</Button>
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

/** After a package's description was taken up: what is still to do before it is turned on. */
function NextSteps({ row, referenced }: { row: ConnectionRow; referenced: string[] }) {
  const missing = referenced.filter((n) => !row.secrets.includes(n));
  const kind = at(row.description, "auth", "type");
  return (
    <section className="card stack" aria-label={t("Next steps")}>
      <h3 className="h3">{t("Taken up. Next steps")}</h3>
      <ol className="stack">
        {missing.length > 0 && <li>{t("Set the secrets it names, below: {names}", { names: missing.join(", ") })}</li>}
        {kind === "oauth" && <li>{t("Back in the list, press Connect to sign in to the account.")}</li>}
        {kind === "session" && <li>{t("Back in the list, press Sign in again to log in.")}</li>}
        <li>{row.enabled ? t("It is on.") : t("Turn it on here (On, then Save) when you have tried an operation.")}</li>
      </ol>
    </section>
  );
}

export function ConnectionEditor({ row, onClose, onSaved, tookUp }: { row: ConnectionRow | null; onClose: () => void; onSaved: (id: string | null) => void; tookUp?: boolean }) {
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set: Set = (path, v) => setD((cur) => put(cur, path, v));
  const setNow = row?.secrets ?? [];
  const referenced = secretNames(d);
  const more = undrawn(d);
  const names = [...new globalThis.Set([...referenced, ...setNow, ...extra])];

  const show = (next: "form" | "json") => {
    if (next === "json") setRaw(JSON.stringify(d, null, 2));
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
    if (fresh) for (const n of names) typed[n] = (form.elements.namedItem(`secret:${n}`) as HTMLInputElement | null)?.value ?? "";
    const secrets = { send: fresh ? typedSecrets(typed) : undefined };
    setProblems(fault);
    setRefused(null);
    setFieldErrors({});
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
      setRefused(err instanceof ApiError && err.fields?.length ? null : errorMessage(err));
      setFieldErrors(err instanceof ApiError ? Object.fromEntries(err.fields.map((f) => [f.field, f.message])) : {});
    } finally {
      for (const el of Array.from(form.elements)) if (el instanceof HTMLInputElement && el.type === "password") el.value = "";
      setBusy(false);
    }
  };

  const v = (k: string) => at(d, k);
  return (
    <div className="stack">
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
      {Object.entries(fieldErrors).filter(([f]) => f !== "name" && f !== "label").map(([f, m]) => <Alert key={f} tone="error">{f === "description" ? t("The description: {why}", { why: m }) : `${f}: ${m}`}</Alert>)}
      {tookUp && row?.id && <NextSteps row={row} referenced={referenced} />}
      <Section title={t("Connection")}>
        <Field label={t("Name")} htmlFor="c-name" required error={fieldErrors.name} hint={t("Lower case letters, digits and _. Apps and buttons call it by this name.")}>
          <input id="c-name" className="input mono" value={name} onChange={(e) => setName(e.target.value)} disabled={!fresh && !!row?.source?.startsWith("package")} />
        </Field>
        <Field label={t("Label")} htmlFor="c-label" required error={fieldErrors.label}>
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
          <Section title={t("Notes")}>
            <Meta d={d} set={set} />
          </Section>
          {more.length > 0 && (
            <Section title={t("More in this description")}>
              <p className="muted">{t("The form has no control for these. They are kept as they are when you save. Edit the whole description in the JSON view to change them.")}</p>
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {more.map((m) => (
                  <li key={m.path}>
                    <span className="mono">{isolate(m.path)}</span>
                    <pre className="mono faint" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "8rem", overflow: "auto" }}>{isolate(JSON.stringify(m.value))}</pre>
                  </li>
                ))}
              </ul>
              <div><Button onClick={() => show("json")}>{t("Edit the whole description as JSON")}</Button></div>
            </Section>
          )}
        </div>
      )}
      {fresh && (
        <section className="card stack" aria-label={t("Secrets")}>
          <Secrets names={names} set={setNow} extra={extra} addName={(n) => setExtra((x) => [...x, n])} />
        </section>
      )}
      <div className="row">
        <Button type="submit" variant="primary" loading={busy}>{t("Save")}</Button>
        <Button onClick={onClose}>{t("Cancel")}</Button>
      </div>
      {fresh && <p className="muted">{t("Turn it on when you have tried an operation.")}</p>}
    </form>
    {!fresh && row && <SecretsPanel row={row} referenced={referenced} />}
    </div>
  );
}
