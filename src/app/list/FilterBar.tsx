// The list's filters as chips: nothing takes room until it is used, and each chip says what it
// narrows the list to. Clicking one edits that filter in a popover; "Filter" adds another. The
// state stays where it was (`f.<field>` in the URL, lib/filters), so links keep working.

import { useEffect, useState, type ReactNode } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EMPTY, isWord, joinNumber, joinRange, PERIODS, SET, splitNumber, splitRange, type FilterState } from "../../lib/filters";
import { t } from "../../lib/i18n";
import type { Field } from "../../lib/meta";
import { Field as FieldWrap, Icon, useDebounced } from "../../ui/kit";
import { LinkInput, useLinkTitle } from "../widgets";
import { t as tr, isolate } from "@ferrum/client";

const NUMBERS = new Set(["int", "decimal", "currency", "percent"]);
const NUMBER_WORDS: Record<string, string> = { ">=": "at least", "<=": "at most", ">": "over", "<": "under" };

/** The filters a chip shows in its text, from `f.<field>`. */
export function chipText(f: Field, value: string): string {
  if (value === EMPTY) return "is empty";
  if (value === SET) return "has a value";
  if (f.type === "check") return value === "1" ? "Yes" : "No";
  if (f.type === "date" || f.type === "datetime") {
    const word = PERIODS.find(([k]) => k === value);
    if (word) return word[1];
    const [from, to] = splitRange(value);
    return from && to ? (from === to ? from : `${from} – ${to}`) : from ? `from ${from}` : to ? `until ${to}` : "";
  }
  if (NUMBERS.has(f.type)) {
    const { op, a, b } = splitNumber(value);
    if (op === "..") return a && b ? `${a} – ${b}` : a ? `at least ${a}` : b ? `at most ${b}` : "";
    return op === "=" ? a : `${NUMBER_WORDS[op]} ${a}`;
  }
  return value;
}

function LinkText({ to, id }: { to: string; id: string }) {
  return <>{useLinkTitle(to, id) ?? "…"}</>;
}

/** The value in a chip; a link shows the linked record's title. */
function ChipValue({ field: f, value }: { field: Field; value: string }): ReactNode {
  return f.type === "link" && !isWord(value) ? <LinkText to={f.to ?? ""} id={value} /> : chipText(f, value);
}

export function FilterControl({ field: f, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const id = `flt-${f.name}`;
  switch (f.type) {
    case "select":
      return (
        <FieldWrap label={f.label} htmlFor={id}>
          <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{tr("All")}</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {isolate(o)}
              </option>
            ))}
          </select>
        </FieldWrap>
      );
    case "check":
      return (
        <FieldWrap label={f.label} htmlFor={id}>
          <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{tr("All")}</option>
            <option value="1">{tr("Yes")}</option>
            <option value="0">{tr("No")}</option>
          </select>
        </FieldWrap>
      );
    case "link":
      return (
        <FieldWrap label={f.label} htmlFor={id}>
          <LinkInput to={f.to ?? ""} id={id} value={isWord(value) ? null : value || null} linkFilters={f.link_filters} placeholder={tr("Any")} onChange={(v) => onChange(v ?? "")} />
        </FieldWrap>
      );
    case "date":
    case "datetime": {
      const [from, to] = isWord(value) ? ["", ""] : splitRange(value);
      return (
        <FieldWrap label={f.label} htmlFor={id}>
          <div className="range">
            <input id={id} className="input" type="date" aria-label={tr("{label} from", { label: f.label })} value={from} onChange={(e) => onChange(joinRange(e.target.value, to))} />
            <input className="input" type="date" aria-label={tr("{label} to", { label: f.label })} value={to} onChange={(e) => onChange(joinRange(from, e.target.value))} />
          </div>
          <div className="filter-words" role="group" aria-label={tr("Periods")}>
            {PERIODS.map(([word, label]) => (
              <button key={word} type="button" className="filter-word" aria-pressed={value === word} onClick={() => onChange(word)}>
                {isolate(label)}
              </button>
            ))}
          </div>
        </FieldWrap>
      );
    }
    case "int":
    case "decimal":
    case "currency":
    case "percent":
      return <NumberFilter id={id} label={f.label} value={isWord(value) ? "" : value} onChange={onChange} />;
    default:
      return <TextFilter id={id} label={f.label} value={isWord(value) ? "" : value} onChange={onChange} />;
  }
}

/** Whether the field holds anything: a filter every field can take, under its own control. */
function Presence({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="filter-words" role="group" aria-label={tr("Whether it has a value")}>
      {[
        [EMPTY, "Is empty"],
        [SET, "Has a value"],
      ].map(([word, label]) => (
        <button key={word} type="button" className="filter-word" aria-pressed={value === word} onClick={() => onChange(value === word ? "" : word)}>
          {isolate(label)}
        </button>
      ))}
    </div>
  );
}

function NumberFilter({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const parsed = splitNumber(value);
  const [op, setOp] = useState(parsed.op);
  const [a, setA] = useState(parsed.a);
  const [b, setB] = useState(parsed.b);
  const [da, db] = [useDebounced(a, 300), useDebounced(b, 300)];
  useEffect(() => {
    const next = joinNumber(op, da, db);
    if (next !== value) onChange(next);
  }, [op, da, db]); // react to what was typed, not to the value it becomes
  return (
    <FieldWrap label={label} htmlFor={id}>
      <div className="range">
        <select className="select" aria-label={tr("How to compare {label}", { label })} value={op} onChange={(e) => setOp(e.target.value)}>
          <option value="=">{tr("Is")}</option>
          <option value=">=">{tr("At least")}</option>
          <option value="<=">{tr("At most")}</option>
          <option value=">">{tr("Over")}</option>
          <option value="<">{tr("Under")}</option>
          <option value="..">{tr("Between")}</option>
        </select>
        <input id={id} className="input" inputMode="decimal" autoComplete="off" aria-label={op === ".." ? tr("{label} from", { label }) : label} value={a} onChange={(e) => setA(e.target.value)} />
        {op === ".." && <input className="input" inputMode="decimal" autoComplete="off" aria-label={tr("{label} to", { label })} value={b} onChange={(e) => setB(e.target.value)} />}
      </div>
    </FieldWrap>
  );
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
            <span className="chip-label">{isolate(field.label)}</span>
            {value !== "" && (
              <span className="chip-value">
                <ChipValue field={field} value={value} />
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="chip-popover">
          <FilterControl field={field} value={value} onChange={onChange} />
          {field.type !== "check" && <Presence value={value} onChange={onChange} />}
        </PopoverContent>
      </Popover>
      <button type="button" className="chip-x" aria-label={tr("Remove the {label} filter", { label: field.label })} onClick={() => onChange("")}>
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
              {t("Filter")}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="chip-picker">
            <Command>
              {rest.length > 7 && <CommandInput placeholder={tr("Filter by…")} />}
              <CommandList>
                <CommandEmpty>{tr("No such field")}</CommandEmpty>
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
                      {isolate(f.label)}
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
