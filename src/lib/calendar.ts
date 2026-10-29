// The calendar screen's pure parts, on the Mail app's `/api/app/comms/calendar`: the month grid
// and which occurrences (recurrences already expanded by the server) fall on which day.

export const CALENDAR = "/api/app/comms/calendar";

export interface Occurrence {
  id: string;
  event: string;
  start: string;
  end: string;
  all_day: boolean;
  subject: string;
  location?: string | null;
  meeting_link?: string | null;
  description?: string | null;
  status?: string | null;
  visibility?: string | null;
  category?: string | null;
  color?: string | null;
  timezone?: string | null;
  owner?: string | null;
  is_organizer?: boolean;
  my_response?: string | null;
  recurring?: boolean;
}

/** A local date as `YYYY-MM-DD`. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The 42 days (six weeks, Monday first) shown for the month containing `month`. */
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const back = (first.getDay() + 6) % 7; // days since Monday
  return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - back + i));
}

/**
 * The local days an occurrence covers. All-day events are UTC midnights with an exclusive end, so
 * they keep their calendar dates in every time zone; timed ones cover each local day they touch
 * (an end at exactly midnight does not reach the next day).
 */
export function daysOf(o: Pick<Occurrence, "start" | "end" | "all_day">): string[] {
  const start = new Date(o.start);
  const end = new Date(o.end);
  const out: string[] = [];
  if (o.all_day) {
    for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); d < end && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out.length ? out : [start.toISOString().slice(0, 10)];
  }
  const last = new Date(Math.max(start.getTime(), end.getTime() - 1));
  for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= last && out.length < 400; d.setDate(d.getDate() + 1)) out.push(isoDay(d));
  return out;
}

/** Occurrences by local day, all-day ones first, then by start. */
export function byDay(list: Occurrence[]): Map<string, Occurrence[]> {
  const out = new Map<string, Occurrence[]>();
  for (const o of list) for (const d of daysOf(o)) out.set(d, [...(out.get(d) ?? []), o]);
  for (const v of out.values()) v.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start));
  return out;
}

/** Only colors that cannot smuggle anything into a style: `#rgb`, `#rrggbb` or `#rrggbbaa`. */
export function safeColor(c: string | null | undefined): string | undefined {
  return c && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c.trim()) ? c.trim() : undefined;
}

/** `http(s)` meeting links only. */
export function safeLink(href: string | null | undefined): string | undefined {
  return href && /^https?:\/\/[^\s]+$/i.test(href.trim()) ? href.trim() : undefined;
}
