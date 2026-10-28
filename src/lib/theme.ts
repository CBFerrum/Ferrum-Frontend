// Appearance: theme (light, dark or the system's), contrast (normal, more or the system's), density
// (comfortable or compact) and an optional accent colour. Applied to <html> as data-theme,
// data-contrast and data-density (index.css reads them) plus inline --primary* tokens for the accent;
// remembered on this device, and across devices once the account's preference loads (Shell).

import { useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ContrastMode = "normal" | "more" | "system";
export type Density = "comfortable" | "compact";

export interface Appearance {
  theme: ThemeMode;
  contrast: ContrastMode;
  density: Density;
  /** `#rrggbb`, or null for Ferrum's blue. */
  accent: string | null;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "system", contrast: "system", density: "comfortable", accent: null };

const KEY = "ferrum.appearance";
const listeners = new Set<() => void>();
const prefersDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
const prefersMore = typeof matchMedia === "function" ? matchMedia("(prefers-contrast: more)") : null;

/** Keeps known values only, so a stored or synced value from another version can't break the page. */
export function normalizeAppearance(v: unknown): Appearance {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const pick = <T extends string>(x: unknown, ok: readonly T[], d: T): T => (ok.includes(x as T) ? (x as T) : d);
  return {
    theme: pick(o.theme, ["light", "dark", "system"], DEFAULT_APPEARANCE.theme),
    contrast: pick(o.contrast, ["normal", "more", "system"], DEFAULT_APPEARANCE.contrast),
    density: pick(o.density, ["comfortable", "compact"], DEFAULT_APPEARANCE.density),
    accent: typeof o.accent === "string" && /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent.toLowerCase() : null,
  };
}

function load(): Appearance {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

let current = load();

export function getAppearance(): Appearance {
  return current;
}

/** Changes the appearance on this device (callers sync it to the account's preference). */
export function setAppearance(next: Partial<Appearance>): void {
  current = normalizeAppearance({ ...current, ...next });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage unavailable (private mode): this page still uses it
  }
  applyAppearance();
}

function applyAppearance(): void {
  const root = document.documentElement;
  root.dataset.theme = current.theme === "system" ? (prefersDark?.matches ? "dark" : "light") : current.theme;
  root.dataset.contrast = (current.contrast === "system" ? prefersMore?.matches : current.contrast === "more") ? "more" : "normal";
  root.dataset.density = current.density;
  const tokens = accentTokens(current.accent);
  for (const name of ACCENT_TOKENS) {
    if (tokens) root.style.setProperty(name, tokens[name]);
    else root.style.removeProperty(name);
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance);
}

/** The theme in effect ("system" resolved). */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
}

// ── accent colour → tokens ──

const ACCENT_TOKENS = ["--primary", "--primary-hover", "--primary-soft", "--primary-text", "--focus-ring", "--chart-1"] as const;
type AccentTokens = Record<(typeof ACCENT_TOKENS)[number], string>;

const LIGHT_SURFACE = "#ffffff";
const DARK_SURFACE = "#161a21";
const DARK_TEXT = "#0b1020";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
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

/** Mixes `hex` towards `target` by `amount` (0 to 1). */
function mix(hex: string, target: string, amount: number): string {
  const a = rgb(hex);
  const b = rgb(target);
  return toHex(a.map((c, i) => c + (b[i] - c) * amount));
}

/** Moves `hex` towards `target` in small steps until `ok` holds (or `target` is reached). */
function adjust(hex: string, target: string, ok: (c: string) => boolean): string {
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const c = mix(hex, target, t);
    if (ok(c)) return c;
  }
  return target;
}

/**
 * Tokens for an accent colour. The light-mode primary carries white text and the dark-mode primary
 * dark text, both at 4.5:1 or better (WCAG AA), so any picked colour stays readable on buttons.
 */
export function accentTokens(accent: string | null): AccentTokens | null {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return null;
  const light = adjust(accent, "#000000", (c) => contrastRatio(c, "#ffffff") >= 4.5);
  const dark = adjust(accent, "#ffffff", (c) => contrastRatio(c, DARK_TEXT) >= 4.5 && contrastRatio(c, DARK_SURFACE) >= 3);
  const [lr, lg, lb] = rgb(light);
  const [dr, dg, db] = rgb(dark);
  return {
    "--primary": `light-dark(${light}, ${dark})`,
    "--primary-hover": `light-dark(${mix(light, "#000000", 0.15)}, ${mix(dark, "#ffffff", 0.15)})`,
    "--primary-soft": `light-dark(${mix(light, LIGHT_SURFACE, 0.88)}, ${mix(dark, DARK_SURFACE, 0.78)})`,
    "--primary-text": `light-dark(#ffffff, ${DARK_TEXT})`,
    "--focus-ring": `0 0 0 3px light-dark(rgb(${lr} ${lg} ${lb} / 0.35), rgb(${dr} ${dg} ${db} / 0.45))`,
    "--chart-1": `light-dark(${light}, ${dark})`,
  };
}

// The OS switching light/dark or contrast while the page is open.
prefersDark?.addEventListener("change", () => current.theme === "system" && applyAppearance());
prefersMore?.addEventListener("change", () => current.contrast === "system" && applyAppearance());
if (typeof document !== "undefined") applyAppearance();
