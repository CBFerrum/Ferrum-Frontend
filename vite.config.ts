import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The tests' configuration (vitest); the interfaces build with apps/*/vite.config.ts. No React
// plugin: esbuild compiles TSX natively.
export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: [
      { find: /^@ferrum\/(.*)$/, replacement: `${fileURLToPath(new URL("./packages", import.meta.url))}/$1/src/index.ts` },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  esbuild: { jsx: "automatic" },
});
