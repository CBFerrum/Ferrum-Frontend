// The records frame of an app's interface under the platform's bar: the sidebar built from metadata
// modules, and on a phone the button that opens it. Search, notifications and the account are the bar's.

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { bootstrap, shell, t as tr, isolate } from "@ferrum/client";
import { api, errorMessage, setUnauthorizedHandler } from "../lib/api";
import { humanize } from "../lib/format";
import { can, useMe, useMetaIndex, useReports, type EntitySummary, type Me, type MenuPage, type MetaIndex, type Module, type ReportDef } from "../lib/meta";
import { live } from "../lib/live";
import { useOnline } from "../lib/pwa";
import {
  Alert,
  Button,
  Dialog,
  ErrorBoundary,
  ErrorState,
  Field,
  Icon,
  PageLoading,
  toast,
} from "../ui/kit";
import { NavIcon } from "../../packages/kit/src/NavIcon";
import { dashboardNav, reportNav, solutionNav, spaceNav } from "./studio/nav";

type NavItem = { label: string; to: string; icon?: string; entity?: string; kind?: string; submittable?: boolean; /** Another app's or route's page: loaded, not routed to. */ href?: string };

/** The Studio app (package and module): its records open in their builders, not the generic list and form. */
export const STUDIO = "studio";
export const studioNav: NavItem[] = [...reportNav, ...dashboardNav, ...spaceNav, ...solutionNav];

/** Studio's links for `me`: solutions are an author's (administrators and the Solution Author role), so the
 *  others are not led to a page that refuses them; everyone has tasks and their runs. */
export function studioLinks(me: Me | null | undefined): NavItem[] {
  const author = !!me && (me.user.is_admin || me.user.roles.includes("Solution Author"));
  return author ? studioNav : studioNav.filter((n) => n.to !== "/studio/solutions");
}

/** The POS app's till, first in its module. */
export const POS = "pos";
export const registerNav: NavItem = { get label() { return tr("Register"); }, to: "/pos", icon: "store" };

/** The Mail app's team chat, first in its module (its API checks who may chat). */
export const COMMS_MODULE = "communication";
export const chatNav: NavItem = { get label() { return tr("Chat"); }, to: "/chat", icon: "chat" };
export const calendarNav: NavItem = { get label() { return tr("Calendar"); }, to: "/calendar", icon: "calendar" };
export const meetNav: NavItem = { get label() { return tr("Meet"); }, to: "/meet", icon: "video" };

/** The Docs app's page, first in its module. */
export const DOCS_MODULE = "docs";
export const docsNav: NavItem = { get label() { return tr("Documents"); }, to: "/docs", icon: "doc" };

/** A row for a page of an app's own interface (`shell.menu`): routed to inside this page's app and route, loaded
 *  from anywhere else (another app's frame, today's web app). Its label is the app's English, in the page's words. */
export function pageLink(p: MenuPage): NavItem {
  const app = bootstrap()?.app;
  const [route, ...rest] = p.path.split("/");
  const own = app?.id === p.app && app.entry === route;
  return own ? { to: `/${rest.join("/")}`, label: p.label, icon: p.icon ?? undefined, kind: "page" } : { to: `/${p.path}`, href: `/${p.path}`, label: p.label, icon: p.icon ?? undefined, kind: "page" };
}

/** A module's links (sidebar group, home card): its readable entities and reports, and the rows of its app's own pages
 *  the server gave this person, each after the item it names (first when it names none or one not shown); `meet` when
 *  video meetings are set up. */
