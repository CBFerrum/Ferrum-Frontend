// Documents edited together live (Drive's `.fdoc` files; Ferrum docs/plan/collaboration.md, C3):
// what the Drive, Docs and editor pages share without loading the editor.

/** Drive's type for them. */
export const LIVE_DOC_TYPE = "application/vnd.ferrum.doc";

export const isLiveDoc = (name: string) => /\.fdoc$/i.test(name);

/** The name people see: without `.fdoc`. */
export function docTitle(name: string): string {
  return name.replace(/\.fdoc$/i, "");
}

/** A search snippet's parts: the words found are between « and » (Drive's search). */
export function snippetParts(snippet: string): { text: string; hit: boolean }[] {
  return snippet
    .split(/(«[^»]*»)/g)
    .filter(Boolean)
    .map((p) => (p.startsWith("«") && p.endsWith("»") ? { text: p.slice(1, -1), hit: true } : { text: p, hit: false }));
}
