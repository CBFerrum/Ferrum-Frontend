// The portal's generic page (Ferrum docs/builder/decisions.md BD-02): the records a person's portal
// roles reach, each entity a list to open, with no app's code. What a role reaches, and what may be
// done with it, is the server's to say: this page shows what it is told.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { isolate, routeBase, t } from "@ferrum/client";
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

/** A portal menu: the items the person reaches in it; `create` where the menu offers a "+" and they may create. */
export interface PortalMenu {
  name: string;
  label: string;
  description?: string | null;
  items: (PortalEntity & { create?: boolean })[];
}

interface Answer {
  entities: PortalEntity[];
  menus?: PortalMenu[];
  other?: PortalEntity[];
}

export function PortalRecords() {
  const { menu } = useParams();
  const q = useQuery({ queryKey: ["portal", "entities"], queryFn: ({ signal }) => api.get<Answer>("/api/app/studio/portal/entities", undefined, signal) });
  if (q.isPending) return <PageLoading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const found = menu ? q.data.menus?.find((m) => m.name === menu) : undefined;
  if (menu && !found)
    return (
      <EmptyState title={t("This menu is not shared with you")} icon="folder">
        <a className="btn btn-primary btn-md" href={routeBase("portal")}>{t("Back to the portal home")}</a>
      </EmptyState>
    );
  // An older server sends only `entities`.
  const items: (PortalEntity & { create?: boolean })[] = found ? found.items : q.data.other ?? q.data.entities;
  const base = found ? `/m/${encodeURIComponent(found.name)}/e` : "/e";
  const title = found ? isolate(found.label) : t("Your records");
  if (!items.length) return <EmptyState title={t("Nothing is shared with you here yet")} icon="folder" />;
  return (
    <div className="stack" style={{ padding: 16, maxWidth: 960, margin: "0 auto", minWidth: 0, overflowWrap: "anywhere" }}>
      <h1 className="page-title">{title}</h1>
      {found?.description && <p className="muted" style={{ margin: 0 }}>{isolate(found.description)}</p>}
      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label={title}>
        {items.map((e) => (
          <li key={e.name} className="card card-pad">
            <div className="row" style={{ flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Link to={`${base}/${encodeURIComponent(e.name)}`} className="cell-title">
                {isolate(e.label_plural)}
              </Link>
              {e.create && (
                <Link to={`${base}/${encodeURIComponent(e.name)}/new`} className="btn btn-primary btn-md">
                  {t("New {label}", { label: isolate(e.label) })}
                </Link>
              )}
            </div>
            {e.description && <p className="muted" style={{ margin: "4px 0 0" }}>{e.description}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
