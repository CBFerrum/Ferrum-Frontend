// App shell: auth guard, sidebar built from metadata modules, top bar (search, notifications,
// user menu), keyboard shortcuts (`/` search, Ctrl/Cmd+K command palette).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { Navigate, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router";
import { bootstrap, shell } from "@ferrum/client";
import { api, errorMessage, getSession, setSession, setUnauthorizedHandler } from "../lib/api";
import { notificationPath } from "../lib/links";
import { humanize, relativeTime } from "../lib/format";
import { can, useMe, useMetaIndex, useReports, type EntitySummary, type MetaIndex, type Module, type ReportDef } from "../lib/meta";
import { useContributions } from "../lib/screens";
import { live } from "../lib/live";
import { useInstall, useOnline, useOutdated } from "../lib/pwa";
import {
  Alert,
  Button,
  confirmDialog,
  Dialog,
  ErrorBoundary,
  ErrorState,
  Field,
  Icon,
  Menu,
  MenuItem,
  PageLoading,
  Spinner,
  toast,
  useDismiss,
} from "../ui/kit";
import { ApiKeys, CalendarApps } from "./Admin";
import { TwoFactorSettings } from "./TwoFactor";
import { dashboardNav } from "./studio/Dashboards";
import { reportNav } from "./studio/ReportList";
import { spaceNav } from "./studio/Spaces";

type NavItem = { label: string; to: string; icon: string };

/** The Studio app (package and module): its records open in their builders, not the generic list and form. */
export const STUDIO = "studio";
export const studioNav: NavItem[] = [...reportNav, ...dashboardNav, ...spaceNav];

/** The POS app's till, first in its module. */
export const POS = "pos";
export const registerNav: NavItem = { label: "Register", to: "/pos", icon: "store" };

/** The Mail app's team chat, first in its module (its API checks who may chat). */
export const COMMS_MODULE = "communication";
export const chatNav: NavItem = { label: "Chat", to: "/chat", icon: "chat" };
export const calendarNav: NavItem = { label: "Calendar", to: "/calendar", icon: "calendar" };
export const meetNav: NavItem = { label: "Meet", to: "/meet", icon: "video" };

/** The Docs app's page, first in its module. */
export const DOCS_MODULE = "docs";
export const docsNav: NavItem = { label: "Documents", to: "/docs", icon: "doc" };

/** A module's links (sidebar group, home card): its readable entities and reports; `meet` when
 *  video meetings are set up. */
export function moduleLinks(m: Module, readable: Map<string, EntitySummary>, reportLabel: Map<string, string>, meet = false): NavItem[] {
  if (m.name === STUDIO) return studioNav;
  const links = m.items.flatMap((item) => {
    if (item.startsWith("report:")) {
      const name = item.slice(7);
      return [{ to: `/r/${name}`, label: reportLabel.get(name) ?? humanize(name), icon: "chart" }];
    }
    const e = readable.get(item);
    return e ? [{ to: `/e/${e.name}`, label: e.label_plural, icon: "file" }] : [];
  });
  if (m.name === POS && readable.has("PosInvoice")) return [registerNav, ...links];
  if (m.name === COMMS_MODULE && readable.has("CalendarEvent")) return [chatNav, calendarNav, ...(meet ? [meetNav] : []), ...links];
  if (m.name === DOCS_MODULE && readable.has("DocsTemplate")) return [docsNav, ...links];
  return links;
}

/**
 * How the frame is used: `classic`, today's web app at /app/ with its own sign-in and account
 * menu; `app`, an app's interface under the platform's bar (docs/plan/apps-ui.md), whose session
 * is the browser's cookie and whose account menu, launcher and other apps are the bar's.
 */
export type FrameMode = "classic" | "app";
let frameMode: FrameMode = "classic";
/** In app mode, the packages whose modules the sidebar shows (the app's own); null: all. */
let framePackages: Set<string> | null = null;
/** Whether the frame's routes include the records pages beyond lists, forms and reports
 *  (`recordsRoutes`): Customize, Studio's builders and the POS till. Today's web app has them. */
let frameHasPages = true;

/** Set once, before the first render. An app's interface runs under the shell, which signs the
 *  person in again when the session ends; `pages` when its routes are `recordsRoutes`. */
