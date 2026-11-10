// Admin → Interface words (FERRUM-UX-006): the workspace's own words for its interface in a
// language. Every word the interface asks for is listed with the interface's own translation, and
// each app's own words (its build's words.json, from /api/shell/words) under the app; what is
// written here stands over the translation, or gives what the catalog lacks, and each page reads it
// as it loads. Kept as InterfaceWord records, one per language and English words, whichever app
// asks for them.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, docPath, errorMessage, newKey } from "../lib/api";
import { builtInWords, interfaceWords, LANGUAGES, t } from "../lib/i18n";
import { useMetaIndex, type Doc, type EntityMeta, type ListResponse, type Module } from "../lib/meta";
import { Button, EmptyState, Spinner, toast } from "../ui/kit";
import { t as tr, isolate } from "@ferrum/client";

const E = "InterfaceWord";

/** An app's own words, as its interface asks t() for them. */
export interface AppWords {
  app: string;
  title: string;
  words: string[];
}

/** The group of the names the workspace gave its own entities, among the apps' groups. */
const OWN = "~workspace";
/** The most descriptions fetched for that group: a workspace with more made entities shows the first ones. */
export const OWN_ENTITIES_CAP = 60;

/**
 * The names a workspace gave an entity it made itself (`package` "tenant" or `custom`): its labels,
 * fields, choices, buttons, workflow and form sections. A packaged entity gives nothing: the
 * description does not say which of its fields the workspace added.
 */
export function ownNames(m: Pick<EntityMeta, "package" | "custom" | "label" | "label_plural" | "fields" | "actions" | "workflow" | "form"> & { targets?: { label: string }[] }): string[] {
  if (m.package !== "tenant" && !m.custom) return [];
  const out = [m.label, m.label_plural];
  for (const f of m.fields ?? []) out.push(f.label, ...(f.options ?? []));
  for (const a of m.actions ?? []) out.push(a.label, a.confirm ?? "", ...(a.params ?? []).flatMap((p) => [p.label, ...(p.options ?? [])]));
  for (const x of m.targets ?? []) out.push(x.label);
  for (const s of m.workflow?.states ?? []) out.push(s.name);
  for (const x of m.workflow?.transitions ?? []) out.push(x.action);
  for (const s of m.form ?? []) out.push(s.label ?? "");
  return out.filter(Boolean);
}

/** The labels and descriptions of the workspace's own menus (modules of the package `tenant`). */
export function ownMenuNames(modules: Pick<Module, "package" | "label" | "description">[]): string[] {
  return modules.filter((m) => m.package === "tenant").flatMap((m) => [m.label, m.description ?? ""]).filter(Boolean);
}

