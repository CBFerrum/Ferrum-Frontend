// What every app's own interface does to start (docs/plan/apps-ui.md §13), once: its words, its router at its
// address, and, once the page's words are in, the page under one query client with the platform's toasts and
// confirmations. The routes are the app's: what its pages are, where the records frame goes, what a missing page
// says and when it tells the shell it started (`shell().ready()`).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, type RouteObject } from "react-router";
import { addCatalogs, routeBase, wordsReady } from "@ferrum/client";
import { ConfirmHost, Toaster } from "../ui/kit";
import { createAppRouter } from "./appRouter";

/**
 * Draws an app's interface into `#root`: `routes` at the address of the app's `route` (`routeBase`), its own
 * `catalogs` (`{ ar: () => import("./locales/ar.json"), … }`) added first, and nothing drawn before the page's
 * words are in. Call it once, last, in the app's entry file, after `setFrameMode` when the app has the frame.
 */
export function mountApp({ route, routes, catalogs }: { route: string; routes: RouteObject[]; catalogs?: Parameters<typeof addCatalogs>[0] }): void {
  if (catalogs) void addCatalogs(catalogs);
  const router = createAppRouter(routes, { basename: routeBase(route) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } } });
  void wordsReady().then(() =>
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Toaster />
          <ConfirmHost />
        </QueryClientProvider>
      </StrictMode>,
    ),
  );
}
