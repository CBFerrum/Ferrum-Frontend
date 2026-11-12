// Administration → Calendars: the business days, holidays and (optionally) hours of the day that a wait on
// "business days" or "open time" counts on, in a time zone. Each save is a new revision on the server; the
// conversions and the checks are lib/calendarDraft.ts.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage, type FieldError } from "../lib/api";
import {
  addHolidays, checkCalendar, copyDay, dayName, DAYS, emptyDraft, fromCalendar, newException, parseDates, seedHours, toCalendar,
  type Calendar, type Day, type Draft, type ExceptionDraft, type Window,
} from "../lib/calendarDraft";
import { formatDate, todayIso } from "../lib/format";
import { Alert, Button, confirmDialog, Dialog, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";

const SHORT = () => ({ mon: tr("Mon"), tue: tr("Tue"), wed: tr("Wed"), thu: tr("Thu"), fri: tr("Fri"), sat: tr("Sat"), sun: tr("Sun") });
const wrap = { flexWrap: "wrap", gap: 8 } as const;

export function Calendars() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "calendars"],
    queryFn: ({ signal }) => api.get<{ calendars: Calendar[] }>("/api/admin/calendars", undefined, signal),
    retry: false,
  });
  const [editing, setEditing] = useState<Calendar | "new" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "calendars"] });
  const remove = async (c: Calendar) => {
    if (
      !(await confirmDialog({
        title: tr("Delete calendar {name}?", { name: c.name }),
        message: tr("Deadlines already worked out on it stay. A wait that starts later, and a process that names it, will fail or be refused."),
        confirmLabel: tr("Delete"),
        danger: true,
      }))
    )
      return;
    try {
      await api.del(`/api/admin/calendars/${encodeURIComponent(c.name)}`);
      toast(tr("Calendar deleted"));
      void refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const short = SHORT();
  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Calendars")}</h2>
        <span className="spacer" />
        {!(q.error instanceof ApiError && q.error.status === 404) && (
          <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
            {tr("New calendar")}
          </Button>
        )}
      </div>
      {q.isLoading ? (
        <PageLoading />
      ) : q.error instanceof ApiError && q.error.status === 404 ? (
        <EmptyState title={tr("Calendars are not available on this server")} icon="alert" />
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.calendars.length ? (
        <EmptyState title={tr("No calendars yet")} icon="settings" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tr("Name")}</th>
                <th scope="col">{tr("Time zone")}</th>
                <th scope="col">{tr("Business days")}</th>
                <th scope="col">{tr("Hours")}</th>
                <th scope="col">{tr("Holidays")}</th>
                <th scope="col">
                  <span className="sr-only">{tr("Edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.calendars.map((c) => (
                <tr key={c.name}>
                  <td className="mono">{isolate(c.name)}</td>
                  <td>{isolate(c.zone)}</td>
                  <td>{DAYS.filter((d) => !c.weekends.includes(d)).map((d) => short[d]).join(", ") || "—"}</td>
                  <td>{c.hours ? tr("Set hours") : tr("Every hour")}</td>
                  <td>{c.holidays.length}</td>
                  <td className="nowrap">
                    <Button size="sm" icon="edit" aria-label={tr("Edit calendar {name}", { name: c.name })} onClick={() => setEditing(c)}>
                      {tr("Edit")}
                    </Button>
                    {isolate(" ")}
                    <Button size="sm" variant="danger" icon="trash" aria-label={tr("Delete calendar {name}", { name: c.name })} onClick={() => void remove(c)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <CalendarDialog value={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </section>
  );
}

export function CalendarDialog({ value, onClose, onDone }: { value: Calendar | null; onClose: () => void; onDone: () => void }) {
  const isNew = !value;
  const [d, setD] = useState<Draft>(() => (value ? fromCalendar(value) : emptyDraft(Intl.DateTimeFormat().resolvedOptions().timeZone)));
  const [tried, setTried] = useState(false);
  const [server, setServer] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState("");
  const [pasted, setPasted] = useState("");
  const [notDates, setNotDates] = useState<string[]>([]);
  const [exDate, setExDate] = useState("");
  // The browser's list may lack the saved zone (an alias such as Asia/Kolkata), so it is always offered.
  const zones = [...new Set(["UTC", d.zone, ...Intl.supportedValuesOf("timeZone")])].sort();
  const problems = tried ? checkCalendar(d, isNew) : [];
  const about = (field: string) => problems.find((p) => p.field === field)?.message ?? server.find((f) => f.field === field)?.message;
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setWindows = (day: Day, w: Window[]) => setD((x) => ({ ...x, windows: { ...x.windows, [day]: w } }));
  const save = async () => {
    setTried(true);
    setServer([]);
    if (checkCalendar(d, isNew).length) return;
    const { name, ...body } = toCalendar(d);
    setBusy(true);
    try {
      await api.put(`/api/admin/calendars/${encodeURIComponent(name)}`, body);
      toast(tr("Calendar saved"));
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.fields.length) setServer(e.fields);
      else toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const addPasted = () => {
    const { dates, bad } = parseDates(pasted);
    set({ holidays: addHolidays(d.holidays, dates) });
    setNotDates(bad);
    setPasted(bad.join("\n"));
  };
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={value ? tr("Edit calendar {name}", { name: value.name }) : tr("New calendar")}
      footer={
        <>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {tr("Save")}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label={tr("Name")} htmlFor="cal-name" error={about("name")} hint={tr("Lower case, as a process names it: office, head_office. It cannot be changed once saved.")}>
          <input id="cal-name" className="input mono" dir="ltr" spellCheck={false} autoCapitalize="none" disabled={!isNew} value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={tr("Time zone")} htmlFor="cal-zone" error={about("zone")} hint={tr("Days and hours are read in this zone.")}>
          <select id="cal-zone" className="select" value={d.zone} onChange={(e) => set({ zone: e.target.value })}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {isolate(z)}
              </option>
            ))}
          </select>
        </Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 6 }}>
            {tr("Business days")}
          </legend>
          <div className="form-grid">
            {DAYS.map((day) => (
              <label key={day} className="check-field">
                <input type="checkbox" checked={d.open[day]} onChange={(e) => set({ open: { ...d.open, [day]: e.target.checked } })} />
                {dayName(day)}
              </label>
            ))}
          </div>
          {about("calendar") && <p className="field-error" role="alert">{about("calendar")}</p>}
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 6 }}>
            {tr("Hours of a business day")}
          </legend>
          <div className="stack">
            <label className="check-field">
              <input type="radio" name="cal-hours" checked={!d.custom} onChange={() => set({ custom: false })} />
              {tr("Count every hour of a business day")}
            </label>
            <label className="check-field">
              <input type="radio" name="cal-hours" checked={d.custom} onChange={() => setD((x) => ({ ...seedHours(x), custom: true }))} />
              {tr("Set hours")}
            </label>
          </div>
          {d.custom && (
            <div className="stack" style={{ marginTop: 12 }}>
              {about("hours") && <Alert tone="error">{about("hours")}</Alert>}
              {d.open.mon && (
                <div>
                  <Button size="sm" onClick={() => setD(copyDay(d, "mon"))}>
                    {tr("Copy Monday to the other business days")}
                  </Button>
                </div>
              )}
              {DAYS.filter((day) => d.open[day]).map((day) => (
                <fieldset key={day} style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="field-label" style={{ marginBottom: 6 }}>
                    {dayName(day)}
                  </legend>
                  <div className="stack">
                    {d.windows[day].length === 0 && <span className="muted">{tr("Closed")}</span>}
                    {d.windows[day].map((w, i) => {
                      const edit = (patch: Partial<Window>) => setWindows(day, d.windows[day].map((x, j) => (j === i ? { ...x, ...patch } : x)));
                      const n = i + 1;
                      const midnight = w.to === "24:00";
                      return (
                        <div key={i} className="row" style={wrap}>
                          <input className="input" type="time" style={{ width: 130 }} aria-label={tr("{day}, window {n}, from", { day: dayName(day), n })} value={w.from} onChange={(e) => edit({ from: e.target.value })} />
                          <input className="input" type="time" style={{ width: 130 }} aria-label={tr("{day}, window {n}, to", { day: dayName(day), n })} disabled={midnight} value={midnight ? "" : w.to} onChange={(e) => edit({ to: e.target.value })} />
                          <label className="check-field">
                            <input type="checkbox" aria-label={tr("{day}, window {n}, until midnight", { day: dayName(day), n })} checked={midnight} onChange={(e) => edit({ to: e.target.checked ? "24:00" : "" })} />
                            {tr("until midnight")}
                          </label>
                          <Button size="sm" icon="trash" aria-label={tr("Remove {day}, window {n}", { day: dayName(day), n })} onClick={() => setWindows(day, d.windows[day].filter((_, j) => j !== i))} />
                        </div>
                      );
                    })}
                    {problems.filter((p) => p.field === "hours" && p.day === day).map((p) => (
                      <p key={p.message} className="field-error" role="alert">{p.message}</p>
                    ))}
                    <div>
                      <Button size="sm" icon="plus" aria-label={tr("Add a window on {day}", { day: dayName(day) })} onClick={() => setWindows(day, [...d.windows[day], { from: "", to: "" }])}>
                        {tr("Add window")}
                      </Button>
                    </div>
                  </div>
                </fieldset>
              ))}
            </div>
          )}
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 6 }}>
            {tr("Holidays")}
          </legend>
          <div className="stack">
            {d.holidays.length === 0 && <span className="muted">{tr("No holidays")}</span>}
            {d.holidays.map((h) => (
              <div key={h} className="row" style={wrap}>
                <span className="mono">{isolate(h)}</span>
                <Button size="sm" icon="trash" aria-label={tr("Remove holiday {date}", { date: h })} onClick={() => set({ holidays: d.holidays.filter((x) => x !== h) })} />
              </div>
            ))}
            <div className="row" style={wrap}>
              <input className="input" type="date" style={{ width: 170 }} aria-label={tr("A holiday")} value={date} onChange={(e) => setDate(e.target.value)} />
              <Button size="sm" icon="plus" disabled={!date} onClick={() => (set({ holidays: addHolidays(d.holidays, [date]) }), setDate(""))}>
                {tr("Add holiday")}
              </Button>
            </div>
            <Field label={tr("Paste dates")} htmlFor="cal-paste" error={notDates.length ? tr("Not dates (use YYYY-MM-DD): {dates}", { dates: notDates.join(", ") }) : undefined} hint={tr("One per line or separated by commas, as YYYY-MM-DD.")}>
              <textarea id="cal-paste" className="textarea mono" rows={3} dir="ltr" spellCheck={false} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            </Field>
            <div>
              <Button size="sm" disabled={!pasted.trim()} onClick={addPasted}>
                {tr("Add these dates")}
              </Button>
            </div>
          </div>
          {about("holidays") && <p className="field-error" role="alert">{about("holidays")}</p>}
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 6 }}>
            {tr("Exceptions")}
          </legend>
          <p className="faint">{tr("A date that is closed or open whatever its weekday and the holidays say. Open with no hours is open all day; closed with hours is closed only for those hours of the day.")}</p>
          <Exceptions
            value={d.exceptions}
            onChange={(exceptions) => set({ exceptions })}
            date={exDate}
            setDate={setExDate}
            errors={problems.filter((p) => p.field === "exceptions").map((p) => p.message).concat(server.filter((f) => f.field === "exceptions").map((f) => f.message))}
          />
        </fieldset>
      </div>
    </Dialog>
  );
}

