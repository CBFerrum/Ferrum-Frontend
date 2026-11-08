// Searchable pickers for the builders: any list of options (grouped, filtered as you type), the
// fields of an entity's query catalog, and the entities a chart or card can report on.

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { humanize } from "@/lib/format";
import { useMetaIndex } from "@/lib/meta";
import { cn } from "@/lib/utils";
import { useStudioSources, type Agg, type CatalogField, type FieldCatalog } from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t, isolate } from "@ferrum/client";

export interface PickOption {
  value: string;
  label: string;
  group?: string;
  /** Shown after the label, muted. */
  hint?: string;
}

export interface SearchSelectProps {
  id?: string;
  value: string | null | undefined;
  options: PickOption[];
  onChange: (value: string) => void;
  /** Shows a clear button when set. */
  onClear?: () => void;
  placeholder?: string;
  /** Accessible name when no visible label points at `id`. */
  label?: string;
  invalid?: boolean;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  /** Label for a value not among the options (a saved path the catalog no longer lists). */
  fallbackLabel?: string;
}

export function SearchSelect({ id, value, options, onChange, onClear, placeholder = t("Choose…"), label, invalid, disabled, loading, className, fallbackLabel }: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const groups = useMemo(() => {
    const m = new Map<string, PickOption[]>();
    for (const o of options) {
      const g = o.group ?? "";
      m.set(g, [...(m.get(g) ?? []), o]);
    }
    return [...m.entries()];
  }, [options]);
  const text = selected?.label ?? (value ? (fallbackLabel ?? value) : null);
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label ? `${label}: ${text ?? placeholder}` : undefined}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={cn("h-9 min-w-0 flex-1 justify-between px-3 font-normal", !text && "text-muted-foreground")}
          >
            <span className="truncate">{loading ? t("Loading…") : (text ?? placeholder)}</span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] min-w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder={t("Search…")} />
            <CommandList className="max-h-72">
              <CommandEmpty>{loading ? t("Loading…") : t("No matches.")}</CommandEmpty>
              {groups.map(([g, list]) => (
                <CommandGroup key={g} heading={g || undefined}>
                  {list.map((o) => (
                    <CommandItem
                      key={o.value}
                      value={o.value}
                      keywords={[o.label, o.group ?? "", o.hint ?? ""]}
                      onSelect={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{isolate(o.label)}</span>
                      {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{isolate(o.hint)}</span>}
                      <Check className={cn("size-4", o.value === value ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {onClear && value && !disabled && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("Clear {value}", { value: label ?? t("the choice") })} onClick={onClear}>
          <X />
        </Button>
      )}
    </div>
  );
}

const TYPE_HINT: Record<string, string> = {
  get int() { return t("number"); },
  get decimal() { return t("number"); },
  get currency() { return t("money"); },
  percent: "%",
  get date() { return t("date"); },
  get datetime() { return t("date-time"); },
  get link() { return t("link"); },
  get select() { return t("choice"); },
  get check() { return t("yes/no"); },
};

export type FieldFilter = "any" | "groupable" | "date" | Agg;

/** Fields of the catalog that fit: groupable ones, dates, or those a function applies to. */
export function catalogOptions(catalog: FieldCatalog | undefined, which: FieldFilter): PickOption[] {
  const fits = (f: CatalogField) =>
    which === "any" ? true : which === "groupable" ? f.groupable : which === "date" ? f.buckets.length > 0 : which === "count" ? true : f.aggregates.includes(which);
  return (catalog?.fields ?? []).filter(fits).map((f) => ({ value: f.path, label: f.label, group: f.group, hint: TYPE_HINT[f.type] }));
}

export function FieldPicker({ catalog, which, ...rest }: Omit<SearchSelectProps, "options" | "fallbackLabel"> & { catalog: FieldCatalog | undefined; which: FieldFilter }) {
  const options = useMemo(() => catalogOptions(catalog, which), [catalog, which]);
  return <SearchSelect {...rest} options={options} loading={!catalog} placeholder={rest.placeholder ?? t("Choose a field…")} />;
}

/** The entities the viewer can report on, by module. */
export function EntityPicker(props: Omit<SearchSelectProps, "options">) {
  const sources = useStudioSources();
  const modules = useMetaIndex().data?.modules;
  const options = useMemo(() => {
    const label = new Map(modules?.map((m) => [m.name, m.label]));
    return (sources.data?.entities ?? [])
      .map((e) => ({ value: e.name, label: e.label, group: (e.module && (label.get(e.module) ?? humanize(e.module))) || "Other" }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  }, [sources.data, modules]);
  return <SearchSelect {...props} options={options} loading={sources.isLoading} placeholder={props.placeholder ?? t("Choose what to report on…")} />;
}
