// Administration → Workspace → Access: the networks staff may work from, how long an idle browser stays signed in, who keeps a
// password under single sign-on, and the notice of a sign-in from a new device. Saved through PUT /api/admin/settings, the
// route the other workspace settings use, with only what changed. Also the list of networks that API keys use (NetworkList).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage, type FieldError } from "../lib/api";
import {
  accessPatch,
  BREAK_GLASS_MAX,
  cleanNetworks,
  IDLE_MAX,
  IDLE_MIN,
  looksLikeNetwork,
  ownNetwork,
  type AccessSettings as Access,
  type NetworkMode,
} from "../lib/access";
import { Button, Field as FieldWrap, toast } from "../ui/kit";

/** Networks one per row, each labelled; blank rows are dropped when saved. The server judges every value. */
export function NetworkList({ label, value, onChange, hint, error, max = 100 }: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: string; error?: string; max?: number }) {
  const set = (i: number, v: string) => onChange(value.map((x, j) => (j === i ? v : x)));
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label">{label}</legend>
      <div className="stack" style={{ gap: 8 }}>
        {value.map((n, i) => (
          <div key={i} className="row" style={{ gap: 8 }}>
            <input
              className="input mono"
              style={{ flex: 1, minWidth: 0 }}
              value={n}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="10.0.0.0/8"
              aria-label={tr("Network {n}", { n: i + 1 })}
              aria-invalid={n.trim() !== "" && !looksLikeNetwork(n) ? true : undefined}
              onChange={(e) => set(i, e.target.value)}
            />
            <Button size="sm" icon="trash" aria-label={tr("Remove network {n}", { n: i + 1 })} onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </div>
        ))}
        {value.some((n) => n.trim() !== "" && !looksLikeNetwork(n)) && <p className="field-hint">{tr("Write each as an address and a length, like 10.0.0.0/8 or 2001:db8::/32.")}</p>}
        <div>
          <Button size="sm" icon="plus" disabled={value.length >= max} onClick={() => onChange([...value, ""])}>
            {tr("Add a network")}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {isolate(error)}
        </p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </fieldset>
  );
}

interface Admin {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_admin: boolean;
  kind?: string;
}

/** The administrators who can be named: active ones of the workspace's own people. */
export const nameable = (users: Admin[]): Admin[] => users.filter((u) => u.is_admin && u.is_active && (u.kind ?? "member") === "member");

