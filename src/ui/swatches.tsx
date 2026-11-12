// A colour palette with no editor in it: swatches in a grid that is one tab stop (arrows move over it, Home and End jump), an
// "Automatic" or "None" choice, the colours used last, and a custom value that is checked before it is used. Controlled: the caller
// holds the colour, the table of swatches (colours are data, not tokens) and the recents (`rememberColor`).

import { BanIcon } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";

/** A colour as `#rrggbb` from what a person types (`#1F4E79`, `1f4e79`, `#fa0`), or null: not a hex colour, or fully transparent. Alpha is dropped. */
export function normalizeColor(text: string): string | null {
  const v = text.trim().toLowerCase().replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) return null;
  if (v.length === 8 && parseInt(v.slice(6), 16) === 0) return null;
  const six = v.length === 3 ? [...v].map((c) => c + c).join("") : v.slice(0, 6);
  return `#${six}`;
}

/** The recent colours with `color` first, once, at most `max`. */
export function rememberColor(recent: string[], color: string, max = 8): string[] {
  return [color, ...recent.filter((c) => c !== color)].slice(0, max);
}

/** Where a key moves over a grid of `count` cells `columns` wide (a row up or down for the vertical arrows; the start arrow goes back, flipped right to left); null for another key. */
export function gridStep(key: string, at: number, count: number, columns: number, rtl: boolean): number | null {
  const step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -columns, ArrowDown: columns, Home: -at, End: count - 1 - at }[key];
  return step === undefined ? null : Math.max(0, Math.min(count - 1, at + step));
}

export interface Swatch {
  color: string;
  /** What a screen reader says: "Blue, dark". */
  label: string;
}

function Grid({ swatches, columns, value, onPick }: { swatches: Swatch[]; columns: number; value: string | null; onPick: (c: string) => void }) {
  const stop = Math.max(0, swatches.findIndex((s) => s.color === value));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cells = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-cell]"));
    const at = cells.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? null : gridStep(e.key, at, cells.length, columns, getComputedStyle(e.currentTarget).direction === "rtl");
    if (next === null) return;
    e.preventDefault();
    cells[next]?.focus();
  };
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} onKeyDown={onKeyDown}>
      {swatches.map((s, i) => (
        <button
          key={`${s.color}-${i}`}
          type="button"
          data-cell
          tabIndex={i === stop ? 0 : -1}
          aria-label={s.label}
          aria-pressed={s.color === value}
          title={s.label}
          style={{ background: s.color }}
          onClick={() => onPick(s.color)}
          className="relative aspect-square min-h-5 rounded-sm border border-border-strong outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-pressed:outline-2 aria-pressed:outline-offset-1 aria-pressed:outline-foreground pointer-coarse:min-h-8"
        />
      ))}
    </div>
  );
}

/**
 * `swatches`: the table, row after row of `columns`. `value`: the colour in use, null for none/automatic, which `noneLabel` names
 * ("Automatic" for text, "None" for a fill). `onChange` gets a `#rrggbb` or null. `recent` is shown as a second row; record a choice with `rememberColor`.
 */
export function SwatchPalette({ label, swatches, columns = 10, value, noneLabel, onChange, recent = [], custom = true }: { label: string; swatches: Swatch[]; columns?: number; value: string | null; noneLabel: string; onChange: (color: string | null) => void; recent?: string[]; custom?: boolean }) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const id = useId();
  const apply = () => {
    const c = normalizeColor(text);
    setBad(!c);
    if (c) onChange(c);
  };
  const row = "text-xs font-medium text-muted-foreground";
  return (
    <div role="group" aria-label={label} className="flex w-60 flex-col gap-2 text-sm">
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-start hover:bg-surface-2 aria-pressed:bg-primary-soft aria-pressed:text-primary", "pointer-coarse:min-h-11")}>
        <BanIcon className="size-3.5" aria-hidden="true" /> {noneLabel}
      </button>
      <Grid swatches={swatches} columns={columns} value={value} onPick={onChange} />
      {recent.length > 0 && (
        <>
          <div className={row}>{t("Recent")}</div>
          <Grid swatches={recent.map((c) => ({ color: c, label: t("Recent colour {value}", { value: c }) }))} columns={8} value={value} onPick={onChange} />
        </>
      )}
      {custom && (
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <label className={row} htmlFor={id}>
            {t("Custom colour")}
          </label>
          <input id={id} className="input" dir="ltr" inputMode="text" placeholder="#1F4E79" maxLength={9} value={text} aria-invalid={bad || undefined} aria-describedby={bad ? `${id}-why` : undefined} onChange={(e) => setText(e.target.value)} />
          {bad && (
            <p id={`${id}-why`} className="text-xs text-destructive">
              {t("Enter a colour code of three or six hex digits")}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
