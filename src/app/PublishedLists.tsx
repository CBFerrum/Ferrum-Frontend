// Published lists (administrators): some fields of some records of an entity, readable by anyone on the internet without
// signing in (a public register, a price list). A list is one `publish_list` customization, saved after a dry run, and is
// taken down with `unpublish_list`. The draft logic is lib/publishedListDraft.ts; the server's refusal is the final word.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { bootstrap, t as tr, isolate } from "@ferrum/client";
import { api, ApiError, errorMessage } from "../lib/api";
import { useEntityMeta, useMe, type Field as MetaField, type EntityMeta } from "../lib/meta";
import { checkList, currentLists, fromList, MAX_FIELDS, MAX_LIMIT, MAX_LISTS, offering, publicPath, saveBatch, setLabel, startList, takeDownBatch, type ListDraft } from "../lib/publishedListDraft";
import { Alert, Button, confirmDialog, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";
import { BatchRefused, useApplyBatch } from "./author/apply";
import { FormCard } from "./author/FormCard";
import { FilterRows, grow, optionsOf, Pick, wrap } from "./author/controls";

export function PublishedListsPage() {
  const { entity = "" } = useParams();
  const me = useMe();
  if (me.isLoading) return <PageLoading />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can publish lists. Ask one of them to make this change.")}</p>
      </EmptyState>
    );
  }
  return <Loader key={entity} entity={entity} />;
}

function Loader({ entity }: { entity: string }) {
  const meta = useEntityMeta(entity);
  if (meta.error) {
    if (meta.error instanceof ApiError && meta.error.status === 404) {
      return (
        <EmptyState title={tr("There is no such entity")} icon="alert">
          <p className="muted">{tr("Nothing called {entity} is installed in this workspace.", { entity: isolate(entity) })}</p>
          <Link className="btn" to="/customize">{tr("Back to Customize")}</Link>
        </EmptyState>
      );
    }
    return <ErrorState error={meta.error} onRetry={() => meta.refetch()} title={tr("Could not load {entity}", { entity: isolate(entity) })} />;
  }
  if (!meta.data) return <PageLoading />;
  if (meta.data.kind !== "master" && meta.data.kind !== "document") {
    return (
      <EmptyState title={tr("This cannot be published")} icon="alert">
        <p className="muted">{tr("Only the records of a master or a document can be published, not lines, ledgers or settings.")}</p>
        <Link className="btn" to="/customize">{tr("Back to Customize")}</Link>
      </EmptyState>
    );
  }
  return <Lists meta={meta.data} />;
}

type Row = { entity: string; op: Record<string, unknown>; is_active: boolean; superseded_by?: string | null; seq?: number };

/** The full definitions (description, filter, order, limit) are in the customization list, not in the meta. */
function useDefinitions() {
  return useQuery({
    queryKey: ["customize"],
    queryFn: ({ signal }) => api.get<{ customizations: Row[] }>("/api/customize", undefined, signal),
  });
}

const addressOf = (name: string) => {
  const slug = bootstrap()?.workspace?.slug;
  return slug ? `${window.location.origin}${publicPath(slug, name)}` : "";
};

const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => toast(tr("Address copied")), () => toast(tr("Select it and copy it"), "error"));

function Address({ name }: { name: string }) {
  const url = addressOf(name);
  if (!url) return null;
  return (
    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>{url}</a>
      <Button size="sm" icon="copy" onClick={() => copy(url)} aria-label={tr("Copy address of {name}", { name })}>{tr("Copy address")}</Button>
    </span>
  );
}

