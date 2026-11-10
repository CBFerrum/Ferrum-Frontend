// The Rules tab of a solution draft: its rules (docs/logic/rules.md) as forms, with no JSON to type. Like the
// guided view it edits the parsed source in place: the rules it shows are the draft's `rules`, a key or a rule it
// has no form for is kept as it was (a rule it cannot show is read-only, with a way to the Source tab), and what
// the compiler says about a rule (a diagnostic whose pointer is inside `/rules/N/…`) lands on the rule and, where
// the pointer names a part, on that part. Conversions and checks are lib/rulesDraft.ts.

import { useQueries } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { filterable } from "@/lib/filters";
import { useEntityMeta, useMetaIndex, type EntityMeta, type Field as MetaField } from "@/lib/meta";
import {
  aggregateLinks, aggregateRef, aggregateTargets, checkRules, duplicateRule, isWithin, lookupRef, MAX_AGGREGATES, MAX_FILTERS, MAX_LOOKUP_FIELDS, MAX_LOOKUPS, newAggregate, newLookup, newRule, newWrite,
  readable, rulePart, rulesAreOdd, rulesFromSource, rulesToSource, summable,
  type AggregateDraft, type AggOp, type LookupDraft, type Problem, type RuleDraft, type RuleItem,
} from "@/lib/rulesDraft";
import { move } from "@/lib/workflowDraft";
import type { Diagnostic, Source } from "@/lib/solutions";
import { Alert, confirmDialog, ErrorState } from "@/ui/kit";
import { LoadingBlock } from "@/app/studio/dashboard/ui";
import { ExprInput } from "@/app/author/ExprInput";
import { FilterRows, grow, optionsOf, wrap } from "@/app/author/controls";
import { t as tr, isolate } from "@ferrum/client";
import { Field } from "./field";
import { Select } from "./GuidedEditor";

/** The rule (by place) and the part of it to look at. */
export interface RuleSelection {
  rule: number;
  part: string;
}

const card = "grid gap-3 rounded-md border p-3";
const CARD_PARTS = ["id", "entity", "when", "check", "message", "field", "writes", "lookups", "aggregates"];

