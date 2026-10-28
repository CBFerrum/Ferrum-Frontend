import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { api, errorMessage, setSession } from "../lib/api";
import { Alert, Button, Field } from "../ui/kit";

const TENANT_KEY = "ferrum.tenant";

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
  const from = (location.state as { from?: string } | null)?.from;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = tenant.trim();
      const res = await api.post<{ token: string }>(
        "/api/auth/login",
        { tenant: t, email: email.trim(), password },
        { noAuthRedirect: true },
      );
      setSession({ token: res.token, tenant: t, email: email.trim() });
      try {
        localStorage.setItem(TENANT_KEY, t);
      } catch {
        // convenience only
      }
      qc.clear();
      navigate(from && !from.startsWith("/login") ? from : "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err, false));
      setBusy(false);
    }
  };

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
