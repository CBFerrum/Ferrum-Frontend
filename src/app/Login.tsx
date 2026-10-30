import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { api, errorMessage, request, setSession } from "../lib/api";
import { newHome } from "../lib/shellv2";
import { Alert, Button, Field, useDebounced } from "../ui/kit";
import { ssoRedirectUri } from "../lib/sso";
import { CodeInput, TwoFactorSetup } from "./TwoFactor";

const TENANT_KEY = "ferrum.tenant";
/** A single sign-on in progress in this tab: the secret that binds it to this browser. */
const SSO_KEY = "ferrum.sso";

interface SsoOption {
  id: string;
  label: string;
}
interface SsoPending {
  binding: string;
  tenant: string;
  from?: string;
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the password step answers: a session, a ticket for the second step, or a session that may
 *  only set up two-factor sign-in. */
interface LoginResponse {
  token?: string;
  second_factor?: boolean;
  ticket?: string;
  two_factor_setup?: boolean;
}

function rememberedTenant(): string {
  try {
    return localStorage.getItem(TENANT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [tenant, setTenant] = useState(rememberedTenant);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [providers, setProviders] = useState<SsoOption[]>([]);
  const from = (location.state as { from?: string } | null)?.from;
  const workspace = useDebounced(tenant.trim().toLowerCase(), 300);

  const finish = (token: string, t = tenant.trim(), who = email.trim(), back = from) => {
    setSession({ token, tenant: t, email: who });
    try {
      localStorage.setItem(TENANT_KEY, t);
    } catch {
      // convenience only
    }
    qc.clear();
    const to = back && !back.startsWith("/login") ? back : "/";
    // A workspace on the shell: its new pages, where they have a home.
    void api
      .get<{ shell_v2?: boolean }>("/api/auth/me")
      .then((me) => {
        const home = me.shell_v2 ? newHome(to.split("?")[0], to.includes("?") ? `?${to.split("?")[1]}` : "") : null;
        if (home) window.location.replace(home);
        else navigate(to, { replace: true });
      })
      .catch(() => navigate(to, { replace: true }));
  };

  // The workspace's single sign-on buttons.
  useEffect(() => {
    if (!workspace) return setProviders([]);
    let live = true;
    api
      .get<{ providers: SsoOption[] }>("/api/auth/sso", { tenant: workspace })
      .then((r) => live && setProviders(r.providers))
      .catch(() => live && setProviders([]));
    return () => {
      live = false;
    };
  }, [workspace]);

  // Back from the provider: finish the sign-in this tab started.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const [code, state, refused] = [q.get("code"), q.get("state"), q.get("error")];
    if (!code && !refused) return;
    navigate({ pathname: location.pathname, search: "" }, { replace: true, state: location.state });
    let pending: SsoPending | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(SSO_KEY) ?? "null") as SsoPending | null;
      sessionStorage.removeItem(SSO_KEY);
    } catch {
      // no storage: the sign-in cannot be finished here
    }
    if (refused) return setError(q.get("error_description") || "The sign-in was cancelled or refused at the provider.");
    if (!pending || !state || !code) return setError("That sign-in was started in another tab or browser; start it again here.");
    const p = pending;
    setTenant(p.tenant);
    setBusy(true);
    (async () => {
      try {
        const res = await api.post<{ token: string }>("/api/auth/sso/finish", { state, code, binding: p.binding }, { noAuthRedirect: true });
        const me = await request<{ user: { email: string } }>("/api/auth/me", { token: res.token, noAuthRedirect: true });
        finish(res.token, p.tenant, me.user.email, p.from);
      } catch (err) {
        setError(errorMessage(err, false));
        setBusy(false);
      }
    })();
    // Runs once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSso = async (provider: SsoOption) => {
    setBusy(true);
    setError(null);
    const pending: SsoPending = { binding: randomToken(), tenant: tenant.trim(), from };
    try {
      sessionStorage.setItem(SSO_KEY, JSON.stringify(pending));
      const res = await api.post<{ url: string }>(
        "/api/auth/sso/start",
        { tenant: pending.tenant, provider: provider.id, redirect_uri: ssoRedirectUri(), binding: pending.binding },
        { noAuthRedirect: true },
      );
      window.location.assign(res.url);
    } catch (err) {
      setError(errorMessage(err, false));
      setBusy(false);
    }
  };
  const restart = (message: string | null) => {
    setTicket(null);
    setSetupToken(null);
    setCode("");
    setPassword("");
    setError(message);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<LoginResponse>("/api/auth/login", { tenant: tenant.trim(), email: email.trim(), password }, { noAuthRedirect: true });
      setBusy(false);
      if (res.second_factor && res.ticket) setTicket(res.ticket);
      else if (res.two_factor_setup && res.token) setSetupToken(res.token);
      else if (res.token) finish(res.token);
    } catch (err) {
      setError(errorMessage(err, false));
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string }>("/api/auth/login/second-factor", { ticket, code: code.trim() }, { noAuthRedirect: true });
      finish(res.token);
    } catch (err) {
      const message = errorMessage(err, false);
      // An expired ticket, or a password changed meanwhile: start over.
      if (message === "sign in again") restart("That took too long; sign in again.");
      else setError(message);
      setBusy(false);
    }
  };

  if (setupToken)
    return (
      <div className="login">
        <div className="card login-card" aria-labelledby="login-title">
          <div className="card-head">
            <h1 id="login-title" style={{ fontSize: 17 }}>
              Set up two-factor sign-in
            </h1>
          </div>
          <div className="card-body">
            <Alert tone="info">Your workspace requires a code from an authenticator app at every sign-in.</Alert>
            <TwoFactorSetup
              token={setupToken}
              onCancel={() => restart(null)}
              onEnabled={(res) => (res.token ? finish(res.token) : restart("Two-factor sign-in is on; sign in again."))}
            />
          </div>
        </div>
      </div>
    );

  if (ticket)
    return (
      <div className="login">
        <form className="card login-card" onSubmit={submitCode} aria-labelledby="login-title">
          <div className="card-head">
            <h1 id="login-title" style={{ fontSize: 17 }}>
              Two-factor sign-in
            </h1>
          </div>
          <div className="card-body">
            {error && <Alert tone="error">{error}</Alert>}
            <Field
              label={recovery ? "Recovery code" : "Code from your authenticator app"}
              htmlFor="login-code"
              required
              hint={recovery ? "Each recovery code works once." : undefined}
            >
              <CodeInput key={String(recovery)} id="login-code" value={code} onChange={setCode} recovery={recovery} />
            </Field>
            <Button type="submit" variant="primary" loading={busy}>
              Verify
            </Button>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Button
                variant="ghost"
                onClick={() => {
                  setRecovery(!recovery);
                  setCode("");
                }}
              >
                {recovery ? "Use the app instead" : "Use a recovery code"}
              </Button>
              <Button variant="ghost" onClick={() => restart(null)}>
                Back
              </Button>
            </div>
          </div>
        </form>
      </div>
    );

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit} aria-labelledby="login-title">
        <div className="card-head">
          <span className="brand-mark" aria-hidden="true">
            Fe
          </span>
          <h1 id="login-title" style={{ fontSize: 17 }}>
            Sign in to Ferrum
          </h1>
        </div>
        <div className="card-body">
          {from && !error && <Alert tone="info">Please sign in to continue.</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Workspace" htmlFor="login-tenant" required>
            <input
              id="login-tenant"
              className="input"
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              autoComplete="organization"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              autoFocus={!tenant}
            />
          </Field>
          <Field label="Email" htmlFor="login-email" required>
            <input
              id="login-email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus={!!tenant}
            />
          </Field>
          <Field label="Password" htmlFor="login-password" required>
            <input
              id="login-password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Sign in
          </Button>
          {providers.length > 0 && (
            <>
              <div className="login-or" role="separator">
                or
              </div>
              {providers.map((p) => (
                <Button key={p.id} disabled={busy} onClick={() => void startSso(p)}>
                  Continue with {p.label}
                </Button>
              ))}
            </>
          )}
        </div>
      </form>
    </div>
  );
}
