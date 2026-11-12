// What the print screens share (PRINT-FORMATS-SPEC §7): the paper a server's render is shown on, the administrators' gate, the
// format and catalogue requests, links. The render is the server's HTML in a frame without scripts: the dialog's and the
// template editor's preview with `sandbox=""`; the designer's own canvas reads its marks and is in Designer.tsx.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t as tr } from "@ferrum/client";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage, requestRaw, withPrintCsp } from "../../lib/api";
import { useMe, useServerInfo } from "../../lib/meta";
import { DEFAULT_MARGINS, MM_PX, paperMm, type Catalogue, type PageSetup, type PaperSize, type PrintFormat } from "../../lib/printLayout";
import { Alert, Field, Spinner } from "../../ui/kit";
import { StatePanel } from "../../ui/patterns";
import "./print.css";

export const formatsLink = (entity?: string) => (entity ? `/customize/print?entity=${encodeURIComponent(entity)}` : "/customize/print");
export const formatLink = (key: string) => `/customize/print/${encodeURIComponent(key)}`;
export const letterheadsLink = (id?: string) => (id ? `/customize/letterheads/${encodeURIComponent(id)}` : "/customize/letterheads");
export const PRINT_SETTINGS_HREF = "/open/PrintSettings";

/** The server's print level (§6.4): 0 before this work, 1 slice one, 2 the designer. */
export const usePrintLevel = () => {
  const q = useServerInfo();
  return { level: q.data?.print ?? 0, pdf: q.data?.pdf === true, ready: !q.isLoading };
};

/** Administrators only (D10), as message templates. */
export function AdminGate({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <StatePanel kind="loading" />;
  if (me.error) return <StatePanel kind="failed" error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data?.user.is_admin)
    return (
      <StatePanel kind="denied" title={tr("Administrator access required")}>
        {tr("Only administrators design print formats. Ask one of them to make this change.")}
      </StatePanel>
    );
  return <>{children}</>;
}

/** A server too old for print formats (§6.4): say so instead of calling what it does not have. */
export function NeedsLevel({ level, children }: { level: 1 | 2; children: ReactNode }) {
  const p = usePrintLevel();
  if (!p.ready) return <StatePanel kind="loading" />;
  if (p.level < level)
    return (
      <StatePanel kind="empty" title={level === 2 ? tr("This server cannot design layouts yet") : tr("This server has no print formats yet")}>
        {level === 2 ? tr("Its print level is {level}; the designer needs level 2. Template formats can still be edited.", { level: p.level }) : tr("Print formats come with a newer Ferrum server. Records still print in their standard format.")}
      </StatePanel>
    );
  return <>{children}</>;
}

export interface FormatRow {
  key: string;
  label?: string | null;
  entity: string;
  output: string;
  kind: "template" | "layout";
  default?: boolean;
  is_default?: boolean;
  enabled?: boolean;
  roles?: string[];
  languages?: string[];
  source: "package" | "workspace" | "edited";
  default_changed?: boolean;
  based_on?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
}
export interface FormatRead { template: PrintFormat; default: PrintFormat | null; edited: boolean; default_changed: boolean }

/** A format with the ETag the next save sends back as `If-Match` (§6.2). */
export async function readFormat(key: string, signal?: AbortSignal): Promise<FormatRead & { etag: string | null }> {
  const res = await requestRaw(`/api/admin/documents/templates/${encodeURIComponent(key)}`, { signal });
  const body = (await res.json()) as FormatRead & { etag?: string };
  return { ...body, etag: res.headers.get("etag") ?? body.etag ?? null };
}

/** Saves a format; `etag` (when known) makes a change by someone else since a 409. Gives the new ETag. */
export async function saveFormat(def: PrintFormat, etag: string | null): Promise<string | null> {
  const res = await requestRaw("/api/admin/documents/templates", { method: "POST", body: def, headers: etag ? { "if-match": etag } : undefined });
  return res.headers.get("etag");
}

