// Emailing a document from its form, through the server's mailer: recipients as chips, a subject, the message written with the
// kit's RichTextEditor (merge fields filled in from the record), a template to start from, what goes attached, a preview as the
// recipient sees it, and Send that says "Sent" only once the server has taken the mail. The text is never lost: a draft is kept
// per record for the session, a message is not discarded without asking, and a failure keeps everything with its reason.
// The server cleans the HTML again (crates/kernel/src/richtext.rs); a server that does not advertise `mail_html` gets plain text.

import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, docPath, errorMessage } from "../lib/api";
import { formatValue } from "../lib/format";
import type { Doc, Field as MetaField } from "../lib/meta";
import { Alert, Button, confirmDialog, Dialog, Field, Icon, Menu, MenuItem, toast } from "../ui/kit";
import { isRichTextEmpty, resolveMergeFields, RichText, RichTextEditor, richTextToPlain, sanitizeRichText, type MergeField } from "../ui/richtext";
import { t } from "@ferrum/client";
import { EyeIcon, FileTextIcon, PaperclipIcon, PencilIcon, SendIcon } from "lucide-react";

interface Draft {
  to: string[];
  subject: string;
  html: string;
  attach: boolean;
}
/** What was being written, per record, for this session: a dialog closed by mistake or a page left comes back to it. */
const drafts = new Map<string, Draft>();

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
/** Field types whose value reads as words in a sentence (`{{ due_date }}`); tables, files, secrets and JSON do not. */
const MERGEABLE = new Set(["data", "text", "int", "decimal", "currency", "percent", "date", "datetime", "select", "link", "email", "phone", "url", "check"]);

interface TemplateRow {
  key: string;
  label?: string | null;
  entity?: string | null;
  channels: string[];
}

