// The records frame's pages (docs/plan/apps-ui.md §13) for the interfaces built here: ERP's, and
// the shell's records of an app without an interface of its own (/data/{app}/). Lists, forms and
// reports; Customize and Studio's builders until Studio has its own interface; the POS till until
// POS has its own; other apps' screens and settings. A frame with these routes says so:
// setFrameMode("app", packages, { pages: true }).

import type { RouteObject } from "react-router";
import { CustomizePage } from "./Customize";
import { FormView } from "./FormView";
import { ListView } from "./ListView";
import { ReportView } from "./ReportView";
import { AppSettingsPage, ScreenPage } from "./Screen";
import { dashboardRoutes } from "./studio/Dashboards";
import { ReportList } from "./studio/ReportList";
import { spaceRoutes } from "./studio/Spaces";

export const recordsRoutes: RouteObject[] = [
  { path: "e/:entity", element: <ListView /> },
  { path: "e/:entity/:id", element: <FormView /> },
  { path: "r/:name", element: <ReportView /> },
  { path: "customize/:entity?", element: <CustomizePage /> },
  { path: "customize/:entity/form", lazy: () => import("./FormDesigner").then((m) => ({ Component: m.FormDesignerPage })) },
  { path: "studio/reports", element: <ReportList /> },
  { path: "studio/reports/new", lazy: () => import("./studio/ReportBuilder").then((m) => ({ Component: m.ReportBuilder })) },
  { path: "studio/reports/:id", lazy: () => import("./studio/ReportBuilder").then((m) => ({ Component: m.ReportBuilder })) },
  { path: "pos", lazy: () => import("./pos/Register").then((m) => ({ Component: m.RegisterPage })) },
  ...dashboardRoutes,
  ...spaceRoutes,
  { path: "apps/:app/settings", element: <AppSettingsPage /> },
  { path: "x/:app/:page", element: <ScreenPage /> },
];