export const useCatalogue = (entity: string | undefined) =>
  useQuery({
    queryKey: ["admin", "print", "fields", entity],
    queryFn: ({ signal }) => api.get<Catalogue>(`/api/admin/documents/fields/${encodeURIComponent(entity ?? "")}`, undefined, signal),
    enabled: !!entity,
    staleTime: 60_000,
  });

export const SOURCE_NAMES = (): Record<FormatRow["source"], string> => ({ package: tr("From the package"), edited: tr("Edited"), workspace: tr("Your own") });
export const KIND_NAMES = (): Record<FormatRow["kind"], string> => ({ layout: tr("Layout"), template: tr("Template") });
export const PAPER_NAMES = (page?: Pick<PageSetup, "size" | "orientation"> | null) =>
  page ? `${page.size === "Custom" ? tr("Custom paper") : page.size}, ${page.orientation === "landscape" ? tr("landscape") : tr("portrait")}` : tr("The print settings' paper");

/** The server's preview of a format (§6.2): HTML for the paper, or a PDF. */
export interface PreviewAnswer { language: string; output: string; kind?: string; content: string; header?: string | null; footer?: string | null; record_id?: string | null; warnings?: string[]; ms?: number }
export interface PreviewAsk { template: string | PrintFormat; record_id?: string | null; sample?: boolean; language?: string; letterhead?: string; copies?: string[]; mode?: "print" | "design" }
export const preview = (ask: PreviewAsk, signal?: AbortSignal) => api.post<PreviewAnswer>("/api/admin/documents/preview", ask, { signal });

/** A PDF the server makes, in a new tab. The tab is opened at once (inside the click, so pop-up blockers allow it) and filled in. */
export async function openPdf(make: () => Promise<Response>): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) throw new Error(tr("The print window was blocked. Allow pop-ups for this site and try again."));
  win.document.title = tr("Preparing the PDF…");
  win.document.body.textContent = tr("Preparing the PDF…");
  try {
    const blob = await (await make()).blob();
    const url = URL.createObjectURL(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    win.close();
    throw e;
  }
}

/** Prints HTML through the browser's own dialog from a frame that runs no script (it may open the print dialog, nothing else). */
export function printHtml(html: string): void {
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-same-origin allow-modals");
  f.setAttribute("aria-hidden", "true");
  f.tabIndex = -1;
  f.style.cssText = "position:fixed;inset-inline-start:-10000px;top:0;width:800px;height:600px;border:0;";
  f.onload = () => {
    try {
      f.contentWindow?.focus();
      f.contentWindow?.print();
    } finally {
      setTimeout(() => f.remove(), 60_000);
    }
  };
  f.srcdoc = withPrintCsp(html);
  document.body.append(f);
}

/** The width a box has, kept up to date. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * The server's render on paper: as wide as the page is (from its size in millimetres) and scaled to fit the pane, white in
 * every theme (it is paper). While the first render loads, a page of quiet lines; while a later one loads, the last stays
 * with a small spinner over it; a refusal is said in the pane, in the server's words.
 */