export function setFrameMode(mode: FrameMode, packages?: string[], { pages = false }: { pages?: boolean } = {}): void {
  frameMode = mode;
  framePackages = packages ? new Set(packages) : null;
  frameHasPages = mode === "classic" || pages;
  if (mode === "app") setUnauthorizedHandler(() => shell().session.reauthenticate());
}

/** Whether the frame shows Studio's pages: they are among its routes, and Studio is its app's. */
function showsStudio(): boolean {
  return frameHasPages && (!framePackages || framePackages.has(STUDIO));
}

/** The app's name, as the bootstrap gives it (app mode). */
function appName(): string {
  return bootstrap()?.app?.title ?? "Ferrum";
}

/** Whether a module is the app's own: one its packages define (from a server that does not say,
 *  one listing entities of its packages or custom ones). */
export function ownModule(m: Module, meta: MetaIndex): boolean {
  if (m.name === STUDIO) return showsStudio();
  if (!framePackages) return true;
  if (m.package) return framePackages.has(m.package);
  return m.items.some((i) => {
    const pkg = meta.entities.find((e) => e.name === i)?.package;
    return !!pkg && (framePackages!.has(pkg) || pkg === "tenant");
  });
}

export function RequireAuth() {
  const location = useLocation();
  if (frameMode === "classic" && !getSession()) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
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
  const [palette, setPalette] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    if (navOpen) document.querySelector<HTMLElement>(".sidebar a")?.focus();
  }, [navOpen]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === "/" && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="shell" data-nav-open={navOpen}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {/* Any link closes the drawer, the current page's too (its path does not change). */}
      <aside className="sidebar" aria-label="Sidebar" onClick={(e) => (e.target as Element).closest("a") && setNavOpen(false)}>
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            {frameMode === "app" ? appName().slice(0, 2) : "Fe"}
          </span>
          {frameMode === "app" ? appName() : "Ferrum"}
        </NavLink>
        <Sidebar />
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <div className="main-col">
        <header className="topbar">
          <button type="button" className="icon-btn nav-toggle" aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
            <Icon name="menu" size={18} />
          </button>
          <NavPicker mode="inline" inputRef={searchRef} />
          <span className="spacer" />
          {/* Under the platform's bar, notifications and the account are the bar's. */}
          {frameMode === "classic" && <Notifications />}
          {frameMode === "classic" && <UserMenu />}
        </header>
        <OfflineBanner />
        <UpdateBanner />
        <main id="main" tabIndex={-1}>
          {meta.error ? (
            <ErrorState error={meta.error} onRetry={() => meta.refetch()} title="Could not load the application metadata" />
          ) : meta.isLoading ? (
            <PageLoading />
          ) : (
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          )}
        </main>
      </div>
      <Dialog open={palette} onClose={() => setPalette(false)} title="Go to…">
        <NavPicker mode="palette" onDone={() => setPalette(false)} />
      </Dialog>
    </div>
  );
}

function OfflineBanner() {
  if (useOnline()) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="alert" size={14} /> You are offline. Pages you open need a connection, and nothing can be saved until it is back.
    </div>
  );
}

// Once the user agreed to discard unsaved edits, the forms' beforeunload guards stay quiet. Added at startup,
// before any guard, so it runs first even in engines that call a target's listeners in the order added.
// Not where there is no window: @ferrum/records re-exports this module, and apps' tests import it in Node.
let discarding = false;
if (typeof window !== "undefined") window.addEventListener("beforeunload", (e) => discarding && e.stopImmediatePropagation(), { capture: true });

function UpdateBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (!useOutdated() || dismissed) return null;
  const reload = async () => {
    // A form with unsaved edits objects to unloading (FormView); ask here, as iOS never shows that prompt.
    if (!window.dispatchEvent(new Event("beforeunload", { cancelable: true }))) {
      const ok = await confirmDialog({ title: "Discard your changes?", message: "Reloading discards your unsaved edits.", confirmLabel: "Reload", danger: true });
      if (!ok) return;
      discarding = true; // asked already
    }
    window.location.reload();
  };
  return (
    <div className="update-banner" role="status">
      <Icon name="refresh" size={14} /> A new version of Ferrum is available.
      <Button size="sm" variant="primary" onClick={() => void reload()}>
        Reload
      </Button>
      <button type="button" className="icon-btn icon-btn-sm" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function Sidebar() {
  const meta = useMetaIndex().data;
  const reports = useReports().data?.reports;
  const me = useMe().data;
  const pages = useContributions("ui.page").data ?? [];
  // Mail, Chat, Calendar and Meet are Comms' own pages now (their links lead there): shown with
  // Comms, which says itself when hosted mail or meetings are not set up.
  const comms = !!meta?.packages.includes("comms") && !!meta.entities.some((e) => e.name === "CalendarEvent" && can(e.permissions, "read"));
  const meet = comms;
  const groups = useMemo(() => {
    if (!meta) return [];
    const readable = new Map(meta.entities.filter((e) => can(e.permissions, "read")).map((e) => [e.name, e]));
    const reportLabel = new Map(reportItems(meta, reports).map((r) => [r.name, r.label]));
    return [...meta.modules]
      .filter((m) => ownModule(m, meta))
      .sort((a, b) => a.order - b.order)
      .map((m) => ({ name: m.name, label: m.label, items: moduleLinks(m, readable, reportLabel, meet) }))
      .filter((g) => g.items.length);
  }, [meta, reports, meet]);

  return (
    <nav aria-label="Main">
      <NavLink to="/" end className="nav-link">
        <Icon name="home" />
        Home
      </NavLink>
      {/* Under the platform's bar, other apps are in its launcher. */}
      {frameMode === "classic" && comms && (
        <NavLink to="/mail" className="nav-link">
          <Icon name="mail" />
          Mail
        </NavLink>
      )}
      {frameMode === "classic" && meta?.packages.includes("drive") && (
        <NavLink to="/drive" className="nav-link">
          <Icon name="file" />
          Files
        </NavLink>
      )}
      {groups.map((g) => (
        <details key={g.name} className="nav-group" open>
          <summary>
            <Icon name="chevronRight" size={12} />
            {g.label}
          </summary>
          {g.items.map((i) => (
            <NavLink key={i.to} to={i.to} className="nav-link">
              <Icon name={i.icon} />
              {i.label}
            </NavLink>
          ))}
        </details>
      ))}
      {pages.length > 0 && (
        <details className="nav-group" open>
          <summary>
            <Icon name="chevronRight" size={12} />
            Add-ons
          </summary>
          {pages.map((p) => (
            <NavLink key={`${p.app}/${p.id}`} to={`/x/${p.app}/${p.id}`} className="nav-link">
              <Icon name={p.icon ?? "apps"} />
              {p.title}
            </NavLink>
          ))}
        </details>
      )}
      {me?.user.is_admin && (
        <details className="nav-group" open>
          <summary>
            <Icon name="chevronRight" size={12} />
            Administration
          </summary>
          {frameMode === "classic" ? (
            <>
              <NavLink to="/apps" className="nav-link">
                <Icon name="apps" />
                Apps
              </NavLink>
              <NavLink to="/admin" className="nav-link">
                <Icon name="settings" />
                Admin
              </NavLink>
            </>
          ) : (
            <>
              {/* The shell's pages, outside this app's routes: a page load, not a client-side route. */}
              <a href="/store/" className="nav-link">
                <Icon name="apps" />
                Apps
              </a>
              <a href="/admin/" className="nav-link">
                <Icon name="settings" />
                Admin
              </a>
            </>
          )}
          {frameHasPages ? (
            <NavLink to="/customize" className="nav-link">
              <Icon name="edit" />
              Customize
            </NavLink>
          ) : (
            <a href="/data/customize/" className="nav-link">
              <Icon name="edit" />
              Customize
            </a>
          )}
        </details>
      )}
    </nav>
  );
}

// ── search / command palette ──

interface NavTarget {
  label: string;
  hint: string;
  to: string;
  /** Another page (the shell's, another app's): loaded rather than routed to. */
  href?: string;
}

function useNavTargets(): NavTarget[] {
  const meta = useMetaIndex().data;
  const reports = useReports().data?.reports;
  const me = useMe().data;
  const meet = !!meta?.packages.includes("comms");
  return useMemo(() => {
    if (!meta) return [];
    const modLabel = new Map(meta.modules.map((m) => [m.name, m.label]));
    const out: NavTarget[] = [{ label: "Home", hint: "Page", to: "/" }];
    for (const e of meta.entities) {
      if (!can(e.permissions, "read") || e.module === STUDIO) continue;
      const hint = (e.module && modLabel.get(e.module)) || "Entity";
      out.push({ label: e.label_plural, hint, to: `/e/${e.name}` });
      if (can(e.permissions, "create") && e.kind !== "ledger") out.push({ label: `New ${e.label}`, hint, to: `/e/${e.name}/new` });
    }
    for (const r of reportItems(meta, reports)) out.push({ label: r.label, hint: "Report", to: `/r/${r.name}` });
    if (meta.packages.includes(STUDIO) && showsStudio()) for (const n of studioNav) out.push({ label: n.label, hint: "Studio", to: n.to });
    if (frameHasPages && meta.packages.includes(POS) && meta.entities.some((e) => e.name === "PosInvoice" && can(e.permissions, "create")))
      out.push({ label: "POS Register", hint: "POS", to: registerNav.to });
    // Under the platform's bar, Comms and Docs are apps of their own, in its launcher.
    if (frameMode === "classic" && meta.entities.some((e) => e.name === "CalendarEvent" && can(e.permissions, "read")))
      out.push({ label: "Chat", hint: "Communication", to: chatNav.to }, { label: "Calendar", hint: "Communication", to: calendarNav.to });
    if (frameMode === "classic" && meet) out.push({ label: "Meet", hint: "Communication", to: meetNav.to });
    if (frameMode === "classic" && meta.entities.some((e) => e.name === "DocsTemplate" && can(e.permissions, "read")))
      out.push({ label: "Documents", hint: "Docs", to: docsNav.to });
    if (me?.user.is_admin) {
      if (frameMode === "classic") out.push({ label: "Apps", hint: "Page", to: "/apps" }, { label: "Administration", hint: "Page", to: "/admin" });
      else out.push({ label: "Apps", hint: "Page", to: "", href: "/store/" }, { label: "Administration", hint: "Page", to: "", href: "/admin/" });
      out.push(frameHasPages ? { label: "Customize", hint: "Page", to: "/customize" } : { label: "Customize", hint: "Page", to: "", href: "/data/customize/" });
    }
    return out;
  }, [meta, reports, me, meet]);
}

function matchTargets(targets: NavTarget[], q: string): NavTarget[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const first = terms[0] ?? "";
  return targets
    .filter((t) => {
      const hay = `${t.label} ${t.hint}`.toLowerCase();
      return terms.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(first)) - Number(!b.label.toLowerCase().startsWith(first)));
}

function NavPicker({ mode, onDone, inputRef }: { mode: "inline" | "palette"; onDone?: () => void; inputRef?: RefObject<HTMLInputElement | null> }) {
  const targets = useNavTargets();
  const meta = useMetaIndex().data;
  const navigate = useNavigate();
  const entityMatch = useMatch("/e/:entity/*");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(mode === "palette");
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDismiss(wrap, open && mode === "inline", () => setOpen(false));

  const items = useMemo(() => {
    const text = q.trim();
    const list = text ? matchTargets(targets, text) : mode === "palette" ? targets : [];
    const e = meta?.entities.find((x) => x.name === entityMatch?.params.entity);
    const search: NavTarget[] =
      text && e ? [{ label: `Search ${e.label_plural} for “${text}”`, hint: "Search", to: `/e/${e.name}?q=${encodeURIComponent(text)}` }] : [];
    return [...list.slice(0, 59), ...search];
  }, [q, targets, mode, meta, entityMatch?.params.entity]);

  const go = (t: NavTarget | undefined) => {
    if (!t) return;
    if (t.href) return window.location.assign(t.href);
    navigate(t.to);
    setQ("");
    setOpen(mode === "palette");
    inputRef?.current?.blur();
    onDone?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const n = items.length || 1;
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[active]);
    } else if (e.key === "Escape" && mode === "inline") {
      setQ("");
      setOpen(false);
      e.currentTarget.blur();
    }
  };

  const showList = open && items.length > 0;
  return (
    <div className={mode === "inline" ? "search-box" : "palette"} ref={wrap}>
      {mode === "inline" && <Icon name="search" />}
      <input
        ref={inputRef}
        className="input"
        role="combobox"
        aria-label={mode === "inline" ? "Search or jump to (press /)" : "Go to entity, report or page"}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        placeholder={mode === "inline" ? "Search or jump to…" : "Type to filter…"}
        value={q}
        data-autofocus={mode === "palette" || undefined}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {mode === "inline" && !q && (
        <span className="kbd" aria-hidden="true">
          /
        </span>
      )}
      {showList && (
        <ul className="listbox" role="listbox" id={listId}>
          {items.map((t, i) => (
            <li
              key={`${t.to}|${t.label}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="option"
              onMouseDown={(e) => {
                e.preventDefault();
                go(t);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{t.label}</span>
              <small>{t.hint}</small>
            </li>
          ))}
        </ul>
      )}
      {mode === "palette" && q.trim() && !items.length && <p className="option-empty">No matches.</p>}
      {mode === "palette" && (
        <p className="field-hint" style={{ marginTop: 8 }}>
          <span className="kbd">↑</span> <span className="kbd">↓</span> to move, <span className="kbd">Enter</span> to open,{" "}
          <span className="kbd">Esc</span> to close
        </p>
      )}
    </div>
  );
}

// ── notifications ──

interface Notification {
  id: string;
  title: string;
  body?: string | null;
  entity?: string | null;
  record_id?: string | null;
  read_at?: string | null;
  created_at: string;
}

function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useDismiss(ref, open, () => setOpen(false));
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: ({ signal }) => api.get<{ notifications: Notification[] }>("/api/notifications", undefined, signal),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/api/notifications/${id}/read`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const list = q.data?.notifications ?? [];
  const unread = list.filter((n) => !n.read_at);

  const openOne = (n: Notification) => {
    if (!n.read_at) markRead.mutate(n.id);
    if (n.entity && n.record_id) {
      setOpen(false);
      navigate(notificationPath(n.entity, n.record_id));
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" size={18} />
        {unread.length > 0 && (
          <span className="count-dot" aria-hidden="true">
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="popover" id={panelId} role="region" aria-label="Notifications">
          <div className="card-head">
            <h2>Notifications</h2>
            <span className="spacer" />
            {unread.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => Promise.all(unread.map((n) => markRead.mutateAsync(n.id))).catch(() => undefined)}>
                Mark all read
              </Button>
            )}
          </div>
          {q.isLoading ? (
            <div className="state">
              <Spinner label="Loading notifications" />
            </div>
          ) : q.error ? (
            <p className="option-empty">{errorMessage(q.error)}</p>
          ) : !list.length ? (
            <p className="option-empty">You’re all caught up.</p>
          ) : (
            list.map((n) => (
              <button key={n.id} type="button" className={`notif ${n.read_at ? "" : "notif-unread"}`} onClick={() => openOne(n)}>
                <strong>{n.title}</strong>
                {n.body && <div className="muted">{n.body}</div>}
                <div className="faint" style={{ fontSize: 12 }}>
                  {relativeTime(n.created_at)}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── user menu ──

function UserMenu() {
  const me = useMe().data;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<"password" | "2fa" | "keys" | "cal" | "ai" | null>(null);
  const comms = !!useMetaIndex().data?.packages.includes("comms");
  const install = useInstall();

  const signOut = () => {
    // The browser's session ends too (the cookie, and every token bound to it).
    void api.post("/api/auth/logout", undefined, { noAuthRedirect: true }).catch(() => {});
    setSession(null);
    navigate("/login", { replace: true });
    qc.clear();
  };
  const signOutEverywhere = async () => {
    const ok = await confirmDialog({
      title: "Sign out everywhere?",
      message: "This ends every session of your account on all devices, including this one. API keys keep working.",
      confirmLabel: "Sign out everywhere",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post("/api/auth/logout_all");
      toast("Signed out of all sessions");
      signOut();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <>
      <Menu ariaLabel="Account menu" icon="user" buttonClass="icon-btn">
        {(close) => (
          <>
            <div className="menu-head">
              <strong>{me?.user.full_name ?? "…"}</strong>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {me?.user.email}
              </div>
              <div className="faint" style={{ fontSize: 12 }}>
                Workspace: {getSession()?.tenant}
              </div>
            </div>
            <MenuItem
              onSelect={() => {
                close();
                setDialog("password");
              }}
            >
              Change password
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close();
                setDialog("2fa");
              }}
            >
              Two-factor sign-in
            </MenuItem>
            {comms && (
              <MenuItem
                onSelect={() => {
                  close();
                  setDialog("cal");
                }}
              >
                Calendar and contacts apps
              </MenuItem>
            )}
            <MenuItem
              onSelect={() => {
                close();
                setDialog("keys");
              }}
            >
              API keys
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close();
                setDialog("ai");
              }}
            >
              Connect an AI assistant
            </MenuItem>
            {install && (
              <MenuItem
                onSelect={() => {
                  close();
                  void install();
                }}
              >
                Install the app
              </MenuItem>
            )}
            <MenuItem
              onSelect={() => {
                close();
                signOut();
              }}
            >
              Sign out
            </MenuItem>
            <MenuItem
              danger
              onSelect={() => {
                close();
                void signOutEverywhere();
              }}
            >
              Sign out everywhere
            </MenuItem>
          </>
        )}
      </Menu>
      <ChangePasswordDialog open={dialog === "password"} onClose={() => setDialog(null)} onSignedOut={signOut} />
      <Dialog open={dialog === "2fa"} onClose={() => setDialog(null)} title="Two-factor sign-in">
        {dialog === "2fa" && <TwoFactorSettings />}
      </Dialog>
      <Dialog open={dialog === "keys"} onClose={() => setDialog(null)} title="Your API keys" wide>
        <ApiKeys />
      </Dialog>
      <Dialog open={dialog === "cal"} onClose={() => setDialog(null)} title="Calendar and contacts apps" wide>
        {dialog === "cal" && <CalendarApps email={me?.user.email ?? ""} />}
      </Dialog>
      <Dialog open={dialog === "ai"} onClose={() => setDialog(null)} title="Connect an AI assistant">
        <ConnectAi />
      </Dialog>
    </>
  );
}

export function ChangePasswordDialog({ open, onClose, onSignedOut }: { open: boolean; onClose: () => void; onSignedOut: () => void }) {
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
      setErrors({ confirm: "Passwords do not match" });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await api.post("/api/auth/password", { current_password: current, new_password: next }, { noAuthRedirect: true });
      // Changing the password revokes every session, this one included: sign in again with it
      // (with two-factor sign-in, or one still to set up, through the sign-in page).
      const s = getSession();
      if (s) {
        const res = await api.post<{ token?: string; second_factor?: boolean; two_factor_setup?: boolean }>(
          "/api/auth/login",
          { tenant: s.tenant, email: s.email, password: next },
          { noAuthRedirect: true },
        );
        if (res.token && !res.two_factor_setup) setSession({ ...s, token: res.token });
        else {
          toast("Password changed; sign in again");
          close();
          onSignedOut();
          return;
        }
      }
      toast("Password changed");
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
    <Dialog open={open} onClose={close} title="Change password">
      <form className="stack" onSubmit={submit}>
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        <Field label="Current password" htmlFor="pw-current" required error={errors.current_password}>
          <input id="pw-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field
          label="New password"
          htmlFor="pw-new"
          required
          error={errors.new_password ?? errors.password}
          hint="At least 10 characters, with 3 of: lower case, upper case, digit, symbol."
        >
          <input id="pw-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" required error={errors.confirm}>
          <input id="pw-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Change password
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
      toast("Address copied");
    } catch {
      toast("Copy the address manually", "error");
    }
  };
  return (
    <div className="stack">
      <p>
        Add Ferrum as a remote MCP server (connector) in your AI assistant, then sign in when it asks. The assistant can then search, create and update records, run
        actions and reports — with your permissions, and every change in the audit trail.
      </p>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input className="input mono" readOnly value={url} aria-label="MCP server address" onFocus={(e) => e.currentTarget.select()} />
        <Button icon="copy" onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      <p className="muted">Assistants without sign-in support can use an API key instead: send it as a bearer token.</p>
    </div>
  );
}
