// Administration: users, roles & permissions, packages, webhooks, automations, plugins, API keys, workspace settings.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError, errorMessage, saveBlob, type FieldError } from "../lib/api";
import { formatDateTime, relativeTime } from "../lib/format";
import { useEntityMeta, useMe, useMetaIndex, type Field } from "../lib/meta";
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

const TABS = [
  { id: "users", label: "Users" },
  { id: "roles", label: "Roles & permissions" },
  { id: "packages", label: "Packages" },
  { id: "webhooks", label: "Webhooks" },
  { id: "automations", label: "Automations" },
  { id: "plugins", label: "Plugins" },
  { id: "keys", label: "API keys" },
  { id: "privacy", label: "Personal data" },
  { id: "workspace", label: "Workspace" },
];

export function AdminPage() {
  const me = useMe();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.id === sp.get("tab")) ? (sp.get("tab") as string) : "users";
  if (me.isLoading) return <PageLoading />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title="Administrator access required" icon="alert">
        <p className="muted">Ask an administrator if you need access to these settings.</p>
      </EmptyState>
    );
  }
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Administration</h1>
      </div>
      <Tabs id="admin" tabs={TABS} value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} />
      <TabPanel id="admin" tab={tab}>
        {tab === "users" && <Users />}
        {tab === "roles" && <Roles />}
        {tab === "packages" && <Packages />}
        {tab === "webhooks" && <Webhooks />}
        {tab === "automations" && <Automations />}
        {tab === "plugins" && <Plugins />}
        {tab === "keys" && <ApiKeys />}
        {tab === "privacy" && <PersonalData />}
        {tab === "workspace" && <Workspace />}
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
  data: Record<string, unknown>;
}

interface PersonData {
  email: string;
  records: PersonRecord[];
  account: { id: string; email: string; full_name: string; is_active: boolean; is_admin: boolean; roles: string[]; created_at: string; last_login_at?: string | null } | null;
}

/** Field names of an entity as their labels, in a list. */
function FieldLabels({ entity, names }: { entity: string; names: string[] }) {
  const fields = useEntityMeta(entity).data?.fields;
  return <>{names.map((n) => fields?.find((f) => f.name === n)?.label ?? n).join(", ")}</>;
}

