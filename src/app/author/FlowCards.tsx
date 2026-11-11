// The bodies of the three effect cards that branch, find and loop (BD-18), and the "Only when" box every effect card has.
// They are built from the parts the other cards use: Pick, Rows (field → expression) and ExprInput. The card around
// them (title, move, remove, the server's refusal) is ActionCard's.

import { t as tr, isolate } from "@ferrum/client";
import type { DraftAction } from "../../lib/automationDraft";
import { useEntityMeta, type EntityMeta, type Field as MetaField } from "../../lib/meta";
import { ErrorState, Field } from "../../ui/kit";
import { ExprInput, linkChips } from "./ExprInput";
import { optionsOf, Pick, Rows } from "./controls";

type Kind<K extends DraftAction["kind"]> = Extract<DraftAction, { kind: K }>;
interface Common {
  /** The record's own fields. */
  fields: MetaField[];
  chips: MetaField[];
  entities: { value: string; label: string }[];
  patch: (p: Record<string, unknown>) => void;
}
const writable = (fs: MetaField[]) => fs.filter((f) => f.can_write !== false && !f.read_only && f.type !== "table");
const loadError = (q: { error: unknown; refetch: () => unknown }, entity: string) => <ErrorState error={q.error} onRetry={() => q.refetch()} title={tr("Could not load {entity}", { entity: isolate(entity) })} />;

/** "Only when": the effect runs when the expression holds; empty means always. */
export function WhenBox({ a, fields, chips, patch, nested }: { a: DraftAction; fields: MetaField[]; chips: MetaField[]; patch: (p: Record<string, unknown>) => void; nested: boolean }) {
  return (
    <ExprInput
      label={tr("Only when (optional)")}
      value={a.when ?? ""}
      onChange={(when) => patch({ when })}
      fields={chips}
      links={linkChips(fields)}
      functions
      hint={nested ? tr("An expression. Empty: always. Here item is the one being gone through.") : tr("An expression. Empty: always. A step that does not run gives nothing in results.")}
    />
  );
}

export function FindBody({ a, entities, patch }: Common & { a: Kind<"find"> }) {
  const target = useEntityMeta(a.entity || undefined);
  const list = writable(target.data?.fields ?? []);
  return (
    <>
      <p className="faint">{tr("Finds the one record whose fields hold these values. Two matching is refused, and an empty value matches nothing.")}</p>
      <Field htmlFor={`fe-${a.key}`} label={tr("Kind of record to find")}>
        <Pick label={tr("Kind of record to find")} id={`fe-${a.key}`} value={a.entity} onChange={(v) => patch({ entity: v, by: [], create: null, update: null })} options={optionsOf(entities.map((e) => ({ name: e.value, label: e.label })), a.entity)} />
      </Field>
      {a.entity && target.error ? (
        loadError(target, a.entity)
      ) : (
        <>
          <p className="field-label">{tr("The fields to match, with a value each")}</p>
          <Rows rows={a.by} fields={[{ name: "id", label: "id" }, ...(target.data?.fields ?? []).filter((f) => f.type !== "table")]} what={tr("field to match")} onChange={(by) => patch({ by })} />
          <label className="check-field">
            <input type="checkbox" checked={!!a.create} onChange={(e) => patch({ create: e.target.checked ? [] : null })} />
            {tr("Create it when none is found")}
          </label>
          {a.create && (
            <>
              <p className="faint">{tr("Besides the fields matched, these are filled in.")}</p>
              <Rows rows={a.create} fields={list} what={tr("field to create with")} onChange={(create) => patch({ create })} />
            </>
          )}
          <label className="check-field">
            <input type="checkbox" checked={!!a.update} onChange={(e) => patch({ update: e.target.checked ? [] : null })} />
            {tr("Change it when it is found")}
          </label>
          {a.update && (
            <>
              <p className="faint">{tr("Values can use linked, the record found, as it was.")}</p>
              <Rows rows={a.update} fields={list} what={tr("field to change")} onChange={(update) => patch({ update })} />
            </>
          )}
        </>
      )}
    </>
  );
}

