// Administration → Secrets: the workspace's secrets in the vault, by owner (the platform, each app, each plugin), described and never
// shown (docs/api.md, "Secrets — /api/admin/secrets"; docs/operations.md, "The vault"). GET /api/admin/secrets, PUT and DELETE
// /api/admin/secrets/{owner}/{name}, POST …/rotate, in the shapes of server/src/controllers/secrets.rs and crates/kernel/src/vault/secrets.rs.
// A value the server makes is shown once, in the dialog that asked for it, and lives only in that dialog's state: never in the query
// cache, the URL, storage, a toast or a log. Changing needs a confirmed identity: the client's step-up flow asks and sends the request
// again once (src/lib/api.ts). The list is read again after every change, whatever its answer.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { currentLanguage, isolate, t as tr } from "@ferrum/client";
import { ApiError, errorMessage, request, api, type FieldError } from "../lib/api";
import { formatDate, formatMoment } from "../lib/format";
import { Alert, Button, confirmDialog, Dialog, Field, ScrollRegion, toast } from "../ui/kit";
import { LoadFailed, StatePanel, TableSkeleton } from "../ui/patterns";
import type { AppsResponse } from "./Apps";

export interface Rule {
  reveal: boolean;
  hosts: string[];
  sandbox: "blank" | "regenerate" | "keep";
  overlap_secs: number;
  expires_at: string | null;
}

/** A secret as the server describes it (`Described`): never its value. */
export interface Secret {
  owner: string;
  name: string;
  kind: "value" | "ed25519";
  version: number;
  rule: Rule;
  set_at: string;
  set_by: string | null;
  /** A day. */
  last_used: string | null;
  public_key?: string;
  previous_until?: string;
}

type Way = "value" | "random" | "ed25519";