/** The workspace's words in `language`, by their English, every page of them. */
async function ownWords(language: string, signal?: AbortSignal): Promise<Map<string, Doc>> {
  const out = new Map<string, Doc>();
  let cursor: string | undefined;
  do {
    const page = await api.get<ListResponse>(
      docPath(E),
      { fields: "id,version,english,words", filters: JSON.stringify([["language", "=", language]]), limit: 500, sort: "created_at asc", cursor },
      signal,
    );
    for (const r of page.rows) out.set(String(r.english), r);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

/** What a save does with one word: what was kept, what is written now. */
export function change(kept: Doc | undefined, written: string): "create" | "update" | "delete" | null {
  const now = written.trim();
  const before = typeof kept?.words === "string" ? kept.words : "";
  if (now === before) return null;
  if (!kept) return now ? "create" : null;
  return now ? "update" : "delete";
}

export function InterfaceWords() {
  const qc = useQueryClient();
  const offered = LANGUAGES.filter((l) => l.tag !== "en");
  const [language, setLanguage] = useState(offered[0]?.tag ?? "ar");
  const [other, setOther] = useState("");
  const [find, setFind] = useState("");
  const [of, setOf] = useState("");
  const apps = useQuery({ queryKey: ["app-words"], queryFn: ({ signal }) => api.get<{ apps: AppWords[] }>("/api/shell/words", undefined, signal), staleTime: 60_000 });
  const index = useMetaIndex();
  const made = (index.data?.entities ?? []).filter((e) => e.package === "tenant" || e.custom).map((e) => e.name).slice(0, OWN_ENTITIES_CAP);
  // Fetched when the group is opened: the description of each entity the workspace made.
  const names = useQuery({
    queryKey: ["own-entity-names", made],
    enabled: of === OWN && !!made.length,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const metas = await Promise.all(made.map((n) => api.get<EntityMeta>(`/api/meta/${encodeURIComponent(n)}`, undefined, signal).catch(() => null)));
      return metas.flatMap((m) => (m ? ownNames(m) : []));
    },
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const own = useQuery({ queryKey: ["interface-words", language], queryFn: ({ signal }) => ownWords(language, signal) });
  // The built-in catalogs are fetched as they are wanted (each is large).
  const catalog = useQuery({ queryKey: ["built-in-words", language], queryFn: () => builtInWords(language), staleTime: Infinity });
  const asked = useQuery({ queryKey: ["interface-words-asked"], queryFn: interfaceWords, staleTime: Infinity });
  const builtIn = useMemo(() => catalog.data ?? {}, [catalog.data]);
  const words = useMemo(() => {
    const listed = new Set([...(asked.data ?? []), ...(apps.data?.apps ?? []).flatMap((a) => a.words)]);
    const mine = [...new Set([...(names.data ?? []), ...ownMenuNames(index.data?.modules ?? [])])].filter((w) => !listed.has(w)).sort((a, b) => a.localeCompare(b));
    const all = of === OWN ? mine : of ? (apps.data?.apps.find((a) => a.app === of)?.words ?? []) : (asked.data ?? []);
    const q = find.trim().toLowerCase();
    return q ? all.filter((w) => w.toLowerCase().includes(q) || (builtIn[w] ?? "").toLowerCase().includes(q)) : all;
  }, [find, builtIn, of, apps.data, asked.data, names.data, index.data]);
  const written = (w: string) => draft[w] ?? (typeof own.data?.get(w)?.words === "string" ? String(own.data.get(w)?.words) : "");
  const pending = Object.keys(draft).filter((w) => change(own.data?.get(w), draft[w]) !== null);

  const pick = (tag: string) => {
    setLanguage(tag);
    setDraft({});
  };
  const save = async () => {
    setBusy(true);
    let done = 0;
    try {
      for (const w of pending) {
        const kept = own.data?.get(w);
        const now = draft[w].trim();
        const what = change(kept, draft[w]);
        if (what === "create") await api.post(docPath(E), { language, english: w, words: now }, { idempotencyKey: newKey() });
        else if (what === "update") await api.patch(docPath(E, String(kept?.id)), { words: now }, { ifMatch: kept?.version as number | undefined });
        else if (what === "delete") await api.del(docPath(E, String(kept?.id)), { ifMatch: kept?.version as number | undefined });
        done++;
      }
      setDraft({});
      toast(done === 1 ? t("Saved 1 word: pages read it as they load") : t("Saved {n} words: pages read them as they load", { n: done }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ["interface-words", language] });
    }
  };

  return (
    <div className="stack">
      <p className="muted">
        {t("The workspace's own words for its interface. What you write stands over the interface's own translation, or gives the words it lacks; record and field names are each app's.")}
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <select className="select" aria-label={t("Language")} value={offered.some((l) => l.tag === language) ? language : ""} onChange={(e) => e.target.value && pick(e.target.value)}>
          {offered.map((l) => (
            <option key={l.tag} value={l.tag}>
              {isolate(l.name)}
            </option>
          ))}
          <option value="">{t("Another language…")}</option>
        </select>
        <input
          className="input"
          style={{ maxWidth: 140 }}
          aria-label={t("Another language's tag")}
          placeholder={tr("fr, pt-BR")}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(other.trim()) && pick(other.trim())}
        />
        <select className="select" aria-label={t("Words of")} value={of} onChange={(e) => setOf(e.target.value)}>
          <option value="">{t("The interface")}</option>
          <option value={OWN}>{t("This workspace's own names")}</option>
          {(apps.data?.apps ?? []).map((a) => (
            <option key={a.app} value={a.app}>
              {isolate(a.title)}
            </option>
          ))}
        </select>
        <input className="input" type="search" style={{ maxWidth: 260 }} aria-label={t("Find a word")} placeholder={t("Search…")} value={find} onChange={(e) => setFind(e.target.value)} />
        <span className="spacer" />
        <Button variant="primary" disabled={!pending.length || busy} loading={busy} onClick={() => void save()}>
          {pending.length === 1 ? t("Save 1 word") : pending.length ? t("Save {n} words", { n: pending.length }) : t("Save")}
        </Button>
      </div>
      {own.isLoading ? (
        <Spinner label={t("Loading…")} />
      ) : own.isError ? (
        <EmptyState title={t("The workspace's words could not be read")}>{isolate(errorMessage(own.error))}</EmptyState>
      ) : (
        <table className="table">
          <caption className="sr-only">{t("Interface words")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("English")}</th>
              <th scope="col">{t("The interface's own")}</th>
              <th scope="col">{t("This workspace's")}</th>
            </tr>
          </thead>
          <tbody>
            {words.map((w) => (
              <tr key={w}>
                <td dir="ltr">{isolate(w)}</td>
                <td>{builtIn[w] ?? "—"}</td>
                <td>
                  <input className="input" aria-label={t("{words} in this workspace", { words: w })} value={written(w)} onChange={(e) => setDraft((d) => ({ ...d, [w]: e.target.value }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
