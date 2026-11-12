// The print dialog on every record (PRINT-FORMATS-SPEC §7.1): the server's render of the record in the chosen format on paper,
// and beside it the format, letter head, language and copies; Print, Download PDF and E-mail as PDF. It remembers the last
// choice per record type and person (`print:<Entity>`) and opens with it while it is still offered.
// A server before print formats (no `print` in /api/version) still offers what its document templates give (a format, the
// standard one only where no template is the default); without templates the form prints as before and this is not opened.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { t as tr, isolate } from "@ferrum/client";
import { ApiError, docPath, errorMessage, request, requestRaw, saveBlob } from "../lib/api";
import { usePref } from "../lib/prefs";
import { copiesOffered, printPrefScope, printQuery, startingChoice, type Choices, type PrintChoice } from "../lib/printLayout";
import { Alert, Button, Dialog, Field, toast } from "../ui/kit";
import { FormSkeleton } from "../ui/patterns";
import { openPdf, PAPER_NAMES, PaperFrame, printHtml } from "./print/shared";

export const choicesQuery = (entity: string, record?: string) => ({
  queryKey: ["print", "choices", entity, record ?? null],
  queryFn: ({ signal }: { signal: AbortSignal }) => request<Choices>(`/api/documents/choices/${encodeURIComponent(entity)}${record ? `?record=${encodeURIComponent(record)}` : ""}`, { signal }),
  staleTime: 30_000,
  retry: false,
});

/** Page formats a server before print formats offers (level 0): there is a dialog only when there is one. */
export const hasPageTemplates = (c: Choices | undefined) => !!c?.templates.some((x) => x.output === "page");

