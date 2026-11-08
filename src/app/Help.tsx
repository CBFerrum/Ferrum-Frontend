// The help center (/data/help/): every record type the viewer may read, explained from its own
// definition, so it is right for this workspace's apps, customizations and permissions. Searching
// finds a record type by its names, its module and what it is for; its page says what it is for,
// how it moves from draft to done, what each field means, what each action does and the rules
// it keeps.

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { article, recordKind, search, takes, topics } from "../lib/help";
import { humanize } from "../lib/format";
import { useEntityMeta, useMetaIndex, type EntityMeta, type Field } from "../lib/meta";
import { Badge, EmptyState, ErrorState, Icon, PageLoading } from "../ui/kit";
import { t as tr, isolate } from "@ferrum/client";

const KIND: Record<string, string> = {
  get document() { return tr("Document"); },
  get master() { return tr("Master record"); },
  get settings() { return tr("Settings"); },
  get ledger() { return tr("Ledger"); },
  get child() { return tr("Table rows"); },
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
          <h1 className="page-title">{tr("Help")}</h1>
          <p className="muted">{tr("What each kind of record is for and how it works, in this workspace.")}</p>
        </div>
      </div>
      <label className="help-search">
        <Icon name="search" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Search: invoice, leave, stock…")} aria-label={tr("Search help")} autoFocus />
      </label>
      {!found.length ? (
        <EmptyState title={tr("Nothing matches")} icon="search">
          <p className="muted">{tr("Try another word, or fewer of them.")}</p>
        </EmptyState>
      ) : (
        [...byModule].map(([module, list]) => (
          <section key={module} className="help-module">
            <h2>{isolate(module)}</h2>
            <ul>
              {list.map(({ entity }) => (
                <li key={entity.name}>
                  <Link to={`/help/${encodeURIComponent(entity.name)}`}>{isolate(entity.label_plural)}</Link>
                  {entity.description ? <span className="muted"> — {isolate(entity.description)}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** What a field takes, in words; a link by the label of what it picks. */
function kind(f: Field, meta: EntityMeta, labelOf: (name: string) => string | undefined): string {
  if (f.type === "link" && f.to) return recordKind(f.to, labelOf(f.to));
  if (f.type === "table") return tr("rows of {value}", { value: meta.children[f.name]?.label ?? humanize(f.of ?? f.name) });
  if (f.type === "select" && f.options?.length) return tr("one of {value}", { value: f.options.join(", ") });
  return takes(f.type);
}

export function HelpArticle() {
  const { entity } = useParams();
  const q = useEntityMeta(entity);
  const index = useMetaIndex();
  const labelOf = (name: string) => index.data?.entities.find((e) => e.name === name)?.label;
  if (q.error) return <ErrorState error={q.error} title={tr("This help is not for you")} />;
  const meta = q.data;
  if (!meta) return <PageLoading />;
  const fields = meta.fields.filter((f) => !f.hidden);
  const actions = meta.actions.filter((a) => !a.hidden);
  const rules = meta.rules.filter((r) => r.message);
  return (
    <article className="help-article">
      <p>
        <Link to="/help">
          <Icon name="left" size={14} /> {tr("Help")}
        </Link>
      </p>
      <div className="page-head">
        <div>
          <h1 className="page-title">{isolate(meta.label_plural)}</h1>
          <p>
            <Badge>{KIND[meta.kind] ?? humanize(meta.kind)}</Badge> {meta.module ? <span className="muted">{isolate(humanize(meta.module))}</span> : null}
          </p>
        </div>
        {meta.kind !== "child" ? <Link className="btn" to={`/e/${encodeURIComponent(meta.name)}`}>{tr("Open {label_plural}", { label_plural: meta.label_plural })}</Link> : null}
      </div>
      {meta.description ? <p className="help-lead">{isolate(meta.description)}</p> : null}
      <h2>{tr("How it works")}</h2>
      <ul>
        {meta.submittable ? (
          <li>{article(meta.label) === "an" ? tr("An") : "A"} {tr("{value} is saved as a draft and changed freely until it is submitted. Submitting makes it count; a submitted one is cancelled (and amended), not edited.", { value: meta.label.toLowerCase() })}</li>
        ) : (
          <li>{article(meta.label) === "an" ? tr("An") : "A"} {tr("{value} counts as soon as it is saved, and can be changed later.", { value: meta.label.toLowerCase() })}</li>
        )}
        {meta.numbering ? <li>{(meta.numbering.on === "submit" ? tr("Each gets its number when it is submitted") : tr("Each gets its number when it is saved"))}: {isolate(meta.numbering.template)}.</li> : null}
        {meta.company_scoped ? <li>{tr("It belongs to one company; people limited to some companies see only theirs.")}</li> : null}
        {meta.workflow ? <li>{tr("It goes through {value}, as the people allowed to move it decide.", { value: meta.workflow.states.map((s) => s.name).join(", then ") })}</li> : null}
      </ul>
      {fields.length ? (
        <>
          <h2>{tr("Fields")}</h2>
          <table className="table help-fields">
            <thead>
              <tr>
                <th scope="col">{tr("Field")}</th>
                <th scope="col">{tr("Takes")}</th>
                <th scope="col">{tr("What it means")}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.name}>
                  <td>
                    {isolate(f.label)}
                    {f.required ? <span className="muted"> {tr("(required)")}</span> : f.required_if ? <span className="muted"> {tr("(sometimes required)")}</span> : null}
                  </td>
                  <td>{isolate(kind(f, meta, labelOf))}{f.read_only ? tr(", filled in for you") : ""}</td>
                  <td>{isolate(f.description ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {actions.length ? (
        <>
          <h2>{tr("What you can do with one")}</h2>
          <ul>
            {actions.map((a) => (
              <li key={a.name}>
                <strong>{isolate(a.label)}</strong>
                {a.docstatus.length === 1 ? <span className="muted"> ({a.docstatus[0] === 0 ? tr("on a draft") : a.docstatus[0] === 1 ? tr("once submitted") : tr("once cancelled")})</span> : null}
                {a.confirm ? <span className="muted"> — {isolate(a.confirm)}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {rules.length ? (
        <>
          <h2>{tr("Rules it keeps")}</h2>
          <ul>
            {rules.map((r) => (
              <li key={r.name}>{isolate(r.message)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {Object.values(meta.children).length ? (
        <>
          <h2>{tr("Its tables")}</h2>
          <ul>
            {Object.values(meta.children).map((c) => (
              <li key={c.entity}>
                <strong>{isolate(c.label)}</strong>: {isolate(c.fields.filter((f) => !f.hidden).map((f) => f.label).join(", "))}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

