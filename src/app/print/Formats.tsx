// Print formats under Customize (PRINT-FORMATS-SPEC §7.2): per record type, the formats a record can print as, where each
// comes from, which one is the default, who may use it and whether it is on; new ones (blank, or from another), a package's
// customized as the workspace's own copy (D8), duplicates, the default, deletion. Links to letter heads and print settings.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { lazy, Suspense, useId, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useMetaIndex, useServerInfo } from "../../lib/meta";
import { kindOf, toSave, type PrintFormat } from "../../lib/printLayout";
import { Badge, Button, confirmDialog, Dialog, Field, Menu, MenuItem, PageLoading, toast } from "../../ui/kit";
import { ButtonLink, LoadFailed, StatePanel, TableSkeleton } from "../../ui/patterns";
import { AdminGate, formatLink, formatsLink, KIND_NAMES, letterheadsLink, NeedsLevel, PRINT_SETTINGS_HREF, readFormat, saveFormat, SOURCE_NAMES, usePrintLevel, type FormatRow } from "./shared";

export function PrintFormatsPage() {
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/customize">{tr("Customize")}</Link>
          </p>
          <h1 className="page-title">{tr("Print formats")}</h1>
        </div>
        <div className="page-actions">
          <ButtonLink to={letterheadsLink()}>{tr("Letter heads")}</ButtonLink>
          <ButtonLink href={PRINT_SETTINGS_HREF}>{tr("Print settings")}</ButtonLink>
        </div>
      </div>
      <AdminGate>
        <NeedsLevel level={1}>
          <List />
        </NeedsLevel>
      </AdminGate>
    </div>
  );
}

const KEY = /^[a-z][a-z0-9_.]*$/;
/** A workspace key from a name: lower case, underscores, never a package's prefix (it has no dot). */
export const keyFrom = (name: string) => name.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+|_+$/g, "").slice(0, 60);

function useKeyProblem() {
  const packages = useServerInfo().data?.packages.map((p) => p.name) ?? [];
  return (key: string, taken: string[]) =>
    !KEY.test(key) || key.length > 100 || key.endsWith(".") || key.includes("..")
      ? tr("The key is lower case letters, digits, underscores and dots, starting with a letter.")
      : packages.some((p) => key.startsWith(`${p}.`))
        ? tr("A key that starts with a package's name and a dot belongs to that package.")
        : taken.includes(key)
          ? tr("A format with this key already exists.")
          : null;
}

