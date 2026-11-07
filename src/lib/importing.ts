// Turning a spreadsheet's rows into records: which column is which field, and what is wrong with a
// row before anything is sent. The server has the last word on every row; this finds what can be found
// here, so a person fixes the file once instead of reading a failure at a time.

import { isDecimalString } from "./format";
import type { Field } from "./meta";
import { t } from "@ferrum/client";

/** Fields a person can fill from a file: not rows, files, or what the server works out. */
export function importable(fields: Field[]): Field[] {
  return fields.filter((f) => f.can_write === true && !f.computed && !f.read_only && !f.hidden && !["table", "attach", "image", "secret", "json"].includes(f.type));
}

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Each column's field, by its label or name, ignoring case and punctuation. A field is used once. */
export function guessMapping(headers: string[], fields: Field[]): (string | null)[] {
  const taken = new Set<string>();
  return headers.map((h) => {
    const key = normal(h);
    const f = fields.find((x) => !taken.has(x.name) && (normal(x.label) === key || normal(x.name) === key));
    if (!f || !key) return null;
    taken.add(f.name);
    return f.name;
  });
}

export interface Problem {
  /** The row's number in the file, counting the header as 1, as a spreadsheet shows it. */
  row: number;
  field: string;
  message: string;
}

const TRUE = new Set(["1", "true", "yes", "y"]);
const FALSE = new Set(["0", "false", "no", "n"]);

/** One cell as the API takes it, or why it cannot be. Empty is null. */
export function cellValue(f: Field, raw: string): { value: unknown } | { problem: string } {
  const v = raw.trim();
  if (!v) return { value: null };
  switch (f.type) {
    case "int":
      return /^-?\d+$/.test(v) ? { value: Number(v) } : { problem: t("\"{v}\" is not a whole number", { v }) };
    case "decimal":
    case "currency":
    case "percent": {
      const plain = v.replace(/,/g, "");
      return isDecimalString(plain) ? { value: plain } : { problem: t("\"{v}\" is not a number", { v }) };
    }
    case "check":
      if (TRUE.has(v.toLowerCase())) return { value: true };
      return FALSE.has(v.toLowerCase()) ? { value: false } : { problem: t("\"{v}\" is not yes or no", { v }) };
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? { value: v } : { problem: t("\"{v}\" is not a date as YYYY-MM-DD", { v }) };
    case "datetime":
      return Number.isNaN(Date.parse(v)) ? { problem: t("\"{v}\" is not a date and time", { v }) } : { value: new Date(v).toISOString() };
    case "select": {
      const match = f.options?.find((o) => o.toLowerCase() === v.toLowerCase());
      return match ? { value: match } : { problem: t("\"{v}\" is not one of {value}", { v, value: (f.options ?? []).join(", ") }) };
    }
    default:
      return { value: v };
  }
}

export interface Built {
  /** Good rows, with their place in the file. */
  records: { row: number; doc: Record<string, unknown> }[];
  problems: Problem[];
}

/** Records from the rows under the header. `links` holds, per link field, each title's record id. */
export function buildRecords(rows: string[][], mapping: (string | null)[], fields: Field[], links: Record<string, Map<string, string>>): Built {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const required = fields.filter((f) => f.required && mapping.includes(f.name));
  const built: Built = { records: [], problems: [] };
  rows.forEach((cells, i) => {
    const row = i + 2;
    const doc: Record<string, unknown> = {};
    const wrong: Problem[] = [];
    mapping.forEach((name, column) => {
      const f = name ? byName.get(name) : undefined;
      if (!f) return;
      const raw = cells[column] ?? "";
      if (f.type === "link" && raw.trim()) {
        const id = links[f.name]?.get(raw.trim().toLowerCase());
        if (id) doc[f.name] = id;
        else wrong.push({ row, field: f.label, message: t("no record called \"{raw}\"", { raw: raw.trim() }) });
        return;
      }
      const cell = cellValue(f, raw);
      if ("problem" in cell) wrong.push({ row, field: f.label, message: cell.problem });
      else if (cell.value !== null) doc[f.name] = cell.value;
    });
    for (const f of required) if (doc[f.name] === undefined && !wrong.some((p) => p.field === f.label)) wrong.push({ row, field: f.label, message: "is required" });
    if (wrong.length) built.problems.push(...wrong);
    else built.records.push({ row, doc });
  });
  return built;
}

/** Required fields no column fills, for which every row would fail. */
export function missingRequired(fields: Field[], mapping: (string | null)[]): Field[] {
  return fields.filter((f) => f.required && f.default === undefined && !mapping.includes(f.name));
}
