// `/docs`: documents people write together (the Docs app, over Drive's documents edited live).
// Start one blank or from a template; find yours: recent, shared with you, starred, all, or by
// what they say (Drive's search, which shows where it found the words).

import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime, relativeTime } from "../../lib/format";
import { docTitle, snippetParts } from "../../lib/livedocs";
import { can, useMetaIndex } from "../../lib/meta";
import { Badge, EmptyState, Icon, Spinner, Tabs, toast } from "../../ui/kit";
import { presenceLabel, useFilesPresence } from "../drive/presence";
import "./docs.css";

interface DocItem {
  id: string;
  name: string;
  owner?: string | null;
  modified_at: string;
  modified_by?: string | null;
  permission: string;
  shared_by?: string | null;
  snippet?: string;
}

interface Template {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
}

const VIEWS = [
  { id: "recent", label: "Recent", path: "recent", params: { limit: 50 } },
  { id: "shared", label: "Shared with me", path: "shared_with_me", params: {} },
  { id: "starred", label: "Starred", path: "starred", params: {} },
  { id: "all", label: "All", path: "search", params: { sort: "modified", limit: 100 } },
] as const;
type View = (typeof VIEWS)[number]["id"];

export function DocsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tabsId = useId();
  const view: View = VIEWS.find((v) => v.id === params.get("view"))?.id ?? "recent";
  const query = params.get("q") ?? "";
  const [typed, setTyped] = useState(query);
  const [busy, setBusy] = useState<string | null>(null);
  const meta = useMetaIndex().data;
  const manages = !!meta?.entities.some((e) => e.name === "DocsTemplate" && can(e.permissions, "create"));
  const templates = useQuery({
    queryKey: ["docs", "templates"],
    queryFn: ({ signal }) =>
      api
        .get<{ rows: Template[] }>(
          "/api/v1/DocsTemplate",
          { filters: JSON.stringify([["is_active", "=", true]]), sort: "sort_order asc", fields: "name,category,description", limit: 50 },
          signal,
        )
        .then((r) => r.rows),
  });
  const docs = useQuery({
    queryKey: ["docs", "list", query ? "search" : view, query],
    queryFn: ({ signal }) => {
      if (query) return api.get<{ items: DocItem[] }>("/api/app/drive/search", { query, live: true, limit: 50 }, signal);
      const v = VIEWS.find((x) => x.id === view)!;
      return api.get<{ items: DocItem[] }>(`/api/app/drive/${v.path}`, { live: true, ...v.params }, signal);
    },
    // Fresh on every visit: coming back from a document shows what changed.
    staleTime: 0,
  });
  const items = docs.data?.items ?? [];
  const present = useFilesPresence(items.map((d) => d.id)).data ?? {};

  const create = async (template: Template | null) => {
    setBusy(template?.id ?? "blank");
    try {
      const made = template
        ? await api.post<{ id: string }>(`/api/v1/DocsTemplate/${template.id}/actions/create_document`, {})
        : await api.post<{ id: string }>("/api/app/drive/new", undefined, { query: { kind: "fdoc" } });
      navigate(`/doc/${made.id}`, { state: { from: "docs" } });
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(null);
    }
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams(params);
    if (typed.trim()) p.set("q", typed.trim());
    else p.delete("q");
    setParams(p);
  };

  return (
    <div className="docs-page">
      <div className="page-head">
        <h1 className="page-title">Docs</h1>
        {manages && (
          <Link to="/e/DocsTemplate" className="btn btn-default btn-sm">
            Manage templates
          </Link>
        )}
      </div>

      <section aria-labelledby={`${tabsId}-start`}>
        <h2 id={`${tabsId}-start`} className="docs-heading">
          Start a document
        </h2>
        <div className="docs-gallery">
          <button type="button" className="docs-template docs-template-blank" disabled={!!busy} onClick={() => void create(null)}>
            <span className="docs-template-sheet" aria-hidden>
              <Icon name="plus" size={20} />
            </span>
            <span className="docs-template-name">{busy === "blank" ? "Opening…" : "Blank document"}</span>
          </button>
          {templates.data?.map((t) => (
            <button
              key={t.id}
              type="button"
              className="docs-template"
              disabled={!!busy}
              title={t.description ?? undefined}
              onClick={() => void create(t)}
              aria-label={`New document from the template ${t.name}${t.description ? `: ${t.description}` : ""}`}
            >
              <span className="docs-template-sheet" aria-hidden>
                <span />
                <span />
                <span />
              </span>
              <span className="docs-template-name">{busy === t.id ? "Opening…" : t.name}</span>
              {t.category && <span className="faint docs-template-category">{t.category}</span>}
            </button>
          ))}
        </div>
        {templates.error && <p className="muted">Templates are not available: {errorMessage(templates.error)}</p>}
      </section>

      <section className="docs-list-section">
        <div className="docs-bar">
          <Tabs
            id={tabsId}
            tabs={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
            value={query ? "" : view}
            onChange={(v) => {
              setTyped("");
              setParams(v === "recent" ? {} : { view: v });
            }}
          />
          <form role="search" className="docs-search" onSubmit={search}>
            <label htmlFor={`${tabsId}-q`} className="sr-only">
              Search documents
            </label>
            <input id={`${tabsId}-q`} className="input" type="search" placeholder="Search by title or words inside" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </form>
        </div>
        {docs.error ? (
          <EmptyState title="Documents are not available" icon="file">
            <p className="muted">{errorMessage(docs.error)}</p>
          </EmptyState>
        ) : !docs.data ? (
          <Spinner label="Loading documents" />
        ) : !items.length ? (
          <EmptyState title={query ? "No document matches" : view === "shared" ? "Nothing shared with you yet" : view === "starred" ? "No starred documents" : "No documents yet"} icon="file">
            {!query && <p className="muted">Start one above, blank or from a template.</p>}
          </EmptyState>
        ) : (
          <ul className="docs-list" aria-label={query ? `Documents matching ${query}` : `${VIEWS.find((v) => v.id === view)!.label} documents`}>
            {items.map((d) => {
              const here = present[d.id] ?? [];
              return (
                <li key={d.id} className="docs-row">
                  <div className="docs-row-main">
                    <Link to={`/doc/${d.id}`} state={{ from: "docs" }} className="docs-title">
                      {docTitle(d.name)}
                    </Link>
                    {here.length > 0 && (
                      <Badge tone="green" title={presenceLabel(here)}>
                        {presenceLabel(here)}
                      </Badge>
                    )}
                    {d.permission === "View" || d.permission === "Comment" ? <Badge>View only</Badge> : null}
                  </div>
                  {d.snippet && (
                    <p className="docs-snippet">
                      {snippetParts(d.snippet).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                    </p>
                  )}
                  <div className="faint docs-meta">
                    {d.shared_by ? `Shared by ${d.shared_by} · ` : d.owner ? `${d.owner} · ` : ""}
                    <time dateTime={d.modified_at} title={formatDateTime(d.modified_at)}>
                      Changed {relativeTime(d.modified_at)}
                    </time>
                    {d.modified_by ? ` by ${d.modified_by}` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
