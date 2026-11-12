// Message templates (administrators; BD-20): the wording of every message the workspace sends, per channel and per language.
// A package's default is edited as a copy of the workspace's own, seen beside it and reset to; the workspace may make
// templates of its own. A template is previewed against a record and sent as a test to oneself. The server's refusal of a
// body (an unknown or secret field, a value the template does not declare, a template that fails) is shown at the body it
// names. The template as data and its checks are lib/messageDraft.ts.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useLocation, useNavigate, useParams } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage } from "../lib/api";
import {
  addLanguage, CHANNEL_NAMES, CHANNELS, channelsOf, checkTemplate, emptyBody, hasBody, messageLink, newTemplate, refusalAt, removeLanguage, setBody, toSend,
  type Bodies, type Channel, type Template, type TemplateRead, type TemplateRow,
} from "../lib/messageDraft";
import { useMe, useMetaIndex } from "../lib/meta";
import { Alert, Badge, Button, confirmDialog, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";
import { Tools } from "./author/controls";
import { LinkInput } from "./widgets";

const KINDS = () => ({ operational: tr("Operational: always sent"), promotional: tr("Promotional: respects opt-outs and quiet hours") });

function Gate({ children }: { children: React.ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <PageLoading />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can edit message templates. Ask one of them to make this change.")}</p>
      </EmptyState>
    );
  }
  return <>{children}</>;
}

// ── the list ──

export function MessageTemplatesPage() {
  return (
    <Gate>
      <List />
    </Gate>
  );
}

const sourceBadge = (r: TemplateRow) =>
  r.source === "edited" ? <Badge tone="blue">{tr("Edited")}</Badge> : r.source === "workspace" ? <Badge tone="purple">{tr("Your own")}</Badge> : <Badge>{tr("From the package")}</Badge>;

