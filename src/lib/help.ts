// The help center's search: every record type the viewer may read, found by its names, its module
// and what it says it is for. Words, not meaning: each word of the query must appear somewhere.

import type { EntitySummary, MetaIndex, Module } from "./meta";

export interface HelpTopic {
  entity: EntitySummary;
  module?: Module;
}

/** The record types the viewer may read (child tables are explained with their records). */
export function topics(meta: MetaIndex): HelpTopic[] {
  const moduleOf = new Map<string, Module>();
  for (const m of [...meta.modules].sort((a, b) => a.order - b.order)) {
    for (const item of m.items) if (!moduleOf.has(item)) moduleOf.set(item, m);
  }
  return meta.entities
    .filter((e) => e.permissions.read !== "none" && e.kind !== "child")
    .map((entity) => ({ entity, module: moduleOf.get(entity.name) }))
    .sort((a, b) => (a.module?.order ?? 999) - (b.module?.order ?? 999) || a.entity.label.localeCompare(b.entity.label));
}

/** Topics matching every word of `query`, those that name it first; all of them for an empty query. */
export function search(all: HelpTopic[], query: string): HelpTopic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return all;
  const scored = all.flatMap((t) => {
    const name = `${t.entity.label} ${t.entity.label_plural} ${t.entity.name}`.toLowerCase();
    const text = `${name} ${t.module?.label ?? ""} ${t.entity.description ?? ""}`.toLowerCase();
    if (!words.every((w) => text.includes(w))) return [];
    return [{ t, score: words.filter((w) => name.includes(w)).length }];
  });
  return scored.sort((a, b) => b.score - a.score).map((x) => x.t);
}

/** "a" or "an", as the word after it is spoken. */
export const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** What a field of each type takes, in words a person uses. */
const TAKES: Record<string, string> = {
  data: "a line of text", text: "text", markdown: "formatted text", code: "code", int: "a whole number", decimal: "a number",
  currency: "an amount", percent: "a percentage", date: "a date", datetime: "a date and time", check: "yes or no", json: "structured data",
  email: "an e-mail address", phone: "a phone number", url: "a web address", attach: "a file", color: "a colour", secret: "a secret, not shown again",
};
export const takes = (type: string) => TAKES[type] ?? type;

/** A record type in a sentence, by its label ("an appointment type"), else its name in words. */
export function recordKind(name: string, label?: string): string {
  const words = (label ?? name.replace(/([a-z0-9])([A-Z])/g, "$1 $2")).toLowerCase();
  return `${article(words)} ${words}`;
}

