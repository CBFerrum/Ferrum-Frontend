// An app's icon by the Lucide name its manifest gives (`icon:` of a launcher entry), in the app's
// colour: the same names the bar draws (server/shell/runtime.js). A name outside the set shows the
// app's initial on a tile, and nothing as a bare glyph.

import {
  Boxes,
  Building2,
  Calculator,
  Calendar,
  CalendarCheck,
  ClipboardList,
  Contact,
  Factory,
  FileText,
  Folder,
  FolderKanban,
  GraduationCap,
  HardDrive,
  Headset,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  Megaphone,
  MessageSquare,
  Package,
  Presentation,
  Receipt,
  Sheet,
  ShoppingCart,
  Signature,
  Sparkles,
  Store,
  Users,
  Video,
  Wrench,
} from "lucide-react";
import { cn } from "../../../src/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  boxes: Boxes,
  "building-2": Building2,
  calculator: Calculator,
  calendar: Calendar,
  "calendar-check": CalendarCheck,
  "clipboard-list": ClipboardList,
  contact: Contact,
  factory: Factory,
  "file-text": FileText,
  folder: Folder,
  "folder-kanban": FolderKanban,
  "graduation-cap": GraduationCap,
  "hard-drive": HardDrive,
  headset: Headset,
  landmark: Landmark,
  "layout-dashboard": LayoutDashboard,
  mail: Mail,
  megaphone: Megaphone,
  "message-square": MessageSquare,
  package: Package,
  presentation: Presentation,
  receipt: Receipt,
  sheet: Sheet,
  "shopping-cart": ShoppingCart,
  signature: Signature,
  sparkles: Sparkles,
  store: Store,
  users: Users,
  video: Video,
  wrench: Wrench,
};

const hex = (c?: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined);

/** The glyph in the app's colour (`tile`: white on a tile of that colour, as in the launcher). */
export function AppIcon({ name, color, title, tile = false, size = 16, className }: { name?: string | null; color?: string | null; title?: string; tile?: boolean; size?: number; className?: string }) {
  const Glyph = name ? ICONS[name] : undefined;
  if (!tile) return Glyph ? <Glyph aria-hidden size={size} className={cn("shrink-0", className)} style={{ color: hex(color) }} /> : null;
  const side = Math.round(size * 1.75);
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-[28%] font-bold text-white shadow-xs", className)}
      style={{ width: side, height: side, background: hex(color) ?? "var(--primary)", fontSize: size * 0.8 }}
    >
      {Glyph ? <Glyph size={size} /> : (title ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
