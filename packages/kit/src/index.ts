// @ferrum/kit (docs/plan/apps-ui.md §10.4): the components and layout every Ferrum interface uses.
// Its modules still live in the web app's src/ui and src/components/ui; they move here as the
// apps' interfaces leave the web app (phase U4), without changing this entry point. The shadcn
// primitives (Button, Dialog… as plain building blocks) are `@ferrum/kit/primitives`.
export * from "../../../src/ui/kit";
export type { Tone } from "../../../src/ui/kit";
export { ButtonLink, failureKind, FormSkeleton, HomeSection, HomeSkeleton, PageSplit, PageStack, Progress, type ProgressTone, Queue, QueueGrid, QueueItem, Stat, StatGrid, Tile, TileGrid, ListSkeleton, LoadFailed, ReaderSkeleton, SaveStatus, SelectionToolbar, StatePanel, TableSkeleton, type SaveState, type StateKind } from "../../../src/ui/patterns";
export { cn, insideNativeDialog } from "../../../src/lib/utils";
export { PortalContainer, usePortalContainer } from "../../../src/lib/portal";
export { placed } from "../../../src/lib/placed";
export { Markdown } from "../../../src/app/studio/dashboard/MarkdownView";
export { goBack, PageHeader, PageHeader as PageHead, useUnsavedGuard } from "../../../src/app/studio/dashboard/ui";
export { AppIcon, APP_ICON_NAMES } from "./AppIcon";
export { FamilyNav } from "./FamilyNav";
export { useLiveEntity, useLivePush, type LiveEvent } from "./live";
export { useCanIntent, useShellTitle } from "./hooks";
export { NavIcon, navIconsReady } from "./NavIcon";
export { navIcon, conceptIcon, NAV_ICON_NAMES, type NavIconInput } from "./navIconName";
