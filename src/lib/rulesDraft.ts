// A solution's rules as the Rules tab edits them (Studio → Solutions → a draft → Rules). `rulesFromSource` and
// `rulesToSource` convert between the draft's `rules` (docs/logic/rules.md) and items whose rows have stable
// keys, so typing in a name does not remount what is typed in. What the editor does not know is kept: a key of
// a rule it has no place for travels in `extra`, and a rule it cannot represent (a lookup with a key of its own,
// a filter operator it has no row for) is a "raw" item, shown read-only and written back exactly as it was.
// `checkRules` says in plain words what would not work, before the compiler is asked; the compiler's own
// diagnostics are placed on the part they name with `rulePart`.

import { t as tr } from "@ferrum/client";
import { FILTER_OPS, MAX_FILTERS, newFilter, type FilterRow, type Row } from "./automationDraft";
import { isDecimalString } from "./format";
import type { Field } from "./meta";

export { MAX_FILTERS };
/** The bounds of crates/logic/src/rules.rs. */
export const MAX_LOOKUPS = 4;
export const MAX_LOOKUP_FIELDS = 16;
export const MAX_AGGREGATES = 4;
export const MAX_READS_PER_SAVE = 8;

export type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const onlyKeys = (o: Obj, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));

export interface LookupDraft { key: string; name: string; link: string; fields: string[] }
export type AggOp = "count" | "exists" | "sum";
export interface AggregateDraft {
  key: string;
  name: string;
  op: AggOp;
  /** Whose records are counted. */
  entity: string;
  /** A link field of `entity`. */
  link: string;
  /** "" is the record being saved; otherwise a link field of it, and the record that points at. */
  to: string;
  /** The number a sum adds up. */
  field: string;
  filters: FilterRow[];
}
export interface RuleDraft {
  key: string;
  id: string;
  entity: string;
  phase: "validate" | "derive";
  when: string;
  check: string;
  message: string;
  field: string;
  audit: boolean;
  writes: Row[];
  lookups: LookupDraft[];
  aggregates: AggregateDraft[];
  /** Keys of the rule the editor knows nothing of: written back as they were. */
  extra: Obj;
}
export type RuleItem = { key: string; rule: RuleDraft; raw?: undefined } | { key: string; raw: unknown; rule?: undefined };

/** What would not work, and where: `rule` is an item's key, `part` the tail of a diagnostic's pointer
 *  (`check`, `lookups/0/fields`, `aggregates/1/filter/0`, `writes/x_band`). */
export interface Problem { message: string; rule: string; part: string }

let counter = 0;
const newKey = () => `r${++counter}`;

const KNOWN = ["id", "entity", "phase", "when", "writes", "check", "message", "field", "audit_refusals", "lookups", "aggregates"];
const AGG_KEYS = ["name", "entity", "link", "to", "filter", "op", "field"];
/** The operators a filter row of the editor shows (`in`, `between` and the rest are kept in a raw rule). */
const ROW_OPS = FILTER_OPS;

function fromFilter(f: unknown): FilterRow | null {
  if (!Array.isArray(f) || f.length !== 3 || !isStr(f[0]) || !isStr(f[1]) || !ROW_OPS.includes(f[1])) return null;
  const [field, op, value] = f as [string, string, unknown];
  const scalar = isStr(value) || typeof value === "boolean" || (typeof value === "number" && Number.isInteger(value));
  if (!scalar) return null;
  // `like` is shown without its percent signs and written with them: only that shape has a row.
  if (op === "like" && !(isStr(value) && /^%.*%$/s.test(value))) return null;
  if (op === "is" && value !== "set" && value !== "not set") return null;
  return { ...newFilter(field), op, value };
}