/** The dated exceptions by date, those already past collapsed. */
function Exceptions({ value, onChange, date, setDate, errors }: { value: ExceptionDraft[]; onChange: (v: ExceptionDraft[]) => void; date: string; setDate: (d: string) => void; errors: string[] }) {
  const today = todayIso();
  const past = value.filter((e) => e.date < today);
  const coming = value.filter((e) => e.date >= today);
  const edit = (e: ExceptionDraft, patch: Partial<ExceptionDraft>) => onChange(value.map((x) => (x === e ? { ...x, ...patch } : x)));
  const add = () => {
    if (!date || value.some((e) => e.date === date)) return setDate("");
    onChange([...value, newException(date)].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
    setDate("");
  };
  const row = (e: ExceptionDraft) => (
    <ExceptionRow key={e.date} e={e} onChange={(p) => edit(e, p)} onRemove={() => onChange(value.filter((x) => x !== e))} />
  );
  return (
    <div className="stack">
      {errors.map((m) => (
        <p key={m} className="field-error" role="alert">{isolate(m)}</p>
      ))}
      {value.length === 0 && <span className="muted">{tr("No exceptions")}</span>}
      {coming.map(row)}
      {past.length > 0 && (
        <details>
          <summary>{tr("Past exceptions ({n})", { n: past.length })}</summary>
          <div className="stack">{past.map(row)}</div>
        </details>
      )}
      <div className="row" style={wrap}>
        <input className="input" type="date" style={{ width: 170 }} aria-label={tr("A date to make an exception")} value={date} onChange={(e) => setDate(e.target.value)} />
        <Button size="sm" icon="plus" disabled={!date} onClick={add}>
          {tr("Add exception")}
        </Button>
      </div>
    </div>
  );
}

function ExceptionRow({ e, onChange, onRemove }: { e: ExceptionDraft; onChange: (p: Partial<ExceptionDraft>) => void; onRemove: () => void }) {
  const day = formatDate(e.date);
  const setWindow = (i: number, patch: Partial<Window>) => onChange({ windows: e.windows.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="stack" role="group" aria-label={tr("Exception on {date}", { date: e.date })}>
      <div className="row" style={wrap}>
        <span className="mono">{isolate(e.date)}</span>
        <span className="faint">{isolate(day)}</span>
        <select className="select" style={{ width: 140 }} aria-label={tr("{date}: closed or open", { date: e.date })} value={e.open ? "open" : "closed"} onChange={(x) => onChange({ open: x.target.value === "open" })}>
          <option value="closed">{tr("Closed")}</option>
          <option value="open">{tr("Open")}</option>
        </select>
        <Button size="sm" icon="trash" aria-label={tr("Remove exception {date}", { date: e.date })} onClick={onRemove} />
      </div>
      {e.windows.map((w, i) => {
        const n = i + 1;
        const midnight = w.to === "24:00";
        return (
          <div key={i} className="row" style={wrap}>
            <input className="input" type="time" style={{ width: 130 }} aria-label={tr("{date}, window {n}, from", { date: e.date, n })} value={w.from} onChange={(x) => setWindow(i, { from: x.target.value })} />
            <input className="input" type="time" style={{ width: 130 }} aria-label={tr("{date}, window {n}, to", { date: e.date, n })} disabled={midnight} value={midnight ? "" : w.to} onChange={(x) => setWindow(i, { to: x.target.value })} />
            <label className="check-field">
              <input type="checkbox" aria-label={tr("{date}, window {n}, until midnight", { date: e.date, n })} checked={midnight} onChange={(x) => setWindow(i, { to: x.target.checked ? "24:00" : "" })} />
              {tr("until midnight")}
            </label>
            <Button size="sm" icon="trash" aria-label={tr("Remove {date}, window {n}", { date: e.date, n })} onClick={() => onChange({ windows: e.windows.filter((_, j) => j !== i) })} />
          </div>
        );
      })}
      <div>
        <Button size="sm" icon="plus" aria-label={tr("Add a window on {date}", { date: e.date })} onClick={() => onChange({ windows: [...e.windows, { from: "", to: "" }] })}>
          {tr("Add window")}
        </Button>
      </div>
    </div>
  );
}
