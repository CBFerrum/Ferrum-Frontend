import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { api, errorMessage, getSession } from "../lib/api";
import { Alert, Button, Spinner } from "../ui/kit";

interface Client {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}

/** Loopback redirects may use any port (RFC 8252); everything else must match exactly. */
function registered(client: Client, uri: string): boolean {
  const parse = (u: string) => {
    try {
      return new URL(u);
    } catch {
      return null;
    }
  };
  const given = parse(uri);
  const loopback = (u: URL) => u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return client.redirect_uris.some((r) => {
    if (r === uri) return true;
    const reg = parse(r);
    return !!reg && !!given && loopback(reg) && loopback(given) && reg.hostname === given.hostname && reg.pathname === given.pathname && reg.search === given.search;
  });
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host || uri;
  } catch {
    return uri;
  }
}

function withParams(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * OAuth 2.1 consent: an AI assistant or app asks to act as the signed-in user. The server issues
 * a one-time code bound to the client's PKCE challenge; the browser carries it back to the client.
 */
export function OAuthAuthorize() {
  const [params] = useSearchParams();
  const location = useLocation();
  const session = getSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const challenge = params.get("code_challenge") ?? "";
  const method = params.get("code_challenge_method") ?? "S256";

  const client = useQuery({
    queryKey: ["oauth-client", clientId],
    queryFn: () => api.get<Client>(`/api/oauth/clients/${encodeURIComponent(clientId)}`),
    enabled: !!clientId,
  });

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  const problem =
    params.get("response_type") !== "code"
      ? "This sign-in link is not valid (response_type must be code)."
      : !clientId || !redirectUri || !challenge
        ? "This sign-in link is incomplete (client_id, redirect_uri and code_challenge are required)."
        : method !== "S256"
          ? "This app uses an unsupported sign-in method (PKCE S256 is required)."
          : client.data && !registered(client.data, redirectUri)
            ? "This app asked to return to an address it did not register. For your safety, nothing was shared."
            : null;

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ redirect_to: string }>("/api/oauth/authorize", {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: method,
        state,
      });
      window.location.assign(res.redirect_to);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const deny = () => {
    window.location.assign(withParams(redirectUri, { error: "access_denied", state }));
  };

  return (
    <div className="login">
      <div className="card login-card" role="dialog" aria-labelledby="oauth-title">
        <div className="card-head">
          <span className="brand-mark" aria-hidden="true">
            Fe
          </span>
          <h1 id="oauth-title" style={{ fontSize: 17 }}>
            Allow access to Ferrum?
          </h1>
        </div>
        <div className="card-body">
          {client.isLoading && <Spinner label="Loading" />}
          {client.isError && <Alert tone="error">This app is not registered with Ferrum ({errorMessage(client.error, false)}).</Alert>}
          {problem && client.isSuccess && <Alert tone="error">{problem}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          {client.data && !problem && (
            <>
              <p>
                <strong>{client.data.client_name}</strong> wants to use Ferrum as <strong>{session.email}</strong> in the{" "}
                <strong>{session.tenant}</strong> workspace.
              </p>
              <ul className="oauth-scope">
                <li>It can read and change everything you can, with your permissions.</li>
                <li>Everything it does is recorded in the audit trail under your name.</li>
                <li>Access lasts until you revoke it or sign out everywhere.</li>
              </ul>
              <p className="muted">It will return to {hostOf(redirectUri)}.</p>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button onClick={deny} disabled={busy}>
                  Deny
                </Button>
                <Button variant="primary" onClick={allow} loading={busy}>
                  Allow
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
