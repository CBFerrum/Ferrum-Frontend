// The calendar on the Mail app's calendar API: my events, invitations and public events with
// recurrences expanded by the server, as a month grid (an agenda on phones), with RSVPs. Events
// are created and edited in the Calendar Event form.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, Repeat, Video } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { byDay, CALENDAR, isoDay, monthGrid, safeColor, safeLink, type Occurrence } from "@/lib/calendar";
import { useLiveEntity } from "@/lib/live";
import { cn } from "@/lib/utils";
import { ErrorState, toast } from "@/ui/kit";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

/** The new-event form for a day, 09:00 to 10:00 local time. */
const newEventLink = (day: string) => {
  const start = new Date(`${day}T09:00:00`);
  const end = new Date(start.getTime() + 3_600_000);
  return `/e/CalendarEvent/new?starts_at=${encodeURIComponent(start.toISOString())}&ends_at=${encodeURIComponent(end.toISOString())}`;
};

export function CalendarPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [open, setOpen] = useState<Occurrence | null>(null);
  const grid = useMemo(() => monthGrid(month), [month]);
  const from = isoDay(grid[0]!);
  const to = isoDay(grid[41]!);
  const events = useQuery({
    queryKey: ["calendar", from, to],
    queryFn: ({ signal }) => api.get<{ occurrences: Occurrence[] }>(`${CALENDAR}/events`, { from, to }, signal),
  });
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ["calendar"] }), [qc]);
  useLiveEntity("CalendarEvent", refresh);
  const days = useMemo(() => byDay(events.data?.occurrences ?? []), [events.data]);
  const today = isoDay(new Date());
  const step = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const inMonth = (d: Date) => d.getMonth() === month.getMonth();
  const agenda = grid.filter((d) => inMonth(d) && days.has(isoDay(d)));

  return (
    <div className="grid gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <CalendarDays className="size-5 text-muted-foreground" aria-hidden="true" />
        <h1 className="mr-2 text-lg font-semibold">{month.toLocaleDateString([], { month: "long", year: "numeric" })}</h1>
        <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => step(-1)}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          Today
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => step(1)}>
          <ChevronRight />
        </Button>
        <Button asChild size="sm" className="ml-auto">
          <Link to={newEventLink(today)}>
            <Plus /> New event
          </Link>
        </Button>
      </header>
      {events.error ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : (
        <>
          {/* Month grid: tablets and up. */}
          <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
            <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b text-xs font-medium text-muted-foreground">
              {WEEKDAYS.map((w) => (
                <div key={w} className="px-2 py-1.5">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] grid-rows-6">
              {grid.map((d) => {
                const key = isoDay(d);
                const list = days.get(key) ?? [];
                return (
                  <div key={key} className={cn("min-h-24 min-w-0 overflow-hidden border-r border-b p-1 [&:nth-child(7n)]:border-r-0", !inMonth(d) && "bg-muted/30 text-muted-foreground")}>
                    <div className="flex items-center justify-between">
                      <Link
                        to={newEventLink(key)}
                        aria-label={`New event on ${longDay(key)}`}
                        className={cn("grid size-6 place-items-center rounded-full text-xs hover:bg-accent", key === today && "bg-primary text-primary-foreground hover:bg-primary")}
                      >
                        {d.getDate()}
                      </Link>
                    </div>
                    <ul className="mt-0.5 grid grid-cols-1 gap-0.5">
                      {events.isLoading && <Skeleton className="h-4" />}
                      {list.slice(0, 3).map((o) => (
                        <li key={o.id}>
                          <OccurrenceChip o={o} onOpen={() => setOpen(o)} />
                        </li>
                      ))}
                      {list.length > 3 && <li className="px-1 text-xs text-muted-foreground">+{list.length - 3} more</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Agenda: phones. */}
          <div className="grid gap-3 md:hidden">
            {events.isLoading && <Skeleton className="h-32" />}
            {!events.isLoading && !agenda.length && <p className="text-sm text-muted-foreground">Nothing this month.</p>}
            {agenda.map((d) => {
              const key = isoDay(d);
              return (
                <section key={key} aria-label={longDay(key)}>
                  <h2 className={cn("mb-1 text-sm font-semibold", key === today && "text-primary")}>{longDay(key)}</h2>
                  <ul className="grid gap-1">
                    {(days.get(key) ?? []).map((o) => (
                      <li key={o.id}>
                        <OccurrenceChip o={o} onOpen={() => setOpen(o)} large />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
      {open && <OccurrenceDialog o={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  );
}

function OccurrenceChip({ o, onOpen, large }: { o: Occurrence; onOpen: () => void; large?: boolean }) {
  const color = safeColor(o.color) ?? "var(--primary)";
  const cancelled = o.status === "Cancelled";
  const declined = o.my_response === "Declined";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded px-1 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        large ? "border p-2 text-sm pointer-coarse:min-h-11" : "text-xs",
        (cancelled || declined) && "text-muted-foreground line-through",
      )}
    >
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      {!o.all_day && <span className="shrink-0 tabular-nums">{timeOf(o.start)}</span>}
      <span className="min-w-0 truncate">{o.subject}</span>
    </button>
  );
}

const RESPONSES = ["Accepted", "Tentative", "Declined"] as const;

function OccurrenceDialog({ o, onClose, onChanged }: { o: Occurrence; onClose: () => void; onChanged: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState(o.my_response ?? null);
  const link = safeLink(o.meeting_link);
  const when = o.all_day
    ? new Date(o.start).toLocaleDateString([], { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    : `${new Date(o.start).toLocaleString([], { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} – ${timeOf(o.end)}`;
  const rsvp = async (r: (typeof RESPONSES)[number]) => {
    setBusy(true);
    try {
      await api.post(`${CALENDAR}/events/${o.event}/rsvp`, { response: r });
      setResponse(r);
      onChanged();
      toast(`Replied: ${r.toLowerCase()}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={cn(o.status === "Cancelled" && "line-through")}>{o.subject}</DialogTitle>
          <DialogDescription>{when}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {o.status && o.status !== "Confirmed" && <Badge variant="secondary">{o.status}</Badge>}
            {o.recurring && (
              <Badge variant="outline">
                <Repeat /> Repeats
              </Badge>
            )}
            {o.category && <Badge variant="outline">{o.category}</Badge>}
          </div>
          {o.location && (
            <p className="flex items-center gap-1.5">
              <MapPin className="size-4 text-muted-foreground" aria-hidden="true" /> {o.location}
            </p>
          )}
          {link && (
            <p className="flex items-center gap-1.5">
              <Video className="size-4 text-muted-foreground" aria-hidden="true" />
              <a href={link} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                Join the meeting
              </a>
            </p>
          )}
          {o.description && <p className="whitespace-pre-line text-muted-foreground">{o.description}</p>}
          {o.owner && !o.is_organizer && <p className="text-xs text-muted-foreground">Organized by {o.owner}</p>}
          {response !== null && (
            <div className="grid gap-1.5 border-t pt-2">
              <span className="text-xs font-medium text-muted-foreground">Going?</span>
              <div className="flex gap-2">
                {RESPONSES.map((r) => (
                  <Button key={r} size="sm" variant={response === r ? "default" : "outline"} disabled={busy} aria-pressed={response === r} onClick={() => void rsvp(r)}>
                    {r === "Accepted" ? "Yes" : r === "Tentative" ? "Maybe" : "No"}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {o.is_organizer && <Button onClick={() => navigate(`/e/CalendarEvent/${o.event}`)}>Edit event</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
