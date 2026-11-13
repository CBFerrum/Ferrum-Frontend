// The router an app's own interface makes (docs/plan/apps-ui.md §13). React Router warns on every page load ("No
// `HydrateFallback` element provided to render during initial hydration") when the route it starts on loads lazily
// and no route above it can draw a wait. An app's routes are its own (a root with lazy children), so the fallback is
// given here once: to each top route that has none.

import { createBrowserRouter, type DataRouteObject, type RouteObject } from "react-router";
import { PageLoading } from "@/ui/kit";

const Loading = () => <PageLoading />;

/** The routes, each top route with a `HydrateFallback` (its own is kept). */
export function withHydrateFallback(routes: RouteObject[]): RouteObject[] {
  return routes.map((r) => (r.HydrateFallback || r.hydrateFallbackElement ? r : ({ ...r, HydrateFallback: Loading } as RouteObject)));
}

/** `createBrowserRouter` for an app's routes: use it instead of `createBrowserRouter` in the app's `main.tsx`. */
export function createAppRouter(routes: RouteObject[], opts?: Parameters<typeof createBrowserRouter>[1]) {
  return createBrowserRouter(withHydrateFallback(routes) as DataRouteObject[], opts);
}
