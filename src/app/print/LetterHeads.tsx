// Letter heads (PRINT-FORMATS-SPEC §7.5, slice one): the list, and a form editor (not drag and drop yet) that writes a
// LetterHead record's header and footer blocks: a logo uploaded to the record, lines beside it (a company field or text
// with {tokens}), a footer line, heights; and whose default it is (a company's, the workspace's). The preview draws the
// unsaved letter head on blank paper with the sample record of a record type.

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useBlocker, useLocation, useNavigate, useParams } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, docPath, errorMessage } from "../../lib/api";
import { uploadFile } from "../../lib/files";
import { useMetaIndex, type Doc } from "../../lib/meta";
import { EMPTY_LETTERHEAD, letterHeadBlocks, letterHeadForm, validate, type Align, type LetterHeadForm, type PrintFormat } from "../../lib/printLayout";
import { Alert, Button, confirmDialog, Field, toast, useDebounced } from "../../ui/kit";
import { ButtonLink, LoadFailed, SaveStatus, StatePanel, TableSkeleton } from "../../ui/patterns";
import { Tools } from "../author/controls";
import { LinkInput } from "../widgets";
import { AdminGate, formatsLink, letterheadsLink, NeedsLevel, PaperFrame, preview, PRINT_SETTINGS_HREF, useCatalogue, type PreviewAsk } from "./shared";

interface LetterHeadRow { id: string; letter_head_name: string; company?: string | null; disabled?: boolean; _titles?: Record<string, string> }

export const useLetterheads = () =>
  useQuery({
    queryKey: ["print", "letterheads"],
    queryFn: ({ signal }) => api.get<{ rows: LetterHeadRow[] }>(docPath("LetterHead"), { fields: "id,letter_head_name,company,disabled", limit: 200, sort: "letter_head_name asc" }, signal).then((r) => r.rows),
    staleTime: 30_000,
    retry: false,
  });

/** The print settings record (a settings entity: one record). */
const usePrintSettings = () =>
  useQuery({
    queryKey: ["print", "settings"],
    queryFn: ({ signal }) => api.get<{ rows: Doc[] }>(docPath("PrintSettings"), { limit: 1 }, signal).then((r) => r.rows[0] ?? null),
    retry: false,
  });

