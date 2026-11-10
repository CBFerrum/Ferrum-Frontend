// Customize → Menus (administrators): a workspace's own menus. A menu gives a business built by configuration a tile on
// Home, "+" entries, a group among the records, and notes for the assistant. Each is saved as one `define_module`
// customization after a dry run, or removed with `remove_module`. The logic is lib/menuDraft.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker } from "react-router";
import { AppIcon, APP_ICON_NAMES } from "@ferrum/kit";
import { isolate, routeBase, t as tr } from "@ferrum/client";
import { errorMessage } from "../lib/api";
import { humanize } from "../lib/format";
import {
  checkMenu, fromModule, isReport, LIMITS, MAX_ITEMS, MAX_SUGGESTIONS, removeBatch, removeItem, saveBatch, setLabel, startMenu, toggleCreate, toModule,
  type MenuDraft, type Raw,
} from "../lib/menuDraft";
import { move } from "../lib/automationDraft";
import { useMe, useMetaIndex, useReports, type Module } from "../lib/meta";
import { Alert, Button, confirmDialog, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";
import { BatchRefused, useApplyBatch } from "./author/apply";
import { FormCard } from "./author/FormCard";
import { grow, Tools, wrap } from "./author/controls";

/** A menu's own page: another page scope, so it is opened as a page load. */
const openHref = (name: string) => `${routeBase("data")}${encodeURIComponent(name)}/`;

export function MenusPage() {
  const me = useMe();
  if (me.isLoading) return <PageLoading />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can set up menus. Ask one of them to make this change.")}</p>
      </EmptyState>
    );
  }
  return <Menus />;
}

