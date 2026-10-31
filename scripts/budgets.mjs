// Checks every built interface in dist-apps/ against the size budgets (packages/build/budgets.mjs):
// run after `build:apps`; fails over budget.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { measure } from "../packages/build/budgets.mjs";

const root = new URL("../dist-apps/", import.meta.url).pathname;
let over = false;
for (const app of readdirSync(root).sort()) {
  const dir = join(root, app);
  if (!statSync(dir).isDirectory() || !existsSync(join(dir, "index.html"))) continue;
  const m = measure(dir, app);
  console.log(m.line);
  over ||= m.over;
}
if (over) {
  console.error("an interface is over its size budget (docs/plan/apps-ui.md §12.9): load its pages when opened");
  process.exit(1);
}