function fromAggregate(a: unknown): AggregateDraft | null {
  if (!isObj(a) || !onlyKeys(a, AGG_KEYS) || !isStr(a.name) || !isStr(a.entity) || !isStr(a.link) || !(a.op === "count" || a.op === "exists" || a.op === "sum")) return null;
  if (!(a.to === undefined || isStr(a.to)) || !(a.field === undefined || isStr(a.field)) || !(a.filter === undefined || Array.isArray(a.filter))) return null;
  const filters: FilterRow[] = [];
  for (const f of (a.filter as unknown[] | undefined) ?? []) {
    const row = fromFilter(f);
    if (!row) return null;
    filters.push(row);
  }
  // The server drops "self" when it reads a source: both spellings are the saved record.
  return { key: newKey(), name: a.name, op: a.op, entity: a.entity, link: a.link, to: a.to === "self" ? "" : ((a.to as string | undefined) ?? ""), field: (a.field as string | undefined) ?? "", filters };
}

function fromLookup(l: unknown): LookupDraft | null {
  if (!isObj(l) || !onlyKeys(l, ["name", "link", "fields"]) || !isStr(l.name) || !isStr(l.link) || !Array.isArray(l.fields) || !l.fields.every(isStr)) return null;
  return { key: newKey(), name: l.name, link: l.link, fields: [...(l.fields as string[])] };
}

function fromRule(r: unknown): RuleDraft | null {
  if (!isObj(r) || !isStr(r.id) || !isStr(r.entity) || (r.phase !== "validate" && r.phase !== "derive")) return null;
  for (const k of ["when", "check", "message", "field"]) if (r[k] !== undefined && !isStr(r[k])) return null;
  if (r.audit_refusals !== undefined && typeof r.audit_refusals !== "boolean") return null;
  const writes: Row[] = [];
  if (r.writes !== undefined) {
    if (!isObj(r.writes) || !Object.values(r.writes).every(isStr)) return null;
    for (const [field, expr] of Object.entries(r.writes)) writes.push({ key: newKey(), field, expr: expr as string });
  }
  const lookups: LookupDraft[] = [];
  for (const l of r.lookups === undefined ? [] : Array.isArray(r.lookups) ? r.lookups : [null]) {
    const row = fromLookup(l);
    if (!row) return null;
    lookups.push(row);
  }
  const aggregates: AggregateDraft[] = [];
  for (const a of r.aggregates === undefined ? [] : Array.isArray(r.aggregates) ? r.aggregates : [null]) {
    const row = fromAggregate(a);
    if (!row) return null;
    aggregates.push(row);
  }
  return {
    key: newKey(),
    id: r.id,
    entity: r.entity,
    phase: r.phase,
    when: (r.when as string | undefined) ?? "",
    check: (r.check as string | undefined) ?? "",
    message: (r.message as string | undefined) ?? "",
    field: (r.field as string | undefined) ?? "",
    audit: r.audit_refusals === true,
    writes,
    lookups,
    aggregates,
    extra: Object.fromEntries(Object.entries(r).filter(([k]) => !KNOWN.includes(k))),
  };
}

