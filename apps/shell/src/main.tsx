// The shell's own interface (docs/plan/apps-ui.md §8): Home at /, the store at /store/,
// administration at /admin/, the person's account at /account/ and the records of any entity at
// /data/. The server serves each of these core pages from this one release; the page that was
// asked for (the bootstrap's entry) picks its routes, and moving between them is a page load, as
// between apps.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, Outlet, RouterProvider, useParams, useRouteError, type RouteObject } from "react-router";
import { bootstrap, routeBase, shell } from "@ferrum/client";
import { AdminPage } from "@/app/Admin";
import { AppsPage } from "@/app/Apps";
import { FormView } from "@/app/FormView";
import { ListView } from "@/app/ListView";
import { ReportView } from "@/app/ReportView";
import { AppSettingsPage } from "@/app/Screen";
import { setUnauthorizedHandler } from "@/lib/api";
import "@/index.css";
import { ConfirmHost, EmptyState, ErrorState, Toaster } from "@/ui/kit";
import { AccountPage } from "./Account";
import { ShellHome } from "./Home";

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

const pages: Record<string, RouteObject[]> = {
  "": [{ index: true, element: <ShellHome /> }, ...toRecord],
  store: [
    { index: true, element: <AppsPage /> },
    { path: "apps", element: <AppsPage /> },
    { path: "apps/:app/settings", element: <AppSettingsPage /> },
    ...toRecord,
  ],
  admin: [{ index: true, element: <AdminPage /> }, ...toRecord],
  account: [{ index: true, element: <AccountPage /> }, ...toRecord],
  data: [
    { index: true, element: <DataIndex /> },
    { path: "e/:entity", element: <ListView /> },
    { path: "e/:entity/:id", element: <FormView /> },
    { path: "r/:name", element: <ReportView /> },
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

const entry = bootstrap()?.app?.entry ?? "";
const router = createBrowserRouter(
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
