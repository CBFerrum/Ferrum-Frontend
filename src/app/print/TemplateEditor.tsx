// The template editor (PRINT-FORMATS-SPEC §7.4): a MiniJinja format's body, header and footer per language in a plain code area
// with line numbers (D15: no editor library), the server's refusals marked at their line; the variables and helpers a body may
// use, from the field catalogue (a click inserts it at the caret); the page and letter head; the server's preview against a
// record chosen by search, and a test PDF. Saves with If-Match: when someone else saved first, theirs and yours are shown.

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useBlocker, useNavigate } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { ApiError, errorMessage, requestRaw } from "../../lib/api";
import { DEFAULT_MARGINS, templateErrorAt, toSave, type Catalogue, type PageSetup, type PrintFormat } from "../../lib/printLayout";
import { Alert, Badge, Button, confirmDialog, Dialog, Field, Tabs, TabPanel, toast, useDebounced } from "../../ui/kit";
import { SaveStatus } from "../../ui/patterns";
import { LinkInput } from "../widgets";
import { formatsLink, openPdf, PageFields, PaperFrame, preview, readFormat, saveFormat, useCatalogue, type FormatRead } from "./shared";
import { useLetterheads } from "./LetterHeads";

type Part = "body" | "header" | "footer";
const PARTS: Part[] = ["body", "header", "footer"];
const PART_NAMES = (): Record<Part, string> => ({ body: tr("Body"), header: tr("Header (each PDF page)"), footer: tr("Footer (each PDF page)") });

/** The helpers a body may call (platform docs/api.md, Documents). */
const HELPERS: [string, string][] = [
  ["{{ doc.grand_total|amount }}", "an amount with its currency"],
  ["{{ doc.grand_total|words }}", "an amount in words"],
  ["{{ doc.posting_date|date('long') }}", "a date, short or long"],
  ["{{ doc.qty|number(2) }}", "a number grouped as the language writes it"],
  ["{{ doc.items|total('amount') }}", "the exact sum of a column"],
  ["{{ barcode(doc.number) }}", "a Code 128 or EAN-13 barcode"],
  ["{{ qr(doc.number) }}", "a QR code"],
  ["{{ image(company.acc_logo) }}", "an image file as the PDF can print it"],
  ["{{ print.copy }}", "the copy's label (Original, Duplicate)"],
  ["{{ page_number() }} / {{ page_count() }}", "in a header or footer: the page and how many"],
];
const HELPER_WORDS = (): Record<string, string> => ({
  "an amount with its currency": tr("an amount with its currency"),
  "an amount in words": tr("an amount in words"),
  "a date, short or long": tr("a date, short or long"),
  "a number grouped as the language writes it": tr("a number grouped as the language writes it"),
  "the exact sum of a column": tr("the exact sum of a column"),
  "a Code 128 or EAN-13 barcode": tr("a Code 128 or EAN-13 barcode"),
  "a QR code": tr("a QR code"),
  "an image file as the PDF can print it": tr("an image file as the PDF can print it"),
  "the copy's label (Original, Duplicate)": tr("the copy's label (Original, Duplicate)"),
  "in a header or footer: the page and how many": tr("in a header or footer: the page and how many"),
});

/** A plain code area with line numbers; `bad` lines are marked in the gutter. */
export function CodeArea({ id, value, onChange, bad, label, rows = 12, readOnly, onFocusArea, describedBy }: { id: string; value: string; onChange?: (v: string) => void; bad?: number | null; label: string; rows?: number; readOnly?: boolean; onFocusArea?: (el: HTMLTextAreaElement) => void; describedBy?: string }) {
  const gutter = useRef<HTMLPreElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const lines = Math.max(rows, value.split("\n").length);
  useEffect(() => {
    if (bad && area.current) area.current.scrollTop = Math.max(0, (bad - 3) * 20);
  }, [bad]);
  return (
    <div className="code-area" aria-invalid={bad ? true : undefined}>
      <pre className="code-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={bad === i + 1 ? "bad" : undefined}>{i + 1}</div>
        ))}
      </pre>
      <textarea
        id={id}
        ref={area}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={bad ? true : undefined}
        rows={rows}
        dir="ltr"
        wrap="off"
        spellCheck={false}
        autoCapitalize="none"
        readOnly={readOnly}
        value={value}
        onFocus={(e) => onFocusArea?.(e.currentTarget)}
        onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          // Tab indents (two spaces); Escape then Tab leaves, as the platform's own code editors do.
          if (e.key === "Tab" && !e.shiftKey && !readOnly && e.currentTarget.dataset.escaped !== "1") {
            e.preventDefault();
            e.currentTarget.setRangeText("  ", e.currentTarget.selectionStart, e.currentTarget.selectionEnd, "end");
            onChange?.(e.currentTarget.value);
          }
          e.currentTarget.dataset.escaped = e.key === "Escape" ? "1" : "";
        }}
      />
    </div>
  );
}

