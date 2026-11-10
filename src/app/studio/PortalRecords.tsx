// The portal's generic page (Ferrum docs/builder/decisions.md BD-02): the records a person's portal
// roles reach, each entity a list to open, with no app's code. What a role reaches, and what may be
// done with it, is the server's to say: this page shows what it is told.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { t } from "@ferrum/client";
import { api } from "@/lib/api";
import type { Perms } from "@/lib/meta";
import { EmptyState, ErrorState, PageLoading } from "@/ui/kit";

export interface PortalEntity {
  name: string;
  label: string;
  label_plural: string;
  description?: string | null;
  permissions: Perms;
}

export function PortalRecords() {
  const q = useQuery({ queryKey: ["portal", "entities"], queryFn: ({ signal }) => api.get<{ entities: PortalEntity[] }>("/api/app/studio/portal/entities", undefined, signal) });
  if (q.isPending) return <PageLoading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const entities = q.data.entities;
  if (!entities.length) return <EmptyState title={t("Nothing is shared with you here yet")} icon="folder" />;
  return (
    <div className="stack" style={{ padding: 16, maxWidth: 960, margin: "0 auto" }}>
      <h1 className="page-title">{t("Your records")}</h1>
      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label={t("Your records")}>
        {entities.map((e) => (
          <li key={e.name} className="card card-pad">
            <Link to={`/e/${encodeURIComponent(e.name)}`} className="cell-title">
              {e.label_plural}
            </Link>
            {e.description && <p className="muted" style={{ margin: "4px 0 0" }}>{e.description}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
