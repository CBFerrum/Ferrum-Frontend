// The records frame's pages (docs/plan/apps-ui.md §13) for the interfaces built here: ERP's, and
// the shell's records of an app without an interface of its own (/data/{app}/). Lists, forms and
// reports; Customize; other apps' screens and settings. Studio's builders and the POS till are
// their apps' own interfaces' (/studio/, /pos/): their links lead there. A frame with these routes
// says so: setFrameMode("app", packages, { pages: true }).

import { useEffect } from "react";
import { useLocation, type RouteObject } from "react-router";
import { CustomizePage } from "./Customize";
import { FormView } from "./FormView";
import { ListView } from "./ListView";
import { ReportView } from "./ReportView";
import { AppSettingsPage, ScreenPage } from "./Screen";

/** `…/studio/…` and `…/pos` in a frame: the same page in Studio's, or the till in the Point of
 *  Sale's, own interface (a page load). */
function ToOwnInterface() {
  const { pathname, search, hash } = useLocation();
  useEffect(() => location.replace(pathname + search + hash), [pathname, search, hash]);
  return null;
}

export const recordsRoutes: RouteObject[] = [
  { path: "e/:entity", element: <ListView /> },
  { path: "e/:entity/:id", element: <FormView /> },
  { path: "r/:name", element: <ReportView /> },
  { path: "customize/:entity?", element: <CustomizePage /> },
  { path: "customize/:entity/form", lazy: () => import("./FormDesigner").then((m) => ({ Component: m.FormDesignerPage })) },
  { path: "studio/*", element: <ToOwnInterface /> },
  { path: "pos", element: <ToOwnInterface /> },
  { path: "apps/:app/settings", element: <AppSettingsPage /> },
  { path: "x/:app/:page", element: <ScreenPage /> },
];
