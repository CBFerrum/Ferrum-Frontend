// @ferrum/kit (docs/plan/apps-ui.md §10.4): the components and layout every Ferrum interface uses.
// Its modules still live in the web app's src/ui and src/components/ui; they move here as the
// apps' interfaces leave the web app (phase U4), without changing this entry point. The shadcn
// primitives (Button, Dialog… as plain building blocks) are `@ferrum/kit/primitives`.
export * from "../../../src/ui/kit";
export { cn, insideNativeDialog } from "../../../src/lib/utils";
export { Markdown } from "../../../src/app/studio/dashboard/MarkdownView";
export { goBack, PageHeader, useUnsavedGuard } from "../../../src/app/studio/dashboard/ui";
export { FamilyNav } from "./FamilyNav";
export { useLiveEntity, useLivePush, type LiveEvent } from "./live";
export { useCanIntent, useShellTitle } from "./hooks";
