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
        // react-query ships "use client" directives for React Server Components; meaningless in an SPA.
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
});
