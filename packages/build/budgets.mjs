// The size budgets of a built interface (docs/plan/apps-ui.md §12.9): the JavaScript a page loads
// before it can start (its entry script and the modules preloaded with it) at most 200 KB
// compressed, its style sheets at most 50 KB. Pages split the rest into chunks loaded when opened.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

export const ENTRY_JS = 200 * 1024;
export const CSS = 50 * 1024;

/** The files `index.html` loads at once: [path, kind]; kind is "js" or "css". */
function startFiles(html) {
  const out = [];
  for (const tag of html.match(/<(script|link)\b[^>]*>/gi) ?? []) {
    const attr = (name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1];
    if (/^<script/i.test(tag) && attr("src")) out.push([attr("src"), "js"]);
    else if (attr("rel") === "modulepreload" && attr("href")) out.push([attr("href"), "js"]);
    else if (attr("rel") === "stylesheet" && attr("href")) out.push([attr("href"), "css"]);
  }
  return out;
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** Measures a built interface's directory (with its `index.html`): lines to print, and whether it
 *  is over a budget. Sizes are gzip's at its highest level (servers that send Brotli do better). */
export function measure(dir, name = dir) {
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const total = { js: 0, css: 0 };
  for (const [ref, kind] of startFiles(html)) {
    if (/^(https?:)?\/\//.test(ref)) continue;
    total[kind] += gzipSync(readFileSync(join(dir, ref.replace(/^\.?\//, ""))), { level: 9 }).length;
  }
  const over = total.js > ENTRY_JS || total.css > CSS;
  const line = `${name}: entry JavaScript ${kb(total.js)} of ${kb(ENTRY_JS)}, CSS ${kb(total.css)} of ${kb(CSS)}${over ? "  OVER BUDGET" : ""}`;
  return { line, over, total };
}
