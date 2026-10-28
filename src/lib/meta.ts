// Metadata types (shape of /api/meta and /api/meta/{Entity}) and the hooks that load them.
// Everything the UI renders is derived from this: no per-entity code.

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { evaluate } from "./expr";
import { humanize, setTimeZone, shortId } from "./format";

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
  visible_if?: string;
  required_if?: string;
  read_only_if?: string;
  fetch_from?: string;
  description?: string;
  link_filters?: Record<string, unknown>;
  storage?: "column" | "ext";
  can_read?: boolean;
  can_write?: boolean;
}

export type Access = "none" | "own" | "all";
export type PermKey = "read" | "write" | "create" | "delete" | "submit" | "cancel" | "export" | "import";
export type Perms = Record<PermKey, Access>;

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
}

export interface Workflow {
  name?: string;
  initial_state: string;
  states: { name: string; docstatus: number; edit_roles: string[] }[];
  transitions: { action: string; from: string; to: string; roles: string[]; condition?: string | null; not_creator?: boolean }[];
}

export interface ChildTable {
  entity: string;
  label: string;
  fields: Field[];
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
  company_scoped?: boolean;
  numbering?: { template: string; on?: string } | null;
  list: { columns: string[]; sort?: string | null };
  form: Section[];
  search_fields: string[];
  rules: { name: string; check: string; message: string; on: string }[];
  actions: ActionDef[];
  workflow?: Workflow | null;
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
  submittable: boolean;
  custom?: boolean;
  permissions: Perms;
}

export interface Module {
  name: string;
  label: string;
  icon?: string | null;
  order: number;
  items: string[];
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
  packages: string[];
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

export const useMetaIndex = () =>
  useQuery({ queryKey: ["meta"], queryFn: ({ signal }) => api.get<MetaIndex>("/api/meta", undefined, signal), staleTime: LONG });

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
  number: "Number",
  docstatus: "Document Status",
  version: "Version",
  workflow_state: "Workflow State",
  amended_from: "Amended From",
  created_at: "Created",
  created_by: "Created By",
  updated_at: "Last Updated",
  updated_by: "Updated By",
};

export const DOCSTATUS_LABEL = ["Draft", "Submitted", "Cancelled"] as const;

export const can = (p: Perms | undefined, key: PermKey) => !!p && p[key] !== "none";

/** Display title of a record: its title field, else its number, else a short id. */
export function recordTitle(meta: Pick<EntityMeta, "title_field"> | undefined, row: Doc | undefined): string {
  if (!row) return "";
  const t = meta?.title_field ? row[meta.title_field] : undefined;
  if (t !== undefined && t !== null && t !== "") return String(t);
  if (row.number) return String(row.number);
  return shortId(row.id);
}

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
    f.can_write !== true ||
    (!!f.read_only_if && evaluate(f.read_only_if, scope) === true);
  return { visible, required, disabled };
}

/** Whether a field's value is maintained by the server (it never needs to be sent). */
export function isServerManaged(f: Field): boolean {
  return !!f.read_only || !!f.computed || f.can_write !== true;
}

export function userScope(me: Me | undefined): Record<string, unknown> | null {
  if (!me) return null;
  return { id: me.user.id, email: me.user.email, roles: me.user.roles, default_company: me.default_company };
}
