// Row selection and bulk actions (`POST /api/v1/{E}/_bulk`): the selection model, which actions a
// viewer may try on a selection, the requests (at most 500 records each) and their per-record
// results. Pure functions, tested without a browser.

import type { FieldError } from "../../lib/api";
import { can, fieldLabel, type EntityMeta, type Field, type Me } from "../../lib/meta";

export const MAX_BULK = 500;

// ── selection ──

/**
 * Toggles row `id`. With `range` (shift-click), every row from the `anchor` (the row clicked last) to
 * `id`, in list order, takes `id`'s new state.
 */
export function toggleRow(selected: ReadonlySet<string>, order: string[], id: string, anchor: string | null, range: boolean): Set<string> {
  const next = new Set(selected);
  const on = !selected.has(id);
  const a = anchor === null ? -1 : order.indexOf(anchor);
  const b = order.indexOf(id);
  const ids = range && a >= 0 && b >= 0 ? order.slice(Math.min(a, b), Math.max(a, b) + 1) : [id];
  for (const x of ids) {
    if (on) next.add(x);
    else next.delete(x);
  }
  return next;
}

export type PageState = "none" | "some" | "all";

/** How much of the page (`ids`) is selected: drives the header checkbox. */
export function pageState(selected: ReadonlySet<string>, ids: string[]): PageState {
  const n = ids.filter((id) => selected.has(id)).length;
  return n === 0 ? "none" : n === ids.length ? "all" : "some";
}

/** The header checkbox: selects every row on the page, or clears them when all are selected. */
export function togglePage(selected: ReadonlySet<string>, ids: string[]): Set<string> {
  const next = new Set(selected);
  const all = pageState(selected, ids) === "all";
  for (const id of ids) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

// ── operations ──

export type BulkOp =
  | { op: "update"; values: Record<string, unknown> }
  | { op: "delete" }
  | { op: "submit" }
  | { op: "cancel" }
  | { op: "workflow"; action: string }
  | { op: "assign"; user: string; note?: string; due_date?: string; priority?: string }
  | { op: "add_tags" | "remove_tags"; tags: string[] };

export interface BulkRowError {
  error: string;
  message: string;
  fields?: FieldError[];
  error_id?: string;
}
export interface BulkRowResult {
  id: string;
  ok: boolean;
  error?: BulkRowError;
}
export interface BulkResponse {
  succeeded: number;
  failed: number;
  results: BulkRowResult[];
}

// Types a "set a field" dialog cannot offer: grids, uploads, write-only and free-form values.
const NOT_BULK = new Set(["table", "attach", "secret", "json", "code"]);

/** A field the viewer may set on many records at once (unique fields would clash). */
export const bulkEditable = (f: Field) =>
  f.can_read === true && f.can_write === true && !f.read_only && !f.computed && !f.hidden && !f.unique && !NOT_BULK.has(f.type);

export interface BulkActions {
  /** Fields that can be set on the whole selection. */
  fields: Field[];
  delete: boolean;
  submit: boolean;
  cancel: boolean;
  /** Workflow actions the viewer's roles allow; each record's state decides where one applies. */
  workflow: string[];
}

/** The actions worth offering on a selection; the server still checks every record. */
export function bulkActions(meta: EntityMeta, me: Me | undefined): BulkActions {
  const p = meta.permissions;
  const wf = meta.workflow;
  const roles = me?.user.roles ?? [];
  const allowed = (r: string[]) => !r.length || !!me?.user.is_admin || r.some((x) => roles.includes(x));
  const writable = can(p, "write") && meta.kind !== "ledger";
  return {
    fields: writable ? meta.fields.filter(bulkEditable).sort((a, b) => a.label.localeCompare(b.label)) : [],
    delete: can(p, "delete") && meta.kind !== "ledger",
    submit: meta.submittable && !wf && can(p, "submit"),
    cancel: meta.submittable && !wf && can(p, "cancel"),
    workflow: wf ? [...new Set(wf.transitions.filter((t) => allowed(t.roles)).map((t) => t.action))] : [],
  };
}

/** `n` records of `meta`: "1 Customer", "1,200 Customers". */
export const countOf = (meta: Pick<EntityMeta, "label" | "label_plural">, n: number) => `${n.toLocaleString()} ${n === 1 ? meta.label : meta.label_plural}`;

/** Messages for an operation on `what` (e.g. "12 Customers"): while running, and once done. */
export function describeOp(op: BulkOp): { running: (what: string) => string; done: (what: string) => string } {
  const plain = (ing: string, ed: string) => ({ running: (w: string) => `${ing} ${w}…`, done: (w: string) => `${w} ${ed}` });
  switch (op.op) {
    case "update":
      return plain("Updating", "updated");
    case "delete":
      return plain("Deleting", "deleted");
    case "submit":
      return plain("Submitting", "submitted");
    case "cancel":
      return plain("Cancelling", "cancelled");
    case "assign":
      return plain("Assigning", "assigned");
    case "add_tags":
      return plain("Tagging", "tagged");
    case "remove_tags":
      return plain("Removing tags from", "untagged");
    case "workflow":
      return { running: (w) => `Applying “${op.action}” to ${w}…`, done: (w) => `“${op.action}” applied to ${w}` };
  }
}

/** One record's failure as a sentence: field errors (with labels) when there are some. */
export function rowErrorText(meta: EntityMeta, e: BulkRowError | undefined): string {
  if (!e) return "Failed.";
  const fields = (e.fields ?? []).map((f) => `${fieldLabel(meta, f.field)}: ${f.message}`);
  const text = fields.length ? fields.join("; ") : e.message;
  return e.error_id ? `${text} (reference ${e.error_id})` : text;
}

export function chunk<T>(xs: T[], size = MAX_BULK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export function mergeResults(parts: BulkResponse[]): BulkResponse {
  const results = parts.flatMap((p) => p.results);
  const failed = results.filter((r) => !r.ok).length;
  return { succeeded: results.length - failed, failed, results };
}

/** What to retry: the records that failed, and those a failed request never reached. */
export function retryIds(ids: string[], result: BulkResponse): string[] {
  const done = new Map(result.results.map((r) => [String(r.id), r.ok]));
  return ids.filter((id) => done.get(id) !== true);
}

/** Tags typed as text: split at commas, trimmed, inner spaces collapsed, repeats (any case) dropped. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const t = raw.trim().replace(/\s+/g, " ").slice(0, 60);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}
