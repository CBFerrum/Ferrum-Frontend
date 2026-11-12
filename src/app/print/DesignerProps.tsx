// The designer's properties panel (PRINT-FORMATS-SPEC §7.3): what the selected section, column, block or table column is and
// does, the moves drag makes (also as buttons and a "Move to" menu), and the Page tab (paper, margins, type, colours, letter
// head, copies, watermark, who may use it). Every change is one call to lib/printLayout.ts, so it can be undone.

import { useId, useState } from "react";
import { t as tr, isolate } from "@ferrum/client";
import {
  addSection, BLOCK_NAMES, columnsInOrder, duplicateNode, FORMAT_AS, firstPath, LINE_HEIGHTS, locate, moveBlock, newTableColumn, nodeAt, nudge, parseCondition, paragraphsOf, pathLabel, pathsOf, removeNode, setColumnCount, SIZES, SPACES, textOf,
  toNeighbourColumn, toNewSectionAbove, updateNode, widthsOf, writeCondition,
  type Align, type Block, type Catalogue, type Column, type Format, type Id, type Layout, type PrintFormat, type Problem, type Section, type SimpleCondition, type Size, type TableBlock, type TableColumn, type Value,
} from "../../lib/printLayout";
import { Alert, Button, Field, Menu, MenuItem } from "../../ui/kit";
import { SwatchPalette } from "../../ui/swatches";
import { PageFields } from "./shared";

type Set = (l: Layout, group?: string) => void;

// ui-lint-allow raw-color: colours a printed document owns (data of the format, not the interface's tokens)
const DOC_COLOURS = ["#111111", "#374151", "#555555", "#9ca3af", "#1f2937", "#1e3a8a", "#1d4ed8", "#065f46", "#7c2d12", "#b91c1c", "#f3f4f6", "#eef2ff"];
const SIZE_NAMES = (): Record<Size, string> => ({ xs: tr("Smallest (8 pt)"), sm: tr("Small (9 pt)"), md: tr("Normal (10.5 pt)"), lg: tr("Large (12 pt)"), xl: tr("Larger (14 pt)"), "2xl": tr("Largest (18 pt)") });
const AS_NAMES = (): Record<(typeof FORMAT_AS)[number], string> => ({ auto: tr("As the field is"), text: tr("Text"), multiline: tr("Lines of text"), number: tr("Number"), amount: tr("Amount"), percent: tr("Percent"), date: tr("Date"), datetime: tr("Date and time"), words: tr("Amount in words"), check: tr("Yes or No") });

export function Properties({ tab, def, layout, selected, cat, problems, letterheads, onDef, onLayout, onSelect, onRemove, onMove, name, where }: {
  tab: "selected" | "page"; def: PrintFormat; layout: Layout; selected: Id | null; cat?: Catalogue; problems: Problem[]; letterheads: { id: string; letter_head_name: string }[];
  onDef: (d: PrintFormat, group?: string) => void; onLayout: Set; onSelect: (id: Id | null) => void; onRemove: (id: Id) => void; onMove: (next: Layout, said: string, select?: Id) => void;
  name: (id: Id) => string; where: (l: Layout, id: Id) => string;
}) {
  if (tab === "page") return <PageTab def={def} cat={cat} letterheads={letterheads} onDef={onDef} />;
  const w = selected ? locate(layout, selected) : null;
  if (!w || !selected)
    return (
      <div className="stack">
        <p className="muted">{tr("Choose a block on the page or in the outline to change it. Drag fields from the left onto the page; a blue line shows where it lands.")}</p>
        <Button icon="plus" onClick={() => { const r = addSection(layout); onMove(r.layout, tr("A new section at the end"), r.section); }}>{tr("Add a section")}</Button>
      </div>
    );
  const node = nodeAt(layout, w);
  const set = (patch: Record<string, unknown>, group?: string) => onLayout(updateNode(layout, selected, patch as never), group ? `${selected}:${group}` : undefined);
  return (
    <div className="stack">
      <div>
        <p className="pd-group" style={{ marginBlockStart: 0 }}>{w.kind === "tcol" ? tr("Table column") : w.kind === "section" ? tr("Section") : w.kind === "column" ? tr("Column") : BLOCK_NAMES()[(node as Block).type]}</p>
        <strong>{isolate(name(selected))}</strong>
      </div>
      {problems.map((p, i) => <Alert key={i} tone="error">{isolate(p.message)}</Alert>)}
      {w.kind !== "column" && <Moves layout={layout} id={selected} kind={w.kind} onMove={onMove} onRemove={onRemove} name={name} where={where} />}
      {w.kind === "section" && <SectionProps s={node as Section} layout={layout} set={set} onLayout={onLayout} cat={cat} />}
      {w.kind === "column" && <ColumnProps c={node as Column} s={layout.sections[w.s]} i={w.c} layout={layout} onLayout={onLayout} onSelect={onSelect} />}
      {w.kind === "block" && <BlockProps b={node as Block} layout={layout} set={set} onLayout={onLayout} cat={cat} />}
      {w.kind === "tcol" && <TableProps t={layout.sections[w.s].columns[w.c].blocks[w.b] as TableBlock} current={selected} layout={layout} onLayout={onLayout} cat={cat} onSelect={onSelect} />}
    </div>
  );
}

