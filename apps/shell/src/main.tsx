// The shell's own interface (docs/plan/apps-ui.md §8): Home at /, the store at /store/,
// administration at /admin/, the person's account at /account/ and the records of any entity at
// /data/. The server serves each of these core pages from this one release; the page that was
// asked for (the bootstrap's entry) picks its routes, and moving between them is a page load, as
// between apps. An app without an interface of its own has its records at /data/{app}/: the
// records frame ERP's interface uses, with that app's modules (§10.1, records-only). On the
// accounts host (shapes B and C) it is the Ferrum account's page instead (Accounts.tsx).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider, useRouteError } from "react-router";
import { bootstrap, routeBase, shell, t, wordsReady } from "@ferrum/client";
import { recordsRoutes } from "@/app/recordsRoutes";
import { RequireAuth, setFrameMode } from "@/app/Shell";
import { pages } from "./routes";
import "@/index.css";
import { ConfirmHost, EmptyState, ErrorState, PageLoading, Toaster } from "@/ui/kit";


const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

/** What a page shows while its code and first answers come: the router warns when a route that loads lazily has none to draw. */
const Loading = () => <PageLoading />;

function RouteError() {
  return <ErrorState error={useRouteError()} onRetry={() => window.location.reload()} />;
}

function NotFound() {
  return (
    <EmptyState title={t("Page not found")}>
      <a href="/">{t("Go to Home")}</a>
    </EmptyState>
  );
}

/** Every page: the content below the platform's bar, and the start-up signal. */
function Page({ children }: { children?: ReactNode }) {
  useEffect(() => shell().ready(), []);
  return (
    <main id="main" tabIndex={-1} className="shell-main">
      {children ?? <Outlet />}
    </main>
  );
}

/** The records frame: every page tells the shell it started. */
function Records() {
  useEffect(() => shell().ready(), []);
  return <RequireAuth />;
}

const entry = bootstrap()?.app?.entry ?? "";
const scope = entry === "data" ? bootstrap()?.app?.scope : null;
if (scope) setFrameMode("app", scope.packages, { pages: true, modules: scope.modules });
// The accounts host (shapes B and C): its own page, without the bar, for every address there.
const router = entry === "accounts"
  ? createBrowserRouter([{ path: "*", HydrateFallback: Loading, lazy: () => import("./Accounts").then((m) => ({ Component: m.AccountsPage })), errorElement: <RouteError /> }])
  : scope
  ? createBrowserRouter(
      [{ path: "/", HydrateFallback: Loading, element: <Records />, errorElement: <RouteError />, children: [{ index: true, lazy: () => import("@/app/Home").then((m) => ({ Component: m.Home })) }, ...recordsRoutes, { path: "*", element: <NotFound /> }] }],
      { basename: `${routeBase("data")}${scope.app}` },
    )
  : createBrowserRouter(
      [{ path: "/", HydrateFallback: Loading, element: <Page />, errorElement: <Page><RouteError /></Page>, children: [...(pages[entry] ?? pages[""]), { path: "*", element: <NotFound /> }] }],
      { basename: routeBase(entry) },
    );

// Drawn once the page's words are in (its language's catalogs, fetched as the page starts).
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
