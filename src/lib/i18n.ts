// The interface's language (FERRUM-UX-006): which catalog its words come from, which way its pages
// read, and the locale numbers and dates are written in. English is the source and the key: a word
// without a translation stays English, so a catalog can be partial. Each language's catalog
// (src/locales) is a file of its own, fetched only for a page in that language: it holds every word
// of the interface, too many to send to everyone. A page is drawn once wordsReady() settles
// (@ferrum/client starts the fetch as the page starts). An app's own words come in with addCatalogs
// (or addCatalog). The names apps give their models and manifests (a record's, a field's, an
// option's, an action's, an app's own) come from the server for the page's language
// (`locale.names`, /api/shell/names): text a page shows as it is is shown in them where they have
// it, and so is a name a sentence's {place} is filled with.

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

/** The names of the workspace's models and manifests, by language, once fetched. */
const NAMES: Record<string, Record<string, string>> = {};
/** Where the page's language's names are (the bootstrap's `locale.names`), none for English. */
let namesUrl: string | null = null;
const namesAsked = new Set<string>();

/** How the names are fetched: the client's own request (its token, its sign-in again) once it
 *  has said so (`namesFrom`), else a plain same-origin fetch. */
let getNames: (url: string) => Promise<unknown> = (url) =>
  fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : {}));

export function namesFrom(fetcher: (url: string) => Promise<unknown>): void {
  getNames = fetcher;
}

function fetchNames(base: string, url: string): Promise<void> {
  namesAsked.add(url);
  return getNames(url)
    .catch(() => ({}))
    .then((words: unknown) => {
      if (words && typeof words === "object") NAMES[base] = { ...(NAMES[base] ?? {}), ...(words as Record<string, string>) };
    });
}

/** Fetches what the page's language needs that it does not have yet. */
function load(loaders: Record<string, Loader>[] = appLoaders): Promise<void> {
  const base = baseLanguage(language);
  const fetches = [
    ...(LOADERS[base] && !CATALOGS[base] ? [builtInWords(base).then(() => undefined)] : []),
    ...(namesUrl && !namesAsked.has(namesUrl) && typeof fetch === "function" ? [fetchNames(base, namesUrl)] : []),
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
/** The page's language's names of models and manifests: under every catalog. */
let names: Record<string, string> = {};

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

/** A word of a list of words: its own entry only, so a record called "constructor" stays text. */
const own = (words: Record<string, string>, key: string): string | undefined => (Object.hasOwn(words, key) ? words[key] : undefined);
/** A name in the workspace's own words first, then the apps' names, then the interface's own words
 *  (a field the workspace called "Status" reads as the interface's "Status" does). */
const named = (text: string): string | undefined => own(workspace, text) ?? own(names, text) ?? own(catalog, text);

/** Every word by its English in lower case: a name a sentence was given in lower case ("No {value} yet" with
 *  "risk registers") is still found. The workspace's over the apps' names over the interface's. */
let lowered: Record<string, string> = {};

/** The interface's catalog, an app's own over it, and the workspace's words over both. */
function merge(): void {
  const base = baseLanguage(language);
  catalog = { ...(CATALOGS[base] ?? {}), ...(extra.get(base) ?? {}), ...workspace };
  names = base === "en" ? {} : (NAMES[base] ?? {});
  lowered = {};
  for (const words of [catalog, names, workspace]) for (const [english, word] of Object.entries(words)) lowered[english.toLowerCase()] = word;
}

/** Names of models and manifests in a language (what /api/shell/names sends; tests). */
export function addNames(tag: string, words: Record<string, string>): void {
  const base = baseLanguage(tag);
  NAMES[base] = { ...(NAMES[base] ?? {}), ...words };
  if (base === baseLanguage(language)) merge();
}

/** An app's own words in a language (merged over the interface's, under the workspace's). */
export function addCatalog(tag: string, words: Record<string, string>): void {
  const base = baseLanguage(tag);
  extra.set(base, { ...(extra.get(base) ?? {}), ...words });
  if (base === baseLanguage(language)) merge();
}

/**
 * A word or sentence in the interface's language, with `{name}` filled in from `vars`: a place
 * filled with the name of a record, field, option or action is filled with its name in the language.
 */
export function t(english: string, vars?: Record<string, string | number>): string {
  const known = own(catalog, english) ?? own(names, english);
  const text = known ?? english;
  const filled = vars
    ? text.replace(/\{(\w+)\}/g, (whole, key: string) => {
        if (!(key in vars)) return whole;
        const v = vars[key];
        return typeof v === "string" ? (named(v) ?? own(lowered, v.toLowerCase()) ?? v) : String(v);
      })
    : text;
  // English left in a page that reads right to left keeps its own order (a sentence's full stop
  // at its end), isolated as a run of its own (U+2068 … U+2069).
  return known !== undefined || direction(language) === "ltr" ? filled : `\u2068${filled}\u2069`;
}

/**
 * Text a page shows as it is (a name, a size, a count built in code), set apart in its own direction
 * on a page that reads right to left (U+2068 … U+2069), so its punctuation and numbers keep their
 * order. Elsewhere it is returned as it is. The name of a record, field, option, action or app
 * (one the workspace's apps give their models and manifests) is shown in the page's language.
 */
export function isolate(text: string): string;
export function isolate<T extends null | undefined>(text: string | T): string | T;
export function isolate(text: string | null | undefined): string | null | undefined {
  if (!text) return text;
  const known = named(text);
  if (known !== undefined) return known;
  return direction(language) === "rtl" ? `\u2068${text}\u2069` : text;
}

/**
 * What a page does with the bootstrap's locale: its words and direction, the document's `lang`, and
 * numbers and dates written in that locale when the person or the workspace chose it (otherwise
 * they keep the browser's).
 */
export function applyLocale(
  locale: { language?: string; dir?: Direction; chosen?: boolean; words?: Record<string, string>; names?: string | null } | null | undefined,
  doc: Document | undefined = globalThis.document,
): void {
  const tag = locale?.language || "en";
  // The workspace's own words in the language stand over every catalog, an app's own among them.
  workspace = locale?.words ?? {};
  // Where the names of the workspace's models and manifests are in that language.
  namesUrl = baseLanguage(tag) === "en" ? null : (locale?.names ?? null);
  setLanguage(tag);
  setFormatLocale(locale?.chosen ? tag : undefined, tag);
  if (!doc?.documentElement) return;
  doc.documentElement.lang = tag;
  doc.documentElement.dir = locale?.dir ?? direction(tag);
}
