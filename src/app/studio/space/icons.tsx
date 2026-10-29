// Space icons: a curated set of lucide icons by kebab-case name, the names module metadata uses
// (`shopping-cart`, `landmark`), so a space can take its module's icon. Unknown names fall back.

import {
  Activity,
  Banknote,
  Bell,
  Book,
  Boxes,
  Briefcase,
  Building,
  Building2,
  Calendar,
  CalendarClock,
  ChartColumn,
  ChartLine,
  ChartPie,
  ClipboardList,
  Clock,
  CreditCard,
  Database,
  Factory,
  FileSignature,
  FileText,
  Folder,
  Gauge,
  Globe,
  GraduationCap,
  Handshake,
  HardDrive,
  Hash,
  Heart,
  House,
  Landmark,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  ListChecks,
  Mail,
  Megaphone,
  Package,
  PiggyBank,
  Receipt,
  Rocket,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Table,
  Target,
  Truck,
  UserPlus,
  Users,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

export const SPACE_ICONS: Record<string, LucideIcon> = {
  home: House,
  "layout-grid": LayoutGrid,
  "layout-dashboard": LayoutDashboard,
  chart: ChartColumn,
  "chart-line": ChartLine,
  "chart-pie": ChartPie,
  activity: Activity,
  gauge: Gauge,
  target: Target,
  database: Database,
  book: Book,
  landmark: Landmark,
  banknote: Banknote,
  wallet: Wallet,
  "piggy-bank": PiggyBank,
  "credit-card": CreditCard,
  receipt: Receipt,
  "shopping-cart": ShoppingCart,
  "shopping-bag": ShoppingBag,
  store: Store,
  handshake: Handshake,
  megaphone: Megaphone,
  mail: Mail,
  bell: Bell,
  package: Package,
  boxes: Boxes,
  truck: Truck,
  factory: Factory,
  wrench: Wrench,
  "clipboard-list": ClipboardList,
  "list-checks": ListChecks,
  "life-buoy": LifeBuoy,
  users: Users,
  "user-plus": UserPlus,
  "graduation-cap": GraduationCap,
  briefcase: Briefcase,
  building: Building,
  "building-2": Building2,
  calendar: Calendar,
  "calendar-clock": CalendarClock,
  clock: Clock,
  "file-text": FileText,
  "file-signature": FileSignature,
  folder: Folder,
  "hard-drive": HardDrive,
  table: Table,
  hash: Hash,
  layers: Layers,
  globe: Globe,
  heart: Heart,
  star: Star,
  rocket: Rocket,
  sparkles: Sparkles,
  zap: Zap,
  settings: Settings,
};

export function SpaceIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = (name && SPACE_ICONS[name]) || (name === "house" ? House : LayoutGrid);
  return <Icon className={className} aria-hidden="true" />;
}

const iconLabel = (name: string) => humanize(name.replace(/-/g, "_"));

/** A button showing the chosen icon that opens a searchable grid (arrow keys move between icons). */
export function IconPicker({ id, value, onChange }: { id?: string; value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase().replace(/\s+/g, "-");
  const names = Object.keys(SPACE_ICONS).filter((n) => n.includes(term));
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" className="w-full justify-start gap-2 font-normal pointer-coarse:min-h-11">
          <SpaceIcon name={value || undefined} className="size-4" />
          <span className={cn(!value && "text-muted-foreground")}>{value ? iconLabel(value) : "Choose an icon"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons" aria-label="Search icons" className="mb-2" />
        {names.length ? (
          <ToggleGroup
            type="single"
            spacing={1}
            value={value}
            onValueChange={(v) => {
              if (v) onChange(v);
              setOpen(false);
            }}
            aria-label="Icons"
            className="grid w-full grid-cols-7 gap-1"
          >
            {names.map((n) => (
              <ToggleGroupItem
                key={n}
                value={n}
                aria-label={iconLabel(n)}
                title={iconLabel(n)}
                className="size-9 p-0 data-[state=on]:bg-primary-soft data-[state=on]:text-primary pointer-coarse:size-11"
              >
                <SpaceIcon name={n} className="size-4" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">No icons match “{q.trim()}”.</p>
        )}
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            No icon
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
