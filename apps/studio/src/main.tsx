// Studio's own interface at /studio/ (docs/plan/apps-ui.md §13): reports, charts, number cards,
// dashboards and spaces, customer solutions with their runs and tasks, in the records frame with Studio's module in the sidebar. Studio's pages
// link to `/studio/…` themselves, so the router sits at the site's root and holds them there;
// what is not Studio's goes where it lives: a record or a list to its app (`/open`), a named
// report and Customize to the platform's records (`/data/`).
// ponytail: Studio's address is fixed at /studio/; an operator's remapped route needs the pages'
// links to come from the bootstrap.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, Navigate, RouterProvider, useLocation, useRouteError, type RouteObject } from "react-router";
import { shell, t, wordsReady } from "@ferrum/client";
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
    <EmptyState title={t("Page not found")}>
      <Link to="/studio">{t("Go to Studio")}</Link>
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
  // Customer solutions, their runs and people's tasks (Ferrum's docs/logic/studio.md).
  { path: "studio/solutions", lazy: () => import("@/app/studio/solutions/SolutionsPage").then((m) => ({ Component: m.SolutionsPage })) },
  { path: "studio/solutions/drafts/:id", lazy: () => import("@/app/studio/solutions/DraftEditor").then((m) => ({ Component: m.DraftEditor })) },
  { path: "studio/solutions/releases/:id", lazy: () => import("@/app/studio/solutions/ReleasePage").then((m) => ({ Component: m.ReleasePage })) },
  { path: "studio/calendars", lazy: () => import("@/app/studio/solutions/CalendarsPage").then((m) => ({ Component: m.CalendarsPage })) },
  { path: "studio/runs", lazy: () => import("@/app/studio/runs/RunsPage").then((m) => ({ Component: m.RunsPage })) },
  { path: "studio/runs/:id", lazy: () => import("@/app/studio/runs/RunsPage").then((m) => ({ Component: m.RunPage })) },
  { path: "studio/tasks", lazy: () => import("@/app/studio/runs/TasksPage").then((m) => ({ Component: m.TasksPage })) },
  { path: "studio/tasks/:id", lazy: () => import("@/app/studio/runs/TasksPage").then((m) => ({ Component: m.TaskPage })) },
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
