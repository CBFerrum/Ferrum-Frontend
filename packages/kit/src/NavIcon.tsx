// The drawing of a left-menu row's icon (names are resolved in navIconName.ts). Named imports only: the table is the
// menu's whole vocabulary, so a name outside it is not drawn (navIconName.test.ts keeps this table and the names equal).

import {
  AppWindow, ArrowLeftRight, Award, Banknote, BedDouble, Bell, BookOpen, Bookmark, Box, Boxes, Briefcase, Building2, Calculator, Calendar,
  CalendarCheck, CalendarClock, CalendarOff, CalendarRange, Car, ChartColumn, ChartPie, CircleAlert, CircleHelp, ClipboardCheck, ClipboardList,
  ClipboardPen, Clock, Cloud, Coins, Contact, Container, Cpu, CreditCard, Database, DoorOpen, ExternalLink, Factory, FileCheck, FileInput,
  FileOutput, FileSignature, FileSpreadsheet, FileText, FileWarning, FlaskConical, Folder, FolderKanban, Fuel, Gauge, Globe, Goal, GraduationCap,
  HandCoins, HandHeart, Handshake, HardDrive, HardHat, Headset, HeartPulse, History, House, IdCard, Inbox, Key, Landmark, Languages, Layers,
  LayoutDashboard, LayoutGrid, LayoutTemplate, LifeBuoy, List, ListChecks, Lock, Mail, MapPin, Megaphone, MessageSquare, Newspaper, Notebook,
  Package, PackageCheck, PackageOpen, PanelTop, Percent, PiggyBank, Play, Plug, Presentation, Puzzle, Radio, Receipt, Repeat, Replace, Route, Scale,
  School, Scroll, Search, SearchCheck, Server, Settings, Share2, Sheet, Shield, ShieldCheck, ShoppingCart, Signature, Siren, SlidersHorizontal,
  Sparkles, SquareCheck, Stamp, Star, Stethoscope, Store, Tag, Tags, Target, Timer, TrendingUp, TriangleAlert, Truck, Undo2, User, UserCheck,
  UserPlus, Users, Utensils, Video, Wallet, Warehouse, Workflow, Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../../src/lib/utils";
import { navIcon, type NavIconInput } from "./navIconName";

export const NAV_ICONS: Record<string, LucideIcon> = {
  "app-window": AppWindow, "arrow-left-right": ArrowLeftRight, award: Award, banknote: Banknote, "bed-double": BedDouble, bell: Bell,
  "book-open": BookOpen, bookmark: Bookmark, box: Box, boxes: Boxes, briefcase: Briefcase, "building-2": Building2, calculator: Calculator,
  calendar: Calendar, "calendar-check": CalendarCheck, "calendar-clock": CalendarClock, "calendar-off": CalendarOff, "calendar-range": CalendarRange,
  car: Car, "chart-column": ChartColumn, "chart-pie": ChartPie, "circle-alert": CircleAlert, "circle-help": CircleHelp,
  "clipboard-check": ClipboardCheck, "clipboard-list": ClipboardList, "clipboard-pen": ClipboardPen, clock: Clock, cloud: Cloud, coins: Coins,
  contact: Contact, container: Container, cpu: Cpu, "credit-card": CreditCard, database: Database, "door-open": DoorOpen,
  "external-link": ExternalLink, factory: Factory, "file-check": FileCheck, "file-input": FileInput, "file-output": FileOutput,
  "file-signature": FileSignature, "file-spreadsheet": FileSpreadsheet, "file-text": FileText, "file-warning": FileWarning,
  "flask-conical": FlaskConical, folder: Folder, "folder-kanban": FolderKanban, fuel: Fuel, gauge: Gauge, globe: Globe, goal: Goal,
  "graduation-cap": GraduationCap, "hand-coins": HandCoins, "hand-heart": HandHeart, handshake: Handshake, "hard-drive": HardDrive,
  "hard-hat": HardHat, headset: Headset, "heart-pulse": HeartPulse, history: History, house: House, "id-card": IdCard, inbox: Inbox, key: Key,
  landmark: Landmark, languages: Languages, layers: Layers, "layout-dashboard": LayoutDashboard, "layout-grid": LayoutGrid,
  "layout-template": LayoutTemplate, "life-buoy": LifeBuoy, list: List, "list-checks": ListChecks, lock: Lock, mail: Mail, "map-pin": MapPin,
  megaphone: Megaphone, "message-square": MessageSquare, newspaper: Newspaper, notebook: Notebook, package: Package, "package-check": PackageCheck,
  "package-open": PackageOpen, "panel-top": PanelTop, percent: Percent, "piggy-bank": PiggyBank, play: Play, plug: Plug, presentation: Presentation,
  puzzle: Puzzle, radio: Radio, receipt: Receipt, repeat: Repeat, replace: Replace, route: Route, scale: Scale, school: School, scroll: Scroll,
  search: Search, "search-check": SearchCheck, server: Server, settings: Settings, "share-2": Share2, sheet: Sheet, shield: Shield,
  "shield-check": ShieldCheck, "shopping-cart": ShoppingCart, signature: Signature, siren: Siren, "sliders-horizontal": SlidersHorizontal,
  sparkles: Sparkles, "square-check": SquareCheck, stamp: Stamp, star: Star, stethoscope: Stethoscope, store: Store, tag: Tag, tags: Tags,
  target: Target, timer: Timer, "trending-up": TrendingUp, "triangle-alert": TriangleAlert, truck: Truck, "undo-2": Undo2, user: User,
  "user-check": UserCheck, "user-plus": UserPlus, users: Users, utensils: Utensils, video: Video, wallet: Wallet, warehouse: Warehouse,
  workflow: Workflow, wrench: Wrench,
};

/** The row's icon: 16px stroke in the row's text colour (`currentColor`), decorative (the label is the name), never blank. */
export function NavIcon({ className, size = 16, ...row }: NavIconInput & { className?: string; size?: number }) {
  const Glyph = NAV_ICONS[navIcon(row)] ?? NAV_ICONS.list!;
  return <Glyph aria-hidden size={size} strokeWidth={1.75} className={cn("nav-icon shrink-0", className)} />;
}
