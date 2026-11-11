import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseCssProblem, missingBase } from "./basecss.mjs";

const built = (css: string) => {
  const dir = mkdtempSync(join(tmpdir(), "ferrum-base-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "index.css"), css);
  return dir;
};

describe("the kit's base stylesheet in a build", () => {
  it("passes a build that carries the base, minified or not", () => {
    expect(baseCssProblem(built(":root{--control-h:calc(36 / 14 * 1rem)}html{font-size:87.5%}.x{color:red}"))).toBeNull();
    expect(missingBase(":root {\n  --control-h: 2rem;\n}\nhtml {\n  font-size: 87.5%;\n}")).toEqual([]);
  });
  it("fails one that does not, naming the fix", () => {
    const p = baseCssProblem(built(".np-page{display:grid;gap:16px}.flex{display:flex}"))!;
    expect(p).toContain("--control-h");
    expect(p).toContain("87.5%");
    expect(p).toContain("@import");
    expect(p).toContain("index.css");
  });
  it("fails a build with no style sheet at all", () => {
    expect(baseCssProblem(mkdtempSync(join(tmpdir(), "ferrum-base-")))).not.toBeNull();
  });
});
