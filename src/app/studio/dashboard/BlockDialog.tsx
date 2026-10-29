// Editing the widgets that live on the dashboard itself (headings, notes, shortcuts, record
// lists), and picking a saved chart or number card to place.

import { useEffect, useId, useMemo, useState } from "react";
import { Hash, Plus } from "lucide-react";
import { fieldLabel, useEntityMeta, useEntityPlural } from "@/lib/meta";
import { filterList, isSafeColor, useStudioFields, useStudioList, type DashboardBlock, type HeadingBlock, type ListBlock, type MarkdownBlock, type ShortcutBlock } from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CHART_TYPE_LABEL } from "./charts";
import { FilterEditor } from "./FilterEditor";
import { CHART_ICON } from "./icons";
import { EntityPicker, SearchSelect } from "./pickers";
import { Messages } from "./ui";
import { Markdown } from "./Widget";

export type OwnBlock = HeadingBlock | MarkdownBlock | ShortcutBlock | ListBlock;
export const OWN_TITLE: Record<OwnBlock["type"], string> = { heading: "Heading", markdown: "Text", shortcut: "Shortcut", list: "Record list" };

export const blankBlock = (type: OwnBlock["type"]): OwnBlock =>
  type === "heading" ? { type, text: "", level: 2 } : type === "markdown" ? { type, content: "" } : type === "shortcut" ? { type, label: "", entity: "", show_count: true } : { type, entity: "", limit: 5 };

type Target = "entity" | "dashboard" | "report" | "url";
const targetOf = (b: ShortcutBlock): Target => (b.dashboard != null ? "dashboard" : b.report != null ? "report" : b.url != null ? "url" : "entity");

/** What would stop the server from accepting the block (checked before closing the dialog). */
function blockIssues(b: OwnBlock): string[] {
  switch (b.type) {
    case "heading":
      return b.text.trim() ? [] : ["Write the heading"];
    case "markdown":
      return b.content.trim() ? [] : ["Write the text"];
    case "shortcut": {
      const out = b.label.trim() ? [] : ["Give the shortcut a label"];
      const t = targetOf(b);
      if (t === "entity" && !b.entity) out.push("Choose the records it opens");
      if (t === "dashboard" && !b.dashboard) out.push("Choose the dashboard it opens");
      if (t === "report" && !b.report) out.push("Choose the report it opens");
      if (t === "url" && !/^(\/(?!\/)|https?:\/\/)\S+$/.test(b.url ?? "")) out.push("Enter an app path (/app/…) or an http(s) address");
      if (b.color && !isSafeColor(b.color)) out.push("Choose a valid colour");
      return out;
    }
    case "list":
      return b.entity ? [] : ["Choose the records to list"];
  }
}

/** The block as the server stores it: blank optional parts left out. */
function cleanBlock(b: OwnBlock): OwnBlock {
  if (b.type === "shortcut") {
    const t = targetOf(b);
    const filters = filterList(b.filters).filter(([p]) => p);
    return {
      type: "shortcut",
      label: b.label.trim(),
      ...(t === "entity" ? { entity: b.entity, ...(filters.length ? { filters } : {}), show_count: !!b.show_count } : {}),
      ...(t === "dashboard" ? { dashboard: b.dashboard } : {}),
      ...(t === "report" ? { report: b.report } : {}),
      ...(t === "url" ? { url: b.url?.trim() } : {}),
      ...(b.color ? { color: b.color } : {}),
    };
  }
  if (b.type === "list") {
    const filters = filterList(b.filters).filter(([p]) => p);
    return { type: "list", entity: b.entity, ...(b.label?.trim() ? { label: b.label.trim() } : {}), ...(filters.length ? { filters } : {}), ...(b.fields?.length ? { fields: b.fields.slice(0, 12) } : {}), ...(b.sort ? { sort: b.sort } : {}), limit: b.limit ?? 5 };
  }
  if (b.type === "heading") return { type: "heading", text: b.text.trim(), level: b.level ?? 2 };
  return { type: "markdown", content: b.content };
}

