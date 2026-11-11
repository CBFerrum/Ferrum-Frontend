// A simple check on an entity as rows a person fills in (Customize → Add a validation rule), and the expression
// they come to. The server reads a customization's check as CEL over the record (crates/meta/src/expr.rs):
// decimals, money and percents arrive as floats and empty numbers and checks as 0 and false (`cel_view`),
// dates as ISO text, an empty text or date as null. So a number is written as a literal of its type (`5` for a
// whole number, `5.0` for a decimal), a date as quoted ISO text, a text with its quotes and backslashes escaped,
// and a comparison of text or a date is guarded against null (`doc.due != null && doc.due >= '2026-01-01'`).
// `parseCheck` reads back what `buildCheck` wrote and nothing else: a rule written by hand is "advanced".

import { t as tr } from "@ferrum/client";
import type { Field } from "./meta";

export type CheckOp = "eq" | "ne" | "gte" | "lte" | "gt" | "lt" | "filled" | "empty" | "contains";
export interface CheckRow { key: string; field: string; op: CheckOp; value: string }
export interface CheckDraft { join: "all" | "any"; rows: CheckRow[] }
type Typed = Pick<Field, "name" | "type"> & { label?: string; options?: string[] };

export const MAX_EXPR_LEN = 4096;
const TEXT = ["data", "text", "markdown", "code", "email", "phone", "url", "color"];
const NUMBER = ["int", "decimal", "currency", "percent"];
const DATE = ["date", "datetime"];

/** The fields a check can be about: those with a way to compare. */
export const checkable = <F extends Typed & { can_read?: boolean; hidden?: boolean }>(fields: F[]) =>
  fields.filter((f) => f.can_read === true && !f.hidden && [...TEXT, ...NUMBER, ...DATE, "select", "check", "link", "attach"].includes(f.type));

export function opsForType(type: string | undefined): CheckOp[] {
  if (type === "check") return ["eq"];
  if (type && NUMBER.includes(type)) return ["eq", "ne", "gte", "lte", "gt", "lt"];
  // A datetime is stored with seconds and a zone, so only an order has an exact meaning for it.
  if (type === "datetime") return ["gte", "lte", "gt", "lt", "filled", "empty"];
  if (type === "date") return ["eq", "ne", "gte", "lte", "gt", "lt", "filled", "empty"];
  if (type === "select") return ["eq", "ne", "filled", "empty"];
  if (type === "link" || type === "attach") return ["filled", "empty"];
  return ["eq", "ne", "contains", "filled", "empty"];
}

export const opName = (op: CheckOp, type?: string): string => {
  if (type === "check" && op === "eq") return tr("is");
  return { eq: tr("is"), ne: tr("is not"), gte: tr("is at least"), lte: tr("is at most"), gt: tr("is more than"), lt: tr("is less than"), filled: tr("is filled in"), empty: tr("is empty"), contains: tr("contains") }[op];
};

let counter = 0;
export const newCheckRow = (field = "", op: CheckOp = "eq"): CheckRow => ({ key: `c${++counter}`, field, op, value: "" });
export const newCheck = (): CheckDraft => ({ join: "all", rows: [newCheckRow()] });

// ── literals ──

const ESC: Record<string, string> = { "\\": "\\\\", "'": "\\'", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
/** A text as a CEL string in single quotes. */
export const quote = (s: string) => `'${s.replace(/[\\'\n\r\t\u0000-\u001f\u007f]/g, (c) => ESC[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}'`;
const UNESC: Record<string, string> = { "\\": "\\", "'": "'", n: "\n", r: "\r", t: "\t" };
const unquote = (lit: string) => lit.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/gs, (_, e: string) => (e[0] === "u" && e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : (UNESC[e] ?? e)));
const STR = String.raw`'(?:[^'\\\n]|\\.)*'`;

/** A number as a literal of the field's type, or null when it is not one: `5` for a whole number, `5.0` for a decimal. */
export function numberLiteral(type: string, text: string): string | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) return null;
  const whole = m[2].replace(/^0+(?=\d)/, "");
  if (type === "int") return m[3] === undefined ? `${m[1]}${whole}` : null;
  return `${m[1]}${whole}.${m[3] ?? "0"}`;
}
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const SYMBOL: Partial<Record<CheckOp, string>> = { eq: "==", ne: "!=", gte: ">=", lte: "<=", gt: ">", lt: "<" };
const ORDER_OPS = ["gte", "lte", "gt", "lt"];

/** The value as the literal that goes in the expression, or null when the row is not finished or does not fit. */
function literal(type: string, value: string): string | null {
  if (type === "check") return value === "false" ? "false" : "true";
  if (NUMBER.includes(type)) return numberLiteral(type, value);
  if (type === "date") return DATE_TEXT.test(value) ? quote(value) : null;
  if (type === "datetime") return DATETIME_TEXT.test(value) ? quote(value) : null;
  return value === "" ? null : quote(value);
}

/** One row as an expression, or null when it is not finished or its comparison does not exist for its field. */
export function buildRow(r: CheckRow, type: string | undefined): string | null {
  if (!r.field || !type || !opsForType(type).includes(r.op)) return null;
  const f = `doc.${r.field}`;
  const nullable = TEXT.includes(type) || DATE.includes(type) || type === "select" || type === "link" || type === "attach";
  switch (r.op) {
    case "filled":
      return `${f} != null && ${f} != ''`;
    case "empty":
      return `${f} == null || ${f} == ''`;
    case "contains": {
      const v = literal(type, r.value);
      return v && `${f} != null && ${f}.contains(${v})`;
    }
    default: {
      const v = literal(type, r.value);
      if (!v) return null;
      return nullable && ORDER_OPS.includes(r.op) ? `${f} != null && ${f} ${SYMBOL[r.op]} ${v}` : `${f} ${SYMBOL[r.op]} ${v}`;
    }
  }
}

