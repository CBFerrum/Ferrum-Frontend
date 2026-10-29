// Read-only preview of the layout being designed, rendered the way the document form renders it:
// sections and tabs from formSections (lib/formTabs.ts), the same widgets and styles, and the same
// section and field conditions, for a new record or one of the latest records.

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api, docPath } from "../../lib/api";
import { asRows } from "../../lib/doc";
import { evaluate } from "../../lib/expr";
import { toForm, type LayoutSection } from "../../lib/formLayout";
import { formSections } from "../../lib/formTabs";
import { can, fieldState, recordTitle, useCurrencyPrecision, useMe, userScope, type Doc, type EntityMeta, type Field, type FieldState, type ListResponse } from "../../lib/meta";
import { ErrorState, Field as FieldWrap, Icon, TabPanel, Tabs } from "../../ui/kit";
import { FieldControl, TableGrid } from "../widgets";

const NEW = "\u0000new";
const WIDE = new Set(["text", "markdown", "code", "json"]);
const tabId = (tab: string | null) => (tab === null ? "details" : `tab:${tab}`);
const ignore = () => {};

export function FormPreview({ meta, layout, unsaved }: { meta: EntityMeta; layout: LayoutSection[]; unsaved: boolean }) {
  const me = useMe().data;
  const user = useMemo(() => userScope(me), [me]);
  const precisionOf = useCurrencyPrecision();
  const [pick, setPick] = useState(NEW);
  const [tab, setTab] = useState("details");
  const listable = can(meta.permissions, "read") && meta.kind !== "child";
  const recent = useQuery({
    queryKey: ["list", meta.name, "form-designer-preview"],
    queryFn: ({ signal }) =>
      api.get<ListResponse>(
        docPath(meta.name),
        { fields: ["id", "number", meta.title_field].filter(Boolean).join(","), sort: "updated_at desc", limit: 20 },
        signal,
      ),
    enabled: listable,
  });
  const record = useQuery({
    queryKey: ["form-designer-preview", meta.name, pick],
    queryFn: ({ signal }) => api.get<Doc>(docPath(meta.name, pick), undefined, signal),
    enabled: pick !== NEW,
  });
  const view = useMemo(() => formSections({ form: toForm(layout), fields: meta.fields }), [layout, meta.fields]);

  const doc: Doc = (pick !== NEW && record.data) || {};
  const scope = { doc, user };
  const hidden: string[] = [];
  const shown = view.sections.flatMap((s) => {
    if (s.visibleIf && evaluate(s.visibleIf, scope) === false) {
      hidden.push(s.label ?? "Untitled section");
      return [];
    }
    const items = s.fields.flatMap((f) => {
      const st = fieldState(f, scope, true);
      return st.visible ? [{ f, st }] : [];
    });
    return items.length ? [{ s, items }] : [];
  });
  const tabs = view.tabs.filter((t) => shown.some(({ s }) => s.tab === t)).map((t) => ({ id: tabId(t), label: t ?? "Details" }));
  const active = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? "details");

  const currencyPrecision = (f: Field, row: Doc, parent?: Doc) =>
    f.type === "currency" && f.currency ? precisionOf(f.currency.startsWith("parent.") ? parent?.[f.currency.slice(7)] : row[f.currency]) : undefined;

  const renderField = (f: Field, st: FieldState, soleInSection: boolean): ReactNode => {
    const fid = `fdp-${f.name}`;
    if (f.type === "table") {
      const child = meta.children[f.name];
      if (!child) return null;
      return (
        <div key={f.name} className="field span-all" role="group" aria-labelledby={`${fid}-label`}>
          <div className={soleInSection ? "sr-only" : "field-label"} id={`${fid}-label`}>
            {f.label}
            {st.required && (
              <span className="req" aria-hidden="true">
                *
              </span>
            )}
          </div>
          <TableGrid
            child={child}
            rows={asRows(doc[f.name])}
            onChange={ignore}
            locked
            errors={[]}
            parent={doc}
            user={user}
            precisionOf={(cf, row) => currencyPrecision(cf, row, doc)}
            entity={meta.name}
            recordId={doc.id}
          />
        </div>
      );
    }
    const control = (
      <FieldControl
        field={f}
        id={fid}
        value={doc[f.name]}
        title={doc._titles?.[f.name]}
        disabled
        required={st.required}
        describedBy={f.description ? `${fid}-hint` : undefined}
        currencyPrecision={currencyPrecision(f, doc)}
        entity={meta.name}
        recordId={doc.id}
        onChange={ignore}
      />
    );
    if (f.type === "check") {
      return (
        <div key={f.name} className="field">
          <div className="check-field">
            {control}
            <label htmlFor={fid}>{f.label}</label>
          </div>
          {f.description && (
            <p className="field-hint" id={`${fid}-hint`}>
              {f.description}
            </p>
          )}
        </div>
      );
    }
    return (
      <FieldWrap key={f.name} label={f.label} htmlFor={fid} required={st.required} hint={f.description} className={WIDE.has(f.type) ? "span-all" : ""}>
        {control}
      </FieldWrap>
    );
  };

  const details = (t: string) =>
    shown.map(({ s, items }) =>
      tabId(s.tab) !== t ? null : (
        <PreviewSection key={s.key} label={s.label} collapsible={s.collapsible}>
          <div className="form-grid" style={{ "--cols": Math.min(Math.max(s.columns, 1), 4) } as CSSProperties}>
            {items.map(({ f, st }) => renderField(f, st, items.length === 1 && f.label === s.label))}
          </div>
        </PreviewSection>
      ),
    );

  const rows = recent.data?.rows ?? [];
  const name = (r: Doc) => {
    const title = recordTitle(meta, r);
    return r.number && String(r.number) !== title ? `${String(r.number)} · ${title}` : title;
  };

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2 rounded-lg border bg-card p-3">
        {listable && (
          <div className="grid w-full gap-1.5 sm:w-72">
            <Label htmlFor="fd-preview-record">Preview with</Label>
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger id="fd-preview-record" className="w-full pointer-coarse:h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW}>A new {meta.label}</SelectItem>
                {rows.map((r) => (
                  <SelectItem key={String(r.id)} value={String(r.id)}>
                    {name(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <p className="min-w-48 flex-1 text-sm text-muted-foreground">
          Read-only: the form as it will look{unsaved ? " with your unsaved changes" : ""}. Section and field conditions follow the chosen record.
          {recent.isError ? " The latest records could not be loaded." : ""}
        </p>
      </div>
      {pick !== NEW && record.isLoading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
          <Spinner /> Loading the record…
        </div>
      ) : pick !== NEW && record.error ? (
        <ErrorState error={record.error} onRetry={() => record.refetch()} title="Could not load this record" />
      ) : (
        <>
          {hidden.length > 0 && (
            <p className="mb-3 text-sm text-muted-foreground">
              Hidden by their condition{pick === NEW ? " on a new record" : " on this record"}: {hidden.join(", ")}.
            </p>
          )}
          {!shown.length ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No section has a field to show here.</p>
          ) : tabs.length > 1 ? (
            <>
              <Tabs id="fd-preview" value={active} onChange={setTab} tabs={tabs} />
              <TabPanel id="fd-preview" tab={active}>
                {details(active)}
              </TabPanel>
            </>
          ) : (
            details(active)
          )}
        </>
      )}
    </div>
  );
}

/** A form section as FormView draws it (collapsible ones start closed). */
function PreviewSection({ label, collapsible, children }: { label: string | null; collapsible: boolean; children: ReactNode }) {
  if (!collapsible) {
    return (
      <section className="section" aria-label={label ?? undefined}>
        {label && <h2 className="section-title">{label}</h2>}
        <div className="section-body" style={label ? undefined : { paddingTop: 16 }}>
          {children}
        </div>
      </section>
    );
  }
  return (
    <details className="section">
      <summary>
        <Icon name="chevronRight" size={14} />
        {label ?? "More"}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
