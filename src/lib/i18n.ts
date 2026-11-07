// The interface's language (FERRUM-UX-006): which catalog its words come from, which way its pages
// read, and the locale numbers and dates are written in. English is the source and the key: a word
// without a translation stays English, so a catalog can be partial. Catalogs are small and bundled
// (src/locales); an app's own words may come in with addCatalog.

import { setFormatLocale } from "./format";
import ar from "../locales/ar";
import hi from "../locales/hi";

export type Direction = "ltr" | "rtl";

/** The interface's own words in a language (its catalog; nothing for English, the source). */
export function builtInWords(tag: string): Record<string, string> {
  return CATALOGS[baseLanguage(tag)] ?? {};
}

/** Every word the interface asks for: each catalog holds them all (a test keeps it so). */
export function interfaceWords(): string[] {
  return Object.keys(CATALOGS.ar).sort((a, b) => a.localeCompare(b));
}

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

/**
 * The step an arrow key takes along the line, as the element reads: 1 on (Right, or Left right
 * to left), -1 back, null for any other key.
 */
export function arrowStep(e: { key: string; currentTarget: Element }): 1 | -1 | null {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return null;
  const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
  return e.key === "ArrowRight" !== rtl ? 1 : -1;
}

let language = "en";
let catalog: Record<string, string> = {};

/** The language words are looked up in. */
export function currentLanguage(): string {
  return language;
}

export function setLanguage(tag: string | undefined | null): void {
  language = tag?.trim() || "en";
  merge();
}

const extra = new Map<string, Record<string, string>>();
/** The workspace's own words in the page's language (its InterfaceWord records): over every catalog. */
let workspace: Record<string, string> = {};

/** The interface's catalog, an app's own over it, and the workspace's words over both. */
function merge(): void {
  const base = baseLanguage(language);
  catalog = { ...(CATALOGS[base] ?? {}), ...(extra.get(base) ?? {}), ...workspace };
}

/** An app's own words in a language (merged over the interface's, under the workspace's). */
export function addCatalog(tag: string, words: Record<string, string>): void {
  const base = baseLanguage(tag);
  extra.set(base, { ...(extra.get(base) ?? {}), ...words });
  if (base === baseLanguage(language)) merge();
}

/** A word or sentence in the interface's language, with `{name}` filled in from `vars`. */
export function t(english: string, vars?: Record<string, string | number>): string {
  const text = catalog[english] ?? english;
  const filled = vars ? text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole)) : text;
  // English left in a page that reads right to left keeps its own order (a sentence's full stop
  // at its end), isolated as a run of its own (U+2068 … U+2069).
  return english in catalog || direction(language) === "ltr" ? filled : `\u2068${filled}\u2069`;
}

/**
 * Text a page shows as it is (a name, a size, a count built in code), set apart in its own direction
 * on a page that reads right to left (U+2068 … U+2069), so its punctuation and numbers keep their
 * order. Elsewhere it is returned as it is.
 */
export function isolate(text: string): string {
  return direction(language) === "rtl" && text ? `\u2068${text}\u2069` : text;
}

/**
 * What a page does with the bootstrap's locale: its words and direction, the document's `lang`, and
 * numbers and dates written in that locale when the person or the workspace chose it (otherwise
 * they keep the browser's).
 */
export function applyLocale(
  locale: { language?: string; dir?: Direction; chosen?: boolean; words?: Record<string, string> } | null | undefined,
  doc: Document | undefined = globalThis.document,
): void {
  const tag = locale?.language || "en";
  // The workspace's own words in the language stand over every catalog, an app's own among them.
  workspace = locale?.words ?? {};
  setLanguage(tag);
  setFormatLocale(locale?.chosen ? tag : undefined);
  if (!doc?.documentElement) return;
  doc.documentElement.lang = tag;
  doc.documentElement.dir = locale?.dir ?? direction(tag);
}
