// The design system's guard: a line-based check (no parser, no dependencies) for the few things
// that drift silently, over an interface's sources (.ts, .tsx, .css, .html).
//
// Rules: raw-color, small-text, arbitrary-text-size, blank-fallback, zoom-lock, forked-primitive
// (apps only), allow-reason. A finding is suppressed by `ui-lint-allow <rule>: <reason>` in a
// comment on the same or the previous line; an allow without a reason is a finding itself.
//
// A baseline (ui-lint-baseline.json: { rule: { file: count } }) is a ratchet: a file may not have
// more findings of a rule than its baseline says, and the baseline only goes down.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const HINTS = {
  "raw-color": "use a semantic token (docs/design/FOUNDATIONS.md)",
  "small-text": "text under 12px is not readable: use a type role (text-xs...text-2xl)",
  "arbitrary-text-size": "use a type role (text-xs...text-2xl)",
  "blank-fallback": "show a content-shaped loading state",
  "zoom-lock": "do not block browser zoom: remove user-scalable=no and maximum-scale=1",
  "forked-primitive": "compose from @ferrum/kit or @ferrum/kit/primitives; add a governed pattern to the kit instead of forking one",
  "allow-reason": "write why: ui-lint-allow <rule>: <reason>",
};

const EXT = /\.(tsx?|css|html)$/;
const SKIP_FILE = /\.(test|spec|gen|generated)\.|\.d\.ts$/;
const COLOR_CONTEXT = /color|colour|fill|stroke|background|border|shadow|outline|gradient|\bstop\b|\b(?:bg|text|from|via|to|ring|decoration|accent|caret|border|shadow|outline|fill|stroke)-\[/i;
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/gi;
const FUNC_COLOR = /\b(?:rgba?|hsla?|oklch)\(\s*[\d.]/g;

function walk(dir, root, out) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".") || name === "node_modules" || name === "dist" || name === "dist-apps") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, root, out);
    else if (EXT.test(name) && !SKIP_FILE.test(name)) out.push(relative(root, p).split(sep).join("/"));
  }
}