export function CopyLinesBody({ a, fields, lines, earlier, patch }: Common & { a: Kind<"copy_lines">; lines?: EntityMeta["children"]; earlier?: DraftAction[] }) {
  const found = (earlier ?? []).flatMap((x, n) => (x.kind === "find" || x.kind === "create_document" ? [{ n, x }] : []));
  const sourceEntity = a.source === "link" ? fields.find((f) => f.name === a.link)?.to : found.find((f) => String(f.n) === a.result)?.x.entity;
  const src = useEntityMeta((sourceEntity as string | undefined) || undefined);
  const known = !!src.data;
  const targetFields = lines?.[a.table]?.fields;
  return (
    <>
      <p className="faint">{tr("Copies the lines of a table of another record into a table of this one, in one save. At most 100 lines.")}</p>
      <Field htmlFor={`cl-${a.key}`} label={tr("Into the table")}>
        <Pick label={tr("Into the table")} id={`cl-${a.key}`} value={a.table} onChange={(v) => patch({ table: v, rows: [] })} options={optionsOf(fields.filter((f) => f.type === "table"), a.table)} />
      </Field>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, columnGap: 16, flexWrap: "wrap" }}>
        <legend className="field-label">{tr("The lines come from the record")}</legend>
        <label className="check-field">
          <input type="radio" name={`cs-${a.key}`} checked={a.source === "link"} onChange={() => patch({ source: "link", result: "", from_table: "" })} />
          {tr("a link field names")}
        </label>
        <label className="check-field">
          <input type="radio" name={`cs-${a.key}`} checked={a.source === "result"} onChange={() => patch({ source: "result", link: "", from_table: "" })} />
          {tr("an earlier Find gave")}
        </label>
      </fieldset>
      {a.source === "link" ? (
        <Pick label={tr("Link field")} value={a.link} onChange={(v) => patch({ link: v, from_table: "" })} options={optionsOf(fields.filter((f) => f.type === "link"), a.link)} />
      ) : (
        <Pick label={tr("Earlier step")} value={a.result} onChange={(v) => patch({ result: v, from_table: "" })} options={[...found.map(({ n, x }) => ({ value: String(n), label: tr("Action {n}: {name}", { n: n + 1, name: x.kind === "find" ? tr("Find") : tr("Create a record") }) })), ...(a.result && !found.some((f) => String(f.n) === a.result) ? [{ value: a.result, label: a.result }] : [])]} />
      )}
      {src.error && sourceEntity ? (
        loadError(src, sourceEntity as string)
      ) : known ? (
        <Pick label={tr("Table to copy from")} value={a.from_table} onChange={(v) => patch({ from_table: v })} options={optionsOf(src.data!.fields.filter((f) => f.type === "table"), a.from_table)} />
      ) : (
        <input className="input mono" aria-label={tr("Table to copy from")} placeholder={tr("Table to copy from")} spellCheck={false} autoCapitalize="none" value={a.from_table} onChange={(e) => patch({ from_table: e.target.value })} />
      )}
      <Field label={tr("How")}>
        <select className="select" value={a.mode || "append"} onChange={(e) => patch({ mode: e.target.value })}>
          <option value="append">{tr("Add to the lines there are")}</option>
          <option value="replace">{tr("Replace the lines there are")}</option>
        </select>
      </Field>
      <p className="faint">{tr("Each value is an expression over item, the line being copied: for example addDays(doc.start, item.offset_days)")}</p>
      {a.table && !targetFields && <p className="faint">{tr("The fields of the lines are not known to this server: type their names.")}</p>}
      {a.table && <Rows rows={a.rows} typed={!targetFields} fields={writable(targetFields ?? [])} what={tr("line field")} onChange={(rows) => patch({ rows })} />}
    </>
  );
}

/** What a loop goes through; its effects are drawn by the caller (they are cards of their own). */
export function ForEachHead({ a, fields, chips, entities, patch, owner }: Common & { a: Kind<"for_each">; owner: string }) {
  const other = useEntityMeta(a.over === "entity" && a.entity ? a.entity : undefined);
  const links = (other.data?.fields ?? []).filter((f) => f.type === "link" && (!owner || f.to === owner));
  return (
    <>
      <p className="faint">{tr("Runs the effects below once for each line of a table of this record, or each record that links to it: at most 100, and one loop is not put inside another. In them item is the one being gone through.")}</p>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, columnGap: 16, flexWrap: "wrap" }}>
        <legend className="field-label">{tr("Go through")}</legend>
        <label className="check-field">
          <input type="radio" name={`fo-${a.key}`} checked={a.over === "table"} onChange={() => patch({ over: "table", entity: "", link: "" })} />
          {tr("the lines of a table")}
        </label>
        <label className="check-field">
          <input type="radio" name={`fo-${a.key}`} checked={a.over === "entity"} onChange={() => patch({ over: "entity", table: "" })} />
          {tr("the records that link here")}
        </label>
      </fieldset>
      {a.over === "table" ? (
        <Pick label={tr("Table")} value={a.table} onChange={(v) => patch({ table: v })} options={optionsOf(fields.filter((f) => f.type === "table"), a.table)} />
      ) : (
        <>
          <Pick label={tr("Kind of record")} value={a.entity} onChange={(v) => patch({ entity: v, link: "" })} options={optionsOf(entities.map((e) => ({ name: e.value, label: e.label })), a.entity)} />
          {a.entity && other.error ? loadError(other, a.entity) : <Pick label={tr("Link field that names this record")} value={a.link} onChange={(v) => patch({ link: v })} options={optionsOf(links, a.link)} />}
        </>
      )}
      <ExprInput label={tr("Only for items where (optional)")} value={a.where} onChange={(where) => patch({ where })} fields={chips} links={linkChips(fields)} hint={tr("An expression over item and doc: for example item.status != 'Done'")} />
    </>
  );
}
