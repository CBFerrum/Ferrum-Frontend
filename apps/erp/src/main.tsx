// ERP's own interface at /erp/ (docs/plan/apps-ui.md §13): today's records and ERP pages under the
// platform's bar. The sidebar shows ERP's modules; other apps are in the bar's launcher, and the
// shell's pages (apps, administration, the account) are page loads away.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider, useRouteError } from "react-router";
import { routeBase, shell } from "@ferrum/client";
import { Home } from "@/app/Home";
import { recordsRoutes } from "@/app/recordsRoutes";
import { RequireAuth, setFrameMode } from "@/app/Shell";
import { setUnauthorizedHandler } from "@/lib/api";
import "@/index.css";
import { ConfirmHost, EmptyState, ErrorState, Toaster } from "@/ui/kit";

/** ERP's packages and its add-ons': the sidebar shows their modules (Studio has its own interface). */
const ERP_PACKAGES = [
  ...["core", "parties", "products", "accounting", "selling", "buying", "inventory", "manufacturing"],
  ...["india", "finance", "procurement", "stock_ops", "mfg_ops"],
];

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

setFrameMode("app", ERP_PACKAGES, { pages: true });

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
        ...recordsRoutes,
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