/** A token file defines the palette in a :root block. */
const isTokenFile = (text) => /:root\s*\{/.test(text) && /--bg\s*:/.test(text) && /--surface\s*:/.test(text);

// The kit's root is 14px (87.5%, docs/design/FOUNDATIONS.md), so 0.8rem renders 11.2px; em is taken against body text.
const px = (n, unit) => (unit === "rem" || unit === "em" ? n * 14 : n);

/** Findings for one file's text: [{ rule, line, text }], before allow comments. */
function scan(file, text, app) {
  const css = file.endsWith(".css");
  const html = file.endsWith(".html");
  const tokens = isTokenFile(text);
  const found = [];
  const add = (rule, i, raw) => !found.some((f) => f.rule === rule && f.line === i + 1) && found.push({ rule, line: i + 1, text: raw.trim().slice(0, 160) });
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (/^(\/\/|\/\*|\*|<!--)/.test(t)) return; // comment lines describe; they do not render
    if (!tokens) {
      for (const m of raw.matchAll(HEX)) {
        const pre = raw.slice(0, m.index);
        if (/url\(\s*["']?$/.test(pre)) continue;
        if (css || html) {
          if (css && pre.includes(":")) add("raw-color", i, raw);
          else if (html && /color|fill|stroke|background|style=/i.test(raw) && /["'(:\s]$/.test(pre)) add("raw-color", i, raw);
        } else if (/(?:["'`\[]|(?:solid|dashed|dotted|inset|\d(?:px|em|rem)|:|,)\s*)$/.test(pre) && (COLOR_CONTEXT.test(raw) || pre.endsWith("["))) add("raw-color", i, raw);
      }
      if (FUNC_COLOR.test(raw)) add("raw-color", i, raw);
      FUNC_COLOR.lastIndex = 0;
    }
    if (css) {
      for (const m of raw.matchAll(/\bfont-size\s*:\s*(\d*\.?\d+)(px|rem|em)\b/g)) if (Number(m[1]) > 0 && px(Number(m[1]), m[2]) < 12) add("small-text", i, raw);
    }
    for (const m of raw.matchAll(/\btext-\[(\d*\.?\d+)(px|rem|em|pt|vw|vh|%)\]/g)) {
      const n = Number(m[1]);
      if ((m[2] === "px" || m[2] === "rem" || m[2] === "em") && n > 0 && px(n, m[2]) < 12) add("small-text", i, raw);
      else add("arbitrary-text-size", i, raw);
    }
    for (const m of raw.matchAll(/\bfontSize\s*:\s*["'`]?(\d*\.?\d+)(px|rem|em)?["'`]?/g)) if (Number(m[1]) > 0 && px(Number(m[1]), m[2]) < 12) add("small-text", i, raw);
    if (/fallback=\{\s*(null|<span\s*\/>|<span>\s*<\/span>|<div\s*\/>|<>\s*<\/>)\s*\}/.test(raw)) add("blank-fallback", i, raw);
    if (!css && (html || file.endsWith(".tsx")) && /user-scalable\s*=\s*(no|0)\b|maximum-scale\s*=\s*1(\.0)?(?![\d.])/.test(raw)) add("zoom-lock", i, raw);
    if (app && !css && !html && /(?:\bfrom\s+|^\s*import\s+|\bimport\(\s*)["'](radix-ui|@radix-ui\/[^"']+|class-variance-authority)["']/.test(raw)) add("forked-primitive", i, raw);
  });
  return { found, lines };
}

/** Findings under `root` ({ rule, file, line, text, hint }), with allow comments applied.
 *  options.dirs: the directories to walk (default the whole root); options.files: exactly these
 *  files; options.app: root is an app's ui/ (adds forked-primitive). */
export function lintUi(root, options = {}) {
  const files = [];
  if (options.files) files.push(...options.files);
  else for (const d of options.dirs ?? ["."]) if (existsSync(join(root, d))) walk(join(root, d), root, files);
  const out = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    if (/@generated|auto-?generated|do not edit/i.test(text.split("\n").slice(0, 5).join("\n"))) continue;
    const { found, lines } = scan(file, text, !!options.app);
    const allowed = lines.map(() => new Set());
    lines.forEach((raw, i) => {
      for (const m of raw.matchAll(/ui-lint-allow\s+([\w-]+)\s*(?::\s*([^\n]*))?/g)) {
        const reason = (m[2] ?? "").replace(/(\*\/|-->|\})+\s*$/, "").trim();
        if (!reason) out.push({ rule: "allow-reason", file, line: i + 1, text: raw.trim().slice(0, 160), hint: HINTS["allow-reason"] });
        else {
          allowed[i].add(m[1]);
          if (i + 1 < lines.length) allowed[i + 1].add(m[1]);
        }
      }
    });
    for (const f of found) if (!allowed[f.line - 1].has(f.rule)) out.push({ rule: f.rule, file, line: f.line, text: f.text, hint: HINTS[f.rule] });
  }
  return out;
}

/** { rule: { file: count } } */
export function counts(findings) {
  const c = {};
  for (const f of findings) {
    c[f.rule] ??= {};
    c[f.rule][f.file] = (c[f.rule][f.file] ?? 0) + 1;
  }
  return c;
}

/** over: files with more findings of a rule than the baseline allows; improved: fewer. */
export function ratchet(findings, baseline) {
  const now = counts(findings);
  const over = [];
  const improved = [];
  for (const rule of new Set([...Object.keys(now), ...Object.keys(baseline)])) {
    for (const file of new Set([...Object.keys(now[rule] ?? {}), ...Object.keys(baseline[rule] ?? {})])) {
      const count = now[rule]?.[file] ?? 0;
      const allowed = baseline[rule]?.[file] ?? 0;
      if (count > allowed) over.push({ rule, file, count, allowed });
      else if (count < allowed) improved.push({ rule, file, count, allowed });
    }
  }
  return { over, improved };
}

const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k] && typeof o[k] === "object" ? sorted(o[k]) : o[k]]));
export const baselineText = (findings) => `${JSON.stringify(sorted(counts(findings)), null, 2)}\n`;

/** The shared command: lint `root`, then update, enforce or just report the baseline.
 *  Returns the process exit code. options: { dirs, app, update, label (message prefix), command (how the author runs it) }. */
export function runLint(root, baselinePath, options = {}) {
  const prefix = options.label ?? "ferrum-ui:";
  const findings = lintUi(root, options);
  const total = {};
  for (const f of findings) total[f.rule] = (total[f.rule] ?? 0) + 1;
  const summary = Object.keys(total).sort().map((r) => `${r} ${total[r]}`).join(", ") || "no findings";
  if (options.update) {
    writeFileSync(baselinePath, baselineText(findings));
    console.log(`${prefix} wrote ${baselinePath} (${summary})`);
    return 0;
  }
  if (!existsSync(baselinePath)) {
    console.log(`${prefix} interface lint: ${summary}. To adopt the ratchet (CI then fails on new findings): ${options.command ?? "lint"} --update-baseline`);
    return 0;
  }
  const { over, improved } = ratchet(findings, JSON.parse(readFileSync(baselinePath, "utf8")));
  if (over.length) {
    console.error(`${prefix} interface lint is over its baseline:`);
    for (const o of over) {
      console.error(`  ${o.file}: ${o.rule} ${o.count} (baseline ${o.allowed})`);
      for (const f of findings.filter((x) => x.rule === o.rule && x.file === o.file).slice(0, 8)) console.error(`    ${f.file}:${f.line}  ${f.text}\n      ${f.hint}`);
    }
    console.error(`${prefix} fix them, or explain one with a comment: ui-lint-allow <rule>: <reason>`);
    return 1;
  }
  console.log(`${prefix} interface lint within its baseline (${summary})`);
  if (improved.length) console.log(`${prefix} ${improved.length} file/rule counts dropped below the baseline: run ${options.command ?? "lint"} --update-baseline to lower it`);
  return 0;
}
