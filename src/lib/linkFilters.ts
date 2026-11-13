// A field's `link_filters` (the metadata): each key is a field of the linked record, each value either a literal the
// record's field must equal, or `{ "from": "<field>" }` / `{ "from": "parent.<field>" }`: it must equal the value of that
// field on the record in the form (the parent's, for `parent.`, inside a child table's row).

import type { Doc } from "./meta";

/** The form a picker sits in: the record being edited, and the parent record when it is a child table's row. */
export interface LinkScope {
  doc: Doc;
  parent?: Doc;
  /** Label of a field of the form (`parent.x` for the parent's), for the hint; the field's name when unknown. */
  labelOf?: (path: string) => string | undefined;
}

export const isFrom = (v: unknown): v is { from: string } => !!v && typeof v === "object" && typeof (v as { from?: unknown }).from === "string";

const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

/** The value of the form's field that a `from` names. */
export function sourceValue(from: string, scope: LinkScope): unknown {
  return from.startsWith("parent.") ? scope.parent?.[from.slice(7)] : scope.doc[from];
}

export interface ResolvedFilters {
  /** What goes to the server: literals as they are, each `from` with a value as an equality on that value. */
  applied: Record<string, unknown>;
  /** Each `from` whose source is empty (not applied): the field of the linked record and the form field to choose first. */
  waiting: { key: string; from: string; label: string }[];
  /** Each applied `from`: the linked record's field and the value it must have (what a chosen link is checked against). */
  required: Record<string, unknown>;
}

export function resolveLinkFilters(filters: Record<string, unknown> | undefined, scope: LinkScope | undefined): ResolvedFilters {
  const out: ResolvedFilters = { applied: {}, waiting: [], required: {} };
  for (const [key, v] of Object.entries(filters ?? {})) {
    if (!isFrom(v)) {
      out.applied[key] = v;
    } else if (scope) {
      const val = sourceValue(v.from, scope);
      if (empty(val)) out.waiting.push({ key, from: v.from, label: scope.labelOf?.(v.from) ?? v.from.replace(/^parent\./, "") });
      else {
        out.applied[key] = val;
        out.required[key] = val;
      }
    }
  }
  return out;
}

/** The linked record's fields some `from` filter compares (the company, here): shown under each choice to tell same names apart. */
export const comparedFields = (filters: Record<string, unknown> | undefined): string[] => Object.entries(filters ?? {}).filter(([, v]) => isFrom(v)).map(([k]) => k);
