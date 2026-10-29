// The section inspector: label, columns, collapsible, tab and the `visible_if` condition of the selected
// section, with a hint while the condition is typed and the server's message when a save rejected it.

import { CircleAlert, CircleCheck, Info, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { removeSection, setSectionTab, tabsOf, updateSection, type LayoutProblem, type LayoutSection } from "../../lib/formLayout";
import type { EntityMeta } from "../../lib/meta";
import { TabNameDialog } from "./Canvas";
import { conditionHint, plural, sectionTitle, tabLabel, type Hint, type SaveProblem } from "./logic";

const DETAILS = "\u0000details";
const NEW_TAB = "\u0000new";
const tabValue = (t: string | null) => (t === null ? DETAILS : `tab:${t}`);

const HINT_STYLE: Record<Hint["tone"], { icon: typeof Info; className: string }> = {
  ok: { icon: CircleCheck, className: "text-success" },
  info: { icon: Info, className: "text-muted-foreground" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  error: { icon: CircleAlert, className: "text-destructive" },
};

export function SectionInspector({
  meta,
  layout,
  sectionKey,
  onChange,
  onTab,
  problems,
  saveError,
  framed,
}: {
  meta: EntityMeta;
  layout: LayoutSection[];
  sectionKey: string | null;
  onChange: (next: LayoutSection[], group?: string) => void;
  onTab: (tab: string | null) => void;
  /** Problems the client found in the layout. */
  problems: LayoutProblem[];
  /** The server's reason for rejecting the last save. */
  saveError: SaveProblem | null;
  /** Shown in its own card with a heading (wide screens), not inside a sheet. */
  framed?: boolean;
}) {
  const [newTab, setNewTab] = useState(false);
  const s = layout.find((x) => x.key === sectionKey);
  if (!s) {
    return (
      <div className={cn(framed && "rounded-lg border bg-card p-4", "text-sm text-muted-foreground")}>
        {framed && <h2 className="mb-2 text-sm font-semibold text-foreground">Section settings</h2>}
        Select a section to change its label, columns, tab and condition.
      </div>
    );
  }
  const set = (patch: Parameters<typeof updateSection>[2], group?: string) => onChange(updateSection(layout, s.key, patch), group);
  const moveToTab = (t: string | null) => {
    onChange(setSectionTab(layout, s.key, t));
    onTab(t);
  };
  const tabs = tabsOf(layout).filter((t): t is string => t !== null);
  const hint = conditionHint(s.visible_if ?? "", meta.fields.map((f) => f.name), meta.label);
  const serverError = saveError?.sections.includes(s.key) ? saveError.message : null;
  const mine = problems.filter((p) => p.section === s.key);
  const HintIcon = hint ? HINT_STYLE[hint.tone].icon : null;

  return (
    <div className={cn("flex flex-col gap-5", framed && "rounded-lg border bg-card p-4")}>
      {framed && (
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Section settings</h2>
          <p className="truncate text-sm text-muted-foreground">{sectionTitle(s)}</p>
        </div>
      )}
      {mine.length > 0 && (
        <ul className="list-disc rounded-md border border-destructive bg-destructive-soft px-6 py-2 text-sm text-destructive">
          {mine.map((p, i) => (
            <li key={i}>{p.message}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-2">
        <Label htmlFor="fd-insp-label">Label</Label>
        <Input id="fd-insp-label" value={s.label ?? ""} placeholder="No title" onChange={(e) => set({ label: e.target.value || null }, `label:${s.key}`)} />
      </div>

      <div className="grid gap-2">
        <Label id="fd-insp-cols-label">Columns</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          className="w-full"
          aria-labelledby="fd-insp-cols-label"
          value={String(s.columns)}
          onValueChange={(v) => v && set({ columns: Number(v) })}
        >
          {[1, 2, 3, 4].map((n) => (
            <ToggleGroupItem key={n} value={String(n)} aria-label={plural(n, "column")} className="flex-1 pointer-coarse:h-11">
              {n}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">Phones always show one column.</p>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <Label htmlFor="fd-insp-collapsible">Collapsible</Label>
          <p id="fd-insp-collapsible-hint" className="text-xs text-muted-foreground">
            Starts closed; opens by itself when one of its fields has an error.
          </p>
        </div>
        <Switch
          id="fd-insp-collapsible"
          aria-describedby="fd-insp-collapsible-hint"
          checked={s.collapsible}
          onCheckedChange={(v) => set({ collapsible: v })}
          className="mt-0.5"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="fd-insp-tab">Tab</Label>
        <Select
          value={tabValue(s.tab || null)}
          onValueChange={(v) => (v === NEW_TAB ? setNewTab(true) : moveToTab(v === DETAILS ? null : v.slice(4)))}
        >
          <SelectTrigger id="fd-insp-tab" className="w-full pointer-coarse:h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DETAILS}>{tabLabel(null)}</SelectItem>
            {tabs.map((t) => (
              <SelectItem key={t} value={tabValue(t)}>
                {t}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={NEW_TAB}>New tab…</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Moving a section to another tab puts it at the end of that tab.</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="fd-insp-cond">Show only if</Label>
        <Textarea
          id="fd-insp-cond"
          className="min-h-20 font-mono text-sm"
          value={s.visible_if ?? ""}
          placeholder="doc.status == 'Open'"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          aria-invalid={!!serverError || hint?.tone === "error"}
          aria-describedby="fd-insp-cond-help"
          onChange={(e) => set({ visible_if: e.target.value || null }, `cond:${s.key}`)}
        />
        <div id="fd-insp-cond-help" aria-live="polite" className="text-xs">
          {serverError ? (
            <>
              <p className="font-medium text-destructive">The server rejected this condition:</p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-destructive-soft p-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">
                {serverError}
              </pre>
            </>
          ) : hint && HintIcon ? (
            <p className={cn("flex gap-1.5", HINT_STYLE[hint.tone].className)}>
              <HintIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>{hint.message}</span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              A condition on <code className="font-mono">doc</code> (this record), such as <code className="font-mono">doc.is_return</code>. Empty: always shown.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <span className="text-sm text-muted-foreground">
          {plural(s.fields.length, "field")} in {tabLabel(s.tab || null)}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive pointer-coarse:h-11"
          onClick={() => {
            onChange(removeSection(layout, s.key));
            document.getElementById("fd-add-section")?.focus();
          }}
        >
          <Trash2 aria-hidden="true" /> Delete section
        </Button>
      </div>

      {newTab && (
        <TabNameDialog
          layout={layout}
          state={{ title: "Move to a new tab", action: "Move", initial: "", returnTo: "fd-insp-tab", onSubmit: (name) => moveToTab(name) }}
          onClose={() => setNewTab(false)}
        />
      )}
    </div>
  );
}
