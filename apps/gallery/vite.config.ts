import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The design gallery (docs/design/PATTERNS.md): a development-only catalogue of the kit's tokens,
// primitives and patterns. Not part of build:apps; `npm run gallery` serves it on port 5199.
const web = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tailwindcss()],
  resolve: {
    alias: [
      { find: /^@ferrum\/(.*)$/, replacement: `${web}packages/$1/src/index.ts` },
      { find: "@", replacement: `${web}src` },
    ],
  },
  esbuild: { jsx: "automatic" },
  server: { fs: { allow: [web] } },
});
