// The records frame's pages (docs/plan/apps-ui.md §13), exported as @ferrum/records/frame: ERP's
// interface (in ERP's repository) and the shell's records of an app without an interface of its own
// (/data/{app}/). Lists, forms and reports; Customize; other apps' screens and settings. Studio's
// builders and the POS till are their apps' own interfaces' (/studio/, /pos/): their links lead
// there. A frame with these routes says so: setFrameMode("app", packages, { pages: true }).

import { useEffect } from "react";
import { useLocation, type RouteObject } from "react-router";

/** `…/studio/…` and `…/pos` in a frame: the same page in Studio's, or the till in the Point of
 *  Sale's, own interface (a page load). */
function ToOwnInterface() {
  const { pathname, search, hash } = useLocation();
  useEffect(() => location.replace(pathname + search + hash), [pathname, search, hash]);
  return null;
}

// Each page loads when first opened, so an interface's first script holds only the frame
// (docs/plan/apps-ui.md §12.9: entry JavaScript ≤ 200 KB compressed).
export const recordsRoutes: RouteObject[] = [
  { path: "e/:entity", lazy: () => import("./ListView").then((m) => ({ Component: m.ListView })) },
  { path: "e/:entity/:id", lazy: () => import("./FormView").then((m) => ({ Component: m.FormView })) },
  { path: "r/:name", lazy: () => import("./ReportView").then((m) => ({ Component: m.ReportView })) },
  { path: "customize/:entity?", lazy: () => import("./Customize").then((m) => ({ Component: m.CustomizePage })) },
  { path: "customize/:entity/form", lazy: () => import("./FormDesigner").then((m) => ({ Component: m.FormDesignerPage })) },
  { path: "studio/*", element: <ToOwnInterface /> },
  { path: "pos", element: <ToOwnInterface /> },
  { path: "apps/:app/settings", lazy: () => import("./Screen").then((m) => ({ Component: m.AppSettingsPage })) },
  { path: "x/:app/:page", lazy: () => import("./Screen").then((m) => ({ Component: m.ScreenPage })) },
];