function List() {
  const q = useQuery({ queryKey: ["admin", "messages", "templates"], queryFn: ({ signal }) => api.get<{ templates: TemplateRow[] }>("/api/admin/messages/templates", undefined, signal) });
  const navigate = useNavigate();
  const [key, setKey] = useState("");
  const [language, setLanguage] = useState("en");
  const [problem, setProblem] = useState<string | null>(null);
  const make = () => {
    const t = newTemplate(key.trim(), language.trim());
    const found = checkTemplate({ ...t, languages: { [language.trim() || "x"]: { inapp: { title: "x" } } } }, true).find((p) => /key|language tag/.test(p.message));
    if (found) return setProblem(found.message);
    navigate(messageLink(t.key), { state: { fresh: t } });
  };
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/customize">{tr("Customize")}</Link>
          </p>
          <h1 className="page-title">{tr("Message templates")}</h1>
        </div>
      </div>
      <p className="muted">{tr("The wording of every message the workspace sends, on each channel and in each language. Edit a package's default as your own copy, or make a template of your own.")}</p>
      <section className="card" aria-labelledby="mt-list">
        <div className="card-head">
          <h2 id="mt-list">{tr("Templates")}</h2>
        </div>
        {q.isLoading ? (
          <PageLoading />
        ) : q.error || !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.templates.length ? (
          <EmptyState title={tr("No templates yet")} icon="mail">
            <p className="muted">{tr("Packages declare the messages they send; make a template of your own below.")}</p>
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tr("Template")}</th>
                  <th scope="col">{tr("About")}</th>
                  <th scope="col">{tr("Channels")}</th>
                  <th scope="col">{tr("Languages")}</th>
                  <th scope="col">{tr("Where it comes from")}</th>
                  <th scope="col"><span className="sr-only">{tr("Open")}</span></th>
                </tr>
              </thead>
              <tbody>
                {q.data.templates.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <strong>{isolate(r.label || r.key)}</strong>
                      <div className="mono faint">{isolate(r.key)}</div>
                    </td>
                    <td>{isolate(r.entity || "—")}</td>
                    <td>{r.channels.map((c) => CHANNEL_NAMES()[c as Channel] ?? c).join(", ")}</td>
                    <td>{isolate(r.languages.join(", "))}</td>
                    <td>
                      {sourceBadge(r)}
                      {r.default_changed && (
                        <>
                          {" "}
                          <Badge tone="amber">{tr("The default changed since you edited it")}</Badge>
                        </>
                      )}
                    </td>
                    <td className="nowrap">
                      <Link className="btn btn-sm" to={messageLink(r.key)} aria-label={tr("Open {name}", { name: r.label || r.key })}>{tr("Open")}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="mt-new">
        <div className="card-head">
          <h2 id="mt-new">{tr("A template of your own")}</h2>
        </div>
        <form className="card-body stack" onSubmit={(e) => (e.preventDefault(), make())}>
          <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label={tr("Key")} htmlFor="mt-new-key" hint={tr("Lower case, like welcome_visitor. Not a package's name followed by a dot.")} error={problem ?? undefined}>
              <input id="mt-new-key" className="input mono" dir="ltr" spellCheck={false} autoCapitalize="none" value={key} onChange={(e) => (setKey(e.target.value), setProblem(null))} />
            </Field>
            <Field label={tr("First language")} htmlFor="mt-new-lang">
              <input id="mt-new-lang" className="input" dir="ltr" style={{ width: 100 }} value={language} onChange={(e) => (setLanguage(e.target.value), setProblem(null))} />
            </Field>
            <Button type="submit" variant="primary" icon="plus" disabled={!key.trim()}>{tr("Start the template")}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}

// ── one template ──

export function MessageTemplatePage() {
  return (
    <Gate>
      <Loader />
    </Gate>
  );
}

function Loader() {
  const { key = "" } = useParams();
  const fresh = (useLocation().state as { fresh?: Template } | null)?.fresh;
  const q = useQuery({ queryKey: ["admin", "messages", "template", key], queryFn: ({ signal }) => api.get<TemplateRead>(`/api/admin/messages/templates/${encodeURIComponent(key)}`, undefined, signal), retry: false });
  if (fresh && fresh.key === key && q.error instanceof ApiError && q.error.status === 404) return <TemplateEditor key={key} fresh={fresh} />;
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) {
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <EmptyState title={tr("There is no such template")} icon="alert">
        <Link className="btn" to={messageLink()}>{tr("Back to the templates")}</Link>
      </EmptyState>
    ) : (
      <ErrorState error={q.error} onRetry={() => q.refetch()} />
    );
  }
  return <TemplateEditor key={`${key}-${q.dataUpdatedAt}`} read={q.data} />;
}

