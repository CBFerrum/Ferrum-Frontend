import { useId, useRef } from "react";
import { t as tr, isolate } from "@ferrum/client";

/** The link fields of a record as chips that insert `links.<field>`: the records an expression may read. */
export const linkChips = (fields: { name: string; label?: string; type?: string }[]) =>
  fields.filter((f) => f.type === "link").map((f) => ({ name: `links.${f.name}`, label: f.label, insert: `links.${f.name}` }));

/** A condition in the server's expression language: the entity's fields as chips that insert `doc.name` (or
 *  the chip's own `insert` text, as `aggregates.unpaid`) where the cursor is, and the server's own words under it when it refused the condition. The browser
 *  does not read the expression: the server is the judge. */
export function ExprInput({ label, value, onChange, fields, links, error, hint, id: given, rows = 2 }: { links?: { name: string; label?: string; insert?: string }[]; label: string; value: string; onChange: (v: string) => void; fields: { name: string; label?: string; insert?: string }[]; error?: string | null; hint?: string; id?: string; rows?: number }) {
  const auto = useId();
  const id = given ?? auto;
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (text: string) => {
    const el = area.current;
    const from = el?.selectionStart ?? value.length;
    const to = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, from) + text + value.slice(to));
    // The caret goes after what was inserted, once the new value is drawn.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(from + text.length, from + text.length);
    });
  };
  // `links` given (even empty): the expression may read the records its link fields name, which the browser cannot check.
  if (links) hint = [hint, tr("Also: links, the records the link fields name")].filter(Boolean).join(" · ");
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${error ? "field-invalid" : ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <textarea ref={area} id={id} className="textarea mono" rows={rows} spellCheck={false} value={value} aria-invalid={error ? true : undefined} aria-describedby={described} onChange={(e) => onChange(e.target.value)} />
      {[...fields, ...(links ?? [])].length > 0 && (
        <div role="group" aria-label={tr("Insert a field")} className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {[...fields, ...(links ?? [])].map((f) => (
            <button key={f.name} type="button" className="chip" title={f.label ? isolate(f.label) : undefined} aria-label={tr("Insert {field}", { field: f.name })} onClick={() => insert(f.insert ?? `doc.${f.name}`)}>
              {isolate(f.name)}
            </button>
          ))}
        </div>
      )}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {isolate(error)}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
