// The builder's settings: what to report on and in which shape (records, a summary, a pivot), the
// columns or the groups and measures, filters, the period (with a time axis and a comparison), sort
// and row limit. Every list reorders by drag, by keyboard and from the row's menu.

import { ArrowDownWideNarrow, ArrowUpNarrowWide, Grid3x3, Plus, RotateCcw, Rows3, Sigma, X } from "lucide-react";
import { useId, useMemo } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorMessage } from "@/lib/api";
import { formatDate, todayIso } from "@/lib/format";
import {
  AGG_LABEL,
  BUCKET_LABEL,
  buildSpec,
  DATE_PRESETS,
  issuesAt,
  presetOf,
  resolveDate,
  type Agg,
  type Bucket,
  type CatalogField,
  type CompareKind,
  type FieldCatalog,
  type Issue,
  type ReportKind,
  type ResultColumn,
  type Sources,
  type SpecDraft,
} from "@/lib/studio";
import { filterFields, FilterEditor } from "./FilterEditor";
import { EntityPicker, FieldPicker } from "./pickers";
import { AGGS, BUCKETS, measureName, move, specColumns, type BuilderState } from "./state";
import { Issues, PanelSection, RowMenu, SortableItem, SortableList } from "./ui";

type Update = (recipe: (s: BuilderState) => BuilderState, key?: string) => void;

export interface BuilderPanelProps {
  state: BuilderState;
  update: Update;
  catalog: FieldCatalog | undefined;
  catalogLoading: boolean;
  catalogError: unknown;
  onRetryCatalog: () => void;
  sources: Sources | undefined;
  sourcesLoading: boolean;
  onPickEntity: (entity: string) => void;
  issues: Issue[];
  /** The preview's columns, for their labels. */
  columns: ResultColumn[];
  fyStartMonth: number;
}

const exact = (issues: Issue[], path: string) => issues.filter((i) => i.path === path).map((i) => i.message);

/** Which fields `fn` can measure (`count` counts any field's values, or records). */
const measurable = (fields: CatalogField[], fn: Agg) => (fn === "count" ? fields : fields.filter((f) => f.aggregates.includes(fn)));