export function EmailDocDialog({
  entity,
  id,
  title,
  defaultTo,
  pdf,
  html: richMail,
  doc,
  fields,
  attachmentName,
  onClose,
}: {
  entity: string;
  id: string;
  title: string;
  defaultTo?: string;
  pdf: boolean;
  /** The server takes `message_html` (`GET /api/version` → `mail_html`); else the message goes as plain text. */
  html?: boolean;
  /** The record and its fields: merge fields and address suggestions. */
  doc?: Doc;
  fields?: MetaField[];
  /** What the PDF is called. Seam for the print-format picker: it passes the chosen format's name here and in the request. */
  attachmentName?: string;
  onClose: (sent: boolean) => void;
}) {
  const ids = useId();
  const key = `${entity}/${id}`;
  const [kept] = useState(() => drafts.get(key));
  const [to, setTo] = useState<string[]>(kept?.to ?? (defaultTo ? [defaultTo] : []));
  const [typing, setTyping] = useState("");
  const [subject, setSubject] = useState(kept?.subject ?? title);
  const [html, setHtml] = useState(kept?.html ?? "");
  const [attach, setAttach] = useState(kept?.attach ?? pdf);
  const [preview, setPreview] = useState(false);
  const [stage, setStage] = useState<"idle" | "sending" | "sent">("idle");
  const [failed, setFailed] = useState<{ to: string; why: string }[]>([]);
  const [tried, setTried] = useState(false);
  const toInput = useRef<HTMLInputElement>(null);
  const keep = (d: Partial<Draft>) => drafts.set(key, { to, subject, html, attach, ...d });

  // Merge fields: the record's own values, as the form shows them.
  const merge = useMemo(() => {
    const list: MergeField[] = [];
    const values: Record<string, string> = {};
    for (const f of fields ?? []) {
      if (!MERGEABLE.has(f.type) || f.can_read === false || f.hidden) continue;
      list.push({ name: f.name, label: f.label });
      const v = doc?.[f.name];
      const shown = f.type === "link" ? ((doc?._titles as Record<string, string> | undefined)?.[f.name] ?? v) : v;
      values[f.name] = shown === null || shown === undefined || shown === "" ? "" : f.type === "link" ? String(shown) : formatValue(f, shown);
    }
    // The record's number is not a field of its own, but the first thing a message names.
    if (typeof doc?.number === "string" && !values.number) {
      list.unshift({ name: "number", label: t("Number") });
      values.number = doc.number;
    }
    return { list, values };
  }, [fields, doc]);
  const suggestions = useMemo(() => {
    const out = new Set<string>();
    for (const f of fields ?? []) if (f.type === "email" && typeof doc?.[f.name] === "string" && EMAIL.test(String(doc[f.name]))) out.add(String(doc![f.name]));
    return [...out].filter((a) => !to.includes(a));
  }, [fields, doc, to]);

  // Message templates for this kind of record (administrators can list them; for anyone else the menu is not there).
  const templates = useQuery({
    queryKey: ["admin", "messages", "templates"],
    queryFn: ({ signal }) => api.get<{ templates: TemplateRow[] }>("/api/admin/messages/templates", undefined, signal),
    retry: false,
    staleTime: 60_000,
  });
  const forThis = (templates.data?.templates ?? []).filter((r) => r.entity === entity && r.channels.includes("email"));
  const useTemplate = async (r: TemplateRow) => {
    if (!isRichTextEmpty(html) && !(await confirmDialog({ title: t("Replace the message?"), message: t("The template's subject and message take the place of what you have written."), confirmLabel: t("Replace") }))) return;
    try {
      const got = await api.post<{ message: { subject?: string; html?: string } }>("/api/admin/messages/preview", { template: r.key, channel: "email", record_id: id });
      const next = { subject: got.message.subject ?? subject, html: sanitizeRichText(got.message.html ?? "") };
      setSubject(next.subject);
      setHtml(next.html);
      keep(next);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const bad = to.filter((a) => !EMAIL.test(a));
  const pending = typing.trim();
  const commit = (raw = typing) => {
    const add = raw.split(/[,;\s]+/).map((s) => s.trim().replace(/^<|>$/g, "")).filter(Boolean);
    if (!add.length) return;
    const next = [...to, ...add.filter((a) => !to.includes(a))];
    setTo(next);
    setTyping("");
    keep({ to: next });
  };
  const remove = (a: string) => {
    const next = to.filter((x) => x !== a);
    setTo(next);
    keep({ to: next });
    toInput.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === " " && typing.includes("@"))) {
      if (!typing.trim()) return;
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !typing && to.length) {
      e.preventDefault();
      remove(to[to.length - 1]!);
    }
  };

  const resolved = resolveMergeFields(html, merge.values);
  const recipients = pending ? [...to, pending] : to;
  const problems = {
    to: !recipients.length ? t("Add at least one recipient.") : recipients.some((a) => !EMAIL.test(a)) ? t("Check the addresses marked in red.") : null,
    subject: !subject.trim() ? t("Give the e-mail a subject.") : null,
  };
  const empty = isRichTextEmpty(html);

  const send = async () => {
    setTried(true);
    if (pending) commit();
    if (problems.to || problems.subject) return;
    setStage("sending");
    setFailed([]);
    const body = richMail ? { message_html: sanitizeRichText(resolved, { mail: true }), message: richTextToPlain(resolved) } : { message: richTextToPlain(resolved) };
    const left: { to: string; why: string }[] = [];
    // One mail per recipient (the server sends to one address at a time): each is said to have gone only once it has.
    for (const address of recipients) {
      try {
        await api.post(docPath(entity, id, "email"), { to: address, subject: subject.trim(), ...(empty ? {} : body), pdf: attach });
      } catch (e) {
        left.push({ to: address, why: errorMessage(e) });
      }
    }
    if (!left.length) {
      drafts.delete(key);
      setStage("sent");
      toast(recipients.length === 1 ? t("Sent to {to}.", { to: recipients[0]! }) : t("Sent to {n} recipients.", { n: recipients.length }));
      window.setTimeout(() => onClose(true), 600);
      return;
    }
    // What went is off the list; what did not stays, with its reason, and the message stays as it is.
    const still = left.map((l) => l.to);
    setTo(still);
    keep({ to: still });
    setFailed(left);
    setStage("idle");
  };

  const close = async () => {
    if (stage === "sending") return;
    if (stage !== "sent" && !empty && !(await confirmDialog({ title: t("Discard this message?"), message: t("What you have written will be lost."), confirmLabel: t("Discard"), cancelLabel: t("Keep writing"), danger: true }))) return;
    drafts.delete(key);
    onClose(false);
  };

  const busy = stage !== "idle";
  const pdfName = attachmentName ?? `${title.replace(/[^\p{L}\p{N}-]+/gu, "_")}.pdf`;
  return (
    <Dialog
      open
      wide
      onClose={() => void close()}
      title={t("Email {title}", { title })}
      footer={
        <>
          <Button className="me-auto" variant="ghost" aria-pressed={preview} onClick={() => setPreview(!preview)} disabled={busy}>
            {preview ? <PencilIcon className="size-4" aria-hidden="true" /> : <EyeIcon className="size-4" aria-hidden="true" />}
            {preview ? t("Back to writing") : t("Preview")}
          </Button>
          <Button onClick={() => void close()} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" icon={stage === "sent" ? "check" : undefined} loading={stage === "sending"} disabled={busy} onClick={() => void send()}>
            {stage === "idle" && <SendIcon className="size-4" aria-hidden="true" />}
            {stage === "sending" ? t("Sending…") : stage === "sent" ? t("Sent") : t("Send")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {failed.length > 0 && (
          <Alert tone="error">
            {failed.length === 1 ? t("The e-mail to {to} was not sent: {why}", { to: failed[0]!.to, why: failed[0]!.why }) : t("{n} e-mails were not sent; the addresses left are the ones that failed.", { n: failed.length })}
            {failed.length > 1 && (
              <ul className="mt-1 list-disc ps-5">
                {failed.map((f) => (
                  <li key={f.to}>
                    {f.to}: {f.why}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <Field label={t("To")} htmlFor={`${ids}-to`} required error={tried ? (problems.to ?? undefined) : undefined}>
          <div className={`chip-input input ${tried && problems.to ? "field-invalid-box" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), toInput.current?.focus())}>
            {to.map((a) => (
              <span key={a} className={`chip ${EMAIL.test(a) ? "" : "chip-bad"}`} title={EMAIL.test(a) ? a : t("Not an e-mail address")}>
                <span dir="ltr">{a}</span>
                <button type="button" className="chip-x" aria-label={t("Remove {name}", { name: a })} onClick={() => remove(a)} disabled={busy}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
            <input
              ref={toInput}
              id={`${ids}-to`}
              data-autofocus
              type="email"
              multiple
              dir="ltr"
              autoComplete="email"
              list={suggestions.length ? `${ids}-known` : undefined}
              aria-invalid={(tried && !!problems.to) || bad.length > 0 || undefined}
              placeholder={to.length ? "" : t("name@example.com")}
              value={typing}
              disabled={busy}
              onChange={(e) => (e.target.value.endsWith(",") ? commit(e.target.value) : setTyping(e.target.value))}
              onKeyDown={onKey}
              onBlur={() => commit()}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (/[,;\s]/.test(text.trim())) {
                  e.preventDefault();
                  commit(text);
                }
              }}
            />
            {suggestions.length > 0 && (
              <datalist id={`${ids}-known`}>
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </div>
        </Field>
        <Field label={t("Subject")} htmlFor={`${ids}-subject`} required error={tried ? (problems.subject ?? undefined) : undefined}>
          <input id={`${ids}-subject`} className="input" maxLength={300} value={subject} disabled={busy} onChange={(e) => (setSubject(e.target.value), keep({ subject: e.target.value }))} />
        </Field>
        <div className="field">
          <div className="flex items-end justify-between gap-2">
            <span className="field-label" id={`${ids}-message-label`}>
              {preview ? t("As the recipient sees it") : t("Message")}
            </span>
            {!preview && forThis.length > 0 && (
              <Menu label={<><FileTextIcon className="size-4" aria-hidden="true" /> {t("Use a template")}</>} buttonClass="btn btn-ghost btn-sm">
                {(done) =>
                  forThis.map((r) => (
                    <MenuItem key={r.key} onSelect={() => (done(), void useTemplate(r))}>
                      {r.label || r.key}
                    </MenuItem>
                  ))
                }
              </Menu>
            )}
          </div>
          {preview ? (
            <div className="email-preview" aria-labelledby={`${ids}-message-label`} role="region">
              <div className="email-preview-head">
                <div>
                  <span className="faint">{t("To")}</span> <span dir="ltr">{recipients.join(", ") || "—"}</span>
                </div>
                <div className="font-semibold">{subject || "—"}</div>
              </div>
              {empty ? <p className="muted">{attach && pdf ? t("Please find {title} attached.", { title }) : title}</p> : <RichText html={sanitizeRichText(resolved, { mail: true })} />}
              {attach && pdf && (
                <p className="email-preview-file">
                  <PaperclipIcon className="size-3.5 shrink-0" aria-hidden="true" /> {pdfName}
                </p>
              )}
            </div>
          ) : (
            <RichTextEditor
              toolbar="compact"
              value={html}
              onChange={(v) => (setHtml(v), keep({ html: v }))}
              labelledBy={`${ids}-message-label`}
              placeholder={t("Write a message, or leave it empty to send a short note with the attachment")}
              mergeFields={merge.list}
              disabled={busy}
              minHeight="11rem"
              maxHeight="22rem"
              status={kept && !empty ? t("Draft kept from earlier") : merge.list.length ? t("Type {{ to insert a field from the record") : undefined}
              onSubmit={() => void send()}
            />
          )}
        </div>
        <label className="attach-line">
          <input type="checkbox" checked={attach && pdf} disabled={!pdf || busy} onChange={(e) => (setAttach(e.target.checked), keep({ attach: e.target.checked }))} />
          <PaperclipIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {pdf ? (
            <span>
              {t("Attach")} <span className="font-medium">{pdfName}</span> <span className="faint">{t("(the record printed as a PDF)")}</span>
            </span>
          ) : (
            <span className="muted">{t("Attaching the PDF needs a PDF renderer and an SMTP mailer on the server")}</span>
          )}
        </label>
      </div>
    </Dialog>
  );
}
