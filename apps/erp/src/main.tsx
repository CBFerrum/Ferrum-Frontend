// ERP's own interface at /erp/ (docs/plan/apps-ui.md §13): today's records and ERP pages under the
// platform's bar. The sidebar shows ERP's modules; other apps are in the bar's launcher, and the
// shell's pages (apps, administration, the account) are page loads away.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider, useRouteError } from "react-router";
import { routeBase, shell } from "@ferrum/client";
import { CustomizePage } from "@/app/Customize";
import { FormView } from "@/app/FormView";
import { Home } from "@/app/Home";
import { ListView } from "@/app/ListView";
import { ReportView } from "@/app/ReportView";
import { AppSettingsPage, ScreenPage } from "@/app/Screen";
import { RequireAuth, setFrameMode } from "@/app/Shell";
import { dashboardRoutes } from "@/app/studio/Dashboards";
import { ReportList } from "@/app/studio/ReportList";
import { spaceRoutes } from "@/app/studio/Spaces";
import { setUnauthorizedHandler } from "@/lib/api";
import "@/index.css";
import { ConfirmHost, EmptyState, ErrorState, Toaster } from "@/ui/kit";

/** ERP's packages: the sidebar shows their modules. */
const ERP_PACKAGES = ["core", "accounting", "selling", "buying", "inventory", "manufacturing", "india"];

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

function RouteError() {
  return <ErrorState error={useRouteError()} onRetry={() => window.location.reload()} />;
}

function NotFound() {
  return (
    <EmptyState title="Page not found">
      <Link to="/">Go to ERP's home</Link>
    </EmptyState>
  );
}

/** ERP's home: its modules, with the start-up signal. */
function ErpHome() {
  useEffect(() => shell().ready(), []);
  return <Home />;
}

/** Every page tells the shell it started (the home does too; once is enough). */
function Started() {
  useEffect(() => shell().ready(), []);
  return null;
}

setFrameMode("app", ERP_PACKAGES);

const router = createBrowserRouter(
  [
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
        { index: true, element: <ErpHome /> },
        { path: "e/:entity", element: <ListView /> },
        { path: "e/:entity/:id", element: <FormView /> },
        { path: "r/:name", element: <ReportView /> },
        { path: "customize/:entity?", element: <CustomizePage /> },
        { path: "customize/:entity/form", lazy: () => import("@/app/FormDesigner").then((m) => ({ Component: m.FormDesignerPage })) },
        { path: "studio/reports", element: <ReportList /> },
        { path: "studio/reports/new", lazy: () => import("@/app/studio/ReportBuilder").then((m) => ({ Component: m.ReportBuilder })) },
        { path: "studio/reports/:id", lazy: () => import("@/app/studio/ReportBuilder").then((m) => ({ Component: m.ReportBuilder })) },
        { path: "pos", lazy: () => import("@/app/pos/Register").then((m) => ({ Component: m.RegisterPage })) },
        ...dashboardRoutes,
        ...spaceRoutes,
        { path: "apps/:app/settings", element: <AppSettingsPage /> },
        { path: "x/:app/:page", element: <ScreenPage /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: routeBase("erp") },
);

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