/** Personal-data requests: what is kept about a person (by email), a copy for them, and its erasure. */
function PersonalData() {
  const [email, setEmail] = useState("");
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
      setFound(await api.get<PersonData>("/api/admin/personal-data", { email: email.trim() }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const download = () => found && saveBlob(new Blob([JSON.stringify(found, null, 2)], { type: "application/json" }), `personal-data-${found.email}.json`);
  const erase = async () => {
    if (!found) return;
    const what = `${found.records.length} ${found.records.length === 1 ? "record" : "records"}${found.account ? " and the login account" : ""}`;
    if (!(await confirmDialog({ title: `Erase ${found.email}?`, message: `The person's details leave ${what}, and their history. This cannot be undone.`, confirmLabel: "Erase", danger: true })))
      return;
    setBusy("erase");
    setError(null);
    try {
      const res = await api.post<{ erased: unknown[]; account_erased: boolean; audit_events_redacted: number }>("/api/admin/personal-data/erase", { email: found.email, reason: reason.trim() });
      toast(`Erased ${res.erased.length} ${res.erased.length === 1 ? "record" : "records"}${res.account_erased ? " and the login account" : ""}; ${res.audit_events_redacted} history entries redacted`);
      setFound(null);
      setReason("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const nothing = found && !found.records.length && !found.account;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Personal data</h2>
      </div>
      <div className="card-pad stack">
        <p className="muted">
          Find what is kept about a person by their email address, give them a copy, or erase it. Erasure blanks their details on the records listed and in those
          records&apos; history, and closes their login account; submitted documents keep the names they carry, as bookkeeping law requires.
        </p>
        <form className="row" onSubmit={find}>
          <FieldWrap label="Email" htmlFor="pd-email">
            <input id="pd-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </FieldWrap>
          <Button type="submit" variant="primary" icon="search" loading={busy === "find"} disabled={!email.trim()}>
            Find
          </Button>
        </form>
        {error && <Alert tone="error">{error}</Alert>}
        {nothing && <p className="muted">Nothing is kept about {found.email}.</p>}
        {found && !nothing && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Record</th>
                    <th scope="col">Erasure blanks</th>
                  </tr>
                </thead>
                <tbody>
                  {found.records.map((r) => (
                    <tr key={`${r.entity}/${r.id}`}>
                      <td>{r.label}</td>
                      <td>
                        <a href={`/app/e/${encodeURIComponent(r.entity)}/${encodeURIComponent(r.id)}`}>{r.number || r.id.slice(0, 8)}</a>
                      </td>
                      <td className="muted">
                        <FieldLabels entity={r.entity} names={r.erases} />
                      </td>
                    </tr>
                  ))}
                  {found.account && (
                    <tr>
                      <td>Login account</td>
                      <td>
                        {found.account.full_name || found.account.email} {found.account.is_admin && <Badge tone="amber">administrator</Badge>}
                      </td>
                      <td className="muted">name, email, password and roles; the account is closed</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="row">
              <Button icon="download" onClick={download}>
                Download a copy (JSON)
              </Button>
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void erase();
              }}
            >
              <FieldWrap label="Reason" htmlFor="pd-reason" hint="Kept with the erasure, e.g. the request's reference">
                <input id="pd-reason" className="input" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </FieldWrap>
              <Button type="submit" variant="danger" icon="trash" loading={busy === "erase"} disabled={!reason.trim() || !!found.account?.is_admin}>
                Erase
              </Button>
            </form>
          </>
        )}
      </div>
    </section>
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

// ── workspace settings ──

interface WorkspaceSettings {
  timezone: string;
  fiscal_year_start_month: number;
  require_two_factor: boolean;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString("en", { month: "long" }));

function Workspace() {
  const q = useQuery({ queryKey: ["admin", "settings"], queryFn: ({ signal }) => api.get<WorkspaceSettings>("/api/admin/settings", undefined, signal) });
  return <Loaded q={q}>{(s) => <WorkspaceForm key={`${s.timezone}|${s.fiscal_year_start_month}|${s.require_two_factor}`} initial={s} />}</Loaded>;
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
        title: "Change when the fiscal year starts?",
        message: "Number series that include the fiscal year, and fiscal-year report periods, use the new start from now on. Existing documents keep their numbers.",
        confirmLabel: "Change",
      }))
    )
      return;
    setBusy(true);
    setErrors([]);
    try {
      await api.put("/api/admin/settings", form);
      toast("Workspace settings saved");
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
        label="Time zone"
        htmlFor="ws-tz"
        error={fieldError("timezone")}
        hint={`Today's date, date-based number series and report periods follow it. This device uses ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`}
      >
        <select id="ws-tz" className="select" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </FieldWrap>
      <FieldWrap label="Fiscal year starts in" htmlFor="ws-fy" error={fieldError("fiscal_year_start_month")}>
        <select id="ws-fy" className="select" value={form.fiscal_year_start_month} onChange={(e) => setForm({ ...form, fiscal_year_start_month: Number(e.target.value) })}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </FieldWrap>
      <FieldWrap
        label="Two-factor sign-in"
        htmlFor="ws-2fa"
        error={fieldError("require_two_factor")}
        hint="Everyone signs in with a code from an authenticator app too; those without one set it up at their next sign-in."
      >
        <label className="row" style={{ gap: 8 }}>
          <input id="ws-2fa" type="checkbox" checked={form.require_two_factor} onChange={(e) => setForm({ ...form, require_two_factor: e.target.checked })} />
          Require it of everyone
        </label>
      </FieldWrap>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={!fyChanged && form.timezone === initial.timezone && form.require_two_factor === initial.require_two_factor}
        >
          Save
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
          I have stored it
        </Button>
      }
    >
      <div className="stack">
        <Alert tone="warning">{note}</Alert>
        <div className="secret">
          <code className="mono" style={{ flex: 1 }}>
            {secret}
          </code>
          <Button
            size="sm"
            data-autofocus
            onClick={() =>
              navigator.clipboard.writeText(secret ?? "").then(
                () => toast("Copied to the clipboard"),
                () => toast("Copy failed: select the text and copy it manually", "error"),
              )
            }
          >
            Copy
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
  last_login_at?: string | null;
  roles: string[];
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
}
interface Role {
  name: string;
  description?: string | null;
  package?: string | null;
  permissions: Permission[];
}

const useUsers = () =>
  useQuery({ queryKey: ["admin", "users"], queryFn: ({ signal }) => api.get<{ users: User[] }>("/api/admin/users", undefined, signal) });
const useRoles = () =>
  useQuery({ queryKey: ["admin", "roles"], queryFn: ({ signal }) => api.get<{ roles: Role[] }>("/api/admin/roles", undefined, signal) });

function RoleChecks({ roles, value, onChange }: { roles: string[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!roles.length) return <p className="faint">No roles defined yet.</p>;
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label" style={{ marginBottom: 6 }}>
        Roles
      </legend>
      <div className="form-grid">
        {roles.map((r) => (
          <label key={r} className="check-field">
            <input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
            {r}
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
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const toggleActive = async (u: User) => {
    const ok = await confirmDialog({
      title: u.is_active ? `Deactivate ${u.full_name}?` : `Activate ${u.full_name}?`,
      message: u.is_active ? "They will be signed out and can no longer sign in or use API keys." : "They will be able to sign in again.",
      confirmLabel: u.is_active ? "Deactivate" : "Activate",
      danger: u.is_active,
    });
    if (ok && (await attempt(() => api.put(`/api/admin/users/${u.id}/active`, { active: !u.is_active }), u.is_active ? "User deactivated" : "User activated")))
      void refresh();
  };
  const resetTwoFactor = async (u: User) => {
    const ok = await confirmDialog({
      title: `Reset two-factor sign-in for ${u.full_name}?`,
      message: "For a lost phone: it turns their two-factor sign-in off, lifts a lockout and signs them out everywhere. If the workspace requires it, they set it up again at their next sign-in.",
      confirmLabel: "Reset",
      danger: true,
    });
    if (ok && (await attempt(() => api.post(`/api/admin/users/${u.id}/two-factor/reset`), "Two-factor sign-in reset"))) void refresh();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Users</h2>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New user
        </Button>
      </div>
      <Loaded q={users}>
        {(data) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Roles</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div>
                        {u.full_name} {u.is_admin && <Badge tone="purple">admin</Badge>}
                      </div>
                      <div className="muted">{u.email}</div>
                    </td>
                    <td>
                      <div className="chips">
                        {u.roles.length ? u.roles.map((r) => <Badge key={r}>{r}</Badge>) : <span className="faint">none</span>}
                      </div>
                    </td>
                    <td>
                      <div className="chips">
                        <Badge tone={u.is_active ? "green" : "red"}>{u.is_active ? "active" : "inactive"}</Badge>
                        {u.locked && <Badge tone="red">locked</Badge>}
                        {u.two_factor && <Badge tone="blue">2FA</Badge>}
                      </div>
                    </td>
                    <td className="nowrap">{u.last_login_at ? relativeTime(u.last_login_at) : <span className="faint">never</span>}</td>
                    <td>
                      <div className="row">
                        <Button size="sm" onClick={() => setEditRoles(u)}>
                          Roles
                        </Button>
                        <Button size="sm" onClick={() => setResetting(u)}>
                          Reset password
                        </Button>
                        {u.two_factor && (
                          <Button size="sm" onClick={() => void resetTwoFactor(u)}>
                            Reset 2FA
                          </Button>
                        )}
                        <Button size="sm" variant={u.is_active ? "danger" : "default"} disabled={u.id === me?.user.id} onClick={() => void toggleActive(u)}>
                          {u.is_active ? "Deactivate" : "Activate"}
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
      <NewUserDialog open={creating} roles={roleNames} onClose={() => setCreating(false)} onDone={refresh} />
      <EditRolesDialog user={editRoles} roles={roleNames} onClose={() => setEditRoles(null)} onDone={refresh} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </section>
  );
}

function NewUserDialog({ open, roles, onClose, onDone }: { open: boolean; roles: string[]; onClose: () => void; onDone: () => void }) {
  const empty = { email: "", full_name: "", password: "", is_admin: false, roles: [] as string[] };
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
      await api.post("/api/admin/users", { ...u, email: u.email.trim(), full_name: u.full_name.trim(), password: u.password || undefined });
      toast("User created");
      onDone();
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={close} title="New user">
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        <FieldWrap label="Email" htmlFor="nu-email" required>
          <input id="nu-email" className="input" type="email" autoComplete="off" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} required />
        </FieldWrap>
        <FieldWrap label="Full name" htmlFor="nu-name" required>
          <input id="nu-name" className="input" value={u.full_name} onChange={(e) => setU({ ...u, full_name: e.target.value })} required />
        </FieldWrap>
        <FieldWrap label="Initial password" htmlFor="nu-pw" hint="Optional. At least 10 characters with 3 of: lower, upper, digit, symbol.">
          <input id="nu-pw" className="input" type="password" autoComplete="new-password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} />
        </FieldWrap>
        <label className="check-field">
          <input type="checkbox" checked={u.is_admin} onChange={(e) => setU({ ...u, is_admin: e.target.checked })} />
          Administrator
        </label>
        <RoleChecks roles={roles} value={u.roles} onChange={(r) => setU({ ...u, roles: r })} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create user
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditRolesDialog({ user, roles, onClose, onDone }: { user: User | null; roles: string[]; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState<string[]>([]);
  const [seen, setSeen] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  if (user !== seen) {
    setSeen(user);
    setValue(user?.roles ?? []);
  }
  const save = async () => {
    if (!user) return;
    setBusy(true);
    const ok = await attempt(() => api.put(`/api/admin/users/${user.id}/roles`, { roles: value }), "Roles updated");
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
      title={`Roles of ${user?.full_name ?? ""}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save roles
          </Button>
        </>
      }
    >
      <RoleChecks roles={roles} value={value} onChange={setValue} />
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
      toast(`Password reset for ${user.full_name}`);
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!user} onClose={close} title={`Reset password for ${user?.full_name ?? ""}`}>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        <FieldWrap label="New password" htmlFor="rp-pw" required hint="Their existing sessions are signed out.">
          <input id="rp-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} />
        </FieldWrap>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Reset password
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
            {f?.label ?? k} is{" "}
            {(Array.isArray(v) ? v : [v]).map(String).map((x, j) => (
              <span key={x}>
                {j > 0 && " or "}
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
          <option value="true">Ticked</option>
          <option value="false">Not ticked</option>
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
        <legend className="field-label">is one of</legend>
        {options.map((o) => (
          <label key={o} className="check-field">
            <input type="checkbox" checked={picked.has(o)} onChange={() => toggle(o)} /> {o}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <FieldWrap label="is one of" htmlFor="perm-values" hint="Comma-separated">
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
        if_owner: addOwner,
        read_groups: [],
        write_groups: [],
        match_rule: conditionField ? { [conditionField.name]: conditionValues(conditionField.type, conditionField.type === "check" ? addValues || "true" : addValues) } : null,
      },
      "add",
    );
    if (ok) {
      toast(`${addEntity} added to ${current}`);
      setAddEntity("");
      setAddOwner(false);
      setAddField("");
      setAddValues("");
    }
  };

  const entities = [...(index?.entities ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const label = (name: string) => (name === "*" ? "All entities (*)" : (index?.entities.find((e) => e.name === name)?.label ?? name));

  return (
    <Loaded q={roles}>
      {() => (
        <div className="stack">
          <div className="card card-pad row">
            <FieldWrap label="Role" htmlFor="role-pick">
              <select id="role-pick" className="select" style={{ minWidth: 240 }} value={current} onChange={(e) => setSelected(e.target.value)}>
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
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
              <FieldWrap label="New role" htmlFor="role-new" hint="Created when you grant its first permission.">
                <input id="role-new" className="input" value={newRole} onChange={(e) => setNewRole(e.target.value)} maxLength={100} />
              </FieldWrap>
              <Button type="submit">Add role</Button>
            </form>
          </div>
          {role?.description && <p className="muted">{role.description}</p>}
          <section className="card" aria-label={`Permissions of ${current}`}>
            <div className="table-wrap">
              <table className="table matrix">
                <thead>
                  <tr>
                    <th scope="col">Entity</th>
                    {ACTIONS.map((a) => (
                      <th key={a} scope="col">
                        {a}
                      </th>
                    ))}
                    <th scope="col">Applies to</th>
                  </tr>
                </thead>
                <tbody>
                  {!perms.length && (
                    <tr>
                      <td colSpan={ACTIONS.length + 2} className="muted">
                        This role has no permissions yet.
                      </td>
                    </tr>
                  )}
                  {perms.map((p) => {
                    const key = `${p.entity}|${p.if_owner}|${p.rule_key ?? ""}`;
                    return (
                      <tr key={key}>
                        <td>{label(p.entity)}</td>
                        {ACTIONS.map((a) => {
                          const k = `can_${a}` as const;
                          return (
                            <td key={a}>
                              <label className="cell-check">
                                <input
                                  type="checkbox"
                                  aria-label={`${a} ${label(p.entity)}`}
                                  checked={p[k]}
                                  disabled={saving === key}
                                  onChange={(e) => void put({ ...p, [k]: e.target.checked }, key)}
                                />
                              </label>
                            </td>
                          );
                        })}
                        <td>
                          {p.if_owner && <Badge tone="amber">own only</Badge>}{" "}
                          {p.match_rule && Object.keys(p.match_rule).length > 0 ? (
                            <ConditionText entity={p.entity} cond={p.match_rule} />
                          ) : (
                            !p.if_owner && <span className="faint">all</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <form className="toolbar" style={{ borderBottom: 0, borderTop: "1px solid var(--border)" }} onSubmit={addRow}>
              <FieldWrap label="Grant access to" htmlFor="perm-entity" className="field-wide">
                <select id="perm-entity" className="select" value={addEntity} onChange={(e) => setAddEntity(e.target.value)}>
                  <option value="">Choose an entity…</option>
                  <option value="*">All entities (*)</option>
                  {entities.map((e) => (
                    <option key={e.name} value={e.name}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </FieldWrap>
              <label className="check-field">
                <input type="checkbox" checked={addOwner} onChange={(e) => setAddOwner(e.target.checked)} />
                Own records only
              </label>
              {conditionFields.length > 0 && (
                <>
                  <FieldWrap label="Only where" htmlFor="perm-field" hint="Optional: records whose field holds one of the values">
                    <select
                      id="perm-field"
                      className="select"
                      value={addField}
                      onChange={(e) => {
                        setAddField(e.target.value);
                        setAddValues("");
                      }}
                    >
                      <option value="">Any record</option>
                      {conditionFields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </FieldWrap>
                  {conditionField && <ConditionInput field={conditionField} value={addValues} onChange={setAddValues} />}
                </>
              )}
              <Button type="submit" icon="plus" disabled={!addEntity || !current || (!!conditionField && conditionField.type !== "check" && !addValues)} loading={saving === "add"}>
                Add
              </Button>
            </form>
          </section>
        </div>
      )}
    </Loaded>
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
      title: `Install ${p.label ?? p.name}?`,
      message: `This adds its entities, roles and data to the workspace${p.depends.length ? ` (requires ${p.depends.join(", ")})` : ""}.`,
      confirmLabel: "Install",
    });
    if (!ok) return;
    setBusy(p.name);
    if (await attempt(() => api.post("/api/admin/packages", { packages: [p.name] }), `${p.label ?? p.name} installed`)) {
      await Promise.all(["admin", "meta", "me", "reports"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    }
    setBusy(null);
  };
  return (
    <Loaded q={q}>
      {(data) => (
        <div className="home-grid">
          {data.packages.map((p) => (
            <section key={p.name} className="card">
              <div className="card-head">
                <h2>{p.label ?? p.name}</h2>
                <span className="faint mono">
                  {p.name}@{p.version}
                </span>
                <span className="spacer" />
                {p.installed ? (
                  <Badge tone="green">installed</Badge>
                ) : (
                  <Button size="sm" variant="primary" loading={busy === p.name} onClick={() => void install(p)}>
                    Install
                  </Button>
                )}
              </div>
              <div className="card-body stack" style={{ gap: 8 }}>
                <p className="muted">{p.description}</p>
                {p.depends.length > 0 && <p className="faint">Requires: {p.depends.join(", ")}</p>}
              </div>
            </section>
          ))}
        </div>
      )}
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
    if (!(await confirmDialog({ title: `Delete webhook ${w.name}?`, message: "Pending deliveries are dropped.", confirmLabel: "Delete", danger: true }))) return;
    if (await attempt(() => api.del(`/api/admin/webhooks/${w.id}`), "Webhook deleted")) void refresh();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Webhooks</h2>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New webhook
        </Button>
      </div>
      <Loaded q={q}>
        {(data) =>
          !data.webhooks.length ? (
            <EmptyState title="No webhooks yet" icon="external" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">URL</th>
                    <th scope="col">Topics</th>
                    <th scope="col" className="num">
                      Pending
                    </th>
                    <th scope="col" className="num">
                      Dead
                    </th>
                    <th scope="col">Created</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.webhooks.map((w) => (
                    <tr key={w.id}>
                      <td>
                        {w.name} {!w.is_active && <Badge tone="red">inactive</Badge>}
                      </td>
                      <td className="mono" style={{ overflowWrap: "anywhere" }}>
                        {w.url}
                      </td>
                      <td>
                        <div className="chips">
                          {w.topics.map((t) => (
                            <Badge key={t} tone="blue">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="num">{w.pending}</td>
                      <td className="num">{w.dead > 0 ? <Badge tone="red">{w.dead}</Badge> : w.dead}</td>
                      <td className="nowrap">{formatDateTime(w.created_at)}</td>
                      <td>
                        <Button size="sm" variant="danger" icon="trash" onClick={() => void remove(w)} aria-label={`Delete webhook ${w.name}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New webhook">
        <form className="stack" onSubmit={create}>
          {error && <Alert tone="error">{error}</Alert>}
          <FieldWrap label="Name" htmlFor="wh-name" required>
            <input id="wh-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </FieldWrap>
          <FieldWrap label="URL" htmlFor="wh-url" required>
            <input id="wh-url" className="input" type="url" placeholder="https://example.com/hooks/ferrum" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
          </FieldWrap>
          <FieldWrap label="Topics" htmlFor="wh-topics" required hint="Separated by commas or spaces, e.g. SalesInvoice.submitted, SalesInvoice.*, *">
            <input id="wh-topics" className="input mono" value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} required />
          </FieldWrap>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>
              Create webhook
            </Button>
          </div>
        </form>
      </Dialog>
      <SecretDialog
        secret={secret?.secret ?? null}
        title="Webhook signing secret"
        note={`This secret is shown only once. ${secret?.note ?? "Use it to verify the X-Ferrum-Signature header."}`}
        onClose={() => setSecret(null)}
      />
    </section>
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
    if (!(await confirmDialog({ title: `Delete automation ${a.name}?`, confirmLabel: "Delete", danger: true }))) return;
    if (await attempt(() => api.del(`/api/admin/automations/${a.id}`), "Automation deleted")) void refresh();
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Automations</h2>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setEditing({ event: "submitted", is_active: true, actions: [] })}>
          New automation
        </Button>
      </div>
      <Loaded q={q}>
        {(data) =>
          !data.automations.length ? (
            <EmptyState title="No automations yet" icon="settings" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">When</th>
                    <th scope="col">Condition</th>
                    <th scope="col">Actions</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.automations.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>
                        {a.entity} {a.event}
                      </td>
                      <td className="mono">{a.condition || <span className="faint">always</span>}</td>
                      <td>{Array.isArray(a.actions) ? a.actions.map((x) => (x as { type?: string }).type).join(", ") : "—"}</td>
                      <td>
                        <Badge tone={a.is_active ? "green" : "neutral"}>{a.is_active ? "active" : "off"}</Badge>
                      </td>
                      <td className="nowrap">
                        <Button size="sm" icon="edit" onClick={() => setEditing(a)}>
                          Edit
                        </Button>{" "}
                        <Button size="sm" variant="danger" icon="trash" aria-label={`Delete automation ${a.name}`} onClick={() => void remove(a)} />
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
      setError("Fix the actions JSON before adding a template.");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let actions: unknown;
    try {
      actions = JSON.parse(form.actions);
    } catch {
      return setError("Actions must be valid JSON (an array of action objects).");
    }
    if (!Array.isArray(actions)) return setError("Actions must be a JSON array.");
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/automations", { ...(value?.id ? { id: value.id } : {}), ...form, condition: form.condition.trim() || null, actions });
      toast(value?.id ? "Automation saved" : "Automation created");
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!value} onClose={onClose} title={value?.id ? `Edit ${value.name}` : "New automation"} wide>
      <form className="stack" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="form-grid" style={{ ["--cols" as string]: 3 }}>
          <FieldWrap label="Name" htmlFor="au-name" required>
            <input id="au-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </FieldWrap>
          <FieldWrap label="Entity" htmlFor="au-entity" required>
            <select id="au-entity" className="select" value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} required>
              <option value="">Choose…</option>
              {[...(index?.entities ?? [])]
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.label}
                  </option>
                ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Event" htmlFor="au-event" required>
            <select id="au-event" className="select" value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })}>
              {EVENTS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </FieldWrap>
        </div>
        <FieldWrap label="Condition (CEL, optional)" htmlFor="au-cond" hint="Runs only when true, e.g. doc.grand_total > 100000.0">
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
        <FieldWrap label="Actions (JSON)" htmlFor="au-actions" hint="Values are CEL expressions: quote literal text, e.g. &quot;'Approved'&quot;.">
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
          <span className="muted">Insert template:</span>
          {Object.keys(TEMPLATES).map((t) => (
            <Button key={t} size="sm" icon="plus" onClick={() => addTemplate(t)}>
              {t}
            </Button>
          ))}
        </div>
        <label className="check-field">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Active
        </label>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save automation
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
    r.onerror = () => reject(r.error ?? new Error("Could not read the file"));
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
    publicCount ? `${publicCount} public` : null,
    m.http_hosts?.length ? `calls ${m.http_hosts.join(", ")}` : null,
  ].filter((x): x is string => !!x);
}

/** Everything a manifest asks for, worded for the administrator approving it. */
function PluginAccess({ m }: { m: PluginManifest }) {
  const rows: [string, ReactNode][] = [];
  if (m.permissions?.length)
    rows.push([
      "Records",
      m.permissions.map((p) => (
        <div key={p.entity}>
          <span className="mono">{p.entity}</span>: {VERBS.filter((v) => p[v]).join(", ") || "no access"}
        </div>
      )),
    ]);
  if (m.entities?.length) rows.push(["Brings entities", m.entities.map((e) => e.label ?? e.name).join(", ")]);
  if (m.hooks?.length) rows.push(["Runs on", m.hooks.map((h) => `${h.entity === "*" ? "every entity" : h.entity} · ${h.stage}`).join("; ")]);
  if (m.routes?.length)
    rows.push([
      "HTTP routes",
      m.routes.map((r) => (
        <div key={r.path}>
          <span className="mono">{r.path}</span> {r.public ? <Badge tone="amber">public</Badge> : <span className="faint">signed in</span>}
        </div>
      )),
    ]);
  if (m.sockets?.length)
    rows.push([
      "WebSockets",
      m.sockets.map((s) => (
        <div key={s.path}>
          <span className="mono">{s.path}</span> {s.public ? <Badge tone="amber">public</Badge> : <span className="faint">signed in</span>}
          {s.subprotocols?.length ? <span className="faint"> · {s.subprotocols.join(", ")}</span> : null}
        </div>
      )),
    ]);
  if (m.subscriptions?.length) rows.push(["Listens to", m.subscriptions.join(", ")]);
  if (m.schedules?.length) rows.push(["Schedules", m.schedules.map((s) => `${s.name} every ${Math.round(s.every_seconds / 60)} min`).join("; ")]);
  rows.push(["Calls out to", m.http_hosts?.length ? m.http_hosts.join(", ") : "nothing (no network access)"]);
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
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
    if (await attempt(() => api.put(`/api/admin/plugins/${p.id}/enabled`, { enabled: !p.enabled }), p.enabled ? `${p.name} disabled` : `${p.name} enabled`))
      await refresh();
    setPending(null);
  };
  const remove = async (p: Plugin) => {
    const ok = await confirmDialog({
      title: `Delete plugin ${p.name}?`,
      message: "It stops at once and its private data is removed. Records it created stay.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok && (await attempt(() => api.del(`/api/admin/plugins/${p.id}`), "Plugin deleted"))) void refresh();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Plugins</h2>
        <span className="spacer" />
        <Button variant="primary" icon="upload" onClick={() => setInstalling({})}>
          Install plugin
        </Button>
      </div>
      <Loaded q={q}>
        {(data) =>
          !data.plugins.length ? (
            <EmptyState title="No plugins installed" icon="settings">
              <p className="muted">Plugins add hooks, pages, device connections and integrations without changing Ferrum.</p>
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Plugin</th>
                    <th scope="col">Uses</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Enabled</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.plugins.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div>
                          <span className="mono">{p.name}</span> {p.version && <span className="faint">v{p.version}</span>}
                        </div>
                        {p.description && <div className="muted">{p.description}</div>}
                        <div className="mono faint" title={`SHA-256 ${p.sha256}`}>
                          {p.sha256.slice(0, 12)}…
                        </div>
                      </td>
                      <td>
                        <div className="chips">
                          {pluginUses(p.manifest).map((u) => (
                            <Badge key={u} tone={u.endsWith("public") ? "amber" : "blue"}>
                              {u}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="nowrap">{formatDateTime(p.updated_at)}</td>
                      <td>
                        <label className="check-field cell-check" style={{ minHeight: 0 }}>
                          <input type="checkbox" checked={p.enabled} disabled={pending === p.id} onChange={() => void toggle(p)} />
                          <span className="sr-only">{p.enabled ? "Disable" : "Enable"} {p.name}</span>
                        </label>
                      </td>
                      <td>
                        <div className="row" style={{ flexWrap: "nowrap" }}>
                          <Button size="sm" icon="settings" onClick={() => setSettings(p)}>
                            Settings
                          </Button>
                          <Button size="sm" icon="upload" onClick={() => setInstalling(p)}>
                            New version
                          </Button>
                          <Button size="sm" variant="danger" icon="trash" aria-label={`Delete plugin ${p.name}`} onClick={() => void remove(p)} />
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
    if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "The manifest must be a JSON object." };
    if (typeof (v as { name?: unknown }).name !== "string" || !(v as { name: string }).name.trim()) return { error: "The manifest needs a name." };
    return { manifest: v as Record<string, unknown> };
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}` };
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
    if (!parsed.manifest) return setMessage(parsed.error ?? "Check the manifest.");
    if (value?.id && parsed.manifest.name !== value.name) return setMessage(`A new version must keep the name ${value.name}.`);
    if (!file) return setMessage("Choose the plugin module (.wasm, or .wat text).");
    if (file.size > 8 * 1024 * 1024) return setMessage("Plugin modules are limited to 8 MB.");
    setBusy(true);
    setMessage(null);
    setFieldErrors([]);
    try {
      await api.post("/api/admin/plugins", { ...parsed.manifest, wasm_base64: await fileToBase64(file) });
      toast(`Plugin ${String(parsed.manifest.name)} installed`);
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
    <Dialog open={!!value} onClose={onClose} title={value?.id ? `New version of ${value.name}` : "Install plugin"} wide>
      <form className="stack" onSubmit={submit}>
        {message && (
          <Alert tone="error">
            {message}
            {fieldErrors.length > 0 && (
              <ul>
                {fieldErrors.map((f, i) => (
                  <li key={i}>
                    <span className="mono">{[f.row?.join("."), f.field].filter(Boolean).join(".")}</span>: {f.message}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <p className="muted">
          A plugin is a WebAssembly module and a manifest that declares what it may do. It runs sandboxed with only the access listed below; installing again with
          the same name upgrades it in place.
        </p>
        <div className="form-grid">
          <FieldWrap label="Module" htmlFor="pl-file" required>
            <input id="pl-file" type="file" accept=".wasm,.wat,application/wasm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </FieldWrap>
          <FieldWrap label="Manifest file" htmlFor="pl-manifest-file" hint="Optional: loads a manifest.json into the editor">
            <input id="pl-manifest-file" type="file" accept=".json,application/json" onChange={(e) => void loadManifest(e.target.files?.[0])} />
          </FieldWrap>
        </div>
        <FieldWrap label="Manifest" htmlFor="pl-manifest" error={parsed.error}>
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
            <h3 className="field-label">This plugin will be able to</h3>
            <PluginAccess m={parsed.manifest as PluginManifest} />
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon="upload" loading={busy} disabled={!parsed.manifest}>
            Install
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
          return setMessage(`The value of ${key} is not valid JSON.`);
        }
      } else config[key] = r.value;
    }
    if (!Object.keys(config).length) return onClose();
    setBusy(true);
    setMessage(null);
    try {
      await api.patch(`/api/admin/plugins/${plugin.id}/config`, { config });
      toast("Settings saved");
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
    <Dialog open={!!plugin} onClose={onClose} title={plugin ? `${plugin.name} settings` : ""} wide>
      <form className="stack" onSubmit={save}>
        {message && <Alert tone="error">{message}</Alert>}
        {plugin?.manifest && (
          <div>
            <h3 className="field-label">Access</h3>
            <PluginAccess m={plugin.manifest} />
          </div>
        )}
        <div>
          <h3 className="field-label">Settings</h3>
          <p className="muted">Saved values are never shown again. Enter a key to set or replace it.</p>
          {keys.length > 0 && (
            <div className="chips" style={{ margin: "8px 0" }}>
              {keys.map((k) => (
                <span key={k} className="chip-removable">
                  <span className="mono">{k}</span>
                  <button type="button" className="icon-btn" aria-label={`Remove setting ${k}`} onClick={() => setRemoved((r) => [...r, k])}>
                    <Icon name="x" size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {removed.length > 0 && <p className="faint">Removing on save: {removed.join(", ")}</p>}
          <div className="stack" style={{ gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
                <input
                  className="input mono"
                  aria-label={`Setting ${i + 1} key`}
                  placeholder="key"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={r.key}
                  onChange={(e) => setRow(i, { key: e.target.value })}
                />
                <input
                  className="input"
                  aria-label={`Setting ${i + 1} value`}
                  placeholder={r.json ? '{"json": true}' : "value"}
                  type={r.json ? "text" : "password"}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={r.value}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                />
                <label className="check-field nowrap" style={{ minHeight: 0 }}>
                  <input type="checkbox" checked={r.json} onChange={(e) => setRow(i, { json: e.target.checked })} /> JSON
                </label>
                <button type="button" className="icon-btn" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" icon="plus" style={{ marginTop: 8 }} onClick={() => setRows((rs) => [...rs, { key: "", value: "", json: false }])}>
            Add setting
          </Button>
        </div>
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

// ── API keys (the signed-in user's own; also reachable from the user menu) ──

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  last_used_at?: string | null;
}

export function ApiKeys() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["api-keys"], queryFn: ({ signal }) => api.get<{ keys: ApiKey[] }>("/api/auth/api_keys", undefined, signal) });
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
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
      });
      setCreated(res.key);
      setName("");
      setExpires("");
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (k: ApiKey) => {
    if (!(await confirmDialog({ title: `Revoke ${k.name}?`, message: "Integrations using this key stop working immediately.", confirmLabel: "Revoke", danger: true }))) return;
    if (await attempt(() => api.del(`/api/auth/api_keys/${k.id}`), "API key revoked")) void refresh();
  };

  return (
    <section className="card">
      <form className="toolbar" onSubmit={create} aria-label="Create an API key">
        <FieldWrap label="Key name" htmlFor="key-name" className="field-wide">
          <input id="key-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="e.g. Warehouse scanner" />
        </FieldWrap>
        <FieldWrap label="Expires (optional)" htmlFor="key-exp">
          <input id="key-exp" className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </FieldWrap>
        <Button type="submit" variant="primary" icon="plus" loading={busy}>
          Create key
        </Button>
      </form>
      {error && (
        <div className="card-body">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <Loaded q={q}>
        {(data) =>
          !data.keys.length ? (
            <EmptyState title="No API keys" icon="settings" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Key</th>
                    <th scope="col">Created</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Last used</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.keys.map((k) => (
                    <tr key={k.id}>
                      <td>
                        {k.name} {k.revoked_at && <Badge tone="red">revoked</Badge>}
                      </td>
                      <td className="mono">{k.prefix}</td>
                      <td className="nowrap">{formatDateTime(k.created_at)}</td>
                      <td className="nowrap">{k.expires_at ? formatDateTime(k.expires_at) : <span className="faint">never</span>}</td>
                      <td className="nowrap">{k.last_used_at ? relativeTime(k.last_used_at) : <span className="faint">never</span>}</td>
                      <td>
                        {!k.revoked_at && (
                          <Button size="sm" variant="danger" onClick={() => void revoke(k)}>
                            Revoke
                          </Button>
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
      <SecretDialog
        secret={created}
        title="Your new API key"
        note="Store this key now: it cannot be shown again. Send it as Authorization: Bearer <key>."
        onClose={() => setCreated(null)}
      />
    </section>
  );
}
