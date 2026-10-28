import { describe, expect, it } from "vitest";
import { accentTokens, contrastRatio, DEFAULT_APPEARANCE, normalizeAppearance } from "./theme";

const pair = (v: string) => v.match(/light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)/)!.slice(1) as [string, string];

describe("contrastRatio", () => {
  it("matches WCAG's reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("accentTokens", () => {
  it("keeps button text readable (4.5:1) for any accent, light and dark", () => {
    for (const accent of ["#2f5bea", "#ffeb3b", "#00ffff", "#111111", "#ff0000", "#0f766e", "#ffffff"]) {
      const [light, dark] = pair(accentTokens(accent)!["--primary"]);
      expect(contrastRatio(light, "#ffffff"), `${accent} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark, "#0b1020"), `${accent} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("leaves an already accessible colour as it is in light mode", () => {
    expect(pair(accentTokens("#2f5bea")!["--primary"])[0]).toBe("#2f5bea");
  });

  it("is null without a valid #rrggbb colour (Ferrum's own tokens apply)", () => {
    expect(accentTokens(null)).toBeNull();
    expect(accentTokens("red")).toBeNull();
    expect(accentTokens("#abc")).toBeNull();
  });
});

describe("normalizeAppearance", () => {
  it("keeps known values and drops the rest", () => {
    expect(normalizeAppearance({ theme: "dark", contrast: "loud", density: "compact", accent: "#ABCDEF", extra: 1 })).toEqual({
      theme: "dark",
      contrast: "system",
      density: "compact",
      accent: "#abcdef",
    });
    expect(normalizeAppearance("garbage")).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ accent: "url(javascript:alert(1))" }).accent).toBeNull();
  });
});
