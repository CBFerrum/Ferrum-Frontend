// The viewer's dashboard filters: one input per filter (record, choice, text, yes/no, date, date
// range), applied to every widget that accepts it. Text applies when typing pauses.

import { useEffect, useId, useState } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterDef, FilterValues } from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebounced } from "@/ui/kit";
import { LinkInput } from "../../widgets";
import { DateRangeInput } from "./DateRangeInput";
import { asRange } from "./filters";

const ANY = "__any";

function TextFilter({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const debounced = useDebounced(text, 500);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (debounced.trim() !== value.trim()) onChange(debounced);
  }, [debounced]); // react to the debounced text only
  return <Input id={id} type="search" value={text} placeholder="Any" className="h-9" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onChange(text)} />;
}

export function FilterInput({ def, value, onChange, id }: { def: FilterDef; value: unknown; onChange: (v: unknown) => void; id: string }) {
  const label = def.label || def.name;
  switch (def.type) {
    case "date_range":
      return <DateRangeInput id={id} label={label} value={asRange(value)} onChange={(r) => onChange(r)} />;
    case "link":
      return (
        <div className="[&_.input]:h-9">
          <LinkInput id={id} to={def.to ?? ""} value={typeof value === "string" && value ? value : null} placeholder="Any" onChange={(v) => onChange(v ?? "")} />
        </div>
      );
    case "select":
      return (
        <Select value={typeof value === "string" && value ? value : ANY} onValueChange={(v) => onChange(v === ANY ? "" : v)}>
          <SelectTrigger id={id} className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any</SelectItem>
            {(def.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "check":
      return (
        <Select value={value === true ? "yes" : value === false ? "no" : ANY} onValueChange={(v) => onChange(v === "yes" ? true : v === "no" ? false : "")}>
          <SelectTrigger id={id} className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any</SelectItem>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      );
    case "date":
      return <Input id={id} type="date" className="h-9" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <TextFilter id={id} value={typeof value === "string" ? value : ""} onChange={onChange} />;
  }
}

/**
 * `chosen`: values from the URL; `effective`: what the server applied (defaults included). A
 * filter with a default cannot be emptied (the default applies again): it can be reset.
 */
export function FilterBar({ defs, chosen, effective, onChange, onReset, className }: { defs: FilterDef[]; chosen: FilterValues; effective: FilterValues; onChange: (name: string, v: unknown) => void; onReset: () => void; className?: string }) {
  const id = useId();
  if (!defs.length) return null;
  const changed = Object.keys(chosen).length > 0;
  return (
    <section aria-label="Dashboard filters" className={cn("mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3", className)}>
      {defs.map((d) => {
        const fid = `${id}-${d.name}`;
        return (
          <div key={d.name} className={cn("grid min-w-0 gap-1", d.type === "date_range" ? "basis-full sm:basis-auto sm:min-w-64" : "w-full sm:w-52")}>
            <Label htmlFor={fid} className="text-xs font-normal text-muted-foreground">
              {d.label || d.name}
            </Label>
            <FilterInput id={fid} def={d} value={d.name in chosen ? chosen[d.name] : effective[d.name]} onChange={(v) => onChange(d.name, v)} />
          </div>
        );
      })}
      {changed && (
        <Button type="button" variant="ghost" size="sm" onClick={onReset} className="mb-0.5">
          <RotateCcw /> Reset filters
        </Button>
      )}
    </section>
  );
}
