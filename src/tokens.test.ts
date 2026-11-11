// @vitest-environment node
// Holds src/index.css (the single source of the colour tokens) to the contrast rules in docs/design/FOUNDATIONS.md.
// It resolves light-dark() and var() for light, dark and each with data-contrast="more", measures WCAG
// contrast for every pair, and prints the table (pasted into the doc) after the run.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./lib/theme";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

/** Declarations of each `:root…` block, by selector. */
function blocks(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const m of css.matchAll(/(:root(?:\[[^\]]+\])?)\s*\{([^{}]*)\}/g)) {
    const decls = (out[m[1]] ??= {});
    for (const d of m[2].replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
  }
  return out;
}

/** Splits on commas outside parentheses. */
function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

/** Replaces every light-dark(a, b) with the side for the theme. */
function pick(v: string, dark: boolean): string {
  for (;;) {
    const i = v.lastIndexOf("light-dark(");
    if (i < 0) return v;
    let depth = 0;
    let j = i + "light-dark".length;
    for (; j < v.length; j++) {
      if (v[j] === "(") depth++;
      if (v[j] === ")" && --depth === 0) break;
    }
    const [l, d] = splitTop(v.slice(i + "light-dark(".length, j));
    v = v.slice(0, i) + (dark ? d : l) + v.slice(j + 1);
  }
}

const THEMES = [
  { name: "light", dark: false, hc: false },
  { name: "dark", dark: true, hc: false },
  { name: "light, high contrast", dark: false, hc: true },
  { name: "dark, high contrast", dark: true, hc: true },
];

const b = blocks();
function tokens(dark: boolean, hc: boolean): Record<string, string> {
  const all = { ...b[":root"], ...(hc ? b[':root[data-contrast="more"]'] : {}) };
  const resolve = (name: string, depth = 0): string => {
    let v = pick(all[name] ?? "", dark);
    if (depth > 8) throw new Error(`${name}: alias loop`);
    v = v.replace(/var\((--[\w-]+)\)/g, (_, n) => resolve(n, depth + 1));
    return v;
  };
  return Object.fromEntries(Object.keys(all).map((k) => [k, resolve(k)]));
}

/** `rgb(r g b / a)` blended over `under`, as hex. */
function blend(c: string, under: string): string {
  const m = c.match(/rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)/);
  if (!m) return c;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const u = [1, 3, 5].map((i) => parseInt(under.slice(i, i + 2), 16));
  const hex = [Number(m[1]), Number(m[2]), Number(m[3])].map((x, i) => Math.round(x * a + u[i] * (1 - a)).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`;
}

/** The colour of the focus ring (the first colour in the box-shadow) over a surface. */
function ringOn(t: Record<string, string>, under: string): string {
  const color = t["--focus-ring"].match(/(rgb\([^)]*\)|#[0-9a-f]{6})/i)?.[1];
  if (!color) throw new Error(`--focus-ring has no colour: ${t["--focus-ring"]}`);
  return color.startsWith("#") ? color : blend(color, under);
}

type Rule = { fg: string; bg: string[]; min: number; themes?: "hc" };
const TEXT_BG = ["--bg", "--surface", "--surface-2"];
const STATUS = ["--success", "--warning", "--danger", "--purple"];
const RULES: Rule[] = [
  { fg: "--text", bg: [...TEXT_BG, "--surface-3"], min: 4.5 },
  { fg: "--muted-foreground", bg: TEXT_BG, min: 4.5 },
  { fg: "--faint", bg: TEXT_BG, min: 4.5 },
  { fg: "--primary", bg: ["--surface", "--bg", "--primary-soft"], min: 4.5 },
  { fg: "--primary-text", bg: ["--primary", "--primary-hover"], min: 4.5 },
  ...STATUS.map((s) => ({ fg: s, bg: [`${s}-soft`, "--surface"], min: 4.5 })),
  { fg: "--border-control", bg: ["--surface", "--bg", "--surface-2"], min: 3 },
  { fg: "ring", bg: ["--surface", "--bg"], min: 3 },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ fg: `--chart-${n}`, bg: ["--surface"], min: 3 })),
  { fg: "--text", bg: TEXT_BG, min: 7, themes: "hc" },
  { fg: "--border-strong", bg: ["--surface", "--bg"], min: 3, themes: "hc" },
];

const table: string[] = [];
describe("colour tokens (src/index.css)", () => {
  for (const th of THEMES) {
    it(`meet their contrast pairs: ${th.name}`, () => {
      const t = tokens(th.dark, th.hc);
      const failures: string[] = [];
      for (const r of RULES) {
        if (r.themes === "hc" && !th.hc) continue;
        for (const bg of r.bg) {
          const bgHex = t[bg];
          const fgHex = r.fg === "ring" ? ringOn(t, bgHex) : t[r.fg];
          const ratio = contrastRatio(fgHex, bgHex);
          table.push(`| ${th.name} | ${r.fg === "ring" ? "focus ring" : r.fg} on ${bg} | ${ratio.toFixed(2)} | ${r.min} |`);
          if (ratio < r.min) failures.push(`${r.fg} on ${bg} [${th.name}]: ${ratio.toFixed(2)} < ${r.min} (${fgHex} on ${bgHex})`);
        }
      }
      expect(failures, `contrast failures:\n${failures.join("\n")}`).toEqual([]);
    });
  }

  it("keeps the decorative borders out of the control rule and --input on the control border", () => {
    expect(b[":root"]["--input"]).toBe("var(--border-control)");
  });

  it("prints the ratio table", () => {
    // Per theme, the lowest ratio of each pair is what the doc quotes; the full table goes to the log.
    console.log(`| theme | pair | ratio | minimum |\n|---|---|---|---|\n${table.join("\n")}`);
  });
});

// Seen in a real browser on 11 Nov 2026: `html, body { font: 1rem/… }` reset the root to 16px, so every rem
// size was 14% too big. Only a browser shows computed sizes; this keeps the cause from coming back.
describe("the root's size", () => {
  const legacy = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  it("is 87.5% and no rule sets `font` or `font-size` on html after it", () => {
    const onHtml = [...legacy.matchAll(/(^|\})\s*([^{}]*\bhtml\b[^{}]*)\{([^}]*)\}/g)].filter((m) => /(^|,)\s*html\s*(,|$)/.test(m[2].trim()));
    const sizes = onHtml.flatMap((m) => [...m[3].matchAll(/(?:^|;)\s*(font|font-size)\s*:\s*([^;]+)/g)].map((d) => `${d[1]}: ${d[2].trim().replace(/\s*\/\*.*$/, "")}`));
    expect(sizes).toEqual(["font-size: 87.5%"]);
  });
});
