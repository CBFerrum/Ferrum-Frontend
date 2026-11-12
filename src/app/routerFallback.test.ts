// React Router warns on every page load ("No HydrateFallback element provided to render during initial hydration") when a route that
// loads lazily has no fallback to draw. Each router of the shell and Studio names one on its root route.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("the routers' hydrate fallback", () => {
  for (const file of ["apps/shell/src/main.tsx", "apps/studio/src/main.tsx"]) {
    it(`${file}: every root route has one`, () => {
      const src = readFileSync(join(__dirname, "..", "..", file), "utf8");
      const routers = src.match(/createBrowserRouter\(/g)?.length ?? 0;
      const roots = src.match(/\{ path: "(?:\/|\*)", HydrateFallback: Loading|path: "\/",\s+HydrateFallback: Loading/g)?.length ?? 0;
      expect(routers).toBeGreaterThan(0);
      expect(roots).toBe(routers);
    });
  }
});
