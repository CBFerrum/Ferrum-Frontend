import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The erp interface (docs/plan/apps-ui.md): an interface release the server serves with the shell
// put in. Built with a relative base; the server names the files by their digest.
const web = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [tailwindcss()],
  resolve: {
    alias: [
      { find: /^@ferrum\/(.*)$/, replacement: `${web}packages/$1/src/index.ts` },
      { find: "@", replacement: `${web}src` },
    ],
  },
  esbuild: { jsx: "automatic" },
  build: {
    target: "es2022",
    outDir: `${web}dist-apps/erp`,
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        if (warning.code === "SOURCEMAP_ERROR" && warning.loc?.line === 1 && warning.loc.column === 0) return;
        warn(warning);
      },
    },
  },
});