/** `read`: a template the server holds; `fresh`: one being started. */
export function TemplateEditor({ read, fresh }: { read?: TemplateRead; fresh?: Template }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const index = useMetaIndex();
  const [t, setT] = useState<Template>(() => structuredClone(read?.template ?? fresh!));
  const [base, setBase] = useState(() => JSON.stringify(toSend(read?.template ?? fresh!)));
  const [problems, setProblems] = useState<string[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDefault, setShowDefault] = useState(false);
  const [newLang, setNewLang] = useState("");
  const closing = useRef(false);
  const isNew = !read;
  const def = read?.default ?? null;
  const dirty = isNew || JSON.stringify(toSend(t)) !== base;
  const languages = Object.keys(t.languages);
  const edit = (next: Template) => (setT(next), setProblems([]), setRefused(null));

  const blocker = useBlocker(({ currentLocation, nextLocation }) => !closing.current && dirty && !isNew && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: tr("Leave without saving?"), message: tr("Your changes to this template will be lost."), confirmLabel: tr("Leave"), danger: true }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["admin", "messages"] })]);
  const at = refused ? refusalAt(refused) : null;

  const save = async () => {
    const found = checkTemplate(t, isNew);
    setProblems(found.map((p) => p.message));
    setRefused(null);
    if (found.length) return;
    setBusy(true);
    try {
      await api.post("/api/admin/messages/templates", toSend(t));
      toast(tr("Template saved"));
      closing.current = true;
      await refresh();
      if (isNew) navigate(messageLink(t.key), { replace: true });
      else setBase(JSON.stringify(toSend(t)));
    } catch (e) {
      setRefused(e instanceof ApiError && e.fields.length ? e.fields.map((f) => f.message).join("; ") : errorMessage(e));
    } finally {
      setBusy(false);
      closing.current = false;
    }
  };

  const reset = async () => {
    const own = !def;
    if (!(await confirmDialog({
      title: own ? tr("Delete this template?") : tr("Go back to the package's default?"),
      message: own ? tr("Anything that sends it will be refused until it is made again.") : tr("Your edited copy is removed and the package's wording is used again."),
      confirmLabel: own ? tr("Delete") : tr("Reset"),
      danger: true,
    }))) return;
    try {
      await api.del(`/api/admin/messages/templates/${encodeURIComponent(t.key)}`);
      toast(own ? tr("Template deleted") : tr("Back to the default"));
      closing.current = true;
      await refresh();
      if (own) navigate(messageLink());
      else navigate(messageLink(), { replace: false });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const addLang = () => {
    const tag = newLang.trim();
    if (!tag || t.languages[tag]) return;
    edit(addLanguage(t, tag, languages[0]));
    setNewLang("");
  };
  const channels = channelsOf(t);
  const order = t.channels ?? [];
  const moveChannel = (i: number, by: -1 | 1) => {
    const c = [...order];
    [c[i], c[i + by]] = [c[i + by], c[i]];
    edit({ ...t, channels: c });
  };
  const entityList = [...(index.data?.entities ?? [])].filter((e) => e.kind !== "child").sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/customize">{tr("Customize")}</Link> / <Link to={messageLink()}>{tr("Message templates")}</Link>
          </p>
          <h1 className="page-title">{isolate(t.label || t.key)}</h1>
          <p className="mono faint">{isolate(t.key)}</p>
        </div>
        <div className="page-actions">
          {read && (read.edited || !def) && (
            <Button variant="danger" icon="trash" onClick={() => void reset()}>{def ? tr("Reset to the package default") : tr("Delete this template")}</Button>
          )}
        </div>
      </div>
      {read?.default_changed && <Alert tone="warning">{tr("The package's default has changed since you edited this copy. Yours is still what is sent; compare the default below, or reset to take the new one.")}</Alert>}
      {problems.length > 0 && (
        <Alert tone="error">
          <strong>{tr("Fix these first")}</strong>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{isolate(p)}</li>
            ))}
          </ul>
        </Alert>
      )}
      {refused && !at && <Alert tone="error">{isolate(refused)}</Alert>}

      <section className="card" aria-labelledby="mt-about">
        <div className="card-head">
          <h2 id="mt-about">{tr("About the message")}</h2>
        </div>
        <div className="card-body stack">
          <Field label={tr("Name")} htmlFor="mt-label">
            <input id="mt-label" className="input" value={t.label ?? ""} onChange={(e) => edit({ ...t, label: e.target.value })} />
          </Field>
          <Field label={tr("Kind of message")} htmlFor="mt-category">
            <select id="mt-category" className="select" value={t.category ?? "operational"} disabled={!!def} onChange={(e) => edit({ ...t, category: e.target.value as "operational" | "promotional" })}>
              {(["operational", "promotional"] as const).map((k) => (
                <option key={k} value={k}>{KINDS()[k]}</option>
              ))}
            </select>
          </Field>
          <Field label={tr("About a record of")} htmlFor="mt-entity" hint={def ? tr("Fixed by the package.") : tr("The record the message reads as doc. Leave empty for a message about no record.")}>
            <select id="mt-entity" className="select" value={t.entity ?? ""} disabled={!!def} onChange={(e) => edit({ ...t, entity: e.target.value })}>
              <option value="">{tr("No record")}</option>
              {t.entity && !entityList.some((x) => x.name === t.entity) && <option value={t.entity}>{isolate(t.entity)}</option>}
              {entityList.map((x) => (
                <option key={x.name} value={x.name}>{isolate(x.label)}</option>
              ))}
            </select>
          </Field>
          <Field label={tr("Values the sender passes")} htmlFor="mt-values" hint={def ? tr("Fixed by the package: read in a body as values.name.") : tr("Names separated by commas, like link, code. A body may read only these as values.name.")}>
            <input id="mt-values" className="input mono" dir="ltr" spellCheck={false} disabled={!!def} value={(t.values ?? []).join(", ")} onChange={(e) => edit({ ...t, values: e.target.value.split(/[\s,]+/).filter(Boolean) })} />
          </Field>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <legend className="field-label">{tr("Channels, in the order they are tried")}</legend>
            {order.length === 0 ? (
              <p className="faint">{tr("Every channel with a body, e-mail first, then text message, chat app and in-app notice.")}</p>
            ) : (
              order.map((c, i) => (
                <div key={c} className="row">
                  <span>{CHANNEL_NAMES()[c as Channel] ?? c}</span>
                  <Tools index={i} count={order.length} what={CHANNEL_NAMES()[c as Channel] ?? c} onMove={(by) => moveChannel(i, by)} onRemove={() => edit({ ...t, channels: order.filter((x) => x !== c) })} />
                </div>
              ))
            )}
            <div className="row" style={{ flexWrap: "wrap" }} role="group" aria-label={tr("Set the order")}>
              {channels.filter((c) => !order.includes(c)).map((c) => (
                <Button key={c} size="sm" icon="plus" onClick={() => edit({ ...t, channels: [...order, c] })}>{CHANNEL_NAMES()[c]}</Button>
              ))}
            </div>
          </fieldset>
          {def && (
            <label className="check-field">
              <input type="checkbox" checked={showDefault} onChange={(e) => setShowDefault(e.target.checked)} />
              {tr("Show the package's default beside each body")}
            </label>
          )}
        </div>
      </section>

      {languages.map((lang) => (
        <section key={lang} className="card" aria-labelledby={`mt-lang-${lang}`}>
          <div className="card-head">
            <h2 id={`mt-lang-${lang}`}>{tr("Language {language}", { language: lang })}</h2>
            <span className="spacer" />
            <Button size="sm" icon="trash" disabled={languages.length < 2} aria-label={tr("Remove the language {language}", { language: lang })} onClick={() => edit(removeLanguage(t, lang))}>
              {tr("Remove language")}
            </Button>
          </div>
          <div className="card-body stack">
            {CHANNELS.map((ch) => (
              <ChannelBody
                key={ch}
                lang={lang}
                ch={ch}
                t={t}
                edit={edit}
                other={showDefault ? (def ? (def.languages[lang] ?? null) : null) : undefined}
                refusal={at && at.language === lang && at.channel === ch ? at.text : undefined}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="card" aria-labelledby="mt-addlang">
        <div className="card-head">
          <h2 id="mt-addlang">{tr("Add a language")}</h2>
        </div>
        <div className="card-body row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label={tr("Language tag")} htmlFor="mt-newlang" hint={tr("Like de or pt-BR. It starts as a copy of {language}.", { language: languages[0] ?? "—" })}>
            <input id="mt-newlang" className="input" dir="ltr" style={{ width: 140 }} value={newLang} onChange={(e) => setNewLang(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLang())} />
          </Field>
          <Button icon="plus" disabled={!newLang.trim() || !!t.languages[newLang.trim()]} onClick={addLang}>{tr("Add language")}</Button>
        </div>
      </section>

      <Try t={t} dirty={dirty} isNew={isNew} onRefusal={(m) => setRefused(m)} />

      <div className="row">
        <Button variant="primary" loading={busy} disabled={busy || (!isNew && !dirty)} onClick={() => void save()}>{tr("Save template")}</Button>
        {!isNew && !dirty && <span className="faint">{tr("Nothing changed.")}</span>}
      </div>
    </div>
  );
}

/** One channel's body in one language: add it, edit it, remove it, with the package default beside it when asked. */
export function ChannelBody({ lang, ch, t, edit, other, refusal }: { lang: string; ch: Channel; t: Template; edit: (t: Template) => void; other?: Bodies | null; refusal?: string }) {
  const b = t.languages[lang] ?? {};
  const id = `mt-${lang}-${ch}`;
  const name = CHANNEL_NAMES()[ch];
  const set = (body: NonNullable<Bodies[Channel]> | null) => edit(setBody(t, lang, ch, body as never));
  if (!hasBody(b, ch)) {
    return (
      <div className="row">
        <span className="muted">{tr("{channel}: no body in this language.", { channel: name })}</span>
        <Button size="sm" icon="plus" aria-label={tr("Add a {channel} body in {language}", { channel: name, language: lang })} onClick={() => set(emptyBody(ch))}>{tr("Add")}</Button>
      </div>
    );
  }
  const theirs = other === undefined ? undefined : (other?.[ch] ?? null);
  const side = (label: string, text: string, key: string) =>
    theirs !== undefined && (
      <div className="field">
        <label className="field-label" htmlFor={`${id}-${key}-default`}>{tr("Package default: {label}", { label })}</label>
        <textarea id={`${id}-${key}-default`} className="textarea mono" rows={3} readOnly value={theirs ? text : tr("The package has no such body.")} />
      </div>
    );
  return (
    <fieldset className="stack" aria-invalid={refusal ? true : undefined} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: 0, minWidth: 0, ...(refusal ? { borderColor: "var(--danger)" } : {}) }}>
      <legend className="field-label">{name}</legend>
      {refusal && <p className="field-error" role="alert" id={`${id}-error`}>{isolate(refusal)}</p>}
      {ch === "email" && b.email && (
        <>
          <Field label={tr("Subject")} htmlFor={`${id}-subject`}>
            <input id={`${id}-subject`} className="input" value={b.email.subject} onChange={(e) => set({ ...b.email!, subject: e.target.value })} />
          </Field>
          {side(tr("Subject"), (theirs as { subject?: string } | null)?.subject ?? "", "subject")}
          <Field label={tr("Body (HTML; every value it prints is escaped)")} htmlFor={`${id}-body`}>
            <textarea id={`${id}-body`} className="textarea mono" rows={6} dir="ltr" spellCheck={false} value={b.email.body} onChange={(e) => set({ ...b.email!, body: e.target.value })} />
          </Field>
          {side(tr("Body"), (theirs as { body?: string } | null)?.body ?? "", "body")}
        </>
      )}
      {ch === "text" && b.text && (
        <>
          <Field label={tr("Text")} htmlFor={`${id}-text`}>
            <textarea id={`${id}-text`} className="textarea mono" rows={3} dir="ltr" spellCheck={false} value={b.text.text} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          {side(tr("Text"), (theirs as { text?: string } | null)?.text ?? "", "text")}
        </>
      )}
      {ch === "chat" && b.chat && <ChatFields id={id} chat={b.chat} set={set} theirs={theirs as Bodies["chat"] | null | undefined} side={side} />}
      {ch === "inapp" && b.inapp && (
        <>
          <Field label={tr("Title")} htmlFor={`${id}-title`}>
            <input id={`${id}-title`} className="input" value={b.inapp.title} onChange={(e) => set({ ...b.inapp!, title: e.target.value })} />
          </Field>
          {side(tr("Title"), (theirs as { title?: string } | null)?.title ?? "", "title")}
          <Field label={tr("Text (optional)")} htmlFor={`${id}-itext`}>
            <textarea id={`${id}-itext`} className="textarea mono" rows={2} dir="ltr" spellCheck={false} value={b.inapp.text ?? ""} onChange={(e) => set({ ...b.inapp!, text: e.target.value })} />
          </Field>
          {side(tr("Text"), (theirs as { text?: string } | null)?.text ?? "", "itext")}
        </>
      )}
      <div>
        <Button size="sm" icon="trash" aria-label={tr("Remove the {channel} body in {language}", { channel: name, language: lang })} onClick={() => set(null)}>{tr("Remove this body")}</Button>
      </div>
      <p className="faint">{tr("Read the record as doc.field, the sender's values as values.name, and settings.Entity.field.")}</p>
    </fieldset>
  );
}

/** A chat-app message: the provider's pre-approved template by name with its ordered values, or free text. */
function ChatFields({ id, chat, set, theirs, side }: { id: string; chat: NonNullable<Bodies["chat"]>; set: (b: NonNullable<Bodies["chat"]>) => void; theirs: Bodies["chat"] | null | undefined; side: (label: string, text: string, key: string) => React.ReactNode }) {
  const free = chat.text !== undefined;
  const values = chat.values ?? [];
  const setValues = (v: string[]) => set({ ...chat, values: v });
  return (
    <>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, columnGap: 16, flexWrap: "wrap" }}>
        <legend className="field-label">{tr("The message is")}</legend>
        <label className="check-field">
          <input type="radio" name={`${id}-mode`} checked={!free} onChange={() => set({ template: chat.template ?? "", values: chat.values ?? [] })} />
          {tr("The provider's template, by name")}
        </label>
        <label className="check-field">
          <input type="radio" name={`${id}-mode`} checked={free} onChange={() => set({ text: chat.text ?? "" })} />
          {tr("Free text")}
        </label>
      </fieldset>
      {free ? (
        <>
          <Field label={tr("Text")} htmlFor={`${id}-ctext`}>
            <textarea id={`${id}-ctext`} className="textarea mono" rows={3} dir="ltr" spellCheck={false} value={chat.text ?? ""} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          {side(tr("Text"), theirs?.text ?? "", "ctext")}
        </>
      ) : (
        <>
          <Field label={tr("Template name at the provider")} htmlFor={`${id}-ctemplate`}>
            <input id={`${id}-ctemplate`} className="input mono" dir="ltr" spellCheck={false} value={chat.template ?? ""} onChange={(e) => set({ ...chat, template: e.target.value })} />
          </Field>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <legend className="field-label">{tr("Values, in order")}</legend>
            {values.map((v, i) => (
              <div key={i} className="row">
                <input className="input mono" dir="ltr" spellCheck={false} aria-label={tr("Value {n}", { n: i + 1 })} value={v} onChange={(e) => setValues(values.map((x, j) => (j === i ? e.target.value : x)))} />
                <Tools index={i} count={values.length} what={tr("value {n}", { n: i + 1 })} onMove={(by) => { const c = [...values]; [c[i], c[i + by]] = [c[i + by], c[i]]; setValues(c); }} onRemove={() => setValues(values.filter((_, j) => j !== i))} />
              </div>
            ))}
            <div>
              <Button size="sm" icon="plus" onClick={() => setValues([...values, ""])}>{tr("Add a value")}</Button>
            </div>
          </fieldset>
          {side(tr("Template and values"), theirs ? `${theirs.template ?? ""}\n${(theirs.values ?? []).join("\n")}` : "", "ctemplate")}
        </>
      )}
    </>
  );
}

