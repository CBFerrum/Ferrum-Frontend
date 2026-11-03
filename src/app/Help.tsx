// The help center (/help/): every record type the viewer may read, explained from its own
// definition, so it is right for this workspace's apps, customizations and permissions. Searching
// finds a record type by its names, its module and what it is for; its page says what it is for,
// how it moves from draft to done, what each field means, what each action does and the rules
// it keeps.

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { search, topics } from "../lib/help";
import { humanize } from "../lib/format";
import { useEntityMeta, useMetaIndex, type EntityMeta, type Field } from "../lib/meta";
import { Badge, EmptyState, ErrorState, Icon, PageLoading } from "../ui/kit";

const KIND: Record<string, string> = {
  document: "Document",
  master: "Master record",
  settings: "Settings",
  ledger: "Ledger",
  child: "Table rows",
};

export function HelpPage() {
  const meta = useMetaIndex();
  const [query, setQuery] = useState("");
  const all = useMemo(() => (meta.data ? topics(meta.data) : []), [meta.data]);
  const found = useMemo(() => search(all, query), [all, query]);
  if (meta.error) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  if (!meta.data) return <PageLoading />;
  const byModule = new Map<string, typeof found>();
  for (const t of found) {
    const key = t.module?.label ?? "Other";
    byModule.set(key, [...(byModule.get(key) ?? []), t]);
  }
  return (
    <div className="help">
      <div className="page-head">
        <div>
          <h1 className="page-title">Help</h1>
          <p className="muted">What each kind of record is for and how it works, in this workspace.</p>
        </div>
      </div>
      <label className="help-search">
        <Icon name="search" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: invoice, leave, stock…" aria-label="Search help" autoFocus />
      </label>
      {!found.length ? (
        <EmptyState title="Nothing matches" icon="search">
          <p className="muted">Try another word, or fewer of them.</p>
        </EmptyState>
      ) : (
        [...byModule].map(([module, list]) => (
          <section key={module} className="help-module">
            <h2>{module}</h2>
            <ul>
              {list.map(({ entity }) => (
                <li key={entity.name}>
                  <Link to={`/${encodeURIComponent(entity.name)}`}>{entity.label_plural}</Link>
                  {entity.description ? <span className="muted"> — {entity.description}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** What a field takes, in words. */
function kind(f: Field, meta: EntityMeta): string {
  if (f.type === "link" && f.to) return `a ${humanize(f.to).toLowerCase()}`;
  if (f.type === "table") return `rows of ${meta.children[f.name]?.label ?? humanize(f.of ?? f.name)}`;
  if (f.type === "select" && f.options?.length) return `one of ${f.options.join(", ")}`;
  return humanize(f.type).toLowerCase();
}

export function HelpArticle() {
  const { entity } = useParams();
  const q = useEntityMeta(entity);
  if (q.error) return <ErrorState error={q.error} title="This help is not for you" />;
  const meta = q.data;
  if (!meta) return <PageLoading />;
  const fields = meta.fields.filter((f) => !f.hidden);
  const actions = meta.actions.filter((a) => !a.hidden);
  const rules = meta.rules.filter((r) => r.message);
  return (
    <article className="help-article">
      <p>
        <Link to="/">
          <Icon name="left" size={14} /> Help
        </Link>
      </p>
      <div className="page-head">
        <div>
          <h1 className="page-title">{meta.label_plural}</h1>
          <p>
            <Badge>{KIND[meta.kind] ?? humanize(meta.kind)}</Badge> {meta.module ? <span className="muted">{humanize(meta.module)}</span> : null}
          </p>
        </div>
        {meta.kind !== "child" ? <Link className="btn" to={`/e/${encodeURIComponent(meta.name)}`}>Open {meta.label_plural}</Link> : null}
      </div>
      {meta.description ? <p className="help-lead">{meta.description}</p> : null}
      <h2>How it works</h2>
      <ul>
        {meta.submittable ? (
          <li>A {meta.label.toLowerCase()} is saved as a draft and changed freely until it is submitted. Submitting makes it count; a submitted one is cancelled (and amended), not edited.</li>
        ) : (
          <li>A {meta.label.toLowerCase()} counts as soon as it is saved, and can be changed later.</li>
        )}
        {meta.numbering ? <li>Each gets its number when it is {meta.numbering.on === "submit" ? "submitted" : "saved"}: {meta.numbering.template}.</li> : null}
        {meta.company_scoped ? <li>It belongs to one company; people limited to some companies see only theirs.</li> : null}
        {meta.workflow ? <li>It goes through {meta.workflow.states.map((s) => s.name).join(", then ")}, as the people allowed to move it decide.</li> : null}
      </ul>
      {fields.length ? (
        <>
          <h2>Fields</h2>
          <table className="table help-fields">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Takes</th>
                <th scope="col">What it means</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.name}>
                  <td>
                    {f.label}
                    {f.required ? <span className="muted"> (required)</span> : f.required_if ? <span className="muted"> (sometimes required)</span> : null}
                  </td>
                  <td>{kind(f, meta)}{f.read_only ? ", filled in for you" : ""}</td>
                  <td>{f.description ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {actions.length ? (
        <>
          <h2>What you can do with one</h2>
          <ul>
            {actions.map((a) => (
              <li key={a.name}>
                <strong>{a.label}</strong>
                {a.docstatus.length === 1 ? <span className="muted"> ({a.docstatus[0] === 0 ? "on a draft" : a.docstatus[0] === 1 ? "once submitted" : "once cancelled"})</span> : null}
                {a.confirm ? <span className="muted"> — {a.confirm}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {rules.length ? (
        <>
          <h2>Rules it keeps</h2>
          <ul>
            {rules.map((r) => (
              <li key={r.name}>{r.message}</li>
            ))}
          </ul>
        </>
      ) : null}
      {Object.values(meta.children).length ? (
        <>
          <h2>Its tables</h2>
          <ul>
            {Object.values(meta.children).map((c) => (
              <li key={c.entity}>
                <strong>{c.label}</strong>: {c.fields.filter((f) => !f.hidden).map((f) => f.label).join(", ")}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

