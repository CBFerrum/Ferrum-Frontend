// The words an app's own interface asks for, as the kit's t() is given them (`t("…")`, or `tr("…")`
// where a file has a t of its own): written to dist/words.json by the build, so a workspace's
// administrators can put them in their language (Admin, Interface words).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CALL = /\b(?:t|tr)\(\s*"((?:[^"\\\n]|\\.)*)"/g;

/** The words in `dir`'s TypeScript sources (tests aside), each once, sorted. */
export function wordsOf(dir) {
  const out = new Set();
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        for (const m of readFileSync(p, "utf8").matchAll(CALL)) out.add(JSON.parse(`"${m[1]}"`));
      }
    }
  };
  walk(dir);
  return [...out].sort();
}
