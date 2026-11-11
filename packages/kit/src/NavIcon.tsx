// A left-menu row's icon: a 16px slot that is there at once and is drawn when the drawing table arrives. The table
// (NavIconTable.tsx, every named lucide import the menu has) is one lazy chunk, requested by the first row drawn and
// preloaded by the built page's HTML, so in practice the icons are there at first paint; until then the slot is empty
// (same size, no spinner, no shift) and once it has arrived every later render draws at once. Names are resolved in
// navIconName.ts, which stays in the entry.

import { useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../../src/lib/utils";
import { navIcon, type NavIconInput } from "./navIconName";

let table: Record<string, LucideIcon> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Resolves when the drawing table has arrived (or failed to: the slots then stay empty). One request for the session. For tests and capture scripts. */
export function navIconsReady(): Promise<void> {
  loading ??= import("./NavIconTable").then(
    (m) => {
      table = m.NAV_ICONS;
      listeners.forEach((l) => l());
    },
    () => {}, // the chunk did not load: rows keep their label, the slot stays empty
  );
  return loading;
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => table;

/** The row's icon: 16px stroke in the row's text colour (`currentColor`), decorative (the label is the name), never blank once drawn. */
export function NavIcon({ className, size = 16, ...row }: NavIconInput & { className?: string; size?: number }) {
  const t = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (!t) void navIconsReady(); // the first slot rendered asks for the table; the built page's HTML has preloaded it already
  const Glyph = t && (t[navIcon(row)] ?? t.list);
  if (!Glyph) return <span aria-hidden className={cn("nav-icon shrink-0", className)} style={{ display: "inline-block", width: size, height: size }} />;
  return <Glyph aria-hidden size={size} strokeWidth={1.75} className={cn("nav-icon shrink-0", className)} />;
}
