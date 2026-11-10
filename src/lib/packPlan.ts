// Packs (docs: GET /api/admin/pack, POST /api/admin/pack/plan and /install): reading a chosen file into a
// pack or a refusal, and turning the server's plan and result into the lists the page shows.

import { t } from "./i18n";

export const PACK_FORMAT = "ferrum.pack/1";
export const MAX_PACK_BYTES = 5 * 1024 * 1024;

export type Pack = Record<string, unknown> & { format: string };
export type ReadPack = { pack: Pack; refusal?: undefined } | { pack?: undefined; refusal: string };

/** A chosen file's text as a pack, or why the page refuses it. `size` is the file's size in bytes, checked first. */
export function readPack(text: string, size: number = text.length): ReadPack {
  if (size > MAX_PACK_BYTES) return { refusal: t("That file is larger than 5 MiB, more than a pack can be.") };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { refusal: t("That file is not JSON.") };
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as Pack).format !== PACK_FORMAT) {
    return { refusal: t("That file is not a Ferrum pack: its format is not {format}.", { format: PACK_FORMAT }) };
  }
  return { pack: value as Pack };
}

/** `<name>.pack.json`, the name kept to the letters, digits and dashes a pack's name has. */
export function packFileName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "workspace"}.pack.json`;
}

/** The sections a pack has, in the order they are shown; any other the server adds follows. */
const SECTIONS: [string, () => string][] = [
  ["customizations", () => t("Customizations")],
  ["roles", () => t("Roles")],
  ["automations", () => t("Automations")],
  ["studio", () => t("Studio items")],
  ["records", () => t("Reference records")],
  ["solutions", () => t("Solutions")],
];

export interface SectionLists {
  key: string;
  label: string;
  created: string[];
  changed: string[];
  unchanged: string[];
}

const words = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : []);
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const titled = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");

/** `sections` of a plan, or `summary` of an install, as lists: the known sections first, then any other, none dropped. */
export function sectionLists(sections: unknown): SectionLists[] {
  const s = record(sections);
  const known = new Map(SECTIONS);
  const keys = [...SECTIONS.map(([k]) => k).filter((k) => k in s), ...Object.keys(s).filter((k) => !known.has(k))];
  return keys.map((key) => {
    const x = record(s[key]);
    return { key, label: known.has(key) ? (known.get(key) as () => string)() : titled(key), created: words(x.created), changed: words(x.changed), unchanged: words(x.unchanged) };
  });
}

export interface PlanView {
  name: string;
  label: string;
  version: number | null;
  digest: string;
  canInstall: boolean;
  needs: [string, string][];
  missing: string[];
  sections: SectionLists[];
  warnings: string[];
}

/** POST /api/admin/pack/plan's answer as the page shows it. */
export function describePlan(plan: unknown): PlanView {
  const p = record(plan);
  const requires = record(record(p.requires).packages);
  const version = Number(p.version);
  return {
    name: String(p.name ?? ""),
    label: String(p.label ?? ""),
    version: Number.isFinite(version) ? version : null,
    digest: typeof p.digest === "string" ? p.digest : "",
    canInstall: p.can_install === true && typeof p.digest === "string" && p.digest !== "",
    needs: Object.entries(requires).map(([k, v]) => [k, String(v)]),
    missing: words(p.missing),
    sections: sectionLists(p.sections),
    warnings: words(p.warnings),
  };
}

export interface ResultView {
  name: string;
  version: number | null;
  sections: SectionLists[];
  failed: { solution: string; error: string }[];
  /** A solution arrived as a draft: Studio's solutions is where it is kept, reviewed and activated. */
  draft: boolean;
  /** Something was made or changed in the workspace's entities. */
  touched: boolean;
}

/** POST /api/admin/pack/install's answer as the page shows it. */
export function describeResult(result: unknown): ResultView {
  const r = record(result);
  const sections = sectionLists(r.summary);
  const version = Number(r.version);
  return {
    name: String(r.name ?? ""),
    version: Number.isFinite(version) ? version : null,
    sections,
    failed: (Array.isArray(r.failed) ? r.failed : []).map((f) => ({ solution: String(record(f).solution ?? ""), error: String(record(f).error ?? "") })),
    draft: sections.some((s) => s.key === "solutions" && s.created.length > 0),
    touched: sections.some((s) => s.key === "customizations" && s.created.length + s.changed.length > 0),
  };
}

/** The entities whose records may travel as reference data: the workspace's own lists, not documents to submit. */
export const travellers = <E extends { kind: string; submittable: boolean; custom?: boolean }>(entities: E[]): E[] =>
  entities.filter((e) => e.custom && e.kind === "master" && !e.submittable);
