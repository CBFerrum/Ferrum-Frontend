// The accounts host (docs/plan/apps-ui.md §9.3, §12.3; shapes B and C): the person's Ferrum
// account, signed in to once for every workspace. Home lists their workspaces (and, once their
// address is proven, those with an account for it that they have yet to add) and keeps the
// account's password, passkeys, two-factor sign-in and browsers. Entering a workspace that needs
// the person shows the one step it needs: going on as this account, adding the workspace (proving
// once that its account is theirs), its single sign-on, two-factor sign-in, or no access.

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, KeyRound, LogOut, Plus } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { bootstrap, type EnterRequest } from "@ferrum/client";
import { ChangePasswordDialog } from "@/app/Shell";
import { TwoFactorSettings, TwoFactorSetup } from "@/app/TwoFactor";
import { api, errorMessage } from "@/lib/api";
import { Alert, Badge, Button, Field, Spinner } from "@/ui/kit";
import { Devices, Passkeys } from "./Account";
import "./shell.css";

interface Workspace {
  id: string;
  slug: string;
  name: string;
  host: string | null;
  url: string | null;
  joined: boolean;
  active: boolean;
  admin: boolean;
}

interface Mine {
  account: { id: string; email: string; name: string; verified: boolean; two_factor: boolean };
  workspaces: Workspace[];
  region: string;
}

/** What a step answers: on to the workspace's host, or the step it needs next. */
interface Onward {
  redirect?: string;
  need?: EnterRequest["need"];
  join?: EnterRequest["join"];
}

type Step = Pick<EnterRequest, "need" | "join">;

const here = () => location.pathname + location.search;

/** Signs this browser out of the Ferrum account, then on to `then`. */
async function signOut(then = "/login") {
  try {
    await api.post("/api/auth/logout", undefined, { noAuthRedirect: true });
  } catch {
    // Signed out already, or the server is away: the sign-in page says which.
  }
  location.assign(then);
}

/** Another account: signs out here, and signs in again on the way back to this step. */
const anotherAccount = () => void signOut(`/login?next=${encodeURIComponent(here())}`);

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/** A workspace's monogram, coloured by its name: the same workspace looks the same everywhere. */
function Monogram({ name, size = 40 }: { name: string; size?: number }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="acct-mono" style={{ width: size, height: size, background: `oklch(0.6 0.13 ${hue})`, fontSize: Math.round(size * 0.4) }} aria-hidden>
      {initials(name)}
    </span>
  );
}

function Top() {
  const person = bootstrap()?.person;
  return (
    <header className="acct-top">
      <a className="acct-brand" href="/">
        <img src="/_shell/v1/icon.svg" alt="" width={26} height={26} />
        <span>Ferrum</span>
      </a>
      {person && (
        <div className="acct-who">
          <span className="acct-avatar" aria-hidden>
            {initials(person.name)}
          </span>
          <span className="acct-who-text">
            <strong>{person.name}</strong>
            <span>{person.email}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => void signOut()} aria-label="Sign out">
            <LogOut size={15} aria-hidden />
            <span className="acct-hide-small">Sign out</span>
          </Button>
        </div>
      )}
    </header>
  );
}

export function AccountsPage() {
  const request = bootstrap()?.request;
  return (
    <div className="acct">
      <Top />
      {request ? <Enter request={request} /> : <Home />}
    </div>
  );
}

// ───────────────────────── home ─────────────────────────

function WorkspaceRow({ w }: { w: Workspace }) {
  return (
    <li className="acct-row">
      <Monogram name={w.name} />
      <div className="acct-row-text">
        <strong>{w.name}</strong>
        <span>{w.host ?? "No address yet"}</span>
      </div>
      <div className="acct-row-actions">
        {w.admin && w.joined && <Badge tone="blue">Admin</Badge>}
        {!w.active && <Badge tone="neutral">Turned off</Badge>}
        {w.url && w.active && (
          <a className="btn btn-default btn-sm" href={w.url} aria-label={`${w.joined ? "Open" : "Add"} ${w.name}`}>
            {w.joined ? (
              <>
                Open <ArrowRight size={14} aria-hidden />
              </>
            ) : (
              <>
                <Plus size={14} aria-hidden /> Add
              </>
            )}
          </a>
        )}
      </div>
    </li>
  );
}