export function PaperFrame({ html, page, loading, error, title, maxScale = 1, fill }: { html?: string | null; page?: Pick<PageSetup, "size" | "orientation" | "width_mm" | "height_mm"> | null; loading?: boolean; error?: unknown; title: string; maxScale?: number; fill?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const mm = paperMm(page);
  const pw = mm.width * MM_PX;
  const ph = mm.height * MM_PX;
  const scale = width ? Math.min(maxScale, (width - 32) / pw) : 0;
  return (
    <div ref={ref} className={`pf-pane${fill ? " pf-pane-fill" : ""}`} aria-busy={loading || undefined}>
      {error ? (
        <div className="pf-pane-msg">
          <Alert tone="error">
            <strong>{tr("This format cannot print this record")}</strong>
            <div>{errorMessage(error)}</div>
          </Alert>
        </div>
      ) : null}
      {scale > 0 && !(error && !html) && (
        <div className="pf-paper-box" style={{ width: pw * scale, height: ph * scale }}>
          <div className="pf-paper" style={{ width: pw, height: ph, transform: `scale(${scale})` }}>
            {html ? (
              <iframe title={title} sandbox="" srcDoc={withPrintCsp(html)} className="pf-frame" />
            ) : (
              <div role="status" aria-label={tr("Loading the preview…")} className="pf-paper-skeleton motion-reduce:[&_[data-slot=skeleton]]:animate-none">
                <div aria-hidden="true" className="grid gap-6">
                  <div className="flex justify-between gap-8">
                    <Skeleton className="h-8 w-1/3" />
                    <div className="grid w-1/4 gap-2"><Skeleton className="h-3" /><Skeleton className="h-3" /><Skeleton className="h-3" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-6">{[0, 1, 2].map((i) => <div key={i} className="grid gap-2"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3" /><Skeleton className="h-3 w-4/5" /></div>)}</div>
                  <div className="grid gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-4" />)}</div>
                  <div className="ms-auto grid w-2/5 gap-2"><Skeleton className="h-3" /><Skeleton className="h-3" /><Skeleton className="h-5" /></div>
                </div>
              </div>
            )}
          </div>
          {loading && html && (
            <div className="pf-busy">
              <Spinner small label={tr("Loading the preview…")} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Paper and margins; none: the print settings' (a template with no page keeps its own @page). */
export function PageFields({ page, onChange }: { page?: PageSetup; onChange: (p: Partial<PageSetup> | null) => void }) {
  const ids = useId();
  const m = page?.margin_mm ?? DEFAULT_MARGINS;
  return (
    <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className="field-label">{tr("Paper")}</legend>
      <div className="pd-row">
        <Field label={tr("Size")} htmlFor={`${ids}-size`}>
          <select id={`${ids}-size`} className="select" value={page?.size ?? ""} onChange={(e) => onChange(e.target.value ? { size: e.target.value as PaperSize } : null)}>
            <option value="">{tr("The print settings'")}</option>
            {(["A4", "A5", "A3", "Letter", "Legal", "Custom"] as const).map((s) => <option key={s} value={s}>{s === "Custom" ? tr("Custom") : s}</option>)}
          </select>
        </Field>
        {page && (
          <Field label={tr("Orientation")} htmlFor={`${ids}-or`}>
            <select id={`${ids}-or`} className="select" value={page.orientation} onChange={(e) => onChange({ orientation: e.target.value as PageSetup["orientation"] })}>
              <option value="portrait">{tr("Portrait")}</option>
              <option value="landscape">{tr("Landscape")}</option>
            </select>
          </Field>
        )}
      </div>
      {page?.size === "Custom" && (
        <div className="pd-row">
          <Field label={tr("Width (mm)")} htmlFor={`${ids}-w`}><input id={`${ids}-w`} className="input" type="number" min={40} max={600} value={page.width_mm ?? 210} onChange={(e) => onChange({ width_mm: Number(e.target.value) })} /></Field>
          <Field label={tr("Height (mm)")} htmlFor={`${ids}-h`}><input id={`${ids}-h`} className="input" type="number" min={40} max={600} value={page.height_mm ?? 297} onChange={(e) => onChange({ height_mm: Number(e.target.value) })} /></Field>
        </div>
      )}
      {page && (
        <div className="pd-row">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <Field key={side} label={{ top: tr("Top"), right: tr("Right"), bottom: tr("Bottom"), left: tr("Left") }[side]} htmlFor={`${ids}-m-${side}`}>
              <input id={`${ids}-m-${side}`} className="input" type="number" min={0} max={50} value={m[side]} onChange={(e) => onChange({ margin_mm: { ...m, [side]: Math.max(0, Math.min(50, Number(e.target.value))) } })} />
            </Field>
          ))}
        </div>
      )}
      {page && <p className="field-hint">{tr("Margins in millimetres, 0 to 50.")}</p>}
    </fieldset>
  );
}