/** What dragging does, as buttons and a menu: up, down, the column before or after, a new section above, duplicate, delete. */
function Moves({ layout, id, kind, onMove, onRemove, name, where }: { layout: Layout; id: Id; kind: string; onMove: (next: Layout, said: string, select?: Id) => void; onRemove: (id: Id) => void; name: (id: Id) => string; where: (l: Layout, id: Id) => string }) {
  const moved = (next: Layout) => onMove(next, tr("{name} moved to {where}", { name: name(id), where: where(next, id) }), id);
  const cols = columnsInOrder(layout);
  return (
    <div className="pd-moves" role="group" aria-label={tr("Move {name}", { name: name(id) })}>
      <Button size="sm" icon="up" aria-label={tr("Move up (Alt+↑)")} title={tr("Move up (Alt+↑)")} onClick={() => moved(nudge(layout, id, -1))} />
      <Button size="sm" icon="down" aria-label={tr("Move down (Alt+↓)")} title={tr("Move down (Alt+↓)")} onClick={() => moved(nudge(layout, id, 1))} />
      {kind === "block" && (
        <Menu label={tr("Move to…")} buttonClass="btn btn-default btn-sm">
          {(close) => (
            <>
              <MenuItem onSelect={() => (close(), moved(toNeighbourColumn(layout, id, -1)))}>{tr("The column before (Alt+←)")}</MenuItem>
              <MenuItem onSelect={() => (close(), moved(toNeighbourColumn(layout, id, 1)))}>{tr("The column after (Alt+→)")}</MenuItem>
              <MenuItem onSelect={() => { close(); const r = toNewSectionAbove(layout, id); onMove(r.layout, tr("{name} moved to a new section above", { name: name(id) }), id); }}>{tr("A new section above (Alt+Shift+←)")}</MenuItem>
              {cols.map((c) => {
                const s = layout.sections[c.s];
                const label = s.columns.length > 1 ? tr("{section}, column {n}", { section: s.title || tr("Section {n}", { n: c.s + 1 }), n: c.c + 1 }) : s.title || tr("Section {n}", { n: c.s + 1 });
                return <MenuItem key={c.id} onSelect={() => (close(), moved(moveBlock(layout, id, c.id, s.columns[c.c].blocks.length)))}>{isolate(label)}</MenuItem>;
              })}
            </>
          )}
        </Menu>
      )}
      {(kind === "block" || kind === "section") && <Button size="sm" icon="copy" aria-label={tr("Duplicate (Ctrl+D)")} title={tr("Duplicate (Ctrl+D)")} onClick={() => { const r = duplicateNode(layout, id); onMove(r.layout, tr("{name} duplicated", { name: name(id) }), r.id); }} />}
      <Button size="sm" variant="danger" icon="trash" aria-label={tr("Remove (Delete)")} title={tr("Remove (Delete)")} onClick={() => onRemove(id)} />
    </div>
  );
}

// ── small editors ──

function Num({ label, value, min, max, onChange, step = 1 }: { label: string; value: number | undefined; min: number; max: number; onChange: (v: number | undefined) => void; step?: number }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} className="input" type="number" min={min} max={max} step={step} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
    </Field>
  );
}

