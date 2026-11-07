// A dashboard's settings while editing: title and description, its filters (company, period and
// any other field, each with a default), how often it refreshes, and who may open it.

import { useId } from "react";
import { ArrowDown, ArrowUp, Building2, CalendarRange, Plus, Trash2 } from "lucide-react";
import { issuesAt, type DashboardRecord, type FilterDef, type FilterType, type Issue } from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterInput } from "./FilterBar";
import { filterName, FILTER_TYPE_LABEL } from "./filters";
import { EntityPicker } from "./pickers";
import { Messages, Section } from "./ui";
import { LabelFields, ListInput, SharingFields } from "./RecordFields";
import { t as tr, isolate } from "@ferrum/client";

export type DashboardDraft = Pick<DashboardRecord, "label" | "description" | "sharing" | "roles" | "module" | "refresh_interval"> & { filters: FilterDef[] };

const REFRESH: { value: number; label: string }[] = [
  { value: 0, get label() { return tr("Off"); } },
  { value: 30, get label() { return tr("Every 30 seconds"); } },
  { value: 60, get label() { return tr("Every minute"); } },
  { value: 300, get label() { return tr("Every 5 minutes"); } },
  { value: 900, get label() { return tr("Every 15 minutes"); } },
  { value: 1800, get label() { return tr("Every 30 minutes"); } },
  { value: 3600, get label() { return tr("Every hour"); } },
  { value: 21600, get label() { return tr("Every 6 hours"); } },
  { value: 86400, get label() { return tr("Once a day"); } },
];
const TYPES: FilterType[] = ["link", "date_range", "select", "data", "check", "date"];

/** How often, in words. */
export const refreshLabel = (s: number | null | undefined) => REFRESH.find((r) => r.value === (s ?? 0))?.label ?? `Every ${s} seconds`;

function FilterRow({ def, index, count, taken, issues, onChange, onMove, onRemove }: { def: FilterDef; index: number; count: number; taken: string[]; issues: Issue[]; onChange: (d: FilterDef, key?: string) => void; onMove: (by: number) => void; onRemove: () => void }) {
  const id = useId();
  const at = (p: string) => issuesAt(issues, `filters[${index}]${p}`);
  const label = def.label || def.name || `Filter ${index + 1}`;
  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <legend className="sr-only">{isolate(label)}</legend>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{isolate(label)}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Move {label} up", { label })} disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Move {label} down", { label })} disabled={index === count - 1} onClick={() => onMove(1)}>
          <ArrowDown />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Remove {label}", { label })} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-label`} className="text-xs font-normal text-muted-foreground">
            {tr("Label")}
          </Label>
          <Input
            id={`${id}-label`}
            value={def.label ?? ""}
            className="h-9"
            onChange={(e) => {
              const auto = !def.name || def.name === filterName(def.label ?? "", taken);
              onChange({ ...def, label: e.target.value, ...(auto ? { name: filterName(e.target.value, taken) } : {}) }, `filter-label-${index}`);
            }}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-name`} className="text-xs font-normal text-muted-foreground">
            {tr("Name (in addresses and widget settings)")}
          </Label>
          <Input id={`${id}-name`} value={def.name} className="h-9 font-mono text-xs" aria-invalid={at(".name").length > 0 || undefined} onChange={(e) => onChange({ ...def, name: e.target.value.toLowerCase() }, `filter-name-${index}`)} />
          <Messages list={at(".name")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-type`} className="text-xs font-normal text-muted-foreground">
            {tr("Kind")}
          </Label>
          <Select value={def.type} onValueChange={(t) => onChange({ name: def.name, label: def.label, type: t as FilterType, field: def.field })}>
            <SelectTrigger id={`${id}-type`} className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {isolate(FILTER_TYPE_LABEL[t])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {def.type === "link" && (
          <div className="grid gap-1">
            <Label className="text-xs font-normal text-muted-foreground">{tr("Records of")}</Label>
            <EntityPicker value={def.to ?? null} label={tr("Records of")} invalid={at(".to").length > 0} onChange={(to) => onChange({ ...def, to, default: undefined })} />
            <Messages list={at(".to")} />
          </div>
        )}
        {def.type === "select" && (
          <div className="grid gap-1">
            <Label htmlFor={`${id}-options`} className="text-xs font-normal text-muted-foreground">
              {tr("Choices (separated by commas)")}
            </Label>
            <ListInput id={`${id}-options`} className="h-9" value={def.options ?? []} aria-invalid={at(".options").length > 0 || undefined} onChange={(options) => onChange({ ...def, options })} />
            <Messages list={at(".options")} />
          </div>
        )}
        <div className="grid gap-1">
          <Label htmlFor={`${id}-field`} className="text-xs font-normal text-muted-foreground">
            {def.type === "date_range" ? tr("Date field (optional)") : tr("Field it filters (optional)")}
          </Label>
          <Input
            id={`${id}-field`}
            className="h-9 font-mono text-xs"
            placeholder={def.type === "date_range" ? tr("Each widget's own date") : def.name || tr("Same as the name")}
            value={def.field ?? ""}
            onChange={(e) => onChange({ ...def, field: e.target.value }, `filter-field-${index}`)}
          />
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor={`${id}-default`} className="text-xs font-normal text-muted-foreground">
            {tr("Default")}
          </Label>
          {def.type !== "link" || def.to ? <FilterInput id={`${id}-default`} def={def} value={def.default} onChange={(v) => onChange({ ...def, default: v === "" ? undefined : v })} /> : <p className="text-xs text-muted-foreground">{tr("Choose the records first.")}</p>}
        </div>
      </div>
      <Messages list={issuesAt(issues, `filters[${index}]`).filter((m) => ![...at(".name"), ...at(".to"), ...at(".options")].includes(m))} />
    </fieldset>
  );
}

