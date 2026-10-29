// Settings of one block in the space editor: a form per block type. Changes go through `onChange`
// with a tag, so typing into one field is one undo step; errors show beside their field.

import { arrayMove } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, Ban, Check, ChevronsUpDown, ExternalLink, Palette, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorMessage } from "@/lib/api";
import { humanize } from "@/lib/format";
import { DOCSTATUS_LABEL, SYSTEM_FIELD_LABELS, useEntityMeta, useMetaIndex, type EntityMeta, type Field as MetaField, type FieldType } from "@/lib/meta";
import { filterList, issuesAt, useStudioList, useStudioSources, type FilterOp, type Filters, type Issue, type SpaceBlock, type SpecFilter, type StudioKind } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { LinkInput } from "../../widgets";
import { useEntityLabels } from "./BlockView";
import {
  filterInput,
  filterKind,
  filterValue,
  initialValue,
  LINK_TARGETS,
  opLabel,
  OPS,
  PATHS,
  retarget,
  SHORTCUT_TARGETS,
  TARGET_LABEL,
  targetOf,
  type BlockType,
  type FilterKind,
  type LinkTarget,
} from "./model";

type Of<T extends BlockType> = Extract<SpaceBlock, { type: T }>;
type Change = (b: SpaceBlock, tag?: string) => void;
interface FormProps<B> {
  block: B;
  onChange: Change;
  issues: Issue[];
  /** Prefix for element ids, unique per block. */
  id: string;
}

const TAP = "pointer-coarse:min-h-11";

export function BlockSettings({ block, ...p }: FormProps<SpaceBlock>) {
  switch (block.type) {
    case "shortcut":
      return <ShortcutForm block={block} {...p} />;
    case "links":
      return <LinksForm block={block} {...p} />;
    case "chart":
      return (
        <FieldGroup className="gap-3">
          <Row id={`${p.id}-chart`} label="Chart" errors={issuesAt(p.issues, "chart")} hint="Any chart you can open; viewers see its data with their own permissions.">
            <RecordPicker kind="charts" id={`${p.id}-chart`} value={block.chart} onChange={(chart) => p.onChange({ ...block, chart })} errors={issuesAt(p.issues, "chart")} />
          </Row>
          <BuilderLinks open={block.chart ? PATHS.chart(block.chart) : undefined} create={PATHS.chart("new")} what="chart" />
        </FieldGroup>
      );
    case "card":
      return (
        <FieldGroup className="gap-3">
          <Row id={`${p.id}-card`} label="Number card" errors={issuesAt(p.issues, "card")} hint="Any number card you can open; viewers see it with their own permissions.">
            <RecordPicker kind="cards" id={`${p.id}-card`} value={block.card} onChange={(card) => p.onChange({ ...block, card })} errors={issuesAt(p.issues, "card")} />
          </Row>
          <BuilderLinks open={block.card ? PATHS.card(block.card) : undefined} create={PATHS.card("new")} what="number card" />
        </FieldGroup>
      );
    case "list":
      return <ListForm block={block} {...p} />;
    case "markdown":
      return <MarkdownForm block={block} {...p} />;
    case "heading":
      return <HeadingForm block={block} {...p} />;
    case "onboarding":
      return <OnboardingForm block={block} {...p} />;
  }
}

// ───────────────────────────── layout helpers ─────────────────────────────

/** Opens a builder in a new tab, so the space being edited stays as it is. */
function BuilderLinks({ open, create, what }: { open?: string; create?: string; what: string }) {
  const link = "inline-flex items-center gap-1 rounded-sm text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {open && (
        <Link to={open} target="_blank" rel="noopener" className={link}>
          <ExternalLink className="size-3.5" aria-hidden="true" /> Open the {what}
          <span className="sr-only"> (opens in a new tab)</span>
        </Link>
      )}
      {create && (
        <Link to={create} target="_blank" rel="noopener" className={link}>
          <Plus className="size-3.5" aria-hidden="true" /> Make a new {what}
          <span className="sr-only"> (opens in a new tab)</span>
        </Link>
      )}
    </div>
  );
}

export function Row({ id, label, hint, errors = [], optional, children }: { id: string; label: ReactNode; hint?: ReactNode; errors?: string[]; optional?: boolean; children: ReactNode }) {
  return (
    <Field className="gap-1.5" data-invalid={errors.length ? true : undefined}>
      <FieldLabel htmlFor={id} id={`${id}-label`}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </FieldLabel>
      {children}
      {errors.length ? <FieldError id={`${id}-error`}>{errors.join(" ")}</FieldError> : hint ? <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription> : null}
    </Field>
  );
}

