// @ferrum/testing (docs/plan/apps-ui.md §10.6): an app's tests run it on a fake bootstrap and a fake
// shell, and can see what it asked the shell to do.

import type { Bootstrap, Family, IntentRequest, LauncherEntry, Shell, UploadRequest } from "@ferrum/client";
import { resetBootstrap } from "@ferrum/client";

/** A bootstrap with sensible values; `over` replaces parts of it. */
export function fakeBootstrap(over: Partial<Bootstrap> = {}): Bootstrap {
  return {
    v: 1,
    workspace: { id: "00000000-0000-0000-0000-000000000001", slug: "test", name: "Test", host: "localhost" },
    person: { id: "00000000-0000-0000-0000-000000000002", name: "Tess Ter", email: "tess@test.test", kind: "member", admin: false, actor: null },
    app: { id: "app", version: "1.0.0", release: "0".repeat(64), routes: { app: "/app/" }, entry: "app", title: "App", compact: false },
    host: { kind: "test", shell: "1.0.0" },
    api: { base: "/api/", live: "/ws/live", auth: "cookie" },
    locale: { language: "en", timezone: "UTC", dir: "ltr" },
    theme: { appearance: "light", hash: "test" },
    company: null,
    flags: {},
    ...over,
  };
}

/** What an app asked the fake shell. */
export interface ShellCalls {
  ready: number;
  titles: string[];
  navigations: unknown[];
  intents: { action: string; type: string; data?: unknown }[];
  toasts: string[];
  panels: unknown[];
  uploads: UploadRequest[];
  /** What an intent's handler page answered. */
  answers: unknown[];
}

/**
 * Puts a bootstrap in the document and a fake `ferrum.shell` on the global object. Intents answer
 * with `intents[action + " " + type]` (or are cancelled). Returns what the app asks for.
 */
export function installFakeShell(
  o: { bootstrap?: Bootstrap; intents?: Record<string, unknown>; request?: IntentRequest; family?: Family | null; apps?: LauncherEntry[]; uploads?: (r: UploadRequest) => unknown } = {},
): ShellCalls {
  const calls: ShellCalls = { ready: 0, titles: [], navigations: [], intents: [], toasts: [], panels: [], uploads: [], answers: [] };
  const boot = o.bootstrap ?? fakeBootstrap();
  (globalThis as { __FERRUM_BOOTSTRAP__?: Bootstrap }).__FERRUM_BOOTSTRAP__ = boot;
  if (typeof document !== "undefined") {
    document.getElementById("ferrum-bootstrap")?.remove();
    const el = document.createElement("script");
    el.type = "application/json";
    el.id = "ferrum-bootstrap";
    el.textContent = JSON.stringify(boot);
    document.head.append(el);
  }
  resetBootstrap();
  const noop = () => {};
  const fake: Shell = {
    version: "1.0.0",
    host: "test",
    supports: () => true,
    ready: () => void calls.ready++,
    navigate: (t) => (calls.navigations.push(t), true),
    title: (t) => void calls.titles.push(t),
    breadcrumbs: noop,
    badge: noop,
    intent: Object.assign(
      async (r: { action: string; type: string; data?: unknown }) => {
        calls.intents.push(r);
        const key = `${r.action} ${r.type}`;
        return o.intents && key in o.intents ? { status: "done" as const, result: o.intents[key] as never, app: "fake" } : { status: "cancelled" as const };
      },
      {
        request: () => (o.request ? Promise.resolve(o.request) : Promise.reject(new Error("this page was not opened for an intent"))),
        done: (result?: unknown) => void calls.answers.push({ done: result ?? null }),
        cancel: () => void calls.answers.push({ cancelled: true }),
      },
    ) as Shell["intent"],
    canIntent: async (a, t) => !!o.intents && `${a} ${t}` in o.intents,
    companion: () => null,
    toast: (m) => void calls.toasts.push(m),
    leaveGuard: () => noop,
    session: { signOut: noop, reauthenticate: noop, on: noop },
    live: { subscribe: () => noop },
    sidepanel: {
      open: async (p) => (calls.panels.push(p), true),
      close: noop,
      current: () => null,
      context: () => null,
      list: async () => [],
    },
    uploads: {
      start: async (r) => {
        calls.uploads.push(r);
        return { id: `upload-${calls.uploads.length}`, done: Promise.resolve(o.uploads ? o.uploads(r) : null) };
      },
      cancel: async () => {},
      retry: async () => false,
      dismiss: async () => {},
      list: () => [],
      on: () => noop,
    },
    family: async () => o.family ?? null,
    // The assistant opens as the side panel of that name.
    assistant: async (context) => (calls.panels.push({ id: "assistant", context }), true),
    apps: async () => o.apps ?? [],
    on: noop,
  };
  (globalThis as { ferrum?: unknown }).ferrum = { shell: fake };
  return calls;
}

/** Undoes `installFakeShell`. */
export function removeFakeShell(): void {
  delete (globalThis as { ferrum?: unknown }).ferrum;
  delete (globalThis as { __FERRUM_BOOTSTRAP__?: unknown }).__FERRUM_BOOTSTRAP__;
  if (typeof document !== "undefined") document.getElementById("ferrum-bootstrap")?.remove();
  resetBootstrap();
}
