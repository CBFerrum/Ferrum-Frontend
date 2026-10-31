import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { measure } from "./budgets.mjs";

/** A built interface: index.html and its assets (random bytes do not compress). */
function dist(sizes: Record<string, number>, html: string) {
  const dir = mkdtempSync(join(tmpdir(), "ferrum-budget-"));
  mkdirSync(join(dir, "assets"));
  for (const [name, size] of Object.entries(sizes)) writeFileSync(join(dir, "assets", name), randomBytes(size));
  writeFileSync(join(dir, "index.html"), html);
  return dir;
}

describe("size budgets", () => {
  it("counts the entry script, the modules preloaded with it and the style sheets", () => {
    const dir = dist(
      { "index.js": 60_000, "vendor.js": 60_000, "page.js": 500_000, "index.css": 10_000 },
      `<script type="module" crossorigin src="./assets/index.js"></script><link rel="modulepreload" crossorigin href="./assets/vendor.js"><link rel="stylesheet" crossorigin href="./assets/index.css">`,
    );
    const m = measure(dir, "app");
    expect(m.over).toBe(false);
    expect(m.total.js).toBeGreaterThan(120_000);
    expect(m.total.js).toBeLessThan(130_000);
    expect(m.total.css).toBeGreaterThan(10_000);
  });

  it("fails an interface whose first script is too big", () => {
    const dir = dist({ "index.js": 210 * 1024 }, `<script type="module" src="/assets/index.js"></script>`);
    const m = measure(dir, "app");
    expect(m.over).toBe(true);
    expect(m.line).toMatch(/OVER BUDGET/);
  });

  it("fails style sheets over theirs", () => {
    const dir = dist({ "index.js": 1000, "index.css": 51 * 1024 }, `<link href="./assets/index.css" rel="stylesheet"><script src="./assets/index.js" type="module"></script>`);
    expect(measure(dir, "app").over).toBe(true);
  });
});