/** Entities' metadata, loaded together with the keys `useEntityMeta` uses, so the cards share them. */
function useMetas(names: string[]) {
  const unique = [...new Set(names.filter(Boolean))];
  const results = useQueries({
    queries: unique.map((name) => ({ queryKey: ["meta", name], queryFn: ({ signal }: { signal: AbortSignal }) => api.get<EntityMeta>(`/api/meta/${encodeURIComponent(name)}`, undefined, signal), staleTime: 5 * 60_000 })),
  });
  return useMemo(() => new Map(unique.map((n, i) => [n, results[i]?.data] as const)), [unique.join("\n"), ...results.map((r) => r.data)]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function RulesEditor({
  source,
  onChange,
  selected,
  onSelect,
  diagnostics,
  onSource,
}: {
  source: Source;
  onChange: (s: Source) => void;
  selected: RuleSelection | null;
  onSelect: (s: RuleSelection | null) => void;
  /** What the last check said: the ones that point inside a rule are shown on it. */
  diagnostics: Diagnostic[];
  onSource: () => void;
}) {
  const index = useMetaIndex();
  const [items, setItems] = useState<RuleItem[]>(() => rulesFromSource(source));
  const [cur, setCur] = useState(selected?.rule ?? 0);
  // What this tab last wrote: a change of the source from elsewhere (a restored draft) is read again.
  const written = useRef(JSON.stringify((source as { rules?: unknown }).rules));
  useEffect(() => {
    const now = JSON.stringify((source as { rules?: unknown }).rules);
    if (now !== written.current) {
      written.current = now;
      setItems(rulesFromSource(source));
    }
  }, [source]);
  useEffect(() => {
    if (selected) setCur(selected.rule);
  }, [selected]);

  const update = (next: RuleItem[]) => {
    setItems(next);
    const out = rulesToSource(source, next);
    written.current = JSON.stringify(out.rules);
    onChange(out as Source);
  };
  const insert = (rule: RuleDraft, place: number) => update([...items.slice(0, place), { key: rule.key, rule }, ...items.slice(place)]);
  const at = Math.min(cur, items.length - 1);
  const item = items[at] as RuleItem | undefined;
  const choose = (n: number) => {
    setCur(n);
    onSelect({ rule: n, part: "" });
  };
  const setRule = (patch: Partial<RuleDraft>) => item?.rule && update(items.map((i) => (i === item ? { key: i.key, rule: { ...item.rule!, ...patch } } : i)));

  const metas = useMetas(items.flatMap((i) => (i.rule ? [i.rule.entity, ...i.rule.aggregates.map((a) => a.entity)] : [])));
  const local = checkRules(items, { fieldsOf: (e) => metas.get(e)?.fields });
  // What the compiler said, with its place: by rule, then part.
  const said: Problem[] = diagnostics.flatMap((d) => {
    const p = rulePart(d.pointer);
    const target = p && items[p.rule];
    return p && target ? [{ rule: target.key, part: p.part, message: d.message }] : [];
  });
  const problems = [...local, ...said];

  if (index.isLoading) return <LoadingBlock />;
  if (index.error) return <ErrorState error={index.error} onRetry={() => index.refetch()} />;
  if (rulesAreOdd(source))
    return (
      <Alert tone="warning" action={<Button size="sm" onClick={onSource}>{tr("Open the Source tab")}</Button>}>
        {tr("This draft's rules are not a list, so there is nothing here to edit. Change them in the Source tab.")}
      </Alert>
    );
  const entities = (index.data?.entities ?? []).filter((e) => e.kind !== "child");
  const taken = items.flatMap((i) => (i.rule ? [i.rule.id] : []));

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <Button variant="outline" size="sm" onClick={() => (insert(newRule(item?.rule?.entity ?? ""), items.length), choose(items.length))}>
          <Plus aria-hidden /> {tr("Add a rule")}
        </Button>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("This draft has no rules yet. A rule refuses a save unless something holds, or fills in fields of a record when it is saved.")}</p>
        ) : (
          <ul className="grid gap-1" aria-label={tr("Rules")}>
            {items.map((i, n) => {
              const mine = problems.filter((p) => p.rule === i.key);
              return (
                <li key={i.key}>
                  <button
                    type="button"
                    aria-current={n === at ? "true" : undefined}
                    className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-start text-sm ${n === at ? "bg-accent" : ""}`}
                    onClick={() => choose(n)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{isolate(i.rule ? i.rule.id || tr("Untitled rule") : tr("A rule the editor cannot show"))}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {i.rule ? `${isolate(i.rule.entity || "—")} · ${i.rule.phase === "validate" ? tr("Checks") : tr("Fills in")}` : tr("Read-only")}
                      </span>
                    </span>
                    {mine.length > 0 && <Badge variant="destructive" aria-label={tr("{n} problems", { n: mine.length })}>{mine.length}</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="min-w-0">
        {!item ? null : (
          <>
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={tr("This rule")}>
              <Button variant="outline" size="sm" disabled={!item.rule} onClick={() => item.rule && (insert(duplicateRule(item.rule, taken), at + 1), choose(at + 1))}>
                <Copy aria-hidden /> {tr("Duplicate")}
              </Button>
              <Button variant="outline" size="sm" disabled={at === 0} onClick={() => (update(move(items, at, -1)), choose(at - 1))}>
                <ArrowUp aria-hidden /> {tr("Move up")}
              </Button>
              <Button variant="outline" size="sm" disabled={at === items.length - 1} onClick={() => (update(move(items, at, 1)), choose(at + 1))}>
                <ArrowDown aria-hidden /> {tr("Move down")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!(await confirmDialog({ title: tr("Remove this rule?"), message: tr("It leaves the draft when you save."), confirmLabel: tr("Remove"), danger: true }))) return;
                  update(items.filter((i) => i !== item));
                  setCur(Math.max(0, at - 1));
                }}
              >
                <Trash2 aria-hidden /> {tr("Remove")}
              </Button>
            </div>
            {item.rule ? (
              <RuleForm key={item.key} rule={item.rule} set={setRule} problems={problems.filter((p) => p.rule === item.key)} entities={entities} metas={metas} part={selected && selected.rule === at ? selected.part : ""} />
            ) : (
              <section className={card} aria-label={tr("A rule the editor cannot show")}>
                <p className="text-sm">{tr("This rule has parts the editor has no form for, so it is shown as it is and saved as it is. Change it in the Source tab.")}</p>
                {problems.filter((p) => p.rule === item.key).map((p, k) => <p key={k} className="text-sm text-destructive">{isolate(p.message)}</p>)}
                <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-xs" dir="ltr" tabIndex={0} aria-label={tr("The rule as JSON")}>{JSON.stringify(item.raw, null, 2)}</pre>
                <div><Button size="sm" onClick={onSource}>{tr("Open the Source tab")}</Button></div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const partId = (rule: RuleDraft, part: string): string => {
  const [head, a, b] = part.split("/");
  if (head === "writes") {
    const i = rule.writes.findIndex((w) => w.field.trim() === a);
    return i >= 0 ? `rp-writes-${i}` : "rp-writes";
  }
  if (head === "lookups" || head === "aggregates") return `rp-${head}-${a ?? 0}-${b === "link" || b === "fields" || b === "entity" || b === "to" || b === "field" || b === "op" ? b : "name"}`;
  return CARD_PARTS.includes(head) ? `rp-${head}` : "rp-rule";
};

function RuleForm({ rule, set, problems, entities, metas, part }: { rule: RuleDraft; set: (p: Partial<RuleDraft>) => void; problems: Problem[]; entities: { name: string; label: string }[]; metas: Map<string, EntityMeta | undefined>; part: string }) {
  const meta = useEntityMeta(rule.entity || undefined);
  const fields = meta.data?.fields ?? [];
  // Where the keyboard goes when a diagnostic sent the person here.
  useEffect(() => {
    if (!part) return;
    const id = requestAnimationFrame(() => (document.getElementById(partId(rule, part)) ?? document.getElementById("rp-rule"))?.focus());
    return () => cancelAnimationFrame(id);
  }, [part]); // eslint-disable-line react-hooks/exhaustive-deps
  /** What is said of this part or inside it. */
  const within = (p: string) => unique(problems.filter((x) => isWithin(x.part, p)).map((x) => x.message)) || undefined;
  const exactly = (p: string) => unique(problems.filter((x) => x.part === p).map((x) => x.message)) || undefined;
  const elsewhere = problems.filter((p) => !CARD_PARTS.includes(p.part.split("/")[0]));
  const chips = useMemo(
    () => [
      ...readable(fields).map((f) => ({ name: f.name, label: f.label })),
      ...rule.lookups.flatMap((l) => l.fields.map((f) => ({ name: lookupRef(l, f), insert: lookupRef(l, f), label: tr("From the linked record {name}", { name: l.name }) }))),
      ...rule.aggregates.filter((a) => a.name.trim()).map((a) => ({ name: aggregateRef(a), insert: aggregateRef(a), label: a.op === "sum" ? tr("A total of other records") : a.op === "exists" ? tr("Whether any other records exist") : tr("A count of other records") })),
    ],
    [fields, rule.lookups, rule.aggregates],
  );
  const own = fields.filter((f) => f.type !== "table");
  const links = fields.filter((f) => f.type === "link" && f.to);
  // A derivation fills the customer's own fields only (`x_…`, or any field of a custom entity).
  const fillable = own.filter((f) => f.name.startsWith("x_") || meta.data?.custom);
  const setPhase = (phase: "validate" | "derive") =>
    phase === rule.phase ? undefined : set(phase === "validate" ? { phase, writes: [] } : { phase, check: "", message: "", field: "", audit: false });

  return (
    <section className="grid gap-4" aria-label={isolate(rule.id || tr("Untitled rule"))}>
      <h3 id="rp-rule" tabIndex={-1} className="text-base font-semibold">{isolate(rule.id || tr("Untitled rule"))}</h3>
      {elsewhere.length > 0 && <Alert tone="error">{elsewhere.map((p, k) => <span key={k} className="block">{isolate(p.message)}</span>)}</Alert>}
      {meta.error && <Alert tone="error">{tr("The record's fields did not load, so the lists below are short: reload the page.")}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("Name")} hint={tr("What the rule is called in the draft and in refusals.")} error={within("id")}>
          <Input id="rp-id" dir="ltr" value={rule.id} onChange={(e) => set({ id: e.target.value })} />
        </Field>
        <Field label={tr("Kind of record")} error={within("entity")}>
          <Select
            id="rp-entity"
            label={tr("Kind of record")}
            value={rule.entity}
            allowEmpty={tr("Choose…")}
            options={entities.map((e) => ({ value: e.name, label: e.label || e.name }))}
            onChange={(entity) => set({ entity, field: "", writes: [], lookups: [], aggregates: [] })}
          />
        </Field>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{tr("What it does")}</legend>
        <label className="check-field">
          <input type="radio" name={`phase-${rule.key}`} checked={rule.phase === "validate"} onChange={() => setPhase("validate")} />
          {tr("Refuse a save unless…")}
        </label>
        <label className="check-field">
          <input type="radio" name={`phase-${rule.key}`} checked={rule.phase === "derive"} onChange={() => setPhase("derive")} />
          {tr("Fill in fields")}
        </label>
      </fieldset>

      <ExprInput id="rp-when" label={tr("Only when")} value={rule.when} onChange={(when) => set({ when })} fields={chips} error={within("when")} hint={tr("Leave empty to apply to every save. Guard an optional field with has(doc.field).")} />

      {rule.phase === "validate" ? (
        <div className="grid gap-3">
          <ExprInput id="rp-check" label={tr("The save goes through only if this is true")} value={rule.check} onChange={(check) => set({ check })} fields={chips} error={within("check")} />
          <Field label={tr("Message people see")} hint={tr("Plain text: nothing from the record is put into it.")} error={within("message")}>
            <Input id="rp-message" value={rule.message} onChange={(e) => set({ message: e.target.value })} />
          </Field>
          <Field label={tr("Show the message on this field")} error={within("field")}>
            <Select id="rp-field" label={tr("Show the message on this field")} value={rule.field} allowEmpty={tr("No particular field")} options={optionsOf(readable(own), rule.field)} onChange={(field) => set({ field })} />
          </Field>
          <label className="check-field">
            <input type="checkbox" checked={rule.audit} onChange={(e) => set({ audit: e.target.checked })} />
            {tr("Record every refusal")}
          </label>
          <p className="text-xs text-muted-foreground">{tr("A record of each refusal (when, who, which record) is kept apart from the save that was refused, for administrators.")}</p>
        </div>
      ) : (
        <div className="grid gap-2" id="rp-writes" tabIndex={-1} role="group" aria-label={tr("Fields to fill in")}>
          {fillable.length === 0 && meta.data && <p className="text-sm text-muted-foreground">{tr("A rule fills in only your own fields, the ones that start with x_. Add one under Customize first.")}</p>}
          {rule.writes.map((w, i) => {
            const error = within(`writes/${w.field.trim()}`);
            const edit = (patch: Partial<typeof w>) => set({ writes: rule.writes.map((x) => (x === w ? { ...x, ...patch } : x)) });
            return (
              <div key={w.key} className="grid gap-1">
                <div className="row" style={wrap}>
                  <div style={grow}>
                    <Select id={`rp-writes-${i}`} label={tr("Field of row {n}", { n: i + 1 })} value={w.field} allowEmpty={tr("Choose…")} options={optionsOf(fillable, w.field)} onChange={(field) => edit({ field })} />
                  </div>
                  <Input className="font-mono" style={{ ...grow, flexBasis: 260 }} dir="ltr" spellCheck={false} aria-label={tr("Value of row {n}", { n: i + 1 })} aria-invalid={error ? true : undefined} value={w.expr} onChange={(e) => edit({ expr: e.target.value })} />
                  <Button variant="outline" size="icon" aria-label={tr("Remove row {n}", { n: i + 1 })} onClick={() => set({ writes: rule.writes.filter((x) => x !== w) })}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                {error && <p className="text-sm text-destructive">{isolate(error)}</p>}
              </div>
            );
          })}
          {exactly("writes") && <p className="text-sm text-destructive">{isolate(exactly("writes")!)}</p>}
          <div>
            <Button variant="outline" size="sm" onClick={() => set({ writes: [...rule.writes, newWrite()] })}>
              <Plus aria-hidden /> {tr("Add a field")}
            </Button>
          </div>
          <ExpressionHelp chips={chips} />
        </div>
      )}

      <section className="grid gap-3" aria-labelledby="rp-lookups-h">
        <h4 id="rp-lookups-h" className="text-sm font-semibold">{tr("Linked records it reads")}</h4>
        <p className="text-xs text-muted-foreground">{tr("A linked record is read with the rights of the person who saves: someone who may not open it cannot save, and the rule is not run.")}</p>
        {rule.lookups.map((l, i) => (
          <LookupCard key={l.key} n={i} lookup={l} links={links} error={exactly(`lookups/${i}`)} within={within} onChange={(patch) => set({ lookups: rule.lookups.map((x) => (x === l ? { ...x, ...patch } : x)) })} onRemove={() => set({ lookups: rule.lookups.filter((x) => x !== l) })} />
        ))}
        {exactly("lookups") && <p className="text-sm text-destructive">{isolate(exactly("lookups")!)}</p>}
        <div>
          <Button variant="outline" size="sm" disabled={!rule.entity || rule.lookups.length >= MAX_LOOKUPS} onClick={() => set({ lookups: [...rule.lookups, newLookup()] })}>
            <Plus aria-hidden /> {tr("Read a linked record")}
          </Button>
          {rule.lookups.length >= MAX_LOOKUPS && <span className="ms-2 text-xs text-muted-foreground">{tr("At most {n} linked records.", { n: MAX_LOOKUPS })}</span>}
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby="rp-aggregates-h">
        <h4 id="rp-aggregates-h" className="text-sm font-semibold">{tr("Counts and totals")}</h4>
        <p className="text-xs text-muted-foreground">{tr("A count or total looks at every matching record in the workspace, whatever the person saving may see: it can refuse a clerk who may not open a single one of them.")}</p>
        <p className="text-xs text-muted-foreground">{tr("Two saves at the same moment do not see each other's records, so each can pass a check the other would have failed. A rule is a guard for ordinary work, not a lock: keep a balance that must never go wrong in the app's own code.")}</p>
        {rule.aggregates.map((a, i) => (
          <AggregateCard key={a.key} n={i} agg={a} rule={{ name: rule.entity, fields }} entities={entities} metas={metas} error={exactly(`aggregates/${i}`)} within={within} onChange={(patch) => set({ aggregates: rule.aggregates.map((x) => (x === a ? { ...x, ...patch } : x)) })} onRemove={() => set({ aggregates: rule.aggregates.filter((x) => x !== a) })} />
        ))}
        {exactly("aggregates") && <p className="text-sm text-destructive">{isolate(exactly("aggregates")!)}</p>}
        <div>
          <Button variant="outline" size="sm" disabled={!rule.entity || rule.aggregates.length >= MAX_AGGREGATES} onClick={() => set({ aggregates: [...rule.aggregates, newAggregate()] })}>
            <Plus aria-hidden /> {tr("Count or add up other records")}
          </Button>
          {rule.aggregates.length >= MAX_AGGREGATES && <span className="ms-2 text-xs text-muted-foreground">{tr("At most {n} counts and totals.", { n: MAX_AGGREGATES })}</span>}
        </div>
      </section>
    </section>
  );
}

const unique = (xs: string[]) => [...new Set(xs)].join(" ");

/** What the chips of the expression boxes insert, for a person who has none in front of them. */
function ExpressionHelp({ chips }: { chips: { name: string }[] }) {
  const refs = chips.filter((c) => c.name.includes("."));
  if (!refs.length) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {tr("In an expression:")} {refs.map((c, i) => <code key={c.name} dir="ltr">{i ? ", " : ""}{c.name}</code>)}
    </p>
  );
}

function LookupCard({ n, lookup: l, links, error, within, onChange, onRemove }: { n: number; lookup: LookupDraft; links: MetaField[]; error?: string; within: (p: string) => string | undefined; onChange: (p: Partial<LookupDraft>) => void; onRemove: () => void }) {
  const target = links.find((f) => f.name === l.link)?.to;
  const meta = useEntityMeta(target);
  const readFields = readable(meta.data?.fields ?? []);
  const full = l.fields.length >= MAX_LOOKUP_FIELDS;
  const fieldsError = within(`lookups/${n}/fields`);
  return (
    <section className={card} aria-label={tr("Linked record {n}", { n: n + 1 })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("Name")} hint={tr("How an expression refers to it: lookups.name.field")} error={within(`lookups/${n}/name`)}>
          <Input id={`rp-lookups-${n}-name`} dir="ltr" value={l.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label={tr("Follow the link")} error={within(`lookups/${n}/link`)}>
          <Select id={`rp-lookups-${n}-link`} label={tr("Follow the link")} value={l.link} allowEmpty={tr("Choose…")} options={optionsOf(links, l.link)} onChange={(link) => onChange({ link, fields: [] })} />
        </Field>
      </div>
      <fieldset className="grid gap-1" aria-describedby={fieldsError ? `rp-lookups-${n}-err` : undefined}>
        <legend className="text-sm font-medium">{tr("Fields to read")} <span className="text-xs font-normal text-muted-foreground">{tr("{n} of {max} chosen", { n: l.fields.length, max: MAX_LOOKUP_FIELDS })}</span></legend>
        {!l.link ? (
          <p className="text-sm text-muted-foreground">{tr("Choose the link first.")}</p>
        ) : meta.isLoading ? (
          <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
        ) : (
          <div className="grid max-h-56 gap-1 overflow-auto sm:grid-cols-2">
            {[...readFields, ...l.fields.filter((f) => !readFields.some((r) => r.name === f)).map((name) => ({ name, label: name }))].map((f, k) => (
              <label key={f.name} className="check-field">
                <input
                  id={k === 0 ? `rp-lookups-${n}-fields` : undefined}
                  type="checkbox"
                  checked={l.fields.includes(f.name)}
                  disabled={full && !l.fields.includes(f.name)}
                  onChange={(e) => onChange({ fields: e.target.checked ? [...l.fields, f.name] : l.fields.filter((x) => x !== f.name) })}
                />
                {isolate(f.label || f.name)}
              </label>
            ))}
          </div>
        )}
        {full && <p className="text-xs text-muted-foreground">{tr("At most {n} fields.", { n: MAX_LOOKUP_FIELDS })}</p>}
        {fieldsError && <p id={`rp-lookups-${n}-err`} className="text-sm text-destructive">{isolate(fieldsError)}</p>}
      </fieldset>
      {l.name && l.fields.length > 0 && (
        <p className="text-xs text-muted-foreground">{tr("In an expression:")} {l.fields.map((f, i) => <code key={f} dir="ltr">{i ? ", " : ""}{lookupRef(l, f)}</code>)}</p>
      )}
      {error && <p className="text-sm text-destructive">{isolate(error)}</p>}
      <div>
        <Button variant="outline" size="sm" onClick={onRemove}>
          <Trash2 aria-hidden /> {tr("Remove linked record {n}", { n: n + 1 })}
        </Button>
      </div>
    </section>
  );
}

function AggregateCard({
  n, agg: a, rule, entities, metas, error, within, onChange, onRemove,
}: {
  n: number;
  agg: AggregateDraft;
  rule: { name: string; fields: MetaField[] };
  entities: { name: string; label: string }[];
  metas: Map<string, EntityMeta | undefined>;
  error?: string;
  within: (p: string) => string | undefined;
  onChange: (p: Partial<AggregateDraft>) => void;
  onRemove: () => void;
}) {
  const of = useEntityMeta(a.entity || undefined);
  const ofFields = of.data?.fields ?? metas.get(a.entity)?.fields ?? [];
  const links = aggregateLinks(rule, { fields: ofFields });
  const targets = aggregateTargets(rule, { fields: ofFields }, a.link);
  const mine = rule.fields.filter((f) => f.type === "link" && f.to);
  const ops: { value: AggOp; label: string }[] = [
    { value: "count", label: tr("Count the records") },
    { value: "exists", label: tr("Whether any exist") },
    { value: "sum", label: tr("Add up a number") },
  ];
  const filterError = within(`aggregates/${n}/filter`);
  const ready = !!a.entity && !of.isLoading;
  const reference = a.op === "sum" ? tr("A total, as an exact decimal: compare it with dec(\"0\").") : a.op === "exists" ? tr("Yes or no: use it as it is, or negate it.") : tr("A whole number: compare it with 0.");
  return (
    <section className={card} aria-label={tr("Count or total {n}", { n: n + 1 })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("Name")} hint={tr("How an expression refers to it: aggregates.name")} error={within(`aggregates/${n}/name`)}>
          <Input id={`rp-aggregates-${n}-name`} dir="ltr" value={a.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label={tr("What to work out")} error={within(`aggregates/${n}/op`)}>
          <Select id={`rp-aggregates-${n}-op`} label={tr("What to work out")} value={a.op} options={ops} onChange={(op) => onChange({ op: op as AggOp, field: op === "sum" ? a.field : "" })} />
        </Field>
        <Field label={tr("Of which kind of record")} error={within(`aggregates/${n}/entity`)}>
          <Select id={`rp-aggregates-${n}-entity`} label={tr("Of which kind of record")} value={a.entity} allowEmpty={tr("Choose…")} options={entities.map((e) => ({ value: e.name, label: e.label || e.name }))} onChange={(entity) => onChange({ entity, link: "", to: "", field: "", filters: [] })} />
        </Field>
        {a.op === "sum" && (
          <Field label={tr("The number to add up")} error={within(`aggregates/${n}/field`)}>
            <Select id={`rp-aggregates-${n}-field`} label={tr("The number to add up")} value={a.field} allowEmpty={tr("Choose…")} options={optionsOf(summable(ofFields), a.field)} onChange={(field) => onChange({ field })} />
          </Field>
        )}
      </div>
      {ready && links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("No link of {entity} points at this kind of record, or at a record this one links to, so there is nothing to count.", { entity: isolate(of.data?.label ?? a.entity) })}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("Linked through its field")} error={within(`aggregates/${n}/link`)}>
            <Select
              id={`rp-aggregates-${n}-link`}
              label={tr("Linked through its field")}
              value={a.link}
              allowEmpty={tr("Choose…")}
              options={optionsOf(ofFields.filter((f) => links.includes(f.name)), a.link)}
              onChange={(link) => onChange({ link, to: aggregateTargets(rule, { fields: ofFields }, link)[0] ?? "" })}
            />
          </Field>
          <Field label={tr("Pointing at")} error={within(`aggregates/${n}/to`)}>
            <Select
              id={`rp-aggregates-${n}-to`}
              label={tr("Pointing at")}
              value={a.to}
              options={[{ value: "", label: tr("this record") }, ...mine.map((f) => ({ value: f.name, label: tr("the {field} of this record", { field: f.label || f.name }) }))].filter((o) => !a.link || targets.includes(o.value) || o.value === a.to)}
              onChange={(to) => onChange({ to })}
            />
          </Field>
        </div>
      )}
      <fieldset className="grid gap-2" id={`rp-aggregates-${n}-filter`}>
        <legend className="text-sm font-medium">{tr("Only the records where")}</legend>
        {a.entity ? <FilterRows rows={a.filters} fields={filterable(ofFields)} onChange={(filters) => onChange({ filters })} /> : <p className="text-sm text-muted-foreground">{tr("Choose the kind of record first.")}</p>}
        {a.filters.length >= MAX_FILTERS && <p className="text-xs text-muted-foreground">{tr("At most {n} conditions.", { n: MAX_FILTERS })}</p>}
        {filterError && <p className="text-sm text-destructive">{isolate(filterError)}</p>}
      </fieldset>
      {a.name.trim() && (
        <p className="text-xs text-muted-foreground">
          {tr("In an expression:")} <code dir="ltr">{aggregateRef(a)}</code>. {reference}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{isolate(error)}</p>}
      <div>
        <Button variant="outline" size="sm" onClick={onRemove}>
          <Trash2 aria-hidden /> {tr("Remove count or total {n}", { n: n + 1 })}
        </Button>
      </div>
    </section>
  );
}
