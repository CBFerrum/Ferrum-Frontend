#!/usr/bin/env node
// An app's own interface (ui/ in its repository), with this checkout of Ferrum-Frontend:
//
//   node ../../ferrum/web/packages/build/cli.mjs <command>      (run in the app's ui/, whose
//                                                               vite.config.mjs uses ./vite.mjs)
//
//   build      vite build into dist/, then dist/.source: a digest of the sources it was built from
//   check      fails unless dist/ was built from the sources as they are now (run in CI): the
//              app's crate carries dist/, so a source change without a build would ship stale files;
//              and unless it keeps the size budgets (budgets.mjs: entry JavaScript ≤ 200 KB
//              compressed, CSS ≤ 50 KB)
//   typecheck  TypeScript over src/, with this checkout's packages and libraries
//   test       the interface's tests (vitest), as Ferrum-Frontend runs its own

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { measure } from "./budgets.mjs";

const web = fileURLToPath(new URL("../../", import.meta.url));
const ui = process.cwd();
const fail = (message) => {
  console.error(`ferrum-ui: ${message}`);
  process.exit(1);
};

if (!existsSync(join(ui, "vite.config.mjs")) || !existsSync(join(ui, "index.html"))) fail(`${ui} is not an app's ui/ directory (no vite.config.mjs and index.html)`);

/** The app's Vite configuration, loaded by Node itself, so the libraries it names resolve from
 *  this checkout rather than from the app's directory. */
async function appConfig() {
  return (await import(pathToFileURL(join(ui, "vite.config.mjs")).href)).default;
}

const tool = (path) => import(pathToFileURL(join(web, "node_modules", path)).href);

/** Every file the interface is built from: ui/ but dist/, node_modules/ and dotfiles. */
function sources(dir = ui, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".") || ((name === "dist" || name === "node_modules") && dir === ui)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else out.push(p);
  }
  return out;
}

function sourceDigest() {
  const h = createHash("sha256");
  h.update("ferrum-ui-sources-v1\n");
  for (const p of sources()) h.update(`${relative(ui, p).split(sep).join("/")}\0${createHash("sha256").update(readFileSync(p)).digest("hex")}\n`);
  return h.digest("hex");
}

function run(bin, args) {
  const r = spawnSync(process.execPath, [join(web, "node_modules", bin), ...args], { cwd: ui, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const webCommit = () => {
  const r = spawnSync("git", ["-C", web, "rev-parse", "HEAD"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

switch (process.argv[2]) {
  case "build": {
    const { build } = await tool("vite/dist/node/index.js");
    await build({ ...(await appConfig()), configFile: false });
    const stamp = { sources: sourceDigest(), frontend: webCommit() };
    writeFileSync(join(ui, "dist", ".source"), `${JSON.stringify(stamp, null, 2)}\n`);
    console.log(`ferrum-ui: dist/ built from sources ${stamp.sources.slice(0, 12)}`);
    break;
  }
  case "check": {
    const file = join(ui, "dist", ".source");
    if (!existsSync(join(ui, "dist", "index.html")) || !existsSync(file)) fail("dist/ is missing: run the build in ui/ and commit dist/");
    let stamp;
    try {
      stamp = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      fail("dist/.source cannot be read: run the build in ui/");
    }
    const now = sourceDigest();
    if (stamp.sources !== now) fail(`dist/ was built from other sources (${String(stamp.sources).slice(0, 12)}, now ${now.slice(0, 12)}): run the build in ui/ and commit dist/`);
    console.log(`ferrum-ui: dist/ matches its sources (${now.slice(0, 12)})`);
    const size = measure(join(ui, "dist"), "ferrum-ui: dist/");
    console.log(size.line);
    if (size.over) fail("over the size budget (docs/plan/apps-ui.md §12.9): load pages when they are opened (lazy routes)");
    break;
  }
  case "typecheck":
    run("typescript/bin/tsc", ["--noEmit", "-p", "tsconfig.json"]);
    break;
  case "test": {
    const { startVitest } = await tool("vitest/dist/node.js");
    const vitest = await startVitest("test", process.argv.slice(3), { config: false, run: true, watch: false, root: ui, passWithNoTests: true }, await appConfig());
    await vitest?.close();
    if (!vitest || vitest.state.getCountOfFailedTests() > 0 || process.exitCode) process.exit(1);
    break;
  }
  default:
    fail("commands: build, check, typecheck, test");
}
