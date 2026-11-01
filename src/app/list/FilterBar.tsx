// The list's filters as chips: nothing takes room until it is used, and each chip says what it
// narrows the list to. Clicking one edits that filter in a popover; "Filter" adds another. The
// state stays where it was (`f.<field>` in the URL, lib/filters), so links keep working.

import { useEffect, useState, type ReactNode } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { joinRange, splitRange, type FilterState } from "../../lib/filters";
import type { Field } from "../../lib/meta";
import { Field as FieldWrap, Icon, useDebounced } from "../../ui/kit";
import { LinkInput, useLinkTitle } from "../widgets";

/** The filters a chip shows in its text, from `f.<field>`. */
export function chipText(f: Field, value: string): string {
  if (f.type === "check") return value === "1" ? "Yes" : "No";
  if (f.type === "date" || f.type === "datetime") {
    const [from, to] = splitRange(value);
    return from && to ? (from === to ? from : `${from} – ${to}`) : from ? `from ${from}` : to ? `until ${to}` : "";
  }
  return value;
}

function LinkText({ to, id }: { to: string; id: string }) {
  return <>{useLinkTitle(to, id) ?? "…"}</>;
}

/** The value in a chip; a link shows the linked record's title. */
function ChipValue({ field: f, value }: { field: Field; value: string }): ReactNode {
  return f.type === "link" ? <LinkText to={f.to ?? ""} id={value} /> : chipText(f, value);
}

export function FilterControl({ field: f, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const id = `flt-${f.name}`;
  switch (f.type) {
    case "select":
      return (
        <FieldWrap label={f.label} htmlFor={id}>
          <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">All</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </FieldWrap>
      );
    case "check":
      return (
        <FieldWrap label={f.label} htmlFor={id}>
          <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">All</option>
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </FieldWrap>
      );
    case "link":
      return (
        <FieldWrap label={f.label} htmlFor={id}>
          <LinkInput to={f.to ?? ""} id={id} value={value || null} linkFilters={f.link_filters} placeholder="Any" onChange={(v) => onChange(v ?? "")} />
        </FieldWrap>
      );
    case "date":
    case "datetime": {
      const [from, to] = splitRange(value);
      return (
        <FieldWrap label={f.label} htmlFor={id}>
          <div className="range">
            <input id={id} className="input" type="date" aria-label={`${f.label} from`} value={from} onChange={(e) => onChange(joinRange(e.target.value, to))} />
            <input className="input" type="date" aria-label={`${f.label} to`} value={to} onChange={(e) => onChange(joinRange(from, e.target.value))} />
          </div>
        </FieldWrap>
      );
    }
    default:
      return <TextFilter id={id} label={f.label} value={value} onChange={onChange} />;
  }
}

function TextFilter({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const debounced = useDebounced(draft, 300);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
  }, [debounced]); // react to the debounced value only
  return (
    <FieldWrap label={label} htmlFor={id}>
      <input id={id} className="input" value={draft} autoComplete="off" onChange={(e) => setDraft(e.target.value)} />
    </FieldWrap>
  );
}

function Chip({ field, value, open, onOpen, onChange }: { field: Field; value: string; open: boolean; onOpen: (open: boolean) => void; onChange: (v: string) => void }) {
  return (
    <span className="chip" data-empty={value === "" || undefined}>
      <Popover open={open} onOpenChange={onOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="chip-body">
            <span className="chip-label">{field.label}</span>
            {value !== "" && (
              <span className="chip-value">
                <ChipValue field={field} value={value} />
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="chip-popover">
          <FilterControl field={field} value={value} onChange={onChange} />
        </PopoverContent>
      </Popover>
      <button type="button" className="chip-x" aria-label={`Remove the ${field.label} filter`} onClick={() => onChange("")}>
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

/** The chips, and the button that adds one. */
export function FilterChips({ fields, state, onChange }: { fields: Field[]; state: FilterState; onChange: (name: string, value: string) => void }) {
  const [picking, setPicking] = useState(false);
  // A filter just added shows as an open chip until it has a value, or closes without one.
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const shown = fields.filter((f) => state[f.name] !== undefined || f.name === adding);
  const rest = fields.filter((f) => !shown.includes(f));
  return (
    <>
      {shown.map((f) => (
        <Chip
          key={f.name}
          field={f}
          value={state[f.name] ?? ""}
          open={editing === f.name}
          onOpen={(open) => {
            setEditing(open ? f.name : null);
            if (!open && f.name === adding) setAdding(null);
          }}
          onChange={(v) => {
            onChange(f.name, v);
            if (v === "" && f.name === adding) setAdding(null);
          }}
        />
      ))}
      {rest.length > 0 && (
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <button type="button" className="chip-add">
              <Icon name="plus" size={13} />
              Filter
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="chip-picker">
            <Command>
              {rest.length > 7 && <CommandInput placeholder="Filter by…" />}
              <CommandList>
                <CommandEmpty>No such field</CommandEmpty>
                <CommandGroup>
                  {rest.map((f) => (
                    <CommandItem
                      key={f.name}
                      value={f.label}
                      onSelect={() => {
                        setPicking(false);
                        setAdding(f.name);
                        setEditing(f.name);
                      }}
                    >
                      {f.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
