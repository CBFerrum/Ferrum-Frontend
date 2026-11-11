// Badge tone for well-known whole state ids. This is the fallback for statusTone(value) when the caller declares no
// `tones`: an exact, case-insensitive match of the whole stored value, nothing else. Not a substring, not a regex, not
// a guess at a translated label, so "Not approved" and "Unfamiliar thing" are neutral, never green or blue.
//
// Derived from the `options:` of every field named *status / *state in feo/ferrum/packages and ferrum-app-*/packages
// (139 fields, 187 distinct values, 2 Nov 2026 tree). Only unambiguous whole words are classified:
//   neutral  not started, or no outcome to signal (draft, new, planned, scheduled, queued, requested, inactive, archived, closed...)
//   blue     in flight, moving on its own (in progress, sent, submitted, dispatched, invoiced...)
//   amber    waiting on someone, or short of complete (pending, on hold, partly paid, unpaid, expired, at risk...)
//   green    finished well (approved, paid, completed, delivered, active, resolved...)
//   red      finished badly or breached (rejected, cancelled, failed, overdue, void...)
// Every other id is neutral. A per-option tone in the field's metadata (`tones` on statusTone / StatusBadge) is the
// owner of the tone; this table only keeps today's screens readable until the metadata carries it.

import type { Tone } from "../ui/kit";

export const STATUS_TONES: Readonly<Record<string, Tone>> = {
  "abandoned": "red",
  "accepted": "green",
  "active": "green",
  "approved": "green",
  "at risk": "amber",
  "available": "green",
  "awaiting payment": "amber",
  "awaiting response": "amber",
  "awarded": "green",
  "billed": "blue",
  "bounced": "red",
  "breached": "red",
  "canceled": "red",
  "cancelled": "red",
  "cannot complete": "red",
  "certified": "green",
  "cleared": "green",
  "closed": "green",
  "complete": "green",
  "completed": "green",
  "confirmed": "green",
  "declined": "red",
  "delivered": "green",
  "dispatched": "blue",
  "done": "green",
  "draft": "neutral",
  "en route": "blue",
  "expired": "amber",
  "failed": "red",
  "fulfilled": "green",
  "fully completed": "green",
  "hold": "amber",
  "in process": "blue",
  "in progress": "blue",
  "in review": "amber",
  "inactive": "neutral",
  "incomplete": "amber",
  "invoiced": "blue",
  "late": "amber",
  "live": "green",
  "lost": "red",
  "new": "neutral",
  "no show": "red",
  "not started": "neutral",
  "on hold": "amber",
  "open": "neutral",
  "out for delivery": "blue",
  "overdue": "red",
  "paid": "green",
  "partially completed": "amber",
  "partly billed": "amber",
  "partly paid": "amber",
  "passed": "green",
  "paused": "amber",
  "pending": "amber",
  "pending review": "amber",
  "planned": "neutral",
  "published": "green",
  "queued": "neutral",
  "ready": "green",
  "received": "green",
  "refund failed": "red",
  "refunded": "green",
  "rejected": "red",
  "repaired": "green",
  "requested": "neutral",
  "resolved": "green",
  "revoked": "red",
  "running": "blue",
  "scheduled": "neutral",
  "sent": "blue",
  "signed": "green",
  "submitted": "blue",
  "terminated": "red",
  "timed out": "red",
  "under review": "amber",
  "unpaid": "amber",
  "valid": "green",
  "void": "red",
  "voided": "red",
  "waiting": "amber",
  "won": "green",
};

/** The built-in tone of a whole state id, or undefined when the table does not know it. */
export function knownStatusTone(value: string): Tone | undefined {
  const k = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_TONES, k) ? STATUS_TONES[k] : undefined;
}

/** The tone of a document's numeric docstatus: 0 draft, 1 submitted, 2 cancelled. Never from the English label. */
export const DOCSTATUS_TONE: readonly Tone[] = ["neutral", "green", "red"];
export const docstatusTone = (docstatus: number): Tone => DOCSTATUS_TONE[docstatus] ?? "neutral";