/** ARIA wiring of a control inside `Row` with the same id. */
export const aria = (id: string, errors: string[] = [], hint = false) => ({
  "aria-invalid": errors.length ? true : undefined,
  "aria-describedby": errors.length ? `${id}-error` : hint ? `${id}-hint` : undefined,
});

function TextRow({
  id,
  label,
  value,
  onChange,
  errors,
  hint,
  optional,
  placeholder,
  maxLength = 140,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  errors?: string[];
  hint?: string;
  optional?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <Row id={id} label={label} errors={errors} hint={hint} optional={optional}>
      <Input id={id} value={value ?? ""} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={TAP} {...aria(id, errors, !!hint)} />
    </Row>
  );
}

/**
 * A whole number that can be cleared and retyped: the draft keeps the last valid number (or null
 * when `nullable` and empty), and the text follows the draft when it changes elsewhere (undo).
 */
export function IntInput({
  id,
  value,
  onChange,
  nullable,
  placeholder,
  className,
  errors,
  hint,
}: {
  id: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  nullable?: boolean;
  placeholder?: string;
  className?: string;
  errors?: string[];
  hint?: boolean;
}) {
  const shown = value == null ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => {
    setText((t) => (t.trim() !== "" && Number(t) === value) || (t.trim() === "" && value == null) ? t : shown);
  }, [value, shown]);
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="off"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (!v.trim()) {
          if (nullable) onChange(null);
        } else if (/^-?\d+$/.test(v.trim()) && Number.isSafeInteger(Number(v.trim()))) onChange(Number(v.trim()));
      }}
      onBlur={() => setText(shown)}
      className={cn(TAP, className)}
      {...aria(id, errors, hint)}
    />
  );
}

/** Problems with a list setting as a whole (none, too many), not with one of its entries. */
function ListError({ issues, path }: { issues: Issue[]; path: string }) {
  const messages = issues.filter((i) => i.path === path).map((i) => i.message);
  return messages.length ? <p className="text-xs text-destructive">{messages.join(" ")}</p> : null;
}

