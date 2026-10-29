// A period: a preset that stays current (relative expressions such as `start_of_month..today`),
// or custom dates. Saved expressions that are not presets stay editable as text.

import { useId, useState } from "react";
import { useMe } from "@/lib/meta";
import { cn } from "@/lib/utils";
import { DATE_PRESETS, presetOf, resolveDate } from "@/lib/studio";
import { formatDate } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Range } from "./filters";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ALL = "__all";
const CUSTOM = "__custom";

export function DateRangeInput({
  id,
  value,
  onChange,
  label,
  allowEmpty = true,
  emptyLabel = "All time",
  invalid,
  className,
}: {
  id?: string;
  value: Range | null | undefined;
  onChange: (r: Range | null) => void;
  /** Accessible name when no visible label points at `id`. */
  label?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  invalid?: boolean;
  className?: string;
}) {
  const own = useId();
  const fy = useMe().data?.fiscal_year_start_month;
  const from = value?.from ?? "";
  const to = value?.to ?? "";
  const preset = presetOf(from, to);
  // Custom dates stay open while both are still blank.
  const [customMode, setCustomMode] = useState(false);
  const choice = !from && !to ? (customMode || !allowEmpty ? CUSTOM : ALL) : (preset?.id ?? CUSTOM);
  const pick = (v: string) => {
    setCustomMode(v === CUSTOM);
    if (v === ALL) onChange(null);
    else if (v === CUSTOM) {
      if (from || to) onChange({ ...(from ? { from: resolveDate(from, undefined, fy) ?? from } : {}), ...(to ? { to: resolveDate(to, undefined, fy) ?? to } : {}) });
    } else {
      const p = DATE_PRESETS.find((x) => x.id === v);
      if (p) onChange({ from: p.from, to: p.to });
    }
  };
  const end = (which: "from" | "to", v: string) => {
    const next = { from, to, [which]: v.trim() };
    onChange(next.from || next.to ? { ...(next.from ? { from: next.from } : {}), ...(next.to ? { to: next.to } : {}) } : allowEmpty ? null : {});
  };
  const resolved = preset ? [resolveDate(preset.from, undefined, fy), resolveDate(preset.to, undefined, fy)] : null;
  const endInput = (which: "from" | "to") => {
    const v = which === "from" ? from : to;
    const expression = !!v && !ISO.test(v);
    const r = expression ? resolveDate(v, undefined, fy) : null;
    return (
      <div className="grid min-w-0 flex-1 gap-0.5">
        <Input
          type={expression ? "text" : "date"}
          value={v}
          onChange={(e) => end(which, e.target.value)}
          aria-label={`${label ?? "Period"}: ${which === "from" ? "from" : "to"}`}
          aria-invalid={(expression && r === null) || invalid || undefined}
          className="h-9 min-w-0"
          max={which === "from" && ISO.test(to) ? to : undefined}
          min={which === "to" && ISO.test(from) ? from : undefined}
        />
        {expression && <span className={cn("text-xs", r ? "text-muted-foreground" : "text-destructive")}>{r ? formatDate(r) : "Not a date or expression"}</span>}
      </div>
    );
  };
  return (
    <div className={cn("flex min-w-0 flex-wrap items-start gap-2", className)}>
      <Select value={choice} onValueChange={pick}>
        <SelectTrigger id={id ?? own} aria-label={label} aria-invalid={invalid || undefined} className="h-9 min-w-40 flex-1 sm:flex-none" title={resolved?.[0] && resolved[1] ? `${formatDate(resolved[0])} – ${formatDate(resolved[1])}` : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty && <SelectItem value={ALL}>{emptyLabel}</SelectItem>}
          {DATE_PRESETS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={CUSTOM}>Custom dates…</SelectItem>
        </SelectContent>
      </Select>
      {choice === CUSTOM && (
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-1.5">
          {endInput("from")}
          <span className="pt-2 text-sm text-muted-foreground" aria-hidden="true">
            –
          </span>
          {endInput("to")}
        </div>
      )}
    </div>
  );
}
