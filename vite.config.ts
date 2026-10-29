import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const backend = "http://127.0.0.1:5150";

// No React plugin: esbuild compiles TSX natively (edits reload the page instead of Fast Refresh).
export default defineConfig({
  base: "/app/",
  plugins: [tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  server: {
    proxy: {
      "/api": backend,
      "/files": backend,
      "/mcp": backend,
      "/ws": { target: backend, ws: true },
    },
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // react-query and the shadcn components ship "use client" directives for React Server Components; meaningless
        // in an SPA. Rollup cannot map a directive at 1:0 through esbuild's sourcemap and reports that too.
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        if (warning.code === "SOURCEMAP_ERROR" && warning.loc?.line === 1 && warning.loc.column === 0) return;
        warn(warning);
      },
    },
  },
});
