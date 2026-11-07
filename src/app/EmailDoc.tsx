// Emailing a document from its form, through the server's mailer: a message and, when the server
// makes PDFs, the print format attached (and kept on the record). The record's timeline notes it.

import { useId, useState } from "react";
import { api, docPath, errorMessage } from "../lib/api";
import { Button, Dialog, Field, toast } from "../ui/kit";
import { t } from "@ferrum/client";

export function EmailDocDialog({ entity, id, title, defaultTo, pdf, onClose }: { entity: string; id: string; title: string; defaultTo?: string; pdf: boolean; onClose: (sent: boolean) => void }) {
  const ids = useId();
  const [to, setTo] = useState(defaultTo ?? "");
  const [subject, setSubject] = useState(title);
  const [message, setMessage] = useState("");
  const [attach, setAttach] = useState(pdf);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post(docPath(entity, id, "email"), { to: to.trim(), subject: subject.trim(), message, pdf: attach });
      toast(t("Email to {to} is on its way.", { to: to.trim() }));
      onClose(true);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={() => onClose(false)}
      title={t("Email {title}", { title })}
      footer={
        <>
          <Button onClick={() => onClose(false)} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!to.trim() || !subject.trim()} onClick={() => void send()}>
            {t("Send")}
          </Button>
        </>
      }
    >
      <Field label={t("To")} htmlFor={`${ids}-to`} required>
        <input id={`${ids}-to`} data-autofocus className="input" type="email" autoComplete="email" value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
      <Field label={t("Subject")} htmlFor={`${ids}-subject`} required>
        <input id={`${ids}-subject`} className="input" maxLength={300} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label={t("Message")} htmlFor={`${ids}-message`} hint={t("Plain text; left empty, the email says the document is attached.")}>
        <textarea id={`${ids}-message`} className="textarea" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" checked={attach} disabled={!pdf} onChange={(e) => setAttach(e.target.checked)} />
        {pdf ? t("Attach the PDF") : t("Attaching the PDF needs a PDF renderer and an SMTP mailer on the server")}
      </label>
    </Dialog>
  );
}
