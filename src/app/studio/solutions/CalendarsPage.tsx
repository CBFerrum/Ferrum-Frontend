// Business calendars (FLC-HUMAN-005): the weekends and holidays a deadline counts business days on, in a
// time zone. Each save is a new revision: deadlines worked out before it keep what they were.

import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { saveCalendar, useCalendars, type Calendar } from "@/lib/solutions";
import { LoadingBlock, PageHeader } from "@/app/studio/dashboard/ui";
import { ErrorState, Field, toast } from "@/ui/kit";
import { useQueryClient } from "@tanstack/react-query";
import { t as tr, isolate } from "@ferrum/client";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABEL: Record<(typeof DAYS)[number], string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function CalendarsPage() {
  const q = useCalendars();
  const [editing, setEditing] = useState<Calendar | null>(null);
  return (
    <div className="mx-auto max-w-4xl p-4">
      <PageHeader
        eyebrow={
          <Link to="/studio/solutions" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" aria-hidden /> {tr("Solutions")}
          </Link>
        }
        title={tr("Calendars")}
        description={tr("Which days count as business days for deadlines, and in which time zone.")}
        actions={
          <Button size="sm" onClick={() => setEditing({ name: "", zone: Intl.DateTimeFormat().resolvedOptions().timeZone, weekends: ["sat", "sun"], holidays: [] })}>
            <Plus aria-hidden /> {tr("New calendar")}
          </Button>
        }
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <ul className="mb-6 grid gap-2">
          {q.data!.map((c) => (
            <li key={c.name} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
              <span className="font-medium" dir="ltr">
                {c.name}
              </span>
              <span>{isolate(c.zone)}</span>
              <span className="text-muted-foreground">{tr("revision {n}", { n: c.revision ?? 1 })}</span>
              {c.updated_at && <span className="text-xs text-muted-foreground">{relativeTime(c.updated_at)}</span>}
              <span className="flex-1" />
              <Button size="sm" variant="outline" onClick={() => setEditing({ ...c })}>
                {tr("Change")}
              </Button>
            </li>
          ))}
          {q.data!.length === 0 && <li className="text-sm text-muted-foreground">{tr("No calendar yet.")}</li>}
        </ul>
      )}
      {editing && <Editor value={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Editor({ value, onClose }: { value: Calendar; onClose: () => void }) {
  const [c, setC] = useState(value);
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const allZones = zones();
  const save = async () => {
    setBusy(true);
    try {
      const r = await saveCalendar(c);
      toast(tr("Saved as revision {n}", { n: r.revision }));
      await qc.invalidateQueries({ queryKey: ["calendars"] });
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="calendar-edit" className="grid gap-3 rounded-md border p-3">
      <h2 id="calendar-edit" className="text-base font-semibold">
        {value.name ? tr("Change {name}", { name: value.name }) : tr("New calendar")}
      </h2>
      <Field label={tr("Name")} hint={tr("Lower case, as a solution names it: india, head_office")}>
        <Input dir="ltr" value={c.name} disabled={!!value.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
      </Field>
      <Field label={tr("Time zone")}>
        <Input dir="ltr" list="calendar-zones" value={c.zone} onChange={(e) => setC({ ...c, zone: e.target.value })} />
      </Field>
      <datalist id="calendar-zones">
        {allZones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-sm">{tr("Days off every week")}</legend>
        {DAYS.map((d) => (
          <label key={d} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={c.weekends.includes(d)}
              onChange={(e) => setC({ ...c, weekends: e.target.checked ? [...c.weekends, d] : c.weekends.filter((x) => x !== d) })}
            />
            {tr(DAY_LABEL[d])}
          </label>
        ))}
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm">{tr("Holidays")}</legend>
        <ul className="flex flex-wrap gap-2">
          {c.holidays.map((h) => (
            <li key={h} className="flex items-center gap-1 rounded border px-2 py-0.5 text-sm">
              {h}
              <Button size="icon" variant="ghost" aria-label={tr("Remove {day}", { day: h })} onClick={() => setC({ ...c, holidays: c.holidays.filter((x) => x !== h) })}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input type="date" aria-label={tr("A holiday")} value={day} onChange={(e) => setDay(e.target.value)} className="max-w-48" />
          <Button size="sm" variant="outline" disabled={!day || c.holidays.includes(day)} onClick={() => (setC({ ...c, holidays: [...c.holidays, day].sort() }), setDay(""))}>
            <Plus aria-hidden /> {tr("Add")}
          </Button>
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button disabled={busy || !c.name || !c.zone} onClick={save}>
          <Save aria-hidden /> {tr("Save")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {tr("Cancel")}
        </Button>
      </div>
    </section>
  );
}
