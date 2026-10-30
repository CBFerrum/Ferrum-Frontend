// The person's account (docs/plan/apps-ui.md §8): who they are, their password and two-factor
// sign-in, the browsers signed in as them (each signed out on its own), API keys and app passwords,
// and connecting an AI assistant.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { shell } from "@ferrum/client";
import { ApiKeys, CalendarApps } from "@/app/Admin";
import { ChangePasswordDialog, ConnectAi } from "@/app/Shell";
import { TwoFactorSettings } from "@/app/TwoFactor";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, relativeTime } from "@/lib/format";
import { useMe, useMetaIndex } from "@/lib/meta";
import { Badge, Button, confirmDialog, Spinner, toast } from "@/ui/kit";
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

function Devices() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sessions"], queryFn: ({ signal }) => api.get<{ sessions: Device[] }>("/api/auth/sessions", undefined, signal) });
  const signOut = async (d: Device) => {
    if (d.current) {
      shell().session.signOut();
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
  const everywhere = async () => {
    const ok = await confirmDialog({
      title: "Sign out everywhere?",
      message: "Every browser and app signed in as you is signed out, this one too. API keys keep working.",
      confirmLabel: "Sign out everywhere",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post("/api/auth/logout_all");
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
        <Button size="sm" variant="danger" onClick={() => void everywhere()}>
          Sign out everywhere
        </Button>
      </div>
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
      <Section id="acct-password" title="Password">
        <div>
          <Button onClick={() => setPassword(true)}>Change password</Button>
        </div>
      </Section>
      <Section id="acct-2fa" title="Two-factor sign-in">
        <TwoFactorSettings />
      </Section>
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
