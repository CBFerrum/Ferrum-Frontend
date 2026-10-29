// Dashboard filters. The values a viewer picks live in the URL (`f.<name>=value`, date ranges as
// `from..to`, checks as 1/0) so a filtered dashboard can be bookmarked and shared; the server
// fills in each filter's default and applies the values to every widget that accepts them.

import type { FilterDef, FilterType, FilterValues, Issue } from "@/lib/studio";

const PREFIX = "f.";

export interface Range {
  from?: string;
  to?: string;
}

export const FILTER_TYPE_LABEL: Record<FilterType, string> = {
  link: "Record",
  select: "Choice",
  data: "Text",
  check: "Yes / no",
  date: "Date",
  date_range: "Date range",
};

/** `{from, to}` from any value (blank ends dropped); null when neither end is set. */
export function asRange(v: unknown): Range | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const end = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
  const from = end(r.from);
  const to = end(r.to);
  return from || to ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : null;
}

/** The values chosen in the URL, typed per filter (unknown names and blank values are skipped). */
export function readValues(sp: URLSearchParams, defs: readonly FilterDef[]): FilterValues {
  const out: FilterValues = {};
  for (const d of defs) {
    const raw = sp.get(PREFIX + d.name)?.trim();
    if (!raw) continue;
    if (d.type === "date_range") {
      const [from = "", to = ""] = raw.split("..");
      const r = asRange({ from, to });
      if (r) out[d.name] = r;
    } else if (d.type === "check") {
      if (raw === "1" || raw === "0") out[d.name] = raw === "1";
    } else out[d.name] = raw;
  }
  return out;
}

/** `sp` with the filter parameters replaced by `values` (other parameters kept). */
export function writeValues(sp: URLSearchParams, defs: readonly FilterDef[], values: FilterValues): URLSearchParams {
  const next = new URLSearchParams();
  sp.forEach((v, k) => {
    if (!k.startsWith(PREFIX)) next.append(k, v);
  });
  for (const d of defs) {
    const v = values[d.name];
    if (d.type === "date_range") {
      const r = asRange(v);
      if (r) next.set(PREFIX + d.name, `${r.from ?? ""}..${r.to ?? ""}`);
    } else if (typeof v === "boolean") next.set(PREFIX + d.name, v ? "1" : "0");
    else if (typeof v === "string" && v.trim()) next.set(PREFIX + d.name, v.trim());
  }
  return next;
}

/** Whether the URL chooses any filter value (else every filter shows its default). */
export const choosesValues = (sp: URLSearchParams, defs: readonly FilterDef[]) => Object.keys(readValues(sp, defs)).length > 0;

const IDENT = /^[a-z][a-z0-9_]{0,62}$/;

/** A filter name from its label: a lower-case identifier not yet used on the dashboard. */
export function filterName(label: string, taken: readonly string[]): string {
  let base = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents off: É → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  if (!base) base = "filter";
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}_${n}`;
  return name;
}

/** What the server would refuse in a dashboard's filter definitions (paths `filters[n].…`). */
export function filterDefIssues(defs: readonly FilterDef[]): Issue[] {
  const out: Issue[] = [];
  if (defs.length > 20) out.push({ path: "filters", message: "A dashboard has at most 20 filters" });
  const seen = new Set<string>();
  defs.forEach((d, n) => {
    const at = `filters[${n}]`;
    if (!IDENT.test(d.name)) out.push({ path: `${at}.name`, message: "Use a lower-case name such as company or period" });
    else if (seen.has(d.name)) out.push({ path: `${at}.name`, message: `“${d.name}” is used twice` });
    seen.add(d.name);
    if (d.type === "link" && !d.to) out.push({ path: `${at}.to`, message: "Choose what it links to" });
    if (d.type === "select" && !d.options?.length) out.push({ path: `${at}.options`, message: "List the choices" });
  });
  return out;
}

/** A definition as the server stores it: blank optional parts left out, settings that do not apply dropped. */
export function cleanFilterDef(d: FilterDef): FilterDef {
  const label = d.label?.trim();
  const field = d.field?.trim();
  const options = d.options?.map((o) => o.trim()).filter(Boolean) ?? [];
  const def = d.type === "date_range" ? asRange(d.default) : typeof d.default === "string" ? d.default.trim() || null : typeof d.default === "boolean" ? d.default : null;
  return {
    name: d.name.trim(),
    type: d.type,
    ...(label ? { label } : {}),
    ...(d.type === "link" && d.to ? { to: d.to } : {}),
    ...(d.type === "select" ? { options } : {}),
    ...(def !== null ? { default: def } : {}),
    ...(field ? { field } : {}),
  };
}
