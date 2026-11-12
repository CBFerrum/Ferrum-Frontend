// A message template (BD-20) as the editor changes it: the server's JSON itself, edited by small pure functions so that
// opening and saving changes nothing the person did not touch. `checkTemplate` says in words what the server would refuse
// by its shape; what it refuses in a body (an unknown field, a secret field, an undeclared value, a failing template) it
// words itself, naming the language and channel, and `refusalAt` says where that is.

import { t as tr } from "@ferrum/client";

export const CHANNELS = ["email", "text", "chat", "inapp"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_NAMES = (): Record<Channel, string> => ({ email: tr("E-mail"), text: tr("Text message"), chat: tr("Chat-app message"), inapp: tr("In-app notice") });

export interface ChatBody { template?: string; values?: string[]; text?: string }
export interface Bodies {
  email?: { subject: string; body: string };
  text?: { text: string };
  chat?: ChatBody;
  inapp?: { title: string; text?: string };
}
export interface Template {
  key: string;
  label?: string | null;
  entity?: string | null;
  category?: "operational" | "promotional";
  channels?: string[];
  values?: string[];
  languages: Record<string, Bodies>;
}
/** `GET /api/admin/messages/templates`. */
export interface TemplateRow {
  key: string;
  label?: string | null;
  entity?: string | null;
  category?: string;
  channels: string[];
  languages: string[];
  source: "package" | "edited" | "workspace";
  default_changed: boolean;
}
/** `GET /api/admin/messages/templates/{key}`. */
export interface TemplateRead { template: Template; default: Template | null; edited: boolean; default_changed: boolean }

export const messageLink = (key?: string) => (key ? `/customize/messages/${encodeURIComponent(key)}` : "/customize/messages");

/** A body to start from when a language gains a channel. */
export function emptyBody(ch: Channel): NonNullable<Bodies[Channel]> {
  return ch === "email" ? { subject: "", body: "" } : ch === "text" ? { text: "" } : ch === "chat" ? { template: "", values: [] } : { title: "" };
}

export const hasBody = (b: Bodies | undefined, ch: Channel) => !!b && b[ch] !== undefined;

/** The channels a template has a body for in any language, in the server's order. */
export const channelsOf = (t: Template): Channel[] => CHANNELS.filter((c) => Object.values(t.languages).some((b) => hasBody(b, c)));

export function setBody<C extends Channel>(t: Template, lang: string, ch: C, body: Bodies[C] | null): Template {
  const { [ch]: _gone, ...others } = t.languages[lang] ?? {};
  void _gone;
  return { ...t, languages: { ...t.languages, [lang]: body === null ? others : { ...others, [ch]: body } } };
}

export function addLanguage(t: Template, tag: string, from?: string): Template {
  const copy = from && t.languages[from] ? structuredClone(t.languages[from]) : {};
  return { ...t, languages: { ...t.languages, [tag]: copy } };
}

export function removeLanguage(t: Template, tag: string): Template {
  const { [tag]: _gone, ...rest } = t.languages;
  void _gone;
  return { ...t, languages: rest };
}

/** What is sent: empty optional parts left out (an in-app text, a chat body's unused half, no channel order). */
export function toSend(t: Template): Template {
  const languages: Record<string, Bodies> = {};
  for (const [lang, b] of Object.entries(t.languages)) {
    const o: Bodies = { ...b };
    if (o.inapp && !o.inapp.text?.trim()) o.inapp = { ...o.inapp, text: undefined };
    if (o.chat) {
      const c = o.chat;
      const values = (c.values ?? []).filter((v) => v.trim());
      o.chat = c.text !== undefined ? { text: c.text } : { template: c.template, ...(values.length ? { values } : {}) };
    }
    languages[lang] = JSON.parse(JSON.stringify(o)) as Bodies;
  }
  const out: Template = { ...t, languages };
  if (!out.channels?.length) delete out.channels;
  if (!out.values?.length) delete out.values;
  if (!out.label) delete out.label;
  if (!out.entity) delete out.entity;
  return JSON.parse(JSON.stringify(out)) as Template;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEY = /^[a-z][a-z0-9_.]*$/;
const LANG = /^[A-Za-z0-9-]{1,20}$/;

export interface Problem { message: string }

/** What is wrong with a template's shape, as the server's own check words it, before anything is sent. */
export function checkTemplate(t: Template, isNew: boolean): Problem[] {
  const out: string[] = [];
  const langs = Object.keys(t.languages);
  if (isNew && (!KEY.test(t.key) || t.key.length > 100 || t.key.endsWith(".") || t.key.includes(".."))) out.push(tr("The key is lower case letters, digits, underscores and dots, starting with a letter, at most 100 characters."));
  if (!langs.length || langs.every((l) => !channelsOf({ ...t, languages: { [l]: t.languages[l] } }).length)) out.push(tr("Give the message a body in at least one language."));
  for (const l of langs) if (!LANG.test(l)) out.push(tr("“{language}” is not a language tag (en, pt-BR).", { language: l }));
  const have = channelsOf(t);
  for (const c of t.channels ?? []) if (!have.includes(c as Channel)) out.push(tr("The order names {channel}, which no language has a body for.", { channel: CHANNEL_NAMES()[c as Channel] ?? c }));
  for (const [l, b] of Object.entries(t.languages)) {
    if (b.chat) {
      const named = !!b.chat.template?.trim();
      const free = b.chat.text !== undefined && !!b.chat.text.trim();
      if (named === free) out.push(tr("{language}: a chat-app message is either the provider's template name or free text.", { language: l }));
    }
    if (b.email && (!b.email.subject.trim() || !b.email.body.trim())) out.push(tr("{language}: an e-mail needs a subject and a body.", { language: l }));
    if (b.text && !b.text.text.trim()) out.push(tr("{language}: a text message needs its text.", { language: l }));
    if (b.inapp && !b.inapp.title.trim()) out.push(tr("{language}: an in-app notice needs a title.", { language: l }));
  }
  for (const v of t.values ?? []) if (!IDENT.test(v)) out.push(tr("The value “{name}” is not a name (letters, digits and underscores).", { name: v }));
  return out.map((message) => ({ message }));
}

/** Where the server's refusal points: "de, email: unknown field nope" is the e-mail body of language `de`. */
export function refusalAt(message: string): { language: string; channel: Channel; text: string } | null {
  const m = /^([A-Za-z0-9-]+), (email|text|chat|inapp): ([\s\S]*)$/.exec(message);
  return m ? { language: m[1], channel: m[2] as Channel, text: m[3] } : null;
}

/** A new workspace template of its own, with one language and one body. */
export const newTemplate = (key: string, language: string): Template => ({ key, category: "operational", languages: { [language]: { inapp: { title: "" } } } });
