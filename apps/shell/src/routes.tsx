// The shell's pages by entry (main.tsx picks one): kept apart from the start-up so a test can mount the real table.

import { useEffect } from "react";
import { Link, useParams, type RouteObject } from "react-router";
import { t } from "@ferrum/client";
import { EmptyState } from "@/ui/kit";

/** A record link drawn by a shared component (`/e/{entity}/{id}`): to the app that shows it. */
function ToRecord() {
  const { entity, id } = useParams();
  useEffect(() => {
    location.replace(`/open/${encodeURIComponent(entity!)}${id ? `/${encodeURIComponent(id)}` : ""}`);
  }, [entity, id]);
  return null;
}

const toRecord: RouteObject[] = [
  { path: "e/:entity", element: <ToRecord /> },
  { path: "e/:entity/:id", element: <ToRecord /> },
];

// Each page loads when first opened: the release's first script holds only the frame (§12.9).
const apps = () => import("@/app/Apps").then((m) => ({ Component: m.AppsPage }));
export const pages: Record<string, RouteObject[]> = {
  "": [{ index: true, lazy: () => import("./Home").then((m) => ({ Component: m.ShellHome })) }, ...toRecord],
  store: [
    { index: true, lazy: apps },
    { path: "apps", lazy: apps },
    ...toRecord,
  ],
  admin: [{ index: true, lazy: () => import("@/app/Admin").then((m) => ({ Component: m.AdminPage })) }, ...toRecord],
  account: [{ index: true, lazy: () => import("./Account").then((m) => ({ Component: m.AccountPage })) }, ...toRecord],
  data: [
    { index: true, element: <DataIndex /> },
    { path: "e/:entity", lazy: () => import("@/app/ListView").then((m) => ({ Component: m.ListView })) },
    { path: "e/:entity/:id", lazy: () => import("@/app/FormView").then((m) => ({ Component: m.FormView })) },
    { path: "approvals", lazy: () => import("@/app/Approvals").then((m) => ({ Component: m.ApprovalsPage })) },
    { path: "r/:name", lazy: () => import("@/app/ReportView").then((m) => ({ Component: m.ReportView })) },
    // Customize, for every workspace on the shell, with ERP or without.
    { path: "customize/new", lazy: () => import("@/app/EntityDesigner").then((m) => ({ Component: m.EntityDesignerPage })) },
    { path: "customize/:entity/design", lazy: () => import("@/app/EntityDesigner").then((m) => ({ Component: m.EntityDesignerPage })) },
    { path: "customize/menus", lazy: () => import("@/app/Menus").then((m) => ({ Component: m.MenusPage })) },
    { path: "customize/approvals", lazy: () => import("@/app/ApprovalPolicies").then((m) => ({ Component: m.ApprovalPoliciesPage })) },
    { path: "customize/messages", lazy: () => import("@/app/MessageTemplates").then((m) => ({ Component: m.MessageTemplatesPage })) },
    { path: "customize/messages/:key", lazy: () => import("@/app/MessageTemplates").then((m) => ({ Component: m.MessageTemplatePage })) },
    { path: "customize/print", lazy: () => import("@/app/print/Formats").then((m) => ({ Component: m.PrintFormatsPage })) },
    { path: "customize/print/:key", lazy: () => import("@/app/print/Formats").then((m) => ({ Component: m.PrintFormatPage })) },
    { path: "customize/letterheads", lazy: () => import("@/app/print/LetterHeads").then((m) => ({ Component: m.LetterHeadsPage })) },
    { path: "customize/letterheads/:id", lazy: () => import("@/app/print/LetterHeads").then((m) => ({ Component: m.LetterHeadPage })) },
    { path: "customize/packs", lazy: () => import("@/app/Packs").then((m) => ({ Component: m.PacksPage })) },
    { path: "customize/:entity?", lazy: () => import("@/app/Customize").then((m) => ({ Component: m.CustomizePage })) },
    { path: "customize/:entity/form", lazy: () => import("@/app/FormDesigner").then((m) => ({ Component: m.FormDesignerPage })) },
    { path: "customize/:entity/workflow", lazy: () => import("@/app/WorkflowDesigner").then((m) => ({ Component: m.WorkflowDesignerPage })) },
    { path: "customize/:entity/targets", lazy: () => import("@/app/TargetsDesigner").then((m) => ({ Component: m.TargetsDesignerPage })) },
    { path: "customize/:entity/lists", lazy: () => import("@/app/PublishedLists").then((m) => ({ Component: m.PublishedListsPage })) },
    { path: "customize/:entity/buttons", lazy: () => import("@/app/ButtonsDesigner").then((m) => ({ Component: m.ButtonsDesignerPage })) },
    { path: "customize/:entity/approvals", lazy: () => import("@/app/DocumentApprovals").then((m) => ({ Component: m.DocumentApprovalsPage })) },
    // The help center, under the core's records (the core adds no names of its own at the top).
    { path: "help", lazy: () => import("@/app/Help").then((m) => ({ Component: m.HelpPage })) },
    { path: "help/:entity", lazy: () => import("@/app/Help").then((m) => ({ Component: m.HelpArticle })) },
  ],
};

function DataIndex() {
  return (
    <EmptyState title={t("Records")}>
      <p className="muted">
        {t("Open a list from an app, or from")} <Link to="/e/User">{t("people")}</Link>.
      </p>
    </EmptyState>
  );
}