export function moduleLinks(m: Module, readable: Map<string, EntitySummary>, reportLabel: Map<string, string>, meet = false, me?: Me | null): NavItem[] {
  if (m.name === STUDIO) return studioLinks(me);
  const keyed = m.items.flatMap((item): [string, NavItem][] => {
    if (item.startsWith("report:")) {
      const name = item.slice(7);
      return [[item, { to: `/r/${name}`, label: reportLabel.get(name) ?? humanize(name), kind: "report" }]];
    }
    const e = readable.get(item);
    return e ? [[item, { to: `/e/${e.name}`, label: e.label_plural, icon: e.icon ?? undefined, entity: e.name, kind: e.kind, submittable: e.submittable }]] : [];
  });
  let first = 0;
  for (const p of m.pages ?? []) {
    const at = p.after ? keyed.findIndex(([k]) => k === p.after) : -1;
    keyed.splice(at >= 0 ? at + 1 : first++, 0, [p.id, pageLink(p)]);
  }
  const links = keyed.map(([, l]) => l);
  if (m.name === POS && readable.has("PosInvoice")) return [registerNav, ...links];
  if (m.name === COMMS_MODULE && readable.has("CalendarEvent")) return [chatNav, calendarNav, ...(meet ? [meetNav] : []), ...links];
  if (m.name === DOCS_MODULE && readable.has("DocsTemplate")) return [docsNav, ...links];
  return links;
}

/* The frame is an app's interface under the platform's bar (docs/plan/apps-ui.md), whose session
 * is the browser's cookie and whose account menu, launcher and other apps are the bar's. */
/** The packages whose modules the sidebar shows (the app's own); null: all. */
let framePackages: Set<string> | null = null;
/** A workspace's own menu's page (`/data/{menu}/`): the modules it shows, and nothing else; null: by packages. */
let frameModules: Set<string> | null = null;
/** Whether the frame's routes include the records pages beyond lists, forms and reports
 *  (`recordsRoutes`): Customize, Studio's builders and the POS till. */
let frameHasPages = false;

/** Set once, before the first render. An app's interface runs under the shell, which signs the
 *  person in again when the session ends; `pages` when its routes are `recordsRoutes`. The mode is
 *  always `"app"` (the only one there is; apps still name it). */
export function setFrameMode(_mode: "app", packages?: string[], { pages = false, modules }: { pages?: boolean; modules?: string[] } = {}): void {
  framePackages = packages ? new Set(packages) : null;
  frameModules = modules ? new Set(modules) : null;
  frameHasPages = pages;
  setUnauthorizedHandler(() => shell().session.reauthenticate());
}

/** Whether the frame shows Studio's pages: they are among its routes, and Studio is its app's. */
function showsStudio(): boolean {
  return frameHasPages && (!framePackages || framePackages.has(STUDIO));
}

/** The app's name, as the bootstrap gives it. */
function appName(): string {
  return bootstrap()?.app?.title ?? "Ferrum";
}

/** Whether a module is the app's own: one of the frame's `modules` when it has them (a workspace's own menu), else one its packages define
 *  (the server names every module's package). */
export function ownModule(m: Module): boolean {
  if (frameModules) return frameModules.has(m.name);
  if (m.name === STUDIO) return showsStudio();
  return !framePackages || framePackages.has(m.package ?? "");
}

/** The frame around an app's routes; the shell signs the person in (a 401 asks it to, see setFrameMode). */
export function RequireAuth() {
  return <Shell />;
}

/** Report entries for navigation: names referenced by modules plus the server catalog. */
export function reportItems(meta: MetaIndex | undefined, catalog: ReportDef[] | undefined): { name: string; label: string; module?: string }[] {
  const labels = new Map((catalog ?? []).map((r) => [r.name, r.label]));
  const names = new Set<string>();
  for (const m of meta?.modules ?? []) for (const i of m.items) if (i.startsWith("report:")) names.add(i.slice(7));
  for (const r of catalog ?? []) names.add(r.name);
  return [...names].map((name) => ({ name, label: labels.get(name) ?? humanize(name) }));
}

/** Keeps lists, boards and the bell current while the app is open (see lib/live.ts). */
function useLiveUpdates() {
  const qc = useQueryClient();
  useEffect(() => {
    // Bursts (imports, bulk actions) collapse into one refresh per entity.
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      for (const e of pending) {
        void qc.invalidateQueries({ queryKey: ["list", e] });
        void qc.invalidateQueries({ queryKey: ["view", e] });
      }
      pending.clear();
      timer = undefined;
    };
    const offs = [
      live.onEvent((e) => {
        pending.add(e.entity);
        timer ??= setTimeout(flush, 400);
      }),
      live.onNotification((n) => {
        void qc.invalidateQueries({ queryKey: ["notifications"] });
        toast(n.title, "info");
      }),
      live.onResync(() => {
        void qc.invalidateQueries({ queryKey: ["list"] });
        void qc.invalidateQueries({ queryKey: ["view"] });
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      }),
    ];
    live.start();
    return () => {
      offs.forEach((off) => off());
      clearTimeout(timer);
      live.stop();
    };
  }, [qc]);
}

