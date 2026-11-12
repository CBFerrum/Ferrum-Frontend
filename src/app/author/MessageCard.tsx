// The "Send a message" card (the `message` effect of a button, transition or automation, BD-20): a message template, who it
// goes to, the channels in the order tried (or every one), and the values the template declares. Also the template pick the
// older "Send mail" and "Notify" cards use to name a template instead of inline text, and the link to the templates page.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { api } from "../../lib/api";
import { MESSAGE_TO_KINDS, MESSAGE_CHANNEL_NAMES, newKey, type DraftAction, type MessageTo, type Row } from "../../lib/automationDraft";
import type { Field as MetaField } from "../../lib/meta";
import { CHANNEL_NAMES, messageLink, type Channel, type TemplateRead, type TemplateRow } from "../../lib/messageDraft";
import { Button, Field } from "../../ui/kit";
import { ExprInput } from "./ExprInput";
import { grow, optionsOf, Pick, Tools, wrap } from "./controls";
import { useRoleNames } from "./RoleSelect";

type Message = Extract<DraftAction, { kind: "message" }>;

export const useMessageTemplates = () =>
  useQuery({ queryKey: ["admin", "messages", "templates"], queryFn: ({ signal }) => api.get<{ templates: TemplateRow[] }>("/api/admin/messages/templates", undefined, signal), staleTime: 30_000 });

/** A template as the page has it (its values and entity), for the values a card asks for. */
export const useMessageTemplate = (key: string) =>
  useQuery({ queryKey: ["admin", "messages", "template", key], queryFn: ({ signal }) => api.get<TemplateRead>(`/api/admin/messages/templates/${encodeURIComponent(key)}`, undefined, signal), enabled: !!key, retry: false, staleTime: 30_000 });

/** The workspace's templates as a select: those about this record type or about none; the one named always stays listed. */
export function TemplatePick({ id, label, value, onChange, entity }: { id: string; label: string; value: string; onChange: (key: string) => void; entity?: string }) {
  const q = useMessageTemplates();
  const list = (q.data?.templates ?? []).filter((t) => t.key === value || !t.entity || !entity || t.entity === entity);
  return (
    <Field label={label} htmlFor={id}>
      <div className="row" style={wrap}>
        <select id={id} className="select" style={{ flex: "1 1 220px", minWidth: 0 }} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{tr("Choose…")}</option>
          {value && !list.some((t) => t.key === value) && <option value={value}>{isolate(value)}</option>}
          {list.map((t) => (
            <option key={t.key} value={t.key}>{isolate(t.label ? `${t.label} (${t.key})` : t.key)}</option>
          ))}
        </select>
        {value ? <Link className="btn btn-sm" to={messageLink(value)}>{tr("Edit this template")}</Link> : <Link className="btn btn-sm" to={messageLink()}>{tr("Message templates")}</Link>}
      </div>
      {q.error && <p className="field-error" role="alert">{tr("The templates could not be loaded.")}</p>}
    </Field>
  );
}

const KIND_NAMES = (): Record<MessageTo["kind"], string> => ({ owner: tr("The record's owner"), user: tr("One person"), role: tr("Everyone with a role"), field: tr("The e-mail, phone or record a field holds"), expr: tr("An expression") });

function Recipient({ r, fields, chips, onChange, onRemove }: { r: MessageTo; fields: MetaField[]; chips: MetaField[]; onChange: (p: Partial<MessageTo>) => void; onRemove: () => void }) {
  const roles = useRoleNames();
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: ({ signal }) => api.get<{ users: { id: string; email: string; full_name: string }[] }>("/api/admin/users", undefined, signal), enabled: r.kind === "user" });
  const id = `mt-${r.key}`;
  return (
    <div className="row" style={wrap} role="group" aria-label={tr("Recipient")}>
      <div style={grow}>
        <select className="select" aria-label={tr("Who it goes to")} value={r.kind} onChange={(e) => onChange({ kind: e.target.value as MessageTo["kind"], value: "" })}>
          {MESSAGE_TO_KINDS.map((k) => (
            <option key={k} value={k}>{KIND_NAMES()[k]}</option>
          ))}
        </select>
      </div>
      {r.kind === "role" && (
        <div style={grow}>
          <Pick label={tr("Role")} value={r.value} onChange={(v) => onChange({ value: v })} options={optionsOf((roles.data?.roles ?? []).map((x) => ({ name: x.name, label: x.name })), r.value)} />
        </div>
      )}
      {r.kind === "user" && (
        <div style={grow}>
          <Pick label={tr("Person")} value={r.value} onChange={(v) => onChange({ value: v })} options={optionsOf((users.data?.users ?? []).map((u) => ({ name: u.id, label: u.full_name ? `${u.full_name} (${u.email})` : u.email })), r.value)} />
        </div>
      )}
      {r.kind === "field" && (
        <div style={grow}>
          <Pick label={tr("Field")} value={r.value} onChange={(v) => onChange({ value: v })} options={optionsOf(fields.filter((f) => f.type !== "table"), r.value)} />
        </div>
      )}
      {r.kind === "expr" && (
        <div style={{ ...grow, flexBasis: 280 }}>
          <ExprInput id={`${id}-expr`} label={tr("Expression")} value={r.value} onChange={(v) => onChange({ value: v })} fields={chips} rows={1} hint={tr("Gives an e-mail address, a phone number, or {email, phone, language, time_zone}.")} />
        </div>
      )}
      <Button size="sm" icon="trash" aria-label={tr("Remove this recipient")} onClick={onRemove} />
    </div>
  );
}

