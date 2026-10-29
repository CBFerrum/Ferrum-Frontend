// Filter conditions: a field (any path the catalog offers, tags included), an operator that fits
// its type and a value editor to match (record search for links, options for selects, dates, lists).
// The API combines conditions with AND; "is any of" gives OR within a field.

import { ChevronDown, X } from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { issuesAt, type CatalogField, type FieldCatalog, type FilterOp, type Issue, type SpecFilter } from "@/lib/studio";
import { LinkInput, useLinkTitle } from "../../widgets";
import { FieldPicker } from "./pickers";
import { dayValue, NUMBER_TYPES, opLabel, opsFor, valueForOp } from "./state";
import { Issues } from "./ui";

/** The catalog's fields plus the tag filter, which every entity takes. */
export function filterFields(catalog: FieldCatalog | undefined): CatalogField[] {
  if (!catalog) return [];
  const tag: CatalogField = { path: catalog.filters.tag, label: "Tag", type: "data", group: catalog.label, groupable: false, aggregates: [], buckets: [], bucket_required: false };
  return [...catalog.fields, tag];
}

const END_OPS = new Set<FilterOp>(["<=", ">"]);

/** Date-time values follow the operator: a day's start, or its end where the whole day must count. */
function redate(op: FilterOp, value: unknown): unknown {
  const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");
  if (op === "between" && Array.isArray(value)) return [dayValue(day(value[0]), "datetime", false), dayValue(day(value[1]), "datetime", true)];
  return typeof value === "string" ? dayValue(day(value), "datetime", END_OPS.has(op)) : value;
}

interface FilterEditorProps {
  filters: SpecFilter[];
  fields: CatalogField[];
  onChange: (next: SpecFilter[], key?: string) => void;
  issues?: Issue[];
  /** Issue path prefix (`filters`). */
  at?: string;
  disabled?: boolean;
}

