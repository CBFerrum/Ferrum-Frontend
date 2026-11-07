// The interface's language (FERRUM-UX-006): which catalog its words come from, which way its pages
// read, and the locale numbers and dates are written in. English is the source and the key: a word
// without a translation stays English, so a catalog can be partial. Each language's catalog
// (src/locales) is a file of its own, fetched only for a page in that language: it holds every word
// of the interface, too many to send to everyone. A page is drawn once wordsReady() settles
// (@ferrum/client starts the fetch as the page starts). An app's own words come in with addCatalogs
// (or addCatalog).

import { setFormatLocale } from "./format";

export type Direction = "ltr" | "rtl";

type Loader = () => Promise<{ default: Record<string, string> }>;
const LOADERS: Record<string, Loader> = { ar: () => import("../locales/ar"), hi: () => import("../locales/hi") };
const CATALOGS: Record<string, Record<string, string>> = {};

/** The interface's own words in a language, fetched once (nothing for English, the source). */
export async function builtInWords(tag: string): Promise<Record<string, string>> {
  const base = baseLanguage(tag);
  if (!CATALOGS[base] && LOADERS[base]) CATALOGS[base] = (await LOADERS[base]()).default;
  return CATALOGS[base] ?? {};
}

/** Every word the interface asks for: each catalog holds them all (a test keeps it so). */
export async function interfaceWords(): Promise<string[]> {
  return Object.keys(await builtInWords("ar")).sort((a, b) => a.localeCompare(b));
}

/** An app's own catalogs, by language: each fetched when a page reads its language. */
const appLoaders: Record<string, Loader>[] = [];
let ready: Promise<void> = Promise.resolve();

/** The page's words in its language, fetched: what a page waits for before it is drawn. */
export function wordsReady(): Promise<void> {
  return ready;
}

/** Fetches what the page's language needs that it does not have yet. */
function load(loaders: Record<string, Loader>[] = appLoaders): Promise<void> {
  const base = baseLanguage(language);
  const fetches = [
    ...(LOADERS[base] && !CATALOGS[base] ? [builtInWords(base).then(() => undefined)] : []),
    ...loaders.map((l) => l[base]).filter((l): l is Loader => !!l).map((l) => l().then((m) => addCatalog(base, m.default))),
  ];
  if (!fetches.length) return ready;
  // A catalog that cannot be fetched leaves its words in English.
  ready = Promise.all([ready, ...fetches]).then(merge, merge);
  return ready;
}

/**
 * An app's own words, a loader for each language's (`{ ar: () => import("./locales/ar.json") }`):
 * the page's language is fetched now, another when the page switches to it. The app is drawn once
 * wordsReady() settles, which waits for these too.
 */
export function addCatalogs(loaders: Record<string, Loader>): Promise<void> {
  appLoaders.push(loaders);
  return load([loaders]);
}

/** The languages the interface offers, by their own names. */
export const LANGUAGES: { tag: string; name: string }[] = [
  { tag: "en", name: "English" },
  { tag: "hi", name: "हिन्दी" },
  { tag: "ar", name: "العربية" },
];

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
  void load();
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
