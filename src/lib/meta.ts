// Metadata types (shape of /api/meta and /api/meta/{Entity}) and the hooks that load them.
// Everything the UI renders is derived from this: no per-entity code.

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { evaluate } from "./expr";
import { humanize, setDisplayZone, setTimeZone, shortId } from "./format";
import { t as tr } from "@ferrum/client";

export type FieldType =
  | "data" | "text" | "markdown" | "code" | "int" | "decimal" | "currency" | "percent" | "date" | "datetime"
  | "check" | "select" | "link" | "table" | "json" | "email" | "phone" | "url" | "attach" | "color" | "secret";

/** Flags the server sends as `false` are omitted, so absent means false (including can_read/can_write). */
export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  read_only?: boolean;
  hidden?: boolean;
  in_list?: boolean;
  in_filter?: boolean;
  locked?: boolean;
  no_copy?: boolean;
  options?: string[];
  to?: string;
  of?: string;
  precision?: number;
  currency?: string;
  min?: string;
  max?: string;
  max_length?: number;
  default?: unknown;
  default_expr?: string;
  computed?: string;
  /** A total the server keeps over the record's own lines; what is typed is ignored. */
  rollup?: { table: string; op: "sum" | "count"; field?: string };
  visible_if?: string;
  required_if?: string;
  read_only_if?: string;
  fetch_from?: string;
  description?: string;
  /** The service target that keeps this field (its due moment or its state): the platform writes it, as a total. */
  kept_by_target?: string;
  /** How a form edits it where its type alone does not say: `studio_query` for a JSON field holding a Studio query. */
  widget?: string;
  link_filters?: Record<string, unknown>;
  storage?: "column" | "ext";
  can_read?: boolean;
  can_write?: boolean;
}

export type Access = "none" | "own" | "all";
export type PermKey = "read" | "write" | "create" | "delete" | "submit" | "cancel" | "export" | "import";
/** What the person may do with an entity, and the actions rules name for them whatever the actions' own permission asks. */
export type Perms = Record<PermKey, Access> & { actions?: string[] };

export interface Section {
  label?: string | null;
  fields: string[];
  columns?: number | null;
  collapsible?: boolean;
}

export interface ActionDef {
  name: string;
  label: string;
  docstatus: number[];
  permission: string;
  confirm?: string | null;
  condition?: string | null;
  /** Only reads (a lookup, a download): the record does not change. */
  read_only?: boolean;
  /** What the action asks for first. */
  params?: ActionParam[];
  /** Actions of one group show under one menu. */
  group?: string | null;
  /** Called by code, never offered as a button. */
  hidden?: boolean;
  /** Whether the caller may press it at all (permission, rules and roles); absent from an older server. */
  may_run?: boolean;
  /** The roles that may press it (an administrator always may); none: whoever may edit the record. */
  roles?: string[];
  /** Refusals judged per record: the first `when` that holds refuses, with its `message`. */
  refuse_if?: { when: string; message: string }[];
  /** What a configured button does; sent to administrators only (a button without them is a package's own). */
  effects?: Record<string, unknown>[];
}

export interface ActionParam {
  name: string;
  label: string;
  type: "data" | "text" | "select" | "int" | "date" | "link";
  /** The entity a `link` parameter picks a record of. */
  to?: string;
  options?: string[];
  required?: boolean;
  description?: string | null;
}

export interface Workflow {
  name?: string;
  initial_state: string;
  /** `editable`: the only fields a person may change in the state; `required`: what it needs. */
  states: { name: string; docstatus: number; edit_roles: string[]; editable?: string[]; required?: string[] }[];
  transitions: { action: string; from: string; to: string; roles: string[]; may_take?: boolean; condition?: string | null; not_creator?: boolean; not_creator_of?: string[] }[];
}

export interface ChildTable {
  entity: string;
  label: string;
  fields: Field[];
  /** The tables of the line's own lines (lines within lines), by table field. */
  children?: Record<string, ChildTable>;
}

export interface LinkedFrom {
  entity: string;
  label: string;
  field: string;
  field_label: string;
}

export interface EntityMeta {
  name: string;
  label: string;
  label_plural: string;
  kind: "master" | "document" | "child" | "settings" | "ledger";
  module?: string | null;
  description?: string | null;
  package?: string | null;
  custom?: boolean;
  title_field?: string | null;
  submittable: boolean;
  /** Duplicates of this entity can be merged (`POST /{id}/merge`). */
  mergeable?: boolean;
  /** Lists that link to this entity and the viewer may read; `field` may name a row (`items.item`). */
  linked_from?: LinkedFrom[];
  company_scoped?: boolean;
  numbering?: { template: string; on?: string } | null;
  list: { columns: string[]; sort?: string | null };
  form: Section[];
  search_fields: string[];
  rules: { name: string; check: string; message: string; on: string }[];
  actions: ActionDef[];
  workflow?: Workflow | null;
  /** Service targets: "this must happen within so much working time". */
  targets?: { name: string; label: string; calendar?: string; start_when?: string; within: string; pause_when?: string; met_when: string; due_field: string; state_field: string }[];
  /** Lists published to anyone without signing in (administrators only). */
  published_lists?: { name: string; label: string; fields: string[]; csv?: boolean }[];
  fields: Field[];
  children: Record<string, ChildTable>;
  permissions: Perms;
}

