// Today's web app beside the shell (docs/plan/apps-ui.md §14): it picks up the browser's session
// from the cookie a new page signed in with, and in a workspace on the shell (`shell_v2`) it sends
// people from its addresses to their new homes. Pages that have no other home yet stay here.

import { api, getSession, setSession } from "./api";

/** The new address of a path of today's web app (relative to /app/), or null where it stays. */
export function newHome(path: string, search = ""): string | null {
  const p = path.replace(/^\/+/, "/").replace(/\/+$/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const enc = (s: string) => encodeURIComponent(decodeURIComponent(s));
  switch (seg[0]) {
    case undefined:
      return "/";
    case "e":
      if (seg.length === 2) return `/open/${enc(seg[1])}${search}`;
      if (seg.length === 3) return `/open/${enc(seg[1])}/${enc(seg[2])}${search}`;
      return null;
    case "r":
      return seg.length === 2 ? `/erp/r/${enc(seg[1])}${search}` : null;
    case "apps":
      if (seg.length === 1) return `/store/${search}`;
      if (seg.length === 3 && seg[2] === "settings") return `/store/apps/${enc(seg[1])}/settings${search}`;
      return null;
    case "admin":
      return `/admin/${seg.slice(1).map(enc).join("/")}${search}`;
    case "customize":
    case "studio":
    case "dashboards":
    case "spaces":
    case "x":
      return `/erp${p}${search}`;
    default:
      return null;
  }
}

/** A bearer token for this app from the browser's session cookie, when it has none of its own. */
export async function adoptBrowserSession(): Promise<void> {
  if (getSession()) return;
  try {
    const r = await api.post<{ token: string; tenant: string; email: string }>("/api/auth/token", undefined, { noAuthRedirect: true });
    if (r?.token) setSession({ token: r.token, tenant: r.tenant, email: r.email });
  } catch {
    // No browser session: this app's own sign-in.
  }
}

/** In a workspace on the shell, today's page goes to its new home (if it has one). */
export async function followShell(): Promise<boolean> {
  if (!getSession()) return false;
  try {
    const me = await api.get<{ shell_v2?: boolean }>("/api/auth/me");
    if (!me.shell_v2) return false;
    const to = newHome(location.pathname.replace(/^\/app/, ""), location.search);
    if (!to) return false;
    location.replace(to);
    return true;
  } catch {
    return false;
  }
}