function Head({ title, crumbs, actions }: { title: string; crumbs?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <p className="crumbs">
          <Link to="/customize">{tr("Customize")}</Link> / <Link to={formatsLink()}>{tr("Print formats")}</Link>
          {crumbs}
        </p>
        <h1 className="page-title">{title}</h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function LetterHeadsPage() {
  const q = useLetterheads();
  const settings = usePrintSettings();
  return (
    <div className="stack">
      <Head title={tr("Letter heads")} actions={<><ButtonLink href={PRINT_SETTINGS_HREF}>{tr("Print settings")}</ButtonLink><ButtonLink variant="primary" icon="plus" to={letterheadsLink("new")}>{tr("New letter head")}</ButtonLink></>} />
      <AdminGate>
        <NeedsLevel level={1}>
          <p className="muted">{tr("The company's name, logo and address at the top of every printed page, and a line at the foot. A company uses its own; the workspace's default covers the rest.")}</p>
          <section className="card">
            {q.isLoading ? (
              <TableSkeleton columns={4} rows={3} />
            ) : q.error ? (
              <LoadFailed error={q.error} onRetry={() => void q.refetch()} />
            ) : !q.data?.length ? (
              <StatePanel kind="empty" title={tr("No letter heads yet")} action={<ButtonLink variant="primary" icon="plus" to={letterheadsLink("new")}>{tr("New letter head")}</ButtonLink>}>
                {tr("Formats print without one until there is one.")}
              </StatePanel>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{tr("Letter head")}</th>
                      <th scope="col">{tr("Company")}</th>
                      <th scope="col">{tr("Default for")}</th>
                      <th scope="col">{tr("Can be printed")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.map((r) => (
                      <tr key={r.id}>
                        <td><Link to={letterheadsLink(r.id)}><strong>{isolate(r.letter_head_name)}</strong></Link></td>
                        <td>{r.company ? isolate(r._titles?.company ?? r.company) : <span className="faint">{tr("The workspace's")}</span>}</td>
                        <td>{settings.data?.letter_head === r.id ? tr("The workspace") : <span className="faint">—</span>}</td>
                        <td>{r.disabled ? tr("Off") : tr("On")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </NeedsLevel>
      </AdminGate>
    </div>
  );
}

export function LetterHeadPage() {
  const { id = "" } = useParams();
  const isNew = id === "new";
  const q = useQuery({ queryKey: ["print", "letterhead", id], queryFn: ({ signal }) => api.get<Doc>(docPath("LetterHead", id), undefined, signal), enabled: !isNew, retry: false });
  const name = (useLocation().state as { name?: string } | null)?.name;
  return (
    <div className="stack">
      <AdminGate>
        <NeedsLevel level={1}>
          {isNew ? (
            <Editor key="new" doc={null} />
          ) : q.isLoading ? (
            <>
              <Head title={name ?? tr("Letter head")} crumbs={<> / <Link to={letterheadsLink()}>{tr("Letter heads")}</Link></>} />
              <TableSkeleton columns={2} rows={5} />
            </>
          ) : q.error || !q.data ? (
            q.error instanceof ApiError && q.error.status === 404 ? <StatePanel kind="empty" title={tr("There is no such letter head")} action={<ButtonLink to={letterheadsLink()}>{tr("Back to the letter heads")}</ButtonLink>} /> : <LoadFailed error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            <Editor key={`${id}-${q.dataUpdatedAt}`} doc={q.data} />
          )}
        </NeedsLevel>
      </AdminGate>
    </div>
  );
}

const ALIGN_NAMES = (): Record<Align, string> => ({ start: tr("At the start"), center: tr("In the middle"), end: tr("At the end") });

function Editor({ doc }: { doc: Doc | null }) {
  const ids = useId();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const index = useMetaIndex();
  const settings = usePrintSettings();
  const read = doc ? letterHeadForm(doc.header, doc.footer) : { ...EMPTY_LETTERHEAD, lines: [{ kind: "field" as const, path: "company.company_name", bold: true }], footer: "Page {print.page} of {print.pages}" };
  const [form, setForm] = useState<LetterHeadForm>(read ?? { ...EMPTY_LETTERHEAD });
  const [name, setName] = useState(String(doc?.letter_head_name ?? ""));
  const [company, setCompany] = useState<string | null>((doc?.company as string | null) ?? null);
  const [heights, setHeights] = useState({ header: Number(doc?.header_height_mm ?? 30), footer: Number(doc?.footer_height_mm ?? 15) });
  const [disabled, setDisabled] = useState(!!doc?.disabled);
  const [version, setVersion] = useState<number | undefined>(typeof doc?.version === "number" ? doc.version : undefined);
  const [state, setState] = useState<"draft" | "saving" | "saved" | "failed" | "conflict">(doc ? "saved" : "draft");
  const [problems, setProblems] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const closing = useRef(false);
  const blocks = letterHeadBlocks(form);
  const body = { letter_head_name: name.trim(), company, header: blocks.header, footer: blocks.footer, header_height_mm: heights.header, footer_height_mm: heights.footer, disabled };
  const [base, setBase] = useState(() => (doc ? JSON.stringify(body) : ""));
  const dirty = !doc || JSON.stringify(body) !== base;
  const change = <T,>(set: (v: T) => void) => (v: T) => (set(v), setState("draft"), setProblems([]));
  const companyCat = useCatalogue("Company");
  const companyFields = (companyCat.data?.fields ?? []).map((f) => ({ path: f.path.replace(/^doc\./, "company."), label: f.label }));

  const blocker = useBlocker(({ currentLocation, nextLocation }) => !closing.current && dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: tr("Leave without saving?"), message: tr("Your changes to this letter head will be lost."), confirmLabel: tr("Leave"), danger: true }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker]);

  const save = async () => {
    const found = [
      ...(!name.trim() ? [tr("Give the letter head a name.")] : []),
      ...[...validate({ version: 1, sections: blocks.header.sections }, null, { letterhead: true }), ...validate({ version: 1, sections: blocks.footer.sections }, null, { letterhead: true })].map((p) => p.message),
    ];
    if (found.length) return setProblems(found);
    setState("saving");
    try {
      const saved = doc ? await api.patch<Doc>(docPath("LetterHead", String(doc.id)), body, { ifMatch: version }) : await api.post<Doc>(docPath("LetterHead"), body);
      closing.current = true;
      setVersion(typeof saved?.version === "number" ? saved.version : version);
      setBase(JSON.stringify(body));
      setState("saved");
      toast(tr("Letter head saved"));
      await qc.invalidateQueries({ queryKey: ["print"] });
      if (!doc && saved?.id) navigate(letterheadsLink(String(saved.id)), { replace: true, state: { name: name.trim() } });
    } catch (e) {
      setState(e instanceof ApiError && e.status === 409 ? "conflict" : "failed");
      setProblems(e instanceof ApiError && e.status === 409 ? [tr("Someone else changed this letter head. Copy what you changed, then reload the page.")] : e instanceof ApiError && e.fields.length ? e.fields.map((f) => `${f.field}: ${f.message}`) : [errorMessage(e)]);
    } finally {
      closing.current = false;
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file || !doc) return;
    if (file.size > 1024 * 1024) return toast(tr("A logo is at most 1 MB."), "error");
    setUploading(true);
    try {
      const f = await uploadFile(file, { entity: "LetterHead", id: String(doc.id) });
      change(setForm)({ ...form, logo: f.url.replace(/^.*(\/files\/)/, "$1") });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setUploading(false);
    }
  };

  const makeDefault = async (which: "company" | "workspace") => {
    try {
      if (which === "company" && company) {
        const c = await api.get<Doc>(docPath("Company", company));
        await api.patch(docPath("Company", company), { letter_head: doc!.id }, { ifMatch: c.version as number });
        toast(tr("Its company prints with this letter head now"));
      } else {
        // One settings record per workspace: until it is first saved there is none, and it is made by this save (§13 c).
        if (settings.data) await api.patch(docPath("PrintSettings", String(settings.data.id)), { letter_head: doc!.id }, { ifMatch: settings.data.version as number });
        else await api.post(docPath("PrintSettings"), { letter_head: doc!.id });
        toast(tr("Every company without its own prints with this letter head now"));
        await settings.refetch();
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const lines = form.lines;
  const setLines = (next: LetterHeadForm["lines"]) => change(setForm)({ ...form, lines: next });

  return (
    <>
      <Head
        title={name.trim() || tr("New letter head")}
        crumbs={<> / <Link to={letterheadsLink()}>{tr("Letter heads")}</Link></>}
        actions={
          <>
            <SaveStatus state={state === "saved" && dirty ? "draft" : state} />
            <Button variant="primary" loading={state === "saving"} disabled={state === "saving" || !dirty} onClick={() => void save()}>{tr("Save")}</Button>
          </>
        }
      />
      {!read && <Alert tone="warning">{tr("This letter head was made another way. Saving here replaces its header and footer with what this form shows.")}</Alert>}
      {problems.length > 0 && <Alert tone="error"><strong>{tr("The letter head was not saved")}</strong><ul>{problems.map((p, i) => <li key={i}>{isolate(p)}</li>)}</ul></Alert>}
      <div className="split-2">
        <div className="stack">
          <section className="card">
            <div className="card-body stack">
              <Field label={tr("Name")} htmlFor={`${ids}-name`} required>
                <input id={`${ids}-name`} className="input" maxLength={80} value={name} onChange={(e) => change(setName)(e.target.value)} />
              </Field>
              <div className="field">
                <span className="field-label" aria-hidden="true">{tr("Company")}</span>
                <LinkInput to="Company" value={company} onChange={(v) => change(setCompany)(v)} label={tr("Company")} placeholder={tr("Empty: the workspace's")} />
              </div>
              <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <legend className="field-label">{tr("Logo")}</legend>
                {!doc ? (
                  <p className="field-hint">{tr("Save the letter head first; then add its logo.")}</p>
                ) : (
                  <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
                    <input type="file" className="input" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" aria-label={tr("Logo file")} disabled={uploading} onChange={(e) => void upload(e.target.files?.[0])} style={{ maxWidth: 320 }} />
                    {form.logo && <span className="faint mono" dir="ltr">{form.logo}</span>}
                    {form.logo && <Button size="sm" icon="trash" onClick={() => change(setForm)({ ...form, logo: null })}>{tr("Remove the logo")}</Button>}
                  </div>
                )}
                <div className="pd-row">
                  <Field label={tr("Where")} htmlFor={`${ids}-pos`}>
                    <select id={`${ids}-pos`} className="select" value={form.logo_position} onChange={(e) => change(setForm)({ ...form, logo_position: e.target.value as Align })}>
                      {(["start", "center", "end"] as const).map((a) => <option key={a} value={a}>{ALIGN_NAMES()[a]}</option>)}
                    </select>
                  </Field>
                  <Field label={tr("Height (mm)")} htmlFor={`${ids}-lhh`}>
                    <input id={`${ids}-lhh`} className="input" type="number" min={5} max={60} value={form.logo_height_mm} onChange={(e) => change(setForm)({ ...form, logo_height_mm: Math.max(5, Math.min(60, Number(e.target.value))) })} />
                  </Field>
                </div>
              </fieldset>
              <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <legend className="field-label">{tr("Lines beside the logo")}</legend>
                {lines.map((l, i) => (
                  <div key={i} className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
                    {l.kind === "field" ? (
                      <select className="select" aria-label={tr("Line {n}: a company field", { n: i + 1 })} value={l.path} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...l, path: e.target.value } : x)))} style={{ flex: "1 1 200px" }}>
                        {!companyFields.some((f) => f.path === l.path) && <option value={l.path}>{l.path}</option>}
                        {companyFields.map((f) => <option key={f.path} value={f.path}>{isolate(f.label)}</option>)}
                      </select>
                    ) : (
                      <input className="input" aria-label={tr("Line {n}: text", { n: i + 1 })} value={l.text} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...l, text: e.target.value } : x)))} style={{ flex: "1 1 200px" }} />
                    )}
                    <label className="check-field">
                      <input type="checkbox" checked={!!l.bold} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, bold: e.target.checked || undefined } : x)))} />
                      {tr("Bold")}
                    </label>
                    <Tools index={i} count={lines.length} what={tr("line {n}", { n: i + 1 })} onMove={(by) => { const c = [...lines]; [c[i], c[i + by]] = [c[i + by], c[i]]; setLines(c); }} onRemove={() => setLines(lines.filter((_, j) => j !== i))} />
                  </div>
                ))}
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <Button size="sm" icon="plus" onClick={() => setLines([...lines, { kind: "field", path: companyFields[0]?.path ?? "company.company_name" }])}>{tr("A company field")}</Button>
                  <Button size="sm" icon="plus" onClick={() => setLines([...lines, { kind: "text", text: "" }])}>{tr("A line of text")}</Button>
                </div>
                <p className="field-hint">{tr("Text may name values in braces: {company.in_gstin}.")}</p>
                <Field label={tr("Lines are set")} htmlFor={`${ids}-la`}>
                  <select id={`${ids}-la`} className="select" value={form.lines_align} onChange={(e) => change(setForm)({ ...form, lines_align: e.target.value as Align })}>
                    {(["start", "center", "end"] as const).map((a) => <option key={a} value={a}>{ALIGN_NAMES()[a]}</option>)}
                  </select>
                </Field>
              </fieldset>
              <Field label={tr("Footer")} htmlFor={`${ids}-foot`} hint={tr("Printed at the foot of each page. {print.page} and {print.pages} number the pages of a PDF.")}>
                <input id={`${ids}-foot`} className="input" value={form.footer} onChange={(e) => change(setForm)({ ...form, footer: e.target.value })} />
              </Field>
              <div className="pd-row">
                <Field label={tr("Header height (mm)")} htmlFor={`${ids}-hh`}><input id={`${ids}-hh`} className="input" type="number" min={0} max={120} value={heights.header} onChange={(e) => change(setHeights)({ ...heights, header: Number(e.target.value) })} /></Field>
                <Field label={tr("Footer height (mm)")} htmlFor={`${ids}-fh`}><input id={`${ids}-fh`} className="input" type="number" min={0} max={80} value={heights.footer} onChange={(e) => change(setHeights)({ ...heights, footer: Number(e.target.value) })} /></Field>
              </div>
              <label className="check-field">
                <input type="checkbox" role="switch" checked={!disabled} onChange={(e) => change(setDisabled)(!e.target.checked)} />
                {tr("Can be printed")}
              </label>
              {doc && (
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <Button disabled={!company || dirty} title={!company ? tr("Choose its company first") : undefined} onClick={() => void makeDefault("company")}>{tr("Default for this company")}</Button>
                  <Button disabled={settings.isLoading || !!settings.error || dirty || settings.data?.letter_head === doc.id} onClick={() => void makeDefault("workspace")}>{settings.data?.letter_head === doc.id ? tr("The workspace's default") : tr("Make it the workspace's default")}</Button>
                </div>
              )}
            </div>
          </section>
        </div>
        <LetterHeadPreview form={form} id={doc ? String(doc.id) : undefined} company={company} heights={heights} entities={(index.data?.entities ?? []).filter((e) => e.kind === "document").map((e) => ({ name: e.name, label: e.label }))} />
      </div>
    </>
  );
}

