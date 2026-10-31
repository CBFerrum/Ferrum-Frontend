// The person's account (docs/plan/apps-ui.md §8): who they are, their password, passkeys and
// two-factor sign-in, the browsers signed in as them (each signed out on its own), API keys and app
// passwords, and connecting an AI assistant.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { shell } from "@ferrum/client";
import { ApiKeys, CalendarApps } from "@/app/Admin";
import { ChangePasswordDialog, ConnectAi } from "@/app/Shell";
import { TwoFactorSettings } from "@/app/TwoFactor";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatDateTime, relativeTime } from "@/lib/format";
import { useMe, useMetaIndex } from "@/lib/meta";
import { Badge, Button, confirmDialog, Dialog, Field, Spinner, toast } from "@/ui/kit";
import "./shell.css";

interface Device {
  id: string;
  created_at: string;
  last_seen_at: string;
  user_agent: string;
  ip: string;
  current: boolean;
}

/** A browser's name from its user agent, for people (not a precise parse). */
export function browserName(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** The browsers signed in as the person, each signed out on its own. The accounts host signs this
 *  browser out itself and signs out everywhere for every workspace too (`everywhere`). */
export function Devices({
  signOutHere = () => shell().session.signOut(),
  everywhere = { path: "/api/auth/logout_all", message: "Every browser and app signed in as you is signed out, this one too. API keys keep working." },
}: {
  signOutHere?: () => void;
  everywhere?: { path: string; message: string };
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sessions"], queryFn: ({ signal }) => api.get<{ sessions: Device[] }>("/api/auth/sessions", undefined, signal) });
  const signOut = async (d: Device) => {
    if (d.current) {
      signOutHere();
      return;
    }
    try {
      await api.del(`/api/auth/sessions/${d.id}`);
      toast(`${browserName(d.user_agent)} is signed out`);
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const signOutEverywhere = async () => {
    const ok = await confirmDialog({
      title: "Sign out everywhere?",
      message: everywhere.message,
      confirmLabel: "Sign out everywhere",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(everywhere.path);
      location.assign("/login");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  if (q.error) return <p className="muted">{errorMessage(q.error)}</p>;
  if (!q.data) return <Spinner label="Loading your devices" />;
  return (
    <>
      <table className="shell-devices">
        <thead>
          <tr>
            <th scope="col">Browser</th>
            <th scope="col">Last active</th>
            <th scope="col">Signed in</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {q.data.sessions.map((d) => (
            <tr key={d.id}>
              <td>
                {browserName(d.user_agent)} {d.current && <Badge tone="green">This one</Badge>}
                <div className="faint">{d.ip}</div>
              </td>
              <td title={formatDateTime(d.last_seen_at)}>{relativeTime(d.last_seen_at)}</td>
              <td>{formatDateTime(d.created_at)}</td>
              <td>
                <Button size="sm" onClick={() => void signOut(d)}>
                  Sign out
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <Button size="sm" variant="danger" onClick={() => void signOutEverywhere()}>
          Sign out everywhere
        </Button>
      </div>
    </>
  );
}

interface Passkey {
  id: string;
  name: string;
  rp_id: string;
  created_at: string;
  last_used_at: string | null;
}

interface CreationOptions {
  request: string;
  publicKey: Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
    challenge: string;
    user: { id: string; name: string; displayName: string };
    excludeCredentials: { type: "public-key"; id: string }[];
  };
}

/** Passkeys travel as base64url; the browser speaks ArrayBuffers. */
export const b64 = {
  decode: (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
  encode: (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
};

/** The person confirms their password (and authenticator code) before changing how they sign in. */
function ConfirmItsYou({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/step-up", { password, code: needsCode ? code : undefined });
      setPassword("");
      setCode("");
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields.some((f) => f.field === "code")) setNeedsCode(true);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Confirm it is you"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="step-up-form" loading={busy}>
            Confirm
          </Button>
        </>
      }
    >
      <form id="step-up-form" className="stack" onSubmit={submit}>
        <p className="muted">Changing how you sign in needs your password, as you signed in a while ago.</p>
        <Field label="Password" htmlFor="step-up-password" error={error ?? undefined}>
          <input id="step-up-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </Field>
        {needsCode && (
          <Field label="Code from your authenticator app" htmlFor="step-up-code">
            <input id="step-up-code" className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        )}
      </form>
    </Dialog>
  );
}

/** The passkeys the person keeps: each signs them in, on the address it was made on, without an
 *  email or a password; the device checks it is them (a fingerprint, a face, the device's PIN). */
export function Passkeys() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["passkeys"], queryFn: ({ signal }) => api.get<{ passkeys: Passkey[] }>("/api/auth/passkeys", undefined, signal) });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [name, setName] = useState("");
  const supported = typeof window !== "undefined" && !!window.PublicKeyCredential && window.isSecureContext;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["passkeys"] });

  const make = async () => {
    setBusy(true);
    try {
      let options: CreationOptions;
      try {
        options = await api.post<CreationOptions>("/api/auth/passkeys/options");
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          setConfirming(true);
          return;
        }
        throw e;
      }
      const pk = options.publicKey;
      const cred = (await navigator.credentials.create({
        publicKey: {
          ...pk,
          challenge: b64.decode(pk.challenge),
          user: { ...pk.user, id: b64.decode(pk.user.id) },
          excludeCredentials: pk.excludeCredentials.map((c) => ({ ...c, id: b64.decode(c.id) })),
        },
      })) as PublicKeyCredential | null;
      if (!cred) return;
      const r = cred.response as AuthenticatorAttestationResponse;
      const response = { clientDataJSON: b64.encode(r.clientDataJSON), attestationObject: b64.encode(r.attestationObject), transports: r.getTransports?.() ?? [] };
      await api.post("/api/auth/passkeys", { request: options.request, name: browserName(navigator.userAgent), credential: { id: cred.id, rawId: b64.encode(cred.rawId), type: cred.type, response } });
      toast("Passkey added: next time, sign in with it");
      refresh();
    } catch (e) {
      const kind = (e as { name?: string } | null)?.name;
      if (kind === "NotAllowedError" || kind === "AbortError") toast("No passkey was made", "info");
      else if (kind === "InvalidStateError") toast("This device already keeps a passkey for you", "info");
      else toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p: Passkey) => {
    const ok = await confirmDialog({ title: `Remove “${p.name}”?`, message: "It no longer signs you in. Remove it from the device too, in its settings.", confirmLabel: "Remove", danger: true });
    if (!ok) return;
    try {
      await api.del(`/api/auth/passkeys/${p.id}`);
      toast("Passkey removed");
      refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    try {
      await api.patch(`/api/auth/passkeys/${renaming.id}`, { name });
      setRenaming(null);
      refresh();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };
  if (q.error) return <p className="muted">{errorMessage(q.error)}</p>;
  if (!q.data) return <Spinner label="Loading your passkeys" />;
  const here = location.hostname;
  return (
    <>
      <p className="muted">Sign in with your fingerprint, face or device PIN instead of a password. A passkey works on the address it was made on.</p>
      {q.data.passkeys.length > 0 && (
        <table className="shell-devices">
          <thead>
            <tr>
              <th scope="col">Passkey</th>
              <th scope="col">Last used</th>
              <th scope="col">Added</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {q.data.passkeys.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name} {p.rp_id !== here && <Badge tone="neutral">{p.rp_id}</Badge>}
                </td>
                <td>{p.last_used_at ? relativeTime(p.last_used_at) : "Not yet"}</td>
                <td>{formatDateTime(p.created_at)}</td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setName(p.name);
                      setRenaming(p);
                    }}
                  >
                    Rename
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(p)}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div>
        {supported ? (
          <Button onClick={() => void make()} loading={busy}>
            Add a passkey
          </Button>
        ) : (
          <p className="muted">This browser cannot make passkeys here (they need a secure address).</p>
        )}
      </div>
      <ConfirmItsYou
        open={confirming}
        onClose={() => setConfirming(false)}
        onDone={() => {
          setConfirming(false);
          void make();
        }}
      />
      <Dialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename passkey"
        footer={
          <>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="primary" type="submit" form="passkey-name-form">
              Save
            </Button>
          </>
        }
      >
        <form id="passkey-name-form" onSubmit={rename}>
          <Field label="Name" htmlFor="passkey-name">
            <input id="passkey-name" className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="card" aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id}>{title}</h2>
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

export function AccountPage() {
  const me = useMe().data;
  const comms = !!useMetaIndex().data?.packages.includes("comms");
  const [password, setPassword] = useState(false);
  return (
    <div className="shell-account">
      <div className="page-head">
        <div>
          <h1 className="page-title">Your account</h1>
          <p className="page-sub">{me ? `${me.user.full_name} · ${me.user.email}` : "…"}</p>
        </div>
      </div>
      {me?.accounts ? (
        <Section id="acct-signin" title="Signing in">
          <p className="muted">
            You sign in with your Ferrum account, {me.user.email}. Its password, two-step sign-in and passkeys work for every workspace you have.
          </p>
          <div>
            <a className="btn btn-default btn-md" href={`${me.accounts}/`}>
              Manage your Ferrum account
            </a>
          </div>
        </Section>
      ) : (
        <>
          <Section id="acct-password" title="Password">
            <div>
              <Button onClick={() => setPassword(true)}>Change password</Button>
            </div>
          </Section>
          <Section id="acct-passkeys" title="Passkeys">
            <Passkeys />
          </Section>
          <Section id="acct-2fa" title="Two-factor sign-in">
            <TwoFactorSettings />
          </Section>
        </>
      )}
      <Section id="acct-devices" title="Signed-in browsers">
        <Devices />
      </Section>
      <Section id="acct-keys" title="API keys">
        <ApiKeys />
      </Section>
      {comms && (
        <Section id="acct-cal" title="Calendar and contacts apps">
          <CalendarApps email={me?.user.email ?? ""} />
        </Section>
      )}
      <Section id="acct-ai" title="Connect an AI assistant">
        <ConnectAi />
      </Section>
      <ChangePasswordDialog open={password} onClose={() => setPassword(false)} onSignedOut={() => location.assign("/login")} />
    </div>
  );
}
