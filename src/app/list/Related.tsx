// What links to a record: each list that names it, how many records, a click from those records.
// The counts come from the lists themselves, so they are what this viewer may read. Loaded only
// when asked for: a much-used record can be named by dozens of lists.

import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, docPath } from "../../lib/api";
import type { EntityMeta, LinkedFrom, ListResponse } from "../../lib/meta";
import { Spinner } from "../../ui/kit";
import { t, isolate } from "@ferrum/client";

/** Which field a link goes through matters only when one list links in more than one way. */
const seenTwice = (links: LinkedFrom[], l: LinkedFrom) => links.filter((x) => x.entity === l.entity).length > 1;

export function Related({ meta, id }: { meta: EntityMeta; id: string }) {
  const links = meta.linked_from ?? [];
  const counts = useQueries({
    queries: links.map((l) => ({
      queryKey: ["list", l.entity, "related", l.field, id],
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<ListResponse>(docPath(l.entity), { fields: "id", limit: 1, count: true, filters: JSON.stringify([[l.field, "=", id]]) }, signal),
    })),
  });
  const found = links.map((l, i) => ({ link: l, n: counts[i]?.data?.total ?? 0 })).filter((x) => x.n > 0);
  const loading = counts.some((c) => c.isLoading);
  return (
    <section className="related" aria-label={t("Related records")} aria-busy={loading}>
      {found.length > 0 && (
        <ul className="related-list">
          {found.map(({ link: l, n }) => (
            <li key={`${l.entity}.${l.field}`}>
              <Link className="related-row" to={`/e/${l.entity}?${new URLSearchParams({ [`f.${l.field}`]: id })}`}>
                <span>
                  {isolate(l.label)}
                  {seenTwice(links, l) && <span className="faint"> {t("by {field_label}", { field_label: l.field_label })}</span>}
                </span>
                <span className="related-count">{n}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {loading ? <Spinner label={t("Looking")} /> : !found.length && <p className="faint">{t("Nothing links to this record yet.")}</p>}
    </section>
  );
}
