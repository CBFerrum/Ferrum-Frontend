// Searchable pickers: a field of the catalog (grouped by the entity, link or child table it is
// reached through) and an entity to report on (grouped by module).

import { Check, ChevronsUpDown, Database, Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CatalogField, Sources } from "@/lib/studio";
import { useMetaIndex } from "@/lib/meta";
import { cn } from "@/lib/utils";
import { TypeIcon } from "./ui";

const ITEM = "pointer-coarse:py-3";

/** The part of a catalog label after the group it is listed under (`Customer › Customer Group` → `Customer Group`). */
const shortLabel = (f: CatalogField) => {
  const parts = f.label.split(" › ");
  return parts.length > 1 ? parts[parts.length - 1] : f.label;
};

function grouped(fields: CatalogField[]): [string, CatalogField[]][] {
  const out = new Map<string, CatalogField[]>();
  for (const f of fields) {
    const list = out.get(f.group);
    if (list) list.push(f);
    else out.set(f.group, [f]);
  }
  return [...out];
}

interface FieldPickerProps {
  fields: CatalogField[];
  value?: string;
  onChange: (f: CatalogField) => void;
  /** Accessible name (`Group by field 2`). */
  label: string;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  /** An extra first choice (`All records`, `No period`). */
  none?: { label: string; onSelect: () => void };
  /** A trigger that adds rather than shows the value. */
  add?: string;
  disabled?: boolean;
  className?: string;
}

export function FieldPicker({ fields, value, onChange, label, placeholder = "Choose a field", invalid, describedBy, none, add, disabled, className }: FieldPickerProps) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => grouped(fields), [fields]);
  const selected = value ? fields.find((f) => f.path === value) : undefined;
  const choose = (f: CatalogField) => {
    onChange(f);
    setOpen(false);
  };
  const shownText = selected?.label ?? (value || (none ? none.label : placeholder));
  let trigger: ReactNode;
  if (add) {
    trigger = (
      <Button variant="ghost" size="sm" disabled={disabled} className={cn("text-primary", className)}>
        <Plus /> {add}
      </Button>
    );
  } else {
    trigger = (
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={open}
        aria-label={`${label}: ${shownText}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        className={cn("w-full min-w-0 shrink justify-between px-2.5 font-normal", !selected && !value && "text-muted-foreground", className)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {selected && <TypeIcon type={selected.type} />}
          <span className="truncate" title={selected?.label ?? value}>
            {shownText}
          </span>
        </span>
        <ChevronsUpDown className="opacity-50" aria-hidden="true" />
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[min(calc(100vw-2rem),380px)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fields…" aria-label={`Search fields for ${label}`} />
          <CommandList className="max-h-[min(55vh,380px)]">
            <CommandEmpty>No field matches.</CommandEmpty>
            {none && (
              <CommandGroup>
                <CommandItem
                  value="__none__"
                  keywords={[none.label]}
                  className={ITEM}
                  onSelect={() => {
                    none.onSelect();
                    setOpen(false);
                  }}
                >
                  {none.label}
                  {!value && <Check className="ml-auto" />}
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map(([group, list]) => (
              <CommandGroup key={group} heading={group}>
                {list.map((f) => (
                  <CommandItem key={f.path} value={f.path} keywords={[f.label, group]} className={ITEM} onSelect={() => choose(f)}>
                    <TypeIcon type={f.type} />
                    <span className="truncate">{shortLabel(f)}</span>
                    {f.path === value && <Check className="ml-auto" />}
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

interface EntityPickerProps {
  sources: Sources | undefined;
  loading?: boolean;
  value: string;
  onChange: (entity: string) => void;
  /** A large trigger for the empty start screen. */
  large?: boolean;
  autoOpen?: boolean;
}

export function EntityPicker({ sources, loading, value, onChange, large, autoOpen }: EntityPickerProps) {
  const [open, setOpen] = useState(!!autoOpen);
  const index = useMetaIndex();
  const moduleLabel = useMemo(() => new Map(index.data?.modules.map((m) => [m.name, m.label])), [index.data]);
  const groups = useMemo(() => {
    const out = new Map<string, { name: string; label: string }[]>();
    for (const e of [...(sources?.entities ?? [])].sort((a, b) => a.label.localeCompare(b.label))) {
      const g = (e.module && moduleLabel.get(e.module)) || (e.module ?? "Other");
      const list = out.get(g);
      if (list) list.push(e);
      else out.set(g, [e]);
    }
    return [...out].sort(([a], [b]) => a.localeCompare(b));
  }, [sources, moduleLabel]);
  const label = sources?.entities.find((e) => e.name === value)?.label ?? value;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={large ? "default" : "outline"}
          size={large ? "lg" : "default"}
          role="combobox"
          aria-expanded={open}
          aria-label={value ? `Report on: ${label}` : "Choose what to report on"}
          className={cn(!large && "w-full min-w-0 justify-between px-2.5 font-normal")}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Database aria-hidden="true" className={cn(!large && "text-muted-foreground")} />
            <span className="truncate">{value ? label : "Choose what to report on"}</span>
          </span>
          {!large && <ChevronsUpDown className="opacity-50" aria-hidden="true" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(calc(100vw-2rem),360px)] p-0" align={large ? "center" : "start"}>
        <Command>
          <CommandInput placeholder="Search records to report on…" aria-label="Search records to report on" />
          <CommandList className="max-h-[min(55vh,380px)]">
            <CommandEmpty>{loading ? "Loading…" : "Nothing matches."}</CommandEmpty>
            {groups.map(([group, list]) => (
              <CommandGroup key={group} heading={group}>
                {list.map((e) => (
                  <CommandItem
                    key={e.name}
                    value={e.name}
                    keywords={[e.label, group]}
                    className={ITEM}
                    onSelect={() => {
                      onChange(e.name);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{e.label}</span>
                    {e.name === value && <Check className="ml-auto" />}
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
