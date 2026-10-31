// Studio's own interface at /studio/ (docs/plan/apps-ui.md §13): reports, charts, number cards,
// dashboards and spaces, in the records frame with Studio's module in the sidebar. Studio's pages
// link to `/studio/…` themselves, so the router sits at the site's root and holds them there;
// what is not Studio's goes where it lives: a record or a list to its app (`/open`), a named
// report and Customize to the platform's records (`/data/`).
// ponytail: Studio's address is fixed at /studio/; an operator's remapped route needs the pages'
// links to come from the bootstrap.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, Navigate, RouterProvider, useLocation, useRouteError, type RouteObject } from "react-router";
import { shell } from "@ferrum/client";
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
      <Link to="/studio">Go to Studio</Link>
    </EmptyState>
  );
}

/** Every page tells the shell it started. */
function Started() {
  useEffect(() => shell().ready(), []);
  return null;
}

/** A page that is not Studio's: loaded where it lives (`to` maps this address to that one). */
function Elsewhere({ to }: { to: (path: string) => string }) {
  const { pathname, search, hash } = useLocation();
  useEffect(() => {
    location.replace(to(pathname) + search + hash);
  }, [to, pathname, search, hash]);
  return null;
}

/** `/e/{entity}[/{id}]`: the record or list in the app that shows it. */
const toOpen = (path: string) => path.replace(/^\/e\//, "/open/");
/** `/r/{name}`, `/customize/…`: the platform's records pages. */
const toData = (path: string) => `/data${path}`;

setFrameMode("app", ["studio"], { pages: true });

// Each page loads when first opened: the first script holds only the frame (§12.9).
const reportBuilder = () => import("@/app/studio/ReportBuilder").then((m) => ({ Component: m.ReportBuilder }));
const spaceEditor = () => import("@/app/studio/SpaceEditor").then((m) => ({ Component: m.SpaceEditor }));
const studioRoutes: RouteObject[] = [
  { path: "studio", lazy: () => import("./StudioHome").then((m) => ({ Component: m.StudioHome })) },
  // Lists of charts and of number cards (`/open/DashboardChart`): the dashboards page's tabs.
  { path: "studio/charts", element: <Navigate to="/studio/dashboards?tab=charts" replace /> },
  { path: "studio/cards", element: <Navigate to="/studio/dashboards?tab=cards" replace /> },
  { path: "studio/reports", lazy: () => import("@/app/studio/ReportList").then((m) => ({ Component: m.ReportList })) },
  { path: "studio/reports/new", lazy: reportBuilder },
  { path: "studio/reports/:id", lazy: reportBuilder },
  { path: "studio/dashboards", lazy: () => import("@/app/studio/Dashboards").then((m) => ({ Component: m.DashboardsPage })) },
  { path: "studio/dashboards/:id", lazy: () => import("@/app/studio/DashboardView").then((m) => ({ Component: m.DashboardViewPage })) },
  { path: "studio/charts/:id", lazy: () => import("@/app/studio/ChartBuilder").then((m) => ({ Component: m.ChartBuilderPage })) },
  { path: "studio/cards/:id", lazy: () => import("@/app/studio/NumberCardBuilder").then((m) => ({ Component: m.NumberCardBuilderPage })) },
  { path: "studio/spaces", lazy: () => import("@/app/studio/Spaces").then((m) => ({ Component: m.SpacesPage })) },
  { path: "studio/spaces/new", lazy: spaceEditor },
  { path: "studio/spaces/:id", lazy: () => import("@/app/studio/SpaceView").then((m) => ({ Component: m.SpaceView })) },
  { path: "studio/spaces/:id/edit", lazy: spaceEditor },
];

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <>
        <Started />
        <RequireAuth />
      </>
    ),
    errorElement: <RouteError />,
    children: [
      // The frame's own "home" link: Studio's home.
      { index: true, element: <Navigate to="/studio" replace /> },
      ...studioRoutes,
      { path: "e/*", element: <Elsewhere to={toOpen} /> },
      { path: "r/*", element: <Elsewhere to={toData} /> },
      { path: "customize/*", element: <Elsewhere to={toData} /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

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