/** The draft's rules as items, one for each, in order (an item's place is the pointer's `/rules/N`). */
export function rulesFromSource(s: object): RuleItem[] {
  const rules = (s as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return [];
  return rules.map((r) => {
    const rule = fromRule(r);
    return rule ? { key: rule.key, rule } : { key: newKey(), raw: r };
  });
}

/** True when `rules` is something other than a list: the tab leaves it alone and says so. */
export const rulesAreOdd = (s: object) => {
  const rules = (s as { rules?: unknown }).rules;
  return rules !== undefined && !Array.isArray(rules);
};

export function ruleJson(d: RuleDraft): Obj {
  const text = (v: string) => v.trim();
  const writes = d.writes.filter((r) => r.field.trim());
  return {
    id: d.id.trim(),
    entity: d.entity,
    phase: d.phase,
    ...(text(d.when) ? { when: text(d.when) } : {}),
    ...(writes.length ? { writes: Object.fromEntries(writes.map((r) => [r.field.trim(), text(r.expr)])) } : {}),
    ...(text(d.check) ? { check: text(d.check) } : {}),
    ...(text(d.message) ? { message: text(d.message) } : {}),
    ...(d.field ? { field: d.field } : {}),
    ...(d.audit ? { audit_refusals: true } : {}),
    ...(d.lookups.length ? { lookups: d.lookups.map((l) => ({ name: l.name.trim(), link: l.link, fields: l.fields })) } : {}),
    ...(d.aggregates.length
      ? {
          aggregates: d.aggregates.map((a) => ({
            name: a.name.trim(),
            entity: a.entity,
            link: a.link,
            ...(a.to ? { to: a.to } : {}),
            ...(a.filters.length ? { filter: a.filters.map((f) => [f.field, f.op, f.value]) } : {}),
            op: a.op,
            ...(a.op === "sum" ? { field: a.field } : {}),
          })),
        }
      : {}),
    ...d.extra,
  };
}

/** The source with its `rules` replaced by what the items say: everything else in it as it was. */
export function rulesToSource<S extends object>(s: S, items: RuleItem[]): S & { rules?: unknown } {
  if (!items.length && (s as { rules?: unknown }).rules === undefined) return s;
  return { ...s, rules: items.map((i) => (i.rule ? ruleJson(i.rule) : i.raw)) };
}

export function newRule(entity = ""): RuleDraft {
  return { key: newKey(), id: "", entity, phase: "validate", when: "", check: "", message: "", field: "", audit: false, writes: [], lookups: [], aggregates: [], extra: {} };
}

/** A copy with its own keys and an id no rule of the draft has. */
export function duplicateRule(d: RuleDraft, taken: string[]): RuleDraft {
  let id = `${d.id || "rule"}_copy`;
  for (let n = 2; taken.includes(id); n++) id = `${d.id || "rule"}_copy${n}`;
  return {
    ...d,
    key: newKey(),
    id,
    writes: d.writes.map((r) => ({ ...r, key: newKey() })),
    lookups: d.lookups.map((l) => ({ ...l, key: newKey(), fields: [...l.fields] })),
    aggregates: d.aggregates.map((a) => ({ ...a, key: newKey(), filters: a.filters.map((f) => ({ ...f, key: newFilter().key })) })),
    extra: structuredClone(d.extra),
  };
}

export const newLookup = (): LookupDraft => ({ key: newKey(), name: "", link: "", fields: [] });
export const newAggregate = (): AggregateDraft => ({ key: newKey(), name: "", op: "count", entity: "", link: "", to: "", field: "", filters: [] });
export const newWrite = (): Row => ({ key: newKey(), field: "", expr: "" });

// ── where a diagnostic points ──

/** The rule (by place) and the part of it a diagnostic's pointer names; null for a pointer outside `/rules`. */
export function rulePart(pointer: string): { rule: number; part: string } | null {
  const m = /^\/rules\/(\d+)(?:\/(.*))?$/s.exec(pointer);
  if (!m) return null;
  const part = (m[2] ?? "").split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~")).join("/");
  return { rule: Number(m[1]), part };
}

/** Whether a message about `at` belongs on `part`: that part itself, or one inside it. */
export const isWithin = (at: string, part: string) => at === part || at.startsWith(`${part}/`);

// ── what an aggregate can point at ──

type LinkField = Pick<Field, "name" | "label" | "type" | "to">;
export interface LinkChoice {
  /** A link field of the counted entity. */
  link: string;
  /** "" is the saved record; otherwise a link field of it. */
  to: string;
}

/** The ways the records of `of` can point at a record of `rule`: through one of their link fields at the saved
 *  record itself, or at the record one of its own link fields points to (both must be links to the same kind of
 *  record). The saved record's own is listed first. */
export function aggregateChoices(rule: { name: string; fields: LinkField[] }, of: { fields: LinkField[] }): LinkChoice[] {
  const links = (fs: LinkField[]) => fs.filter((f) => f.type === "link" && f.to);
  const mine = links(rule.fields);
  const out: LinkChoice[] = [];
  for (const l of links(of.fields)) if (l.to === rule.name) out.push({ link: l.name, to: "" });
  for (const l of links(of.fields)) for (const f of mine) if (f.to === l.to) out.push({ link: l.name, to: f.name });
  return out;
}

/** The link fields of the counted entity that can be used at all with this rule's entity. */
export const aggregateLinks = (rule: { name: string; fields: LinkField[] }, of: { fields: LinkField[] }) => [...new Set(aggregateChoices(rule, of).map((c) => c.link))];
/** For a chosen link of the counted entity, what it can point at: "" (the saved record) and the saved record's links. */
export const aggregateTargets = (rule: { name: string; fields: LinkField[] }, of: { fields: LinkField[] }, link: string) => aggregateChoices(rule, of).filter((c) => c.link === link).map((c) => c.to);

const NUMBER_TYPES = ["int", "decimal", "currency", "percent"];
/** The fields a sum may add up. */
export const summable = <F extends { type: string }>(fields: F[]) => fields.filter((f) => NUMBER_TYPES.includes(f.type));
const UNREADABLE = ["table", "secret", "json"];
/** The fields a rule may read from a record: not lines, secrets or what the viewer may not read. */
export const readable = <F extends { type: string; can_read?: boolean }>(fields: F[]) => fields.filter((f) => !UNREADABLE.includes(f.type) && f.can_read === true);

// ── checking ──

export interface CheckContext {
  /** An entity's fields, once loaded (the checks of a part that needs them wait until it has). */
  fieldsOf: (entity: string) => { name: string; type: string }[] | undefined;
}

export const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What is wrong with the rules, in words a person who is not a developer follows. What the compiler also refuses
 *  (an expression it cannot read, a field it may not read) is shown as it words it. */
export function checkRules(items: RuleItem[], c: CheckContext): Problem[] {
  const out: Problem[] = [];
  const rules = items.flatMap((i, n) => (i.rule ? [{ r: i.rule, n }] : []));
  for (const { r, n } of rules) {
    const at = (part: string, message: string) => out.push({ rule: r.key, part, message: tr("Rule {n}: {message}", { n: n + 1, message }) });
    if (!r.id.trim()) at("id", tr("give it a name."));
    else if (rules.some((o) => o.r !== r && o.r.id.trim() === r.id.trim())) at("id", tr("another rule is called “{id}”: give each rule its own name.", { id: r.id.trim() }));
    if (!r.entity) at("entity", tr("choose the kind of record it works on."));
    if (r.phase === "validate") {
      if (!r.check.trim()) at("check", tr("write what must be true for a save to go through."));
      if (!r.message.trim()) at("message", tr("write the message people see when the check fails."));
    } else {
      if (!r.writes.length) at("writes", tr("add at least one field to fill in."));
      if (r.writes.some((w) => !w.field.trim() || !w.expr.trim())) at("writes", tr("every row needs a field and a value."));
      const seen = new Set<string>();
      for (const w of r.writes) {
        const f = w.field.trim();
        if (f && seen.has(f)) at(`writes/${f}`, tr("“{field}” is filled in twice.", { field: f }));
        seen.add(f);
        const other = f && rules.find((o) => o.r !== r && o.r.phase === "derive" && o.r.entity === r.entity && o.r.writes.some((x) => x.field.trim() === f));
        if (other) at(`writes/${f}`, tr("“{field}” is also filled in by rule “{rule}”: one rule fills each field.", { field: f, rule: other.r.id || String(other.n + 1) }));
      }
    }
    if (r.lookups.length > MAX_LOOKUPS) at("lookups", tr("it reads at most {n} linked records.", { n: MAX_LOOKUPS }));
    if (r.aggregates.length > MAX_AGGREGATES) at("aggregates", tr("it counts or adds up at most {n} sets of records.", { n: MAX_AGGREGATES }));
    const names = new Map<string, number>();
    const claim = (name: string, part: string) => {
      const n2 = name.trim();
      if (!n2) return at(part, tr("name every linked record, count and total."));
      if (!NAME.test(n2)) at(part, tr("“{name}” is not a usable name: use letters, digits and underscores, starting with a letter.", { name: n2 }));
      else if (names.has(n2)) at(part, tr("two linked records or totals are both called “{name}”.", { name: n2 }));
      names.set(n2, 1);
    };
    r.lookups.forEach((l, i) => {
      claim(l.name, `lookups/${i}/name`);
      if (!l.link) at(`lookups/${i}/link`, tr("choose the link that linked record {n} follows.", { n: i + 1 }));
      if (!l.fields.length || l.fields.length > MAX_LOOKUP_FIELDS) at(`lookups/${i}/fields`, tr("choose between 1 and {max} fields to read from linked record {n}.", { max: MAX_LOOKUP_FIELDS, n: i + 1 }));
    });
    r.aggregates.forEach((a, i) => {
      claim(a.name, `aggregates/${i}/name`);
      if (!a.entity) at(`aggregates/${i}/entity`, tr("choose what count or total {n} is of.", { n: i + 1 }));
      else if (!a.link) at(`aggregates/${i}/link`, tr("choose the link through which count or total {n} reaches this record.", { n: i + 1 }));
      if (a.op === "sum" && !a.field) at(`aggregates/${i}/field`, tr("choose the number that total {n} adds up.", { n: i + 1 }));
      if (a.filters.length > MAX_FILTERS) at(`aggregates/${i}/filter`, tr("count or total {n} has at most {max} conditions.", { n: i + 1, max: MAX_FILTERS }));
      const fields = a.entity ? c.fieldsOf(a.entity) : undefined;
      a.filters.forEach((f, j) => {
        const where = `aggregates/${i}/filter/${j}`;
        const empty = f.value === "" || f.value === undefined || f.value === null || f.value === "%%";
        const type = fields?.find((x) => x.name === f.field)?.type ?? "";
        if (!f.field || (f.op !== "is" && empty)) at(where, tr("finish condition {c} of count or total {n}, or remove it.", { c: j + 1, n: i + 1 }));
        else if (["decimal", "currency", "percent"].includes(type) && f.op !== "is" && f.op !== "like" && !isDecimalString(f.value)) at(where, tr("condition {c} of count or total {n} needs a number.", { c: j + 1, n: i + 1 }));
        else if (type === "int" && f.op !== "is" && typeof f.value !== "number") at(where, tr("condition {c} of count or total {n} needs a whole number.", { c: j + 1, n: i + 1 }));
      });
    });
  }
  // What one save reads for all the rules of an entity together.
  const byEntity = new Map<string, RuleDraft[]>();
  for (const { r } of rules) byEntity.set(r.entity, [...(byEntity.get(r.entity) ?? []), r]);
  for (const [entity, list] of byEntity) {
    for (const phase of ["derive", "validate"] as const) {
      const here = list.filter((r) => r.phase === phase);
      const sets = new Set(here.flatMap((r) => r.aggregates.map((a) => JSON.stringify([a.entity, a.link, a.to, a.filters.map((f) => [f.field, f.op, f.value]), a.op, a.op === "sum" ? a.field : ""]))));
      const links = new Set(here.flatMap((r) => r.lookups.map((l) => l.link)));
      const first = here[0];
      if (!first) continue;
      if (sets.size > MAX_READS_PER_SAVE) out.push({ rule: first.key, part: "aggregates", message: tr("The rules of {entity} count or add up {count} different sets of records in one save: at most {max}.", { entity, count: sets.size, max: MAX_READS_PER_SAVE }) });
      if (links.size > MAX_READS_PER_SAVE) out.push({ rule: first.key, part: "lookups", message: tr("The rules of {entity} read {count} different linked records in one save: at most {max}.", { entity, count: links.size, max: MAX_READS_PER_SAVE }) });
    }
  }
  return out;
}

/** How an expression refers to what a rule reads: `lookups.party.credit_limit`, `aggregates.unpaid`. */
export const lookupRef = (l: Pick<LookupDraft, "name">, field: string) => `lookups.${l.name}.${field}`;
export const aggregateRef = (a: Pick<AggregateDraft, "name">) => `aggregates.${a.name}`;