export function PrintDialog({ entity, entityLabel, id, title, level, pdf, canEmail, onEmail, onClose }: {
  entity: string;
  entityLabel: string;
  id: string;
  title: string;
  /** The server's print level (§6.4). */
  level: number;
  pdf: boolean;
  canEmail: boolean;
  /** "E-mail as PDF": the dialog closes and the record's e-mail dialog opens with this choice. */
  onEmail: (choice: Required<PrintChoice>) => void;
  onClose: () => void;
}) {
  const ids = useId();
  const choices = useQuery(choicesQuery(entity, level >= 1 ? id : undefined));
  const pref = usePref<PrintChoice>(printPrefScope(entity), {});
  const [choice, setChoice] = useState<Required<PrintChoice> | null>(null);
  const c = choices.data;
  useEffect(() => {
    if (c && pref.ready && !choice) setChoice(startingChoice(c, pref.value));
  }, [c, pref.ready, pref.value, choice]);
  // The pickers arrive after the dialog opened (on its Close button): the first one takes focus when it appears.
  useEffect(() => {
    if (choice && document.activeElement?.closest(".dialog-header")) document.getElementById(`${ids}-format`)?.focus();
  }, [!!choice]);
  const set = (patch: Partial<PrintChoice>) => setChoice((x) => (x ? { ...x, ...patch, ...(patch.template !== undefined ? { copies: [] } : {}) } : x));

  // A server before print formats knows no "standard" key: the standard format is asked for by naming none, which it gives only
  // when no template is the default.
  const offerStandard = level >= 1 || !c?.default;
  const ask = choice && { ...choice, template: level >= 1 ? choice.template : (choice.template ?? undefined), ...(level >= 1 ? {} : { letterhead: "default", copies: [] }) };
  const path = (format: "html" | "pdf") => docPath(entity, id, "print") + printQuery({ ...ask!, format });
  const render = useQuery({
    queryKey: ["print", "render", entity, id, ask],
    queryFn: ({ signal }) => request<string>(path("html"), { signal, headers: { accept: "text/html" } }),
    enabled: !!ask,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const pages = (c?.templates ?? []).filter((x) => x.output === "page");
  const picked = pages.find((x) => x.key === choice?.template);
  const languages = picked?.kind !== "layout" && picked?.languages?.length ? picked.languages : (c?.languages ?? []);
  const copies = c && choice ? copiesOffered(c, choice.template) : [];
  const refused = c?.may_print === false;
  const defaultLh = c?.letterheads?.find((l) => l.default_for_record);
  const [busy, setBusy] = useState<"" | "print" | "pdf">("");
  const remember = () => choice && pref.set(choice);
  const fileName = `${title || entityLabel}.pdf`;

  const doPrint = async () => {
    remember();
    setBusy("print");
    try {
      if (pdf) await openPdf(() => requestRaw(path("pdf")));
      else if (render.data && !render.isPlaceholderData) printHtml(render.data);
      else printHtml(await request<string>(path("html"), { headers: { accept: "text/html" } }));
    } catch (e) {
      toast(noPdfService(e) ?? errorMessage(e), "error");
    } finally {
      setBusy("");
    }
  };
  const doDownload = async () => {
    remember();
    setBusy("pdf");
    try {
      const res = await requestRaw(path("pdf"));
      saveBlob(await res.blob(), /filename="?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fileName);
    } catch (e) {
      toast(noPdfService(e) ?? errorMessage(e), "error");
    } finally {
      setBusy("");
    }
  };

  const failed = choices.error;
  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("Print {title}", { title: title || entityLabel })}
      footer={
        <>
          {canEmail && (
            <Button icon="mail" disabled={!choice || refused} onClick={() => (remember(), onEmail(choice!))}>
              {tr("E-mail as PDF")}
            </Button>
          )}
          {pdf && (
            <Button icon="download" loading={busy === "pdf"} disabled={!choice || refused || !!busy} onClick={() => void doDownload()}>
              {tr("Download PDF")}
            </Button>
          )}
          <Button variant="primary" icon="printer" loading={busy === "print"} disabled={!choice || refused || !!busy} onClick={() => void doPrint()}>
            {tr("Print")}
          </Button>
        </>
      }
    >
      <div className="print-dialog">
        <PaperFrame title={tr("How {title} prints", { title: title || entityLabel })} html={render.data} page={picked?.page} loading={render.isFetching} error={render.isError ? render.error : null} />
        <div className="print-pickers">
          {failed ? (
            <Alert tone="error">{isolate(errorMessage(failed))}</Alert>
          ) : !c || !choice ? (
            <FormSkeleton fields={4} />
          ) : (
            <>
              {refused && <Alert tone="warning">{isolate(c.refusal || tr("Print settings do not allow printing this record now."))}</Alert>}
              <Field label={tr("Format")} htmlFor={`${ids}-format`}>
                <select id={`${ids}-format`} data-autofocus className="select" value={choice.template ?? ""} onChange={(e) => set({ template: e.target.value || null })}>
                  {pages.map((x) => (
                    <option key={x.key} value={x.key}>
                      {isolate(x.label || x.key)}
                      {x.key === c.default ? ` (${tr("default")})` : ""}
                    </option>
                  ))}
                  {offerStandard && (
                    <option value="">
                      {isolate(c.standard?.label || tr("Standard"))}
                      {c.default === null ? ` (${tr("default")})` : ""}
                    </option>
                  )}
                </select>
              </Field>
              {level >= 1 && (
                <Field label={tr("Letter head")} htmlFor={`${ids}-lh`}>
                  <select id={`${ids}-lh`} className="select" value={choice.letterhead} onChange={(e) => set({ letterhead: e.target.value })}>
                    <option value="default">{defaultLh ? tr("Default: {name}", { name: defaultLh.name }) : tr("Default: none set")}</option>
                    <option value="none">{tr("None")}</option>
                    {(c.letterheads ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {isolate(l.name)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {level >= 1 && languages.length > 0 && (
                <Field label={tr("Language")} htmlFor={`${ids}-lang`} hint={tr("The paper reads in this language, whatever yours is.")}>
                  <select id={`${ids}-lang`} className="select" value={choice.language} onChange={(e) => set({ language: e.target.value })}>
                    <option value="">{tr("Your language")}</option>
                    {languages.map((l) => (
                      <option key={l} value={l}>{isolate(l)}</option>
                    ))}
                  </select>
                </Field>
              )}
              {level >= 1 && copies.length > 0 && (
                <fieldset>
                  <legend className="field-label">{tr("Copies")}</legend>
                  <div className="grid gap-1">
                    {copies.map((label) => (
                      <label key={label} className="check-field">
                        <input type="checkbox" checked={choice.copies.includes(label)} onChange={(e) => set({ copies: e.target.checked ? copies.filter((x) => x === label || choice.copies.includes(x)) : choice.copies.filter((x) => x !== label) })} />
                        {isolate(label)}
                      </label>
                    ))}
                  </div>
                  <p className="field-hint">{choice.copies.length ? tr("{n} copies, each on its own pages.", { n: choice.copies.length }) : tr("None ticked: one copy, unlabelled.")}</p>
                </fieldset>
              )}
              <p className="print-paper-line">{tr("Paper: {paper}", { paper: PAPER_NAMES(picked?.page) })}</p>
              {!pdf && <p className="field-hint">{tr("This server makes no PDFs: Print opens your browser's print, which can also save a PDF.")}</p>}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** The words for a refusal that means there is no PDF service (503). */
function noPdfService(e: unknown): string | null {
  return e instanceof ApiError && e.status === 503 ? tr("The PDF service is not answering. Print from the browser instead, or try again later.") : null;
}
