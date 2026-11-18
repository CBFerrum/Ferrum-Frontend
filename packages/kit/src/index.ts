// @ferrum/kit (docs/plan/apps-ui.md §10.4): the components and layout every Ferrum interface uses.
// Its modules still live in the web app's src/ui and src/components/ui; they move here as the
// apps' interfaces leave the web app (phase U4), without changing this entry point. The shadcn
// primitives (Button, Dialog… as plain building blocks) are `@ferrum/kit/primitives`.
export * from "../../../src/ui/kit";
export type { Tone } from "../../../src/ui/kit";
export { ButtonLink, failureKind, FormSkeleton, HomeSection, HomeSkeleton, PageSplit, PageStack, Progress, Queue, QueueGrid, QueueItem, Stat, StatGrid, Tile, TileGrid, ListSkeleton, LoadFailed, ReaderSkeleton, SaveStatus, SelectionToolbar, type SelectionAction, StatePanel, TableSkeleton, TargetCard, type SaveState, type StateKind } from "../../../src/ui/patterns";
export { Toolbar, ToolbarButton, ToolbarGroup, ToolbarOverflow, ToolbarSeparator } from "../../../src/ui/toolbar";
export { isRichTextEmpty, plainToRichText, preloadRichTextEditor, resolveMergeFields, RichText, RichTextEditor, richTextToPlain, sanitizeRichText } from "../../../src/ui/richtext";
export { normalizeColor, rememberColor, SwatchPalette } from "../../../src/ui/swatches";
export { cn } from "../../../src/lib/utils";
export { placed } from "../../../src/lib/placed";
export { Markdown } from "../../../src/app/studio/dashboard/MarkdownView";
export { goBack, PageHeader, PageHeader as PageHead, useUnsavedGuard } from "../../../src/app/studio/dashboard/ui";
export { AppIcon, APP_ICON_NAMES } from "./AppIcon";
export { FamilyNav } from "./FamilyNav";
export { useLiveEntity, useLivePush, type LiveEvent } from "./live";
export { useCanIntent, useShellTitle } from "./hooks";
export { NavIcon, navIconsReady } from "./NavIcon";
export { navIcon } from "./navIconName";
export { BrandPreview, EmbedSnippet, embedSnippet, LanguageSwitch, PublicFrame, safeLink } from "../../../src/ui/public";
export { accentTokens, contrastRatio, type AccentTokens } from "../../../src/lib/theme";