function Shell() {
  const location = useLocation();
  const meta = useMetaIndex();
  useLiveUpdates();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => setNavOpen(false), [location.pathname]);
  // After a route change the keyboard and a screen reader start in the new page, not where the old page's
  // link was; a page that put focus in itself already keeps it.
  const routed = useRef(false);
  useEffect(() => {
    if (!routed.current) {
      routed.current = true;
      return;
    }
    const main = document.getElementById("main");
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(() => {
    if (navOpen) document.querySelector<HTMLElement>(".sidebar a")?.focus();
  }, [navOpen]);

  useEffect(() => {
    // Search and "Go to" are the platform's bar's (⌘K); Escape closes the drawer.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="shell" data-nav-open={navOpen}>
      {/* The platform's bar has the skip link, inside its banner. Any link closes the drawer, the current page's too
          (its path does not change). */}
      <aside className="sidebar" aria-label={tr("Sidebar")} onClick={(e) => (e.target as Element).closest("a") && setNavOpen(false)}>
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            {Array.from(appName())[0]}
          </span>
          {isolate(appName())}
        </NavLink>
        <Sidebar />
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <div className="main-col">
        {/* The frame's own bar only opens the sidebar on a phone, and the platform's bar is the page's one banner
            (with notifications and the account). */}
        <div className="topbar topbar-nav-only">
          <button type="button" className="icon-btn nav-toggle" aria-label={tr("Open navigation")} aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
            <Icon name="menu" size={18} />
          </button>
          <span className="spacer" />
        </div>
        <OfflineBanner />
        <main id="main" tabIndex={-1}>
          {meta.error ? (
            <ErrorState error={meta.error} onRetry={() => meta.refetch()} title={tr("Could not load the application metadata")} />
          ) : meta.isLoading ? (
            <PageLoading />
          ) : (
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          )}
        </main>
      </div>
    </div>
  );
}

function OfflineBanner() {
  if (useOnline()) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="alert" size={14} /> {tr("You are offline. Pages you open need a connection, and nothing can be saved until it is back.")}
    </div>
  );
}

function Sidebar() {
  const meta = useMetaIndex().data;
  const reports = useReports().data?.reports;
  const me = useMe().data;
  // Mail, Chat, Calendar and Meet are Comms' own pages now (their links lead there): shown with
  // Comms, which says itself when hosted mail or meetings are not set up.
  const comms = !!meta?.packages.includes("comms") && !!meta.entities.some((e) => e.name === "CalendarEvent" && can(e.permissions, "read"));
  const meet = comms;
  const groups = useMemo(() => {
    if (!meta) return [];
    const readable = new Map(meta.entities.filter((e) => can(e.permissions, "read")).map((e) => [e.name, e]));
    const reportLabel = new Map(reportItems(meta, reports).map((r) => [r.name, r.label]));
    return [...meta.modules]
      .filter((m) => ownModule(m))
      .sort((a, b) => a.order - b.order)
      .map((m) => ({ name: m.name, label: m.label, items: moduleLinks(m, readable, reportLabel, meet, me) }))
      .filter((g) => g.items.length);
  }, [meta, reports, meet, me]);

  // The page's own entry is in view when the page opens, and after a move to a page whose entry is not.
  const { pathname } = useLocation();
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".sidebar > nav");
    const here = scroller?.querySelector<HTMLElement>(".nav-link.active");
    if (!scroller || !here) return;
    const box = scroller.getBoundingClientRect();
    const at = here.getBoundingClientRect();
    if (at.top < box.top || at.bottom > box.bottom) scroller.scrollTop += at.top - box.top - box.height / 3;
  }, [pathname, groups.length]);

  return (
    <nav aria-label={tr("Main")}>
      <NavLink to="/" end className="nav-link">
        <NavIcon to="/" />
        <span className="nav-label">{tr("Home")}</span>
      </NavLink>
      {/* Other apps are in the platform's bar's launcher. */}
      {groups.map((g) => (
        <details key={g.name} className="nav-group" open>
          <summary>
            <span>{isolate(g.label)}</span>
            <Icon name="chevronRight" size={12} />
          </summary>
          {g.items.map((i) =>
            i.href ? (
              <a key={i.to} href={i.href} className="nav-link">
                <NavIcon {...i} />
                <span className="nav-label">{isolate(i.label)}</span>
              </a>
            ) : (
              <NavLink key={i.to} to={i.to} className="nav-link">
                <NavIcon {...i} />
                <span className="nav-label">{isolate(i.label)}</span>
              </NavLink>
            ),
          )}
        </details>
      ))}
      {me?.user.is_admin && (
        <details className="nav-group" open>
          <summary>
            <span>{tr("Administration")}</span>
            <Icon name="chevronRight" size={12} />
          </summary>
          {/* The shell's pages, outside this app's routes: a page load, not a client-side route. */}
          <a href="/store/" className="nav-link">
            <NavIcon icon="layout-grid" />
            <span className="nav-label">{tr("Apps")}</span>
            <NavGlyph external />
          </a>
          <a href="/admin/" className="nav-link">
            <NavIcon icon="shield" />
            <span className="nav-label">{tr("Admin")}</span>
            <NavGlyph external />
          </a>
          {frameHasPages ? (
            <NavLink to="/customize" className="nav-link">
              <NavIcon icon="sliders-horizontal" />
              <span className="nav-label">{tr("Customize")}</span>
            </NavLink>
          ) : (
            <a href="/data/customize/" className="nav-link">
              <NavIcon icon="sliders-horizontal" />
              <span className="nav-label">{tr("Customize")}</span>
              <NavGlyph external />
            </a>
          )}
        </details>
      )}
    </nav>
  );
}

