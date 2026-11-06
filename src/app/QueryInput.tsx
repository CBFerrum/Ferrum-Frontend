// A JSON field that holds a Studio query (`widget: studio_query`): built with Studio's report builder
// in place, its first rows shown as they come, or written as JSON by those who prefer to. What the
// query means (one measure, say) the record's own rules check on save, under the field.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { t } from "../lib/i18n";
import { useMe, type EntityMeta } from "../lib/meta";
import { buildSpec, draftFromSpec, fieldIssues, specIssues, studio, studioKeys, useStudioFields, useStudioQuery, useStudioSources, type Spec } from "../lib/studio";
import { Button, useDebounced } from "../ui/kit";
import { BuilderPanel } from "./studio/report/BuilderPanel";
import { NoRows, ResultNotices, ResultSkeleton } from "./studio/report/Preview";
import { ResultTable } from "./studio/report/ResultTable";
import { displayColumns, emptyState, filterIssues, startState, type BuilderState } from "./studio/report/state";
import { JsonInput, type ControlProps } from "./widgets";

/** The field's value as a query: an object naming its entity, or the same written as a JSON string. */
export function specOf(value: unknown): Spec | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) && typeof (v as Spec).entity === "string" ? (v as Spec) : null;
}

const stateOf = (spec: Spec | null): BuilderState => (spec ? { ...emptyState(), draft: draftFromSpec(spec) } : emptyState());

export default function QueryInput(p: ControlProps) {
  const { value, onChange, disabled } = p;
  const spec = specOf(value);
  // Written as JSON when the value is not a query the builder can read, or when asked to.
  const [asJson, setAsJson] = useState(() => value != null && value !== "" && !spec);
  const [state, setState] = useState(() => stateOf(spec));
  const said = useRef(JSON.stringify(spec));
  // Follow outside changes (a reload, the JSON editor) unless the builder said the same thing.
  useEffect(() => {
    const now = JSON.stringify(specOf(value));
    if (now !== said.current) {
      said.current = now;
      setState(stateOf(specOf(value)));
    }
  }, [value]);
  const current = useRef(state);
  current.current = state;
  const update = useCallback(
    (recipe: (s: BuilderState) => BuilderState) => {
      const next = recipe(current.current);
      current.current = next;
      setState(next);
      const out = next.draft.entity ? buildSpec(next.draft) : null;
      said.current = JSON.stringify(out);
      onChange(out);
    },
    [onChange],
  );

  const qc = useQueryClient();
  const me = useMe();
  const sources = useStudioSources();
  const d = state.draft;
  const catalog = useStudioFields(d.entity || undefined);
  const built = useMemo(() => buildSpec(d), [d]);
  const local = useMemo(() => (d.entity ? [...specIssues(built, catalog.data), ...filterIssues(d.filters)] : []), [d, built, catalog.data]);
  const query = useStudioQuery(useDebounced(d.entity && !local.length && !asJson ? built : undefined, 350));
  const refused = useMemo(() => fieldIssues(query.error), [query.error]);
  const issues = useMemo(() => [...local, ...refused], [local, refused]);
  const result = query.data?.meta.entity === d.entity ? query.data : undefined;
  const shown = useMemo(() => (result ? displayColumns(result.columns, []).shown : []), [result]);
  const options = useMemo(() => ({ fyStartMonth: me.data?.fiscal_year_start_month ?? 1 }), [me.data]);

  const pickEntity = async (entity: string) => {
    const [meta, cat] = await Promise.all([
      qc
        .ensureQueryData({ queryKey: ["meta", entity], queryFn: ({ signal }) => api.get<EntityMeta>(`/api/meta/${encodeURIComponent(entity)}`, undefined, signal), staleTime: 5 * 60_000 })
        .catch(() => undefined),
      qc.ensureQueryData({ queryKey: studioKeys.fields(entity), queryFn: ({ signal }) => studio.fields(entity, signal), staleTime: 5 * 60_000 }).catch(() => undefined),
    ]);
    update((s) => startState(s, entity, meta?.list.columns, cat));
  };

  // Studio's endpoints answer only in a workspace that has Studio: without it, the query is written.
  const noStudio = sources.isError;
  if (disabled || asJson || noStudio)
    return (
      <div className="stack">
        {noStudio && !disabled && <p className="field-hint">{t("Studio builds this query. Once Studio is installed (Apps, Store), it is built here; until then it is written as JSON.")}</p>}
        <JsonInput {...p} />
        {!disabled && !noStudio && (
          <div>
            <Button size="sm" onClick={() => setAsJson(false)} disabled={value != null && value !== "" && !spec}>
              {t("Build it instead")}
            </Button>
          </div>
        )}
      </div>
    );
  return (
    <div className="grid gap-4 rounded-lg border border-border p-2 lg:grid-cols-[minmax(18rem,22rem)_1fr]" id={p.id} aria-describedby={p.describedBy}>
      <BuilderPanel
        state={state}
        update={update}
        catalog={catalog.data}
        catalogLoading={catalog.isLoading}
        catalogError={catalog.error}
        onRetryCatalog={() => void catalog.refetch()}
        sources={sources.data}
        sourcesLoading={sources.isLoading}
        onPickEntity={(e) => void pickEntity(e)}
        issues={issues}
        columns={shown}
        fyStartMonth={options.fyStartMonth}
      />
      <div className="flex min-w-0 flex-col gap-2 p-2" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-sm">{t("What it gives now")}</strong>
          <Button size="sm" onClick={() => setAsJson(true)}>
            {t("Write it as JSON")}
          </Button>
        </div>
        {!d.entity ? (
          <p className="field-hint">{t("Choose what it is about.")}</p>
        ) : query.error && !refused.length ? (
          <p className="field-error">{errorMessage(query.error)}</p>
        ) : query.isLoading && !result ? (
          <ResultSkeleton />
        ) : result ? (
          <>
            <ResultNotices meta={result.meta} />
            {result.rows.length ? <ResultTable columns={shown} rows={result.rows.slice(0, 20)} totals={result.totals} sort={d.sort} options={options} caption={p.label ?? "Preview"} /> : <NoRows />}
          </>
        ) : null}
      </div>
    </div>
  );
}