const KEY = ["admin", "secrets"];
const at = (owner: string, name: string) => `/api/admin/secrets/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

/** Why a name cannot be given, or null: as the server checks it (`check_name`). */
export function nameProblem(name: string): string | null {
  return /^[a-z0-9][a-z0-9_.-]{0,99}$/.test(name) ? null : tr("Use up to 100 lowercase letters, digits and _ . -, starting with a letter or digit.");
}

/** A length of time in the page's language: "1 hour", "7 days". */
export function duration(secs: number): string {
  const [n, unit] = secs % 86_400 === 0 ? [secs / 86_400, "day"] : secs % 3600 === 0 ? [secs / 3600, "hour"] : [Math.ceil(secs / 60), "minute"];
  return new Intl.NumberFormat(currentLanguage(), { style: "unit", unit, unitDisplay: "long" }).format(n);
}

const OVERLAPS = [0, 3600, 86_400, 7 * 86_400, 30 * 86_400];
const SANDBOX = (): Record<Rule["sandbox"], string> => ({
  blank: tr("A sandbox has none"),
  regenerate: tr("A sandbox gets its own"),
  keep: tr("A sandbox keeps this one"),
});

/** "Today", "Yesterday", or the day. */
function lastUsed(day: string | null): string {
  if (!day) return tr("Not used yet");
  const days = Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(day)) / 86_400_000);
  return days <= 0 ? tr("Used today") : days === 1 ? tr("Used yesterday") : tr("Last used {date}", { date: formatDate(day) });
}

export function Secrets() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => request<{ owners: { owner: string; secrets: Secret[] }[] }>("/api/admin/secrets", { signal, once: true }),
    retry: false,
  });
  // Owners by name: the apps installed, the plugins (both already read by their own tabs).
  const apps = useQuery({ queryKey: ["apps"], queryFn: ({ signal }) => api.get<AppsResponse>("/api/admin/apps", undefined, signal), retry: false });
  const plugins = useQuery({ queryKey: ["admin", "plugins"], queryFn: ({ signal }) => api.get<{ plugins: { name: string }[] }>("/api/admin/plugins", undefined, signal), retry: false });
  const ownerName = (owner: string) =>
    owner === "platform" ? tr("The platform")
    : owner.startsWith("plugin:") ? tr("Plugin {name}", { name: isolate(owner.slice(7)) })
    : isolate(apps.data?.installed.find((a) => a.id === owner)?.name ?? owner);
  const owners = q.data?.owners.filter((o) => o.secrets.length) ?? [];
  const choices = [...new Set(["platform", ...(apps.data?.installed.map((a) => a.id) ?? []), ...(plugins.data?.plugins.map((p) => `plugin:${p.name}`) ?? []), ...owners.map((o) => o.owner)])];

  const [dialog, setDialog] = useState<{ secret: Secret | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const said = useRef<HTMLDivElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const gone = (s: Secret) => tr("Someone else removed {name} meanwhile. The list now shows what is there.", { name: isolate(s.name) });
  useEffect(() => void (problem && said.current?.focus()), [problem]);

  const remove = async (s: Secret) => {
    const message =
      s.kind === "ed25519"
        ? tr("{owner} can no longer sign with this key, and what it signed no longer checks. Every version is removed. This cannot be undone.", { owner: ownerName(s.owner) })
        : tr("Whatever {owner} does with it stops working: signing in to another service, signing or checking what it sends. Every version is removed. This cannot be undone.", { owner: ownerName(s.owner) });
    if (!(await confirmDialog({ title: tr("Remove {name}?", { name: isolate(s.name) }), message, confirmLabel: tr("Remove"), danger: true }))) return;
    setBusy(`${s.owner}/${s.name}`);
    setProblem(null);
    try {
      await api.del(at(s.owner, s.name));
      toast(tr("{name} is removed", { name: isolate(s.name) }));
    } catch (e) {
      setProblem(e instanceof ApiError && e.status === 404 ? gone(s) : tr("{name} was not removed: {reason}", { name: isolate(s.name), reason: isolate(errorMessage(e)) }));
    }
    await refresh();
    setBusy(null);
  };

  if (q.isLoading) return <TableSkeleton columns={4} rows={3} />;
  if (!q.data) {
    if (q.error instanceof ApiError && q.error.status === 503)
      return (
        <StatePanel kind="failed" title={tr("The vault is closed")}>
          {tr("Secrets are kept in the installation's vault, and it is closed now. Whoever runs the installation must give it its root to open it. Until then nothing here can be read or changed.")}
        </StatePanel>
      );
    return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
  }
  const add = (
    <Button variant="primary" icon="plus" onClick={() => setDialog({ secret: null })}>
      {tr("Add a secret")}
    </Button>
  );
  return (
    <div className="stack">
      <div className="row">
        <p className="muted" style={{ flex: "1 1 240px", margin: 0 }}>
          {tr("Passwords, tokens and keys that the platform, apps and plugins use. They are kept in the vault and never shown here.")}
        </p>
        {owners.length > 0 && add}
      </div>
      <div ref={said} tabIndex={-1}>
        {problem && <Alert tone="error">{problem}</Alert>}
      </div>
      {!owners.length && (
        <StatePanel kind="empty" title={tr("No secrets yet")} action={add}>
          {tr("A secret is a password, token or key that the platform, an app or a plugin uses: to sign in to another service, or to sign and check what it sends. The server uses it; people see only its name and how it may be used.")}
        </StatePanel>
      )}
      {owners.map((o) => {
        const head = `secrets-${o.owner}`;
        return (
          <section key={o.owner} className="card" aria-labelledby={head}>
            <div className="card-head">
              <h2 id={head}>{ownerName(o.owner)}</h2>
            </div>
            <ScrollRegion label={ownerName(o.owner)}>
              <table className="table list-table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Secret")}</th>
                    <th scope="col">{tr("How it is used")}</th>
                    <th scope="col">{tr("Changed")}</th>
                    <th scope="col">
                      <span className="sr-only">{tr("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {o.secrets.map((s) => {
                    const id = `secret-${s.owner}-${s.name}`;
                    const r = s.rule;
                    return (
                      <tr key={s.name}>
                        <td className="card-lead">
                          <div id={id} className="mono" dir="ltr" style={{ overflowWrap: "anywhere" }}>
                            {s.name}
                          </div>
                          <div className="muted">
                            {s.kind === "ed25519" ? tr("A signing key pair") : tr("A value")} · {tr("Version {n}", { n: s.version })}
                          </div>
                          {s.public_key && (
                            <div className="faint" style={{ overflowWrap: "anywhere" }}>
                              {tr("Public key")}: <span className="mono" dir="ltr">{s.public_key}</span>
                            </div>
                          )}
                        </td>
                        <td data-label={tr("How it is used")}>
                          <div>
                            <div>{r.reveal ? tr("Its owner may read it") : tr("Used by the server, never shown")}</div>
                            <div className="muted">{r.hosts.length ? tr("Sent only to {hosts}", { hosts: isolate(r.hosts.join(", ")) }) : tr("Not sent to any host")}</div>
                            <div className="muted">{SANDBOX()[r.sandbox]}</div>
                            {r.overlap_secs > 0 && <div className="muted">{tr("After a change, the version before still checks for {time}", { time: duration(r.overlap_secs) })}</div>}
                            {r.expires_at && <div className="muted">{tr("Stops working on {date}", { date: formatMoment(r.expires_at, { dateStyle: "medium", timeStyle: "short" }) })}</div>}
                          </div>
                        </td>
                        <td data-label={tr("Changed")}>
                          <div>
                            <div>{formatMoment(s.set_at, { dateStyle: "medium", timeStyle: "short" })}</div>
                            <div className="muted">{lastUsed(s.last_used)}</div>
                            {s.previous_until && Date.parse(s.previous_until) > Date.now() && (
                              <div className="muted">{tr("The version before checks until {date}", { date: formatMoment(s.previous_until, { dateStyle: "medium", timeStyle: "short" }) })}</div>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Button size="sm" aria-describedby={id} disabled={busy === `${s.owner}/${s.name}`} onClick={() => setDialog({ secret: s })}>
                              {tr("New version")}
                            </Button>
                            <Button size="sm" icon="trash" aria-describedby={id} loading={busy === `${s.owner}/${s.name}`} onClick={() => void remove(s)}>
                              {tr("Remove…")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollRegion>
          </section>
        );
      })}
      {dialog && (
        <SecretDialog
          secret={dialog.secret}
          owners={choices.map((o) => ({ id: o, name: ownerName(o) }))}
          taken={(owner, name) => !!q.data?.owners.find((o) => o.owner === owner)?.secrets.some((s) => s.name === name)}
          onChanged={() => void refresh()}
          onGone={(s) => (setDialog(null), setProblem(gone(s)))}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** Adds a secret (`secret` null) or makes a new version of one. A value the server made is shown here once; it goes with the dialog. */
function SecretDialog({
  secret,
  owners,
  taken,
  onChanged,
  onGone,
  onClose,
}: {
  secret: Secret | null;
  owners: { id: string; name: string }[];
  taken: (owner: string, name: string) => boolean;
  onChanged: () => void;
  onGone: (s: Secret) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [owner, setOwner] = useState("platform");
  const [name, setName] = useState("");
  const [way, setWay] = useState<Way>(secret?.kind === "ed25519" ? "ed25519" : "value");
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [bytes, setBytes] = useState("32");
  const [reveal, setReveal] = useState(false);
  const [hosts, setHosts] = useState("");
  const [sandbox, setSandbox] = useState<Rule["sandbox"]>("blank");
  const [overlap, setOverlap] = useState(0);
  const [expires, setExpires] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ name: string; value: string } | null>(null);
  const sending = useRef(false);
  useEffect(() => void (shown && document.getElementById(`${id}-copy`)?.focus()), [shown, id]);

  const fields = ["owner", "name", "value", "random", "hosts", "sandbox", "overlap_secs", "expires_at"];
  const error = (f: string) => errors.find((e) => e.field === f)?.message;
  const elsewhere = errors.filter((e) => !fields.includes(e.field));
  useEffect(() => {
    if (!tries) return;
    const first = errors.find((e) => fields.includes(e.field))?.field;
    const el = document.getElementById(elsewhere.length || !first ? `${id}-said` : `${id}-${first}`);
    // A refusal of the rule opens its fields, where it is said.
    const rule = el?.closest("details");
    if (rule) rule.open = true;
    el?.focus();
  }, [tries]); // eslint-disable-line react-hooks/exhaustive-deps -- once per try
  function edit<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setErrors([]);
    };
  }

  const local = (): FieldError[] => {
    const out: FieldError[] = [];
    if (!secret) {
      const problem = nameProblem(name);
      if (!name) out.push({ field: "name", message: tr("Give a name.") });
      else if (problem) out.push({ field: "name", message: problem });
      else if (taken(owner, name)) out.push({ field: "name", message: tr("This owner already has a secret with this name: make a new version of it instead.") });
    }
    if (way === "value" && !value) out.push({ field: "value", message: tr("Type the value.") });
    const n = Number(bytes);
    if (way === "random" && !(Number.isInteger(n) && n >= 16 && n <= 64)) out.push({ field: "random", message: tr("Between 16 and 64.") });
    return out;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    const wrong = local();
    if (wrong.length) {
      setErrors(wrong);
      setTries((n) => n + 1);
      return;
    }
    const what = way === "value" ? { value } : way === "random" ? { random: Number(bytes) } : { ed25519: true };
    const target = secret ?? { owner, name };
    sending.current = true;
    setBusy(true);
    try {
      const r = secret
        ? await api.post<{ shown?: string }>(`${at(secret.owner, secret.name)}/rotate`, what)
        : await api.put<{ shown?: string }>(at(owner, name), {
            ...what,
            rule: {
              reveal,
              hosts: hosts.split(/[\s,]+/).map((h) => h.trim().toLowerCase()).filter(Boolean),
              sandbox,
              overlap_secs: overlap,
              expires_at: expires ? new Date(expires).toISOString() : null,
            },
          });
      setValue("");
      onChanged();
      if (r.shown) setShown({ name: target.name, value: r.shown });
      else {
        toast(secret ? tr("{name} has a new version", { name: isolate(target.name) }) : tr("{name} is saved", { name: isolate(target.name) }));
        onClose();
      }
    } catch (err) {
      // What was typed goes on any failure: it is typed again, never kept.
      setValue("");
      onChanged();
      if (secret && err instanceof ApiError && err.status === 404) return onGone(secret);
      setErrors(
        err instanceof ApiError && err.fields.length ? err.fields
        : err instanceof ApiError && err.status === 503 ? [{ field: "", message: tr("The vault is closed. Whoever runs the installation must give it its root to open it.") }]
        : [{ field: "", message: errorMessage(err) }],
      );
      setTries((n) => n + 1);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown!.value);
      toast(tr("Copied to the clipboard"));
    } catch {
      toast(tr("Copy failed: select the text and copy it manually"), "error");
    }
  };

  const overlapSaid = secret
    ? secret.rule.overlap_secs > 0
      ? tr("The version before still checks for {time} after the change.", { time: duration(secret.rule.overlap_secs) })
      : tr("The version before stops working at once.")
    : null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={shown ? tr("The value of {name}", { name: isolate(shown.name) }) : secret ? tr("New version of {name}", { name: isolate(secret.name) }) : tr("Add a secret")}
      description={shown ? undefined : (overlapSaid ?? undefined)}
      footer={
        shown ? (
          <Button variant="primary" onClick={onClose}>
            {tr("Done")}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{tr("Cancel")}</Button>
            <Button variant="primary" type="submit" form={`${id}-form`} loading={busy}>
              {secret ? tr("Make the new version") : tr("Add")}
            </Button>
          </>
        )
      }
    >
      {shown ? (
        <div className="stack">
          <p role="status">{tr("Copy it now. It is shown only this once and cannot be shown again.")}</p>
          <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
            <code className="mono" dir="ltr" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              {shown.value}
            </code>
            <Button id={`${id}-copy`} size="sm" icon="copy" onClick={() => void copy()}>
              {tr("Copy")}
            </Button>
          </div>
        </div>
      ) : (
        <form id={`${id}-form`} className="stack" onSubmit={submit} autoComplete="off">
          <div id={`${id}-said`} tabIndex={-1}>
            {elsewhere.length > 0 && <Alert tone="error">{isolate(elsewhere.map((e) => e.message).join(" "))}</Alert>}
          </div>
          {!secret && (
            <>
              <Field label={tr("Owner")} error={error("owner")} hint={tr("The platform, app or plugin that uses it.")}>
                <select id={`${id}-owner`} className="select" value={owner} onChange={(e) => edit(setOwner)(e.target.value)}>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr("Name")} required error={error("name")} hint={tr("The name its owner asks for, such as api_token.")}>
                <input id={`${id}-name`} data-autofocus className="input mono" dir="ltr" value={name} autoComplete="off" spellCheck={false} autoCapitalize="none" onChange={(e) => edit(setName)(e.target.value)} />
              </Field>
            </>
          )}
          {secret?.kind === "ed25519" ? (
            <p>{tr("The server makes a new signing key pair. Its private half is never shown.")}</p>
          ) : (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field-label">{tr("What it holds")}</legend>
              <div className="stack" style={{ gap: 8 }}>
                <label className="row" style={{ gap: 8 }}>
                  <input type="radio" name={`${id}-way`} checked={way === "value"} onChange={() => edit(setWay)("value")} />
                  {tr("A value I type")}
                </label>
                <label className="row" style={{ gap: 8 }}>
                  <input type="radio" name={`${id}-way`} checked={way === "random"} onChange={() => edit(setWay)("random")} />
                  {tr("A random value the server makes, shown once")}
                </label>
                {!secret && (
                  <label className="row" style={{ gap: 8 }}>
                    <input type="radio" name={`${id}-way`} checked={way === "ed25519"} onChange={() => edit(setWay)("ed25519")} />
                    {tr("A signing key pair the server makes")}
                  </label>
                )}
              </div>
            </fieldset>
          )}
          {way === "value" && (
            <Field label={tr("Value")} required error={error("value")} htmlFor={`${id}-value`}>
              <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                <input
                  id={`${id}-value`}
                  className="input mono"
                  dir="ltr"
                  style={{ flex: 1, minWidth: 0 }}
                  type={visible ? "text" : "password"}
                  value={value}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  aria-invalid={error("value") ? true : undefined}
                  onChange={(e) => edit(setValue)(e.target.value)}
                />
                <Button size="sm" variant="ghost" aria-label={visible ? tr("Hide the value") : tr("Show the value")} aria-pressed={visible} onClick={() => setVisible(!visible)}>
                  {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </Button>
              </div>
            </Field>
          )}
          {way === "random" && (
            <Field label={tr("Length in bytes")} error={error("random")} hint={tr("From 16 to 64.")}>
              <input id={`${id}-random`} className="input" type="number" min={16} max={64} value={bytes} onChange={(e) => edit(setBytes)(e.target.value)} />
            </Field>
          )}
          {!secret && (
            <details>
              <summary>{tr("How it may be used")}</summary>
              <div className="stack" style={{ marginTop: 8 }}>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={reveal} onChange={(e) => edit(setReveal)(e.target.checked)} />
                  {tr("Its owner may read the value (otherwise the server only uses it)")}
                </label>
                <Field label={tr("Hosts it may be sent to")} error={error("hosts")} hint={tr("Separated by commas, such as api.example.com or *.example.com. Empty: it is not sent anywhere.")}>
                  <input id={`${id}-hosts`} className="input mono" dir="ltr" value={hosts} autoComplete="off" spellCheck={false} autoCapitalize="none" onChange={(e) => edit(setHosts)(e.target.value)} />
                </Field>
                <Field label={tr("In a sandbox")} error={error("sandbox")}>
                  <select id={`${id}-sandbox`} className="select" value={sandbox} onChange={(e) => edit(setSandbox)(e.target.value as Rule["sandbox"])}>
                    {(["blank", "regenerate", "keep"] as const).map((k) => (
                      <option key={k} value={k}>
                        {SANDBOX()[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr("After a change, the version before still checks for")} error={error("overlap_secs")}>
                  <select id={`${id}-overlap_secs`} className="select" value={overlap} onChange={(e) => edit(setOverlap)(Number(e.target.value))}>
                    {OVERLAPS.map((s) => (
                      <option key={s} value={s}>
                        {s ? duration(s) : tr("No time: it stops at once")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr("Stops working on")} error={error("expires_at")} hint={tr("Empty: it does not stop.")}>
                  <input id={`${id}-expires_at`} className="input" type="datetime-local" value={expires} onChange={(e) => edit(setExpires)(e.target.value)} />
                </Field>
              </div>
            </details>
          )}
        </form>
      )}
    </Dialog>
  );
}
