// A business calendar as the administration form edits it (Administration → Calendars). `fromCalendar` and
// `toCalendar` convert between the server's JSON and a draft, so that opening and saving changes nothing the
// person did not touch; `checkCalendar` says what the server would refuse before anything is sent.

import { t as tr } from "@ferrum/client";

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];
export type Hours = Partial<Record<Day, [string, string][]>>;
/** What a given local date is, whatever its weekday and the holidays say (`exceptions` of a calendar). */
export type Exceptions = Record<string, { open: boolean; hours?: [string, string][] }>;

/** What `GET /api/admin/calendars` lists, and what `PUT` takes (the first four). */
export interface Calendar {
  name: string;
  zone: string;
  weekends: string[];
  holidays: string[];
  hours?: Hours | null;
  exceptions?: Exceptions | null;
  revision?: number;
  updated_by?: string | null;
  updated_at?: string;
}

export interface Window {
  from: string;
  /** `24:00` is midnight at the end of the day. */
  to: string;
}

export interface Draft {
  name: string;
  zone: string;
  /** Business days. */
  open: Record<Day, boolean>;
  /** Set hours, rather than every hour of a business day. */
  custom: boolean;
  windows: Record<Day, Window[]>;
  holidays: string[];
  /** Dated exceptions, by date; `extra` is what the screen has no control for, kept as it came. */
  exceptions: ExceptionDraft[];
}

export interface ExceptionDraft {
  date: string;
  open: boolean;
  windows: Window[];
  extra: Record<string, unknown>;
}

/** At most this many exceptions in a calendar. */
export const MAX_EXCEPTIONS = 1000;

export interface Problem {
  field: "name" | "calendar" | "hours" | "holidays" | "exceptions";
  /** The date an `exceptions` problem is about. */
  date?: string;
  /** The weekday an `hours` problem is about. */
  day?: Day;
  message: string;
}

const none = <T,>(f: () => T) => Object.fromEntries(DAYS.map((d) => [d, f()])) as Record<Day, T>;

export function emptyDraft(zone: string): Draft {
  return { name: "", zone, open: { ...none(() => true), sat: false, sun: false }, custom: false, windows: none<Window[]>(() => []), holidays: [], exceptions: [] };
}

export function fromCalendar(c: Calendar): Draft {
  const d = emptyDraft(c.zone);
  d.name = c.name;
  d.open = none(() => true);
  for (const w of c.weekends) if (w in d.open) d.open[w as Day] = false;
  d.custom = !!c.hours;
  for (const day of DAYS) d.windows[day] = (c.hours?.[day] ?? []).map(([from, to]) => ({ from, to }));
  d.holidays = [...c.holidays].sort();
  d.exceptions = Object.entries(c.exceptions ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, { open, hours, ...extra }]) => ({ date, open: open !== false, windows: (hours ?? []).map(([from, to]) => ({ from, to })), extra }));
  return d;
}

export function toCalendar(d: Draft): Calendar {
  const c: Calendar = { name: d.name, zone: d.zone, weekends: DAYS.filter((x) => !d.open[x]), holidays: [...new Set(d.holidays)].sort() };
  if (d.custom) {
    c.hours = {};
    for (const day of DAYS) if (d.open[day] && d.windows[day].length) c.hours[day] = d.windows[day].map((w) => [w.from, w.to]);
  }
  if (d.exceptions.length) c.exceptions = Object.fromEntries(d.exceptions.map((e) => [e.date, { ...e.extra, open: e.open, ...(e.windows.length ? { hours: e.windows.map((w): [string, string] => [w.from, w.to]) } : {}) }]));
  return c;
}

/** A new exception: the date is closed all day until windows say otherwise. */
export const newException = (date: string): ExceptionDraft => ({ date, open: false, windows: [], extra: {} });

/** Turning on "Set hours" with none yet: a working day from nine to five on each business day. */
export function seedHours(d: Draft): Draft {
  if (DAYS.some((x) => d.open[x] && d.windows[x].length)) return d;
  return { ...d, windows: Object.fromEntries(DAYS.map((x) => [x, d.open[x] ? [{ from: "09:00", to: "17:00" }] : d.windows[x]])) as Record<Day, Window[]> };
}

