// A column's label and formatting: number style (or a data bar), decimals, prefix and suffix, and
// conditional colors (the first matching rule wins). The data stays exact; only the display changes.

import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCell, isNumericColumn, type CellOptions, type ColumnFormat, type ColumnSetting, type FormatRule, type FormatStyle, type ResultColumn } from "@/lib/studio";
import { RULE_OPS } from "./state";

const STYLE_LABEL: Record<FormatStyle | "auto", string> = { auto: "Automatic", number: "Number", int: "Whole number", currency: "Currency", percent: "Percent", bar: "Data bar" };
const OP_LABEL: Record<FormatRule["op"], string> = { "=": "equals", "!=": "is not", ">": "greater than", ">=": "at least", "<": "less than", "<=": "at most", between: "between" };
const PALETTE = ["#16a34a", "#dc2626", "#d97706", "#2563eb", "#7c3aed", "#0891b2"];

interface ColumnDialogProps {
  /** The column being formatted (render the dialog keyed by its name). Pivot cells are formatted through their measure. */
  column: ResultColumn;
  setting?: ColumnSetting;
  /** The label the column has without a custom one. */
  defaultLabel: string;
  /** A value to preview the format with. */
  sample?: unknown;
  options: CellOptions;
  onClose: () => void;
  onApply: (patch: Partial<ColumnSetting>) => void;
}

export function ColumnDialog({ column, setting, defaultLabel, sample, options, onClose, onApply }: ColumnDialogProps) {
  const id = useId();
  const [label, setLabel] = useState(setting?.label ?? "");
  const [format, setFormat] = useState<ColumnFormat>(setting?.format ?? {});
  const numeric = isNumericColumn(column) || column.role === "pivot";
  const rules = format.rules ?? [];
  const setRules = (next: FormatRule[]) => setFormat((f) => ({ ...f, rules: next }));
  const preview = sample === undefined || sample === null || sample === "" ? "" : formatCell({ ...column, format }, sample, undefined, options);
  const apply = () => {
    const clean: ColumnFormat = {
      ...(format.style ? { style: format.style } : {}),
      ...(format.precision !== undefined && format.precision !== null ? { precision: format.precision } : {}),
      ...(format.prefix?.trim() ? { prefix: format.prefix } : {}),
      ...(format.suffix?.trim() ? { suffix: format.suffix } : {}),
      ...(rules.length ? { rules: rules.filter((r) => (r.op === "between" ? Array.isArray(r.value) && r.value.every((v) => String(v).trim()) : String(r.value ?? "").trim())) } : {}),
    };
    onApply({ label: label.trim() || undefined, format: Object.keys(clean).length ? clean : undefined });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Format “{column.label}”</DialogTitle>
          <DialogDescription>{column.role === "pivot" ? "Applies to every column of this measure, and to its total." : "Changes how the column reads; the data stays exact."}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          {column.role !== "pivot" && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-label`}>Label</Label>
              <Input id={`${id}-label`} value={label} placeholder={defaultLabel} maxLength={140} onChange={(e) => setLabel(e.target.value)} />
            </div>
          )}
          {numeric && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-style`}>Show as</Label>
                <Select value={format.style ?? "auto"} onValueChange={(v) => setFormat((f) => ({ ...f, style: v === "auto" ? undefined : (v as FormatStyle) }))}>
                  <SelectTrigger id={`${id}-style`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STYLE_LABEL) as (FormatStyle | "auto")[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STYLE_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-precision`}>Decimal places</Label>
                <Select value={format.precision === undefined || format.precision === null ? "auto" : String(format.precision)} onValueChange={(v) => setFormat((f) => ({ ...f, precision: v === "auto" ? undefined : Number(v) }))}>
                  <SelectTrigger id={`${id}-precision`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatic</SelectItem>
                    {Array.from({ length: 10 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {i}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-prefix`}>Prefix</Label>
              <Input id={`${id}-prefix`} value={format.prefix ?? ""} maxLength={20} placeholder="e.g. ₹" onChange={(e) => setFormat((f) => ({ ...f, prefix: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-suffix`}>Suffix</Label>
              <Input id={`${id}-suffix`} value={format.suffix ?? ""} maxLength={20} placeholder="e.g. units" onChange={(e) => setFormat((f) => ({ ...f, suffix: e.target.value }))} />
            </div>
          </div>
          {preview && (
            <p className="text-sm text-muted-foreground">
              Preview: <span className="font-medium text-foreground tabular-nums">{preview}</span>
            </p>
          )}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Color values</legend>
            {rules.length > 0 && <p className="-mt-1 text-xs text-muted-foreground">The first rule a value meets decides its color.</p>}
            {rules.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <Select value={r.op} onValueChange={(op) => setRules(rules.map((x, j) => (j === i ? { ...x, op: op as FormatRule["op"], value: op === "between" ? (Array.isArray(x.value) ? x.value : [x.value ?? "", ""]) : Array.isArray(x.value) ? x.value[0] : x.value } : x)))}>
                  <SelectTrigger className="w-32" aria-label={`Rule ${i + 1}: condition`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_OPS.map((op) => (
                      <SelectItem key={op} value={op}>
                        {OP_LABEL[op]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {r.op === "between" && Array.isArray(r.value) ? (
                  <>
                    <Input className="w-24" aria-label={`Rule ${i + 1}: from`} value={String(r.value[0] ?? "")} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, value: [e.target.value, (x.value as unknown[])[1]] } : x)))} />
                    <span className="text-sm text-muted-foreground">and</span>
                    <Input className="w-24" aria-label={`Rule ${i + 1}: to`} value={String(r.value[1] ?? "")} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, value: [(x.value as unknown[])[0], e.target.value] } : x)))} />
                  </>
                ) : (
                  <Input className="w-28 min-w-0 flex-1" aria-label={`Rule ${i + 1}: value`} value={String(r.value ?? "")} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                )}
                <input
                  type="color"
                  aria-label={`Rule ${i + 1}: color`}
                  className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
                  value={/^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#16a34a"}
                  onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, color: e.target.value.toLowerCase() } : x)))}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove rule ${i + 1}`} onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="ghost" size="sm" className="text-primary" disabled={rules.length >= 10} onClick={() => setRules([...rules, { op: numeric ? "<" : "=", value: numeric ? "0" : "", color: PALETTE[rules.length % PALETTE.length] }])}>
                <Plus /> Add a color rule
              </Button>
            </div>
          </fieldset>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onApply({ label: undefined, format: undefined });
                onClose();
              }}
            >
              Reset
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">Apply</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
