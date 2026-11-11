// An app's built style sheets must carry the kit's base (src/index.css: tokens, type roles, the 87.5% root): an app whose
// styles.css forgets `@import` of it ships unstyled (Developer Hub did). The markers are declarations only the base makes,
// written the way a minifier leaves them.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MARKERS = [
  ["--control-h", /--control-h\s*:/],
  ["the root font size (87.5%)", /font-size\s*:\s*87\.5%/],
];

/** What the base lacks in this CSS text: the names of the markers not found. */
export function missingBase(css) {
  return MARKERS.filter(([, re]) => !re.test(css)).map(([name]) => name);
}

function cssFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) cssFiles(p, out);
    else if (e.name.endsWith(".css")) out.push(p);
  }
  return out;
}

/** A message for a built interface's directory that lacks the kit's base, or null when it has it. */
export function baseCssProblem(dist) {
  const css = cssFiles(dist).map((f) => readFileSync(f, "utf8")).join("\n");
  const missing = missingBase(css);
  if (!missing.length) return null;
  return `the built CSS lacks the kit's base stylesheet (missing: ${missing.join(", ")}): the page would ship unstyled. Put @import "../../../ferrum/web/src/index.css"; at the top of the app's styles.css (the path to Ferrum-Frontend's src/index.css) and build again`;
}
