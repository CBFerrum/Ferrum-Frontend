// Home: quick links per module and the latest documents of a couple of key entities in each.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, docPath, errorMessage } from "../lib/api";
import { relativeTime, todayIso } from "../lib/format";
import { can, DOCSTATUS_LABEL, recordTitle, useEntityMeta, useMe, useMetaIndex, useReports, type EntitySummary, type ListResponse } from "../lib/meta";
import { useStudioList } from "../lib/studio";
import { Badge, EmptyState, Icon, statusTone } from "../ui/kit";
import { moduleLinks, reportItems, STUDIO } from "./Shell";
import { PATHS } from "./studio/space/model";

/** The module's Space when the viewer may open one: the first by the server's order, as `useModuleSpace`
 *  picks it, from one list shared by every module card. */
function SpaceChip({ module }: { module: string }) {
  const space = useStudioList("spaces").data?.find((s) => s.module === module);
  if (!space) return null;
  return (
    <Link className="chip" to={PATHS.space(space.id)}>
      <Icon name="space" size={14} />
      {space.label || "Space"}
    </Link>
  );
}

export function Home() {
  const meta = useMetaIndex().data;
  const me = useMe().data;
  const reports = useReports().data?.reports;
  if (!meta) return null;

  const studio = meta.packages.includes(STUDIO);
  const readable = new Map(meta.entities.filter((e) => can(e.permissions, "read")).map((e) => [e.name, e]));
  const reportLabel = new Map(reportItems(meta, reports).map((r) => [r.name, r.label]));
  const modules = [...meta.modules]
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const links = moduleLinks(m, readable, reportLabel);
      // Studio records open in their builders, not in the generic form the recent lists link to.
      const entities = m.name === STUDIO ? [] : m.items.flatMap((i) => readable.get(i) ?? []);
      const documents = entities.filter((e) => e.kind === "document");
      return { m, links, key: (documents.length ? documents : entities).slice(0, 2) };
    })
    .filter((x) => x.links.length);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = me?.user.full_name?.split(" ")[0];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {greeting}
            {first ? `, ${first}` : ""}
          </h1>
          <p className="page-sub">
            Pick a module{studio && <>, open your <Link to="/studio/dashboards">dashboards</Link></>}
            <span className="keys-hint"> or press <span className="kbd">Ctrl</span> <span className="kbd">K</span> to jump anywhere</span>.
          </p>
        </div>
      </div>
      <MyWork />
      {!modules.length ? (
        <EmptyState title="Nothing to show yet">
          <p className="muted">You do not have access to any module. Ask an administrator for a role.</p>
        </EmptyState>
      ) : (
        <div className="home-grid">
          {modules.map(({ m, links, key }) => (
            <section key={m.name} className="card" aria-labelledby={`mod-${m.name}`}>
              <div className="card-head">
                <h2 id={`mod-${m.name}`}>{m.label}</h2>
              </div>
              <div className="card-body stack">
                <div className="chips">
                  {studio && <SpaceChip module={m.name} />}
                  {links.map((l) => (
                    <Link key={l.to} className="chip" to={l.to}>
                      <Icon name={l.icon} size={14} />
                      {l.label}
                    </Link>
                  ))}
                </div>
                {key.map((e) => (
                  <RecentDocs key={e.name} entity={e} />
                ))}
              </div>
            </section>
          ))}
        </div>
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
  return (
    <div>
      <h3 className="field-label" style={{ marginBottom: 4 }}>
        Recent {entity.label_plural.toLowerCase()}
      </h3>
      {q.isLoading || !meta ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="skeleton" />
          <div className="skeleton" style={{ width: "70%" }} />
        </div>
      ) : q.error ? (
        <p className="muted">{errorMessage(q.error)}</p>
      ) : !rows.length ? (
        <p className="faint">Nothing yet.</p>
      ) : (
        <ul className="recent">
          {rows.map((r) => {
            const title = recordTitle(meta, r);
            const ds = Number(r.docstatus ?? 0);
            return (
              <li key={String(r.id)}>
                <Link className="title" to={`/e/${entity.name}/${r.id}`}>
                  {title}
                </Link>
                {r.number && r.number !== title ? <span className="faint nowrap">{String(r.number)}</span> : null}
                {entity.submittable && <Badge tone={statusTone(DOCSTATUS_LABEL[ds])}>{DOCSTATUS_LABEL[ds] ?? ds}</Badge>}
                {typeof r.updated_at === "string" && <span className="faint nowrap">{relativeTime(r.updated_at)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
function MyWork() {
  const q = useQuery({ queryKey: ["assignments", "mine"], queryFn: ({ signal }) => api.get<{ assignments: Assignment[] }>("/api/assignments", undefined, signal) });
  const list = q.data?.assignments ?? [];
  if (!list.length) return null;
  const today = todayIso();
  return (
    <section className="card my-work" aria-labelledby="my-work">
      <div className="card-head">
        <h2 id="my-work">Assigned to you</h2>
        <span className="faint">{list.length}</span>
      </div>
      <ul className="recent">
        {list.slice(0, 8).map((a) => (
          <li key={a.id}>
            <Link to={`/e/${a.entity}/${a.record_id}`}>
              <span className="cell-title">{a.title}</span> <span className="faint">{a.entity_label}</span>
            </Link>
            {a.note && <div className="muted">{a.note}</div>}
            {a.due_date && <Badge tone={a.due_date < today ? "red" : "neutral"}>due {a.due_date}</Badge>}
            {a.priority === "High" && <Badge tone="red">High</Badge>}
          </li>
        ))}
      </ul>
    </section>
  );
}
