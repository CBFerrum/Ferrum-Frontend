// The automation editor (Administration → Automations): name, trigger (a record event or a schedule), condition
// and an ordered list of actions, with no JSON to write; "Edit as JSON" is there for anything the form has
// no place for. The conversions and the checks are lib/automationDraft.ts.

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage } from "../lib/api";
import { filterable } from "../lib/filters";
import { useEntityMeta, useMetaIndex, type Field as MetaField } from "../lib/meta";
import {
  checkAutomation, EVENTS, fromAutomation, MAX_ACTIONS, mapRefusal, move, newKey, readBack, toAutomation, weekday, type Refusal,
  type Automation, type Draft, type DraftAction, type NotifyTo, type Problem, type Row, type Trigger,
} from "../lib/automationDraft";
import { Alert, Button, Dialog, ErrorState, Field, toast } from "../ui/kit";
import { ExprInput } from "./author/ExprInput";
import { FilterRows, grow, optionsOf, Pick, Tools, wrap } from "./author/controls";
import { useRoleNames } from "./author/RoleSelect";

/** Rows of field → expression. */
function Rows({ rows, fields, onChange, what }: { rows: Row[]; fields: MetaField[]; onChange: (r: Row[]) => void; what: string }) {
  const edit = (key: string, patch: Partial<Row>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="stack">
      {rows.map((r, i) => (
        <div key={r.key} className="row" style={wrap}>
          <div style={grow}>
            <Pick label={tr("Field of {what} {n}", { what, n: i + 1 })} value={r.field} onChange={(v) => edit(r.key, { field: v })} options={optionsOf(fields, r.field)} />
          </div>
          <input className="input mono" style={{ ...grow, flexBasis: 240 }} aria-label={tr("Value of {what} {n}", { what, n: i + 1 })} spellCheck={false} autoCapitalize="none" value={r.expr} onChange={(e) => edit(r.key, { expr: e.target.value })} />
          <Button size="sm" icon="trash" aria-label={tr("Remove {what} {n}", { what, n: i + 1 })} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
        </div>
      ))}
      <div>
        <Button size="sm" icon="plus" onClick={() => onChange([...rows, { key: newKey(), field: "", expr: "" }])}>{tr("Add a field")}</Button>
      </div>
    </div>
  );
}

