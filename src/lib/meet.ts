// Video meetings (Comms' /api/app/comms/meet; Ferrum docs/plan/collaboration.md, C4): whether this
// server has them, and the links that open one. A meeting is `{kind}/{id}`: a chat channel's call,
// a calendar event's meeting or a room started here.

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const MEET = "/api/app/comms/meet";

export type MeetKind = "channel" | "event" | "room";

/** What Comms answers for a meeting the caller may join: LiveKit's address and their token. */
export interface MeetPass {
  url: string;
  token: string;
  title: string;
  /** A room's guest link (this app's path), while it has one. */
  guest_path?: string | null;
}

/** Whether the operator set up meetings (a LiveKit server). */
export function useMeetAvailable(enabled = true) {
  return useQuery({
    queryKey: ["meet", "available"],
    queryFn: ({ signal }) => api.get<{ available: boolean }>(MEET, undefined, signal).then((r) => r.available),
    enabled,
    retry: false,
    staleTime: 10 * 60_000,
  });
}

/** A meeting's address, to share or to keep in a calendar event. */
export const meetLink = (kind: MeetKind, id: string, origin = location.origin) => `${origin}/app/meet/${kind}/${id}`;

/** The page in this app (`/meet/{kind}/{id}`) a meeting link of this app opens; null for others. */
export function meetPath(href: string | null | undefined, origin = location.origin): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href.trim(), origin);
  } catch {
    return null;
  }
  const m = url.origin === origin ? /^\/app\/meet\/(channel|event|room)\/([0-9a-f-]{36})\/?$/i.exec(url.pathname) : null;
  return m ? `/meet/${m[1].toLowerCase()}/${m[2].toLowerCase()}` : null;
}
