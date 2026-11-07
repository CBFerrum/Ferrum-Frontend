import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, request } from "../lib/api";
import { Alert, Button, Field, PageLoading, confirmDialog, toast } from "../ui/kit";
import { t, isolate } from "@ferrum/client";

export interface TwoFactorStatus {
  enabled: boolean;
  pending: boolean;
  recovery_codes_left: number;
  required: boolean;
}

interface Begun {
  secret: string;
  uri: string;
  qr_svg: string;
}

export interface Enabled {
  recovery_codes: string[];
  /** A full session, when the one setting it up could do nothing else. */
  token?: string;
}

function fieldError(err: unknown, field: string): string {
  const fields = (err as { fields?: { field: string; message: string }[] }).fields ?? [];
  return fields.find((f) => f.field === field)?.message ?? errorMessage(err, false);
}

/** A code input that takes six digits from an authenticator app (or a recovery code). */
export function CodeInput({ id, value, onChange, recovery }: { id: string; value: string; onChange: (v: string) => void; recovery?: boolean }) {
  return (
    <input
      id={id}
      className="input mono"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode={recovery ? "text" : "numeric"}
      autoComplete="one-time-code"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      maxLength={recovery ? 32 : 7}
      pattern={recovery ? undefined : "[0-9 ]{6,7}"}
      required
      autoFocus
    />
  );
}

/** Recovery codes, shown once: copy or download them before going on. */
export function RecoveryCodes({ codes, onDone, doneLabel = "Done" }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("Recovery codes copied"));
    } catch {
      toast(t("Copy the codes manually"), "error");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Ferrum recovery codes (each works once)\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ferrum-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="stack">
      <Alert tone="warning">{t("Keep these codes somewhere safe. Each one signs you in once if you lose your phone; they are not shown again.")}</Alert>
      <ul className="recovery-codes mono" aria-label={t("Recovery codes")}>
        {codes.map((c) => (
          <li key={c}>{isolate(c)}</li>
        ))}
      </ul>
      <div className="row">
        <Button icon="copy" onClick={() => void copy()}>
          {t("Copy")}
        </Button>
        <Button icon="download" onClick={download}>
          {t("Download")}
        </Button>
      </div>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />{t("I have saved my recovery codes")}
      </label>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          {isolate(doneLabel)}
        </Button>
      </div>
    </div>
  );
}

/** Setting up an authenticator app: scan (or type) the secret, confirm with a code, keep the
 *  recovery codes. `token` is a session that may only do this (a workspace that requires it). */