export function TemplateEditor({ read, fresh }: { read?: FormatRead & { etag: string | null }; fresh?: PrintFormat }) {
  const ids = useId();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const start = read?.template ?? fresh!;
  const [def, setDef] = useState<PrintFormat>(() => structuredClone({ ...start, languages: start.languages && Object.keys(start.languages).length ? start.languages : { en: { body: "" } } }));
  const [etag, setEtag] = useState(read?.etag ?? null);
  const [base, setBase] = useState(() => (read ? JSON.stringify(toSave(read.template)) : ""));
  const [lang, setLang] = useState(() => Object.keys(def.languages ?? {})[0] ?? "en");
  const [state, setState] = useState<"draft" | "saving" | "saved" | "failed" | "conflict">("saved");
  const [problems, setProblems] = useState<string[]>([]);
  const [at, setAt] = useState<ReturnType<typeof templateErrorAt>>(null);
  const [conflict, setConflict] = useState<(FormatRead & { etag: string | null }) | null>(null);
  const [showDefault, setShowDefault] = useState(false);
  const [newLang, setNewLang] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(read ? new Date().toISOString() : null);
  const lastArea = useRef<{ el: HTMLTextAreaElement; part: Part } | null>(null);
  const closing = useRef(false);
  const isNew = !read;
  const dirty = isNew || JSON.stringify(toSave(def)) !== base;
  const langs = Object.keys(def.languages ?? {});
  const cat = useCatalogue(def.entity);
  const lhs = useLetterheads();

  const edit = (next: PrintFormat) => (setDef(next), setProblems([]), setState("draft"));
  const setPart = (l: string, part: Part, text: string) => edit({ ...def, languages: { ...def.languages, [l]: { ...def.languages![l], [part]: part === "body" ? text : text || undefined } } });

  const blocker = useBlocker(({ currentLocation, nextLocation }) => !closing.current && dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: tr("Leave without saving?"), message: tr("Your changes to this format will be lost."), confirmLabel: tr("Leave"), danger: true }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const refusal = (e: unknown) => {
    const msgs = e instanceof ApiError && e.fields.length ? e.fields.map((f) => f.message) : [errorMessage(e)];
    const where = msgs.map(templateErrorAt).find(Boolean) ?? null;
    setAt(where);
    if (where) setLang(where.language);
    setProblems(msgs);
  };

  const save = async (over?: string | null) => {
    const empty = langs.filter((l) => !def.languages![l].body.trim());
    if (!def.label?.trim() || empty.length) return setProblems([...(!def.label?.trim() ? [tr("Give the format a name.")] : []), ...empty.map((l) => tr("{language}: the body is empty.", { language: l }))]);
    setState("saving");
    setAt(null);
    try {
      const next = await saveFormat(toSave(def), over !== undefined ? over : etag);
      closing.current = true;
      setEtag(next);
      setBase(JSON.stringify(toSave(def)));
      setState("saved");
      setSavedAt(new Date().toISOString());
      setConflict(null);
      toast(tr("Format saved"));
      await qc.invalidateQueries({ queryKey: ["admin", "print"] });
      if (isNew) navigate(`/customize/print/${encodeURIComponent(def.key)}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setState("conflict");
        setConflict(await readFormat(def.key).catch(() => null));
      } else {
        setState("failed");
        refusal(e);
      }
    } finally {
      closing.current = false;
    }
  };

  const insert = (text: string) => {
    const a = lastArea.current;
    if (!a || !document.body.contains(a.el)) return toast(tr("Click in a body first: the value goes where the caret is."), "info");
    a.el.setRangeText(text, a.el.selectionStart, a.el.selectionEnd, "end");
    setPart(lang, a.part, a.el.value);
    a.el.focus();
  };

  const page = def.page;
  const setPage = (p: Partial<PageSetup> | null) => edit({ ...def, page: p === null ? undefined : { size: "A4", orientation: "portrait", margin_mm: DEFAULT_MARGINS, ...page, ...p } });
  const theirs = read?.default?.languages?.[lang];
  const b = def.languages?.[lang];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/customize">{tr("Customize")}</Link> / <Link to={formatsLink(def.entity)}>{tr("Print formats")}</Link>
          </p>
          <h1 className="page-title">{isolate(def.label || def.key)}</h1>
          <p className="page-sub">
            <span className="mono">{isolate(def.key)}</span> · {tr("Template")}
            {def.based_on ? ` · ${tr("Based on {key}", { key: def.based_on })}` : ""}
          </p>
        </div>
        <div className="page-actions">
          <SaveStatus state={state === "saved" && dirty ? "draft" : state} at={state === "saved" ? savedAt : null} />
          <Button variant="primary" loading={state === "saving"} disabled={state === "saving" || !dirty} onClick={() => void save()}>{tr("Save")}</Button>
        </div>
      </div>
      {read?.default_changed && <Alert tone="warning">{tr("The package's format has changed since you edited this copy. Yours is still what prints; compare it below.")}</Alert>}
      {problems.length > 0 && (
        <Alert tone="error">
          <strong>{tr("The format was not saved")}</strong>
          <ul>{problems.map((p, i) => <li key={i}>{isolate(p)}</li>)}</ul>
        </Alert>
      )}

      <div className="split-side">
        <div className="stack">
          <section className="card" aria-labelledby={`${ids}-bodies`}>
            <div className="card-head">
              <h2 id={`${ids}-bodies`}>{tr("The page")}</h2>
              <span className="spacer" />
              {read?.default && (
                <label className="check-field">
                  <input type="checkbox" checked={showDefault} onChange={(e) => setShowDefault(e.target.checked)} />
                  {tr("Show the package's beside it")}
                </label>
              )}
            </div>
            <div className="card-body stack">
              <Tabs id={`${ids}-lang`} tabs={langs.map((l) => ({ id: l, label: at?.language === l ? `${l} ⚠` : l }))} value={lang} onChange={setLang} />
              {b && (
                <TabPanel id={`${ids}-lang`} tab={lang}>
                  <div className="stack">
                    {PARTS.map((part) => {
                      const bad = at && at.language === lang && at.part === part ? at.line : null;
                      const fid = `${ids}-${lang}-${part}`;
                      const area = (
                        <CodeArea id={fid} label={tr("{part} in {language}", { part: PART_NAMES()[part], language: lang })} rows={part === "body" ? 18 : 3} value={b[part] ?? ""} bad={bad} describedBy={bad ? `${fid}-err` : undefined} onChange={(v) => setPart(lang, part, v)} onFocusArea={(el) => (lastArea.current = { el, part })} />
                      );
                      return (
                        <div key={part} className="field">
                          <label className="field-label" htmlFor={fid}>{PART_NAMES()[part]}</label>
                          {showDefault ? (
                            <div className="split-2">
                              {area}
                              <CodeArea id={`${fid}-pkg`} label={tr("The package's {part}", { part: PART_NAMES()[part] })} rows={part === "body" ? 18 : 3} value={theirs?.[part] ?? ""} readOnly />
                            </div>
                          ) : area}
                          {bad && <p className="field-error" id={`${fid}-err`} role="alert">{tr("Line {line}: {text}", { line: bad, text: at!.text })}</p>}
                        </div>
                      );
                    })}
                    <div>
                      <Button size="sm" icon="trash" disabled={langs.length < 2} onClick={() => { const { [lang]: _, ...rest } = def.languages!; void _; edit({ ...def, languages: rest }); setLang(Object.keys(rest)[0]); }}>{tr("Remove {language}", { language: lang })}</Button>
                    </div>
                  </div>
                </TabPanel>
              )}
              <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
                <Field label={tr("Add a language")} htmlFor={`${ids}-newlang`} hint={tr("Like hi or ar. It starts as a copy of {language}.", { language: lang })}>
                  <input id={`${ids}-newlang`} className="input" dir="ltr" style={{ width: 120 }} value={newLang} onChange={(e) => setNewLang(e.target.value.trim())} />
                </Field>
                <Button icon="plus" disabled={!/^[A-Za-z0-9-]{1,20}$/.test(newLang) || !!def.languages?.[newLang]} onClick={() => (edit({ ...def, languages: { ...def.languages, [newLang]: structuredClone(def.languages![lang]) } }), setLang(newLang), setNewLang(""))}>{tr("Add")}</Button>
              </div>
            </div>
          </section>
          <TryIt def={def} />
        </div>
        <div className="stack">
          <Reference cat={cat.data} loading={cat.isLoading} error={cat.error} onInsert={insert} />
          <section className="card" aria-labelledby={`${ids}-about`}>
            <div className="card-head"><h2 id={`${ids}-about`}>{tr("About the format")}</h2></div>
            <div className="card-body stack">
              <Field label={tr("Name")} htmlFor={`${ids}-label`} required>
                <input id={`${ids}-label`} className="input" maxLength={80} value={def.label ?? ""} onChange={(e) => edit({ ...def, label: e.target.value })} />
              </Field>
              <label className="check-field">
                <input type="checkbox" role="switch" checked={def.enabled !== false} onChange={(e) => edit({ ...def, enabled: e.target.checked })} />
                {tr("Can be printed")}
              </label>
              <Field label={tr("Who may use it")} htmlFor={`${ids}-roles`} hint={tr("Role names separated by commas. Empty: everyone who may read the record.")}>
                <input id={`${ids}-roles`} className="input" value={(def.roles ?? []).join(", ")} onChange={(e) => edit({ ...def, roles: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
              </Field>
              <Field label={tr("Letter head")} htmlFor={`${ids}-lh`}>
                <select id={`${ids}-lh`} className="select" value={def.letterhead ?? "default"} onChange={(e) => edit({ ...def, letterhead: e.target.value })}>
                  <option value="default">{tr("The record's company's")}</option>
                  <option value="none">{tr("None")}</option>
                  {(lhs.data ?? []).map((l) => <option key={l.id} value={l.id}>{isolate(l.letter_head_name)}</option>)}
                </select>
              </Field>
              <Field label={tr("Copies offered")} htmlFor={`${ids}-copies`} hint={tr("One label a line, at most 5. Empty: the print settings' labels.")}>
                <textarea id={`${ids}-copies`} className="textarea" rows={3} value={(def.copies ?? []).join("\n")} onChange={(e) => edit({ ...def, copies: e.target.value.split("\n").map((x) => x.trimStart()).slice(0, 5) })} />
              </Field>
              <PageFields page={page} onChange={setPage} />
            </div>
          </section>
        </div>
      </div>

      {conflict && (
        <Dialog
          open
          wide
          onClose={() => setConflict(null)}
          title={tr("Someone else changed this format")}
          description={tr("They saved it while you were editing. Keep theirs, or save yours over it.")}
          footer={
            <>
              <Button onClick={() => (setDef(structuredClone(conflict.template)), setEtag(conflict.etag), setBase(JSON.stringify(toSave(conflict.template))), setState("saved"), setConflict(null))}>{tr("Keep theirs")}</Button>
              <Button variant="primary" onClick={() => void save(conflict.etag)}>{tr("Save mine over theirs")}</Button>
            </>
          }
        >
          <div className="split-2">
            <div className="field">
              <label className="field-label" htmlFor={`${ids}-theirs`}>{tr("Theirs, saved ({language} body)", { language: lang })}</label>
              <CodeArea id={`${ids}-theirs`} label={tr("Theirs")} readOnly rows={14} value={conflict.template.languages?.[lang]?.body ?? JSON.stringify(conflict.template, null, 1)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${ids}-mine`}>{tr("Yours, not saved ({language} body)", { language: lang })}</label>
              <CodeArea id={`${ids}-mine`} label={tr("Yours")} readOnly rows={14} value={def.languages?.[lang]?.body ?? ""} />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** What a body may read, from the field catalogue, and the helpers; a click inserts it where the caret was. */
function Reference({ cat, loading, error, onInsert }: { cat?: Catalogue; loading: boolean; error: unknown; onInsert: (text: string) => void }) {
  const ids = useId();
  const [q, setQ] = useState("");
  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const groups: [string, { label: string; path: string; insert: string }[]][] = cat
    ? [
        [tr("Fields"), [...cat.fields, ...cat.system].map((f) => ({ label: f.label, path: f.path, insert: `{{ ${f.path} }}` }))],
        [tr("Lines"), cat.tables.flatMap((t) => [{ label: t.label, path: t.path, insert: `{% for row in ${t.path} %}\n  {{ row.${t.columns[0]?.path.slice(4) ?? "name"} }}\n{% endfor %}` }, ...t.columns.map((c) => ({ label: `${t.label} › ${c.label}`, path: c.path, insert: `{{ ${c.path} }}` }))])],
        [tr("Linked records"), cat.links.flatMap((l) => l.fields.map((f) => ({ label: `${l.label} › ${f.label}`, path: f.path, insert: `{{ ${f.path} }}` })))],
        [tr("Company"), (cat.company ?? []).map((f) => ({ label: f.label, path: f.path, insert: `{{ ${f.path} }}` }))],
        [tr("Print"), cat.print.map((f) => ({ label: f.label, path: f.path, insert: `{{ ${f.path} }}` }))],
        [tr("Helpers"), HELPERS.map(([code, words]) => ({ label: HELPER_WORDS()[words] ?? words, path: code, insert: code }))],
      ]
    : [];
  return (
    <section className="card" aria-labelledby={`${ids}-h`}>
      <div className="card-head"><h2 id={`${ids}-h`}>{tr("What a body can print")}</h2></div>
      <div className="card-body stack">
        <input className="input" type="search" aria-label={tr("Find a field")} placeholder={tr("Find a field")} value={q} onChange={(e) => setQ(e.target.value)} />
        {loading ? (
          <p className="faint">{tr("Loading…")}</p>
        ) : error ? (
          <Alert tone="error">{isolate(errorMessage(error))}</Alert>
        ) : (
          <ul className="ref-list" aria-label={tr("Fields and helpers")}>
            {groups.map(([name, items]) => {
              const shown = items.filter((x) => match(x.label) || match(x.path));
              return shown.length ? (
                <li key={name}>
                  <p className="pd-group">{name}</p>
                  {shown.map((x) => (
                    <button key={x.label + x.path} type="button" className="ref-item" title={x.insert} onClick={() => onInsert(x.insert)}>
                      <span>{isolate(x.label)}</span>
                      <code dir="ltr">{x.path}</code>
                    </button>
                  ))}
                </li>
              ) : null;
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The format against a record (or the sample), unsaved changes included; a test PDF. */
function TryIt({ def }: { def: PrintFormat }) {
  const ids = useId();
  const [record, setRecord] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const sent = useDebounced(JSON.stringify(toSave(def)), 600);
  const ask = { template: JSON.parse(sent) as PrintFormat, record_id: record, sample: !record, ...(language ? { language } : {}) };
  const q = useQuery({ queryKey: ["admin", "print", "preview", ask], queryFn: ({ signal }) => preview(ask, signal), placeholderData: keepPreviousData, retry: false });
  // `content` is the page as it prints, letter head and watermark included; `header`/`footer` are only what a PDF repeats.
  const html = q.data?.content ?? null;
  return (
    <section className="card" aria-labelledby={`${ids}-h`}>
      <div className="card-head">
        <h2 id={`${ids}-h`}>{tr("Preview")}</h2>
        <span className="spacer" />
        <Button size="sm" icon="printer" onClick={() => void openPdf(() => requestRaw("/api/admin/documents/preview", { method: "POST", body: { ...ask, format: "pdf" } })).catch((e) => toast(errorMessage(e), "error"))}>{tr("Test print")}</Button>
      </div>
      <div className="card-body stack">
        <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <LinkInput to={def.entity} value={record} onChange={(id) => setRecord(id)} label={tr("Record")} placeholder={tr("The sample record")} />
          </div>
          <Field label={tr("Language")} htmlFor={`${ids}-lang`}>
            <select id={`${ids}-lang`} className="select" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">{tr("Yours")}</option>
              {Object.keys(def.languages ?? {}).map((l) => <option key={l} value={l}>{isolate(l)}</option>)}
            </select>
          </Field>
        </div>
        {q.data?.warnings?.length ? <Alert tone="warning">{q.data.warnings.map((w, i) => <div key={i}>{isolate(w)}</div>)}</Alert> : null}
        <PaperFrame title={tr("Preview of {name}", { name: def.label || def.key })} html={html} page={def.page} loading={q.isFetching} error={q.isError ? q.error : null} />
        {q.data?.ms !== undefined && <p className="faint">{tr("Rendered in {ms} ms", { ms: q.data.ms })}{!record && ` · ${tr("on the sample record")}`}</p>}
        {!q.data && !q.isError && <Badge>{tr("Rendering…")}</Badge>}
      </div>
    </section>
  );
}
