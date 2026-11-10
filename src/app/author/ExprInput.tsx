import { useId, useRef } from "react";
import { t as tr, isolate } from "@ferrum/client";

/** A condition in the server's expression language: the entity's fields as chips that insert `doc.name`
 *  where the cursor is, and the server's own words under it when it refused the condition. The browser
 *  does not read the expression: the server is the judge. */
export function ExprInput({ label, value, onChange, fields, error, hint }: { label: string; value: string; onChange: (v: string) => void; fields: { name: string; label?: string }[]; error?: string | null; hint?: string }) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (name: string) => {
    const el = area.current;
    const text = `doc.${name}`;
    const from = el?.selectionStart ?? value.length;
    const to = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, from) + text + value.slice(to));
    // The caret goes after what was inserted, once the new value is drawn.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(from + text.length, from + text.length);
    });
  };
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${error ? "field-invalid" : ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <textarea ref={area} id={id} className="textarea mono" rows={2} spellCheck={false} value={value} aria-invalid={error ? true : undefined} aria-describedby={described} onChange={(e) => onChange(e.target.value)} />
      {fields.length > 0 && (
        <div role="group" aria-label={tr("Insert a field")} className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {fields.map((f) => (
            <button key={f.name} type="button" className="chip" title={f.label ? isolate(f.label) : undefined} aria-label={tr("Insert {field}", { field: f.name })} onClick={() => insert(f.name)}>
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
