// Screens of apps (docs/plugins.md "Screens" on the server): pages, dashboard widgets, form panels and
// settings pages an app ships under ui/, shown in sandboxed frames. The frame has an opaque origin and
// no network beyond its own files, so it reaches Ferrum only through the bridge here: on load the
// host hands it a MessagePort and answers its requests ({id, method, params} → {id, result} or
// {id, error}); events go the other way ({event, data}). Calls to the API carry X-Ferrum-App, and the
// server narrows them to what the app declared, within the user's own rights.

import { useQuery } from "@tanstack/react-query";
import { ApiError, api, errorMessage } from "./api";

/** The bridge protocol version a screen receives in its `init` message. */
export const SCREEN_PROTOCOL = 1;

export type Slot = "ui.page" | "ui.widget" | "ui.panel" | "ui.settings";

/** One item an enabled app contributes to a screen slot. */
export interface Contribution {
  app: string;
  version: string;
  id: string;
  /** The page, under the app's ui/. */
  entry: string;
  title?: string;
  icon?: string;
  /** Widgets: [width, height] in grid cells (12 columns). */
  size?: [number, number];
  /** Panels: the entity whose forms show it. */
  entity?: string;
}

export function useContributions(point: Slot) {
  return useQuery({
    queryKey: ["contributions", point],
    queryFn: ({ signal }) => api.get<{ items: Contribution[] }>(`/api/meta/contributions/${point}`, undefined, signal).then((r) => r.items),
    staleTime: 60_000,
  });
}

/** Where a screen's page is served: `/api/ext-ui/<workspace>/<app>/<version>/<file under ui/>`. */
export function screenUrl(tenant: string, c: Pick<Contribution, "app" | "version" | "entry">): string {
  const file = c.entry.replace(/^ui\//, "").split("/").map(encodeURIComponent).join("/");
  return `/api/ext-ui/${encodeURIComponent(tenant)}/${encodeURIComponent(c.app)}/${encodeURIComponent(c.version)}/${file}`;
}

/** Where a screen may send requests: records, metadata and its app's own endpoints (the server checks the same). */
export function screenMayCall(app: string, path: string): boolean {
  if (/\.\.|[?#\\]|\/\//.test(path)) return false;
  return /^\/api\/(v1|meta)\/./.test(path) || path.startsWith(`/api/ext/${app}/`);
}

/** The design tokens screens get (index.css), as `--<name>` values. */
const TOKENS = ["text", "muted-foreground", "faint", "surface", "surface-2", "border", "primary", "primary-foreground", "primary-soft", "danger", "success", "radius", "radius-sm", "shadow"];

/** The current look, for screens to match: light or dark, and the design tokens as CSS values. */
export function screenTheme(): { mode: "light" | "dark"; tokens: Record<string, string> } {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const t of TOKENS) {
    const v = style.getPropertyValue(`--${t}`).trim();
    if (v) tokens[t] = v;
  }
  return { mode: root.dataset.theme === "dark" ? "dark" : "light", tokens };
}

export interface ScreenContext {
  app: string;
  slot: Slot;
  user: { email: string; name: string };
  locale: string;
  theme: ReturnType<typeof screenTheme>;
  /** Panels: the record (its data comes through `api`, so a screen sees only what its app may read). */
  record?: { entity: string; id: string };
}

/** What the host does for a screen. */
export interface ScreenHost {
  app: string;
  context: () => ScreenContext;
  call: (r: { method: string; path: string; query?: Record<string, string>; body?: unknown }) => Promise<unknown>;
  navigate: (to: string) => void;
  toast: (message: string, tone: "success" | "error" | "info") => void;
  confirm: (o: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  resize: (height: number) => void;
}

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function query(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => ["string", "number", "boolean"].includes(typeof x)).map(([k, x]) => [k, String(x)]));
}

async function handle(host: ScreenHost, method: string, p: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "context":
      return host.context();
    case "api": {
      const path = text(p.path, 2000);
      if (!screenMayCall(host.app, path)) throw new Refused(403, `screens of ${host.app} may not call ${path || "that"}`);
      const verb = (text(p.method, 10) || "GET").toUpperCase();
      if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(verb)) throw new Refused(400, `unknown method ${verb}`);
      return host.call({ method: verb, path, query: query(p.query), body: p.body });
    }
    case "navigate": {
      const to = text(p.to, 2000);
      if (!/^\/(?!\/)/.test(to) || to.includes(":") || to.includes("\\")) throw new Refused(400, "navigate to a path of the app, such as /e/Customer");
      host.navigate(to);
      return null;
    }
    case "openRecord": {
      const [entity, id] = [text(p.entity, 100), text(p.id, 100)];
      if (!entity || !id) throw new Refused(400, "openRecord needs entity and id");
      host.navigate(`/e/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`);
      return null;
    }
    case "toast": {
      const tone = p.tone === "error" || p.tone === "info" ? p.tone : "success";
      host.toast(text(p.message, 300), tone);
      return null;
    }
    case "confirm":
      return host.confirm({
        title: text(p.title, 120) || "Are you sure?",
        message: text(p.message, 600) || undefined,
        confirmLabel: text(p.confirmLabel, 40) || undefined,
        danger: p.danger === true,
      });
    case "resize": {
      const h = Number(p.height);
      if (!Number.isFinite(h)) throw new Refused(400, "resize needs a height in pixels");
      host.resize(Math.min(Math.max(Math.round(h), 40), 4000));
      return null;
    }
    default:
      throw new Refused(400, `unknown method ${method}`);
  }
}

/** Answers a screen's requests on `port` (the host keeps the other end's twin). */
export function serveScreen(port: MessagePort, host: ScreenHost): { emit: (event: string, data: unknown) => void; close: () => void } {
  port.onmessage = (e: MessageEvent) => {
    const msg = e.data as { id?: unknown; method?: unknown; params?: unknown } | null;
    if (!msg || typeof msg !== "object" || typeof msg.id !== "number" || typeof msg.method !== "string") return;
    const params = msg.params && typeof msg.params === "object" ? (msg.params as Record<string, unknown>) : {};
    handle(host, msg.method, params).then(
      (result) => port.postMessage({ id: msg.id, result: result ?? null }),
      (err: unknown) => {
        const status = err instanceof Refused || err instanceof ApiError ? err.status : 500;
        port.postMessage({ id: msg.id, error: { status, message: err instanceof Refused ? err.message : errorMessage(err) } });
      },
    );
  };
  return { emit: (event, data) => port.postMessage({ event, data }), close: () => port.close() };
}