/** What is not finished, in words: one line for each row that has no expression yet. */
export function checkProblems(d: CheckDraft, fields: Typed[]): string[] {
  const out: string[] = [];
  if (!d.rows.length) out.push(tr("Add at least one condition."));
  d.rows.forEach((r, i) => {
    const type = fields.find((f) => f.name === r.field)?.type;
    if (buildRow(r, type) === null) out.push(tr("Finish condition {n}, or remove it.", { n: i + 1 }));
  });
  const expr = buildCheck(d, fields);
  if (expr.length > MAX_EXPR_LEN) out.push(tr("The check is longer than {n} characters: use fewer conditions.", { n: MAX_EXPR_LEN }));
  return out;
}

/** The expression the rows come to ("" until every row is finished). With more than one row each is in parentheses. */
export function buildCheck(d: CheckDraft, fields: Typed[]): string {
  const parts = d.rows.map((r) => buildRow(r, fields.find((f) => f.name === r.field)?.type));
  if (!parts.length || parts.some((p) => p === null)) return "";
  if (parts.length === 1) return parts[0] as string;
  return parts.map((p) => `(${p})`).join(d.join === "all" ? " && " : " || ");
}

// ── reading back ──

const ROW_SHAPES: { re: RegExp; read: (m: RegExpExecArray) => { field: string; op: CheckOp; value: string } | null }[] = [
  { re: new RegExp(String.raw`^doc\.(\w+) (==|!=|>=|<=|>|<) (-?\d+(?:\.\d+)?|true|false|${STR})$`), read: (m) => ({ field: m[1], op: opOf(m[2]), value: valueOf(m[3]) }) },
  { re: new RegExp(String.raw`^doc\.(\w+) != null && doc\.\1 (>=|<=|>|<) (${STR})$`), read: (m) => ({ field: m[1], op: opOf(m[2]), value: valueOf(m[3]) }) },
  { re: new RegExp(String.raw`^doc\.(\w+) != null && doc\.\1\.contains\((${STR})\)$`), read: (m) => ({ field: m[1], op: "contains", value: valueOf(m[2]) }) },
  { re: /^doc\.(\w+) != null && doc\.\1 != ''$/, read: (m) => ({ field: m[1], op: "filled", value: "" }) },
  { re: /^doc\.(\w+) == null \|\| doc\.\1 == ''$/, read: (m) => ({ field: m[1], op: "empty", value: "" }) },
];
const opOf = (s: string): CheckOp => (Object.entries(SYMBOL).find(([, v]) => v === s)?.[0] ?? "eq") as CheckOp;
const valueOf = (lit: string) => (lit.startsWith("'") ? unquote(lit) : lit);

function parseRow(text: string, fields: Typed[]): CheckRow | null {
  for (const s of ROW_SHAPES) {
    const m = s.re.exec(text);
    const got = m && s.read(m);
    if (!got) continue;
    const type = fields.find((f) => f.name === got.field)?.type;
    const row: CheckRow = { key: newCheckRow().key, ...got };
    // Only what the builder writes: the row must come back to the very same text.
    if (buildRow(row, type) === text) return row;
  }
  return null;
}

/** Splits at an operator outside quotes and brackets; null when the text uses the other operator there too. */
function split(text: string): { join: "all" | "any"; parts: string[] } | null {
  const parts: string[] = [];
  let depth = 0, from = 0, join: string | null = null, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === "'") quoted = false;
    } else if (c === "'") quoted = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && (text.startsWith(" && ", i) || text.startsWith(" || ", i))) {
      const op = text.slice(i + 1, i + 3);
      if (join && join !== op) return null;
      join = op;
      parts.push(text.slice(from, i));
      from = i + 4;
      i += 3;
    }
  }
  parts.push(text.slice(from));
  return join ? { join: join === "&&" ? "all" : "any", parts } : null;
}

/** The rows an expression came from, or null when it is not one `buildCheck` writes (a rule typed by hand). */
export function parseCheck(expr: string, fields: Typed[]): CheckDraft | null {
  const text = expr.trim();
  if (!text) return null;
  const single = parseRow(text, fields);
  if (single) return { join: "all", rows: [single] };
  const s = split(text);
  if (!s) return null;
  const rows: CheckRow[] = [];
  for (const p of s.parts) {
    if (!p.startsWith("(") || !p.endsWith(")")) return null;
    const row = parseRow(p.slice(1, -1), fields);
    if (!row) return null;
    rows.push(row);
  }
  // Written back, it is the same text (a split that merely looked right is not accepted).
  const draft: CheckDraft = { join: s.join, rows };
  return buildCheck(draft, fields) === text ? draft : null;
}

/** How a rule opens in the form: as rows when the builder wrote it, else in the advanced editor. */
export const openAs = (expr: string, fields: Typed[]): { mode: "builder"; draft: CheckDraft } | { mode: "advanced" } => {
  const draft = parseCheck(expr, fields);
  return draft ? { mode: "builder", draft } : { mode: "advanced" };
};

/** The `add_rule` customization for a rule form: `field` (where the refusal shows) is sent only when one is chosen. */
export const addRuleOp = (r: { name: string; message: string; on: string; field?: string }, check: string) => ({ op: "add_rule" as const, rule: { name: r.name.trim(), check, message: r.message.trim(), on: r.on, ...(r.field ? { field: r.field } : {}) } });
