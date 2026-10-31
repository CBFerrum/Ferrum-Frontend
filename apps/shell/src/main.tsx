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
import { createBrowserRouter, Link, Outlet, RouterProvider, useParams, useRouteError, type RouteObject } from "react-router";
import { bootstrap, routeBase, shell } from "@ferrum/client";
import { recordsRoutes } from "@/app/recordsRoutes";
import { RequireAuth, setFrameMode } from "@/app/Shell";
import { setUnauthorizedHandler } from "@/lib/api";
import "@/index.css";
import { ConfirmHost, EmptyState, ErrorState, Toaster } from "@/ui/kit";


const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

function RouteError() {
  return <ErrorState error={useRouteError()} onRetry={() => window.location.reload()} />;
}

function NotFound() {
  return (
    <EmptyState title="Page not found">
      <a href="/">Go to Home</a>
    </EmptyState>
  );
}

/** A record link drawn by a shared component (`/e/{entity}/{id}`): to the app that shows it. */
function ToRecord() {
  const { entity, id } = useParams();
  useEffect(() => {
    location.replace(`/open/${encodeURIComponent(entity!)}${id ? `/${encodeURIComponent(id)}` : ""}`);
  }, [entity, id]);
  return null;
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

const toRecord: RouteObject[] = [
  { path: "e/:entity", element: <ToRecord /> },
  { path: "e/:entity/:id", element: <ToRecord /> },
];

// Each page loads when first opened: the release's first script holds only the frame (§12.9).
const apps = () => import("@/app/Apps").then((m) => ({ Component: m.AppsPage }));
const pages: Record<string, RouteObject[]> = {
  "": [{ index: true, lazy: () => import("./Home").then((m) => ({ Component: m.ShellHome })) }, ...toRecord],
  store: [
    { index: true, lazy: apps },
    { path: "apps", lazy: apps },
    { path: "apps/:app/settings", lazy: () => import("@/app/Screen").then((m) => ({ Component: m.AppSettingsPage })) },
    ...toRecord,
  ],
  admin: [{ index: true, lazy: () => import("@/app/Admin").then((m) => ({ Component: m.AdminPage })) }, ...toRecord],
  account: [{ index: true, lazy: () => import("./Account").then((m) => ({ Component: m.AccountPage })) }, ...toRecord],
  data: [
    { index: true, element: <DataIndex /> },
    { path: "e/:entity", lazy: () => import("@/app/ListView").then((m) => ({ Component: m.ListView })) },
    { path: "e/:entity/:id", lazy: () => import("@/app/FormView").then((m) => ({ Component: m.FormView })) },
    { path: "r/:name", lazy: () => import("@/app/ReportView").then((m) => ({ Component: m.ReportView })) },
    // Customize, for every workspace on the shell, with ERP or without.
    { path: "customize/:entity?", lazy: () => import("@/app/Customize").then((m) => ({ Component: m.CustomizePage })) },
    { path: "customize/:entity/form", lazy: () => import("@/app/FormDesigner").then((m) => ({ Component: m.FormDesignerPage })) },
  ],
};

function DataIndex() {
  return (
    <EmptyState title="Records">
      <p className="muted">
        Open a list from an app, or from <Link to="/e/User">people</Link>.
      </p>
    </EmptyState>
  );
}

/** The records frame: every page tells the shell it started. */
function Records() {
  useEffect(() => shell().ready(), []);
  return <RequireAuth />;
}

const entry = bootstrap()?.app?.entry ?? "";
const scope = entry === "data" ? bootstrap()?.app?.scope : null;
if (scope) setFrameMode("app", scope.packages, { pages: true });
// The accounts host (shapes B and C): its own page, without the bar, for every address there.
const router = entry === "accounts"
  ? createBrowserRouter([{ path: "*", lazy: () => import("./Accounts").then((m) => ({ Component: m.AccountsPage })), errorElement: <RouteError /> }])
  : scope
  ? createBrowserRouter(
      [{ path: "/", element: <Records />, errorElement: <RouteError />, children: [{ index: true, lazy: () => import("@/app/Home").then((m) => ({ Component: m.Home })) }, ...recordsRoutes, { path: "*", element: <NotFound /> }] }],
      { basename: `${routeBase("data")}${scope.app}` },
    )
  : createBrowserRouter(
      [{ path: "/", element: <Page />, errorElement: <Page><RouteError /></Page>, children: [...(pages[entry] ?? pages[""]), { path: "*", element: <NotFound /> }] }],
      { basename: routeBase(entry) },
    );

// An ended session: sign in again, then back here.
setUnauthorizedHandler(() => shell().session.reauthenticate());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
      <ConfirmHost />
    </QueryClientProvider>
  </StrictMode>,
);