export interface EntitySummary {
  name: string;
  label: string;
  label_plural: string;
  kind: EntityMeta["kind"];
  module?: string | null;
  /** What the record type is for (the server sends it from 0.3.x). */
  description?: string | null;
  submittable: boolean;
  custom?: boolean;
  /** The package that owns it (`tenant` for custom entities). */
  package?: string;
  permissions: Perms;
}

export interface Module {
  name: string;
  label: string;
  icon?: string | null;
  order: number;
  items: string[];
  /** The package that defines it (`tenant`: a workspace's own menu). */
  package?: string;
  /** A workspace's own menu: what its tile says, its colour, the entities offered in "+", the assistant's notes. */
  description?: string;
  color?: string;
  create?: string[];
  assistant?: { instructions: string; suggestions?: string[] };
}

export interface MetaIndex {
  version: number;
  packages: string[];
  modules: Module[];
  entities: EntitySummary[];
  warnings: unknown[];
}

export interface Me {
  tenant: string;
  user: { id: string; email: string; full_name: string; is_admin: boolean; roles: string[] };
  default_company: string | null;
  scopes: Record<string, unknown>;
  fiscal_year_start_month: number;
  /** IANA name of the workspace's time zone; dates such as `today` follow it. */
  timezone?: string;
  /** The zone times are shown in: the person's own, else the workspace's. */
  display_timezone?: string;
  packages: string[];
  /** Shapes B and C: the accounts host that keeps this person's password, two-step sign-in and
   *  passkeys (their workspace account joined their Ferrum account). */
  accounts?: string | null;
}

export interface ReportParam {
  name: string;
  label?: string;
  type: "link" | "date" | "select" | "check" | string;
  to?: string;
  options?: string[];
  required?: boolean;
  default?: unknown;
}

export interface ReportDef {
  name: string;
  label: string;
  module?: string;
  params: ReportParam[];
}

/** A record as the API returns it. Link titles ride along in `_titles`. */
export type Doc = Record<string, unknown> & {
  id?: string;
  version?: number;
  docstatus?: number;
  _titles?: Record<string, string>;
};

export interface ListResponse {
  rows: Doc[];
  next_cursor?: string | null;
  total?: number | null;
}

const LONG = 5 * 60_000;

/** What this server offers (`/api/version`): PDFs, upload limits, installed packages. */
export const useServerInfo = () =>
  useQuery({
    queryKey: ["version"],
    queryFn: ({ signal }) => api.get<{ version: string; pdf?: boolean; mail?: boolean; mail_attachments?: boolean; packages: { name: string; version: string }[] }>("/api/version", undefined, signal),
    staleTime: LONG,
  });

export const useMetaIndex = () =>
  useQuery({ queryKey: ["meta"], queryFn: ({ signal }) => api.get<MetaIndex>("/api/meta", undefined, signal), staleTime: LONG });

/** Looks up an entity's plural label ("Sales Invoices"); the name itself until the metadata has loaded. */
export function useEntityPlural() {
  const { data } = useMetaIndex();
  return (name: string) => data?.entities.find((e) => e.name === name)?.label_plural ?? name;
}

export const useEntityMeta = (name: string | undefined) =>
  useQuery({
    queryKey: ["meta", name],
    queryFn: ({ signal }) => api.get<EntityMeta>(`/api/meta/${encodeURIComponent(name ?? "")}`, undefined, signal),
    enabled: !!name,
    staleTime: LONG,
  });

export const useMe = () =>
  useQuery({
    queryKey: ["me"],
    queryFn: async ({ signal }) => {
      const me = await api.get<Me>("/api/auth/me", undefined, signal);
      setTimeZone(me.timezone); // `today` in defaults and conditions follows the workspace, like the server
      setDisplayZone(me.display_timezone); // times show on the person's own clock when they chose one
      return me;
    },
    staleTime: LONG,
  });

export const useReports = () =>
  useQuery({
    queryKey: ["reports"],
    queryFn: ({ signal }) => api.get<{ reports: ReportDef[] }>("/api/reports", undefined, signal),
    staleTime: LONG,
  });

