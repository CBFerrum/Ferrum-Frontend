// An app's icon by the Lucide name its manifest gives (`icon:` of a launcher entry), in the app's
// colour: the same names the bar draws (server/shell/runtime.js). A name outside the set shows the
// app's initial on a tile, and nothing as a bare glyph.

import {
  BedDouble,
  Boxes,
  Building2,
  Calculator,
  Calendar,
  CalendarCheck,
  ClipboardList,
  Cloud,
  Contact,
  Factory,
  FileText,
  Folder,
  FolderKanban,
  GraduationCap,
  HandHeart,
  HardDrive,
  HardHat,
  Headset,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  type LucideIcon,
  Mail,
  Megaphone,
  MessageSquare,
  Package,
  Plug,
  Presentation,
  Receipt,
  Server,
  Share2,
  Sheet,
  ShoppingCart,
  Signature,
  Sparkles,
  Stethoscope,
  Store,
  Truck,
  Users,
  Utensils,
  Video,
  Warehouse,
  Wrench,
} from "lucide-react";
import { cn } from "../../../src/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "bed-double": BedDouble,
  boxes: Boxes,
  "building-2": Building2,
  calculator: Calculator,
  calendar: Calendar,
  "calendar-check": CalendarCheck,
  "clipboard-list": ClipboardList,
  cloud: Cloud,
  contact: Contact,
  factory: Factory,
  "file-text": FileText,
  folder: Folder,
  "folder-kanban": FolderKanban,
  "graduation-cap": GraduationCap,
  "hand-heart": HandHeart,
  "hard-drive": HardDrive,
  "hard-hat": HardHat,
  headset: Headset,
  landmark: Landmark,
  "layout-dashboard": LayoutDashboard,
  "layout-grid": LayoutGrid,
  mail: Mail,
  megaphone: Megaphone,
  "message-square": MessageSquare,
  package: Package,
  plug: Plug,
  presentation: Presentation,
  receipt: Receipt,
  server: Server,
  "share-2": Share2,
  sheet: Sheet,
  "shopping-cart": ShoppingCart,
  signature: Signature,
  sparkles: Sparkles,
  stethoscope: Stethoscope,
  store: Store,
  truck: Truck,
  users: Users,
  utensils: Utensils,
  video: Video,
  warehouse: Warehouse,
  wrench: Wrench,
};

/** The icon names `AppIcon` draws. */
export const APP_ICON_NAMES = Object.keys(ICONS);

const hex = (c?: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined);

/** How an app's colour becomes its tile, one rule for every app (the bar, the launcher, the family
 *  navigation, Home): the colour mixed into the surface (a little stronger in dark), the glyph in the
 *  colour mixed toward the text colour, a hairline of the colour. Measured over the suite's colours
 *  (AppIcon.test.ts): the glyph keeps 3:1 against its tile in both themes. */
export const APP_TILE = { light: 14, dark: 18, glyph: 70, ring: 22 } as const;

/** The glyph in the app's colour (`tile`: that glyph on a soft tile of the colour, as in the launcher). */
export function AppIcon({ name, color, title, tile = false, size = 16, className }: { name?: string | null; color?: string | null; title?: string; tile?: boolean; size?: number; className?: string }) {
  const Glyph = name ? ICONS[name] : undefined;
  const c = hex(color) ?? "var(--primary)";
  const glyph = `color-mix(in srgb, ${c} ${APP_TILE.glyph}%, var(--text))`;
  if (!tile) return Glyph ? <Glyph aria-hidden size={size} className={cn("shrink-0", className)} style={{ color: hex(color) ? glyph : undefined }} /> : null;
  const side = Math.round(size * 1.75);
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-[26%] font-semibold", className)}
      style={{
        width: side,
        height: side,
        color: glyph,
        background: `light-dark(color-mix(in srgb, ${c} ${APP_TILE.light}%, var(--surface)), color-mix(in srgb, ${c} ${APP_TILE.dark}%, var(--surface)))`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} ${APP_TILE.ring}%, transparent)`,
        fontSize: size * 0.8,
      }}
    >
      {Glyph ? <Glyph size={size} strokeWidth={1.9} /> : (title ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
