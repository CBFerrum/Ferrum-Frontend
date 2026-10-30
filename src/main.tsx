import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider, useRouteError } from "react-router";
import { AdminPage } from "./app/Admin";
import { AppsPage } from "./app/Apps";
import { AppSettingsPage, ScreenPage } from "./app/Screen";
import { CustomizePage } from "./app/Customize";
import { FormView } from "./app/FormView";
import { Home } from "./app/Home";
import { ListView } from "./app/ListView";
import { Login } from "./app/Login";
import { OAuthAuthorize } from "./app/OAuthAuthorize";
import { ReportView } from "./app/ReportView";
import { RequireAuth } from "./app/Shell";
import { ReportList } from "./app/studio/ReportList";
import { dashboardRoutes } from "./app/studio/Dashboards";
import { spaceRoutes } from "./app/studio/Spaces";
import { setUnauthorizedHandler } from "./lib/api";
import { setupPwa } from "./lib/pwa";
import "./index.css";
import { ConfirmHost, EmptyState, ErrorState, Toaster } from "./ui/kit";

const queryClient = new QueryClient({
  // The API client retries connection errors itself; query-level retries would only repeat 4xx.
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

function RouteError() {
  return <ErrorState error={useRouteError()} onRetry={() => window.location.reload()} />;
}

function NotFound() {
  return (
    <EmptyState title="Page not found">
      <Link to="/">Go to the home page</Link>
    </EmptyState>
  );
}

// /app (no slash) is outside the service worker's scope, /app/ is the same page inside it.
if (window.location.pathname === "/app") window.history.replaceState(null, "", `/app/${window.location.search}${window.location.hash}`);

const router = createBrowserRouter(
  [
    { path: "/login", element: <Login />, errorElement: <RouteError /> },
    { path: "/oauth/authorize", element: <OAuthAuthorize />, errorElement: <RouteError /> },
    {
      path: "/",
      element: <RequireAuth />,
      errorElement: <RouteError />,
      children: [
        { index: true, element: <Home /> },
        { path: "e/:entity", element: <ListView /> },
        { path: "e/:entity/:id", element: <FormView /> },
        { path: "r/:name", element: <ReportView /> },
        { path: "customize/:entity?", element: <CustomizePage /> },
        // The form designer and the report builder (with the charting library) load on first use.
        { path: "customize/:entity/form", lazy: () => import("./app/FormDesigner").then((m) => ({ Component: m.FormDesignerPage })) },
        { path: "studio/reports", element: <ReportList /> },
        { path: "studio/reports/new", lazy: () => import("./app/studio/ReportBuilder").then((m) => ({ Component: m.ReportBuilder })) },
        { path: "studio/reports/:id", lazy: () => import("./app/studio/ReportBuilder").then((m) => ({ Component: m.ReportBuilder })) },
        { path: "pos", lazy: () => import("./app/pos/Register").then((m) => ({ Component: m.RegisterPage })) },
        { path: "chat/:channel?", lazy: () => import("./app/comms/Chat").then((m) => ({ Component: m.ChatPage })) },
        { path: "calendar", lazy: () => import("./app/comms/Calendar").then((m) => ({ Component: m.CalendarPage })) },
        { path: "mail/:mailbox?/:email?", lazy: () => import("./app/comms/Mail").then((m) => ({ Component: m.MailPage })) },
        ...dashboardRoutes,
        ...spaceRoutes,
        { path: "admin", element: <AdminPage /> },
        { path: "apps", element: <AppsPage /> },
        { path: "drive/:folder?", lazy: () => import("./app/drive/Drive").then((m) => ({ Component: m.DrivePage })) },
        { path: "edit/:file", lazy: () => import("./app/drive/Drive").then((m) => ({ Component: m.EditPage })) },
        { path: "edit/:file/:editor", lazy: () => import("./app/drive/BrowserEdit").then((m) => ({ Component: m.BrowserEditPage })) },
        { path: "apps/:app/settings", element: <AppSettingsPage /> },
        { path: "x/:app/:page", element: <ScreenPage /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: "/app/" }, // root links stay at /app/, inside the service worker's scope
);

// Any 401 (expired or revoked session) sends the user back to the login page.
setUnauthorizedHandler(() => {
  const here = window.location.pathname.replace(/^\/app/, "") || "/";
  if (here.startsWith("/login")) return;
  void router.navigate("/login", { replace: true, state: { from: here + window.location.search } }).then(() => queryClient.clear());
});

setupPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
      <ConfirmHost />
    </QueryClientProvider>
  </StrictMode>,
);