/** Currency id → fraction digits, for formatting `currency` fields. */
export function useCurrencyPrecision(): (currencyId: unknown) => number | undefined {
  const index = useMetaIndex();
  const readable = index.data?.entities.some((e) => e.name === "Currency" && e.permissions.read !== "none") ?? false;
  const q = useQuery({
    queryKey: ["currency-precision"],
    queryFn: ({ signal }) =>
      api.get<ListResponse>("/api/v1/Currency", { fields: "id,precision", limit: 500 }, signal),
    enabled: readable,
    staleTime: LONG,
  });
  const map = new Map<string, number>();
  for (const r of q.data?.rows ?? []) if (typeof r.precision === "number") map.set(String(r.id), r.precision);
  return (id) => (typeof id === "string" ? map.get(id) : undefined);
}

export const SYSTEM_FIELD_LABELS: Record<string, string> = {
  id: "ID",
  get number() { return tr("Number"); },
  get docstatus() { return tr("Document Status"); },
  get version() { return tr("Version"); },
  get workflow_state() { return tr("Workflow State"); },
  get amended_from() { return tr("Amended From"); },
  get created_at() { return tr("Created"); },
  get created_by() { return tr("Created By"); },
  get updated_at() { return tr("Last Updated"); },
  get updated_by() { return tr("Updated By"); },
};

export const DOCSTATUS_LABEL = ["Draft", "Submitted", "Cancelled"] as const;

export const can = (p: Perms | undefined, key: PermKey) => !!p && p[key] !== "none";

/** Display title of a record: its title field, else its number, else a short id. */
export function recordTitle(meta: (Pick<EntityMeta, "title_field"> & Partial<Pick<EntityMeta, "kind" | "label" | "numbering">>) | undefined, row: Doc | undefined): string {
  if (!row) return "";
  // A link as the title shows the linked record's title, not its id.
  const t = meta?.title_field ? (row._titles?.[meta.title_field] ?? row[meta.title_field]) : undefined;
  if (t !== undefined && t !== null && t !== "") return String(t);
  if (row.number) return String(row.number);
  // Settings are named by what they are (one to a company at most), not by an id.
  if (meta?.kind === "settings" && meta.label) return meta.label;
  // A draft numbered when it is submitted has no number yet: it is a draft of its kind.
  if (meta?.numbering?.on === "submit" && meta.label && (row.docstatus ?? 0) === 0) return tr("Draft {label}", { label: meta.label });
  return shortId(row.id);
}

/** Settings are one record to a workspace (one to a company when company-scoped: those are listed). */
export const singleRecord = (meta: Pick<EntityMeta, "kind" | "company_scoped">) => meta.kind === "settings" && !meta.company_scoped;

export function fieldLabel(meta: EntityMeta, name: string): string {
  return meta.fields.find((f) => f.name === name)?.label ?? SYSTEM_FIELD_LABELS[name] ?? humanize(name);
}

export interface FieldState {
  visible: boolean;
  required: boolean;
  disabled: boolean;
}

export interface RuleScope {
  doc: Record<string, unknown>;
  parent?: Record<string, unknown> | null;
  user?: unknown;
}

/**
 * Visibility/required/read-only state of a field for the current document.
 * Unparseable conditions resolve permissively (shown, not required, editable): the server decides.
 */
export function fieldState(f: Field, scope: RuleScope, locked = false): FieldState {
  const visible = f.can_read === true && !f.hidden && (!f.visible_if || evaluate(f.visible_if, scope) !== false);
  const required = !!f.required || (!!f.required_if && evaluate(f.required_if, scope) === true);
  const disabled =
    locked ||
    !!f.read_only ||
    !!f.computed ||
    !!f.rollup ||
    !!f.kept_by_target ||
    f.can_write !== true ||
    (!!f.read_only_if && evaluate(f.read_only_if, scope) === true);
  return { visible, required, disabled };
}

/**
 * A field as the document's workflow state has it: read-only unless the state lets it change
 * (`editable`), required where the state needs it (`required`). The server holds to the same.
 */
export function inWorkflowState(f: Field, st: FieldState, state?: { editable?: string[]; required?: string[] }): FieldState {
  if (!state) return st;
  const frozen = !!state.editable?.length && !state.editable.includes(f.name);
  return { ...st, disabled: st.disabled || frozen, required: st.required || !!state.required?.includes(f.name) };
}

/** Whether a field's value is maintained by the server (it never needs to be sent). */
export function isServerManaged(f: Field): boolean {
  return !!f.read_only || !!f.computed || !!f.rollup || !!f.kept_by_target || f.can_write !== true;
}

export function userScope(me: Me | undefined): Record<string, unknown> | null {
  if (!me) return null;
  return { id: me.user.id, email: me.user.email, roles: me.user.roles, default_company: me.default_company };
}
