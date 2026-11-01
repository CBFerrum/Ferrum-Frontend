// What a connection's health comes to, in words. Each fact stands on its own, because each fails on
// its own: a working sign-in over a stale feed is not a healthy connection, and there is deliberately
// no single "Connected" to show.

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
  if (seconds < 60) return "just now";
  const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? "" : "s"} ago`;
  if (seconds < 3600) return unit(Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return unit(Math.floor(seconds / 3600), "hour");
  return unit(Math.floor(seconds / 86_400), "day");
}

const SIGN_IN: Record<string, [string, Tone]> = {
  none: ["No credentials", "neutral"],
  untested: ["Not tested", "amber"],
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
    { label: "Sign-in", value: signIn, tone: signInTone },
    { label: "Last sync", value: h.freshness ? ago(h.freshness, now) : "Never", tone: seen ? (stale ? "amber" : "green") : "neutral" },
    {
      label: "Provider",
      value: waiting ? `Left alone until ${waiting.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : failures ? `${failures} failed in a row` : "Answering",
      tone: waiting ? "amber" : failures ? "amber" : "green",
      detail: waiting ? (h.quota?.reason ?? undefined) : undefined,
    },
    { label: "Waiting to go", value: count(h.backlog), tone: "neutral" },
    { label: "Failed changes", value: count(h.dead_letters), tone: h.dead_letters ? "red" : "neutral" },
    { label: "Differences", value: count(h.drift), tone: h.drift ? "amber" : "neutral" },
  ];
}
