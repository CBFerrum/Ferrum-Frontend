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
