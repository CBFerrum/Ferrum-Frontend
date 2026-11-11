// Vite's configuration for an app's own interface: ui/ in the app's repository (docs/plan/apps-ui.md
// §10.5), built with this checkout of Ferrum-Frontend until @ferrum/* are on npm. The app's code
// imports @ferrum/* and libraries by name; every library resolves as if Ferrum-Frontend imported it,
// so the app and the kit share one React, one query client and one router. The output follows the
// rules for interface releases: a relative base, module scripts only, names with hashes.
//
//   // ui/vite.config.mjs (plain JavaScript: cli.mjs loads it with Node itself)
//   import { ferrumApp } from "../../ferrum/web/packages/build/vite.mjs";
//   export default ferrumApp(import.meta.url);

import tailwindcss from "@tailwindcss/vite";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** This checkout of Ferrum-Frontend (ends with a separator). */
export const web = fileURLToPath(new URL("../../", import.meta.url));

/** Ferrum-Frontend's modules that act as they load: the page's bootstrap and words, its appearance,
 *  its offline worker and the shell's guard on leaving. Every other module of it only declares, so a
 *  build leaves out one nothing is imported from: an app that takes one primitive from a barrel
 *  (@ferrum/kit/primitives, @ferrum/records) does not carry the rest. vite.test.ts keeps the list in step. */
export const ACTS_ON_LOAD = ["packages/client/src/index.ts", "src/app/Shell.tsx", "src/lib/pwa.ts", "src/lib/theme.ts"];

/** Whether a module is kept when nothing is imported from it: the app's own and the libraries' (as
 *  their package.json says), style sheets, and those of Ferrum-Frontend's that act as they load. */
export function sideEffects(id) {
  return !id.startsWith(web) || id.includes("/node_modules/") || /\.css($|\?)/.test(id) || ACTS_ON_LOAD.some((p) => id === web + p);
}

/** Library imports of the app's files resolve from Ferrum-Frontend; `@/…` is Ferrum-Frontend's own. */
function resolveLikeTheKit(root) {
  // As if a file at Ferrum-Frontend's root imported them (only its directory counts).
  const fromWeb = join(web, "package.json");
  return {
    name: "ferrum:resolve",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith("\0") || source.startsWith("virtual:")) return null;
      if (source.startsWith("@/")) {
        if (!importer.startsWith(web)) {
          this.error(`${relative(root, importer)} imports ${source}: an app imports the @ferrum/* packages, never Ferrum-Frontend's own modules`);
        }
        return this.resolve(join(web, "src", source.slice(2)), importer, { ...options, skipSelf: true });
      }
      if (source.startsWith(".") || source.startsWith("/") || /^[a-z]+:/i.test(source)) return null;
      if (importer.startsWith(root) && !importer.includes("/node_modules/")) return this.resolve(source, fromWeb, { ...options, skipSelf: true });
      return null;
    },
  };
}

/** The left menu's icons are one lazy chunk (packages/kit/src/NavIconTable.tsx). Every page draws a sidebar, so the page's HTML asks
 *  for that chunk and what it imports at once, as modulepreload links, and the entry script no longer has to find it first.
 *  The links say `data-budget="lazy"`: they do not hold the page back, so budgets.mjs does not count them as the entry. */
export function preloadNavIcons() {
  return {
    name: "ferrum:preload-navicons",
    transformIndexHtml: {
      order: "post",
      handler(_html, { bundle }) {
        const chunks = Object.values(bundle ?? {});
        const table = chunks.find((c) => c.type === "chunk" && c.facadeModuleId?.replace(/\?.*$/, "").endsWith("/NavIconTable.tsx"));
        if (!table) return undefined;
        const entry = new Set(chunks.filter((c) => c.type === "chunk" && c.isEntry).flatMap((c) => [c.fileName, ...c.imports]));
        const files = [table.fileName, ...table.imports.filter((f) => !entry.has(f))];
        return files.map((f) => ({ tag: "link", attrs: { rel: "modulepreload", crossorigin: "", href: `./${f}`, "data-budget": "lazy" }, injectTo: "head" }));
      },
    },
  };
}

/** The configuration for the interface whose `vite.config.mjs` has this `import.meta.url`. */
export function ferrumApp(configUrl, { outDir = "dist" } = {}) {
  const root = fileURLToPath(new URL(".", configUrl));
  return defineConfig({
    root,
    base: "./",
    plugins: [tailwindcss(), resolveLikeTheKit(root), preloadNavIcons()],
    resolve: { alias: [{ find: /^@ferrum\/(.*)$/, replacement: `${web}packages/$1/src/index.ts` }] },
    esbuild: { jsx: "automatic" },
    server: { fs: { allow: [root, web] } },
    build: {
      target: "es2022",
      outDir,
      emptyOutDir: true,
      // A release names its files by digest; inline assets would only grow the entry chunk.
      assetsInlineLimit: 0,
      rollupOptions: {
        treeshake: { moduleSideEffects: sideEffects },
        onwarn(warning, warn) {
          // react-query and the shadcn components carry "use client" for React Server Components.
          if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
          if (warning.code === "SOURCEMAP_ERROR" && warning.loc?.line === 1 && warning.loc.column === 0) return;
          warn(warning);
        },
      },
    },
    test: { root, include: ["src/**/*.test.{ts,tsx}"] },
  });
}
