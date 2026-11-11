// The interface lint (packages/build/uilint.mjs) over this repository's own src/, apps/ and
// packages/, against ui-lint-baseline.json: `npm run lint:ui` (add --update-baseline to lower it).
import { fileURLToPath } from "node:url";
import { runLint } from "../packages/build/uilint.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.exit(runLint(root, `${root}ui-lint-baseline.json`, { dirs: ["src", "apps", "packages"], update: process.argv.includes("--update-baseline"), label: "ui-lint:", command: "npm run lint:ui --" }));
