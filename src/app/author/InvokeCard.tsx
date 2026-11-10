// The body of the "Do a step of another app" card (the `invoke` effect of a button, or action of an automation): the
// step picked from the workspace's capability catalog, one expression per input it takes, and "only once" with its key.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError } from "../../lib/api";
import type { Capability, DraftAction, Row } from "../../lib/automationDraft";
import type { Field as MetaField } from "../../lib/meta";
import { Field } from "../../ui/kit";
import { ExprInput } from "./ExprInput";

type Invoke = Extract<DraftAction, { kind: "invoke" }>;

/** The catalog, fetched once when first wanted (administrators; an older server answers 404). */
export function useCapabilities(enabled: boolean) {
  return useQuery({ queryKey: ["admin", "capabilities"], queryFn: ({ signal }) => api.get<{ capabilities: Capability[] }>("/api/admin/capabilities", undefined, signal), enabled, retry: false, staleTime: 60_000 });
}

/** A search box over a select grouped by app and record type. The chosen step always stays in the list. */
function Picker({ value, caps, onChange }: { value: string; caps: Capability[]; onChange: (id: string) => void }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = caps.filter((c) => c.id === value || words.every((w) => `${c.id} ${c.title} ${c.entity ?? ""}`.toLowerCase().includes(w)));
  const groups = new Map<string, Capability[]>();
  for (const c of shown) {
    const g = c.entity ? `${c.id.split(".")[0]} · ${c.entity}` : c.id.split(".")[0];
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  return (
    <div className="stack">
      <input className="input" type="search" aria-label={tr("Search the steps")} placeholder={tr("Search the steps")} value={q} onChange={(e) => setQ(e.target.value)} />
      <select className="select" aria-label={tr("The step to run")} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{tr("Choose…")}</option>
        {value && !caps.some((c) => c.id === value) && <option value={value}>{isolate(value)}</option>}
        {[...groups].map(([g, list]) => (
          <optgroup key={g} label={isolate(g)}>
            {list.map((c) => (
              <option key={c.id} value={c.id}>{isolate(`${c.title} (${c.id})`)}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {!shown.length && <p className="faint">{tr("No step matches.")}</p>}
    </div>
  );
}

const isBig = (type: unknown) => type === "object" || type === "array";

export function InvokeCard({ a, index, owner, inButton, chips, links, onChange }: { links?: { name: string; label?: string; insert?: string }[]; a: Invoke; index: number; owner: string; inButton: boolean; chips: MetaField[]; onChange: (p: Partial<Invoke>) => void }) {
  const q = useCapabilities(true);
  const missing = q.error instanceof ApiError && q.error.status === 404;
  if (missing) return <p className="faint">{tr("This server does not offer steps of other apps.")}</p>;
  const caps = q.data?.capabilities ?? [];
  const cap = caps.find((c) => c.id === a.capability);
  const setRow = (name: string, expr: string) => {
    const rest = a.rows.filter((r) => r.field !== name);
    const old = a.rows.find((r) => r.field === name);
    // An emptied box takes its row away; a row keeps its place and key while it is edited.
    onChange({ rows: !expr.trim() ? rest : old ? a.rows.map((r) => (r.field === name ? { ...r, expr } : r)) : [...a.rows, { key: `${a.key}-${name}`, field: name, expr } as Row] });
  };
  const exprOf = (name: string) => a.rows.find((r) => r.field === name)?.expr ?? "";
  const vars = inButton ? (index > 0 ? tr("Variables: doc, user, params, today, now, results") : tr("Variables: doc, user, params, today, now")) : index > 0 ? tr("Variables: doc, user, today, now, results") : tr("Variables: doc, user, today, now");
  const hasSubmit = !!cap?.inputs.some((i) => i.name === "submit");
  const tick = hasSubmit && a.capability.endsWith(".create") && (exprOf("submit") === "" || exprOf("submit") === "true");
  const typeText = (t: unknown) => (typeof t === "string" ? t : "");
  return (
    <>
      <p className="faint">{tr("Runs a step another app offers, through that app's own rules, in the same go as the rest: if anything is refused, nothing is kept.")}</p>
      {q.isLoading && <p className="faint" role="status">{tr("Loading…")}</p>}
      {q.error && <p className="field-error" role="alert">{isolate(q.error instanceof Error ? q.error.message : String(q.error))}</p>}
      {!q.isLoading && !q.error && (
        <Field label={tr("Step")}>
          <Picker value={a.capability} caps={caps} onChange={(id) => onChange({ capability: id, rows: a.rows.filter((r) => caps.find((c) => c.id === id)?.inputs.some((i) => i.name === r.field)) })} />
        </Field>
      )}
      {cap && (
        <>
          {tick && (
            <label className="check-field">
              <input type="checkbox" checked={exprOf("submit") === "true"} onChange={(e) => setRow("submit", e.target.checked ? "true" : "")} />
              {tr("Submit it as well")}
            </label>
          )}
          {cap.inputs.filter((i) => !(tick && i.name === "submit")).map((i) => (
            <ExprInput
              key={i.name}
              label={i.required ? tr("{name} (required)", { name: i.name }) : i.name}
              value={exprOf(i.name)}
              onChange={(v) => setRow(i.name, v)}
              fields={isBig(i.type) ? chips : []}
              links={links}
              rows={isBig(i.type) ? 5 : 2}
              hint={[typeText(i.type), i.description ? isolate(i.description) : "", vars].filter(Boolean).join(" · ")}
            />
          ))}
        </>
      )}
      <label className="check-field">
        <input type="checkbox" checked={a.once} onChange={(e) => onChange({ once: e.target.checked, onceKey: e.target.checked && !a.onceKey ? `'${(owner || "step").replace(/'/g, "")}:' + doc.id` : a.onceKey })} />
        {tr("Do it only once per…")}
      </label>
      {a.once ? (
        <ExprInput label={tr("Key")} value={a.onceKey} onChange={(v) => onChange({ onceKey: v })} fields={[]} links={links} hint={tr("Once for good: pressing or running again changes nothing, and the same key with other input is refused. Use a new key for a new request.")} />
      ) : (
        <p className="faint">{tr("Without a key, the step happens once for each record as it is: a double click or a retry changes nothing, but after the record has changed it happens again.")}</p>
      )}
      <p className="faint">{tr("Later steps can use what this one made as results[{n}], for example results[{n}].id.", { n: index })}</p>
    </>
  );
}
