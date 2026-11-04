// The interface's language (FERRUM-UX-006): which catalog its words come from, which way its pages
// read, and the locale numbers and dates are written in. English is the source and the key: a word
// without a translation stays English, so a catalog can be partial. Catalogs are small and bundled
// (src/locales); an app's own words may come in with addCatalog.

import { setFormatLocale } from "./format";
import ar from "../locales/ar";
import hi from "../locales/hi";

export type Direction = "ltr" | "rtl";

/** The languages the interface offers, by their own names. */
export const LANGUAGES: { tag: string; name: string }[] = [
  { tag: "en", name: "English" },
  { tag: "hi", name: "हिन्दी" },
  { tag: "ar", name: "العربية" },
];

const CATALOGS: Record<string, Record<string, string>> = { ar, hi };

/** Scripts written right to left, by the language subtag. */
const RTL = new Set(["ar", "arc", "ckb", "dv", "fa", "he", "ks", "ps", "sd", "ug", "ur", "yi"]);

/** `pt-BR` → `pt`. */
export const baseLanguage = (tag: string) => tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";

export function direction(tag: string): Direction {
  return RTL.has(baseLanguage(tag)) ? "rtl" : "ltr";
}

let language = "en";
let catalog: Record<string, string> = {};

/** The language words are looked up in. */
export function currentLanguage(): string {
  return language;
}

export function setLanguage(tag: string | undefined | null): void {
  language = tag?.trim() || "en";
  catalog = { ...(CATALOGS[baseLanguage(language)] ?? {}), ...(extra.get(baseLanguage(language)) ?? {}) };
}

const extra = new Map<string, Record<string, string>>();

/** An app's own words in a language (merged over the interface's). */
export function addCatalog(tag: string, words: Record<string, string>): void {
  const base = baseLanguage(tag);
  extra.set(base, { ...(extra.get(base) ?? {}), ...words });
  if (base === baseLanguage(language)) catalog = { ...catalog, ...words };
}

/** A word or sentence in the interface's language, with `{name}` filled in from `vars`. */
export function t(english: string, vars?: Record<string, string | number>): string {
  const text = catalog[english] ?? english;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/**
 * What a page does with the bootstrap's locale: its words and direction, the document's `lang`, and
 * numbers and dates written in that locale when the person or the workspace chose it (otherwise
 * they keep the browser's).
 */
export function applyLocale(
  locale: { language?: string; dir?: Direction; chosen?: boolean } | null | undefined,
  doc: Document | undefined = globalThis.document,
): void {
  const tag = locale?.language || "en";
  setLanguage(tag);
  setFormatLocale(locale?.chosen ? tag : undefined);
  if (!doc?.documentElement) return;
  doc.documentElement.lang = tag;
  doc.documentElement.dir = locale?.dir ?? direction(tag);
}
