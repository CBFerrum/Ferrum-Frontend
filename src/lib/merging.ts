// Merging two records: the fields a person decides on and what is written on the record that stays.
// The server moves the links; these are the values. Pure, so it is tested without a browser.

import type { Doc, Field } from "./meta";

export type Pick = "keep" | "other";

const blank = (v: unknown) => v === null || v === undefined || v === "";

/** Fields where the two records differ and the viewer could change what stays. */
export function differing(fields: Field[], a: Doc, b: Doc): Field[] {
  return fields.filter(
    (f) => f.can_read === true && f.can_write === true && !f.hidden && !f.read_only && f.type !== "table" && f.type !== "secret" && (blank(a[f.name]) !== blank(b[f.name]) || (!blank(a[f.name]) && String(a[f.name]) !== String(b[f.name]))),
  );
}

/** Starts from the record that stays, taking the other's value only where it has none. */
export function defaultPicks(fields: Field[], keep: Doc): Record<string, Pick> {
  return Object.fromEntries(fields.map((f) => [f.name, blank(keep[f.name]) ? "other" : "keep"]));
}

/** What to write on the record that stays as it absorbs the other. */
export function mergedValues(fields: Field[], other: Doc, picks: Record<string, Pick>): Record<string, unknown> {
  return Object.fromEntries(fields.filter((f) => picks[f.name] === "other").map((f) => [f.name, other[f.name] ?? null]));
}

/** The one request a merge is: the values taken from the other record go with it, with the version of
 * the record that stays they were chosen against, so the server writes them in the merge's own
 * transaction. A merge that fails leaves none of them; one chosen against an older version merges nothing. */
export function mergeRequest(fields: Field[], keep: Doc, other: Doc, picks: Record<string, Pick>, reason: string) {
  const values = mergedValues(fields, other, picks);
  return { duplicate: String(other.id), reason: reason.trim(), ...(Object.keys(values).length ? { values, version: keep.version } : {}) };
}