function List() {
  const [sp, setSp] = useSearchParams();
  const entity = sp.get("entity") ?? "";
  const [search, setSearch] = useState("");
  const index = useMetaIndex();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { level } = usePrintLevel();
  const q = useQuery({
    queryKey: ["admin", "print", "formats", entity],
    queryFn: ({ signal }) => api.get<{ templates: FormatRow[] }>("/api/admin/documents/templates", { output: "page", entity: entity || undefined }, signal),
  });
  const entities = [...(index.data?.entities ?? [])].filter((e) => e.kind !== "child").sort((a, b) => a.label.localeCompare(b.label));
  const label = (name: string) => entities.find((e) => e.name === name)?.label ?? name;
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.templates ?? []).filter((r) => r.output === "page").filter((r) => !s || `${r.label ?? ""} ${r.key} ${label(r.entity)}`.toLowerCase().includes(s));
  }, [q.data, search, entities.length]);
  const [making, setMaking] = useState<{ from?: FormatRow; customize?: boolean } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "print"] });

  const setDefault = async (r: FormatRow | null, ent: string) => {
    try {
      await api.put(`/api/admin/documents/defaults/${encodeURIComponent(ent)}`, { key: r ? r.key : null });
      toast(r ? tr("{name} is now the default for {entity}", { name: r.label || r.key, entity: label(ent) }) : tr("Back to the package's default"));
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const setEnabled = async (r: FormatRow, enabled: boolean) => {
    try {
      const read = await readFormat(r.key);
      await saveFormat(toSave({ ...read.template, enabled }), read.etag);
      toast(enabled ? tr("{name} is on", { name: r.label || r.key }) : tr("{name} is off: nobody can print with it", { name: r.label || r.key }));
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const remove = async (r: FormatRow) => {
    const own = r.source === "workspace";
    if (!(await confirmDialog({
      title: own ? tr("Delete {name}?", { name: r.label || r.key }) : tr("Go back to the package's {name}?", { name: r.label || r.key }),
      message: own ? tr("Records stop printing with it; where it was the default, the next format in line is used.") : tr("Your edited copy is removed and the package's format is used again."),
      confirmLabel: own ? tr("Delete") : tr("Reset"),
      danger: true,
    }))) return;
    try {
      const before = own ? await readFormat(r.key) : null;
      await api.del(`/api/admin/documents/templates/${encodeURIComponent(r.key)}`);
      await refresh();
      toast(own ? tr("{name} deleted", { name: r.label || r.key }) : tr("Back to the package's format"), "success", before ? {
        action: { label: tr("Undo"), onSelect: () => void saveFormat(toSave(before.template), null).then(refresh, (e) => toast(errorMessage(e), "error")) },
      } : {});
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const actions = (r: FormatRow) => (
    <Menu ariaLabel={tr("Actions for {name}", { name: r.label || r.key })} label={<Ellipsis size={16} aria-hidden="true" />} buttonClass="btn btn-ghost btn-md icon-btn">
      {(close) => (
        <>
          <MenuItem onSelect={() => (close(), navigate(formatLink(r.key)))}>{r.source === "package" && r.kind === "layout" ? tr("Open") : tr("Edit")}</MenuItem>
          {r.source === "package" && r.kind === "layout" && <MenuItem onSelect={() => (close(), setMaking({ from: r, customize: true }))}>{tr("Customize this format…")}</MenuItem>}
          <MenuItem onSelect={() => (close(), setMaking({ from: r }))}>{tr("Duplicate…")}</MenuItem>
          <MenuItem refusal={r.is_default ? tr("It is the default") : r.enabled === false ? tr("Turn it on first") : null} onSelect={() => (close(), void setDefault(r, r.entity))}>{tr("Set as default")}</MenuItem>
          <MenuItem onSelect={() => (close(), void setEnabled(r, r.enabled === false))}>{r.enabled === false ? tr("Turn on") : tr("Turn off")}</MenuItem>
          {r.source !== "package" && (
            <MenuItem danger onSelect={() => (close(), void remove(r))}>{r.source === "workspace" ? tr("Delete…") : tr("Reset to the package's…")}</MenuItem>
          )}
        </>
      )}
    </Menu>
  );
  const badges = (r: FormatRow) => (
    <span className="pf-badges">
      <Badge tone={r.source === "edited" ? "blue" : r.source === "workspace" ? "purple" : "neutral"}>{SOURCE_NAMES()[r.source]}</Badge>
      {r.is_default && <Badge tone="green">{tr("Default")}</Badge>}
      {r.enabled === false && <Badge tone="amber">{tr("Off")}</Badge>}
      {r.default_changed && <Badge tone="amber">{tr("The package updated it since your edit")}</Badge>}
    </span>
  );
  const nameCell = (r: FormatRow) => (
    <>
      <Link to={formatLink(r.key)}><strong>{isolate(r.label || r.key)}</strong></Link>
      <div className="mono faint">{isolate(r.key)}</div>
      {r.based_on && <div className="faint">{tr("Based on {key}", { key: r.based_on })}</div>}
    </>
  );
  const enabledSwitch = (r: FormatRow) => (
    <label className="check-field">
      <input type="checkbox" role="switch" checked={r.enabled !== false} aria-label={tr("{name} can be printed", { name: r.label || r.key })} onChange={(e) => void setEnabled(r, e.target.checked)} />
      <span>{r.enabled === false ? tr("Off") : tr("On")}</span>
    </label>
  );

  const ids = useId();
  return (
    <>
      <p className="muted">{tr("What a record looks like on paper and in a PDF. A package's format is customized as your own copy, so a new release can still improve the original.")}</p>
      <section className="card" aria-labelledby={`${ids}-h`}>
        <h2 id={`${ids}-h`} className="sr-only">{tr("Formats")}</h2>
        <div className="pf-toolbar">
          <Field label={tr("Record type")} htmlFor={`${ids}-entity`}>
            <select id={`${ids}-entity`} className="select" value={entity} onChange={(e) => setSp(e.target.value ? { entity: e.target.value } : {}, { replace: true })}>
              <option value="">{tr("Every record type")}</option>
              {entities.map((e) => (
                <option key={e.name} value={e.name}>{isolate(e.label)}</option>
              ))}
            </select>
          </Field>
          <Field label={tr("Find a format")} htmlFor={`${ids}-q`}>
            <input id={`${ids}-q`} className="input" type="search" value={search} placeholder={tr("Name or key")} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <span style={{ flex: 1 }} />
          <Button variant="primary" icon="plus" onClick={() => setMaking({})}>{tr("New format")}</Button>
        </div>
        {q.isLoading ? (
          <TableSkeleton columns={6} rows={4} />
        ) : q.error || !q.data ? (
          <LoadFailed error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data.templates.length ? (
          <StatePanel kind="empty" title={entity ? tr("{entity} has no print formats yet", { entity: label(entity) }) : tr("No print formats yet")} action={<Button variant="primary" icon="plus" onClick={() => setMaking({})}>{tr("New format")}</Button>}>
            {tr("Records print in their standard format until there is one. Start one blank or from another.")}
          </StatePanel>
        ) : !rows.length ? (
          <StatePanel kind="no-matches" onClear={() => setSearch("")} clearLabel={tr("Clear the search")}>{tr("No format matches “{q}”.", { q: search })}</StatePanel>
        ) : (
          <>
            <div className="table-wrap pf-wide">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Format")}</th>
                    {!entity && <th scope="col">{tr("Record type")}</th>}
                    <th scope="col">{tr("Kind")}</th>
                    <th scope="col">{tr("Where it comes from")}</th>
                    <th scope="col">{tr("Who may use it")}</th>
                    <th scope="col">{tr("Can be printed")}</th>
                    <th scope="col">{tr("Changed")}</th>
                    <th scope="col"><span className="sr-only">{tr("Actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{nameCell(r)}</td>
                      {!entity && <td>{isolate(label(r.entity))}</td>}
                      <td>{KIND_NAMES()[r.kind]}</td>
                      <td>{badges(r)}</td>
                      <td>{r.roles?.length ? isolate(r.roles.join(", ")) : <span className="faint">{tr("Everyone who may read the record")}</span>}</td>
                      <td>{enabledSwitch(r)}</td>
                      <td className="nowrap faint">{r.updated_at ? <>{formatDateTime(r.updated_at)}{r.updated_by ? <div>{isolate(r.updated_by)}</div> : null}</> : "—"}</td>
                      <td className="nowrap"><div className="row-actions">{actions(r)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="pf-cards pf-narrow-only">
              {rows.map((r) => (
                <li key={r.key} className="pf-card">
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>{nameCell(r)}</div>
                    {actions(r)}
                  </div>
                  <div className="faint">{[!entity ? label(r.entity) : null, KIND_NAMES()[r.kind], r.roles?.length ? r.roles.join(", ") : null].filter(Boolean).map((x) => isolate(String(x))).join(" · ")}</div>
                  {badges(r)}
                  {enabledSwitch(r)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {making && (
        <NewFormat
          from={making.from}
          customize={making.customize}
          entity={making.from?.entity ?? entity}
          entities={entities.map((e) => ({ name: e.name, label: e.label }))}
          layouts={level >= 2}
          taken={(q.data?.templates ?? []).map((r) => r.key)}
          others={q.data?.templates ?? []}
          onClose={() => setMaking(null)}
          onMade={async (key) => {
            setMaking(null);
            await refresh();
            navigate(formatLink(key));
          }}
        />
      )}
    </>
  );
}

/** New, Duplicate and "Customize this format": a name, its key, and what it starts from. A blank one opens in its editor unsaved;
 *  one started from another is the server's duplicate (§6.2), saved at once. */
function NewFormat({ from, customize, entity: given, entities, layouts, taken, others, onClose, onMade }: {
  from?: FormatRow; customize?: boolean; entity: string; entities: { name: string; label: string }[]; layouts: boolean; taken: string[]; others: FormatRow[]; onClose: () => void; onMade: (key: string) => void;
}) {
  const ids = useId();
  const navigate = useNavigate();
  const problemOf = useKeyProblem();
  const [label, setLabel] = useState(from ? tr("{name} (yours)", { name: from.label || from.key }) : "");
  const [key, setKey] = useState<string | null>(null);
  const [entity, setEntity] = useState(given || entities[0]?.name || "");
  const [kind, setKind] = useState<"layout" | "template">(layouts ? "layout" : "template");
  const [start, setStart] = useState(from?.key ?? "");
  const [makeDefault, setMakeDefault] = useState(!!customize);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const k = key ?? keyFrom(label);
  const keyProblem = k ? problemOf(k, taken) : null;
  const starts = others.filter((r) => r.entity === entity);
  const entityLabel = entities.find((e) => e.name === entity)?.label ?? entity;

  const make = async () => {
    if (!label.trim() || keyProblem || !entity) return setProblem(keyProblem ?? tr("Give the format a name."));
    setBusy(true);
    try {
      if (start) {
        await api.post(`/api/admin/documents/templates/${encodeURIComponent(start)}/duplicate`, { key: k, label: label.trim() });
        if (makeDefault) await api.put(`/api/admin/documents/defaults/${encodeURIComponent(entity)}`, { key: k });
        toast(tr("{name} made", { name: label.trim() }));
        onMade(k);
      } else {
        const fresh: PrintFormat =
          kind === "layout"
            ? { key: k, label: label.trim(), entity, output: "page", layout: { version: 1, sections: [{ id: "head", columns: [{ id: "head_c", blocks: [{ id: "title", type: "heading", text: entityLabel, level: 1 }, { id: "number", type: "field", value: "doc.number" }] }] }] } }
            : { key: k, label: label.trim(), entity, output: "page", languages: { en: { body: `<h1>${entityLabel.replace(/[<>&"]/g, "")} {{ doc.number }}</h1>\n` } } };
        onClose();
        navigate(formatLink(k), { state: { fresh } });
      }
    } catch (e) {
      setProblem(e instanceof ApiError && e.status === 409 ? tr("A format with this key already exists.") : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={customize ? tr("Customize {name}", { name: from?.label || from?.key || "" }) : from ? tr("Duplicate {name}", { name: from.label || from.key }) : tr("New print format")}
      description={customize ? tr("You edit your own copy; the package's stays as it is and keeps getting a release's improvements.") : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button variant="primary" loading={busy} disabled={busy || !label.trim() || !!keyProblem} onClick={() => void make()}>{start ? tr("Make the copy") : tr("Start the format")}</Button>
        </>
      }
    >
      <form className="stack" onSubmit={(e) => (e.preventDefault(), void make())}>
        <Field label={customize ? tr("Name of your copy") : tr("Name")} htmlFor={`${ids}-label`} required>
          <input id={`${ids}-label`} data-autofocus className="input" maxLength={80} value={label} onChange={(e) => (setLabel(e.target.value), setProblem(null))} />
        </Field>
        <Field label={tr("Key")} htmlFor={`${ids}-key`} hint={tr("How the format is named in links and packs. Made from the name; change it if you like.")} error={k ? (keyProblem ?? undefined) : undefined}>
          <input id={`${ids}-key`} className="input mono" dir="ltr" spellCheck={false} autoCapitalize="none" value={k} onChange={(e) => (setKey(e.target.value), setProblem(null))} />
        </Field>
        {!from && (
          <>
            <Field label={tr("Record type")} htmlFor={`${ids}-entity`}>
              <select id={`${ids}-entity`} className="select" value={entity} onChange={(e) => (setEntity(e.target.value), setStart(""))}>
                {entities.map((e) => (
                  <option key={e.name} value={e.name}>{isolate(e.label)}</option>
                ))}
              </select>
            </Field>
            <Field label={tr("Start from")} htmlFor={`${ids}-start`}>
              <select id={`${ids}-start`} className="select" value={start} onChange={(e) => setStart(e.target.value)}>
                <option value="">{tr("A blank format")}</option>
                {starts.map((r) => (
                  <option key={r.key} value={r.key}>{tr("A copy of {name}", { name: r.label || r.key })}</option>
                ))}
              </select>
            </Field>
            {!start && (
              <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="field-label">{tr("Kind")}</legend>
                <label className="check-field">
                  <input type="radio" name={`${ids}-kind`} checked={kind === "layout"} disabled={!layouts} onChange={() => setKind("layout")} />
                  <span>
                    {tr("Layout: drag fields onto the page")}
                    {!layouts && <span className="faint"> — {tr("needs a newer server")}</span>}
                  </span>
                </label>
                <label className="check-field">
                  <input type="radio" name={`${ids}-kind`} checked={kind === "template"} onChange={() => setKind("template")} />
                  {tr("Template: write the page in HTML with {{ doc.field }}")}
                </label>
              </fieldset>
            )}
          </>
        )}
        {(customize || from) && (
          <label className="check-field">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
            {tr("Make it the default for {entity}", { entity: entityLabel })}
          </label>
        )}
        {problem && <p className="field-error" role="alert">{isolate(problem)}</p>}
      </form>
    </Dialog>
  );
}

// ── one format: its template editor, or the designer for a layout ──

const TemplateEditor = lazy(() => import("./TemplateEditor").then((m) => ({ default: m.TemplateEditor })));
const Designer = lazy(() => import("./Designer").then((m) => ({ default: m.Designer })));

export function PrintFormatPage() {
  return (
    <AdminGate>
      <NeedsLevel level={1}>
        <FormatLoader />
      </NeedsLevel>
    </AdminGate>
  );
}

function FormatLoader() {
  const { key = "" } = useParams();
  const fresh = (useLocation().state as { fresh?: PrintFormat } | null)?.fresh;
  const q = useQuery({ queryKey: ["admin", "print", "format", key], queryFn: ({ signal }) => readFormat(key, signal), retry: false, enabled: !(fresh && fresh.key === key) });
  const loading = <PageLoading />;
  if (fresh && fresh.key === key) return <Suspense fallback={loading}>{fresh.layout ? <Designer key={key} fresh={fresh} /> : <TemplateEditor key={key} fresh={fresh} />}</Suspense>;
  if (q.isLoading) return loading;
  if (q.error || !q.data)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <StatePanel kind="empty" title={tr("There is no such print format")} action={<ButtonLink to={formatsLink()}>{tr("Back to the print formats")}</ButtonLink>} />
    ) : (
      <LoadFailed error={q.error} onRetry={() => void q.refetch()} />
    );
  return <Suspense fallback={loading}>{kindOf(q.data.template) === "layout" ? <Designer key={`${key}-${q.dataUpdatedAt}`} read={q.data} /> : <TemplateEditor key={`${key}-${q.dataUpdatedAt}`} read={q.data} />}</Suspense>;
}
