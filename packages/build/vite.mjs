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

/** The configuration for the interface whose `vite.config.mjs` has this `import.meta.url`. */
export function ferrumApp(configUrl, { outDir = "dist" } = {}) {
  const root = fileURLToPath(new URL(".", configUrl));
  return defineConfig({
    root,
    base: "./",
    plugins: [tailwindcss(), resolveLikeTheKit(root)],
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
