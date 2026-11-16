import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { lintUi, runLint } from "./uilint.mjs";

function tree(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "ferrum-uilint-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}
const rules = (files: Record<string, string>, options = {}) => lintUi(tree(files), options).map((f) => `${f.rule} ${f.file}:${f.line}`);

describe("raw-color", () => {
  it("flags colour literals in classes, styles and css, not tokens, url refs or prose", () => {
    expect(
      rules({
        "A.tsx": `const a = <div className="bg-[#fff]" />;\nconst b = { color: "#ff0000" };\nconst c = { background: \`rgb(0 0 0 / 0.5)\` };\n`,
        "a.css": `.x { color: #abc; }\n.y { fill: url(#grad); }\n#panel { margin: 0; }\n.z { background: oklch(0.6 0.1 200); }\n`,
        "B.tsx": `const d = "see #123456 for the issue";\nconst e = <path fill="url(#a1b2c3)" />;\nconst f = "Use a color such as #2f5bea";\n`,
      }),
    ).toEqual(["raw-color A.tsx:1", "raw-color A.tsx:2", "raw-color A.tsx:3", "raw-color a.css:1", "raw-color a.css:4"]);
  });
  it("leaves the token file alone", () => {
    expect(rules({ "index.css": `:root {\n  --bg: #f5f6f8;\n  --surface: #fff;\n  --x: rgb(0 0 0 / 0.1);\n}\n` })).toEqual([]);
    expect(rules({ "other.css": `:root {\n  --bg: #f5f6f8;\n}\n` })).toEqual(["raw-color other.css:2"]);
  });
});

describe("text sizes", () => {
  it("small-text covers css, text-[Npx] and fontSize under 12px", () => {
    expect(
      rules({
        "a.css": `.a { font-size: 11px; }\n.b { font-size: 12px; }\n.c { font-size: 0.7rem; }\n.d { font-size: 0.86rem; }\n`,
        "A.tsx": `<i className="text-[11px]" />;\n<i className="text-[12px]" />;\n<i style={{ fontSize: 10 }} />;\n<i style={{ fontSize: 14 }} />;\n`,
      }),
    ).toEqual(["small-text A.tsx:1", "arbitrary-text-size A.tsx:2", "small-text A.tsx:3", "small-text a.css:1", "small-text a.css:3"]);
  });
  it("arbitrary-text-size is a length in text-[...], not a colour or variable", () => {
    expect(rules({ "A.tsx": `<i className="text-[0.9em] text-[var(--x)] text-[#fff] text-xs" />` })).toEqual(["raw-color A.tsx:1", "arbitrary-text-size A.tsx:1"]);
  });
});

describe("blank-fallback", () => {
  it("flags empty loading fallbacks, not a real one", () => {
    expect(
      rules({
        "A.tsx": `<Suspense fallback={null}>\n<Suspense fallback={<span />}>\n<Suspense fallback={<></>}>\n<Suspense fallback={<span></span>}>\n<Suspense fallback={<Skeleton />}>\n`,
      }),
    ).toEqual(["blank-fallback A.tsx:1", "blank-fallback A.tsx:2", "blank-fallback A.tsx:3", "blank-fallback A.tsx:4"]);
  });
});

describe("zoom-lock", () => {
  it("flags user-scalable=no and maximum-scale=1 in html and tsx, not maximum-scale=5", () => {
    expect(
      rules({
        "index.html": `<meta name="viewport" content="width=device-width, user-scalable=no" />\n<meta name="viewport" content="width=device-width, maximum-scale=1.0" />\n<meta name="viewport" content="maximum-scale=5" />\n`,
        "A.tsx": `const v = "initial-scale=1, maximum-scale=1";\n`,
      }),
    ).toEqual(["zoom-lock A.tsx:1", "zoom-lock index.html:1", "zoom-lock index.html:2"]);
  });
});

describe("forked-primitive", () => {
  const files = { "src/A.tsx": `import { Dialog } from "radix-ui";\nimport * as P from "@radix-ui/react-popover";\nimport { cva } from "class-variance-authority";\nimport { Button } from "@ferrum/kit";\n` };
  it("applies to an app's ui/ only", () => {
    expect(rules(files, { app: true })).toEqual(["forked-primitive src/A.tsx:1", "forked-primitive src/A.tsx:2", "forked-primitive src/A.tsx:3"]);
    expect(rules(files)).toEqual([]);
  });
});

describe("browser-zone", () => {
  const files = {
    "src/A.tsx": [
      "const a = new Date(at).toLocaleString();",
      'const b = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });',
      'const c = d.toLocaleTimeString([], { hour: "2-digit", timeZone: zone });',
      'const e = new Intl.DateTimeFormat(locale, { month: "short" }).format(d);',
      'const f = new Intl.DateTimeFormat("en-US", {',
      "  timeZone: shownTimeZone(),",
      "});",
      "const g = count.toLocaleString();",
      'const h = d.toLocaleString("en", { weekday: "long" });',
      "const i = Intl.DateTimeFormat().resolvedOptions().timeZone;",
    ].join("\n"),
  };
  it("flags a date written on the browser's clock in Ferrum-Frontend's sources, not a number or a named zone", () => {
    expect(rules(files)).toEqual(["browser-zone src/A.tsx:1", "browser-zone src/A.tsx:2", "browser-zone src/A.tsx:4", "browser-zone src/A.tsx:9"]);
  });
  it("leaves apps alone until their pages pass it", () => {
    expect(rules(files, { app: true })).toEqual([]);
  });
});

describe("allow comments", () => {
  it("suppress on the same or previous line when they give a reason", () => {
    expect(
      rules({
        "A.tsx": `// ui-lint-allow raw-color: a user's own caret colour is data\nconst a = { color: "#64748b" };\nconst b = { color: "#fff" }; // ui-lint-allow raw-color: canvas export\n\nconst c = { color: "#000" };\n`,
      }),
    ).toEqual(["raw-color A.tsx:5"]);
  });
  it("without a reason suppress nothing and are a finding", () => {
    expect(rules({ "A.tsx": `// ui-lint-allow raw-color\nconst a = { color: "#64748b" };\n/* ui-lint-allow raw-color: */\n` })).toEqual(["allow-reason A.tsx:1", "allow-reason A.tsx:3", "raw-color A.tsx:2"]);
  });
});

describe("what is skipped", () => {
  it("dist, node_modules, dotfiles, tests and generated files", () => {
    expect(
      rules({
        "dist/a.css": `a { color: #fff; }`,
        "node_modules/x/a.css": `a { color: #fff; }`,
        ".hidden/a.css": `a { color: #fff; }`,
        "A.test.tsx": `const a = { color: "#fff" };`,
        "gen.css": `/* @generated */\na { color: #fff; }`,
        "ok.css": `a { color: var(--text); }`,
      }),
    ).toEqual([]);
  });
});

describe("a run", () => {
  it("fails on any finding and passes without one", () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
    expect(runLint(tree({ "a.css": "a { color: #fff; }" }))).toBe(1);
    expect(runLint(tree({ "a.css": "a { color: var(--text); }" }))).toBe(0);
    for (const s of quiet) s.mockRestore();
  });
});
