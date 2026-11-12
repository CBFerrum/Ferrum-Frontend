// What a connection's health comes to, in words. Each fact stands on its own, because each fails on
// its own: a working sign-in over a stale feed is not a healthy connection, and there is deliberately
// no single "Connected" to show.

import { formatDateTime } from "./format";
import { t } from "@ferrum/client";

export type Tone = "neutral" | "green" | "amber" | "red";

export interface Fact {
  label: string;
  value: string;
  tone: Tone;
  detail?: string;
}

export interface ConnectionHealth {
  authentication?: string;
  freshness?: string | null;
  backlog?: number;
  dead_letters?: number;
  drift?: number;
  quota?: { waiting_until?: string | null; reason?: string | null; failures?: number };
}

const DAY = 86_400_000;

/** "5 minutes ago", for a past moment. */
export function ago(at: string, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - new Date(at).getTime()) / 1000);
  if (seconds < 60) return t("just now");
  if (seconds < 3600) {
    const n = Math.floor(seconds / 60);
    return n === 1 ? t("1 minute ago") : t("{n} minutes ago", { n });
  }
  if (seconds < 86_400) {
    const n = Math.floor(seconds / 3600);
    return n === 1 ? t("1 hour ago") : t("{n} hours ago", { n });
  }
  const n = Math.floor(seconds / 86_400);
  return n === 1 ? t("1 day ago") : t("{n} days ago", { n });
}

const SIGN_IN: Record<string, [string, Tone]> = {
  get none(): [string, Tone] { return [t("No credentials"), "neutral"]; },
  get untested(): [string, Tone] { return [t("Not tested"), "amber"]; },
  ok: ["Working", "green"],
  failing: ["Failing", "red"],
};

export function connectionFacts(h: ConnectionHealth, now: Date): Fact[] {
  const [signIn, signInTone] = SIGN_IN[h.authentication ?? "none"] ?? SIGN_IN.none;
  const seen = h.freshness ? new Date(h.freshness) : null;
  const stale = !seen || now.getTime() - seen.getTime() > DAY;
  const waiting = h.quota?.waiting_until && new Date(h.quota.waiting_until) > now ? new Date(h.quota.waiting_until) : null;
  const failures = h.quota?.failures ?? 0;
  const count = (n: number | undefined) => (n ? String(n) : "None");
  return [
    { label: t("Sign-in"), value: signIn, tone: signInTone },
    { label: t("Last sync"), value: h.freshness ? ago(h.freshness, now) : "Never", tone: seen ? (stale ? "amber" : "green") : "neutral" },
    {
      label: t("Provider"),
      value: waiting ? t("Left alone until {value}", { value: formatDateTime(waiting.toISOString()) }) : failures ? t("{failures} failed in a row", { failures }) : t("Answering"),
      tone: waiting ? "amber" : failures ? "amber" : "green",
      detail: waiting ? (h.quota?.reason ?? undefined) : undefined,
    },
    { label: t("Waiting to go"), value: count(h.backlog), tone: "neutral" },
    { label: t("Failed changes"), value: count(h.dead_letters), tone: h.dead_letters ? "red" : "neutral" },
    { label: t("Differences"), value: count(h.drift), tone: h.drift ? "amber" : "neutral" },
  ];
}

/** One thing a connection did: a read, a send or a comparison, as the hub lists it. */
export interface Run {
  id: string;
  kind: string;
  status: string;
  attempts?: number;
  max_attempts?: number;
  last_error?: string | null;
  stream?: string | null;
  created_at: string;
  finished_at?: string | null;
}

/** What a run was, in words, and its tone: a failed one is what someone tries again. */
export function runWords(r: Run): { what: string; tone: Tone; again: boolean } {
  const what =
    r.kind === "platform.connector.sync" ? t("Read") : r.kind === "platform.connector.deliver" ? `Sent${r.stream ? t(" on {stream}", { stream: r.stream }) : ""}` : r.kind === "platform.connector.reconcile" ? t("Compared") : r.kind;
  const tone: Tone = r.status === "done" ? "green" : r.status === "failed" ? "red" : r.status === "cancelled" ? "neutral" : "amber";
  return { what, tone, again: r.status === "failed" };
}