export function FilterEditor({ filters, fields, onChange, issues = [], at = "filters", disabled }: FilterEditorProps) {
  const byPath = useMemo(() => new Map(fields.map((f) => [f.path, f])), [fields]);
  const add = (f: CatalogField) => {
    const op = opsFor(f.type)[0];
    onChange([...filters, [f.path, op, valueForOp(op, "", f.type)]]);
  };
  return (
    <div className="grid gap-1.5">
      {filters.length > 1 && <p className="text-xs text-muted-foreground">Rows match all of these conditions. Use “is any of” to allow several values.</p>}
      {filters.length > 0 && (
        <ul className="grid gap-1.5">
          {filters.map((f, i) => (
            <FilterRow
              key={i}
              index={i}
              filter={f}
              field={byPath.get(f[0])}
              fields={fields}
              messages={issuesAt(issues, `${at}[${i}]`)}
              onChange={(next, key) => onChange(filters.map((x, j) => (j === i ? next : x)), key)}
              onRemove={() => onChange(filters.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
      )}
      <div>
        <FieldPicker add="Add filter" label="Add filter" fields={fields} onChange={add} disabled={disabled || !fields.length} />
      </div>
    </div>
  );
}

interface RowProps {
  index: number;
  filter: SpecFilter;
  field: CatalogField | undefined;
  fields: CatalogField[];
  messages: string[];
  onChange: (f: SpecFilter, key?: string) => void;
  onRemove: () => void;
}

function FilterRow({ index, filter: [path, op, value], field, fields, messages, onChange, onRemove }: RowProps) {
  const id = useId();
  const type = field?.type ?? "data";
  const ops = opsFor(type);
  const n = index + 1;
  const setOp = (o: FilterOp) => {
    const v = valueForOp(o, value, type);
    onChange([path, o, type === "datetime" ? redate(o, v) : v]);
  };
  const setField = (f: CatalogField) => {
    const o = opsFor(f.type).includes(op) ? op : opsFor(f.type)[0];
    onChange([f.path, o, valueForOp(o, f.type === type ? value : "", f.type)]);
  };
  return (
    <li className="grid gap-1.5 rounded-md border border-border bg-card p-1.5">
      <div className="flex min-w-0 gap-1">
        <FieldPicker fields={fields} value={path} label={`Filter ${n}: field`} onChange={setField} invalid={!field && !!path} />
        <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Remove filter ${n}`} onClick={onRemove}>
          <X />
        </Button>
      </div>
      <div className="flex min-w-0 gap-1">
        <Select value={op} onValueChange={(o) => setOp(o as FilterOp)}>
          <SelectTrigger className="max-w-[45%] shrink-0" aria-label={`Filter ${n}: condition`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(ops.includes(op) ? ops : [...ops, op]).map((o) => (
              <SelectItem key={o} value={o}>
                {opLabel(o, type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-0 flex-1">
          <ValueInput field={field} type={type} op={op} value={value} label={`Filter ${n}: value`} describedBy={messages.length ? id : undefined} onChange={(v) => onChange([path, op, v], `filter-${index}`)} />
        </div>
      </div>
      <Issues id={id} messages={messages} />
    </li>
  );
}

interface ValueProps {
  field: CatalogField | undefined;
  type: string;
  op: FilterOp;
  value: unknown;
  label: string;
  describedBy?: string;
  onChange: (v: unknown) => void;
}

function ValueInput(p: ValueProps) {
  const { op, value, onChange, label } = p;
  if (op === "is")
    return (
      <Select value={value === "not set" ? "not set" : "set"} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="set">set (has a value)</SelectItem>
          <SelectItem value="not set">not set (empty)</SelectItem>
        </SelectContent>
      </Select>
    );
  if (op === "in" || op === "not in") return <MultiValue {...p} value={Array.isArray(value) ? value : []} />;
  if (op === "between") {
    const [a, b] = Array.isArray(value) && value.length === 2 ? value : ["", ""];
    return (
      <div className="grid grid-cols-2 gap-1">
        <Single {...p} label={`${label} (from)`} value={a} end={false} onChange={(v) => onChange([v, b])} />
        <Single {...p} label={`${label} (to)`} value={b} end onChange={(v) => onChange([a, v])} />
      </div>
    );
  }
  return <Single {...p} end={END_OPS.has(op)} />;
}

function Single({ field, type, value, label, describedBy, onChange, end }: ValueProps & { end: boolean }) {
  const text = value === null || value === undefined ? "" : String(value);
  if (type === "check")
    return (
      <Select value={value === false ? "no" : "yes"} onValueChange={(v) => onChange(v === "yes")}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    );
  if (type === "link" && field?.to) return <LinkInput to={field.to} value={text || null} label={label} describedBy={describedBy} onChange={(v) => onChange(v ?? "")} />;
  if (type === "select" && field?.options?.length)
    return (
      <Select value={text || undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label} aria-describedby={describedBy}>
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  if (type === "date" || type === "datetime")
    return <Input type="date" aria-label={label} aria-describedby={describedBy} value={text.slice(0, 10)} onChange={(e) => onChange(dayValue(e.target.value, type, end))} />;
  const numeric = NUMBER_TYPES.has(type);
  return (
    <Input
      aria-label={label}
      aria-describedby={describedBy}
      inputMode={numeric ? "decimal" : undefined}
      placeholder={numeric ? "0" : "Value"}
      className={numeric ? "text-right tabular-nums" : undefined}
      value={text}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function LinkName({ to, id }: { to: string; id: string }) {
  return <>{useLinkTitle(to, id) ?? "…"}</>;
}

function MultiValue({ field, type, value, label, onChange }: ValueProps & { value: unknown[] }) {
  const [text, setText] = useState("");
  const add = (v: unknown) => {
    if (v === "" || v === null || v === undefined || value.includes(v)) return;
    onChange([...value, v]);
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  if (type === "select" && field?.options?.length)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full min-w-0 justify-between px-2.5 font-normal" aria-label={`${label}: ${value.length ? value.join(", ") : "none chosen"}`}>
            <span className={value.length ? "truncate" : "truncate text-muted-foreground"}>{value.length ? value.join(", ") : "Choose…"}</span>
            <ChevronDown className="opacity-50" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72">
          {field.options.map((o) => (
            <DropdownMenuCheckboxItem key={o} checked={value.includes(o)} onSelect={(e) => e.preventDefault()} onCheckedChange={(on) => onChange(on ? [...value, o] : value.filter((x) => x !== o))}>
              {o}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && text.trim()) {
      e.preventDefault();
      add(text.trim());
      setText("");
    } else if (e.key === "Backspace" && !text && value.length) remove(value.length - 1);
  };
  return (
    <div className="grid gap-1">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={`${label}: chosen values`}>
          {value.map((v, i) => (
            <li key={`${String(v)}-${i}`} className="flex max-w-full items-center gap-0.5 rounded bg-secondary py-0.5 pr-0.5 pl-1.5 text-xs">
              <span className="truncate">{type === "link" && field?.to && typeof v === "string" ? <LinkName to={field.to} id={v} /> : String(v)}</span>
              <button type="button" className="grid size-5 place-items-center rounded hover:bg-accent pointer-coarse:size-8" aria-label={`Remove value ${i + 1}`} onClick={() => remove(i)}>
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {type === "link" && field?.to ? (
        <LinkInput to={field.to} value={null} label={`${label}: add a value`} placeholder="Add a value…" onChange={(v) => v && add(v)} />
      ) : (
        <Input
          aria-label={`${label}: add a value`}
          placeholder="Type a value, press Enter"
          inputMode={NUMBER_TYPES.has(type) ? "decimal" : undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (text.trim()) add(text.trim());
            setText("");
          }}
        />
      )}
    </div>
  );
}
