// Administration → Workspace → Access: the networks staff may work from, how long an idle browser stays signed in, who keeps a
// password under single sign-on, the notice of a sign-in from a new device, the work that asks a person to confirm it is them again
// (`step_up`) and the entities whose reads are recorded (`record_reads`; docs/operations.md, "Asking again before sensitive work" and
// "Recording who read what"). Saved through PUT /api/admin/settings, the route the other workspace settings use, with only what changed.
// Also the list of networks that API keys use (NetworkList).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage, type FieldError } from "../lib/api";
import {
  accessPatch,
  BREAK_GLASS_MAX,
  cleanNetworks,
  ENTITIES_MAX,
  IDLE_MAX,
  IDLE_MIN,
  looksLikeNetwork,
  ownNetwork,
  readRows,
  STEP_UP_MINUTES,
  stepUpMinutes,
  stepUpRows,
  WORK,
  type AccessSettings as Access,
  type NetworkMode,
  type ReadLevel,
  type ReadRow,
  type StepUpRow,
  type Work,
} from "../lib/access";
import { useMetaIndex } from "../lib/meta";
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

/** One entity of the workspace, chosen from its list (the way the other admin screens do: record types, not their parts). Those already used elsewhere in the list are not offered again. */
function EntityChoice({ label, value, taken, onChange }: { label: string; value: string; taken: string[]; onChange: (entity: string) => void }) {
  const index = useMetaIndex();
  const list = [...(index.data?.entities ?? [])].filter((e) => e.kind !== "child").sort((a, b) => a.label.localeCompare(b.label));
  return (
    <select className="select" style={{ flex: 1, minWidth: 0 }} aria-label={label} value={value} disabled={index.isLoading || !!index.error} aria-invalid={index.error ? true : undefined} onChange={(e) => onChange(e.target.value)}>
      <option value="">{index.isLoading ? tr("Loading…") : index.error ? isolate(errorMessage(index.error)) : tr("Choose a record type…")}</option>
      {value && !list.some((x) => x.name === value) && <option value={value}>{isolate(value)}</option>}
      {list.map((x) => (
        <option key={x.name} value={x.name} disabled={x.name !== value && taken.includes(x.name)}>
          {isolate(x.label)}
        </option>
      ))}
    </select>
  );
}

const WORK_LABEL = (): Record<Work, string> => ({ write: tr("Change"), delete: tr("Delete"), export: tr("Export"), read: tr("Read") });
const LEVEL_LABEL = (): Record<ReadLevel, string> => ({ open: tr("Each record opened"), all: tr("Everything: records, lists, searches, reports, exports") });