export function TwoFactorSetup({ token, onEnabled, onCancel }: { token?: string; onEnabled: (res: Enabled) => void; onCancel?: () => void }) {
  const [begun, setBegun] = useState<Begun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Enabled | null>(null);

  useEffect(() => {
    let live = true;
    request<Begun>("/api/auth/2fa/begin", { method: "POST", token, noAuthRedirect: !!token })
      .then((b) => live && setBegun(b))
      .catch((e: unknown) => live && setError(errorMessage(e, false)));
    return () => {
      live = false;
    };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setCodeError(undefined);
    try {
      setDone(await request<Enabled>("/api/auth/2fa/enable", { method: "POST", body: { code: code.trim() }, token, noAuthRedirect: !!token }));
    } catch (err) {
      setCodeError(fieldError(err, "code"));
    } finally {
      setBusy(false);
    }
  };

  if (done) return <RecoveryCodes codes={done.recovery_codes} onDone={() => onEnabled(done)} doneLabel="Continue" />;
  if (error) return <Alert tone="error">{isolate(error)}</Alert>;
  if (!begun) return <PageLoading label={t("Preparing…")} />;
  return (
    <form className="stack" onSubmit={submit}>
      <p>{t("Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), then enter the six-digit code it shows.")}</p>
      <img className="qr" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(begun.qr_svg)}`} alt={t("QR code for your authenticator app")} width={200} height={200} />
      <details>
        <summary>{t("Can't scan it?")}</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <p className="muted">{t("Enter this key in the app (time-based), or open the link on the phone that has the app.")}</p>
          <input className="input mono" readOnly value={begun.secret.replace(/(.{4})/g, "$1 ").trim()} aria-label={t("Setup key")} onFocus={(e) => e.currentTarget.select()} />
          <a href={begun.uri}>{t("Open in authenticator app")}</a>
        </div>
      </details>
      <Field label={t("Code from the app")} htmlFor="tf-setup-code" required error={codeError}>
        <CodeInput id="tf-setup-code" value={code} onChange={setCode} />
      </Field>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {onCancel && <Button onClick={onCancel}>{t("Cancel")}</Button>}
        <Button type="submit" variant="primary" loading={busy}>
          {t("Turn on")}
        </Button>
      </div>
    </form>
  );
}

/** The account's two-factor sign-in: set it up, new recovery codes, or turn it off. */
export function TwoFactorSettings() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["2fa"], queryFn: () => api.get<TwoFactorStatus>("/api/auth/2fa") });
  const [mode, setMode] = useState<"setup" | "codes" | "off" | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  // Show the new state at once; the refetch confirms it.
  const refresh = (now?: Partial<TwoFactorStatus>) => {
    if (now) qc.setQueryData<TwoFactorStatus>(["2fa"], (old) => old && { ...old, ...now });
    void qc.invalidateQueries({ queryKey: ["2fa"] });
  };
  const reset = () => {
    setMode(null);
    setCode("");
    setPassword("");
    setErr({});
  };

  if (status.isPending) return <PageLoading />;
  if (status.isError) return <Alert tone="error">{isolate(errorMessage(status.error))}</Alert>;
  const s = status.data;

  if (codes)
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes(null);
          refresh({ recovery_codes_left: codes.length });
        }}
      />
    );
  if (mode === "setup")
    return (
      <TwoFactorSetup
        onCancel={reset}
        onEnabled={(res) => {
          toast(t("Two-factor sign-in is on"));
          reset();
          refresh({ enabled: true, pending: false, recovery_codes_left: res.recovery_codes.length });
        }}
      />
    );

  const newCodes = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr({});
    try {
      const res = await api.post<{ recovery_codes: string[] }>("/api/auth/2fa/recovery-codes", { code: code.trim() });
      reset();
      setCodes(res.recovery_codes);
    } catch (e2) {
      setErr({ code: fieldError(e2, "code") });
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async (e: FormEvent) => {
    e.preventDefault();
    if (s.required) {
      const ok = await confirmDialog({
        title: t("Turn off two-factor sign-in?"),
        message: t("This workspace requires it: you will set it up again the next time you sign in."),
        confirmLabel: t("Turn off"),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setErr({});
    try {
      await api.post("/api/auth/2fa/disable", password ? { password } : { code: code.trim() }, { noAuthRedirect: true });
      toast(t("Two-factor sign-in is off"));
      reset();
      refresh({ enabled: false, pending: false, recovery_codes_left: 0 });
    } catch (e2) {
      setErr(password ? { password: fieldError(e2, "password") } : { code: fieldError(e2, "code") });
    } finally {
      setBusy(false);
    }
  };

  if (!s.enabled)
    return (
      <div className="stack">
        <p>{t("Two-factor sign-in asks for a code from an app on your phone after your password, so a stolen password alone cannot open your account.")}</p>
        {s.required && <Alert tone="info">{t("Your workspace requires it.")}</Alert>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="primary" onClick={() => setMode("setup")}>
            {t("Set up")}
          </Button>
        </div>
      </div>
    );

  return (
    <div className="stack">
      <Alert tone="success">
        {t("Two-factor sign-in is on. {recovery_codes_left} recovery code", { recovery_codes_left: s.recovery_codes_left })}{s.recovery_codes_left === 1 ? "" : "s"} {t("left.")}
      </Alert>
      {mode === "codes" ? (
        <form className="stack" onSubmit={newCodes}>
          <p>{t("New recovery codes replace the old ones. Confirm with a code from your app.")}</p>
          <Field label={t("Code from the app")} htmlFor="tf-codes-code" required error={err.code}>
            <CodeInput id="tf-codes-code" value={code} onChange={setCode} />
          </Field>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={reset}>{t("Cancel")}</Button>
            <Button type="submit" variant="primary" loading={busy}>
              {t("New codes")}
            </Button>
          </div>
        </form>
      ) : mode === "off" ? (
        <form className="stack" onSubmit={turnOff}>
          <p>{t("Confirm with your password, or with a code from your app if you sign in without one.")}</p>
          <Field label={t("Password")} htmlFor="tf-off-password" error={err.password}>
            <input id="tf-off-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {!password && (
            <Field label={t("Or a code from the app")} htmlFor="tf-off-code" error={err.code}>
              <input
                id="tf-off-code"
                className="input mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={7}
              />
            </Field>
          )}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={reset}>{t("Cancel")}</Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!password && !code.trim()}>
              {t("Turn off")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={() => setMode("codes")}>{t("New recovery codes")}</Button>
          <Button variant="danger" onClick={() => setMode("off")}>
            {t("Turn off")}
          </Button>
        </div>
      )}
    </div>
  );
}