export function BlockDialog({ block, onSave, onClose }: { block: OwnBlock | null; onSave: (b: DashboardBlock) => void; onClose: () => void }) {
  return (
    <Dialog open={!!block} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[min(90vh,52rem)] flex-col gap-0 p-0 sm:max-w-xl">{block && <BlockForm initial={block} onSave={onSave} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function BlockForm({ initial, onSave, onClose }: { initial: OwnBlock; onSave: (b: DashboardBlock) => void; onClose: () => void }) {
  const [b, setB] = useState<OwnBlock>(initial);
  const [tried, setTried] = useState(false);
  const id = useId();
  const issues = blockIssues(b);
  const submit = () => {
    setTried(true);
    if (!issues.length) onSave(cleanBlock(b));
  };
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader className="border-b p-4 pr-12">
        <DialogTitle>{OWN_TITLE[b.type]}</DialogTitle>
        <DialogDescription className="sr-only">Settings of the widget</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4">
        {b.type === "heading" && (
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-text`}>Text</Label>
              <Input id={`${id}-text`} value={b.text} maxLength={200} autoFocus onChange={(e) => setB({ ...b, text: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-level`}>Size</Label>
              <Select value={String(b.level ?? 2)} onValueChange={(v) => setB({ ...b, level: Number(v) as 1 | 2 | 3 })}>
                <SelectTrigger id={`${id}-level`} className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Large</SelectItem>
                  <SelectItem value="2">Medium</SelectItem>
                  <SelectItem value="3">Small</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {b.type === "markdown" && (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-md`}>Text</Label>
              <Textarea id={`${id}-md`} rows={8} value={b.content} maxLength={20000} autoFocus onChange={(e) => setB({ ...b, content: e.target.value })} className="font-mono text-sm" />
              <p className="text-xs text-muted-foreground">
                Markdown: <code># Heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>- list</code>, <code>[link](/app/e/Lead)</code>.
              </p>
            </div>
            {b.content.trim() && (
              <div className="rounded-lg border p-3">
                <p className="mb-1 text-xs text-muted-foreground">Preview</p>
                <Markdown source={b.content} />
              </div>
            )}
          </div>
        )}
        {b.type === "shortcut" && <ShortcutForm b={b} onChange={setB} id={id} />}
        {b.type === "list" && <ListForm b={b} onChange={setB} id={id} />}
        {tried && <Messages list={issues} />}
      </div>
      <DialogFooter className="border-t p-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Apply</Button>
      </DialogFooter>
    </form>
  );
}

function ShortcutForm({ b, onChange, id }: { b: ShortcutBlock; onChange: (b: ShortcutBlock) => void; id: string }) {
  const target = targetOf(b);
  const dashboards = useStudioList("dashboards");
  const reports = useStudioList("reports");
  const plural = useEntityPlural();
  const catalog = useStudioFields(target === "entity" && b.entity ? b.entity : undefined);
  const setTarget = (t: Target) => onChange({ type: "shortcut", label: b.label, color: b.color, ...(t === "entity" ? { entity: "", show_count: true } : t === "url" ? { url: "" } : t === "dashboard" ? { dashboard: "" } : { report: "" }) });
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-label`}>Label</Label>
        <Input id={`${id}-label`} value={b.label} maxLength={140} autoFocus onChange={(e) => onChange({ ...b, label: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-target`}>Opens</Label>
        <Select value={target} onValueChange={(t) => setTarget(t as Target)}>
          <SelectTrigger id={`${id}-target`} className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="entity">A list of records</SelectItem>
            <SelectItem value="dashboard">A dashboard</SelectItem>
            <SelectItem value="report">A saved report</SelectItem>
            <SelectItem value="url">An address</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {target === "entity" && (
        <>
          <EntityPicker value={b.entity || null} label="Records" onChange={(entity) => onChange({ ...b, entity, filters: null })} />
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox checked={!!b.show_count} onCheckedChange={(c) => onChange({ ...b, show_count: c === true })} />
            Show how many there are
          </Label>
          {b.entity && (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Only records where</span>
              <FilterEditor catalog={catalog.data} filters={filterList(b.filters)} onChange={(f) => onChange({ ...b, filters: f })} />
            </div>
          )}
        </>
      )}
      {target === "dashboard" && (
        <SearchSelect value={b.dashboard} label="Dashboard" loading={dashboards.isLoading} options={(dashboards.data ?? []).map((d) => ({ value: d.id, label: d.label }))} onChange={(dashboard) => onChange({ ...b, dashboard })} placeholder="Choose a dashboard…" />
      )}
      {target === "report" && (
        <SearchSelect value={b.report} label="Report" loading={reports.isLoading} options={(reports.data ?? []).map((r) => ({ value: r.id, label: r.label, group: r.base_entity ? plural(r.base_entity) : undefined }))} onChange={(report) => onChange({ ...b, report })} placeholder="Choose a report…" />
      )}
      {target === "url" && <Input aria-label="Address" placeholder="/app/e/Lead or https://…" value={b.url ?? ""} onChange={(e) => onChange({ ...b, url: e.target.value })} />}
      <Label className="flex w-fit items-center gap-2 font-normal">
        <input type="color" aria-label="Colour" value={b.color && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#2f5bea"} onChange={(e) => onChange({ ...b, color: e.target.value.toLowerCase() })} className="size-8 cursor-pointer rounded border-0 bg-transparent p-0" />
        {b.color ? "Colour" : "Colour (the theme's)"}
        {b.color && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...b, color: null })}>
            Reset
          </Button>
        )}
      </Label>
    </div>
  );
}

function ListForm({ b, onChange, id }: { b: ListBlock; onChange: (b: ListBlock) => void; id: string }) {
  const meta = useEntityMeta(b.entity || undefined);
  const catalog = useStudioFields(b.entity || undefined);
  const m = meta.data;
  const fields = useMemo(() => (m ? m.fields.filter((f) => f.can_read && !f.hidden && f.type !== "table" && f.type !== "secret") : []), [m]);
  const chosen = b.fields ?? [];
  const [sortField, sortDir = "desc"] = (b.sort ?? "").split(/\s+/);
  useEffect(() => {
    if (b.fields && m) {
      const known = new Set(fields.map((f) => f.name));
      if (b.fields.some((f) => !known.has(f) && !["number", "created_at", "updated_at", "docstatus"].includes(f))) onChange({ ...b, fields: b.fields.filter((f) => known.has(f)) });
    }
  }, [m]); // drop fields the entity no longer has once its metadata arrives
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-label`}>Title</Label>
        <Input id={`${id}-label`} value={b.label ?? ""} maxLength={140} placeholder={m ? `Latest ${m.label_plural.toLowerCase()}` : "Latest records"} onChange={(e) => onChange({ ...b, label: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label>Records</Label>
        <EntityPicker value={b.entity || null} label="Records" onChange={(entity) => onChange({ ...b, entity, fields: [], filters: null, sort: null })} />
      </div>
      {m && (
        <>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">Columns (up to 12; none: the list's own)</legend>
            <div className="grid max-h-48 gap-1 overflow-auto rounded-md border p-2 sm:grid-cols-2">
              {fields.map((f) => (
                <Label key={f.name} className="flex items-center gap-2 text-sm font-normal">
                  <Checkbox
                    checked={chosen.includes(f.name)}
                    disabled={!chosen.includes(f.name) && chosen.length >= 12}
                    onCheckedChange={(c) => onChange({ ...b, fields: c === true ? [...chosen, f.name] : chosen.filter((x) => x !== f.name) })}
                  />
                  <span className="truncate">{f.label}</span>
                </Label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-[1fr_9rem_6rem]">
            <div className="grid gap-1">
              <Label className="text-xs font-normal text-muted-foreground">Order by</Label>
              <Select value={sortField || "created_at"} onValueChange={(f) => onChange({ ...b, sort: `${f} ${sortDir}` })}>
                <SelectTrigger className="h-9 w-full" aria-label="Order by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created_at">Created</SelectItem>
                  <SelectItem value="updated_at">Last updated</SelectItem>
                  {fields.map((f) => (
                    <SelectItem key={f.name} value={f.name}>
                      {fieldLabel(m, f.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-normal text-muted-foreground">Direction</Label>
              <Select value={sortDir} onValueChange={(d) => onChange({ ...b, sort: `${sortField || "created_at"} ${d}` })}>
                <SelectTrigger className="h-9 w-full" aria-label="Direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Newest or largest first</SelectItem>
                  <SelectItem value="asc">Oldest or smallest first</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${id}-limit`} className="text-xs font-normal text-muted-foreground">
                How many
              </Label>
              <Input id={`${id}-limit`} type="number" min={1} max={50} className="h-9" value={b.limit ?? 5} onChange={(e) => onChange({ ...b, limit: Math.min(Math.max(Math.trunc(Number(e.target.value)) || 1, 1), 50) })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Only records where</span>
            <FilterEditor catalog={catalog.data} filters={filterList(b.filters)} onChange={(f) => onChange({ ...b, filters: f })} />
          </div>
        </>
      )}
    </div>
  );
}

/** A saved chart or number card to place, or a new one. */
export function WidgetPicker({ kind, onPick, onNew, onClose }: { kind: "charts" | "cards" | null; onPick: (id: string) => void; onNew: () => void; onClose: () => void }) {
  const list = useStudioList(kind ?? "charts");
  const noun = kind === "cards" ? "number card" : "chart";
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>Add a {noun}</DialogTitle>
          <DialogDescription>Choose a saved {noun}, or create one.</DialogDescription>
        </DialogHeader>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-input-wrapper]]:h-12">
          <CommandInput placeholder={`Search ${noun}s…`} />
          <CommandList className="max-h-[min(60vh,26rem)]">
            <CommandGroup>
              <CommandItem value="__new" onSelect={onNew}>
                <Plus /> Create a new {noun}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            {list.isLoading ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
            ) : list.error ? (
              <p className="p-4 text-center text-sm text-destructive">Could not load the {noun}s.</p>
            ) : (
              <>
                <CommandEmpty>No {noun}s match.</CommandEmpty>
                <CommandGroup heading={`Saved ${noun}s`}>
                  {(list.data ?? []).map((r) => {
                    const type = "chart_type" in r ? r.chart_type : undefined;
                    const Icon = type ? CHART_ICON[type] : Hash;
                    return (
                      <CommandItem key={r.id} value={r.id} keywords={[r.label, r.description ?? "", r.base_entity ?? ""]} onSelect={() => onPick(r.id)}>
                        <Icon />
                        <span className="min-w-0 flex-1 truncate">{r.label}</span>
                        <span className="text-xs text-muted-foreground">{type ? CHART_TYPE_LABEL[type] : (r.base_entity ?? "")}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
