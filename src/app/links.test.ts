// Every address the shell and its pages link to is a route the shell, the records frame or the server serves. The first browser
// walk found the launcher's "Get apps" and a "not available" page linking to /apps, which nothing serves (the app manager is /store/).
// The addresses are read from the sources' literal `to`/`href`/`navigate` strings, so a new link to a page that does not exist fails here.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordsRoutes } from "./recordsRoutes";

const root = join(__dirname, "..", "..");

/** Pages the server serves itself or other interfaces own (their routes are checked in their own repositories). */
const ELSEWHERE = new Set(["login", "studio", "pos", "crm", "app", "open", "account", "admin"]);

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });

/** The route patterns the shell's pages declare (the shell's entry file), with the records frame's. */
const paths = (src: string) => [...src.matchAll(/path: "([^"]*)"/g)].map((m) => m[1]).filter((p) => p !== "*" && p !== "/");
const shell = readFileSync(join(root, "apps/shell/src/main.tsx"), "utf8");
const storeBlock = /\bstore: \[([\s\S]*?)\n  \],/.exec(shell)?.[1] ?? "";
/** The app manager's pages, relative to /store/. */
const storePages = ["", ...paths(storeBlock)];
/** The rest of the shell's pages and the records frame's, relative to where they are served. */
const patterns = (): string[] => ["", ...paths(shell.replace(storeBlock, "")), ...recordsRoutes.map((r) => r.path ?? "")];

const matches = (pattern: string, segs: string[]) => {
  const want = pattern.split("/").filter(Boolean);
  for (let i = 0; i < want.length; i++) {
    if (want[i] === "*") return true;
    if (want[i].endsWith("?") && i === segs.length) return true;
    if (i >= segs.length) return false;
    if (!want[i].startsWith(":") && want[i] !== segs[i]) return false;
  }
  return want.length === segs.length;
};

/** Whether an address is served: by the server or another interface, by the app manager's pages, or by a shell or frame route. */
export function served(address: string): boolean {
  const segs = address.split(/[?#]/)[0].split("/").filter(Boolean);
  const all = patterns();
  if (!segs.length || ELSEWHERE.has(segs[0])) return true;
  // /store/… and /data/… are the shell's own pages, whose routes are relative to them.
  if (segs[0] === "store") return storePages.some((p) => matches(p, segs.slice(1)));
  const rest = segs[0] === "data" ? segs.slice(1) : segs;
  return !rest.length || all.some((p) => matches(p, rest));
}

/** The literal addresses in a source (one built at run time, `/${…}`, is not a literal). The classic frame's mail, files, chat,
 *  calendar, meet and docs pages are the pre-bar single-page app's: no interface mounts that frame any more, and the apps own them. */
const CLASSIC_ONLY = new Set(["/mail", "/drive", "/chat", "/calendar", "/meet", "/docs"]);
const literals = (src: string): string[] =>
  [...src.matchAll(/(?:\bto|\bhref|navigate\()[=:]?\s*\{?\s*["'`](\/[^"'`\s]*)/g)]
    .map((m) => m[1])
    .filter((a) => !a.startsWith("/${") && !CLASSIC_ONLY.has(a))
    .map((a) => a.replace(/\$\{[^}]*\}?/g, "x").replace(/\$$/, ""));

describe("what the shell links to", () => {
  it("knows which addresses are served", () => {
    expect(served("/store/")).toBe(true);
    expect(served("/store/?tab=store")).toBe(true);
    expect(served("/store/apps/crm/settings")).toBe(true);
    expect(served("/e/Lead/new")).toBe(true);
    expect(served("/customize")).toBe(true);
    expect(served("/apps")).toBe(false);
    expect(served("/no/such/page")).toBe(false);
  });

  it("serves every address a page or the bar links to", () => {
    const bad: string[] = [];
    for (const f of [...files(join(root, "src")), ...files(join(root, "apps/shell/src"))]) {
      for (const a of new Set(literals(readFileSync(f, "utf8")))) if (!served(a)) bad.push(`${f.slice(root.length + 1)}: ${a}`);
    }
    expect(bad).toEqual([]);
  });
});
