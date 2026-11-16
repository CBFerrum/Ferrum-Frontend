// The pages apps' screens had (/x/<app>/<page>, /apps/<app>/settings). Screens are gone; these two stay,
// saying the page is not available, while addresses still lead here: apps' own routes (their records.ts),
// the shell's store and ERP's frame (recordsRoutes), the server's old-address redirects (legacy.rs) and
// Drive's link to its settings.

import { EmptyState } from "../ui/kit";
import { t } from "@ferrum/client";

function Unavailable({ title }: { title: string }) {
  return (
    <EmptyState title={t("{title} is not available", { title })} icon="apps">
      <p className="muted">
        {t("The app that adds it may be disabled or removed.")} <a href="/store/">{t("Open Apps")}</a>
      </p>
    </EmptyState>
  );
}

/** `/x/:app/:page`: was an app's screen page. */
export function ScreenPage() {
  return <Unavailable title={t("This page")} />;
}

/** `/apps/:app/settings`: was an app's own settings screen. */
export function AppSettingsPage() {
  return <Unavailable title={t("This app's settings")} />;
}