function Pick<T extends string | number>({ label, value, options, onChange, none }: { label: string; value: T | undefined; options: [T, string][]; onChange: (v: T | undefined) => void; none?: string }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} className="select" value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : (options.find(([v]) => String(v) === e.target.value)?.[0] as T))}>
        {none !== undefined && <option value="">{none}</option>}
        {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
    </Field>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <label className="check-field" style={{ marginBlockEnd: 8 }}>
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Text({ label, value, onChange, max, hint }: { label: string; value: string | undefined | null; onChange: (v: string) => void; max: number; hint?: string }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <input id={id} className="input" maxLength={max} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function AlignPick({ value, onChange, fallback = "start" }: { value: Align | undefined; onChange: (a: Align | undefined) => void; fallback?: Align }) {
  const names: Record<Align, string> = { start: tr("Start"), center: tr("Centre"), end: tr("End") };
  return (
    <div className="field">
      <span className="field-label" id={useId()}>{tr("Alignment")}</span>
      <div className="segmented" role="group" aria-label={tr("Alignment")}>
        {(["start", "center", "end"] as const).map((a) => (
          <button key={a} type="button" aria-pressed={(value ?? fallback) === a} onClick={() => onChange(a === fallback ? undefined : a)}>{names[a]}</button>
        ))}
      </div>
    </div>
  );
}

function Colour({ label, value, onChange }: { label: string; value: string | undefined; onChange: (c: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <Button size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true" style={{ display: "inline-block", width: 14, height: 14, borderRadius: 3, border: "1px solid var(--border-control)", background: value ?? "transparent" }} />
        {value ?? tr("Automatic")}
      </Button>
      {open && <div style={{ marginBlockStart: 8 }}><SwatchPalette label={label} columns={6} swatches={DOC_COLOURS.map((c) => ({ color: c, label: c }))} value={value ?? null} noneLabel={tr("Automatic")} onChange={(c) => (onChange(c ?? undefined), setOpen(false))} /></div>}
    </div>
  );
}

/** A field path, from the catalogue: the record's fields, linked records, the company, the print; `row` for a table's lines. */
function PathPick({ label, value, onChange, cat, table, allowNone }: { label: string; value: string | undefined; onChange: (p: string | undefined) => void; cat?: Catalogue; table?: string; allowNone?: string }) {
  const id = useId();
  const rows = table ? (cat?.tables.find((t) => t.path === table)?.columns ?? []) : [];
  const groups: [string, { path: string; label: string }[]][] = table
    ? [[tr("Lines"), rows]]
    : cat
      ? [[tr("Fields"), [...cat.fields, ...cat.system]], ...cat.links.map((l) => [l.label, l.fields] as [string, { path: string; label: string }[]]), [tr("Company"), cat.company ?? []], [tr("Print"), cat.print]]
      : [];
  const known = groups.some(([, fs]) => fs.some((f) => f.path === value));
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        {allowNone !== undefined && <option value="">{allowNone}</option>}
        {value && !known && <option value={value}>{value}</option>}
        {groups.map(([g, fs]) => fs.length ? <optgroup key={g} label={g}>{fs.map((f) => <option key={f.path} value={f.path}>{f.label}</option>)}</optgroup> : null)}
      </select>
    </Field>
  );
}

/** A value: a field, and up to three more printed when it is empty. */
function ValuePick({ label, value, onChange, cat, table }: { label: string; value: Value; onChange: (v: Value) => void; cat?: Catalogue; table?: string }) {
  const ps = pathsOf(value);
  const put = (next: string[]) => onChange(next.length === 1 ? next[0] : next);
  return (
    <div className="stack" style={{ gap: 4, marginBlockEnd: 12 }}>
      <PathPick label={label} value={ps[0]} onChange={(p) => put([p ?? "", ...ps.slice(1)])} cat={cat} table={table} />
      {ps.slice(1).map((p, i) => (
        <div key={i} className="pd-row">
          <PathPick label={tr("When that is empty")} value={p} onChange={(x) => put(x ? ps.map((y, j) => (j === i + 1 ? x : y)) : ps.filter((_, j) => j !== i + 1))} cat={cat} table={table} allowNone={tr("— none —")} />
        </div>
      ))}
      {ps.length < 4 && <div><Button size="sm" icon="plus" onClick={() => put([...ps, ps[0]])}>{tr("Another field when it is empty")}</Button></div>}
    </div>
  );
}

function FormatPick({ format, onChange }: { format: Format | undefined; onChange: (f: Format | undefined) => void }) {
  const f = format ?? {};
  const put = (patch: Partial<Format>) => {
    const next = Object.fromEntries(Object.entries({ ...f, ...patch }).filter(([, v]) => v !== undefined)) as Format;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const as = f.as ?? "auto";
  return (
    <>
      <Pick label={tr("Print it as")} value={as} options={FORMAT_AS.map((a) => [a, AS_NAMES()[a]])} onChange={(v) => put({ as: v === "auto" ? undefined : v })} />
      {["number", "amount", "percent"].includes(as) && <Num label={tr("Decimals")} value={f.decimals} min={0} max={9} onChange={(v) => put({ decimals: v })} />}
      {as === "amount" && <Pick label={tr("Currency shown as")} value={f.show ?? "symbol"} options={[["symbol", tr("Symbol (₹)")], ["code", tr("Code (INR)")], ["none", tr("Nothing")]]} onChange={(v) => put({ show: v === "symbol" ? undefined : v })} />}
      {(as === "date" || as === "datetime") && <Pick label={tr("Date style")} value={f.date ?? "short"} options={[["short", tr("Short")], ["long", tr("Long, with the month's name")]]} onChange={(v) => put({ date: v === "short" ? undefined : v })} />}
    </>
  );
}

/** When it prints: always, when a field has a value, is empty or is a value; anything else stays as written (CEL). */
function When({ when, onChange, cat }: { when: string | undefined; onChange: (w: string | undefined) => void; cat?: Catalogue }) {
  const id = useId();
  const simple = when ? parseCondition(when) : null;
  const [raw, setRaw] = useState(!!when && !simple);
  const mode = !when ? "always" : raw || !simple ? "cel" : simple.op;
  const put = (c: SimpleCondition) => onChange(writeCondition(c));
  const s = simple ?? { path: cat?.fields[0]?.path ?? "doc.number", op: "set" as const };
  return (
    <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0, gap: 4 }}>
      <legend className="field-label">{tr("Prints")}</legend>
      <select className="select" aria-label={tr("When it prints")} value={mode} onChange={(e) => {
        const v = e.target.value;
        setRaw(v === "cel");
        if (v === "always") onChange(undefined);
        else if (v === "cel") onChange(when ?? `${s.path} != ""`);
        else put({ ...s, op: v as SimpleCondition["op"], literal: v === "is" ? (s.literal ?? "") : undefined });
      }}>
        <option value="always">{tr("Always")}</option>
        <option value="set">{tr("When a field has a value")}</option>
        <option value="empty">{tr("When a field is empty")}</option>
        <option value="is">{tr("When a field is …")}</option>
        <option value="cel">{tr("When a condition holds (CEL)")}</option>
      </select>
      {(mode === "set" || mode === "empty" || mode === "is") && <PathPick label={tr("The field")} value={s.path} onChange={(p) => p && put({ ...s, path: p })} cat={cat} />}
      {mode === "is" && (
        <Field label={tr("The value")} htmlFor={id}>
          <input id={id} className="input" value={s.literal ?? ""} onChange={(e) => put({ ...s, literal: e.target.value })} />
        </Field>
      )}
      {mode === "cel" && (
        <Field label={tr("Condition")} htmlFor={`${id}-cel`} hint={tr("Like doc.is_return or doc.grand_total > 0. A missing value counts as false.")}>
          <textarea id={`${id}-cel`} className="textarea mono" dir="ltr" rows={2} maxLength={500} value={when ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
        </Field>
      )}
    </fieldset>
  );
}

const spaces = (): [number, string][] => SPACES.map((s) => [s, tr("{n} mm", { n: s })]);

// ── a section, a column ──

function SectionProps({ s, layout, set, onLayout, cat }: { s: Section; layout: Layout; set: (p: Record<string, unknown>, g?: string) => void; onLayout: Set; cat?: Catalogue }) {
  const ws = widthsOf(s);
  return (
    <>
      <Text label={tr("Title (printed above it)")} value={s.title} max={120} onChange={(v) => set({ title: v || undefined }, "title")} />
      <Pick label={tr("Columns")} value={s.columns.length} options={[[1, "1"], [2, "2"], [3, "3"], [4, "4"]]} onChange={(n) => n && onLayout(setColumnCount(layout, s.id, n))} />
      {s.columns.length > 1 && (
        <div className="pd-row">
          {ws.map((w, i) => <Num key={i} label={tr("Width {n}", { n: i + 1 })} value={w} min={1} max={12} onChange={(v) => set({ widths: ws.map((x, j) => (j === i ? Math.max(1, Math.min(12, v ?? 1)) : x)) })} />)}
        </div>
      )}
      {s.columns.length > 1 && <p className="field-hint">{tr("Widths are shares of the page (1 to 12). Or drag the line between columns on the page.")}</p>}
      <div className="pd-row">
        <Pick label={tr("Gap between columns")} value={s.gap_mm} options={spaces()} none={tr("6 mm")} onChange={(v) => set({ gap_mm: v })} />
        <Pick label={tr("Space above")} value={s.margin_top_mm} options={spaces()} none={tr("None")} onChange={(v) => set({ margin_top_mm: v })} />
      </div>
      <Check label={tr("A box around it")} value={s.border} onChange={(v) => set({ border: v || undefined })} />
      <Pick label={tr("Padding inside")} value={s.padding_mm} options={spaces()} none={s.border ? tr("2 mm") : tr("None")} onChange={(v) => set({ padding_mm: v })} />
      <Colour label={tr("Background")} value={s.background} onChange={(c) => set({ background: c })} />
      <Check label={tr("Keep it on one page")} value={s.keep_together} onChange={(v) => set({ keep_together: v || undefined })} />
      <Check label={tr("Start it on a new page")} value={s.break_before} onChange={(v) => set({ break_before: v || undefined })} />
      <When when={s.when} cat={cat} onChange={(w) => set({ when: w }, "when")} />
    </>
  );
}

function ColumnProps({ c, s, i, layout, onLayout, onSelect }: { c: Column; s: Section; i: number; layout: Layout; onLayout: Set; onSelect: (id: Id) => void }) {
  const ws = widthsOf(s);
  return (
    <>
      <p className="muted">{tr("Column {n} of {total} in its section, holding {count} blocks.", { n: i + 1, total: s.columns.length, count: c.blocks.length })}</p>
      <Num label={tr("Width (share of 12)")} value={ws[i]} min={1} max={12} onChange={(v) => onLayout(updateNode(layout, s.id, { widths: ws.map((x, j) => (j === i ? Math.max(1, Math.min(12, v ?? 1)) : x)) }))} />
      <div className="pd-row">
        <Button size="sm" onClick={() => onSelect(s.id)}>{tr("Its section")}</Button>
        <Button size="sm" variant="danger" icon="trash" disabled={s.columns.length < 2} onClick={() => onLayout(removeNode(layout, c.id))}>{tr("Remove the column (its blocks move left)")}</Button>
      </div>
    </>
  );
}

// ── blocks ──

function Common({ b, set, cat }: { b: Block; set: (p: Record<string, unknown>, g?: string) => void; cat?: Catalogue }) {
  return (
    <>
      {b.type !== "page_break" && b.type !== "spacer" && b.type !== "divider" && <AlignPick value={b.align} fallback={b.type === "totals" ? "end" : "start"} onChange={(a) => set({ align: a })} />}
      <Pick label={tr("Space above")} value={b.margin_top_mm} options={spaces()} none={tr("None")} onChange={(v) => set({ margin_top_mm: v })} />
      <When when={b.when} cat={cat} onChange={(w) => set({ when: w }, "when")} />
    </>
  );
}

function SizePick({ value, onChange }: { value: Size | undefined; onChange: (s: Size | undefined) => void }) {
  return <Pick label={tr("Size")} value={value} options={SIZES.map((s) => [s, SIZE_NAMES()[s]])} none={tr("As the page")} onChange={onChange} />;
}

function BlockProps({ b, layout, set, onLayout, cat }: { b: Block; layout: Layout; set: (p: Record<string, unknown>, g?: string) => void; onLayout: Set; cat?: Catalogue }) {
  const id = useId();
  switch (b.type) {
    case "field":
      return (
        <>
          <ValuePick label={tr("Field")} value={b.value} cat={cat} onChange={(v) => set({ value: v })} />
          <Check label={tr("Show a label")} value={b.label !== null} onChange={(v) => set({ label: v ? undefined : null })} />
          {b.label !== null && (
            <>
              <Text label={tr("Label")} value={b.label} max={80} hint={tr("Empty: the field's own, {label}.", { label: pathLabel(firstPath(b.value), cat) })} onChange={(v) => set({ label: v || undefined }, "label")} />
              <Pick label={tr("Label goes")} value={b.label_position ?? "inline"} options={[["inline", tr("Before the value")], ["above", tr("Above the value")]]} onChange={(v) => set({ label_position: v === "inline" ? undefined : v })} />
            </>
          )}
          <div className="pd-row">
            <Pick label={tr("Weight")} value={b.weight ?? "normal"} options={[["normal", tr("Normal")], ["bold", tr("Bold")]]} onChange={(v) => set({ weight: v === "normal" ? undefined : v })} />
            <SizePick value={b.size} onChange={(v) => set({ size: v })} />
          </div>
          <Colour label={tr("Colour")} value={b.color} onChange={(c) => set({ color: c })} />
          <FormatPick format={b.format} onChange={(f) => set({ format: f })} />
          <Check label={tr("Print nothing when it is empty")} value={b.hide_empty !== false} onChange={(v) => set({ hide_empty: v ? undefined : false })} />
          <Common b={b} set={set} cat={cat} />
        </>
      );
    case "heading":
      return (
        <>
          <Text label={tr("Heading")} value={b.text} max={200} hint={tr("May name values in braces: {doc.number}.")} onChange={(v) => set({ text: v }, "text")} />
          <div className="pd-row">
            <Pick label={tr("Level")} value={b.level ?? 2} options={[[1, tr("Title")], [2, tr("Heading")], [3, tr("Small heading")]]} onChange={(v) => set({ level: v === 2 ? undefined : v })} />
            <SizePick value={b.size} onChange={(v) => set({ size: v })} />
          </div>
          <Colour label={tr("Colour")} value={b.color} onChange={(c) => set({ color: c })} />
          <Common b={b} set={set} cat={cat} />
        </>
      );
    case "text":
      return (
        <>
          <Field label={tr("Text")} htmlFor={id} hint={tr("A paragraph a line. Values in braces: {doc.customer}, {doc.grand_total|words}.")}>
            <textarea id={id} className="textarea" rows={6} maxLength={10000} value={textOf(b.content)} onChange={(e) => set({ content: paragraphsOf(e.target.value, b.content[0]?.align) }, "text")} />
          </Field>
          <SizePick value={b.size} onChange={(v) => set({ size: v })} />
          <Colour label={tr("Colour")} value={b.color} onChange={(c) => set({ color: c })} />
          <Common b={b} set={set} cat={cat} />
        </>
      );
    case "image":
      return (
        <>
          <Pick label={tr("The image")} value={"file" in b.src ? "file" : "value"} options={[["file", tr("A file of this workspace")], ["value", tr("A record's image field")]]} onChange={(v) => set({ src: v === "file" ? { file: "" } : { value: (cat?.company ?? []).find((f) => f.type === "attach")?.path ?? "company.acc_logo" } })} />
          {"file" in b.src ? (
            <Text label={tr("File address")} value={b.src.file} max={60} hint={tr("Like /files/… : copy it from the file in Drive or the record it is attached to.")} onChange={(v) => set({ src: { file: v.trim() } }, "src")} />
          ) : (
            <PathPick label={tr("Image field")} value={b.src.value} cat={cat} onChange={(p) => p && set({ src: { value: p } })} />
          )}
          <div className="pd-row">
            <Num label={tr("Width (mm)")} value={b.width_mm} min={5} max={200} onChange={(v) => set({ width_mm: v })} />
            <Num label={tr("Height (mm)")} value={b.height_mm} min={5} max={200} onChange={(v) => set({ height_mm: v })} />
          </div>
          <Pick label={tr("Fit")} value={b.fit ?? "contain"} options={[["contain", tr("Whole image")], ["cover", tr("Fill the box")]]} onChange={(v) => set({ fit: v === "contain" ? undefined : v })} />
          <Text label={tr("Description (for screen readers)")} value={b.alt} max={120} onChange={(v) => set({ alt: v || undefined }, "alt")} />
          <Common b={b} set={set} cat={cat} />
        </>
      );
    case "table":
      return <TableProps t={b} layout={layout} onLayout={onLayout} cat={cat} />;
    case "totals":
      return (
        <>
          {b.rows.map((r, i) => (
            <div key={i} className="pd-tcol">
              <Text label={tr("Row {n}: label", { n: i + 1 })} value={r.label} max={80} onChange={(v) => set({ rows: b.rows.map((x, j) => (j === i ? { ...x, label: v } : x)) }, `row${i}`)} />
              <ValuePick label={tr("Value")} value={r.value} cat={cat} onChange={(v) => set({ rows: b.rows.map((x, j) => (j === i ? { ...x, value: v } : x)) })} />
              <Check label={tr("The grand total's style")} value={r.emphasis} onChange={(v) => set({ rows: b.rows.map((x, j) => (j === i ? { ...x, emphasis: v || undefined } : x)) })} />
              <Check label={tr("Leave out when it is zero")} value={r.hide_zero} onChange={(v) => set({ rows: b.rows.map((x, j) => (j === i ? { ...x, hide_zero: v || undefined } : x)) })} />
              <div className="pd-row">
                <Button size="sm" icon="up" aria-label={tr("Row {n} up", { n: i + 1 })} disabled={i === 0} onClick={() => { const rs = [...b.rows]; [rs[i - 1], rs[i]] = [rs[i], rs[i - 1]]; set({ rows: rs }); }} />
                <Button size="sm" icon="trash" aria-label={tr("Remove row {n}", { n: i + 1 })} disabled={b.rows.length < 2} onClick={() => set({ rows: b.rows.filter((_, j) => j !== i) })} />
              </div>
            </div>
          ))}
          <Button size="sm" icon="plus" disabled={b.rows.length >= 12} onClick={() => set({ rows: [...b.rows, { label: tr("Total"), value: "doc.grand_total", format: { as: "amount" } }] })}>{tr("Add a row")}</Button>
          <Num label={tr("Width (% of the column)")} value={b.width_pct} min={30} max={100} onChange={(v) => set({ width_pct: v })} />
          <Common b={b} set={set} cat={cat} />
        </>
      );
    case "signature":
      return (
        <>
          <Text label={tr("Under the line")} value={b.label} max={80} hint={tr("May name values: For {company.company_name}.")} onChange={(v) => set({ label: v }, "label")} />
          <Check label={tr("A line to sign on")} value={b.line !== false} onChange={(v) => set({ line: v ? undefined : false })} />
          <Num label={tr("Width (mm)")} value={b.width_mm} min={30} max={120} onChange={(v) => set({ width_mm: v })} />
          <Common b={b} set={set} cat={cat} />
        </>
      );
    case "barcode":
      return (
        <>
          <Pick label={tr("Kind")} value={b.kind} options={[["code128", tr("Barcode (Code 128)")], ["ean13", tr("Barcode (EAN-13)")], ["qr", tr("QR code")]]} onChange={(v) => v && set({ kind: v })} />
          <ValuePick label={tr("What it encodes")} value={b.value} cat={cat} onChange={(v) => set({ value: v })} />
          <Num label={b.kind === "qr" ? tr("Side (mm)") : tr("Height (mm)")} value={b.height_mm} min={5} max={60} onChange={(v) => set({ height_mm: v })} />
          {b.kind !== "qr" && <Check label={tr("The text under the bars")} value={b.show_text !== false} onChange={(v) => set({ show_text: v ? undefined : false })} />}
          <Common b={b} set={set} cat={cat} />
        </>
      );
    case "copy_label":
      return (
        <>
          <p className="muted">{tr("Prints which copy this is (Original, Duplicate) when the person printing ticks copies.")}</p>
          <div className="pd-row">
            <SizePick value={b.size} onChange={(v) => set({ size: v })} />
            <Pick label={tr("Weight")} value={b.weight ?? "normal"} options={[["normal", tr("Normal")], ["bold", tr("Bold")]]} onChange={(v) => set({ weight: v === "normal" ? undefined : v })} />
          </div>
          <Common b={b} set={set} cat={cat} />
        </>
      );
    case "divider":
      return (
        <>
          <div className="pd-row">
            <Pick label={tr("Thickness")} value={b.thickness ?? 1} options={[[1, "1"], [2, "2"], [3, "3"]]} onChange={(v) => set({ thickness: v })} />
            <Pick label={tr("Style")} value={b.style ?? "solid"} options={[["solid", tr("Solid")], ["dashed", tr("Dashed")]]} onChange={(v) => set({ style: v })} />
          </div>
          <Colour label={tr("Colour")} value={b.color} onChange={(c) => set({ color: c })} />
          <Common b={b} set={set} cat={cat} />
        </>
      );
    case "spacer":
      return (
        <>
          <Num label={tr("Height (mm)")} value={b.height_mm} min={1} max={100} onChange={(v) => set({ height_mm: v ?? 1 })} />
          <Common b={b} set={set} cat={cat} />
        </>
      );
    case "page_break":
      return (
        <>
          <p className="muted">{tr("What follows starts on a new page.")}</p>
          <When when={b.when} cat={cat} onChange={(w) => set({ when: w }, "when")} />
        </>
      );
  }
}

/** A table of lines: which lines, its columns (field, label, width, alignment, format, a line under it, when it shows), the totals
 *  row, numbering, borders. `current`: a column chosen on the page. */
function TableProps({ t, layout, onLayout, cat, current, onSelect }: { t: TableBlock; layout: Layout; onLayout: Set; cat?: Catalogue; current?: Id; onSelect?: (id: Id | null) => void }) {
  const set = (patch: Partial<TableBlock>, g?: string) => onLayout(updateNode(layout, t.id, patch), g ? `${t.id}:${g}` : undefined);
  const setCol = (c: TableColumn, patch: Partial<TableColumn>, g?: string) => onLayout(updateNode(layout, c.id, patch), g ? `${c.id}:${g}` : undefined);
  const lines = cat?.tables.find((x) => x.path === t.value);
  const [adding, setAdding] = useState("");
  const total = t.columns.reduce((a, c) => a + (c.width_pct ?? 0), 0);
  return (
    <>
      {current && onSelect && <Button size="sm" onClick={() => onSelect(t.id)}>{tr("The whole table")}</Button>}
      <Pick label={tr("Lines")} value={t.value} options={(cat?.tables ?? []).map((x) => [x.path, x.label])} onChange={(v) => v && set({ value: v })} />
      <p className="field-label">{tr("Columns")} <span className="faint">{total ? tr("({pct}% given)", { pct: total }) : ""}</span></p>
      {t.columns.map((c, i) => (
        <div key={c.id} className="pd-tcol" aria-current={current === c.id || undefined}>
          <ValuePick label={tr("Column {n}", { n: i + 1 })} value={c.value} cat={cat} table={t.value} onChange={(v) => setCol(c, { value: v })} />
          <Text label={tr("Heading")} value={c.label} max={80} hint={tr("Empty: {label}", { label: pathLabel(firstPath(c.value), cat) })} onChange={(v) => setCol(c, { label: v || undefined }, "label")} />
          <div className="pd-row">
            <Num label={tr("Width %")} value={c.width_pct} min={3} max={100} onChange={(v) => setCol(c, { width_pct: v })} />
            <Pick label={tr("Alignment")} value={c.align} options={[["start", tr("Start")], ["center", tr("Centre")], ["end", tr("End")]]} none={tr("Automatic")} onChange={(v) => setCol(c, { align: v })} />
          </div>
          <FormatPick format={c.format} onChange={(f) => setCol(c, { format: f })} />
          <PathPick label={tr("Under it, small")} value={c.secondary === undefined ? undefined : firstPath(c.secondary)} table={t.value} cat={cat} allowNone={tr("Nothing")} onChange={(p) => setCol(c, { secondary: p })} />
          <Check label={tr("Summed in the totals row")} value={t.totals?.includes(c.id)} onChange={(v) => set({ totals: v ? [...(t.totals ?? []), c.id] : (t.totals ?? []).filter((x) => x !== c.id) })} />
          <When when={c.when} cat={cat} onChange={(w) => setCol(c, { when: w }, "when")} />
          <div className="pd-row">
            <Button size="sm" icon="up" aria-label={tr("Column {n} earlier", { n: i + 1 })} disabled={i === 0} onClick={() => onLayout(nudge(layout, c.id, -1))} />
            <Button size="sm" icon="down" aria-label={tr("Column {n} later", { n: i + 1 })} disabled={i === t.columns.length - 1} onClick={() => onLayout(nudge(layout, c.id, 1))} />
            <Button size="sm" icon="trash" aria-label={tr("Remove column {n}", { n: i + 1 })} onClick={() => onLayout(removeNode(layout, c.id))} />
          </div>
        </div>
      ))}
      <div className="pd-row">
        <Field label={tr("Add a column")} htmlFor={`${t.id}-add`}>
          <select id={`${t.id}-add`} className="select" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">{tr("Choose a field of the lines")}</option>
            {(lines?.columns ?? []).map((x) => <option key={x.path} value={x.path}>{x.label}</option>)}
          </select>
        </Field>
        <Button size="sm" icon="plus" disabled={!adding || t.columns.length >= 20} onClick={() => { const label = lines?.columns.find((x) => x.path === adding)?.label; set({ columns: [...t.columns, newTableColumn(layout, adding, label)] }); setAdding(""); }}>{tr("Add")}</Button>
      </div>
      <Check label={tr("Number the lines")} value={t.row_numbers} onChange={(v) => set({ row_numbers: v || undefined })} />
      <Check label={tr("Headings (on every page)")} value={t.header !== false} onChange={(v) => set({ header: v ? undefined : false })} />
      <div className="pd-row">
        <Pick label={tr("Lines between")} value={t.borders ?? "rows"} options={[["rows", tr("Rows")], ["all", tr("Every cell")], ["none", tr("None")]]} onChange={(v) => set({ borders: v === "rows" ? undefined : v })} />
        <SizePick value={t.size} onChange={(v) => set({ size: v })} />
      </div>
      <Check label={tr("Shade every other line")} value={t.striped} onChange={(v) => set({ striped: v || undefined })} />
      <PathPick label={tr("Leave out lines where this is zero")} value={t.hide_zero_rows} table={t.value} cat={cat} allowNone={tr("Print every line")} onChange={(p) => set({ hide_zero_rows: p })} />
      {!!t.totals?.length && <Text label={tr("Totals row label")} value={t.totals_label} max={80} hint={tr("Empty: Total")} onChange={(v) => set({ totals_label: v || undefined }, "tl")} />}
      <Text label={tr("When there are no lines, print")} value={t.empty_text} max={80} hint={tr("Empty: the table is left out.")} onChange={(v) => set({ empty_text: v || undefined }, "et")} />
      <Common b={t} set={(p, g) => set(p as Partial<TableBlock>, g)} cat={cat} />
    </>
  );
}

// ── the page ──

function PageTab({ def, cat, letterheads, onDef }: { def: PrintFormat; cat?: Catalogue; letterheads: { id: string; letter_head_name: string }[]; onDef: (d: PrintFormat, group?: string) => void }) {
  const id = useId();
  const l = def.layout!;
  const style = l.style ?? {};
  const setStyle = (patch: Partial<NonNullable<Layout["style"]>>) => {
    const next = Object.fromEntries(Object.entries({ ...style, ...patch }).filter(([, v]) => v !== undefined));
    onDef({ ...def, layout: { ...l, style: Object.keys(next).length ? next : undefined } });
  };
  return (
    <div className="stack">
      <Text label={tr("Name")} value={def.label} max={80} onChange={(v) => onDef({ ...def, label: v }, "label")} />
      <label className="check-field">
        <input type="checkbox" role="switch" checked={def.enabled !== false} onChange={(e) => onDef({ ...def, enabled: e.target.checked })} />
        {tr("Can be printed")}
      </label>
      <PageFields page={def.page} onChange={(p) => onDef({ ...def, page: p === null ? undefined : { size: "A4", orientation: "portrait", margin_mm: { top: 15, right: 12, bottom: 15, left: 12 }, ...def.page, ...p } })} />
      <div className="pd-row">
        <Pick label={tr("Typeface")} value={style.font} options={[["sans", tr("Sans serif")], ["serif", tr("Serif")], ["mono", tr("Monospace")]]} none={tr("The print settings'")} onChange={(v) => setStyle({ font: v })} />
        <Pick label={tr("Text size")} value={style.size} options={SIZES.map((s) => [s, SIZE_NAMES()[s]])} none={SIZE_NAMES().md} onChange={(v) => setStyle({ size: v })} />
      </div>
      <Pick label={tr("Line spacing")} value={style.line_height} options={LINE_HEIGHTS.map((h) => [h, String(h)])} none="1.45" onChange={(v) => setStyle({ line_height: v as (typeof LINE_HEIGHTS)[number] | undefined })} />
      <Colour label={tr("Text colour")} value={style.color} onChange={(c) => setStyle({ color: c })} />
      <Colour label={tr("Accent (headings, rules)")} value={style.accent} onChange={(c) => setStyle({ accent: c })} />
      <Field label={tr("Letter head")} htmlFor={`${id}-lh`}>
        <select id={`${id}-lh`} className="select" value={def.letterhead ?? "default"} onChange={(e) => onDef({ ...def, letterhead: e.target.value })}>
          <option value="default">{tr("The record's company's")}</option>
          <option value="none">{tr("None")}</option>
          {letterheads.map((x) => <option key={x.id} value={x.id}>{isolate(x.letter_head_name)}</option>)}
        </select>
      </Field>
      <Field label={tr("Copies offered")} htmlFor={`${id}-copies`} hint={tr("One label a line, at most 5. Empty: the print settings' labels.")}>
        <textarea id={`${id}-copies`} className="textarea" rows={3} value={(def.copies ?? []).join("\n")} onChange={(e) => onDef({ ...def, copies: e.target.value.split("\n").slice(0, 5) }, "copies")} />
      </Field>
      <Text label={tr("Watermark")} value={l.watermark?.text} max={40} hint={tr("Besides Draft and Cancelled, which the print settings add.")} onChange={(v) => onDef({ ...def, layout: { ...l, watermark: v ? { ...l.watermark, text: v } : undefined } }, "wm")} />
      {l.watermark && <When when={l.watermark.when} cat={cat} onChange={(w) => onDef({ ...def, layout: { ...l, watermark: { ...l.watermark!, when: w } } }, "wmw")} />}
      <Field label={tr("Who may use it")} htmlFor={`${id}-roles`} hint={tr("Role names separated by commas. Empty: everyone who may read the record.")}>
        <input id={`${id}-roles`} className="input" value={(def.roles ?? []).join(", ")} onChange={(e) => onDef({ ...def, roles: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }, "roles")} />
      </Field>
    </div>
  );
}