/** One day's windows on every other business day. */
export function copyDay(d: Draft, from: Day): Draft {
  const windows = { ...d.windows };
  for (const day of DAYS) if (day !== from && d.open[day]) windows[day] = d.windows[from].map((w) => ({ ...w }));
  return { ...d, windows };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What is wrong with a day's windows (both times, start before end, none overlapping), each said with `say`. */
function checkWindows(ws: Window[], say: (m: "both" | "order" | "overlap", n: number) => void) {
  const ok: Window[] = [];
  ws.forEach((w, i) => {
    if (!TIME.test(w.from) || (!TIME.test(w.to) && w.to !== "24:00")) say("both", i + 1);
    else if (w.from >= w.to) say("order", i + 1);
    else ok.push(w);
  });
  const sorted = [...ok].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  if (sorted.some((w, i) => i > 0 && w.from < sorted[i - 1].to)) say("overlap", 0);
}

export function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
}

/** Dates pasted one per line or separated by commas, spaces or semicolons: the good ones, and what was not a date. */
export function parseDates(text: string): { dates: string[]; bad: string[] } {
  const dates: string[] = [];
  const bad: string[] = [];
  for (const s of text.split(/[\s,;]+/).filter(Boolean)) (isDate(s) ? dates : bad).push(s);
  return { dates, bad };
}

export function addHolidays(held: string[], more: string[]): string[] {
  return [...new Set([...held, ...more])].sort();
}

export const dayName = (d: Day): string =>
  ({ mon: tr("Monday"), tue: tr("Tuesday"), wed: tr("Wednesday"), thu: tr("Thursday"), fri: tr("Friday"), sat: tr("Saturday"), sun: tr("Sunday") })[d];

export function checkCalendar(d: Draft, isNew: boolean): Problem[] {
  const out: Problem[] = [];
  if (isNew && !/^[a-z][a-z0-9_]{0,63}$/.test(d.name)) out.push({ field: "name", message: tr("A name is lower case letters, digits and underscores, starting with a letter, at most 64 characters.") });
  if (!DAYS.some((x) => d.open[x])) out.push({ field: "calendar", message: tr("A calendar needs at least one business day a week.") });
  if (d.custom) {
    if (DAYS.some((x) => d.open[x]) && !DAYS.some((x) => d.open[x] && d.windows[x].length)) out.push({ field: "hours", message: tr("Set at least one window, or count every hour of a business day.") });
    for (const day of DAYS) {
      if (!d.open[day]) continue;
      const ok: Window[] = [];
      d.windows[day].forEach((w, i) => {
        const at = (message: string) => out.push({ field: "hours", day, message });
        if (!TIME.test(w.from) || (!TIME.test(w.to) && w.to !== "24:00")) at(tr("{day}, window {n}: enter both times.", { day: dayName(day), n: i + 1 }));
        else if (w.from >= w.to) at(tr("{day}, window {n}: the start must be before the end.", { day: dayName(day), n: i + 1 }));
        else ok.push(w);
      });
      const sorted = [...ok].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
      if (sorted.some((w, i) => i > 0 && w.from < sorted[i - 1].to)) out.push({ field: "hours", day, message: tr("{day}: windows may not overlap.", { day: dayName(day) }) });
    }
  }
  const seen = new Set<string>();
  if (d.exceptions.length > MAX_EXCEPTIONS) out.push({ field: "exceptions", message: tr("A calendar keeps at most {n} exceptions.", { n: MAX_EXCEPTIONS }) });
  for (const e of d.exceptions) {
    const at = (message: string) => out.push({ field: "exceptions", date: e.date, message: `${e.date}: ${message}` });
    if (!isDate(e.date)) at(tr("not a date (use YYYY-MM-DD)."));
    else if (seen.has(e.date)) at(tr("it is listed twice."));
    seen.add(e.date);
    checkWindows(e.windows, (m, n) => at(m === "overlap" ? tr("windows may not overlap.") : m === "both" ? tr("window {n}: enter both times.", { n }) : tr("window {n}: the start must be before the end.", { n })));
  }
  return out;
}
