// The query behind a chart or a number card, edited as builder state (`SpecDraft`): measures,
// groupings, a time axis, the period and its comparison, conditions, sorting and a row limit.
// Error messages from `specIssues` or the server show next to the part they concern.

import { Plus, Trash2 } from "lucide-react";
import { AGG_LABEL, BUCKET_LABEL, issuesAt, type Agg, type Bucket, type CatalogField, type FieldCatalog, type Issue, type ResultColumn, type SpecDraft } from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DateRangeInput } from "./DateRangeInput";
import { FilterEditor } from "./FilterEditor";
import { FieldPicker } from "./pickers";
import { Messages, Section } from "./ui";

const FNS: Agg[] = ["count", "count_distinct", "sum", "avg", "min", "max"];
const NONE = "__none";

function BucketSelect({ field, value, onChange, label, optional }: { field: CatalogField | undefined; value: Bucket | undefined; onChange: (b: Bucket | undefined) => void; label: string; optional: boolean }) {
  const buckets = field?.buckets ?? [];
  if (!buckets.length) return null;
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? undefined : (v as Bucket))}>
      <SelectTrigger aria-label={label} className="h-9 w-full sm:w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {optional && <SelectItem value={NONE}>Each date</SelectItem>}
        {buckets.map((b) => (
          <SelectItem key={b} value={b}>
            By {BUCKET_LABEL[b].toLowerCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface QueryEditorProps {
  draft: SpecDraft;
  onChange: (d: SpecDraft, key?: string) => void;
  catalog: FieldCatalog | undefined;
  /** A card reduces to one measure over a period; a chart groups and plots. */
  mode: "chart" | "card";
  /** Paths within the spec (`measures[0].field`). */
  issues: Issue[];
  /** The last result's columns, to sort by. */
  columns?: ResultColumn[];
}

export function QueryEditor({ draft, onChange, catalog, mode, issues, columns = [] }: QueryEditorProps) {
  const byPath = new Map(catalog?.fields.map((f) => [f.path, f]));
  const at = (p: string) => issuesAt(issues, p);
  const set = (patch: Partial<SpecDraft>, key?: string) => onChange({ ...draft, ...patch }, key);
  const chart = mode === "chart";
  const hasPeriod = !!(draft.period?.from && draft.period?.to);
  const periodField = draft.time?.field ?? draft.period?.field ?? "";

  const measures = draft.measures.length ? draft.measures : [{ fn: "count" as Agg }];
  const setMeasure = (i: number, patch: Partial<SpecDraft["measures"][number]>, key?: string) =>
    set({ measures: measures.map((m, n) => (n === i ? { ...m, ...patch } : m)) }, key);

  return (
    <div className="grid gap-5">
      <Section
        title={chart ? "Measures" : "Measure"}
        hint={chart ? "What each bar, line or slice adds up." : "The number the card shows."}
        action={
          chart && measures.length < 6 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ measures: [...measures, { fn: "sum" }] })}>
              <Plus /> Add
            </Button>
          ) : undefined
        }
      >
        {measures.map((m, i) => {
          const f = m.field ? byPath.get(m.field) : undefined;
          return (
            <div key={i} className="grid gap-1">
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-start gap-1.5">
                <Select
                  value={m.fn}
                  onValueChange={(fn) => {
                    const ok = fn === "count" || !f || f.aggregates.includes(fn as Agg);
                    setMeasure(i, { fn: fn as Agg, field: fn === "count" ? undefined : ok ? m.field : undefined });
                  }}
                >
                  <SelectTrigger aria-label={`Measure ${i + 1}: function`} className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FNS.map((fn) => (
                      <SelectItem key={fn} value={fn}>
                        {fn === "count" ? "Count records" : AGG_LABEL[fn]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {m.fn === "count" ? (
                  <p className="self-center truncate text-sm text-muted-foreground">of {catalog?.label ?? "records"}</p>
                ) : (
                  <FieldPicker catalog={catalog} which={m.fn} value={m.field} label={`Measure ${i + 1}: field`} invalid={at(`measures[${i}]`).length > 0} onChange={(field) => setMeasure(i, { field })} />
                )}
                {chart && measures.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove measure ${i + 1}`} onClick={() => set({ measures: measures.filter((_, n) => n !== i) })}>
                    <Trash2 />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
              <Input value={m.label ?? ""} placeholder="Label (optional)" aria-label={`Measure ${i + 1}: label`} className="h-8 text-xs" maxLength={140} onChange={(e) => setMeasure(i, { label: e.target.value }, `measure-label-${i}`)} />
              <Messages list={at(`measures[${i}]`)} />
            </div>
          );
        })}
        <Messages list={issues.filter((x) => x.path === "measures").map((x) => x.message)} />
      </Section>

      {chart && (
        <Section title="Over time" hint="A date along the x axis, one point per period." action={<Switch checked={!!draft.time} aria-label="Plot over time" onCheckedChange={(on) => set({ time: on ? { field: periodField || (catalog?.fields.find((f) => f.buckets.length && !f.path.includes("."))?.path ?? ""), bucket: "month", fill_zero: true } : null })} />}>
          {draft.time && (
            <div className="grid gap-1">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                <FieldPicker
                  catalog={catalog}
                  which="date"
                  value={draft.time.field}
                  label="Date field"
                  invalid={at("time_series.field").length > 0}
                  onChange={(field) => set({ time: { ...draft.time!, field }, period: draft.period ? { ...draft.period, field } : null })}
                />
                <BucketSelect field={byPath.get(draft.time.field)} value={draft.time.bucket} optional={false} label="Period length" onChange={(b) => b && set({ time: { ...draft.time!, bucket: b } })} />
              </div>
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox checked={draft.time.fill_zero} onCheckedChange={(c) => set({ time: { ...draft.time!, fill_zero: c === true } })} />
                Show periods without records as zero
              </Label>
              <Messages list={at("time_series")} />
            </div>
          )}
        </Section>
      )}

      {chart && (
        <Section
          title={draft.time ? "Split by" : "Group by"}
          hint={draft.time ? "A series for each value (for example, one line per status)." : "The categories along the x axis; a second grouping splits them into series."}
          action={
            draft.group_by.length < (draft.time ? 1 : 2) ? (
              <Button type="button" variant="ghost" size="sm" disabled={!catalog} onClick={() => set({ group_by: [...draft.group_by, { field: "" }] })}>
                <Plus /> Add
              </Button>
            ) : undefined
          }
        >
          {draft.group_by.map((g, i) => {
            const f = byPath.get(g.field);
            return (
              <div key={i} className="grid gap-1">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
                  <FieldPicker
                    catalog={catalog}
                    which="groupable"
                    value={g.field}
                    label={`Grouping ${i + 1}: field`}
                    invalid={at(`group_by[${i}]`).length > 0}
                    onChange={(field) => {
                      const nf = byPath.get(field);
                      set({ group_by: draft.group_by.map((x, n) => (n === i ? { field, ...(nf?.bucket_required ? { bucket: "month" as Bucket } : {}) } : x)) });
                    }}
                  />
                  <BucketSelect field={f} value={g.bucket} optional={!f?.bucket_required} label={`Grouping ${i + 1}: period`} onChange={(bucket) => set({ group_by: draft.group_by.map((x, n) => (n === i ? { field: x.field, ...(bucket ? { bucket } : {}) } : x)) })} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove grouping ${i + 1}`} onClick={() => set({ group_by: draft.group_by.filter((_, n) => n !== i) })}>
                    <Trash2 />
                  </Button>
                </div>
                <Messages list={at(`group_by[${i}]`)} />
              </div>
            );
          })}
          {draft.kind === "pivot" && draft.pivot && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border border-dashed p-2 text-sm">
              <span className="truncate">Columns from {byPath.get(draft.pivot.field)?.label ?? draft.pivot.field}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => set({ kind: "group_by", pivot: null })}>
                Remove
              </Button>
              <Messages list={at("pivot")} className="col-span-2" />
            </div>
          )}
        </Section>
      )}

      <Section title="Period" hint={draft.time ? "The dates the time axis covers." : "Only records dated in this period count."}>
        <div className="grid gap-1.5">
          {!draft.time && (
            <FieldPicker
              catalog={catalog}
              which="date"
              value={draft.period?.field}
              label="Date field of the period"
              placeholder="Choose a date field…"
              invalid={at("date_range.field").length > 0}
              onClear={() => set({ period: null, compare: null })}
              onChange={(field) => set({ period: { field, from: draft.period?.from ?? "start_of_month", to: draft.period?.to ?? "today" } })}
            />
          )}
          {(draft.time || draft.period?.field) && (
            <DateRangeInput
              label="Period"
              value={draft.period ? { from: draft.period.from || undefined, to: draft.period.to || undefined } : null}
              invalid={at(draft.time ? "time_series.from" : "date_range.from").length + at(draft.time ? "time_series.to" : "date_range.to").length > 0}
              onChange={(r) => {
                const field = draft.time?.field ?? draft.period?.field ?? "";
                const period = r ? { field, from: r.from ?? "", to: r.to ?? "" } : draft.time ? null : { field, from: "", to: "" };
                set({ period, compare: period?.from && period.to ? draft.compare : null }, "period");
              }}
            />
          )}
          <Messages list={[...at("date_range"), ...(draft.time ? [...at("time_series.from"), ...at("time_series.to")] : [])]} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="qe-compare" className="text-xs font-normal text-muted-foreground">
            Compare with
          </Label>
          <Select value={draft.compare ?? NONE} disabled={!hasPeriod || draft.kind === "pivot"} onValueChange={(v) => set({ compare: v === NONE ? null : (v as SpecDraft["compare"]) })}>
            <SelectTrigger id="qe-compare" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nothing</SelectItem>
              <SelectItem value="previous_period">The previous period</SelectItem>
              <SelectItem value="previous_year">The same period last year</SelectItem>
            </SelectContent>
          </Select>
          {!hasPeriod && <p className="text-xs text-muted-foreground">Comparing needs a period with a start and an end.</p>}
          <Messages list={at("compare")} />
        </div>
      </Section>

      <Section title="Conditions" hint="Only records that meet every condition count.">
        <FilterEditor
          catalog={catalog}
          filters={draft.filters}
          onChange={(filters, key) => set({ filters }, key)}
          errors={Object.fromEntries(draft.filters.map((_, i) => [i, at(`filters[${i}]`)]))}
        />
      </Section>

      {chart && (
        <Section title="Sort and limit">
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-1.5">
            <Select
              value={draft.sort[0]?.by || NONE}
              onValueChange={(by) => set({ sort: by === NONE ? [] : [{ by, dir: draft.sort[0]?.dir ?? "desc" }] })}
            >
              <SelectTrigger aria-label="Sort by" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Default order</SelectItem>
                {draft.sort[0]?.by && !columns.some((c) => c.name === draft.sort[0].by) && <SelectItem value={draft.sort[0].by}>{draft.sort[0].by}</SelectItem>}
                {columns
                  .filter((c) => c.role === "dimension" || c.role === "measure")
                  .map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={draft.sort[0]?.dir ?? "desc"} disabled={!draft.sort[0]?.by} onValueChange={(dir) => set({ sort: draft.sort[0] ? [{ ...draft.sort[0], dir: dir as "asc" | "desc" }] : [] })}>
              <SelectTrigger aria-label="Sort direction" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Largest first</SelectItem>
                <SelectItem value="asc">Smallest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="qe-limit" className="text-sm font-normal">
              Show at most
            </Label>
            <Input
              id="qe-limit"
              type="number"
              inputMode="numeric"
              min={1}
              max={10000}
              className="h-9 w-24"
              placeholder="500"
              value={draft.limit ?? ""}
              onChange={(e) => {
                const n = Math.trunc(Number(e.target.value));
                set({ limit: e.target.value === "" || !Number.isFinite(n) ? null : Math.min(Math.max(n, 1), 10000) }, "limit");
              }}
            />
            <span className="text-sm text-muted-foreground">rows</span>
          </div>
          <Messages list={[...at("sort"), ...at("limit")]} />
        </Section>
      )}
    </div>
  );
}
