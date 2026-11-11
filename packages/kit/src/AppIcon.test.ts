// @vitest-environment node
// The app tile's one colour rule (APP_TILE) keeps the glyph at 3:1 against its tile, in light and dark,
// for the colours the suite's apps ship (from /api/shell) and the ones Home derives from a name.
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../../src/lib/theme";
import { APP_TILE } from "./AppIcon";
import { tileColour } from "../../../apps/shell/src/Home";

const APPS = "#475569 #0e7490 #a63089 #be185d #2563eb #0891b2 #7c3aed #16a34a #0f766e #2f5bea #ca8a04 #ea580c #dc2626 #a63e30 #30a67d #4f46e5 #b45309 #c026d3".split(" ");
const DERIVED = ["Customer cards", "Notes", "Deals", "Reports", "Zebra", "Quality", "Lab"].map((title) => tileColour({ color: null, title }));
const SURFACE = { light: "#ffffff", dark: "#191c22" };
const TEXT = { light: "#202329", dark: "#eceef2" };

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: number[], b: number[], pct: number) => a.map((x, i) => x * (pct / 100) + b[i] * (1 - pct / 100));
const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

describe("app tile colour rule", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`keeps the glyph at 3:1 on its tile in ${theme}`, () => {
      for (const c of [...APPS, ...DERIVED]) {
        const tile = mix(rgb(c), rgb(SURFACE[theme]), APP_TILE[theme]);
        const glyph = mix(rgb(c), rgb(TEXT[theme]), APP_TILE.glyph);
        expect(contrastRatio(hex(glyph), hex(tile)), `${c} in ${theme}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
