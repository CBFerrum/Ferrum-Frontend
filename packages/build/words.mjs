// The words an app's own interface asks for, as the kit's t() is given them (`t("…")`, or `tr("…")`
// where a file has a t of its own): written to dist/words.json by the build, so a workspace's
// administrators can put them in their language (Admin, Interface words).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CALL = /\b(?:t|tr)\(\s*"((?:[^"\\\n]|\\.)*)"/g;

/** The words in `dir`'s TypeScript sources (tests aside), each once, sorted. */
export function wordsOf(dir) {
  const out = new Set();
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        for (const m of readFileSync(p, "utf8").matchAll(CALL)) out.add(JSON.parse(`"${m[1]}"`));
      }
    }
  };
  walk(dir);
  return [...out].sort();
}

const places = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/**
 * What is wrong with the app's own catalogs (`src/locales/<language>.json`, English → its words):
 * a word its sources no longer give t(), a translation that is not text, or one whose `{places}`
 * are not the English's. None when it has no catalogs.
 */
export function catalogIssues(src) {
  const dir = join(src, "locales");
  if (!existsSync(dir)) return [];
  const words = new Set(wordsOf(src));
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    let catalog;
    try {
      catalog = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (e) {
      out.push(`locales/${name}: not JSON (${e.message})`);
      continue;
    }
    for (const [english, words_] of Object.entries(catalog)) {
      if (!words.has(english)) out.push(`locales/${name}: "${english}" is not a word its pages ask for`);
      else if (typeof words_ !== "string" || !words_.trim()) out.push(`locales/${name}: "${english}" has no words`);
      else if (places(words_) !== places(english)) out.push(`locales/${name}: "${english}" keeps other places than {${places(english)}}`);
    }
  }
  return out;
}

/**
 * What is wrong with the app's names (`src/locales/names/<language>.json`: the names its model and
 * manifest give pages, English → the language's): a file that is not an object of text, a name
 * with no words, or one whose `{places}` are not the English's.
 */
export function namesIssues(src) {
  const dir = join(src, "locales", "names");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    let names;
    try {
      names = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (e) {
      out.push(`locales/names/${name}: not JSON (${e.message})`);
      continue;
    }
    if (!names || typeof names !== "object" || Array.isArray(names)) {
      out.push(`locales/names/${name}: not an object of names`);
      continue;
    }
    for (const [english, words] of Object.entries(names)) {
      if (typeof words !== "string" || !words.trim()) out.push(`locales/names/${name}: "${english}" has no words`);
      else if (places(words) !== places(english)) out.push(`locales/names/${name}: "${english}" keeps other places than {${places(english)}}`);
    }
  }
  return out;
}
