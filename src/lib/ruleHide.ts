// A permission rule's `hide` (BD-40): the fields and child tables of its entity the rule neither shows nor accepts. The body
// the role editor sends for a rule (it carries `hide` and `shared` back, or a checkbox elsewhere in the row would take them away,
// as `PUT …/permissions` replaces the rule), the choices an entity offers, and the sentence that says what holders will not see.

import { t } from "@ferrum/client";

export interface Rule {
  entity: string;
  can_read: boolean;
  can_write: boolean;
  can_create: boolean;
  can_delete: boolean;
  can_submit: boolean;
  can_cancel: boolean;
  can_export: boolean;
  can_import: boolean;
  if_owner: boolean;
  read_groups: string[];
  write_groups: string[];
  match_rule?: Record<string, unknown> | null;
  via?: string | null;
  actions?: string[];
  shared?: string | null;
  hide?: string[];
  /** Whether its package still rewrites the row with each release; an edit here makes it the workspace's own. */
  packaged?: boolean;
}

/** What `PUT /api/admin/roles/{role}/permissions` takes for a rule, all of it. */
export function permissionBody(p: Rule, overrides: Partial<Pick<Rule, "hide">> = {}) {
  return {
    entity: p.entity,
    read: p.can_read,
    write: p.can_write,
    create: p.can_create,
    delete: p.can_delete,
    submit: p.can_submit,
    cancel: p.can_cancel,
    export: p.can_export,
    import: p.can_import,
    if_owner: p.if_owner,
    read_groups: p.read_groups ?? [],
    write_groups: p.write_groups ?? [],
    where: p.match_rule ?? undefined,
    via: p.via || undefined,
    actions: p.actions ?? [],
    ...(p.shared ? { shared: p.shared } : {}),
    hide: overrides.hide ?? p.hide ?? [],
  };
}

export interface HideChoice {
  name: string;
  label: string;
  /** A field of the entity, or one of its child tables. */
  kind: "field" | "table";
}

/** What a rule of an entity may be asked to hide: its fields and its child tables (a table is a field of type `table`, listed once). */
export function hideChoices(meta: { fields: { name: string; label: string; type: string }[]; children?: Record<string, unknown> }): HideChoice[] {
  const tables = new Set(Object.keys(meta.children ?? {}));
  return meta.fields
    .filter((f) => !["section", "column", "tab"].includes(f.type))
    .map((f) => ({ name: f.name, label: f.label, kind: tables.has(f.name) || f.type === "table" ? ("table" as const) : ("field" as const) }));
}

/** In plain words, what holders of the rule will not see. */
export function hideSentence(role: string, entityLabel: string, hide: string[], label: (name: string) => string): string {
  if (!hide.length) return t("Nothing is hidden by this rule.");
  return t("Holders of {role} will not see {names} on the {entity} records this rule reaches, and cannot change them. Another rule of theirs that reaches the same record and does not hide them shows them again.", {
    role,
    names: hide.map(label).join(", "),
    entity: entityLabel,
  });
}

/** Whether a rule follows its package or an administrator changed it. */
export const followsPackage = (p: Pick<Rule, "packaged">): boolean => p.packaged === true;
