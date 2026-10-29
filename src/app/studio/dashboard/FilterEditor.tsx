// Conditions on a query (`[path, op, value]`): a field from the entity's catalog, an operator that
// fits its type, and a value typed for it (choices, linked records, dates, exact decimals).

import { Plus, Trash2 } from "lucide-react";
import { isDecimalString } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CatalogField, FieldCatalog, FilterOp, SpecFilter } from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LinkInput } from "../../widgets";
import { FieldPicker } from "./pickers";

const OP_LABEL: Record<FilterOp, string> = {
  "=": "is",
  "!=": "is not",
  ">": "greater than",
  ">=": "at least",
  "<": "less than",
  "<=": "at most",
  in: "is any of",
  "not in": "is none of",
  like: "contains",
  "not like": "does not contain",
  between: "between",
  is: "is set or empty",
};

const NUMBER = new Set(["int", "decimal", "currency", "percent", "float"]);

/** Operators that make sense for a field type. */
export function opsFor(type: string | undefined): FilterOp[] {
  if (!type) return ["=", "!=", "is"];
  if (type === "check") return ["="];
  if (NUMBER.has(type)) return ["=", "!=", ">", ">=", "<", "<=", "between", "is"];
  if (type === "date" || type === "datetime") return ["=", ">=", "<=", ">", "<", "between", "is"];
  if (type === "link") return ["=", "!=", "is"];
  if (type === "select") return ["=", "!=", "in", "not in", "is"];
  return ["=", "!=", "like", "not like", "in", "not in", "is"];
}

/** A typed value from what was typed: integers as numbers, decimals as exact strings, lists split on commas. */
function typed(f: CatalogField | undefined, op: FilterOp, raw: string): unknown {
  if (op === "in" || op === "not in") {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return f?.type === "int" ? parts.map((p) => (/^-?\d+$/.test(p) ? Number(p) : p)) : parts;
  }
  const t = raw.trim();
  if (f?.type === "int" && /^-?\d+$/.test(t)) return Number(t);
  return t;
}

const asText = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v));

function defaultValue(f: CatalogField | undefined, op: FilterOp): unknown {
  if (op === "is") return "set";
  if (op === "between") return ["", ""];
  if (op === "in" || op === "not in") return [];
  if (f?.type === "check") return true;
  if (f?.type === "select" && f.options?.length) return f.options[0];
  return "";
}

function ValueInput({ field, op, value, onChange, label }: { field: CatalogField | undefined; op: FilterOp; value: unknown; onChange: (v: unknown) => void; label: string }) {
  const type = field?.type;
  if (op === "is")
    return (
      <Select value={value === "not set" ? "not set" : "set"} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="set">set</SelectItem>
          <SelectItem value="not set">empty</SelectItem>
        </SelectContent>
      </Select>
    );
  if (type === "check")
    return (
      <Select value={value === false ? "no" : "yes"} onValueChange={(v) => onChange(v === "yes")}>
        <SelectTrigger aria-label={label} className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    );
  const inputType = type === "date" || type === "datetime" ? "date" : "text";
  const numeric = !!type && NUMBER.has(type);
  const bad = (v: unknown) => numeric && asText(v) !== "" && !isDecimalString(asText(v));
  if (op === "between") {
    const [a, b] = Array.isArray(value) ? value : ["", ""];
    return (
      <div className="flex min-w-0 items-center gap-1">
        <Input type={inputType} inputMode={numeric ? "decimal" : undefined} value={asText(a)} aria-label={`${label}: from`} aria-invalid={bad(a) || undefined} className="h-9 min-w-0" onChange={(e) => onChange([typed(field, "=", e.target.value), b])} />
        <span className="text-xs text-muted-foreground">and</span>
        <Input type={inputType} inputMode={numeric ? "decimal" : undefined} value={asText(b)} aria-label={`${label}: to`} aria-invalid={bad(b) || undefined} className="h-9 min-w-0" onChange={(e) => onChange([a, typed(field, "=", e.target.value)])} />
      </div>
    );
  }
  if (type === "select" && field?.options?.length && (op === "=" || op === "!="))
    return (
      <Select value={asText(value) || undefined} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="h-9 w-full">
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
  if (type === "link" && field?.to)
    return (
      <div className="min-w-0 [&_.input]:h-9">
        <LinkInput to={field.to} value={typeof value === "string" && value ? value : null} label={label} onChange={(id) => onChange(id ?? "")} />
      </div>
    );
  return (
    <Input
      type={op === "in" || op === "not in" ? "text" : inputType}
      inputMode={numeric ? "decimal" : undefined}
      value={asText(value)}
      placeholder={op === "in" || op === "not in" ? "Values, separated by commas" : op === "like" || op === "not like" ? "Text" : ""}
      aria-label={label}
      aria-invalid={bad(value) || undefined}
      className="h-9 min-w-0"
      onChange={(e) => onChange(typed(field, op, e.target.value))}
    />
  );
}

export function FilterEditor({ catalog, filters, onChange, errors = {} }: { catalog: FieldCatalog | undefined; filters: SpecFilter[]; onChange: (f: SpecFilter[], key?: string) => void; errors?: Record<number, string[]> }) {
  const byPath = new Map(catalog?.fields.map((f) => [f.path, f]));
  const set = (i: number, next: SpecFilter, key?: string) => onChange(filters.map((f, n) => (n === i ? next : f)), key);
  return (
    <div className="grid gap-2">
      {filters.map(([path, op, value], i) => {
        const field = byPath.get(path);
        const ops = opsFor(field?.type);
        const label = `Condition ${i + 1}`;
        return (
          <div key={i} className="grid gap-1">
            <div className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 rounded-md border p-2 sm:grid-cols-[minmax(0,1.2fr)_9rem_minmax(0,1fr)_auto]", errors[i]?.length && "border-destructive")}>
              <FieldPicker
                catalog={catalog}
                which="any"
                value={path}
                label={`${label}: field`}
                className="col-span-1"
                onChange={(p) => {
                  const f = byPath.get(p);
                  const nextOp = opsFor(f?.type).includes(op) ? op : opsFor(f?.type)[0];
                  set(i, [p, nextOp, defaultValue(f, nextOp)]);
                }}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label.toLowerCase()}`} className="sm:order-last" onClick={() => onChange(filters.filter((_, n) => n !== i))}>
                <Trash2 />
              </Button>
              <Select value={ops.includes(op) ? op : ops[0]} onValueChange={(o) => set(i, [path, o as FilterOp, o === op ? value : defaultValue(field, o as FilterOp)])}>
                <SelectTrigger aria-label={`${label}: operator`} className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ops.map((o) => (
                    <SelectItem key={o} value={o}>
                      {OP_LABEL[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <ValueInput field={field} op={op} value={value} label={`${label}: value`} onChange={(v) => set(i, [path, op, v], `filter-${i}`)} />
              </div>
            </div>
            {errors[i]?.map((m) => (
              <p key={m} className="text-xs text-destructive">
                {m}
              </p>
            ))}
          </div>
        );
      })}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={!catalog} onClick={() => onChange([...filters, ["", "=", ""]])}>
          <Plus /> Add condition
        </Button>
      </div>
    </div>
  );
}