export function MessageCard({ a, entity, chips, links, onChange }: { a: Message; entity: string; chips: MetaField[]; links?: { name: string; label?: string; insert?: string }[]; onChange: (p: Partial<Message>) => void }) {
  const t = useMessageTemplate(a.template);
  const declared = t.data?.template.values ?? [];
  const names = CHANNEL_NAMES();
  const setRow = (name: string, expr: string) => {
    const rest = a.values.filter((r) => r.field !== name);
    const old = a.values.find((r) => r.field === name);
    onChange({ values: !expr.trim() ? rest : old ? a.values.map((r) => (r.field === name ? { ...r, expr } : r)) : [...a.values, { key: `${a.key}-${name}`, field: name, expr } as Row] });
  };
  const exprOf = (name: string) => a.values.find((r) => r.field === name)?.expr ?? "";
  const undeclared = t.data ? a.values.filter((r) => !declared.includes(r.field)) : [];
  const move = (i: number, by: -1 | 1) => {
    const c = [...a.channels];
    [c[i], c[i + by]] = [c[i + by], c[i]];
    onChange({ channels: c });
  };
  const fields = chips;
  return (
    <>
      <p className="faint">{tr("Sends a message template to the people named, on the channels they can be reached on, in the same go as the rest. Nothing is sent unless everything is kept.")}</p>
      <TemplatePick id={`mt-${a.key}-template`} label={tr("Template")} value={a.template} onChange={(template) => onChange({ template, values: [] })} entity={entity} />
      {t.error && <p className="field-error" role="alert">{tr("This template could not be read: it may be gone.")}</p>}
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="field-label">{tr("Who it goes to")}</legend>
        {a.to.map((r) => (
          <Recipient key={r.key} r={r} fields={fields} chips={chips} onChange={(p) => onChange({ to: a.to.map((x) => (x.key === r.key ? { ...x, ...p } : x)) })} onRemove={() => onChange({ to: a.to.filter((x) => x.key !== r.key) })} />
        ))}
        <div>
          <Button size="sm" icon="plus" onClick={() => onChange({ to: [...a.to, { key: newKey(), kind: "owner", value: "" }] })}>{tr("Add a recipient")}</Button>
        </div>
      </fieldset>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="field-label">{tr("Channels")}</legend>
        <p className="faint">{tr("Tried in this order: the first each person can be reached on is used. With none chosen, the template's own order is used.")}</p>
        {a.channels.map((c, i) => (
          <div key={c} className="row" style={wrap}>
            <span>{names[c as Channel] ?? c}</span>
            <Tools index={i} count={a.channels.length} what={names[c as Channel] ?? c} onMove={(by) => move(i, by)} onRemove={() => onChange({ channels: a.channels.filter((x) => x !== c) })} />
          </div>
        ))}
        <div className="row" style={wrap} role="group" aria-label={tr("Add a channel")}>
          {MESSAGE_CHANNEL_NAMES.filter((c) => !a.channels.includes(c)).map((c) => (
            <Button key={c} size="sm" icon="plus" onClick={() => onChange({ channels: [...a.channels, c] })}>{names[c]}</Button>
          ))}
        </div>
        <label className="check-field">
          <input type="checkbox" checked={a.all} onChange={(e) => onChange({ all: e.target.checked })} />
          {tr("Send on every channel each person can be reached on, not only the first")}
        </label>
      </fieldset>
      {declared.map((name) => (
        <ExprInput key={name} id={`mt-${a.key}-v-${name}`} label={tr("Value “{name}”", { name })} value={exprOf(name)} onChange={(v) => setRow(name, v)} fields={chips} links={links} rows={1} hint={tr("Read in the template as values.{name}. An expression: put literal text in quotes.", { name })} />
      ))}
      {t.data && !declared.length && <p className="faint">{tr("This template declares no values.")}</p>}
      {undeclared.map((r) => (
        <p key={r.key} className="field-error" role="alert">{tr("“{name}” is not a value this template declares.", { name: r.field })}</p>
      ))}
    </>
  );
}
