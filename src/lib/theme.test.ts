import { describe, expect, it } from "vitest";
import { accentTokens, contrastRatio } from "./theme";

describe("contrastRatio", () => {
  it("matches WCAG's reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

// The kernel's vectors (Ferrum crates/kernel/src/brand.rs `VECTORS`): colour, dark-mode colour, then light, dark, hover light,
// hover dark, soft light, soft dark. A public page the server styles and a preview the kit draws show the same colours.
const VECTORS: [string, string | null, string[]][] = [
  ["#3157d5", null, ["#3157d5", "#627fdf", "#2a4ab5", "#7a92e4", "#e6ebfa", "#29324c"]],
  ["#ffff00", null, ["#707000", "#ffff00", "#5f5f00", "#ffff26", "#eeeee0", "#4c4e1b"]],
  ["#777777", null, ["#6d6d6d", "#878787", "#5d5d5d", "#999999", "#ededed", "#313438"]],
  ["#000000", null, ["#000000", "#858585", "#000000", "#979797", "#e0e0e0", "#313338"]],
  ["#e11d48", "#9f1239", ["#d81c45", "#c26780", "#b8183b", "#cb7e93", "#fae4e9", "#3e2d37"]],
];

describe("accentTokens", () => {
  it("accentTokens_vectors_match_kernel", () => {
    for (const [c, d, [light, dark, hoverLight, hoverDark, softLight, softDark]] of VECTORS)
      expect(accentTokens(c, d), `${c} ${d}`).toEqual({ light, dark, hoverLight, hoverDark, softLight, softDark });
  });
  it("reads short, capital and invalid colours as the kernel does", () => {
    expect(accentTokens("#3157D5").light).toBe("#3157d5");
    expect(accentTokens("#000")).toEqual(accentTokens("#000000"));
    expect(accentTokens("not a colour")).toEqual(accentTokens("#3157d5"));
    expect(accentTokens("#000000", "#9cb3ff").dark).toBe("#9cb3ff");
  });
});