function Menus() {
  const index = useMetaIndex();
  const apply = useApplyBatch();
  const [editing, setEditing] = useState<MenuDraft | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const mine = (index.data?.modules ?? []).filter((m) => m.package === "tenant");

  const remove = async (m: Module) => {
    if (!(await confirmDialog({ title: tr("Remove the menu?"), message: tr("“{label}” goes from Home and from the records pages. Switch the change off under Customizations to bring it back.", { label: m.label }), confirmLabel: tr("Remove"), danger: true }))) return;
    setRemoving(m.name);
    setSaved(null);
    try {
      const ops = removeBatch(m.name, tr("Menus"));
      await apply(ops, true);
      await apply(ops, false);
      toast(tr("Menu removed"));
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
            <Link to="/customize">{tr("Customize")}</Link>
          </p>
          <h1 className="page-title">{tr("Menus")}</h1>
        </div>
        {!editing && (
          <div className="page-actions">
            <Button variant="primary" icon="plus" onClick={() => { setSaved(null); setEditing(startMenu()); }}>{tr("New menu")}</Button>
          </div>
        )}
      </div>
      <p className="muted">{tr("A menu gives what you built a home: a tile on Home, entries in the + menu, a group among the records and notes for the assistant.")}</p>
      {saved && !editing && (
        <Alert tone="success" action={<a className="btn" href={openHref(saved)}>{tr("Open")}</a>}>
          {tr("Menu saved. Its tile appears on Home for people who may read one of its records.")}
        </Alert>
      )}
      {index.error ? (
        <ErrorState error={index.error} onRetry={() => index.refetch()} />
      ) : editing ? (
        <MenuForm key={editing.saved ? editing.name : "new"} start={editing} taken={mine.map((m) => m.name)} onClose={() => setEditing(null)} onSaved={(name) => { setSaved(name); setEditing(null); }} />
      ) : index.isLoading ? (
        <PageLoading />
      ) : !mine.length ? (
        <EmptyState title={tr("No menus yet")} icon="edit" />
      ) : (
        <section className="card" aria-labelledby="mn-list">
          <div className="card-head">
            <h2 id="mn-list">{tr("This workspace's menus")}</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tr("Menu")}</th>
                  <th scope="col">{tr("Name")}</th>
                  <th scope="col">{tr("Items")}</th>
                  <th scope="col"><span className="sr-only">{tr("Change")}</span></th>
                </tr>
              </thead>
              <tbody>
                {mine.map((m) => (
                  <tr key={m.name}>
                    <td><AppIcon name={m.icon} color={m.color} title={m.label} tile size={14} /> {isolate(m.label)}</td>
                    <td className="mono">{isolate(m.name)}</td>
                    <td>{m.items.length}</td>
                    <td className="nowrap">
                      <a className="btn btn-sm" href={openHref(m.name)} aria-label={tr("Open {name}", { name: m.label })}>{tr("Open")}</a>{" "}
                      <Button size="sm" onClick={() => { setSaved(null); setEditing(fromModule(m as unknown as Raw)); }} aria-label={tr("Edit {name}", { name: m.label })}>{tr("Edit")}</Button>{" "}
                      <Button size="sm" icon="trash" loading={removing === m.name} disabled={!!removing} onClick={() => void remove(m)} aria-label={tr("Remove {name}", { name: m.label })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

const box = { border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: 0, minWidth: 0 } as const;

function MenuForm({ start, taken, onClose, onSaved }: { start: MenuDraft; taken: string[]; onClose: () => void; onSaved: (name: string) => void }) {
  const index = useMetaIndex().data;
  const reports = useReports().data?.reports;
  const apply = useApplyBatch();
  const [d, setD] = useState(start);
  const [base] = useState(() => JSON.stringify(toModule(start)));
  const [problems, setProblems] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closing = useRef(false);
  const dirty = JSON.stringify(toModule(d)) !== base;
  const others = taken.filter((n) => n !== start.name);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => !closing.current && dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({ title: tr("Leave without saving?"), message: tr("Your changes to this menu will be lost."), confirmLabel: tr("Leave"), danger: true }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (next: MenuDraft) => {
    setD(next);
    setProblems([]);
    setRefusal(null);
  };
  const entities = useMemo(() => (index?.entities ?? []).filter((e) => e.kind !== "child"), [index]);
  const label = useMemo(() => {
    const m = new Map<string, string>(entities.map((e) => [e.name, e.label]));
    for (const r of reports ?? []) m.set(`report:${r.name}`, r.label);
    return (item: string) => m.get(item) ?? (isReport(item) ? humanize(item.slice(7)) : item);
  }, [entities, reports]);
  // The groups the add-select offers: the workspace's own entities first, then each package's, then the reports.
  const groups = useMemo(() => {
    const out = new Map<string, { value: string; label: string }[]>();
    for (const e of [...entities].sort((a, b) => a.label.localeCompare(b.label))) {
      if (d.items.includes(e.name)) continue;
      const g = e.custom || e.package === "tenant" ? "" : e.package ? humanize(e.package) : "~";
      out.set(g, [...(out.get(g) ?? []), { value: e.name, label: e.label }]);
    }
    const names = [...out.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
    return names.map((g) => ({ title: g === "" ? tr("This workspace's own") : g === "~" ? tr("More record types") : g, options: out.get(g)! }));
  }, [entities, d.items]);
  const reportOptions = (reports ?? []).filter((r) => !d.items.includes(`report:${r.name}`));

  const save = async () => {
    const found = checkMenu(d, others);
    setProblems(found);
    setRefusal(null);
    if (found.length) return;
    setBusy(true);
    try {
      const ops = saveBatch(d, tr("Menus"));
      await apply(ops, true);
      await apply(ops, false);
      closing.current = true;
      onSaved(d.name.trim());
    } catch (e) {
      setRefusal(e instanceof BatchRefused ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const noInstructions = !d.instructions.trim() && d.suggestions.some((s) => s.trim());

  return (
    <FormCard title={start.saved ? tr("Change the menu {name}", { name: start.label }) : tr("New menu")} onSubmit={save} busy={busy} submitLabel={tr("Save menu")} error={refusal}>
      {problems.length > 0 && (
        <Alert tone="error">
          <strong>{tr("Fix these first")}</strong>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{isolate(p)}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="row" style={wrap}>
        <div style={{ ...grow, flexBasis: 220 }}>
          <Field label={tr("Label")} htmlFor="mn-label" required>
            <input id="mn-label" className="input" maxLength={LIMITS.label} value={d.label} onChange={(e) => set(setLabel(d, e.target.value, others))} />
          </Field>
        </div>
        <div style={{ ...grow, flexBasis: 200 }}>
          <Field label={tr("Name")} htmlFor="mn-name" hint={d.saved ? tr("Fixed once the menu is saved.") : tr("Made from the label. You can change it until the menu is saved.")}>
            <input id="mn-name" className="input mono" value={d.name} readOnly={d.saved} spellCheck={false} autoCapitalize="none" onChange={(e) => set({ ...d, name: e.target.value, nameTouched: true })} />
          </Field>
        </div>
      </div>
      <Field label={tr("Description")} htmlFor="mn-desc" hint={tr("Shown on the menu's tile.")}>
        <input id="mn-desc" className="input" maxLength={LIMITS.description} value={d.description} onChange={(e) => set({ ...d, description: e.target.value })} />
      </Field>
      <fieldset style={box}>
        <legend className="field-label">{tr("Icon")}</legend>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {["", ...APP_ICON_NAMES].map((n) => (
            <label key={n || "none"} className="check-field" style={{ gap: 4 }}>
              <input type="radio" name="mn-icon" checked={d.icon === n} onChange={() => set({ ...d, icon: n })} />
              {n ? <AppIcon name={n} color={d.color} size={18} /> : null}
              <span className="faint">{n ? isolate(n) : tr("None (the label's initial)")}</span>
            </label>
          ))}
          {d.icon && !APP_ICON_NAMES.includes(d.icon) && (
            <label className="check-field" style={{ gap: 4 }}>
              <input type="radio" name="mn-icon" checked readOnly />
              <span className="faint">{isolate(d.icon)}</span>
            </label>
          )}
        </div>
      </fieldset>
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <label className="field-label" htmlFor="mn-color">{tr("Colour")}</label>
        <input id="mn-color" type="color" value={/^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "#336699"} onChange={(e) => set({ ...d, color: e.target.value })} />
        <span className="mono">{d.color || tr("none")}</span>
        {d.color && <Button size="sm" onClick={() => set({ ...d, color: "" })}>{tr("No colour")}</Button>}
      </div>
      <fieldset style={box} className="stack">
        <legend className="field-label">{tr("Items, in order")}</legend>
        <p className="faint">{tr("Record types and reports. A record type with a tick also gets an entry in the + menu.")}</p>
        {!d.items.length && <p className="faint">{tr("Nothing yet: add what the menu holds.")}</p>}
        {d.items.map((item, i) => (
          <div key={item} className="row" style={{ ...wrap, alignItems: "center", justifyContent: "space-between" }}>
            <span style={grow}>
              {isReport(item) ? tr("Report: {name}", { name: isolate(label(item)) }) : isolate(label(item))}
            </span>
            {!isReport(item) && (
              <label className="check-field">
                <input type="checkbox" checked={d.create.includes(item)} onChange={(e) => set(toggleCreate(d, item, e.target.checked))} />
                {tr("Offer it in the + menu")}
              </label>
            )}
            <Tools index={i} count={d.items.length} what={label(item)} onMove={(by) => set({ ...d, items: move(d.items, i, by) })} onRemove={() => set(removeItem(d, item))} />
          </div>
        ))}
        <select className="select" aria-label={tr("Add an item")} value="" disabled={d.items.length >= MAX_ITEMS} onChange={(e) => e.target.value && set({ ...d, items: [...d.items, e.target.value] })}>
          <option value="">{tr("Add an item…")}</option>
          {groups.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>{isolate(o.label)}</option>
              ))}
            </optgroup>
          ))}
          {reportOptions.length > 0 && (
            <optgroup label={tr("Reports")}>
              {reportOptions.map((r) => (
                <option key={r.name} value={`report:${r.name}`}>{isolate(r.label)}</option>
              ))}
            </optgroup>
          )}
        </select>
        {d.items.length >= MAX_ITEMS && <p className="faint">{tr("A menu has at most {n} items.", { n: MAX_ITEMS })}</p>}
      </fieldset>
      <fieldset style={box} className="stack">
        <legend className="field-label">{tr("For the assistant")}</legend>
        <Field label={tr("Instructions (optional)")} htmlFor="mn-instr" hint={tr("What the assistant should know on this menu's pages: terms, rules, how to answer.")}>
          <textarea id="mn-instr" className="textarea" rows={4} value={d.instructions} onChange={(e) => set({ ...d, instructions: e.target.value })} />
        </Field>
        <p className={d.instructions.length > LIMITS.instructions ? "field-error" : "faint"}>{tr("{n} of {max} characters", { n: d.instructions.length, max: LIMITS.instructions })}</p>
        <p className="faint">{tr("Suggested questions shown on this menu's pages.")}</p>
        {d.suggestions.map((s, i) => (
          <div key={i} className="row" style={{ gap: 8 }}>
            <input className="input" style={grow} maxLength={LIMITS.suggestion} aria-label={tr("Suggested question {n}", { n: i + 1 })} value={s} onChange={(e) => set({ ...d, suggestions: d.suggestions.map((x, j) => (j === i ? e.target.value : x)) })} />
            <Button size="sm" icon="trash" aria-label={tr("Remove suggested question {n}", { n: i + 1 })} onClick={() => set({ ...d, suggestions: d.suggestions.filter((_, j) => j !== i) })} />
          </div>
        ))}
        {noInstructions && <p className="field-error" role="alert">{tr("Suggested questions need instructions for the assistant: write them, or clear the questions.")}</p>}
        <div>
          <Button size="sm" icon="plus" disabled={d.suggestions.length >= MAX_SUGGESTIONS} onClick={() => set({ ...d, suggestions: [...d.suggestions, ""] })}>{tr("Add a suggested question")}</Button>
        </div>
      </fieldset>
      <div>
        <Button onClick={async () => { if (!dirty || (await confirmDialog({ title: tr("Leave without saving?"), message: tr("Your changes to this menu will be lost."), confirmLabel: tr("Leave"), danger: true }))) { closing.current = true; onClose(); } }}>{tr("Cancel")}</Button>
      </div>
    </FormCard>
  );
}
