import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider, useRouteError } from "react-router";
import { AdminPage } from "./app/Admin";
import { AppsPage } from "./app/Apps";
import { CustomizePage } from "./app/Customize";
import { FormView } from "./app/FormView";
import { Home } from "./app/Home";
import { ListView } from "./app/ListView";
import { Login } from "./app/Login";
import { OAuthAuthorize } from "./app/OAuthAuthorize";
import { ReportView } from "./app/ReportView";
import { RequireAuth } from "./app/Shell";
import { setUnauthorizedHandler } from "./lib/api";
import { setupPwa } from "./lib/pwa";
import "./styles.css";
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
        { path: "admin", element: <AdminPage /> },
        { path: "apps", element: <AppsPage /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: "/app" },
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
