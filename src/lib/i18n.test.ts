import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import ar from "../locales/ar";
import hi from "../locales/hi";
import { formatDate, formatDecimal } from "./format";
import { addCatalog, applyLocale, arrowStep, baseLanguage, currentLanguage, direction, setLanguage, t } from "./i18n";

afterEach(() => applyLocale(null, undefined));

describe("the interface's language", () => {
  it("looks words up by their English, and keeps English where a catalog has nothing", () => {
    setLanguage("hi-IN");
    expect([t("Save"), t("Try again"), t("Nothing like this in any catalog")]).toEqual(["सहेजें", "फिर से कोशिश करें", "Nothing like this in any catalog"]);
    setLanguage("fr");
    expect(t("Save")).toBe("Save");
  });

  it("fills in names", () => {
    setLanguage("en");
    expect(t("{n} of {total}", { n: 3, total: 12 })).toBe("3 of 12");
    expect(t("{missing} stays", {})).toBe("{missing} stays");
  });

  it("takes an app's own words over the interface's", () => {
    setLanguage("ar");
    addCatalog("ar", { Course: "دورة", Save: "احفظ" });
    expect([t("Course"), t("Save"), t("Cancel")]).toEqual(["دورة", "احفظ", "إلغاء"]);
  });

  it("knows which scripts read right to left", () => {
    expect(["ar", "he-IL", "fa", "ur-PK", "en", "hi", "zh-Hant"].map(direction)).toEqual(["rtl", "rtl", "rtl", "rtl", "ltr", "ltr", "ltr"]);
    expect(baseLanguage(" PT_br ")).toBe("pt");
  });

  it("sets the document's language and direction, and formats in a chosen locale only", () => {
    const doc = { documentElement: { lang: "", dir: "" } } as unknown as Document;
    applyLocale({ language: "ar", dir: "rtl" }, doc);
    expect([doc.documentElement.lang, doc.documentElement.dir, currentLanguage()]).toEqual(["ar", "rtl", "ar"]);
    expect(formatDecimal("1234567.5", 2, "en-US")).toBe("1,234,567.50");
    applyLocale({ language: "hi-IN", chosen: true }, doc);
    expect(doc.documentElement.dir).toBe("ltr");
    expect(formatDecimal("1234567.5", 2)).toBe(new Intl.NumberFormat("hi-IN", { minimumFractionDigits: 2 }).format(1234567.5));
    expect(formatDate("2026-11-04")).toBe(new Intl.DateTimeFormat("hi-IN", { dateStyle: "medium" }).format(new Date(2026, 10, 4)));
    applyLocale({ language: "en" }, doc);
    // Nobody chose: the browser's.
    expect(formatDecimal("1234567.5", 2)).toBe(new Intl.NumberFormat(undefined, { minimumFractionDigits: 2 }).format(1234567.5));
  });
});

describe("an arrow key along the line", () => {
  it("steps on with Right left to right and with Left right to left", () => {
    vi.stubGlobal("getComputedStyle", (el: { dir: string }) => ({ direction: el.dir }));
    const step = (key: string, dir: string) => arrowStep({ key, currentTarget: { dir } as unknown as Element });
    expect([step("ArrowRight", "ltr"), step("ArrowLeft", "ltr")]).toEqual([1, -1]);
    expect([step("ArrowRight", "rtl"), step("ArrowLeft", "rtl")]).toEqual([-1, 1]);
    expect(step("ArrowUp", "rtl")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("the catalogs", () => {
  // Every word the interface asks for by name is in each catalog, so a page in Arabic or Hindi
  // has no English left among the words that are meant to be translated.
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.name === "node_modules" || d.name === "dist" ? [] : d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) && !/\.test\./.test(d.name) ? [join(dir, d.name)] : [],
    );
  const asked = new Set(["src", "apps", "packages"].flatMap(files).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\bt\("((?:[^"\\]|\\.)+)"/g)].map((m) => m[1])));

  it("have every word the interface asks for", () => {
    expect(asked.size).toBeGreaterThan(40);
    for (const [name, words] of [["ar", ar], ["hi", hi]] as const) expect([...asked].filter((w) => !(w in words)), name).toEqual([]);
  });
});
