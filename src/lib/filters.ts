// List filters. UI state lives in the URL (`f.<field>=value`; date ranges as `from..to`) so
// filtered lists can be bookmarked and shared; it is serialized to the API's `filters` JSON
// (`[["field", "op", value], ...]`).

import { isDecimalString } from "./format";

export interface FilterField {
  name: string;
  type: string;
}
export type FilterState = Record<string, string>;
export type ApiFilter = [string, string, unknown];

const PREFIX = "f.";

export function readFilters(sp: URLSearchParams): FilterState {
  const out: FilterState = {};
  sp.forEach((v, k) => {
    if (k.startsWith(PREFIX) && v !== "") out[k.slice(PREFIX.length)] = v;
  });
  return out;
}

/** Returns a copy of `sp` with the filter keys replaced by `state` (other params are kept). */
export function writeFilters(sp: URLSearchParams, state: FilterState): URLSearchParams {
  const next = new URLSearchParams();
  sp.forEach((v, k) => {
    if (!k.startsWith(PREFIX)) next.append(k, v);
  });
  for (const [k, v] of Object.entries(state)) if (v !== "") next.set(PREFIX + k, v);
  return next;
}

export function splitRange(raw: string | undefined): [string, string] {
  const [from = "", to = ""] = (raw ?? "").split("..");
  return [from, to];
}

export function joinRange(from: string, to: string): string {
  return from || to ? `${from}..${to}` : "";
}

export function toApiFilters(fields: FilterField[], state: FilterState): ApiFilter[] {
  const out: ApiFilter[] = [];
  for (const f of fields) {
    const raw = state[f.name]?.trim();
    if (!raw) continue;
    switch (f.type) {
      case "check":
        if (raw === "1" || raw === "0") out.push([f.name, "=", raw === "1"]);
        break;
      case "date":
      case "datetime": {
        const [from, to] = splitRange(raw);
        const dt = f.type === "datetime";
        if (from) out.push([f.name, ">=", dt ? `${from}T00:00:00.000Z` : from]);
        if (to) out.push([f.name, "<=", dt ? `${to}T23:59:59.999Z` : to]);
        break;
      }
      case "int":
        if (/^-?\d+$/.test(raw)) out.push([f.name, "=", Number(raw)]);
        break;
      case "decimal":
      case "currency":
      case "percent":
        if (isDecimalString(raw)) out.push([f.name, "=", raw]);
        break;
      case "select":
      case "link":
        out.push([f.name, "=", raw]);
        break;
      default:
        out.push([f.name, "like", `%${raw}%`]);
    }
  }
  return out;
}

/** The `filters` query parameter, or `undefined` when nothing is filtered. */
export function serializeFilters(fields: FilterField[], state: FilterState): string | undefined {
  const f = toApiFilters(fields, state);
  return f.length ? JSON.stringify(f) : undefined;
}
