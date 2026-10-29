import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { api, errorMessage, setSession } from "../lib/api";
import { Alert, Button, Field } from "../ui/kit";
import { CodeInput, TwoFactorSetup } from "./TwoFactor";

const TENANT_KEY = "ferrum.tenant";

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
  const from = (location.state as { from?: string } | null)?.from;

  const finish = (token: string) => {
    const t = tenant.trim();
    setSession({ token, tenant: t, email: email.trim() });
    try {
      localStorage.setItem(TENANT_KEY, t);
    } catch {
      // convenience only
    }
    qc.clear();
    navigate(from && !from.startsWith("/login") ? from : "/", { replace: true });
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
        </div>
      </form>
    </div>
  );
}