function Lists({ meta }: { meta: EntityMeta }) {
  const apply = useApplyBatch();
  const defs = useDefinitions();
  const [editing, setEditing] = useState<ListDraft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const lists = meta.published_lists ?? [];
  const label = isolate(meta.label);
  const labelOf = new Map(meta.fields.map((f) => [f.name, f.label || f.name]));
  labelOf.set("number", tr("Number"));

  const edit = (l: { name: string; label: string; fields: string[]; csv?: boolean }) => {
    const full = currentLists(defs.data?.customizations ?? [], meta.name).find((x) => x.name === l.name);
    setEditing(fromList(full ?? { name: l.name, label: l.label, fields: l.fields, csv: l.csv }));
  };

  const takeDown = async (l: { name: string; label: string }) => {
    if (!(await confirmDialog({ title: tr("Take the list down?"), message: tr("“{label}” stops being public. Its address stops answering at once, for everyone. Switch the change off under Customizations to bring it back.", { label: l.label }), confirmLabel: tr("Take down"), danger: true }))) return;
    setRemoving(l.name);
    try {
      const ops = takeDownBatch(meta.name, l.name, tr("Public lists"));
      await apply(ops, true);
      await apply(ops, false);
      toast(tr("List taken down"));
    } catch (e) {
      toast(e instanceof BatchRefused ? e.message : errorMessage(e), "error");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/customize">{tr("Customize")}</Link> / <Link to={`/customize/${encodeURIComponent(meta.name)}`}>{label}</Link>
          </p>
          <h1 className="page-title">{tr("Public lists of {entity}", { entity: label })}</h1>
        </div>
        {!editing && (
          <div className="page-actions">
            <Button variant="primary" icon="plus" onClick={() => setEditing(startList())}>{tr("New list")}</Button>
          </div>
        )}
      </div>
      {editing ? (
        <ListForm key={editing.saved ? editing.name : "new"} meta={meta} start={editing} taken={lists.map((l) => l.name)} onClose={() => setEditing(null)} />
      ) : (
        <section className="card" aria-labelledby="pl-list">
          <div className="card-head">
            <h2 id="pl-list">{tr("Lists anyone can read")}</h2>
          </div>
          {!lists.length ? (
            <EmptyState title={tr("No public lists yet")} icon="edit">
              <p className="muted">{tr("A public list shows chosen fields of {entity} to anyone on the internet, without signing in: a register, a price list.", { entity: label })}</p>
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tr("List")}</th>
                    <th scope="col">{tr("Fields shown")}</th>
                    <th scope="col">{tr("Public address")}</th>
                    <th scope="col"><span className="sr-only">{tr("Change")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lists.map((l) => (
                    <tr key={l.name}>
                      <td>
                        {isolate(l.label)}
                        <div className="faint mono">{isolate(l.name)}</div>
                      </td>
                      <td>{isolate(l.fields.map((f) => labelOf.get(f) ?? f).join(", "))}{l.csv ? ` · ${tr("CSV download")}` : ""}</td>
                      <td><Address name={l.name} /></td>
                      <td className="nowrap">
                        <Button size="sm" onClick={() => edit(l)} aria-label={tr("Edit {name}", { name: l.label })}>{tr("Edit")}</Button>{" "}
                        <Button size="sm" icon="trash" loading={removing === l.name} disabled={!!removing} onClick={() => void takeDown(l)} aria-label={tr("Take down {name}", { name: l.label })}>{tr("Take down")}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ListForm({ meta, start, taken, onClose }: { meta: EntityMeta; start: ListDraft; taken: string[]; onClose: () => void }) {
  const apply = useApplyBatch();
  const [d, setD] = useState(start);
  const [problems, setProblems] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const others = taken.filter((n) => n !== start.name);
  const { offered, unavailable } = offering(meta);
  const gone = d.fields.filter((n) => !offered.some((o) => o.name === n));
  const usable: MetaField[] = [...(meta.numbering ? [{ name: "number", label: tr("Number"), type: "data" } as MetaField] : []), ...meta.fields.filter((f) => f.type !== "table")];
  const set = (next: ListDraft) => {
    setD(next);
    setProblems([]);
    setRefusal(null);
  };

  const save = async () => {
    const found = checkList(d, { taken: others, offered, fields: usable });
    setProblems(found);
    setRefusal(null);
    if (found.length) return;
    setBusy(true);
    try {
      const ops = saveBatch(meta.name, d, tr("Public lists"));
      await apply(ops, true);
      await apply(ops, false);
      toast(d.saved ? tr("List saved") : tr("List published"));
      setSaved(d.name.trim());
    } catch (e) {
      if (e instanceof BatchRefused && e.unchanged) {
        toast(tr("Nothing changed"));
        return onClose();
      }
      setRefusal(e instanceof BatchRefused ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <section className="card" aria-labelledby="pl-done">
        <div className="card-head">
          <h2 id="pl-done">{tr("The list is public")}</h2>
        </div>
        <div className="card-body stack">
          <p>{tr("Anyone can read it at this address, without signing in.")}</p>
          <Address name={saved} />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {addressOf(saved) && <a className="btn" href={addressOf(saved)} target="_blank" rel="noopener noreferrer">{tr("Open")}</a>}
            {addressOf(saved) && <Button onClick={() => copy(addressOf(saved))}>{tr("Copy address")}</Button>}
            <Button onClick={onClose}>{tr("Done")}</Button>
          </div>
        </div>
      </section>
    );
  }

  const tick = (name: string, on: boolean) => set({ ...d, fields: on ? [...d.fields, name] : d.fields.filter((n) => n !== name) });
  const row = (name: string, label: string, note?: string) => (
    <label key={name} className="check-field" style={{ alignItems: "flex-start" }}>
      <input type="checkbox" checked={d.fields.includes(name)} disabled={!d.fields.includes(name) && d.fields.length >= MAX_FIELDS} onChange={(e) => tick(name, e.target.checked)} />
      <span>{isolate(label)}{note && <span className="faint"> ({note})</span>}</span>
    </label>
  );

  return (
    <FormCard title={start.saved ? tr("Change the list {name}", { name: start.label }) : tr("New list")} onSubmit={save} busy={busy} submitLabel={tr("Save list")} error={refusal}>
      <Alert tone="warning">
        <strong>{tr("This list is public.")}</strong>{" "}
        {tr("What is listed here can be read by anyone on the internet, without signing in. Only the fields you tick are shown.")}
        {meta.submittable && ` ${tr("Only submitted records are shown: drafts and cancelled records never are.")}`}
      </Alert>
      {problems.length > 0 && (
        <Alert tone="error">
          <strong>{tr("Fix these first")}</strong>
          <ul>
            {problems.map((p, i) => <li key={i}>{isolate(p)}</li>)}
          </ul>
        </Alert>
      )}
      <div className="row" style={wrap}>
        <div style={{ ...grow, flexBasis: 220 }}>
          <Field label={tr("Label")} htmlFor="pl-label" required>
            <input id="pl-label" className="input" value={d.label} onChange={(e) => set(setLabel(d, e.target.value))} />
          </Field>
        </div>
        <div style={{ ...grow, flexBasis: 200 }}>
          <Field label={tr("Name")} htmlFor="pl-name" hint={d.saved ? tr("Fixed once the list is saved.") : tr("Made from the label. You can change it until the list is saved.")}>
            <input id="pl-name" className="input mono" value={d.name} readOnly={d.saved} spellCheck={false} autoCapitalize="none" onChange={(e) => set({ ...d, name: e.target.value.toLowerCase(), nameTouched: true })} />
          </Field>
        </div>
      </div>
      {d.name.trim() && addressOf(d.name.trim()) && <p className="faint" style={{ overflowWrap: "anywhere" }}>{tr("Its public address: {address}", { address: addressOf(d.name.trim()) })}</p>}
      <Field label={tr("Description (optional)")} htmlFor="pl-desc" hint={tr("Shown above the list on its public page, in the words you write here.")}>
        <textarea id="pl-desc" className="textarea" rows={2} value={d.description} onChange={(e) => set({ ...d, description: e.target.value })} />
      </Field>

      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="field-label">{tr("Fields to show ({n} of {max})", { n: d.fields.length, max: MAX_FIELDS })}</legend>
        <p className="faint">{tr("The columns appear in the order you tick them.")}</p>
        {offered.map((o) => row(o.name, o.label))}
        {gone.map((n) => row(n, n, tr("can no longer be published")))}
        {!offered.length && <p className="faint">{tr("No field of this entity can be published.")}</p>}
        {unavailable.length > 0 && (
          <div className="stack">
            <p className="faint">{tr("These fields cannot be published:")}</p>
            <ul className="faint">
              {unavailable.map((u) => <li key={u.name}>{isolate(u.label)}: {u.why}</li>)}
            </ul>
          </div>
        )}
      </fieldset>

      <div className="stack">
        <strong>{tr("Which records")}</strong>
        <p className="faint">{meta.submittable ? tr("Only submitted records show, whatever you choose here. Leave the rows out to show every submitted record.") : tr("Leave the rows out to show every record. The values you filter on are not shown unless you tick the field.")}</p>
        <FilterRows rows={d.filters} fields={usable} onChange={(filters) => set({ ...d, filters })} />
      </div>

      <div className="row" style={wrap}>
        <div style={{ ...grow, flexBasis: 200 }}>
          <Field label={tr("Order by (optional)")} htmlFor="pl-sort">
            <Pick id="pl-sort" label={tr("Order by (optional)")} value={d.sortField} options={optionsOf(usable, d.sortField)} onChange={(sortField) => set({ ...d, sortField })} />
          </Field>
        </div>
        <div style={{ ...grow, flexBasis: 160 }}>
          <Field label={tr("Direction")} htmlFor="pl-dir">
            <select id="pl-dir" className="select" disabled={!d.sortField} value={d.sortDir} onChange={(e) => set({ ...d, sortDir: e.target.value as "asc" | "desc" })}>
              <option value="asc">{tr("Ascending")}</option>
              <option value="desc">{tr("Descending")}</option>
            </select>
          </Field>
        </div>
        <div style={{ ...grow, flexBasis: 140 }}>
          <Field label={tr("Show at most")} htmlFor="pl-limit" hint={tr("1 to {max} records; blank: 200.", { max: MAX_LIMIT })}>
            <input id="pl-limit" className="input" type="number" min={1} max={MAX_LIMIT} step={1} inputMode="numeric" value={d.limit} onChange={(e) => set({ ...d, limit: e.target.value })} />
          </Field>
        </div>
      </div>
      <label className="check-field">
        <input type="checkbox" checked={d.csv} onChange={(e) => set({ ...d, csv: e.target.checked })} />
        {tr("Offer a CSV download")}
      </label>
      <p className="faint">{tr("At most {n} lists in a workspace.", { n: MAX_LISTS })}</p>
      <div>
        <Button onClick={onClose}>{tr("Cancel")}</Button>
      </div>
    </FormCard>
  );
}