/** Move up, move down and remove for one entry of a list setting; focus follows the moved entry. */
function ItemActions({ id, index, count, name, onMove, onRemove }: { id: string; index: number; count: number; name: string; onMove: (to: number) => void; onRemove: () => void }) {
  const move = (to: number, dir: "up" | "down") => {
    onMove(to);
    requestAnimationFrame(() => {
      const target = document.getElementById(`${id}-${to}-${dir}`) as HTMLButtonElement | null;
      (target && !target.disabled ? target : document.getElementById(`${id}-${to}-${dir === "up" ? "down" : "up"}`))?.focus();
    });
  };
  return (
    <div className="flex items-center gap-0.5">
      <Button id={`${id}-${index}-up`} type="button" variant="ghost" size="icon-sm" className={TAP} disabled={index === 0} aria-label={`Move ${name} up`} onClick={() => move(index - 1, "up")}>
        <ArrowUp />
      </Button>
      <Button
        id={`${id}-${index}-down`}
        type="button"
        variant="ghost"
        size="icon-sm"
        className={TAP}
        disabled={index === count - 1}
        aria-label={`Move ${name} down`}
        onClick={() => move(index + 1, "down")}
      >
        <ArrowDown />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" className={cn("text-muted-foreground hover:text-destructive", TAP)} aria-label={`Remove ${name}`} onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
}

// ───────────────────────────── pickers ─────────────────────────────

interface Option {
  value: string;
  label: string;
  hint?: string;
  group?: string;
}

/** A searchable single choice (a popover with a filtered list). */
function Combo({
  id,
  value,
  options,
  onChange,
  placeholder,
  emptyText,
  loading,
  error,
  errors = [],
  noneLabel,
  onOpen,
}: {
  id: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  placeholder: string;
  emptyText: string;
  loading?: boolean;
  error?: unknown;
  errors?: string[];
  /** Offers clearing the choice under this label. */
  noneLabel?: string;
  /** Called as the list opens (to refresh choices made elsewhere meanwhile). */
  onOpen?: () => void;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (o: boolean) => {
    if (o) onOpen?.();
    setOpenState(o);
  };
  const current = options.find((o) => o.value === value);
  const groups = useMemo(() => {
    const m = new Map<string, Option[]>();
    for (const o of options) m.set(o.group ?? "", [...(m.get(o.group ?? "") ?? []), o]);
    return [...m];
  }, [options]);
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-labelledby={`${id}-label ${id}`}
          {...aria(id, errors)}
          className={cn("w-full justify-between font-normal", TAP)}
        >
          <span className={cn("truncate", !current && "text-muted-foreground")}>{current?.label ?? (value ? (loading ? "Loading…" : "Not available to you") : placeholder)}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>{loading ? "Loading…" : error ? `Could not load the choices: ${errorMessage(error)}` : emptyText}</CommandEmpty>
            {noneLabel && value && (
              <CommandGroup>
                <CommandItem value="__none__" onSelect={() => pick("")}>
                  <X className="size-4" aria-hidden="true" />
                  {noneLabel}
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map(([group, list]) => (
              <CommandGroup key={group} heading={group || undefined}>
                {list.map((o) => (
                  <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ""} ${o.value}`} onSelect={() => pick(o.value)}>
                    <Check className={cn("size-4", o.value === value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Lists one can open from a shortcut or show in a quick list (the entities the viewer can query). */
function EntityPicker(p: { id: string; value: string; onChange: (v: string) => void; errors?: string[]; noneLabel?: string }) {
  const sources = useStudioSources();
  const modules = useMetaIndex().data?.modules;
  const options = useMemo(() => {
    const label = new Map(modules?.map((m) => [m.name, m.label]));
    return (sources.data?.entities ?? [])
      .map((e) => ({ value: e.name, label: e.label, group: (e.module && label.get(e.module)) || "Other" }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  }, [sources.data, modules]);
  return <Combo {...p} options={options} loading={sources.isLoading} error={sources.error} placeholder="Choose a list" emptyText="No list matches." />;
}

const RECORD_TEXT: Record<StudioKind, { placeholder: string; empty: string }> = {
  reports: { placeholder: "Choose a report", empty: "No saved reports yet." },
  charts: { placeholder: "Choose a chart", empty: "No charts yet. Make one in the chart builder." },
  cards: { placeholder: "Choose a number card", empty: "No number cards yet. Make one in the card builder." },
  dashboards: { placeholder: "Choose a dashboard", empty: "No dashboards yet." },
  spaces: { placeholder: "Choose a space", empty: "No spaces yet." },
};

function RecordPicker({ kind, ...p }: { kind: StudioKind; id: string; value: string; onChange: (v: string) => void; errors?: string[] }) {
  const q = useStudioList(kind);
  const label = useEntityLabels();
  const options = useMemo(
    () => (q.data ?? []).map((r) => ({ value: r.id, label: r.label, hint: "base_entity" in r && typeof r.base_entity === "string" ? label(r.base_entity) : undefined })),
    [q.data, label],
  );
  // A record made in another tab (the builders open in one) shows up as the list opens.
  return <Combo {...p} options={options} loading={q.isLoading} error={q.error} placeholder={RECORD_TEXT[kind].placeholder} emptyText={RECORD_TEXT[kind].empty} onOpen={() => void q.refetch()} />;
}

function BuiltinPicker(p: { id: string; value: string; onChange: (v: string) => void; errors?: string[] }) {
  const sources = useStudioSources();
  const modules = useMetaIndex().data?.modules;
  const options = useMemo(() => {
    const label = new Map(modules?.map((m) => [m.name, m.label]));
    return (sources.data?.builtin ?? []).map((r) => ({ value: r.name, label: r.label, group: (r.module && label.get(r.module)) || "Other" }));
  }, [sources.data, modules]);
  return <Combo {...p} options={options} loading={sources.isLoading} error={sources.error} placeholder="Choose a report" emptyText="No report matches." />;
}

/** The control for a shortcut's or link's target of a kind. */
function TargetRow({ kind, id, value, onChange, errors }: { kind: LinkTarget; id: string; value: string; onChange: (v: string) => void; errors: string[] }) {
  const props = { id, value, onChange, errors };
  const control =
    kind === "entity" ? (
      <EntityPicker {...props} />
    ) : kind === "report" ? (
      <RecordPicker kind="reports" {...props} />
    ) : kind === "dashboard" ? (
      <RecordPicker kind="dashboards" {...props} />
    ) : kind === "builtin" ? (
      <BuiltinPicker {...props} />
    ) : (
      <Input id={id} value={value} placeholder="/app/e/SalesInvoice or https://…" inputMode="url" onChange={(e) => onChange(e.target.value)} className={TAP} {...aria(id, errors, true)} />
    );
  return (
    <Row id={id} label={TARGET_LABEL[kind]} errors={errors} hint={kind === "url" ? "An app path opens here; other addresses open in a new tab." : undefined}>
      {control}
    </Row>
  );
}

const SWATCHES: [string, string][] = [
  ["#2f5bea", "Blue"],
  ["#0f8f80", "Teal"],
  ["#b7791f", "Amber"],
  ["#7c4ddb", "Purple"],
  ["#d23f45", "Red"],
  ["#2f8a42", "Green"],
  ["#d55a06", "Orange"],
  ["#5b6b80", "Slate"],
];

function ColorPicker({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const custom = !!value && !SWATCHES.some(([c]) => c === value);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ToggleGroup id={id} type="single" spacing={1} value={value || "none"} onValueChange={(v) => v && onChange(v === "none" ? "" : v)} aria-labelledby={`${id}-label`} className="flex-wrap">
        <ToggleGroupItem value="none" aria-label="No accent" title="No accent" className="size-8 p-0 pointer-coarse:size-11">
          <Ban className="size-4 text-muted-foreground" />
        </ToggleGroupItem>
        {SWATCHES.map(([c, name]) => (
          <ToggleGroupItem key={c} value={c} aria-label={name} title={name} className="size-8 p-0 data-[state=on]:ring-2 data-[state=on]:ring-ring pointer-coarse:size-11">
            <span className="size-4 rounded-full" style={{ background: c }} />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <label
        className={cn("relative inline-flex size-8 cursor-pointer items-center justify-center rounded-md border hover:bg-accent pointer-coarse:size-11", custom && "ring-2 ring-ring")}
        title="Another color"
        style={custom ? { background: value } : undefined}
      >
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#2f5bea"}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          aria-label="Another color"
        />
        {!custom && <Palette className="size-4 text-muted-foreground" aria-hidden="true" />}
      </label>
    </div>
  );
}

// ───────────────────────────── fields of an entity ─────────────────────────────

const LONG = new Set<FieldType>(["table", "json", "secret", "code", "markdown", "text", "attach"]);

const sysField = (name: string, type: FieldType): MetaField => ({ name, label: SYSTEM_FIELD_LABELS[name] ?? humanize(name), type, can_read: true, storage: "column" });

/** Fields worth filtering, showing or sorting by: readable, short, plus the record's own (number, status, dates). */
function fieldChoices(meta: EntityMeta | undefined): MetaField[] {
  if (!meta) return [];
  return [
    ...meta.fields.filter((f) => f.can_read && !f.hidden && !LONG.has(f.type)),
    ...(meta.numbering ? [sysField("number", "data")] : []),
    ...(meta.submittable ? [sysField("docstatus", "int")] : []),
    ...(meta.workflow ? [sysField("workflow_state", "data")] : []),
    sysField("created_at", "datetime"),
    sysField("updated_at", "datetime"),
  ];
}

const kindOf = (f: MetaField | undefined): FilterKind => (f?.name === "docstatus" ? "select" : filterKind(f?.type ?? "data"));

function FilterEditor({ entity, value, onChange, issues, path, id }: { entity: string; value: Filters | null | undefined; onChange: (f: SpecFilter[]) => void; issues: Issue[]; path: string; id: string }) {
  const meta = useEntityMeta(entity || undefined);
  const rows = filterList(value);
  const known = useMemo(() => fieldChoices(meta.data), [meta.data]);
  // Paths the editor does not offer (link paths written elsewhere) stay editable as text.
  const fields = useMemo(() => {
    const extra = rows.map((r) => r[0]).filter((p) => p && !known.some((f) => f.name === p));
    return [...known, ...[...new Set(extra)].map((p) => ({ name: p, label: p, type: "data" as const, can_read: true }))];
  }, [known, rows]);
  const set = (i: number, row: SpecFilter) => onChange(rows.map((r, j) => (j === i ? row : r)));
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-medium">Filters</legend>
      {!rows.length && <p className="text-xs text-muted-foreground">Every record is included. Add a filter to narrow it down.</p>}
      {rows.map((r, i) => {
        const field = fields.find((f) => f.name === r[0]);
        const kind = kindOf(field);
        const errors = issuesAt(issues, `${path}[${i}]`);
        const rid = `${id}-${i}`;
        return (
          <div key={i} role="group" aria-label={`Filter ${i + 1}`} className={cn("grid gap-2 rounded-lg border p-2", errors.length && "border-destructive")}>
            <div className="flex items-center gap-2">
              <Select
                value={r[0] ?? ""}
                onValueChange={(name) => {
                  const k = kindOf(fields.find((f) => f.name === name));
                  set(i, [name, OPS[k][0], initialValue(k, OPS[k][0])]);
                }}
              >
                <SelectTrigger aria-label="Field" className={cn("min-w-0 flex-1", TAP)} {...aria(rid, errors)}>
                  <SelectValue placeholder={meta.isLoading ? "Loading fields…" : "Field"} />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((f) => (
                    <SelectItem key={f.name} value={f.name}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="icon-sm" className={TAP} aria-label={`Remove filter ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <X />
              </Button>
            </div>
            {field && (
              <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-2">
                <Select value={r[1]} onValueChange={(op) => set(i, [r[0], op as FilterOp, initialValue(kind, op as FilterOp)])}>
                  <SelectTrigger aria-label="Condition" className={cn("w-full", TAP)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([...OPS[kind], r[1]])].map((op) => (
                      <SelectItem key={op} value={op}>
                        {opLabel(op, kind)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FilterValueInput id={`${rid}-value`} field={field} kind={kind} op={r[1]} value={r[2]} onChange={(v) => set(i, [r[0], r[1], v])} />
              </div>
            )}
            {errors.length > 0 && (
              <p id={`${rid}-error`} className="text-xs text-destructive">
                {errors.join(" ")}
              </p>
            )}
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" className={cn("justify-self-start", TAP)} disabled={!entity || rows.length >= 50} onClick={() => onChange([...rows, ["", "=", ""]])}>
        <Plus /> Add filter
      </Button>
    </fieldset>
  );
}

function FilterValueInput({ id, field, kind, op, value, onChange }: { id: string; field: MetaField; kind: FilterKind; op: FilterOp; value: unknown; onChange: (v: unknown) => void }) {
  const choice = (current: string, options: [string, string][], pick: (v: string) => void) => (
    <Select value={current} onValueChange={pick}>
      <SelectTrigger id={id} aria-label="Value" className={cn("w-full", TAP)}>
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  if (op === "is")
    return choice(
      value === "not set" ? "not set" : "set",
      [
        ["set", "set"],
        ["not set", "not set"],
      ],
      onChange,
    );
  if (field.name === "docstatus")
    return choice(
      value === undefined || value === null || value === "" ? "" : String(value),
      DOCSTATUS_LABEL.map((l, i) => [String(i), l]),
      (v) => onChange(Number(v)),
    );
  if (kind === "check")
    return choice(
      value === false ? "0" : "1",
      [
        ["1", "Yes"],
        ["0", "No"],
      ],
      (v) => onChange(v === "1"),
    );
  if (kind === "select" && (op === "in" || op === "not in")) return <MultiChoice id={id} options={field.options ?? []} value={Array.isArray(value) ? value.map(String) : []} onChange={onChange} />;
  if (kind === "select" && field.options?.length)
    return choice(
      typeof value === "string" ? value : "",
      field.options.map((o) => [o, o]),
      onChange,
    );
  if (kind === "link" && field.to)
    return <LinkInput id={id} to={field.to} value={typeof value === "string" && value ? value : null} label="Value" placeholder="Choose" onChange={(v) => onChange(v ?? "")} />;
  const dated = kind === "date" || kind === "datetime";
  return (
    <Input
      id={id}
      aria-label="Value"
      type={dated ? "date" : "text"}
      inputMode={kind === "number" ? "decimal" : undefined}
      value={filterInput(field.type, op, value)}
      onChange={(e) => onChange(filterValue(field.type, op, e.target.value))}
      className={TAP}
    />
  );
}

function MultiChoice({ id, options, value, onChange }: { id: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" aria-label={`Values: ${value.join(", ") || "none chosen"}`} className={cn("w-full justify-between font-normal", TAP)}>
          <span className={cn("truncate", !value.length && "text-muted-foreground")}>{value.length ? value.join(", ") : "Choose"}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>No options.</CommandEmpty>
            {options.map((o) => {
              const on = value.includes(o);
              return (
                <CommandItem key={o} value={o} onSelect={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
                  <Check className={cn("size-4", on ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                  {o}
                  {on && <span className="sr-only"> (chosen)</span>}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FieldsPicker({ id, meta, value, onChange, errors }: { id: string; meta: EntityMeta | undefined; value: string[]; onChange: (v: string[]) => void; errors: string[] }) {
  const choices = useMemo(() => fieldChoices(meta), [meta]);
  const label = (n: string) => choices.find((f) => f.name === n)?.label ?? humanize(n);
  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Fields shown">
          {value.map((n) => (
            <li key={n}>
              <Badge variant="secondary" className="gap-1 py-1 pr-1">
                {label(n)}
                <button type="button" aria-label={`Stop showing ${label(n)}`} onClick={() => onChange(value.filter((x) => x !== n))} className="rounded-sm p-0.5 hover:bg-background">
                  <X className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" size="sm" disabled={!meta} aria-labelledby={`${id}-label ${id}`} {...aria(id, errors, true)} className={cn("justify-self-start", TAP)}>
            <Plus /> {value.length ? "Change fields" : "Choose fields"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search fields…" />
            <CommandList>
              <CommandEmpty>No field matches.</CommandEmpty>
              {choices.map((f) => {
                const on = value.includes(f.name);
                return (
                  <CommandItem
                    key={f.name}
                    value={`${f.label} ${f.name}`}
                    disabled={!on && value.length >= 12}
                    onSelect={() => onChange(on ? value.filter((x) => x !== f.name) : [...value, f.name])}
                  >
                    <Check className={cn("size-4", on ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                    {f.label}
                    {on && <span className="sr-only"> (shown)</span>}
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const DEFAULT_ORDER = "__default__";

function SortPicker({ id, meta, value, onChange }: { id: string; meta: EntityMeta | undefined; value: string; onChange: (v: string) => void }) {
  const [field, dir = "desc"] = value.trim().split(/\s+/);
  const choices = useMemo(() => fieldChoices(meta).filter((f) => f.storage === "column"), [meta]);
  const options = field && !choices.some((f) => f.name === field) ? [...choices, sysField(field, "data")] : choices;
  return (
    <div className="flex gap-2">
      <Select value={field || DEFAULT_ORDER} onValueChange={(f) => onChange(f === DEFAULT_ORDER ? "" : `${f} ${dir}`)}>
        <SelectTrigger id={id} className={cn("min-w-0 flex-1", TAP)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_ORDER}>The list’s usual order</SelectItem>
          {options.map((f) => (
            <SelectItem key={f.name} value={f.name}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ToggleGroup type="single" variant="outline" value={field ? dir : ""} disabled={!field} onValueChange={(d) => d && field && onChange(`${field} ${d}`)} aria-label="Direction">
        <ToggleGroupItem value="asc" aria-label="Ascending" title="Ascending" className={TAP}>
          <ArrowUp />
        </ToggleGroupItem>
        <ToggleGroupItem value="desc" aria-label="Descending" title="Descending" className={TAP}>
          <ArrowDown />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

// ───────────────────────────── forms ─────────────────────────────

function ShortcutForm({ block: b, onChange, issues, id }: FormProps<Of<"shortcut">>) {
  const kind = targetOf(b, SHORTCUT_TARGETS);
  const labels = useEntityLabels();
  const e = (path: string) => issuesAt(issues, path);
  return (
    <FieldGroup className="gap-5">
      <TextRow id={`${id}-label`} label="Label" value={b.label} placeholder="Unpaid invoices" errors={e("label")} onChange={(label) => onChange({ ...b, label }, `${id}:label`)} />
      <Row id={`${id}-opens`} label="Opens">
        <Select value={kind} onValueChange={(k) => onChange(retarget(b, SHORTCUT_TARGETS, k))}>
          <SelectTrigger id={`${id}-opens`} className={cn("w-full", TAP)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHORTCUT_TARGETS.map((k) => (
              <SelectItem key={k} value={k}>
                {TARGET_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <TargetRow
        kind={kind}
        id={`${id}-target`}
        value={b[kind] ?? ""}
        errors={e(kind)}
        onChange={(v) =>
          kind === "entity"
            ? // Another list: its filters no longer apply; an empty label takes the list's name.
              onChange({ ...b, entity: v, filters: v === b.entity ? b.filters : [], label: b.label.trim() ? b.label : labels(v) })
            : onChange({ ...b, [kind]: v }, `${id}:target`)
        }
      />
      {kind === "entity" && b.entity && (
        <>
          <FilterEditor entity={b.entity} value={b.filters} onChange={(filters) => onChange({ ...b, filters }, `${id}:filters`)} issues={issues} path="filters" id={`${id}-filters`} />
          <Field orientation="horizontal" className="items-center">
            <Switch id={`${id}-count`} checked={!!b.show_count} onCheckedChange={(show_count) => onChange({ ...b, show_count })} />
            <FieldLabel htmlFor={`${id}-count`} className="font-normal">
              Show a live count of the matching records
            </FieldLabel>
          </Field>
        </>
      )}
      <Row id={`${id}-color`} label="Accent color" optional errors={e("color")}>
        <ColorPicker id={`${id}-color`} value={b.color ?? ""} onChange={(color) => onChange({ ...b, color })} />
      </Row>
    </FieldGroup>
  );
}

function LinksForm({ block: b, onChange, issues, id }: FormProps<Of<"links">>) {
  const labels = useEntityLabels();
  const sources = useStudioSources().data;
  const setItems = (items: Of<"links">["items"], tag?: string) => onChange({ ...b, items }, tag);
  const nameOf = (kind: LinkTarget, v: string) => (kind === "entity" ? labels(v) : kind === "builtin" ? (sources?.builtin.find((r) => r.name === v)?.label ?? "") : "");
  return (
    <FieldGroup className="gap-5">
      <TextRow id={`${id}-label`} label="Title" value={b.label} placeholder="Documents" errors={issuesAt(issues, "label")} onChange={(label) => onChange({ ...b, label }, `${id}:label`)} />
      <fieldset className="grid gap-3">
        <legend className="mb-1.5 text-sm font-medium">Links</legend>
        <ListError issues={issues} path="items" />
        {b.items.map((l, i) => {
          const kind = targetOf(l, LINK_TARGETS);
          const iid = `${id}-item-${i}`;
          const setItem = (item: typeof l, tag?: string) => setItems(b.items.map((x, j) => (j === i ? item : x)), tag);
          return (
            <div key={i} role="group" aria-label={`Link ${i + 1}`} className="grid gap-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Link {i + 1}</span>
                <ItemActions
                  id={`${id}-item`}
                  index={i}
                  count={b.items.length}
                  name={l.label.trim() || `link ${i + 1}`}
                  onMove={(to) => setItems(arrayMove(b.items, i, to))}
                  onRemove={() => setItems(b.items.filter((_, j) => j !== i))}
                />
              </div>
              <TextRow id={`${iid}-label`} label="Label" value={l.label} errors={issuesAt(issues, `items[${i}].label`)} onChange={(label) => setItem({ ...l, label }, `${iid}:label`)} />
              <Row id={`${iid}-opens`} label="Opens">
                <Select value={kind} onValueChange={(k) => setItem(retarget(l, LINK_TARGETS, k))}>
                  <SelectTrigger id={`${iid}-opens`} className={cn("w-full", TAP)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_TARGETS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {TARGET_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <TargetRow
                kind={kind}
                id={`${iid}-target`}
                value={l[kind] ?? ""}
                errors={issuesAt(issues, `items[${i}].${kind}`)}
                onChange={(v) => setItem({ ...l, [kind]: v, label: l.label.trim() || nameOf(kind, v) }, kind === "url" ? `${iid}:url` : undefined)}
              />
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" className={cn("justify-self-start", TAP)} disabled={b.items.length >= 50} onClick={() => setItems([...b.items, { label: "", entity: "" }])}>
          <Plus /> Add link
        </Button>
      </fieldset>
    </FieldGroup>
  );
}

function ListForm({ block: b, onChange, issues, id }: FormProps<Of<"list">>) {
  const meta = useEntityMeta(b.entity || undefined).data;
  const e = (path: string) => issuesAt(issues, path);
  return (
    <FieldGroup className="gap-5">
      <Row id={`${id}-entity`} label="List" errors={e("entity")}>
        <EntityPicker
          id={`${id}-entity`}
          value={b.entity}
          errors={e("entity")}
          // Fields, filters and the order belong to the list chosen before.
          onChange={(entity) => onChange(entity === b.entity ? b : { ...b, entity, fields: [], filters: [], sort: "updated_at desc" })}
        />
      </Row>
      <TextRow id={`${id}-label`} label="Title" optional value={b.label} placeholder={meta ? `Recent ${meta.label_plural.toLowerCase()}` : "Recent records"} hint="Defaults to the list’s name." onChange={(label) => onChange({ ...b, label }, `${id}:label`)} />
      {b.entity && (
        <>
          <Row id={`${id}-fields`} label="Fields" optional errors={e("fields")} hint="Up to 12. Without a choice, the list’s usual columns show.">
            <FieldsPicker id={`${id}-fields`} meta={meta} value={b.fields ?? []} errors={e("fields")} onChange={(fields) => onChange({ ...b, fields })} />
          </Row>
          <Row id={`${id}-sort`} label="Order" errors={e("sort")}>
            <SortPicker id={`${id}-sort`} meta={meta} value={b.sort ?? ""} onChange={(sort) => onChange({ ...b, sort })} />
          </Row>
          <Row id={`${id}-limit`} label="Records shown" errors={e("limit")} hint="1 to 50.">
            <IntInput id={`${id}-limit`} nullable value={b.limit} placeholder="5" errors={e("limit")} hint onChange={(limit) => onChange({ ...b, limit }, `${id}:limit`)} className="w-28" />
          </Row>
          <FilterEditor entity={b.entity} value={b.filters} onChange={(filters) => onChange({ ...b, filters }, `${id}:filters`)} issues={issues} path="filters" id={`${id}-filters`} />
        </>
      )}
    </FieldGroup>
  );
}

function MarkdownForm({ block: b, onChange, issues, id }: FormProps<Of<"markdown">>) {
  const errors = issuesAt(issues, "content");
  const length = [...(b.content ?? "")].length;
  return (
    <Row id={`${id}-content`} label="Text" errors={errors} hint="**bold**, *italic*, [a link](/app/e/Customer), # a heading, - a list, > a quote.">
      <Textarea
        id={`${id}-content`}
        rows={12}
        value={b.content}
        onChange={(e) => onChange({ ...b, content: e.target.value }, `${id}:content`)}
        className="min-h-48 font-mono text-xs"
        {...aria(`${id}-content`, errors, true)}
      />
      <span className={cn("text-right text-xs tabular-nums", length > 20_000 ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
        {length.toLocaleString()} / 20,000
      </span>
    </Row>
  );
}

function HeadingForm({ block: b, onChange, issues, id }: FormProps<Of<"heading">>) {
  return (
    <FieldGroup className="gap-5">
      <TextRow id={`${id}-text`} label="Heading" value={b.text} maxLength={200} placeholder="Overview" errors={issuesAt(issues, "text")} onChange={(text) => onChange({ ...b, text }, `${id}:text`)} />
      <Row id={`${id}-level`} label="Size" errors={issuesAt(issues, "level")}>
        <ToggleGroup
          id={`${id}-level`}
          type="single"
          variant="outline"
          value={String(b.level ?? 2)}
          onValueChange={(v) => v && onChange({ ...b, level: Number(v) as 1 | 2 | 3 })}
          aria-labelledby={`${id}-level-label`}
        >
          {[
            ["1", "Large"],
            ["2", "Medium"],
            ["3", "Small"],
          ].map(([v, label]) => (
            <ToggleGroupItem key={v} value={v} className={TAP}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>
    </FieldGroup>
  );
}

function OnboardingForm({ block: b, onChange, issues, id }: FormProps<Of<"onboarding">>) {
  const labels = useEntityLabels();
  const setSteps = (steps: Of<"onboarding">["steps"], tag?: string) => onChange({ ...b, steps }, tag);
  return (
    <FieldGroup className="gap-5">
      <TextRow id={`${id}-title`} label="Title" optional value={b.title} placeholder="Get started" onChange={(title) => onChange({ ...b, title }, `${id}:title`)} />
      <fieldset className="grid gap-3">
        <legend className="mb-1.5 text-sm font-medium">Steps</legend>
        <ListError issues={issues} path="steps" />
        {b.steps.map((s, i) => {
          const sid = `${id}-step-${i}`;
          const setStep = (step: typeof s, tag?: string) => setSteps(b.steps.map((x, j) => (j === i ? step : x)), tag);
          return (
            <div key={i} role="group" aria-label={`Step ${i + 1}`} className="grid gap-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
                <ItemActions
                  id={`${id}-step`}
                  index={i}
                  count={b.steps.length}
                  name={s.label.trim() || `step ${i + 1}`}
                  onMove={(to) => setSteps(arrayMove(b.steps, i, to))}
                  onRemove={() => setSteps(b.steps.filter((_, j) => j !== i))}
                />
              </div>
              <TextRow id={`${sid}-label`} label="Step" value={s.label} placeholder="Add your first customer" errors={issuesAt(issues, `steps[${i}].label`)} onChange={(label) => setStep({ ...s, label }, `${sid}:label`)} />
              <TextRow id={`${sid}-description`} label="Description" optional maxLength={500} value={s.description} onChange={(description) => setStep({ ...s, description }, `${sid}:description`)} />
              <Row id={`${sid}-entity`} label="Done when a record exists in" optional hint="Leave empty for a step that is never ticked off on its own.">
                <EntityPicker
                  id={`${sid}-entity`}
                  value={s.entity ?? ""}
                  noneLabel="No list"
                  onChange={(entity) => setStep({ ...s, entity, filters: entity === s.entity ? s.filters : [], label: s.label.trim() || (entity ? `Add your first ${labels(entity).toLowerCase()}` : "") })}
                />
              </Row>
              {s.entity && (
                <FilterEditor entity={s.entity} value={s.filters} onChange={(filters) => setStep({ ...s, filters }, `${sid}:filters`)} issues={issues} path={`steps[${i}].filters`} id={`${sid}-filters`} />
              )}
              <TextRow
                id={`${sid}-url`}
                label="Opens"
                optional
                value={s.url}
                placeholder={s.entity ? `/app/e/${s.entity}/new` : "/app/…"}
                hint="Without an address, a step with a list opens a new record of it."
                errors={issuesAt(issues, `steps[${i}].url`)}
                onChange={(url) => setStep({ ...s, url }, `${sid}:url`)}
              />
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" className={cn("justify-self-start", TAP)} disabled={b.steps.length >= 20} onClick={() => setSteps([...b.steps, { label: "", entity: "" }])}>
          <Plus /> Add step
        </Button>
      </fieldset>
    </FieldGroup>
  );
}