export function AccessSettings({ initial }: { initial: Access }) {
  const qc = useQueryClient();
  const [networks, setNetworks] = useState<string[]>(initial.staff_networks?.networks ?? []);
  const [mode, setMode] = useState<NetworkMode>(initial.staff_networks?.mode ?? "report");
  const [idle, setIdle] = useState(String(initial.idle_minutes ?? 0));
  const [breakGlass, setBreakGlass] = useState<string[] | null>(initial.break_glass ?? null);
  const [notice, setNotice] = useState(!!initial.new_device_notice);
  const [stepMinutes, setStepMinutes] = useState(stepUpMinutes(initial.step_up));
  const [stepRows, setStepRows] = useState<StepUpRow[]>(stepUpRows(initial.step_up));
  const [reads, setReads] = useState<ReadRow[]>(readRows(initial.record_reads));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  // The administrator's own address, as the server sees it (GET /_zone answers on any host, with no session).
  const here = useQuery({ queryKey: ["zone"], queryFn: ({ signal }) => api.get<{ address?: string | null }>("/_zone", undefined, signal), retry: false });
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: ({ signal }) => api.get<{ users: Admin[] }>("/api/admin/users", undefined, signal) });
  const admins = nameable(users.data?.users ?? []);
  const own = ownNetwork(here.data?.address);
  const patch = accessPatch(initial, { networks, mode, idle, breakGlass, notice, stepUp: { minutes: stepMinutes, rows: stepRows }, reads });
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
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">{tr("Ask again before sensitive work")}</legend>
        <p className="field-hint">
          {tr("Staff confirm it is them again before the work you mark here: with a passkey, their password (and the code from their authenticator app when they have one), or by signing in again with their identity provider. They are asked when they try it; whoever may not do it is told so instead. Signing in counts as confirming.")}
        </p>
        <div className="stack" style={{ gap: 12 }}>
          <label className="row" style={{ gap: 8 }}>
            {tr("A confirmation counts for")}
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={STEP_UP_MINUTES.min}
              max={STEP_UP_MINUTES.max}
              style={{ width: 90 }}
              value={stepMinutes}
              aria-label={tr("Minutes a confirmation counts for")}
              onChange={(e) => setStepMinutes(e.target.value)}
            />
            {tr("minutes ({min} to {max})", { min: STEP_UP_MINUTES.min, max: STEP_UP_MINUTES.max })}
          </label>
          {!stepRows.length && <p className="muted">{tr("Nothing is marked: nobody is asked again.")}</p>}
          {stepRows.map((r, i) => {
            const set = (change: Partial<StepUpRow>) => setStepRows(stepRows.map((x, j) => (j === i ? { ...x, ...change } : x)));
            return (
              <div key={i} className="stack" role="group" aria-label={tr("Rule {n}", { n: i + 1 })} style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  <EntityChoice label={tr("Record type {n}", { n: i + 1 })} value={r.entity} taken={stepRows.map((x) => x.entity)} onChange={(entity) => set({ entity })} />
                  <Button size="sm" icon="trash" aria-label={tr("Remove rule {n}", { n: i + 1 })} onClick={() => setStepRows(stepRows.filter((_, j) => j !== i))} />
                </div>
                <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
                  {WORK.map((w) => (
                    <label key={w} className="row" style={{ gap: 6 }}>
                      <input type="checkbox" checked={r.work.includes(w)} onChange={(e) => set({ work: e.target.checked ? [...r.work, w] : r.work.filter((x) => x !== w) })} />
                      {WORK_LABEL()[w]}
                    </label>
                  ))}
                </div>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={r.refuseKeys} onChange={(e) => set({ refuseKeys: e.target.checked })} />
                  {tr("Refuse API keys and service accounts this work too")}
                </label>
              </div>
            );
          })}
          <div>
            <Button size="sm" icon="plus" disabled={stepRows.length >= ENTITIES_MAX} onClick={() => setStepRows([...stepRows, { entity: "", work: ["write", "delete", "export", "read"], refuseKeys: false }])}>
              {tr("Add a record type")}
            </Button>
          </div>
        </div>
        <p className="field-hint">
          {tr("Change covers creating, editing, submitting, cancelling, importing and the buttons that change a record. Read covers opening a record, lists, searches and reports. Keys and service accounts cannot confirm it is them, so unless you refuse them here they are let through, held by their scopes and networks.")}
        </p>
        {error("step_up") && (
          <p className="field-error" role="alert">
            {isolate(error("step_up")!)}
          </p>
        )}
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">{tr("Record who reads")}</legend>
        <p className="field-hint">
          {tr("Each read of a record type you list here becomes an event in the audit log, under Access: who, when, which record or which search, and how many rows, never a field's value. A read fails if its event cannot be written, so nothing is read unrecorded.")}
        </p>
        <div className="stack" style={{ gap: 12 }}>
          {!reads.length && <p className="muted">{tr("No reads are recorded.")}</p>}
          {reads.map((r, i) => {
            const set = (change: Partial<ReadRow>) => setReads(reads.map((x, j) => (j === i ? { ...x, ...change } : x)));
            return (
              <div key={i} className="row" role="group" aria-label={tr("Recorded record type {n}", { n: i + 1 })} style={{ gap: 8, flexWrap: "wrap" }}>
                <EntityChoice label={tr("Record type {n}", { n: i + 1 })} value={r.entity} taken={reads.map((x) => x.entity)} onChange={(entity) => set({ entity })} />
                <select className="select" aria-label={tr("What is recorded for record type {n}", { n: i + 1 })} value={r.level} onChange={(e) => set({ level: e.target.value as ReadLevel })}>
                  {(["open", "all"] as const).map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABEL()[l]}
                    </option>
                  ))}
                </select>
                <Button size="sm" icon="trash" aria-label={tr("Stop recording record type {n}", { n: i + 1 })} onClick={() => setReads(reads.filter((_, j) => j !== i))} />
              </div>
            );
          })}
          <div>
            <Button size="sm" icon="plus" disabled={reads.length >= ENTITIES_MAX} onClick={() => setReads([...reads, { entity: "", level: "open" }])}>
              {tr("Add a record type")}
            </Button>
          </div>
        </div>
        <p className="field-hint">
          {tr("Each record opened: every time one record's fields are returned. Everything: that, and every list, search, report and export, one event per request, so a long list screen writes many.")}
        </p>
        {error("record_reads") && (
          <p className="field-error" role="alert">
            {isolate(error("record_reads")!)}
          </p>
        )}
      </fieldset>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button type="submit" variant="primary" loading={busy} disabled={!Object.keys(patch).length}>
          {tr("Save")}
        </Button>
      </div>
    </form>
  );
}
