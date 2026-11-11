// Controls the authoring screens share: a select with a "Choose…" first option, the move/remove buttons of a
// list item, and the rows of list filters (field, comparison, value in the list API's `[field, op, value]` form).

import { t as tr, isolate } from "@ferrum/client";
import { filterText, filterValue, MAX_FILTERS, newFilter, newKey, opsFor, type FilterRow, type Row } from "../../lib/automationDraft";
import type { Field as MetaField } from "../../lib/meta";
import { Button } from "../../ui/kit";

export const grow = { flex: "1 1 160px", minWidth: 0 } as const;
export const wrap = { flexWrap: "wrap", alignItems: "flex-end" } as const;
export const optionsOf = (fields: Pick<MetaField, "name" | "label">[], keep = "") => {
  const o = fields.map((f) => ({ value: f.name, label: f.label || f.name }));
  return keep && !o.some((x) => x.value === keep) ? [...o, { value: keep, label: keep }] : o;
};

/** A select with a "Choose…" first option. */
export function Pick({ label, value, onChange, options, id }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; id?: string }) {
  return (
    <select id={id} className="select" aria-label={id ? undefined : label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{tr("Choose…")}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{isolate(o.label)}</option>
      ))}
    </select>
  );
}

export function Tools({ index, count, what, onMove, onRemove }: { index: number; count: number; what: string; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <Button size="sm" icon="up" disabled={index === 0} aria-label={tr("Move {name} up", { name: what })} onClick={() => onMove(-1)} />
      <Button size="sm" icon="down" disabled={index === count - 1} aria-label={tr("Move {name} down", { name: what })} onClick={() => onMove(1)} />
      <Button size="sm" icon="trash" aria-label={tr("Remove {name}", { name: what })} onClick={onRemove} />
    </div>
  );
}

const OP_NAMES = (): Record<string, string> => ({
  "=": tr("is"), "!=": tr("is not"), ">": tr("is more than"), ">=": tr("is at least"), "<": tr("is less than"), "<=": tr("is at most"), like: tr("contains"), "is:set": tr("is filled in"), "is:not set": tr("is empty"),
});

export function FilterRows({ rows, fields, onChange }: { rows: FilterRow[]; fields: MetaField[]; onChange: (r: FilterRow[]) => void }) {
  const edit = (key: string, patch: Partial<FilterRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="stack">
      {rows.map((r, i) => {
        const f = fields.find((x) => x.name === r.field);
        const ty = f?.type;
        const op = r.op === "is" ? `is:${r.value === "not set" ? "not set" : "set"}` : r.op;
        const text = filterText(r.op, r.value);
        const setText = (v: string) => edit(r.key, { value: filterValue(ty, r.op, v) });
        return (
          <div key={r.key} className="row" style={wrap}>
            <div style={grow}>
              <Pick label={tr("Field of filter {n}", { n: i + 1 })} value={r.field} options={optionsOf(fields, r.field)} onChange={(v) => edit(r.key, { field: v, op: "=", value: "" })} />
            </div>
            <select className="select" style={grow} aria-label={tr("Comparison of filter {n}", { n: i + 1 })} value={op} onChange={(e) => {
              const v = e.target.value;
              edit(r.key, v.startsWith("is:") ? { op: "is", value: v.slice(3) } : { op: v, value: filterValue(ty, v, r.op === "is" ? "" : text) });
            }}>
              {[...opsFor(ty).filter((o) => o !== "is"), "is:set", "is:not set"].map((o) => (
                <option key={o} value={o}>{OP_NAMES()[o]}</option>
              ))}
              {!(op in OP_NAMES()) && <option value={op}>{isolate(op)}</option>}
            </select>
            {r.op !== "is" &&
              (ty === "check" ? (
                <select className="select" style={grow} aria-label={tr("Value of filter {n}", { n: i + 1 })} value={r.value === true ? "true" : "false"} onChange={(e) => setText(e.target.value)}>
                  <option value="true">{tr("Yes")}</option>
                  <option value="false">{tr("No")}</option>
                </select>
              ) : ty === "select" && f?.options?.length ? (
                <select className="select" style={grow} aria-label={tr("Value of filter {n}", { n: i + 1 })} value={text} onChange={(e) => setText(e.target.value)}>
                  <option value="">{tr("Choose…")}</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>{isolate(o)}</option>
                  ))}
                </select>
              ) : (
                <input className="input" style={grow} type={ty === "date" ? "date" : "text"} inputMode={ty === "int" ? "numeric" : undefined} aria-label={tr("Value of filter {n}", { n: i + 1 })} value={text} onChange={(e) => setText(e.target.value)} />
              ))}
            <Button size="sm" icon="trash" aria-label={tr("Remove filter {n}", { n: i + 1 })} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
          </div>
        );
      })}
      <div>
        <Button size="sm" icon="plus" disabled={rows.length >= MAX_FILTERS} onClick={() => onChange([...rows, newFilter()])}>{tr("Add a filter")}</Button>
        {rows.length >= MAX_FILTERS && <span className="faint"> {tr("At most {n} filters.", { n: MAX_FILTERS })}</span>}
      </div>
    </div>
  );
}

/** Rows of field → expression. */
export function Rows({ rows, fields, onChange, what, typed }: { /** Names are typed: the fields are not known. */ typed?: boolean; rows: Row[]; fields: Pick<MetaField, "name" | "label">[]; onChange: (r: Row[]) => void; what: string }) {
  const edit = (key: string, patch: Partial<Row>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="stack">
      {rows.map((r, i) => (
        <div key={r.key} className="row" style={wrap}>
          <div style={grow}>
            {typed ? (
              <input className="input mono" aria-label={tr("Field of {what} {n}", { what, n: i + 1 })} spellCheck={false} autoCapitalize="none" value={r.field} onChange={(e) => edit(r.key, { field: e.target.value })} />
            ) : (
              <Pick label={tr("Field of {what} {n}", { what, n: i + 1 })} value={r.field} onChange={(v) => edit(r.key, { field: v })} options={optionsOf(fields, r.field)} />
            )}
          </div>
          <input className="input mono" style={{ ...grow, flexBasis: 240 }} aria-label={tr("Value of {what} {n}", { what, n: i + 1 })} spellCheck={false} autoCapitalize="none" value={r.expr} onChange={(e) => edit(r.key, { expr: e.target.value })} />
          <Button size="sm" icon="trash" aria-label={tr("Remove {what} {n}", { what, n: i + 1 })} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
        </div>
      ))}
      <div>
        <Button size="sm" icon="plus" onClick={() => onChange([...rows, { key: newKey(), field: "", expr: "" }])}>{tr("Add a field")}</Button>
      </div>
    </div>
  );
}
