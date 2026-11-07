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

describe("an app's own catalogs", () => {
  it("hold only words its pages ask for, each keeping its places", async () => {
    const { catalogIssues } = await import("./words.mjs");
    const dir = mkdtempSync(join(tmpdir(), "ferrum-catalog-"));
    mkdirSync(join(dir, "locales"));
    writeFileSync(join(dir, "Home.tsx"), `t("Save"); t("Organized by {by}", { by }); t("Close")`);
    writeFileSync(join(dir, "locales", "ar.json"), JSON.stringify({ Save: "حفظ", "Organized by {by}": "نظّمه {by}", Close: "" }));
    writeFileSync(join(dir, "locales", "hi.json"), JSON.stringify({ "Organized by {by}": "आयोजक", Gone: "गया" }));
    expect(catalogIssues(dir)).toEqual([
      'locales/ar.json: "Close" has no words',
      'locales/hi.json: "Organized by {by}" keeps other places than {by}',
      'locales/hi.json: "Gone" is not a word its pages ask for',
    ]);
  });
});
