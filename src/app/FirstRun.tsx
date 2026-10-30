// The first-run picker (docs/plan/apps-ui.md §13): a workspace starts with only the core, and its
// administrator picks a suite, or apps one by one, to begin with. More come later from Apps.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/meta";
import { Button } from "@/ui/kit";
import { AppCard, type AppSummary, type AppsResponse, InstallDialog } from "./Apps";

/** Suites first, then apps that stand on their own (no add-ons, no connectors). */
export function firstRunChoices(available: AppSummary[]): { suites: AppSummary[]; apps: AppSummary[] } {
  const is = (a: AppSummary, c: string) => !!a.categories?.includes(c);
  const byName = (a: AppSummary, b: AppSummary) => a.name.localeCompare(b.name);
  return {
    suites: available.filter((a) => is(a, "suite")).sort(byName),
    apps: available.filter((a) => !a.parent && !is(a, "suite") && !is(a, "connector")).sort(byName),
  };
}

export function FirstRun() {
  const me = useMe();
  const admin = !!me.data?.user.is_admin;
  const q = useQuery({ queryKey: ["apps"], enabled: admin, queryFn: ({ signal }) => api.get<AppsResponse>("/api/admin/apps", undefined, signal) });
  const [planFor, setPlanFor] = useState<{ id: string } | null>(null);
  if (!admin || !q.data || q.data.installed.length > 0) return null;
  const { suites, apps } = firstRunChoices(q.data.available);
  const card = (a: AppSummary) => (
    <AppCard key={a.id} app={a} onOpen={() => setPlanFor({ id: a.id })}>
      <span className="spacer" />
      <Button size="sm" variant="primary" icon="plus" onClick={() => setPlanFor({ id: a.id })}>
        Install
      </Button>
    </AppCard>
  );
  return (
    <section className="card" aria-labelledby="first-run-title">
      <div className="card-head">
        <h2 id="first-run-title">Set up this workspace</h2>
      </div>
      <div className="card-body stack">
        <p className="muted">It has no apps yet. Start with a suite, or pick apps one by one; Apps adds more later.</p>
        {suites.length > 0 && (
          <>
            <h3 className="field-label">Suites</h3>
            <div className="app-grid">{suites.map(card)}</div>
          </>
        )}
        {apps.length > 0 && (
          <>
            <h3 className="field-label">Apps</h3>
            <div className="app-grid">{apps.map(card)}</div>
          </>
        )}
      </div>
      {/* What an app installs changes the whole interface: start it again. */}
      <InstallDialog request={planFor} onClose={() => setPlanFor(null)} onInstalled={() => window.location.reload()} />
    </section>
  );
}
