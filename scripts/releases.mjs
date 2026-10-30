// Lists the built interfaces in dist-apps/ for the Ferrum server to fetch (FERRUM_UI_SOURCE):
// dist-apps/index.json = {v: 1, apps: {<app>: {digest, files: [paths]}}}. The digest is computed as
// the server computes it (crates/apps/src/ui.rs, digest_of), so the server skips what it has.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = new URL("../dist-apps/", import.meta.url).pathname;
const sha = (b) => createHash("sha256").update(b).digest("hex");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const apps = {};
for (const app of readdirSync(root)) {
  const dir = join(root, app);
  if (!statSync(dir).isDirectory()) continue;
  const files = walk(dir).map((p) => ({ path: relative(dir, p).split(sep).join("/"), hash: sha(readFileSync(p)) }));
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = createHash("sha256");
  h.update("ferrum-ui-v1\n");
  for (const f of files) h.update(`${f.path}\0${f.hash}\n`);
  apps[app] = { digest: h.digest("hex"), files: files.map((f) => f.path) };
}
writeFileSync(join(root, "index.json"), JSON.stringify({ v: 1, apps }, null, 2));
console.log(Object.entries(apps).map(([a, r]) => `${a} ${r.digest.slice(0, 12)} (${r.files.length} files)`).join("\n"));
