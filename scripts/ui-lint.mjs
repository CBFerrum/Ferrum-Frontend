// The interface lint (packages/build/uilint.mjs) over this repository's own src/, apps/ and
// packages/: `npm run lint:ui`, which fails on any finding.
import { fileURLToPath } from "node:url";
import { runLint } from "../packages/build/uilint.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.exit(runLint(root, { dirs: ["src", "apps", "packages"], label: "ui-lint:" }));
