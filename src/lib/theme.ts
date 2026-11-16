// The theme in effect, as the shell's runtime (server/shell/runtime.js) writes it to <html data-theme>
// from the person's appearance on this device; and WCAG contrast, which the token tests check.

import { useSyncExternalStore } from "react";

function subscribe(l: () => void) {
  const o = new MutationObserver(l);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => o.disconnect();
}

/** The theme in effect ("system" resolved). */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"), () => "light");
}

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