export function BuilderPanel(p: BuilderPanelProps) {
  const { state, update, catalog, issues } = p;
  const d = state.draft;
  const setDraft = (recipe: (d: SpecDraft) => SpecDraft, key?: string) => update((s) => ({ ...s, draft: recipe(s.draft) }), key);
  const fields = useMemo(() => catalog?.fields ?? [], [catalog]);
  const byPath = useMemo(() => new Map(fields.map((f) => [f.path, f])), [fields]);
  const fieldLabel = (path: string) => byPath.get(path)?.label ?? path;
  const filterable = useMemo(() => filterFields(catalog), [catalog]);

  const setShape = (kind: ReportKind) =>
    update((s) => ({
      ...s,
      view: kind === "table" ? "table" : s.view,
      draft: {
        ...s.draft,
        kind,
        measures: kind !== "table" && !s.draft.measures.length ? [{ fn: "count" }] : s.draft.measures,
        pivot: kind === "pivot" ? (s.draft.pivot ?? { field: "" }) : s.draft.pivot,
      },
    }));

  return (
    <div className="flex flex-col">
      <PanelSection title="Data">
        <EntityPicker sources={p.sources} loading={p.sourcesLoading} value={d.entity} onChange={p.onPickEntity} />
        <Issues messages={exact(issues, "entity")} />
        <ToggleGroup type="single" variant="outline" className="w-full" value={d.kind === "chart" ? "group_by" : d.kind} onValueChange={(k) => k && setShape(k as ReportKind)} aria-label="Report shape">
          <ToggleGroupItem value="table" className="flex-1" aria-label="Records: one row per record">
            <Rows3 /> Records
          </ToggleGroupItem>
          <ToggleGroupItem value="group_by" className="flex-1" aria-label="Summary: rows grouped and measured">
            <Sigma /> Summary
          </ToggleGroupItem>
          <ToggleGroupItem value="pivot" className="flex-1" aria-label="Pivot: values spread across columns">
            <Grid3x3 /> Pivot
          </ToggleGroupItem>
        </ToggleGroup>
        {!!p.catalogError && (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              The fields could not be loaded: {errorMessage(p.catalogError)}
              <Button size="sm" variant="outline" onClick={p.onRetryCatalog}>
                <RotateCcw /> Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </PanelSection>

      {d.entity && p.catalogLoading ? (
        <div className="grid gap-2 p-4" aria-busy="true" aria-label="Loading fields">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : d.entity && catalog ? (
        <>
          {d.kind === "table" ? (
            <ColumnsSection d={d} setDraft={setDraft} fields={fields} fieldLabel={fieldLabel} issues={issues} />
          ) : (
            <>
              <GroupSection d={d} setDraft={setDraft} fields={fields} byPath={byPath} fieldLabel={fieldLabel} issues={issues} />
              <MeasuresSection d={d} setDraft={setDraft} fields={fields} fieldLabel={fieldLabel} issues={issues} />
              {d.kind === "pivot" && <PivotSection d={d} setDraft={setDraft} fields={fields} byPath={byPath} issues={issues} />}
            </>
          )}
          <PanelSection title="Filters">
            <FilterEditor filters={d.filters} fields={filterable} issues={issues} onChange={(filters, key) => setDraft((x) => ({ ...x, filters }), key)} />
            <Input
              type="search"
              aria-label="Search the records"
              placeholder="Search text…"
              value={d.search}
              onChange={(e) => {
                const search = e.target.value;
                setDraft((x) => ({ ...x, search }), "search");
              }}
            />
          </PanelSection>
          <PeriodSection d={d} setDraft={setDraft} fields={fields} issues={issues} fyStartMonth={p.fyStartMonth} />
          <SortSection d={d} setDraft={setDraft} columns={p.columns} fieldLabel={fieldLabel} issues={issues} />
        </>
      ) : null}
    </div>
  );
}

interface SectionProps {
  d: SpecDraft;
  setDraft: (recipe: (d: SpecDraft) => SpecDraft, key?: string) => void;
  fields: CatalogField[];
  issues: Issue[];
}

function ColumnsSection({ d, setDraft, fields, fieldLabel, issues }: SectionProps & { fieldLabel: (p: string) => string }) {
  const used = new Set(d.fields.map((f) => f.field));
  const ids = d.fields.map((_, i) => `f${i}`);
  const labels = d.fields.map((f, i) => fieldLabel(f.field) || `column ${i + 1}`);
  const moveTo = (from: number, to: number) => setDraft((x) => ({ ...x, fields: move(x.fields, from, to) }));
  return (
    <PanelSection title="Columns" hint={d.fields.length ? undefined : "Showing the list's usual columns. Add columns to choose your own."}>
      {d.fields.length > 0 && (
        <SortableList ids={ids} labels={labels} onMove={moveTo}>
          {d.fields.map((f, i) => (
            <SortableItem key={ids[i]} id={ids[i]} label={labels[i]}>
              <div className="flex min-w-0 gap-1">
                <FieldPicker
                  fields={fields}
                  value={f.field}
                  label={`Column ${i + 1}`}
                  invalid={issuesAt(issues, `fields[${i}]`).length > 0}
                  onChange={(c) => setDraft((x) => ({ ...x, fields: x.fields.map((y, j) => (j === i ? { ...y, field: c.path } : y)) }))}
                />
                <RowMenu label={labels[i]} index={i} count={d.fields.length} onMove={(to) => moveTo(i, to)} onRemove={() => setDraft((x) => ({ ...x, fields: x.fields.filter((_, j) => j !== i) }))} />
              </div>
              <Issues messages={issuesAt(issues, `fields[${i}]`)} />
            </SortableItem>
          ))}
        </SortableList>
      )}
      <div>
        <FieldPicker add="Add column" label="Add column" fields={fields.filter((f) => !used.has(f.path))} onChange={(c) => setDraft((x) => ({ ...x, fields: [...x.fields, { field: c.path }] }))} />
      </div>
    </PanelSection>
  );
}

/** A period select for a date field: required buckets have no "exact" choice. */
function BucketSelect({ field, value, onChange, label, allowNone = true }: { field: CatalogField | undefined; value: Bucket | undefined; onChange: (b: Bucket | undefined) => void; label: string; allowNone?: boolean }) {
  if (!field?.buckets.length) return null;
  const none = allowNone && !field.bucket_required;
  return (
    <Select value={value ?? (none ? "none" : undefined)} onValueChange={(v) => onChange(v === "none" ? undefined : (v as Bucket))}>
      <SelectTrigger className="w-full" aria-label={label} aria-invalid={!value && !none ? true : undefined}>
        <SelectValue placeholder="Choose a period" />
      </SelectTrigger>
      <SelectContent>
        {none && <SelectItem value="none">Each day</SelectItem>}
        {field.buckets.map((b) => (
          <SelectItem key={b} value={b}>
            By {BUCKET_LABEL[b].toLowerCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function GroupSection({ d, setDraft, fields, byPath, fieldLabel, issues }: SectionProps & { byPath: Map<string, CatalogField>; fieldLabel: (p: string) => string }) {
  const groupable = useMemo(() => fields.filter((f) => f.groupable), [fields]);
  const ids = d.group_by.map((_, i) => `g${i}`);
  const labels = d.group_by.map((g, i) => fieldLabel(g.field) || `group ${i + 1}`);
  const moveTo = (from: number, to: number) => setDraft((x) => ({ ...x, group_by: move(x.group_by, from, to) }));
  const pick = (f: CatalogField) => ({ field: f.path, ...(f.buckets.length ? { bucket: "month" as Bucket } : {}) });
  return (
    <PanelSection title="Group by" hint={d.group_by.length ? undefined : d.time ? undefined : "Without groups the measures cover every row."}>
      {d.group_by.length > 0 && (
        <SortableList ids={ids} labels={labels} onMove={moveTo}>
          {d.group_by.map((g, i) => {
            const f = byPath.get(g.field);
            return (
              <SortableItem key={ids[i]} id={ids[i]} label={labels[i]}>
                <div className="flex min-w-0 gap-1">
                  <FieldPicker
                    fields={groupable}
                    value={g.field}
                    label={`Group ${i + 1}: field`}
                    invalid={issuesAt(issues, `group_by[${i}]`).length > 0}
                    onChange={(c) => setDraft((x) => ({ ...x, group_by: x.group_by.map((y, j) => (j === i ? { ...pick(c), ...(y.label ? { label: y.label } : {}) } : y)) }))}
                  />
                  <RowMenu label={labels[i]} index={i} count={d.group_by.length} onMove={(to) => moveTo(i, to)} onRemove={() => setDraft((x) => ({ ...x, group_by: x.group_by.filter((_, j) => j !== i) }))} />
                </div>
                <BucketSelect
                  field={f}
                  value={g.bucket}
                  label={`Group ${i + 1}: period`}
                  onChange={(bucket) => setDraft((x) => ({ ...x, group_by: x.group_by.map((y, j) => (j === i ? { field: y.field, ...(bucket ? { bucket } : {}), ...(y.label ? { label: y.label } : {}) } : y)) }))}
                />
                <Issues messages={issuesAt(issues, `group_by[${i}]`)} />
              </SortableItem>
            );
          })}
        </SortableList>
      )}
      <div>
        <FieldPicker add="Add group" label="Add group" fields={groupable} onChange={(c) => setDraft((x) => ({ ...x, group_by: [...x.group_by, pick(c)] }))} />
      </div>
    </PanelSection>
  );
}

function MeasuresSection({ d, setDraft, fields, fieldLabel, issues }: SectionProps & { fieldLabel: (p: string) => string }) {
  const ids = d.measures.map((_, i) => `m${i}`);
  const labels = d.measures.map((m) => (m.field ? `${AGG_LABEL[m.fn]} of ${fieldLabel(m.field)}` : AGG_LABEL[m.fn]));
  const moveTo = (from: number, to: number) => setDraft((x) => ({ ...x, measures: move(x.measures, from, to) }));
  const set = (i: number, m: SpecDraft["measures"][number]) => setDraft((x) => ({ ...x, measures: x.measures.map((y, j) => (j === i ? m : y)) }));
  const addMeasure = () => setDraft((x) => ({ ...x, measures: [...x.measures, x.measures.some((m) => m.fn === "count" && !m.field) ? { fn: "sum" } : { fn: "count" }] }));
  return (
    <PanelSection
      title="Measures"
      action={
        <Button variant="ghost" size="sm" className="text-primary" onClick={addMeasure}>
          <Plus /> Add measure
        </Button>
      }
    >
      <Issues messages={exact(issues, "measures")} />
      {d.measures.length > 0 && (
        <SortableList ids={ids} labels={labels} onMove={moveTo}>
          {d.measures.map((m, i) => {
            const invalid = issuesAt(issues, `measures[${i}]`).length > 0;
            return (
              <SortableItem key={ids[i]} id={ids[i]} label={labels[i]}>
                <div className="flex min-w-0 gap-1">
                  <Select value={m.fn} onValueChange={(fn) => set(i, { ...m, fn: fn as Agg })}>
                    <SelectTrigger className="w-full" aria-label={`Measure ${i + 1}: function`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGGS.map((fn) => (
                        <SelectItem key={fn} value={fn}>
                          {AGG_LABEL[fn]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <RowMenu label={labels[i]} index={i} count={d.measures.length} onMove={(to) => moveTo(i, to)} onRemove={() => setDraft((x) => ({ ...x, measures: x.measures.filter((_, j) => j !== i) }))} />
                </div>
                <FieldPicker
                  fields={measurable(fields, m.fn)}
                  value={m.field ?? ""}
                  label={`Measure ${i + 1}: field`}
                  placeholder={`Choose the field to ${m.fn === "count_distinct" ? "count" : AGG_LABEL[m.fn].toLowerCase()}`}
                  none={m.fn === "count" ? { label: "Records", onSelect: () => set(i, { fn: m.fn, ...(m.label ? { label: m.label } : {}) }) } : undefined}
                  invalid={invalid}
                  onChange={(c) => set(i, { ...m, field: c.path })}
                />
                <Issues messages={issuesAt(issues, `measures[${i}]`)} />
              </SortableItem>
            );
          })}
        </SortableList>
      )}
    </PanelSection>
  );
}

function PivotSection({ d, setDraft, fields, byPath, issues }: Omit<SectionProps, "fields"> & { fields: CatalogField[]; byPath: Map<string, CatalogField> }) {
  const id = useId();
  const pivot = d.pivot ?? { field: "" };
  const groupable = useMemo(() => fields.filter((f) => f.groupable), [fields]);
  const set = (next: typeof pivot, key?: string) => setDraft((x) => ({ ...x, pivot: next }), key);
  return (
    <PanelSection title="Pivot columns" hint="Each value of this field becomes a column, with totals at the end.">
      <FieldPicker
        fields={groupable}
        value={pivot.field}
        label="Pivot columns: field"
        invalid={issuesAt(issues, "pivot").length > 0}
        onChange={(f) => set({ field: f.path, ...(f.buckets.length ? { bucket: "month" as Bucket } : {}), ...(pivot.max_columns ? { max_columns: pivot.max_columns } : {}) })}
      />
      <BucketSelect field={byPath.get(pivot.field)} value={pivot.bucket} label="Pivot columns: period" onChange={(bucket) => set({ field: pivot.field, ...(bucket ? { bucket } : {}), ...(pivot.max_columns ? { max_columns: pivot.max_columns } : {}) })} />
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="shrink-0 font-normal">
          Show up to
        </Label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          placeholder="20"
          className="w-20 text-right tabular-nums"
          value={pivot.max_columns ?? ""}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            const rest = { field: pivot.field, ...(pivot.bucket ? { bucket: pivot.bucket } : {}) };
            set(e.target.value && n >= 1 ? { ...rest, max_columns: Math.min(n, 100) } : rest, "pivot-max");
          }}
        />
        <span className="text-sm text-muted-foreground">columns (the largest)</span>
      </div>
      <Issues messages={issuesAt(issues, "pivot")} />
    </PanelSection>
  );
}

function DateExpr({ label, value, onChange, fyStartMonth, describedBy }: { label: string; value: string; onChange: (v: string) => void; fyStartMonth: number; describedBy?: string }) {
  const id = useId();
  const resolved = value.trim() ? resolveDate(value, todayIso(), fyStartMonth) : null;
  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={label === "From" ? "Any time" : "Today and later"}
        aria-invalid={value.trim() && !resolved ? true : undefined}
        aria-describedby={`${id}-hint ${describedBy ?? ""}`.trim()}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-hint`} className={value.trim() && !resolved ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {!value.trim() ? " " : resolved ? (resolved === value.trim() ? formatDate(resolved) : `= ${formatDate(resolved)}`) : "Not a date"}
      </p>
    </div>
  );
}

function PeriodSection({ d, setDraft, fields, issues, fyStartMonth }: SectionProps & { fyStartMonth: number }) {
  const dated = useMemo(() => fields.filter((f) => f.buckets.length > 0), [fields]);
  const grouped = d.kind !== "table";
  const field = d.period?.field ?? d.time?.field ?? "";
  const from = d.period?.from ?? "";
  const to = d.period?.to ?? "";
  const preset = presetOf(from, to)?.id ?? (from || to ? "custom" : "all");
  const setPeriod = (p: { from: string; to: string }, key?: string) => setDraft((x) => ({ ...x, period: { field, ...p } }), key);
  const issuePath = d.time ? "time_series" : "date_range";
  return (
    <PanelSection title="Period" hint={field ? undefined : "Limit the report to a period of one of its dates."}>
      <FieldPicker
        fields={dated}
        value={field}
        label="Period: date field"
        placeholder="No period"
        none={{ label: "No period", onSelect: () => setDraft((x) => ({ ...x, period: null, time: null, compare: null })) }}
        invalid={issuesAt(issues, `${issuePath}.field`).length > 0}
        onChange={(f) =>
          setDraft((x) => ({
            ...x,
            period: { field: f.path, from: x.period?.from ?? "", to: x.period?.to ?? "" },
            time: x.time ? { ...x.time, field: f.path } : null,
          }))
        }
      />
      {field && (
        <>
          <Select
            value={preset}
            onValueChange={(id) => {
              if (id === "custom") return;
              const p = DATE_PRESETS.find((x) => x.id === id);
              setPeriod(p ? { from: p.from, to: p.to } : { from: "", to: "" });
            }}
          >
            <SelectTrigger className="w-full" aria-label="Period: range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              {DATE_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <DateExpr label="From" value={from} fyStartMonth={fyStartMonth} onChange={(v) => setPeriod({ from: v, to }, "period-from")} />
            <DateExpr label="To" value={to} fyStartMonth={fyStartMonth} onChange={(v) => setPeriod({ from, to: v }, "period-to")} />
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">Dates (YYYY-MM-DD) or expressions such as today-30d or start_of_month keep the report current.</p>
          <Issues messages={[...issuesAt(issues, "date_range"), ...issuesAt(issues, "time_series")]} />
          {grouped && (
            <>
              <Select
                value={d.time?.bucket ?? "off"}
                onValueChange={(v) => setDraft((x) => ({ ...x, time: v === "off" ? null : { field, bucket: v as Bucket, fill_zero: x.time?.fill_zero ?? true } }))}
              >
                <SelectTrigger className="w-full" aria-label="Trend over time">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">No trend over time</SelectItem>
                  {BUCKETS.map((b) => (
                    <SelectItem key={b} value={b}>
                      Trend by {BUCKET_LABEL[b].toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {d.time && (
                <Label className="font-normal">
                  <Checkbox checked={d.time.fill_zero} onCheckedChange={(c) => setDraft((x) => ({ ...x, time: x.time && { ...x.time, fill_zero: c === true } }))} />
                  Show periods without data
                </Label>
              )}
              {d.kind !== "pivot" && (
                <>
                  <Select value={d.compare ?? "none"} disabled={!(from.trim() && to.trim())} onValueChange={(v) => setDraft((x) => ({ ...x, compare: v === "none" ? null : (v as CompareKind) }))}>
                    <SelectTrigger className="w-full" aria-label="Compare with">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No comparison</SelectItem>
                      <SelectItem value="previous_period">Compare with the previous period</SelectItem>
                      <SelectItem value="previous_year">Compare with the same period last year</SelectItem>
                    </SelectContent>
                  </Select>
                  {!(from.trim() && to.trim()) && <p className="-mt-1 text-xs text-muted-foreground">Comparing needs a period with a start and an end.</p>}
                  <Issues messages={exact(issues, "compare")} />
                </>
              )}
            </>
          )}
        </>
      )}
    </PanelSection>
  );
}

const CALL = /^([a-z_]+)\((.*)\)$/;

function SortSection({ d, setDraft, columns, fieldLabel, issues }: Omit<SectionProps, "fields"> & { columns: ResultColumn[]; fieldLabel: (p: string) => string }) {
  const id = useId();
  const options = useMemo(() => specColumns(buildSpec(d)).filter((c) => c.role !== "previous"), [d]);
  const labelOf = (name: string) => {
    const c = columns.find((x) => x.name === name);
    if (c) return c.label;
    const m = CALL.exec(name);
    if (!m) return fieldLabel(name);
    if (m[1] in BUCKET_LABEL) return `${fieldLabel(m[2])} (${BUCKET_LABEL[m[1] as Bucket]})`;
    return m[1] in AGG_LABEL ? `${AGG_LABEL[m[1] as Agg]} of ${fieldLabel(m[2])}` : name;
  };
  const ids = d.sort.map((_, i) => `s${i}`);
  const labels = d.sort.map((s) => labelOf(s.by));
  const moveTo = (from: number, to: number) => setDraft((x) => ({ ...x, sort: move(x.sort, from, to) }));
  const set = (i: number, s: SpecDraft["sort"][number]) => setDraft((x) => ({ ...x, sort: x.sort.map((y, j) => (j === i ? s : y)) }));
  const unused = options.find((o) => !d.sort.some((s) => s.by === o.name));
  const measureNames = new Set(d.measures.map(measureName));
  return (
    <PanelSection
      title="Sort and limit"
      action={
        <Button
          variant="ghost"
          size="sm"
          className="text-primary"
          disabled={!unused}
          onClick={() => unused && setDraft((x) => ({ ...x, sort: [...x.sort, { by: unused.name, dir: measureNames.has(unused.name) ? "desc" : "asc" }] }))}
        >
          <Plus /> Add sort
        </Button>
      }
    >
      {d.sort.length > 0 && (
        <SortableList ids={ids} labels={labels} onMove={moveTo}>
          {d.sort.map((s, i) => (
            <SortableItem key={ids[i]} id={ids[i]} label={labels[i]}>
              <div className="flex min-w-0 gap-1">
                <Select value={s.by} onValueChange={(by) => set(i, { ...s, by })}>
                  <SelectTrigger className="w-full min-w-0" aria-label={`Sort ${i + 1}: column`} aria-invalid={issuesAt(issues, `sort[${i}]`).length ? true : undefined}>
                    <SelectValue placeholder="Choose a column" />
                  </SelectTrigger>
                  <SelectContent>
                    {(options.some((o) => o.name === s.by) || !s.by ? options : [...options, { name: s.by }]).map((o) => (
                      <SelectItem key={o.name} value={o.name}>
                        {labelOf(o.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  aria-label={s.dir === "desc" ? `Sort ${i + 1}: descending (change to ascending)` : `Sort ${i + 1}: ascending (change to descending)`}
                  title={s.dir === "desc" ? "Descending" : "Ascending"}
                  onClick={() => set(i, { ...s, dir: s.dir === "desc" ? "asc" : "desc" })}
                >
                  {s.dir === "desc" ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
                </Button>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Remove sort ${i + 1}`} onClick={() => setDraft((x) => ({ ...x, sort: x.sort.filter((_, j) => j !== i) }))}>
                  <X />
                </Button>
              </div>
              <Issues messages={issuesAt(issues, `sort[${i}]`)} />
            </SortableItem>
          ))}
        </SortableList>
      )}
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="shrink-0 font-normal">
          Rows
        </Label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={10000}
          placeholder="500"
          className="w-24 text-right tabular-nums"
          value={d.limit ?? ""}
          aria-invalid={issuesAt(issues, "limit").length ? true : undefined}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            setDraft((x) => ({ ...x, limit: e.target.value && n >= 1 ? Math.min(n, 10000) : null }), "limit");
          }}
        />
        <span className="text-sm text-muted-foreground">at most (up to 10,000)</span>
      </div>
      <Issues messages={issuesAt(issues, "limit")} />
    </PanelSection>
  );
}
