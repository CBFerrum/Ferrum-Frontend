import { defineConfig } from "vite";

const backend = "http://127.0.0.1:5150";

// No React plugin: esbuild compiles TSX natively (full reload instead of Fast Refresh keeps node_modules lean).
export default defineConfig({
  base: "/app/",
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