/** The mark at the end of a sidebar entry that leads outside this app; the row's own icon leads it (NavIcon). */
function NavGlyph({ external }: { external?: boolean }) {
  return external ? <Icon name="external" size={14} /> : null;
}

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const close = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setErrors({});
    onClose();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setErrors({ confirm: tr("Passwords do not match") });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await api.post("/api/auth/password", { current_password: current, new_password: next }, { noAuthRedirect: true });
      toast(tr("Password changed"));
      close();
    } catch (err) {
      const fields = (err as { fields?: { field: string; message: string }[] }).fields ?? [];
      if (fields.length) setErrors(Object.fromEntries(fields.map((f) => [f.field, f.message])));
      else setErrors({ form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={close} title={tr("Change password")}>
      <form className="stack" onSubmit={submit}>
        {errors.form && <Alert tone="error">{isolate(errors.form)}</Alert>}
        <Field label={tr("Current password")} htmlFor="pw-current" required error={errors.current_password}>
          <input id="pw-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field
          label={tr("New password")}
          htmlFor="pw-new"
          required
          error={errors.new_password ?? errors.password}
          hint={tr("At least 10 characters, with 3 of: lower case, upper case, digit, symbol.")}
        >
          <input id="pw-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
        </Field>
        <Field label={tr("Confirm new password")} htmlFor="pw-confirm" required error={errors.confirm}>
          <input id="pw-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={close}>{tr("Cancel")}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {tr("Change password")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Ferrum speaks MCP: assistants that support remote MCP servers sign in with OAuth and then act
 *  with exactly this user's permissions. */
export function ConnectAi() {
  const url = `${window.location.origin}/mcp`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(tr("Address copied"));
    } catch {
      toast(tr("Copy the address manually"), "error");
    }
  };
  return (
    <div className="stack">
      <p>
        {tr("Add Ferrum as a remote MCP server (connector) in your AI assistant, then sign in when it asks. The assistant can then search, create and update records, run actions and reports — with your permissions, and every change in the audit trail.")}
      </p>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input className="input mono" readOnly value={url} aria-label={tr("MCP server address")} onFocus={(e) => e.currentTarget.select()} />
        <Button icon="copy" onClick={() => void copy()}>
          {tr("Copy")}
        </Button>
      </div>
      <p className="muted">{tr("Assistants without sign-in support can use an API key instead: send it as a bearer token.")}</p>
    </div>
  );
}
