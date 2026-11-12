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
  // A test that draws screens and runs axe over them takes one to three seconds alone and five to ten when the machine is building
  // something else (measured 12 Nov 2026 at a load average near 100): the 5-second default failed whichever of them was slowest
  // that run. The longest ones still say their own 30 seconds.
  test: { testTimeout: 20_000 },
});