export function DashboardSettings({ open, onClose, value, onChange, issues }: { open: boolean; onClose: () => void; value: DashboardDraft; onChange: (patch: Partial<DashboardDraft>, key?: string) => void; issues: Issue[] }) {
  const filters = value.filters;
  const names = filters.map((f) => f.name);
  const setFilter = (i: number, d: FilterDef, key?: string) => onChange({ filters: filters.map((f, n) => (n === i ? d : f)) }, key);
  const add = (d: Omit<FilterDef, "name"> & { name?: string }) => onChange({ filters: [...filters, { ...d, name: d.name && !names.includes(d.name) ? d.name : filterName(d.label ?? "filter", names) }] });
  const move = (i: number, by: number) => {
    const next = [...filters];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f);
    onChange({ filters: next });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[min(90vh,56rem)] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-4 pe-12">
          <DialogTitle>{tr("Dashboard settings")}</DialogTitle>
          <DialogDescription>{tr("Changes apply to the dashboard you are editing; save it to keep them.")}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-6 overflow-auto p-4">
          <LabelFields value={value} onChange={(p, key) => onChange(p, key)} issues={issues} />
          <Section title={tr("Filters")} hint={tr("Shown above the widgets and applied to each one that accepts them (set that up in a chart's or card's settings).")}>
            {filters.map((f, i) => (
              <FilterRow
                key={i}
                def={f}
                index={i}
                count={filters.length}
                taken={names.filter((_, n) => n !== i)}
                issues={issues}
                onChange={(d, key) => setFilter(i, d, key)}
                onMove={(by) => move(i, by)}
                onRemove={() => onChange({ filters: filters.filter((_, n) => n !== i) })}
              />
            ))}
            <div className="flex flex-wrap gap-2">
              {!names.includes("company") && (
                <Button type="button" variant="outline" size="sm" onClick={() => add({ name: "company", label: tr("Company"), type: "link", to: "Company" })}>
                  <Building2 /> {tr("Company")}
                </Button>
              )}
              {!filters.some((f) => f.type === "date_range") && (
                <Button type="button" variant="outline" size="sm" onClick={() => add({ name: "period", label: tr("Period"), type: "date_range", default: { from: "start_of_month", to: "today" } })}>
                  <CalendarRange /> {tr("Period")}
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" disabled={filters.length >= 20} onClick={() => add({ label: tr("Status"), type: "select", options: [] })}>
                <Plus /> {tr("Another filter")}
              </Button>
            </div>
            <Messages list={issues.filter((i) => i.path.startsWith("filters") && !/^filters\[\d+\]/.test(i.path)).map((i) => (i.path.startsWith("filters.") ? `${i.path.slice(8)}: ${i.message}` : i.message))} />
          </Section>
          <Section title={tr("Refresh")} hint={tr("While the dashboard is open and visible.")}>
            <Select value={String(value.refresh_interval ?? 0)} onValueChange={(v) => onChange({ refresh_interval: Number(v) })}>
              <SelectTrigger className="h-9 w-full sm:w-64" aria-label={tr("Refresh")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!REFRESH.some((r) => r.value === (value.refresh_interval ?? 0)) && <SelectItem value={String(value.refresh_interval)}>{isolate(refreshLabel(value.refresh_interval))}</SelectItem>}
                {REFRESH.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)}>
                    {isolate(r.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Messages list={issuesAt(issues, "refresh_interval")} />
          </Section>
          <SharingFields value={value} onChange={(p, key) => onChange(p, key)} issues={issues} />
        </div>
        <DialogFooter className="border-t p-4">
          <Button type="button" onClick={onClose}>
            {tr("Done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