/** The mail's formatted message, with the record's fields as chips that insert `{{ doc.field }}`. */
function TemplateInput({ value, onChange, fields, error }: { value: string; onChange: (v: string) => void; fields: MetaField[]; error?: string }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (name: string) => {
    const el = area.current;
    const text = `{{ doc.${name} }}`;
    const from = el?.selectionStart ?? value.length;
    const to = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, from) + text + value.slice(to));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(from + text.length, from + text.length);
    });
  };
  return (
    <div className="stack">
      <Field label={tr("Formatted message (HTML)")} error={error} hint={tr("Write the message as HTML. Values from the record are escaped, so text a person typed is shown as text and never as markup; your own markup stays as you wrote it.")}>
        <textarea ref={area} className="textarea mono" rows={10} spellCheck={false} autoCapitalize="none" value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
      {fields.length > 0 && (
        <div role="group" aria-label={tr("Insert a field")} className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {fields.map((f) => (
            <button key={f.name} type="button" className="chip" title={f.label ? isolate(f.label) : undefined} aria-label={tr("Insert {field}", { field: f.name })} onClick={() => insert(f.name)}>
              {isolate(f.name)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What POST /api/admin/automations/preview answers. */
export interface MailPreview { html: string; record_id: string | null }
export type PreviewState = { phase: "loading" } | { phase: "error"; error: unknown } | { phase: "done"; data: MailPreview };

/** The mail as it would look, drawn in a frame that runs nothing (no scripts, no same-origin), and the record it was drawn from. */
export function PreviewResult({ entity, data }: { entity: string; data: MailPreview }) {
  return (
    <div className="stack">
      <iframe sandbox="" srcDoc={data.html} title={tr("The mail as it would look")} style={{ width: "100%", height: 360, border: "1px solid var(--border)", background: "#fff" }} />
      <p className="faint">
        {data.record_id ? (
          <>
            {tr("Drawn from a record of {entity}:", { entity: isolate(entity) })} <Link to={`/e/${encodeURIComponent(entity)}/${data.record_id}`}>{tr("Open the record")}</Link>
          </>
        ) : (
          tr("{entity} has no records yet, so the mail is drawn from an empty record.", { entity: isolate(entity) })
        )}
      </p>
      <p className="faint">{tr("Nothing was sent.")}</p>
    </div>
  );
}

export function MailPreviewDialog({ state, entity, onClose, onRetry }: { state: PreviewState | null; entity: string; onClose: () => void; onRetry: () => void }) {
  return (
    <Dialog open={!!state} onClose={onClose} title={tr("Preview of the mail")} wide>
      {state?.phase === "loading" && <p className="faint" role="status">{tr("Loading…")}</p>}
      {state?.phase === "error" && <ErrorState error={state.error} onRetry={onRetry} title={tr("The preview could not run")} />}
      {state?.phase === "done" && <PreviewResult entity={entity} data={state.data} />}
    </Dialog>
  );
}

export const ACTION_NAMES = (): Record<DraftAction["kind"], string> => ({ set_fields: tr("Set fields"), create_document: tr("Create a record"), update_linked: tr("Change the record a link names"), notify: tr("Notify"), email: tr("Send mail"), raw: tr("Other action") });

export function ActionCard({ a, index, count, entities, chips, fields, onChange, onMove, onRemove, flagged, error, entity }: {
  error?: string; entity: string;
  a: DraftAction; index: number; count: number; entities: { value: string; label: string }[]; chips: MetaField[]; fields: MetaField[];
  onChange: (patch: Partial<DraftAction>) => void; onMove: (by: -1 | 1) => void; onRemove: () => void; flagged: boolean;
}) {
  const roles = useRoleNames();
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: ({ signal }) => api.get<{ users: { id: string; email: string; full_name: string }[] }>("/api/admin/users", undefined, signal), enabled: a.kind === "notify" && a.to === "user" });
  const target = useEntityMeta(a.kind === "create_document" && a.entity ? a.entity : undefined);
  const linkTo = a.kind === "update_linked" ? fields.find((f) => f.name === a.link)?.to : undefined;
  const linked = useEntityMeta(linkTo || undefined);
  const title = tr("Action {n}: {name}", { n: index + 1, name: ACTION_NAMES()[a.kind] });
  const patch = onChange as (p: Record<string, unknown>) => void;
  const [pv, setPv] = useState<PreviewState | null>(null);
  const [pvError, setPvError] = useState<string | null>(null);
  const run = useRef(0);
  const preview = async () => {
    if (a.kind !== "email") return;
    const me = ++run.current;
    setPv({ phase: "loading" });
    setPvError(null);
    try {
      const data = await api.post<MailPreview>("/api/admin/automations/preview", { entity, ...(a.formatted ? { template: a.template } : a.body ? { body: a.body } : {}) });
      if (me === run.current) setPv({ phase: "done", data });
    } catch (err) {
      if (me !== run.current) return;
      const f = err instanceof ApiError ? err.fields.find((x) => x.field === "template" || x.field === "body") : undefined;
      if (f) {
        setPv(null);
        setPvError(f.message);
      } else setPv({ phase: "error", error: err });
    }
  };
  const closePreview = () => {
    run.current++;
    setPv(null);
  };
  const edited = (p: Partial<DraftAction>) => {
    setPvError(null);
    onChange(p);
  };
  return (
    <section className="card" id={`au-action-${a.key}`} tabIndex={-1} aria-label={title} style={flagged || error ? { borderColor: "var(--danger)" } : undefined}>
      <div className="card-head">
        <h4 className="card-title">{title}</h4>
        <span className="spacer" />
        <Tools index={index} count={count} what={title} onMove={onMove} onRemove={onRemove} />
      </div>
      <div className="card-body stack">
        {error && <p className="field-error" role="alert">{isolate(error)}</p>}
        {a.kind === "set_fields" && (
          <>
            <p className="faint">{tr("Fills in fields of the record that triggered this. Values are expressions: put literal text in quotes, like 'Approved'.")}</p>
            <Rows rows={a.rows} fields={fields.filter((f) => f.can_write !== false && !f.read_only && f.type !== "table")} what={tr("field")} onChange={(rows) => patch({ rows })} />
          </>
        )}
        {a.kind === "create_document" && (
          <>
            <Field htmlFor={`ent-${a.key}`} label={tr("Kind of record to create")}>
              <Pick label={tr("Kind of record to create")} id={`ent-${a.key}`} value={a.entity} onChange={(v) => patch({ entity: v })} options={optionsOf(entities.map((e) => ({ name: e.value, label: e.label })), a.entity)} />
            </Field>
            {a.entity && target.error ? (
              <ErrorState error={target.error} onRetry={() => target.refetch()} title={tr("Could not load {entity}", { entity: isolate(a.entity) })} />
            ) : (
              <Rows rows={a.rows} fields={(target.data?.fields ?? []).filter((f) => f.can_write !== false && !f.read_only && f.type !== "table")} what={tr("field")} onChange={(rows) => patch({ rows })} />
            )}
          </>
        )}
        {a.kind === "update_linked" && (
          <>
            <p className="faint">{tr("Fills in fields of the record that one of this record's link fields names. Values are expressions over doc (this record) and linked (the record being changed, as it was).")}</p>
            <Field htmlFor={`link-${a.key}`} label={tr("Link field")}>
              <Pick label={tr("Link field")} id={`link-${a.key}`} value={a.link} onChange={(v) => patch({ link: v, rows: [] })} options={optionsOf(fields.filter((f) => f.type === "link"), a.link)} />
            </Field>
            {a.link && linkTo && linked.error ? (
              <ErrorState error={linked.error} onRetry={() => linked.refetch()} title={tr("Could not load {entity}", { entity: isolate(linkTo) })} />
            ) : (
              a.link && <Rows rows={a.rows} fields={(linked.data?.fields ?? []).filter((f) => f.can_write !== false && !f.read_only && f.type !== "table")} what={tr("field")} onChange={(rows) => patch({ rows })} />
            )}
          </>
        )}
        {a.kind === "notify" && (
          <>
            <div className="row" style={wrap}>
              <div style={grow}>
                <Field label={tr("Tell")}>
                  <select className="select" value={a.to} onChange={(e) => patch({ to: e.target.value as NotifyTo, target: "" })}>
                    <option value="owner">{tr("The record's owner")}</option>
                    <option value="role">{tr("Everyone with a role")}</option>
                    <option value="user">{tr("One person")}</option>
                    <option value="field">{tr("The person named in a field")}</option>
                  </select>
                </Field>
              </div>
              {a.to === "role" && (
                <div style={grow}>
                  <Field htmlFor={`role-${a.key}`} label={tr("Role")}>
                    <Pick label={tr("Role")} id={`role-${a.key}`} value={a.target} onChange={(v) => patch({ target: v })} options={optionsOf((roles.data?.roles ?? []).map((r) => ({ name: r.name, label: r.name })), a.target)} />
                  </Field>
                </div>
              )}
              {a.to === "user" && (
                <div style={grow}>
                  <Field htmlFor={`user-${a.key}`} label={tr("Person")}>
                    <Pick label={tr("Person")} id={`user-${a.key}`} value={a.target} onChange={(v) => patch({ target: v })} options={optionsOf((users.data?.users ?? []).map((u) => ({ name: u.id, label: u.full_name ? `${u.full_name} (${u.email})` : u.email })), a.target)} />
                  </Field>
                </div>
              )}
              {a.to === "field" && (
                <div style={grow}>
                  <Field htmlFor={`tf-${a.key}`} label={tr("Field holding their email")}>
                    <Pick label={tr("Field holding their email")} id={`tf-${a.key}`} value={a.target} onChange={(v) => patch({ target: v })} options={optionsOf(fields.filter((f) => f.type !== "table"), a.target)} />
                  </Field>
                </div>
              )}
            </div>
            {a.to === "role" && roles.error && <ErrorState error={roles.error} onRetry={() => roles.refetch()} title={tr("Could not load the roles")} />}
            {a.to === "user" && users.error && <ErrorState error={users.error} onRetry={() => users.refetch()} title={tr("Could not load the users")} />}
            <Field label={tr("Title")} hint={tr("An expression: put literal text in quotes, like 'Needs a look: ' + doc.name")}>
              <input className="input mono" spellCheck={false} autoCapitalize="none" value={a.title} onChange={(e) => patch({ title: e.target.value })} />
            </Field>
            <Field label={tr("Message (optional)")}>
              <input className="input mono" spellCheck={false} autoCapitalize="none" value={a.body} onChange={(e) => patch({ body: e.target.value })} />
            </Field>
          </>
        )}
        {a.kind === "email" && (
          <>
            <div className="row" style={wrap}>
              <div style={{ ...grow, flexBasis: 240 }}>
                <Field label={tr("To")} hint={tr("An expression that gives an email address, like doc.email")}>
                  <input className="input mono" spellCheck={false} autoCapitalize="none" value={a.to} onChange={(e) => patch({ to: e.target.value })} />
                </Field>
              </div>
              <div style={{ ...grow, flexBasis: 240 }}>
                <Field label={tr("Subject")}>
                  <input className="input mono" spellCheck={false} autoCapitalize="none" value={a.subject} onChange={(e) => patch({ subject: e.target.value })} />
                </Field>
              </div>
              <div style={grow}>
                <Field label={tr("Kind of mail")}>
                  <select className="select" value={a.purpose ?? "transactional"} onChange={(e) => patch({ purpose: e.target.value })}>
                    <option value="transactional">{tr("A notice about the record")}</option>
                    <option value="marketing">{tr("Marketing (only to people who agreed)")}</option>
                  </select>
                </Field>
              </div>
            </div>
            <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, columnGap: 16, flexWrap: "wrap" }}>
              <legend className="field-label">{tr("The message is")}</legend>
              <label className="check-field">
                <input type="radio" name={`mode-${a.key}`} checked={!a.formatted} onChange={() => patch({ formatted: false })} />
                {tr("Plain text")}
              </label>
              <label className="check-field">
                <input type="radio" name={`mode-${a.key}`} checked={a.formatted} onChange={() => patch({ formatted: true })} />
                {tr("Formatted")}
              </label>
            </fieldset>
            {a.formatted ? (
              <TemplateInput value={a.template} onChange={(v) => edited({ template: v })} fields={chips} error={pvError ?? undefined} />
            ) : (
              <ExprInput label={tr("Message")} value={a.body} onChange={(v) => edited({ body: v })} fields={chips} error={pvError} hint={tr("An expression that gives the text: put literal text in quotes.")} />
            )}
            <div>
              <Button size="sm" disabled={!entity} onClick={() => void preview()}>{tr("Preview")}</Button>
            </div>
            <MailPreviewDialog state={pv} entity={entity} onClose={closePreview} onRetry={() => void preview()} />
          </>
        )}
        {a.kind === "raw" && (
          <>
            <p className="faint">{tr("The editor has no form for this action. It is kept exactly as it is; change it under Edit as JSON.")}</p>
            <pre className="mono" tabIndex={0} aria-label={tr("The action as JSON")} style={{ overflow: "auto", margin: 0 }}>{JSON.stringify(a.json, null, 2)}</pre>
          </>
        )}
      </div>
    </section>
  );
}

const eventName = (e: string) => ({ created: tr("created"), updated: tr("updated"), submitted: tr("submitted"), cancelled: tr("cancelled"), deleted: tr("deleted") })[e] ?? e;

function TriggerCard({ trigger, onChange, fields, submittable, sentence, error }: { error?: string; trigger: Trigger; onChange: (t: Trigger) => void; fields: MetaField[]; submittable: boolean; sentence: string | null }) {
  const scheduled = trigger.kind === "relative" || trigger.kind === "every" || (trigger.kind === "raw" && trigger.event === "scheduled");
  const dates = fields.filter((f) => f.type === "date" || f.type === "datetime");
  const filterFields = filterable(fields);
  const set = (patch: Record<string, unknown>) => onChange({ ...trigger, ...patch } as Trigger);
  const relative = () => onChange({ kind: "relative", field: "", amount: "1", unit: "days", dir: "before", at: "", repeat: "", until: "" });
  const every = () => onChange({ kind: "every", period: "day", at: "09:00", on: "", filters: [] });
  return (
    <section className="card" aria-labelledby="au-trigger-h">
      <div className="card-head">
        <h3 className="card-title" id="au-trigger-h">{tr("When it runs")}</h3>
      </div>
      <div className="card-body stack">
        <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, columnGap: 16, flexWrap: "wrap" }}>
          <legend className="field-label">{tr("Run it")}</legend>
          <label className="check-field">
            <input type="radio" name="au-when" checked={!scheduled} onChange={() => onChange({ kind: "event", event: submittable ? "submitted" : "created" })} />
            {tr("When a record is…")}
          </label>
          <label className="check-field">
            <input type="radio" name="au-when" checked={scheduled} onChange={() => !scheduled && relative()} />
            {tr("On a schedule")}
          </label>
        </fieldset>
        {!scheduled && trigger.kind === "event" && (
          <Field label={tr("Record is")}>
            <select className="select" value={trigger.event} onChange={(e) => set({ event: e.target.value })}>
              {EVENTS.filter((e) => submittable || (e !== "submitted" && e !== "cancelled") || e === trigger.event).map((e) => (
                <option key={e} value={e}>{eventName(e)}</option>
              ))}
            </select>
          </Field>
        )}
        {trigger.kind === "raw" && (
          <>
            <p className="faint">{tr("The editor has no form for this trigger. It is kept exactly as it is; change it under Edit as JSON.")}</p>
            <pre className="mono" tabIndex={0} aria-label={tr("The trigger as JSON")} style={{ overflow: "auto", margin: 0 }}>{JSON.stringify({ event: trigger.event, schedule: trigger.schedule }, null, 2)}</pre>
            <div><Button size="sm" onClick={() => onChange({ kind: "event", event: "created" })}>{tr("Use a record event instead")}</Button></div>
          </>
        )}
        {(trigger.kind === "relative" || trigger.kind === "every") && (
          <>
            <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, columnGap: 16, flexWrap: "wrap" }}>
              <legend className="field-label">{tr("Schedule")}</legend>
              <label className="check-field">
                <input type="radio" name="au-sched" checked={trigger.kind === "relative"} onChange={relative} />
                {tr("Relative to a date")}
              </label>
              <label className="check-field">
                <input type="radio" name="au-sched" checked={trigger.kind === "every"} onChange={every} />
                {tr("On a calendar period")}
              </label>
            </fieldset>
            {trigger.kind === "relative" ? (
              <>
                <div className="row" style={wrap}>
                  <Field label={tr("Number")}>
                    <input className="input" style={{ width: 90 }} inputMode="numeric" value={trigger.amount} onChange={(e) => set({ amount: e.target.value })} />
                  </Field>
                  <Field label={tr("Unit")}>
                    <select className="select" value={trigger.unit} onChange={(e) => set({ unit: e.target.value })}>
                      <option value="days">{tr("days")}</option>
                      <option value="hours">{tr("hours")}</option>
                      <option value="minutes">{tr("minutes")}</option>
                    </select>
                  </Field>
                  <Field label={tr("Before or after")}>
                    <select className="select" value={trigger.dir} onChange={(e) => set({ dir: e.target.value })}>
                      <option value="before">{tr("before")}</option>
                      <option value="after">{tr("after")}</option>
                    </select>
                  </Field>
                  <div style={grow}>
                    <Field htmlFor="au-datefield" label={tr("Date field")} hint={dates.length ? undefined : tr("This kind of record has no date field.")}>
                      <Pick label={tr("Date field")} id="au-datefield" value={trigger.field} options={optionsOf(dates, trigger.field)} onChange={(v) => set({ field: v, ...(dates.find((f) => f.name === v)?.type === "datetime" ? { at: "" } : {}) })} />
                    </Field>
                  </div>
                  {(dates.find((f) => f.name === trigger.field)?.type ?? "date") === "date" && (
                    <Field label={tr("Time of day")}>
                      <input className="input" type="time" value={trigger.at || "09:00"} onChange={(e) => set({ at: e.target.value })} />
                    </Field>
                  )}
                </div>
                <div className="row" style={wrap}>
                  <Field label={tr("Repeat")}>
                    <select className="select" value={trigger.repeat} onChange={(e) => set({ repeat: e.target.value, ...(e.target.value ? {} : { until: "" }) })}>
                      <option value="">{tr("Do not repeat")}</option>
                      <option value="P1D">{tr("Every day")}</option>
                      <option value="P1W">{tr("Every week")}</option>
                      <option value="P1M">{tr("Every month")}</option>
                      <option value="P1Y">{tr("Every year")}</option>
                    </select>
                  </Field>
                  {trigger.repeat && (
                    <div style={grow}>
                      <Field label={tr("Until (optional)")}>
                        <select className="select" value={trigger.until} onChange={(e) => set({ until: e.target.value })}>
                          <option value="">{tr("No end")}</option>
                          {optionsOf(dates, trigger.until).map((o) => (
                            <option key={o.value} value={o.value}>{isolate(o.label)}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="row" style={wrap}>
                  <Field label={tr("Every")}>
                    <select className="select" value={trigger.period} onChange={(e) => set({ period: e.target.value, on: e.target.value === "day" ? "" : "1" })}>
                      <option value="day">{tr("day")}</option>
                      <option value="week">{tr("week")}</option>
                      <option value="month">{tr("month")}</option>
                    </select>
                  </Field>
                  {trigger.period === "week" && (
                    <Field label={tr("On")}>
                      <select className="select" value={trigger.on || "1"} onChange={(e) => set({ on: e.target.value })}>
                        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                          <option key={n} value={n}>{weekday(n)}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {trigger.period === "month" && (
                    <Field label={tr("On day")}>
                      <select className="select" value={trigger.on || "1"} onChange={(e) => set({ on: e.target.value })}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                        <option value="last">{tr("The last day")}</option>
                      </select>
                    </Field>
                  )}
                  <Field label={tr("Time of day")}>
                    <input className="input" type="time" value={trigger.at} onChange={(e) => set({ at: e.target.value })} />
                  </Field>
                </div>
                <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <legend className="field-label">{tr("Only the records where (none: every record)")}</legend>
                  <FilterRows rows={trigger.filters} fields={filterFields} onChange={(filters) => set({ filters })} />
                </fieldset>
              </>
            )}
            {sentence && <p role="status"><strong>{tr("Runs:")}</strong> {isolate(sentence)}</p>}
          </>
        )}
        {error && <p className="field-error" role="alert">{isolate(error)}</p>}
      </div>
    </section>
  );
}

/** The buttons that add an action card; `max` is how many the list may hold. */
export function AddActions({ count, max, onAdd }: { count: number; max: number; onAdd: (a: DraftAction) => void }) {
  const row = () => [{ key: newKey(), field: "", expr: "" }];
  const kinds: [string, () => DraftAction][] = [
    [tr("Set fields"), () => ({ key: newKey(), kind: "set_fields", rows: row() })],
    [tr("Create a record"), () => ({ key: newKey(), kind: "create_document", entity: "", rows: row() })],
    [tr("Change the record a link names"), () => ({ key: newKey(), kind: "update_linked", link: "", rows: [] })],
    [tr("Notify"), () => ({ key: newKey(), kind: "notify", to: "owner", target: "", title: "", body: "" })],
    [tr("Send mail"), () => ({ key: newKey(), kind: "email", to: "", subject: "", formatted: false, body: "", template: "" })],
  ];
  return (
    <div role="group" aria-label={tr("Add an action")} className="row" style={{ flexWrap: "wrap" }}>
      {kinds.map(([label, make]) => (
        <Button key={label} size="sm" icon="plus" disabled={count >= max} onClick={() => onAdd(make())}>{label}</Button>
      ))}
    </div>
  );
}

/** The form (or the JSON) of one automation, and its save. */
export function AutomationEditor({ initial, onClose, onDone }: { initial: Partial<Automation>; onClose: () => void; onDone: () => void }) {
  const index = useMetaIndex();
  const [draft, setDraft] = useState<Draft>(() => fromAutomation(initial));
  const [view, setView] = useState<"form" | "json">("form");
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = useEntityMeta(draft.entity || undefined);
  const fields = meta.data?.fields ?? [];
  const submittable = meta.data?.submittable ?? index.data?.entities.find((e) => e.name === draft.entity)?.submittable ?? true;
  const chips = fields.filter((f) => f.type !== "table");
  const entities = [...(index.data?.entities ?? [])].sort((a, b) => a.label.localeCompare(b.label)).map((e) => ({ value: e.name, label: e.label }));
  const ctx = { submittable, fields };

  const set = (d: Draft) => {
    setDraft(d);
    setProblems([]);
    setRefusal(null);
  };
  const patchAction = (key: string, patch: Partial<DraftAction>) => set({ ...draft, actions: draft.actions.map((a) => (a.key === key ? ({ ...a, ...patch } as DraftAction) : a)) });
  const add = (a: DraftAction) => set({ ...draft, actions: [...draft.actions, a] });

  /** The draft the JSON says, or null (with the parser's own words) when it cannot be read. */
  const parsed = (): Draft | null => {
    try {
      const v = JSON.parse(json) as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(tr("The JSON must be one automation: an object with a name, entity, event and actions."));
      setJsonError(null);
      return fromAutomation({ id: draft.id, ...(v as Partial<Automation>) });
    } catch (e) {
      setJsonError(tr("The JSON cannot be read: {message}", { message: (e as Error).message }));
      return null;
    }
  };
  const showJson = () => {
    setJson(JSON.stringify(toAutomation(draft), null, 2));
    setJsonError(null);
    setView("json");
  };
  const showForm = () => {
    const d = parsed();
    if (!d) return;
    set(d);
    setView("form");
  };

  const save = async () => {
    const d = view === "json" ? parsed() : draft;
    if (!d) return;
    if (view === "json") setDraft(d);
    const found = checkAutomation(d, d === draft ? ctx : { ...ctx, fields: d.entity === draft.entity ? fields : [] });
    setProblems(found);
    setServerError(null);
    setRefusal(null);
    if (found.length) return;
    setBusy(true);
    try {
      await api.post("/api/admin/automations", toAutomation(d));
      toast(d.id ? tr("Automation saved") : tr("Automation created"));
      onDone();
      onClose();
    } catch (err) {
      // In the form, what names an action or a control is shown there; the rest stays in the alert. The JSON view has no cards.
      const r = err instanceof ApiError && view === "form" ? mapRefusal(err.fields) : null;
      setRefusal(r);
      setServerError(r && r.other.length ? r.other.join(" ") : errorMessage(err));
      const first = r ? [...r.actions.keys()].sort((x, y) => x - y).find((i) => d.actions[i]) : undefined;
      if (first !== undefined) {
        const id = `au-action-${d.actions[first].key}`;
        requestAnimationFrame(() => {
          const el = document.getElementById(id);
          el?.scrollIntoView?.({ block: "center" });
          el?.focus();
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const sentence = readBack(draft.trigger, ctx);
  const flagged = new Set(problems.map((p) => p.action));
  const conditionError = refusal?.named.condition ?? null;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {(problems.length > 0 || serverError) && (
        <Alert tone="error">
          {problems.length > 0 && (
            <>
              <strong>{tr("Fix these first")}</strong>
              <ul>
                {problems.map((p, i) => (
                  <li key={i}>{isolate(p.message)}</li>
                ))}
              </ul>
            </>
          )}
          {serverError && (
            <>
              <strong>{tr("The server did not accept the automation")}</strong>
              <p>{isolate(serverError)}</p>
            </>
          )}
        </Alert>
      )}
      <div className="segmented" role="group" aria-label={tr("How to edit")} style={{ alignSelf: "flex-start" }}>
        <button type="button" aria-pressed={view === "form"} onClick={view === "form" ? undefined : showForm}>{tr("Form")}</button>
        <button type="button" aria-pressed={view === "json"} onClick={view === "json" ? undefined : showJson}>{tr("Edit as JSON")}</button>
      </div>
      {view === "json" ? (
        <Field label={tr("The automation as JSON")} error={jsonError ?? undefined} hint={tr("Everything the form shows, as the server keeps it. Switching back to the form reads it again.")}>
          <textarea className="textarea mono" rows={22} spellCheck={false} autoCapitalize="none" autoCorrect="off" value={json} onChange={(e) => setJson(e.target.value)} />
        </Field>
      ) : (
        <>
          {index.error && <ErrorState error={index.error} onRetry={() => index.refetch()} title={tr("Could not load the record types")} />}
          <div className="row" style={wrap}>
            <div style={{ ...grow, flexBasis: 220 }}>
              <Field label={tr("Name")} required error={refusal?.named.name}>
                <input className="input" value={draft.name} onChange={(e) => set({ ...draft, name: e.target.value })} />
              </Field>
            </div>
            <div style={grow}>
              <Field htmlFor="au-entity" label={tr("Entity")} required error={refusal?.named.entity}>
                <Pick label={tr("Entity")} id="au-entity" value={draft.entity} options={entities} onChange={(v) => set({ ...draft, entity: v })} />
              </Field>
            </div>
            <label className="check-field">
              <input type="checkbox" checked={draft.active} onChange={(e) => set({ ...draft, active: e.target.checked })} />
              {tr("Active")}
            </label>
          </div>
          {meta.error && <ErrorState error={meta.error} onRetry={() => meta.refetch()} title={tr("Could not load {entity}", { entity: isolate(draft.entity) })} />}
          {draft.entity && meta.isLoading && <p className="faint">{tr("Loading…")}</p>}
          <TriggerCard trigger={draft.trigger} onChange={(trigger) => set({ ...draft, trigger })} fields={fields} submittable={submittable} sentence={sentence} error={refusal?.named.schedule} />
          <ExprInput
            label={tr("Only when (a condition, optional)")}
            value={draft.condition}
            onChange={(v) => set({ ...draft, condition: v })}
            fields={chips}
            error={conditionError}
            hint={tr("For example doc.grand_total > 100000.0. The server checks it when you save.")}
          />
          <section className="stack" aria-labelledby="au-actions-h">
            <h3 id="au-actions-h">{tr("Then")}</h3>
            {!draft.actions.length && <p className="faint">{tr("No actions yet: add what should happen.")}</p>}
            {draft.actions.map((a, i) => (
              <ActionCard
                key={a.key}
                a={a}
                index={i}
                count={draft.actions.length}
                entities={entities}
                chips={chips}
                fields={fields}
                flagged={flagged.has(a.key)}
                error={refusal?.actions.get(i)}
                entity={draft.entity}
                onChange={(p) => patchAction(a.key, p)}
                onMove={(by) => set({ ...draft, actions: move(draft.actions, i, by) })}
                onRemove={() => set({ ...draft, actions: draft.actions.filter((x) => x.key !== a.key) })}
              />
            ))}
            <AddActions count={draft.actions.length} max={MAX_ACTIONS} onAdd={add} />
          </section>
        </>
      )}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button onClick={onClose}>{tr("Cancel")}</Button>
        <Button type="submit" variant="primary" loading={busy}>{tr("Save automation")}</Button>
      </div>
    </form>
  );
}

/** The editor in a dialog; `value` null keeps it closed. */
export function AutomationDialog({ value, onClose, onDone }: { value: Partial<Automation> | null; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={!!value} onClose={onClose} title={value?.id ? tr("Edit {name}", { name: String(value.name) }) : tr("New automation")} wide>
      {value && <AutomationEditor key={value.id ?? "new"} initial={value} onClose={onClose} onDone={onDone} />}
    </Dialog>
  );
}

