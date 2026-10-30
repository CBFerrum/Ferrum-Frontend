// Small pieces the dashboard screens share: page header and states, a confirmation dialog that
// also works inside sheets, the unsaved-changes guard, reduced motion and link helpers.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useBlocker, useHref, type BlockerFunction, type NavigateFunction } from "react-router";
import { bootstrap } from "@ferrum/client";
import { AlertCircle, RefreshCw, type LucideIcon } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (fn: () => void) => {
  const mql = window.matchMedia(REDUCE);
  mql.addEventListener("change", fn);
  return () => mql.removeEventListener("change", fn);
};

/** The viewer asked for less motion: charts draw without animating. */
export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(REDUCE).matches,
    () => false,
  );

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1 basis-64">
        {eyebrow && <div className="mb-1 text-xs text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-xl leading-tight font-semibold [overflow-wrap:anywhere]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function LoadingBlock({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry, title = "Something went wrong", className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  return (
    <Empty className={cn("border", className)} role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="text-destructive">
          <AlertCircle />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{errorMessage(error)}</EmptyDescription>
      </EmptyHeader>
      {onRetry && (
        <EmptyContent>
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw /> Try again
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

export function EmptyBlock({ icon: Icon, title, children, action, className }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Empty className={cn("border", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

/** A confirmation as a promise; render `dialog` once. Works inside sheets and dialogs (focus stays trapped correctly). */
export function useConfirm() {
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setReq({ ...o, resolve })), []);
  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  const dialog = (
    <AlertDialog open={!!req} onOpenChange={(open) => !open && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{req?.title}</AlertDialogTitle>
          {req?.message && <AlertDialogDescription>{req.message}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction className={req?.danger ? "bg-destructive text-white hover:bg-destructive/90" : undefined} onClick={() => close(true)}>
            {req?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, dialog };
}

/**
 * Asks before unsaved changes are lost: leaving the page in the app (`when` decides which
 * navigations count; by default any other path) or closing the tab. Render `dialog`; call
 * `allowLeave` right before navigating away on purpose (after saving), in the same event.
 */
export function useUnsavedGuard(dirty: boolean, when?: BlockerFunction): { allowLeave: () => void; dialog: ReactNode } {
  const { confirm, dialog } = useConfirm();
  const state = useRef({ dirty, when, skip: false });
  state.current.dirty = dirty;
  state.current.when = when;
  const blocker = useBlocker((args) => {
    const s = state.current;
    if (s.skip) {
      s.skip = false;
      return false;
    }
    return s.dirty && (s.when ? s.when(args) : args.currentLocation.pathname !== args.nextLocation.pathname);
  });
  const asked = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || asked.current) return;
    asked.current = true;
    void confirm({ title: "Discard your changes?", message: "You have unsaved changes. Leaving now discards them.", confirmLabel: "Discard", danger: true }).then((ok) => {
      asked.current = false;
      if (ok) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker, confirm]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);
  const allowLeave = useCallback(() => {
    state.current.skip = true;
  }, []);
  return { allowLeave, dialog };
}

/**
 * The guard as a component, for editors that guard only as pages (a builder inside a dashboard's
 * sheet leaves that to the dashboard: a router honours one guard at a time).
 */
export function UnsavedGuard({ dirty, allowRef }: { dirty: boolean; allowRef: { current: () => void } }) {
  const { allowLeave, dialog } = useUnsavedGuard(dirty);
  allowRef.current = allowLeave; // stable: the same function on every render
  return <>{dialog}</>;
}

/** Loading or failing inside a sheet: still a way out. */
export function SheetState({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b p-4">
        <span className="font-medium">{title}</span>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}

/** A link target: app paths (`/app/...`, or `/...` other than server paths) stay in the app, other addresses open in a new tab.
 *  In an app's own interface (docs/plan/apps-ui.md §11.2) only its own routes stay in it; another app's page is a page load. */
export function SmartLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const base = useHref("/");
  if (href.startsWith("/") && !href.startsWith("//") && !/^\/(api|files|mcp|ws)(\/|$)/.test(href)) {
    const app = bootstrap()?.app;
    if (app) {
      const own = Object.values(app.routes).some((r) => href === r.replace(/\/$/, "") || href.startsWith(r)) && href.startsWith(base.replace(/\/$/, ""));
      if (!own)
        return (
          <a href={href} className={className}>
            {children}
          </a>
        );
      return (
        <Link to={`/${href.slice(base.length).replace(/^\/+/, "")}`} className={className}>
          {children}
        </Link>
      );
    }
    const to = href.startsWith("/app/") ? href.slice(4) : href === "/app" ? "/" : href;
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Classes that keep a link looking like plain text (the app's base styles color and underline links). */
export const plainLink = "text-inherit no-underline hover:no-underline";

/** Back to the previous page in the app, or to `fallback` when this page was opened directly. */
export function goBack(navigate: NavigateFunction, fallback: string) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) void navigate(-1);
  else void navigate(fallback);
}

// ───────────────────────────── form sections ─────────────────────────────

export function Section({ title, hint, children, action }: { title: string; hint?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

export function Messages({ list, className }: { list: string[]; className?: string }) {
  if (!list.length) return null;
  return (
    <div className={cn("grid gap-0.5", className)} role="alert">
      {list.map((m) => (
        <p key={m} className="text-xs text-destructive">
          {m}
        </p>
      ))}
    </div>
  );
}
