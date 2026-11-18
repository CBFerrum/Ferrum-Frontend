// WCAG contrast between two colours, which the token tests check, and a brand accent nudged until it passes (accentTokens).

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The platform's page and surface colours a brand's accent must read on, light then dark (server/shell/theme.css). */
export const LIGHT_SURFACES = ["#ffffff", "#f6f7f9"] as const;
export const DARK_SURFACES = ["#111317", "#191c22"] as const;
/** Text on the accent: white in light mode, the dark page colour in dark mode (each passes by construction). */
export const ACCENT_TEXT = { light: "#ffffff", dark: "#111317" } as const;

/** `#rgb` or `#rrggbb` (any case) as `#rrggbb`; null for anything else. */
function hex6(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join("")}`;
  return null;
}

function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((c, i) => Math.round(Math.min(255, Math.max(0, c + (y[i]! - c) * t))).toString(16).padStart(2, "0")).join("")}`;
}

/** The first of `colour` moved toward `target` in 25 even steps that reads at 4.5:1 on every surface; `target` if none. */
function until(colour: string, target: string, surfaces: readonly string[]): string {
  for (let i = 0; i <= 25; i++) {
    const c = mix(colour, target, i / 25);
    if (surfaces.every((s) => contrastRatio(c, s) >= 4.5)) return c;
  }
  return target;
}

export interface AccentTokens {
  light: string;
  dark: string;
  hoverLight: string;
  hoverDark: string;
  softLight: string;
  softDark: string;
}

/** A brand's accent as public pages paint it: kept where it reads at 4.5:1 on the platform's surfaces, else darkened (light mode)
 *  or lightened (dark mode) step by step until it does. The kernel's `brand::tokens` (Ferrum crates/kernel/src/brand.rs) gives the
 *  same values, so a preview shows what the server will serve. Invalid input is read as the platform's own accent. */
export function accentTokens(primary: string | null | undefined, primaryDark?: string | null): AccentTokens {
  const p = hex6(primary) ?? "#3157d5";
  const light = until(p, "#000000", LIGHT_SURFACES);
  const dark = until(hex6(primaryDark) ?? p, "#ffffff", DARK_SURFACES);
  return { light, dark, hoverLight: mix(light, "#000000", 0.15), hoverDark: mix(dark, "#ffffff", 0.15), softLight: mix(light, "#ffffff", 0.88), softDark: mix(dark, DARK_SURFACES[1], 0.78) };
}
