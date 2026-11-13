// Home: quick links per module and the latest documents of a couple of key entities in each.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, docPath, errorMessage } from "../lib/api";
import { relativeTime, todayIso } from "../lib/format";
import { can, DOCSTATUS_LABEL, recordTitle, useEntityMeta, useMe, useMetaIndex, useReports, type EntitySummary, type ListResponse } from "../lib/meta";
import { FirstRun } from "./FirstRun";
import { ScreenWidgets } from "./Screen";
import { useStudioList } from "../lib/studio";
import { Badge, EmptyState } from "../ui/kit";
import { docstatusTone } from "../lib/statusTones";
import { moduleLinks, ownModule, reportItems, STUDIO } from "./Shell";
import { PATHS } from "./studio/space/model";
import { t, isolate } from "@ferrum/client";

/** The module's Space when the viewer may open one: the first by the server's order, as `useModuleSpace`
 *  picks it, from one list shared by every section. */
function SpaceLink({ module }: { module: string }) {
  const space = useStudioList("spaces").data?.find((s) => s.module === module);
  if (!space) return null;
  return (
    <li>
      <Link className="home-link" to={PATHS.space(space.id)}>
        {space.label || t("Space")}
      </Link>
    </li>
  );
}

/** How many modules' latest records the start page shows: it is a start, not a report. */
const RECENT_GROUPS = 6;

export function Home() {
  const meta = useMetaIndex().data;
  const me = useMe().data;
  const reports = useReports().data?.reports;
  // Meetings are Comms' pages, which say themselves when meetings are not set up.
  const meet = !!meta?.packages.includes("comms");
  if (!meta) return null;

  const studio = meta.packages.includes(STUDIO);
  const readable = new Map(meta.entities.filter((e) => can(e.permissions, "read")).map((e) => [e.name, e]));
  const reportLabel = new Map(reportItems(meta, reports).map((r) => [r.name, r.label]));
  const modules = [...meta.modules]
    .filter((m) => ownModule(m, meta))
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const links = moduleLinks(m, readable, reportLabel, meet, me);
      // Studio records open in their builders, not in the generic form the recent lists link to.
      const entities = m.name === STUDIO ? [] : m.items.flatMap((i) => readable.get(i) ?? []);
      const documents = entities.filter((e) => e.kind === "document");
      return { m, links, key: (documents.length ? documents : entities).slice(0, 2) };
    })
    .filter((x) => x.links.length);
  // The start: what is waiting, the latest records of the first modules, then the way into every module.
  const recent = modules.flatMap((x) => x.key.slice(0, 1)).slice(0, RECENT_GROUPS);

  return (
    <div className="home">
      {/* The page's heading for assistive technology: the person's own page opens with what needs them. */}
      <h1 className="sr-only">{t("Home")}</h1>
      <FirstRun />
      <MyWork />
      <ScreenWidgets />
      {!modules.length ? (
        <EmptyState title={t("Nothing to show yet")}>
          <p className="muted">{t("You do not have access to any module. Ask an administrator for a role.")}</p>
        </EmptyState>
      ) : (
        <>
          {/* Hidden by CSS while no group has anything to show. */}
          {recent.length > 0 && (
            <div className="home-recent">
              {recent.map((e) => (
                <RecentDocs key={e.name} entity={e} />
              ))}
            </div>
          )}
          <div className="home-modules">
            {modules.map(({ m, links }) => (
              <nav key={m.name} className="home-section" aria-labelledby={`mod-${m.name}`}>
                <h2 id={`mod-${m.name}`} className="home-h">
                  {isolate(m.label)}
                </h2>
                <ul>
                  {studio && <SpaceLink module={m.name} />}
                  {links.map((l) => (
                    <li key={l.to}>
                      {l.href ? (
                        <a className="home-link" href={l.href}>
                          {isolate(l.label)}
                        </a>
                      ) : (
                        <Link className="home-link" to={l.to}>
                          {isolate(l.label)}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RecentDocs({ entity }: { entity: EntitySummary }) {
  const meta = useEntityMeta(entity.name).data;
  const q = useQuery({
    // Under the entity's "list" key so saving a document refreshes it.
    queryKey: ["list", entity.name, "recent"],
    queryFn: ({ signal }) =>
      api.get<ListResponse>(
        docPath(entity.name),
        { limit: 5, sort: "updated_at desc", fields: ["id", "number", "docstatus", "updated_at", ...(meta?.title_field ? [meta.title_field] : [])].join(",") },
        signal,
      ),
    enabled: !!meta,
  });
  const rows = q.data?.rows ?? [];
  // A module with nothing yet is not a heading and a shrug: it is left out until it has records.
  if (meta && !q.isLoading && !q.error && !rows.length) return null;
  return (
    <section className="home-section" aria-label={t("Recent {value}", { value: entity.label_plural.toLowerCase() })}>
      <h2 className="home-h">{t("Recent {value}", { value: entity.label_plural.toLowerCase() })}</h2>
      {q.isLoading || !meta ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="skeleton" />
          <div className="skeleton" style={{ width: "70%" }} />
        </div>
      ) : q.error ? (
        <p className="muted">{isolate(errorMessage(q.error))}</p>
      ) : (
        <ul className="feed">
          {rows.map((r) => {
            const title = recordTitle(meta, r);
            const ds = Number(r.docstatus ?? 0);
            const number = r.number && r.number !== title ? String(r.number) : "";
            const when = typeof r.updated_at === "string" ? relativeTime(r.updated_at) : "";
            return (
              <li key={String(r.id)}>
                <Link className="title" to={`/e/${entity.name}/${r.id}`}>
                  {isolate(title)}
                </Link>
                {entity.submittable && <Badge tone={docstatusTone(ds)}>{DOCSTATUS_LABEL[ds] ?? ds}</Badge>}
                <span className="meta">{isolate([number, when].filter(Boolean).join(" · "))}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface Assignment {
  id: string;
  entity: string;
  entity_label?: string;
  record_id: string;
  title?: string;
  note?: string | null;
  due_date?: string | null;
  priority: string;
}

/** Records assigned to the signed-in user: the to-do list. */
export function MyWork() {
  const q = useQuery({ queryKey: ["assignments", "mine"], queryFn: ({ signal }) => api.get<{ assignments: Assignment[] }>("/api/assignments", undefined, signal) });
  const list = q.data?.assignments ?? [];
  if (!list.length) return null;
  const today = todayIso();
  return (
    <section className="home-section my-work" aria-labelledby="my-work">
      <h2 id="my-work" className="home-h">
        {t("Assigned to you")} <span className="faint num-inline">{list.length}</span>
      </h2>
      <ul className="feed">
        {list.slice(0, 8).map((a) => (
          <li key={a.id}>
            <Link className="title" to={`/e/${a.entity}/${a.record_id}`}>
              {isolate(a.title ?? "")}
            </Link>
            <span className="feed-end">
              {a.priority === "High" && <Badge tone="red">{t("High")}</Badge>}
              {a.due_date && <Badge tone={a.due_date < today ? "red" : "neutral"}>{t("due {due_date}", { due_date: a.due_date })}</Badge>}
            </span>
            <span className="meta">{isolate([a.entity_label, a.note].filter(Boolean).join(" · "))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
