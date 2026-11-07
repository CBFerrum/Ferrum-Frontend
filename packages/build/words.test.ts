import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { wordsOf } from "./words.mjs";

describe("an interface's own words", () => {
  it("are what its t() and tr() are given, each once, tests aside", () => {
    const dir = mkdtempSync(join(tmpdir(), "ferrum-words-"));
    mkdirSync(join(dir, "pages"));
    writeFileSync(join(dir, "Home.tsx"), `const a = t("Save"); const b = t( "Organized by {by}", { by }); toast(t("Saved \\"x\\""));\n`);
    writeFileSync(join(dir, "pages", "List.tsx"), `const c = tr("Save"); const d = format("Not this"); const e = it("nor this");\n`);
    writeFileSync(join(dir, "Home.test.tsx"), `t("A test's own")`);
    writeFileSync(join(dir, "notes.md"), `t("Not code")`);
    expect(wordsOf(dir)).toEqual(["Organized by {by}", "Save", 'Saved "x"']);
  });
});
