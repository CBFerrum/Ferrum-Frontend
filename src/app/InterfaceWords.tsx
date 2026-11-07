// Admin → Interface words (FERRUM-UX-006): the workspace's own words for its interface in a
// language. Every word the interface asks for is listed with the interface's own translation; what
// is written here stands over it, or gives what the catalog lacks, and each page reads it as it
// loads. Kept as InterfaceWord records, one per language and English words.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, docPath, errorMessage, newKey } from "../lib/api";
import { builtInWords, interfaceWords, LANGUAGES, t } from "../lib/i18n";
import type { Doc, ListResponse } from "../lib/meta";
import { Button, EmptyState, Spinner, toast } from "../ui/kit";

const E = "InterfaceWord";

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
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const own = useQuery({ queryKey: ["interface-words", language], queryFn: ({ signal }) => ownWords(language, signal) });
  const builtIn = builtInWords(language);
  const words = useMemo(() => {
    const all = interfaceWords();
    const q = find.trim().toLowerCase();
    return q ? all.filter((w) => w.toLowerCase().includes(q) || (builtIn[w] ?? "").toLowerCase().includes(q)) : all;
  }, [find, builtIn]);
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
      toast(t("Saved {n} words: pages read them as they load", { n: done }));
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
              {l.name}
            </option>
          ))}
          <option value="">{t("Another language…")}</option>
        </select>
        <input
          className="input"
          style={{ maxWidth: 140 }}
          aria-label={t("Another language's tag")}
          placeholder="fr, pt-BR"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(other.trim()) && pick(other.trim())}
        />
        <input className="input" type="search" style={{ maxWidth: 260 }} aria-label={t("Find a word")} placeholder={t("Search…")} value={find} onChange={(e) => setFind(e.target.value)} />
        <span className="spacer" />
        <Button variant="primary" disabled={!pending.length || busy} loading={busy} onClick={() => void save()}>
          {pending.length ? t("Save {n} words", { n: pending.length }) : t("Save")}
        </Button>
      </div>
      {own.isLoading ? (
        <Spinner label={t("Loading…")} />
      ) : own.isError ? (
        <EmptyState title={t("The workspace's words could not be read")}>{errorMessage(own.error)}</EmptyState>
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
                <td dir="ltr">{w}</td>
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
