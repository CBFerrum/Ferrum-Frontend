// Accessibility checks of rendered screens (FERRUM-UX-005): axe-core over a screen's HTML in a DOM
// (jsdom). Layout is not computed there, so colour contrast, focus order and what depends on what is
// shown are a browser's to check; names, roles, ARIA, labels, duplicate ids and the like are here.

import axe from "axe-core";
import { JSDOM } from "jsdom";

/** What axe finds wrong with `html` drawn in a page of its own: one line per rule broken. */
export async function violations(html: string): Promise<string[]> {
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><title>Screen</title></head><body><main>${html}</main></body></html>`, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const win = dom.window as unknown as Window & { axe: typeof axe; eval: (code: string) => unknown };
  // axe runs inside the window it checks.
  win.eval(axe.source);
  const result = await win.axe.run(win.document, { rules: { "color-contrast": { enabled: false } }, resultTypes: ["violations"] });
  dom.window.close();
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.html.slice(0, 160)).slice(0, 3).join("; ")})`);
}
