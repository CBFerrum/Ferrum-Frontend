// Signed action links (BD-23, BD-38, BD-44): the links issued on a record as the server lists them (never a token), what each is
// in words, and the options of the `link` effect an action's editor sets (`until`, `days`, `uses`, `columns` for a lines table,
// who gets the code, the sites that may frame the page). The effect is kept as the JSON it is; these helpers read and set one
// option and say what the server would refuse.

import { t } from "@ferrum/client";

export type Raw = Record<string, unknown>;

/** `GET /api/v1/{E}/{id}/links` → `{links: Link[]}`. */
export interface IssuedLink {
  id: string;
  actions: string[];
  show: string[];
  columns?: Record<string, string[]> | null;
  uses: number;
  max_uses: number;
  expires_at: string;
  recipient?: string | null;
  /** Whether a code is sent first. */
  code: boolean;
  revoked_at?: string | null;
  created_at: string;
  issued_by?: string | null;
  opened_at?: string | null;
}

export type LinkState = "revoked" | "used" | "expired" | "opened" | "waiting";

/** What a link is now: revoked, used up, expired, opened (and may still be used), or not yet opened. The id decides the tone, not the word. */
export function linkState(l: Pick<IssuedLink, "revoked_at" | "uses" | "max_uses" | "expires_at" | "opened_at">, now = Date.now()): LinkState {
  if (l.revoked_at) return "revoked";
  if (l.uses >= l.max_uses) return "used";
  if (new Date(l.expires_at).getTime() <= now) return "expired";
  return l.opened_at ? "opened" : "waiting";
}

export const LINK_STATES: Record<LinkState, { tone: "red" | "neutral" | "amber" | "blue" | "green"; get label(): string }> = {
  revoked: { tone: "neutral", get label() { return t("Revoked"); } },
  used: { tone: "green", get label() { return t("Used"); } },
  expired: { tone: "neutral", get label() { return t("Expired"); } },
  opened: { tone: "amber", get label() { return t("Opened, not used up"); } },
  waiting: { tone: "blue", get label() { return t("Not opened"); } },
};

/** A link can be revoked while it can still be used. */
export const canRevoke = (s: LinkState) => s === "opened" || s === "waiting";

// ── the effect's options ──

const MAX_DAYS = 90;
const ORIGIN = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** The effect with `key` set; an empty value takes it away. */
export function setOption(effect: Raw, key: string, value: unknown): Raw {
  const next = { ...effect };
  const empty = value === undefined || value === "" || (Array.isArray(value) && !value.length) || (value && typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);
  if (empty) delete next[key];
  else next[key] = value;
  return next;
}

/** The columns the page shows of one lines table (the effect's `columns`), set or taken away. */
export function setColumns(effect: Raw, table: string, columns: string[]): Raw {
  const cur = { ...((effect.columns as Record<string, string[]> | undefined) ?? {}) };
  if (columns.length) cur[table] = columns;
  else delete cur[table];
  return setOption(effect, "columns", cur);
}

/** What the server would refuse about a link effect, in words. `tables`: the record's table fields. */
export function checkLink(e: Raw, tables: string[] = []): string[] {
  const out: string[] = [];
  const say = (m: string) => out.push(m);
  if (!lines(e.actions).length) say(t("Name what the link lets someone do: one or more actions, or view."));
  const days = e.days;
  if (days !== undefined && !(Number.isInteger(days) && (days as number) >= 1 && (days as number) <= MAX_DAYS)) say(t("Days: a whole number from 1 to {n}.", { n: MAX_DAYS }));
  const uses = e.uses;
  if (uses !== undefined && !(Number.isInteger(uses) && (uses as number) >= 1 && (uses as number) <= 100)) say(t("Uses: a whole number from 1 to 100."));
  const show = lines(e.show);
  const cols = (e.columns ?? {}) as Record<string, unknown>;
  for (const table of show.filter((s) => tables.includes(s))) {
    const c = lines(cols[table]);
    if (c.length < 1 || c.length > 8) say(t("The lines table {table} is shown with 1 to 8 columns.", { table }));
  }
  for (const table of Object.keys(cols)) if (!show.includes(table)) say(t("Columns are given for {table}, which the page does not show. Add it to the fields shown, or take its columns away.", { table }));
  const origins = lines(e.frame_origins);
  if (origins.length > 10) say(t("At most 10 sites may frame the page."));
  const bad = origins.find((o) => !ORIGIN.test(o));
  if (bad) say(t("{origin} is not a site address: https://host, with a port if it has one, and nothing after it.", { origin: bad }));
  return out;
}
