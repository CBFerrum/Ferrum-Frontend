// The options of a `link` effect (BD-23, BD-38, BD-44): a signed link that lets someone do one thing to this record. The
// effect is kept as the JSON it is; each box sets one property. Expressions (`until`, `recipient`, `code_to`) are the
// server's to compile: its refusal is shown where the action is saved.

import { t as tr, isolate } from "@ferrum/client";
import { checkLink, setColumns, setOption, type Raw } from "../../lib/actionLinks";
import { lines as toLines } from "../../lib/connectionDraft";
import type { Field as MetaField } from "../../lib/meta";
import { Alert, Field } from "../../ui/kit";

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const num = (s: string): number | string | undefined => (s.trim() === "" ? undefined : Number.isFinite(Number(s)) ? Number(s) : s);

export function LinkOptions({ effect, fields, onChange, id }: { effect: Raw; fields: MetaField[]; onChange: (e: Raw) => void; id: string }) {
  const tables = fields.filter((f) => f.type === "table").map((f) => f.name);
  const set = (k: string, v: unknown) => onChange(setOption(effect, k, v));
  const show = list(effect.show);
  const problems = checkLink(effect, tables);
  const cols = (effect.columns ?? {}) as Record<string, unknown>;
  return (
    <div className="stack">
      <p className="faint">{tr("A link lets whoever holds it do the actions named here to this record, once or a few times, until it expires. The address is shown once, when it is made: send it with a message action whose value is results[n].url.")}</p>
      {problems.length > 0 && <Alert tone="warning"><ul>{problems.map((p, i) => <li key={i}>{isolate(p)}</li>)}</ul></Alert>}
      <Field label={tr("What it lets them do")} htmlFor={`${id}-actions`} hint={tr("The names of actions, one per line, or view.")}>
        <textarea id={`${id}-actions`} className="textarea mono" rows={2} defaultValue={list(effect.actions).join("\n")} onChange={(e) => set("actions", toLines(e.target.value))} />
      </Field>
      <Field label={tr("Fields it shows")} htmlFor={`${id}-show`} hint={tr("One per line. A table field needs its columns below.")}>
        <textarea id={`${id}-show`} className="textarea mono" rows={2} defaultValue={show.join("\n")} onChange={(e) => set("show", toLines(e.target.value))} />
      </Field>
      {tables.map((table) => (
        <Field key={table} label={tr("Columns of the lines {table}", { table })} htmlFor={`${id}-cols-${table}`} hint={tr("One per line, 1 to 8, each a field a public page may show. The rows are shown read-only. Add {table} to the fields it shows too.", { table })}>
          <textarea id={`${id}-cols-${table}`} className="textarea mono" rows={2} defaultValue={list(cols[table]).join("\n")} onChange={(e) => onChange(setColumns(effect, table, toLines(e.target.value)))} />
        </Field>
      ))}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label={tr("Works for (days)")} htmlFor={`${id}-days`} hint={tr("1 to 90.")}>
          <input id={`${id}-days`} className="input" type="number" min={1} max={90} value={effect.days === undefined ? "" : String(effect.days)} onChange={(e) => set("days", num(e.target.value))} />
        </Field>
        <Field label={tr("Times it may be used")} htmlFor={`${id}-uses`} hint={tr("1 to 100.")}>
          <input id={`${id}-uses`} className="input" type="number" min={1} max={100} value={effect.uses === undefined ? "" : String(effect.uses)} onChange={(e) => set("uses", num(e.target.value))} />
        </Field>
      </div>
      <Field label={tr("Works until (an expression)")} htmlFor={`${id}-until`} hint={tr("A date (it works through that day, UTC) or a moment, such as doc.valid_until. With days too, the sooner counts. Never more than 90 days; one already past is refused.")}>
        <input id={`${id}-until`} className="input mono" spellCheck={false} value={typeof effect.until === "string" ? effect.until : ""} onChange={(e) => set("until", e.target.value)} />
      </Field>
      <Field label={tr("Who it is for (an expression)")} htmlFor={`${id}-recipient`}>
        <input id={`${id}-recipient`} className="input mono" spellCheck={false} value={typeof effect.recipient === "string" ? effect.recipient : ""} onChange={(e) => set("recipient", e.target.value)} />
      </Field>
      <Field label={tr("Send a code first to (an expression)")} htmlFor={`${id}-code`} hint={tr("An address or number. Empty: no code.")}>
        <input id={`${id}-code`} className="input mono" spellCheck={false} value={typeof effect.code_to === "string" ? effect.code_to : ""} onChange={(e) => set("code_to", e.target.value)} />
      </Field>
      <Field label={tr("Sites that may frame its page")} htmlFor={`${id}-frames`} hint={tr("One per line, like https://town.example. Without any, none may.")}>
        <textarea id={`${id}-frames`} className="textarea mono" rows={2} spellCheck={false} defaultValue={list(effect.frame_origins).join("\n")} onChange={(e) => set("frame_origins", toLines(e.target.value))} />
      </Field>
    </div>
  );
}