function Card({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="acct-card" aria-labelledby={id}>
      <div className="acct-card-head">
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Home() {
  const q = useQuery({ queryKey: ["accounts-me"], queryFn: ({ signal }) => api.get<Mine>("/api/accounts/me", undefined, signal) });
  const [password, setPassword] = useState(false);
  if (q.error)
    return (
      <main className="acct-main" id="main">
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      </main>
    );
  if (!q.data)
    return (
      <main className="acct-main" id="main">
        <Spinner label="Loading your account" />
      </main>
    );
  const { account, workspaces, region } = q.data;
  const joined = workspaces.filter((w) => w.joined);
  const more = workspaces.filter((w) => !w.joined);
  const first = (account.name || account.email).split(/[\s@]/)[0];
  return (
    <main className="acct-main" id="main">
      <div className="acct-hello">
        <h1>Hello, {first}</h1>
        <p>One account for every workspace you belong to: sign in once, and go anywhere.</p>
      </div>
      <Card id="acct-ws" title="Your workspaces" aside={region ? <Badge tone="neutral">{region.toUpperCase()}</Badge> : undefined}>
        {joined.length === 0 ? (
          <p className="acct-quiet">
            No workspace yet. Open a workspace's address to add it, or ask its administrator to add {account.email}.
          </p>
        ) : (
          <ul className="acct-list">
            {joined.map((w) => (
              <WorkspaceRow key={w.id} w={w} />
            ))}
          </ul>
        )}
        {more.length > 0 && (
          <>
            <h3 className="acct-sub">Also for {account.email}</h3>
            <p className="acct-quiet">These workspaces have an account for your address. Add one to go in with your Ferrum account.</p>
            <ul className="acct-list">
              {more.map((w) => (
                <WorkspaceRow key={w.id} w={w} />
              ))}
            </ul>
          </>
        )}
      </Card>
      <Card id="acct-signin" title="Signing in">
        <div className="acct-line">
          <KeyRound size={18} aria-hidden />
          <div>
            <strong>Password</strong>
            <span>The one for every workspace you added.</span>
          </div>
          <Button size="sm" onClick={() => setPassword(true)}>
            Change
          </Button>
        </div>
        <h3 className="acct-sub">Passkeys</h3>
        <Passkeys />
        <h3 className="acct-sub">Two-factor sign-in</h3>
        <TwoFactorSettings />
      </Card>
      <Card id="acct-devices" title="Signed-in browsers">
        <Devices
          signOutHere={() => void signOut()}
          everywhere={{
            path: "/api/accounts/sign-out-everywhere",
            message: "Every browser and app signed in to your Ferrum account, or to any workspace you added, is signed out, this one too.",
          }}
        />
      </Card>
      <ChangePasswordDialog open={password} onClose={() => setPassword(false)} onSignedOut={() => location.assign("/login")} />
    </main>
  );
}

// ───────────────────────── entering a workspace ─────────────────────────

const HEADINGS: Record<EnterRequest["need"], (name: string) => string> = {
  continue: (name) => `Continue to ${name}`,
  join: (name) => `Add ${name} to your account`,
  sso: (name) => `Sign in to ${name}`,
  two_factor: (name) => `${name} asks for two-factor sign-in`,
  no_access: (name) => `No access to ${name}`,
};

function Enter({ request }: { request: EnterRequest }) {
  const [step, setStep] = useState<Step>({ need: request.need, join: request.join });
  const ws = request.workspace;
  /** On to the workspace, or to the step it needs next; whether the page is leaving. */
  const go = (r: Onward): boolean => {
    if (r.redirect) {
      location.assign(r.redirect);
      return true;
    }
    if (r.need) setStep({ need: r.need, join: r.join });
    return false;
  };
  return (
    <main className="acct-step" id="main">
      <div className="acct-step-card">
        <div className="acct-step-head">
          <Monogram name={ws.name} size={48} />
          <div>
            <p className="acct-kicker">{request.host}</p>
            <h1>{HEADINGS[step.need](ws.name)}</h1>
          </div>
        </div>
        {step.need === "continue" && <Continue request={request} go={go} />}
        {step.need === "join" && step.join && <Join request={request} join={step.join} go={go} />}
        {step.need === "sso" && <Sso request={request} />}
        {step.need === "two_factor" && <TwoStep request={request} go={go} />}
        {step.need === "no_access" && <NoAccess request={request} />}
      </div>
    </main>
  );
}

type StepProps = { request: EnterRequest; go: (r: Onward) => boolean };

function useOnward(request: EnterRequest, go: StepProps["go"]) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (path: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try {
      if (!go(await api.post<Onward>(path, { host: request.host, state: request.state, ...body }))) setBusy(false);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function Continue({ request, go }: StepProps) {
  const { busy, error, run } = useOnward(request, go);
  const email = bootstrap()?.person?.email;
  return (
    <>
      <p className="acct-quiet">
        You are signed in as <strong>{email}</strong>.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="acct-actions">
        <Button variant="primary" loading={busy} onClick={() => void run("/api/accounts/continue")}>
          Continue to {request.workspace.name}
        </Button>
        <Button variant="ghost" onClick={anotherAccount}>
          Use another account
        </Button>
      </div>
    </>
  );
}

/** Adding the workspace: confirming (an address already proven), its password, or a code sent to
 *  the address; its authenticator code too when its account has one. */
function Join({ request, join, go }: StepProps & { join: NonNullable<EnterRequest["join"]> }) {
  const { busy, error, setError, run } = useOnward(request, go);
  const mail = !!bootstrap()?.accounts?.mail;
  const email = bootstrap()?.person?.email;
  const ws = request.workspace;
  const [how, setHow] = useState<"password" | "code">(join.password || !mail ? "password" : "code");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState("");
  const sso = useQuery({
    queryKey: ["sso", ws.slug],
    queryFn: ({ signal }) => api.get<{ providers: { id: string; name?: string }[] }>("/api/auth/sso", { tenant: ws.slug }, signal),
  });
  const sendCode = async () => {
    setSending(true);
    setError(null);
    try {
      await api.post("/api/accounts/join/code", { host: request.host });
      setHow("code");
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run("/api/accounts/join", { ...(how === "password" ? { password } : { code }), ...(join.two_factor ? { totp } : {}) });
  };
  const providers = sso.data?.providers ?? [];
  return (
    <>
      <p className="acct-quiet">
        {ws.name} has an account for <strong>{email}</strong>. Show it is yours once; from then on you go in with your Ferrum account.
      </p>
      {join.click ? (
        <>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="acct-actions">
            <Button variant="primary" loading={busy} onClick={() => void run("/api/accounts/join")}>
              Add {ws.name} and continue
            </Button>
          </div>
        </>
      ) : (
        <form className="stack" onSubmit={submit}>
          {how === "password" ? (
            <Field label={`Your password at ${ws.name}`} htmlFor="join-password" required>
              <input id="join-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            </Field>
          ) : sent ? (
            <Field label="Code from the email" htmlFor="join-code" required hint={`We sent it to ${email}. It works for 15 minutes.`}>
              <input id="join-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
            </Field>
          ) : (
            <p className="acct-quiet">We will email a code to {email}.</p>
          )}
          {join.two_factor && (how === "password" || sent) && (
            <Field label={`Code from your ${ws.name} authenticator app`} htmlFor="join-totp" required>
              <input id="join-totp" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={totp} onChange={(e) => setTotp(e.target.value)} required />
            </Field>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <div className="acct-actions">
            {how === "code" && !sent ? (
              <Button variant="primary" loading={sending} onClick={() => void sendCode()}>
                Email me a code
              </Button>
            ) : (
              <Button type="submit" variant="primary" loading={busy}>
                Add {ws.name} and continue
              </Button>
            )}
          </div>
          {mail && how === "password" && (
            <button type="button" className="acct-link" onClick={() => void sendCode()} disabled={sending}>
              Email me a code instead
            </button>
          )}
          {how === "code" && join.password && (
            <button type="button" className="acct-link" onClick={() => setHow("password")}>
              Use the password instead
            </button>
          )}
        </form>
      )}
      {providers.length > 0 && (
        <a className="btn btn-default btn-md" href={`/login?sso=1&next=${encodeURIComponent(here())}`}>
          Use {providers.length === 1 ? (providers[0].name ?? "single sign-on") : "single sign-on"}
        </a>
      )}
      <button type="button" className="acct-link" onClick={anotherAccount}>
        Use another account
      </button>
    </>
  );
}

function Sso({ request }: { request: EnterRequest }) {
  return (
    <>
      <p className="acct-quiet">{request.workspace.name} signs its people in through its own single sign-on.</p>
      <div className="acct-actions">
        <a className="btn btn-primary btn-md" href={`/login?sso=1&next=${encodeURIComponent(here())}`}>
          Continue with single sign-on
        </a>
        <Button variant="ghost" onClick={anotherAccount}>
          Use another account
        </Button>
      </div>
    </>
  );
}

function TwoStep({ request, go }: StepProps) {
  const { error, run } = useOnward(request, go);
  const [setting, setSetting] = useState(false);
  if (setting) return <TwoFactorSetup onEnabled={() => void run("/api/accounts/continue")} onCancel={() => setSetting(false)} />;
  return (
    <>
      <p className="acct-quiet">
        {request.workspace.name} asks everyone to sign in with two factors: the password, then a code from an app on your phone. Turn it on for
        your Ferrum account to go on; it then guards every workspace you have.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="acct-actions">
        <Button variant="primary" onClick={() => setSetting(true)}>
          Turn on two-factor sign-in
        </Button>
        <Button variant="ghost" onClick={anotherAccount}>
          Use another account
        </Button>
      </div>
    </>
  );
}

function NoAccess({ request }: { request: EnterRequest }) {
  const email = bootstrap()?.person?.email;
  return (
    <>
      <p className="acct-quiet">
        <strong>{email}</strong> has no account at {request.workspace.name}. Ask one of its administrators to add you, or use another account.
      </p>
      <div className="acct-actions">
        <Button variant="primary" onClick={anotherAccount}>
          Use another account
        </Button>
        <a className="btn btn-default btn-md" href="/">
          Your workspaces
        </a>
      </div>
    </>
  );
}