export function AccessSettings({ initial }: { initial: Access }) {
  const qc = useQueryClient();
  const [networks, setNetworks] = useState<string[]>(initial.staff_networks?.networks ?? []);
  const [mode, setMode] = useState<NetworkMode>(initial.staff_networks?.mode ?? "report");
  const [idle, setIdle] = useState(String(initial.idle_minutes ?? 0));
  const [breakGlass, setBreakGlass] = useState<string[] | null>(initial.break_glass ?? null);
  const [notice, setNotice] = useState(!!initial.new_device_notice);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  // The administrator's own address, as the server sees it (GET /_zone answers on any host, with no session).
  const here = useQuery({ queryKey: ["zone"], queryFn: ({ signal }) => api.get<{ address?: string | null }>("/_zone", undefined, signal), retry: false });
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: ({ signal }) => api.get<{ users: Admin[] }>("/api/admin/users", undefined, signal) });
  const admins = nameable(users.data?.users ?? []);
  const own = ownNetwork(here.data?.address);
  const patch = accessPatch(initial, { networks, mode, idle, breakGlass, notice });
  const error = (name: string) => errors.find((f) => f.field === name)?.message;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setErrors([]);
    try {
      await api.put("/api/admin/settings", patch);
      toast(tr("Access settings saved"));
      await qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) setErrors(err.fields);
      else toast(errorMessage(err), "error");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <form className="card card-pad stack" style={{ maxWidth: 560 }} onSubmit={submit} aria-label={tr("Access")}>
      <h2>{tr("Access")}</h2>
      <NetworkList
        label={tr("Networks staff may work from")}
        value={networks}
        onChange={setNetworks}
        error={error("staff_networks")}
        hint={tr("Staff using a password, a session or an app from anywhere else are refused. API keys have networks of their own, and support access, which you grant for a while, is not held to these. With none listed, staff may work from anywhere.")}
      />
      {here.data?.address && (
        <p className="muted">
          {tr("The server sees your address as {address}.", { address: isolate(here.data.address) })}{" "}
          {own && !networks.map((n) => n.trim()).includes(own) && (
            <Button size="sm" onClick={() => setNetworks([...cleanNetworks(networks), own])}>
              {tr("Add it")}
            </Button>
          )}
        </p>
      )}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">{tr("When someone is outside them")}</legend>
        <div className="stack" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 8 }}>
            <input type="radio" name="net-mode" checked={mode === "report"} onChange={() => setMode("report")} />
            {tr("Only report it (they are let in, and counted)")}
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="radio" name="net-mode" checked={mode === "enforce"} onChange={() => setMode("enforce")} />
            {tr("Enforce: refuse them")}
          </label>
        </div>
        <p className="field-hint">{tr("Enforcing is refused unless your own address is inside the networks, so that you cannot shut yourself out. Report first, then enforce.")}</p>
      </fieldset>
      <FieldWrap
        label={tr("Sign out idle browsers after")}
        htmlFor="acc-idle"
        error={error("idle_minutes")}
        hint={tr("0 never; otherwise {min} to {max} minutes. The next request of a browser unused that long asks for a sign-in again.", { min: IDLE_MIN, max: IDLE_MAX })}
      >
        <span className="row" style={{ gap: 8 }}>
          <input id="acc-idle" className="input" type="number" inputMode="numeric" min={0} max={IDLE_MAX} style={{ width: 120 }} value={idle} onChange={(e) => setIdle(e.target.value)} />
          {tr("minutes")}
        </span>
      </FieldWrap>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">{tr("Administrators who keep a password under single sign-on")}</legend>
        <p className="field-hint">{tr("When single sign-on is required, these still sign in with a password or passkey, for when the identity provider is down.")}</p>
        <div className="stack" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 8 }}>
            <input type="radio" name="bg-mode" checked={breakGlass === null} onChange={() => setBreakGlass(null)} />
            {tr("Every administrator")}
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="radio" name="bg-mode" checked={breakGlass !== null} onChange={() => setBreakGlass(breakGlass ?? [])} />
            {tr("Only the ones I pick")}
          </label>
          {breakGlass !== null && (
            <div className="stack" style={{ gap: 4, paddingInlineStart: 24 }}>
              {users.isLoading && <p className="muted">{tr("Loading…")}</p>}
              {users.error != null && <p className="field-error">{isolate(errorMessage(users.error))}</p>}
              {admins.map((a) => {
                const on = breakGlass.includes(a.id);
                return (
                  <label key={a.id} className="row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && breakGlass.length >= BREAK_GLASS_MAX}
                      onChange={(e) => setBreakGlass(e.target.checked ? [...breakGlass, a.id] : breakGlass.filter((x) => x !== a.id))}
                    />
                    {isolate(a.full_name || a.email)} <span className="faint">{isolate(a.email)}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        {error("break_glass") && (
          <p className="field-error" role="alert">
            {isolate(error("break_glass")!)}
          </p>
        )}
      </fieldset>
      <FieldWrap label={tr("New devices")} htmlFor="acc-notice" error={error("new_device_notice")}>
        <label className="row" style={{ gap: 8 }}>
          <input id="acc-notice" type="checkbox" checked={notice} onChange={(e) => setNotice(e.target.checked)} />
          {tr("E-mail staff when they sign in from a device they had not used")}
        </label>
      </FieldWrap>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button type="submit" variant="primary" loading={busy} disabled={!Object.keys(patch).length}>
          {tr("Save")}
        </Button>
      </div>
    </form>
  );
}