/** The unsaved letter head, placed in a blank layout as its own sections, on the sample of a record type. */
function LetterHeadPreview({ form, entities, id, company, heights }: { form: LetterHeadForm; entities: { name: string; label: string }[]; id?: string; company: string | null; heights: { header: number; footer: number } }) {
  const ids = useId();
  const [entity, setEntity] = useState("");
  const ent = entity || entities.find((e) => e.name === "SalesInvoice")?.name || entities[0]?.name || "";
  const b = letterHeadBlocks(form);
  // The unsaved letter head itself is worn by a blank format on the sample record (§13 i, deviation 21); its own uploaded
  // images show when its id is given.
  const ask = useDebounced(
    JSON.stringify({
      template: { key: "letter_head_preview", label: "Preview", entity: ent, output: "page", layout: { version: 1, sections: [{ id: "lh_preview_body", columns: [{ id: "lh_preview_c", blocks: [{ id: "lh_preview_gap", type: "spacer", height_mm: 60 }] }] }] } } satisfies PrintFormat,
      letterhead: { ...(id ? { id } : {}), ...(company ? { company } : {}), header: b.header, footer: b.footer, header_height_mm: heights.header, footer_height_mm: heights.footer },
      sample: true,
    }),
    400,
  );
  const q = useQuery({ queryKey: ["admin", "print", "lh-preview", ask], queryFn: ({ signal }) => preview(JSON.parse(ask) as PreviewAsk, signal), enabled: !!ent && ask.includes(`"entity":${JSON.stringify(ent)}`), placeholderData: keepPreviousData, retry: false });
  return (
    <section className="card" aria-labelledby={`${ids}-h`}>
      <div className="card-head"><h2 id={`${ids}-h`}>{tr("Preview")}</h2></div>
      <div className="card-body stack">
        <Field label={tr("On the sample of")} htmlFor={`${ids}-e`}>
          <select id={`${ids}-e`} className="select" value={ent} onChange={(e) => setEntity(e.target.value)}>
            {entities.map((e) => <option key={e.name} value={e.name}>{isolate(e.label)}</option>)}
          </select>
        </Field>
        <PaperFrame title={tr("The letter head on paper")} html={q.data?.content} loading={q.isFetching} error={q.isError ? q.error : null} />
      </div>
    </section>
  );
}