// ── preview and test ──

interface Preview { language: string; message: { subject?: string; html?: string; text?: string | null; template_name?: string; values?: string[]; title?: string }; record_id?: string | null }
interface Sent { state: string; reason?: string | null; channel?: string }

/** Try the template: how it reads against a chosen record (unsaved changes included), and a test to oneself (saved ones only). */
function Try({ t, dirty, isNew, onRefusal }: { t: Template; dirty: boolean; isNew: boolean; onRefusal: (m: string) => void }) {
  const have = channelsOf(t);
  const [channel, setChannel] = useState<Channel | "">("");
  const [language, setLanguage] = useState("");
  const [record, setRecord] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const ch = (channel || have[0] || "") as Channel | "";
  const lang = language && t.languages[language] ? language : "";
  const preview = useMutation({
    mutationFn: () => api.post<Preview>("/api/admin/messages/preview", { template: toSend(t), channel: ch, ...(lang ? { language: lang } : {}), ...(record ? { record_id: record } : {}) }),
    onError: (e) => onRefusal(e instanceof ApiError && e.fields.length ? e.fields.map((f) => f.message).join("; ") : errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => api.post<Sent[]>("/api/admin/messages/test", { template: t.key, channel: ch, ...(phone.trim() ? { phone: phone.trim() } : {}), ...(record ? { record_id: record } : {}) }),
  });
  const shown = preview.data;
  return (
    <section className="card" aria-labelledby="mt-try">
      <div className="card-head">
        <h2 id="mt-try">{tr("Try it")}</h2>
      </div>
      <div className="card-body stack">
        {!have.length ? (
          <p className="muted">{tr("Add a body first.")}</p>
        ) : (
          <>
            <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label={tr("Channel")} htmlFor="mt-try-channel">
                <select id="mt-try-channel" className="select" value={ch} onChange={(e) => setChannel(e.target.value as Channel)}>
                  {have.map((c) => (
                    <option key={c} value={c}>{CHANNEL_NAMES()[c]}</option>
                  ))}
                </select>
              </Field>
              <Field label={tr("Language")} htmlFor="mt-try-lang" hint={tr("Empty: the workspace's, else English.")}>
                <select id="mt-try-lang" className="select" value={lang} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="">{tr("As a recipient would get it")}</option>
                  {Object.keys(t.languages).map((l) => (
                    <option key={l} value={l}>{isolate(l)}</option>
                  ))}
                </select>
              </Field>
              {t.entity && (
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <LinkInput to={t.entity} value={record} onChange={(id) => setRecord(id)} label={tr("Record to read")} placeholder={tr("The latest one you may read")} />
                </div>
              )}
            </div>
            <div className="row">
              <Button loading={preview.isPending} onClick={() => preview.mutate()}>{tr("Preview")}</Button>
            </div>
            {shown && (
              <div className="stack" role="region" aria-label={tr("The preview")}>
                <p className="faint">{tr("In language {language}.", { language: shown.language })}</p>
                {shown.message.subject !== undefined && <p><strong>{isolate(shown.message.subject)}</strong></p>}
                {shown.message.title !== undefined && <p><strong>{isolate(shown.message.title)}</strong></p>}
                {shown.message.html !== undefined && <iframe title={tr("The e-mail as it would look")} sandbox="" srcDoc={shown.message.html} style={{ width: "100%", minHeight: 160, border: "1px solid var(--border)" }} />}
                {shown.message.template_name !== undefined && (
                  <p className="mono">{isolate(shown.message.template_name)}: {isolate((shown.message.values ?? []).join(" | "))}</p>
                )}
                {shown.message.text != null && <p style={{ whiteSpace: "pre-wrap" }}>{isolate(shown.message.text)}</p>}
              </div>
            )}
            <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
              {(ch === "text" || ch === "chat") && (
                <Field label={tr("Your number (optional)")} htmlFor="mt-try-phone" hint={tr("Otherwise the one on your account.")}>
                  <input id="mt-try-phone" className="input" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
              )}
              <Button loading={test.isPending} disabled={dirty || isNew || test.isPending} onClick={() => test.mutate()}>{tr("Send a test to me")}</Button>
              {(dirty || isNew) && <span className="faint">{tr("Save the template first: a test sends what is saved.")}</span>}
            </div>
            {test.error && <Alert tone="error">{isolate(errorMessage(test.error))}</Alert>}
            {test.data && (
              <ul aria-label={tr("What the test came to")}>
                {test.data.map((s, i) => (
                  <li key={i}>{tr("{channel}: {state}", { channel: CHANNEL_NAMES()[(s.channel ?? ch) as Channel] ?? s.channel ?? "", state: s.state })}{s.reason ? ` (${s.reason})` : ""}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
