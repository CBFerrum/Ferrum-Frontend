import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTS_ON_LOAD, sideEffects, web } from "./vite.mjs";

/** Ferrum-Frontend's modules (tests aside) with a statement at their top level that does something. */
function acting(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "test") walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.(test|d)\.tsx?$/.test(e.name) && e.name !== "setupTests.ts") {
        if (/^(if \(|for \(|try \{|void |await |[A-Za-z_$][\w$.]*\(|(window|document|globalThis|self)\.)/m.test(readFileSync(p, "utf8"))) out.push(relative(web, p));
      }
    }
  };
  walk(join(web, "src"));
  walk(join(web, "packages"));
  return out.sort();
}

describe("modules an app's build keeps", () => {
  it("names every module of Ferrum-Frontend that acts as it loads", () => {
    expect(acting()).toEqual([...ACTS_ON_LOAD].sort());
  });

  it("keeps the app's own, the libraries', style sheets and those that act; leaves out the rest", () => {
    expect(sideEffects("/home/a/ferrum-app-x/ui/src/main.tsx")).toBe(true);
    expect(sideEffects(`${web}node_modules/vaul/dist/index.mjs`)).toBe(true);
    expect(sideEffects(`${web}src/index.css`)).toBe(true);
    expect(sideEffects(`${web}src/lib/theme.ts`)).toBe(true);
    expect(sideEffects(`${web}src/components/ui/drawer.tsx`)).toBe(false);
    expect(sideEffects(`${web}packages/kit/primitives/src/index.ts`)).toBe(false);
  });
});
