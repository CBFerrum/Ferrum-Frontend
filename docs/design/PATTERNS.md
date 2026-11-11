# Patterns

Governed patterns of `@ferrum/kit` and the task layouts they compose. Everything here is exported from `@ferrum/kit` (`src/ui/patterns.tsx`); `npm run gallery` (port 5199, development only) shows each one in every state, in light and dark, comfortable and compact, normal and more contrast, left to right and right to left. The gallery's test runs axe over its sections. Component tests and axe in jsdom are not browser proof: layout, contrast and focus order still need a real browser and a person.

## State → what the user sees → component

| State | What the user sees | Component |
|---|---|---|
| Loading (shape known) | Grey shapes where the content will be | `ListSkeleton`, `TableSkeleton`, `FormSkeleton`, `ReaderSkeleton` |
| Loading (nothing to shape) | Spinner and "Loading…" | `StatePanel kind="loading"` (`PageLoading` still works) |
| First-use empty | What this is and the first step | `StatePanel kind="empty"` (`EmptyState` still works) |
| No matches | "No matches", why, "Clear filters" | `StatePanel kind="no-matches"` |
| Denied | "You don't have access to this" and how to ask; never what exists | `StatePanel kind="denied"` |
| Offline | "You're offline" and, if true for the caller, that work is kept | `StatePanel kind="offline"` |
| Failed | What failed, the reason, "Try again"; context stays | `StatePanel kind="failed"` (`ErrorState` still works) |
| Stale | The content stays; a non-blocking notice with "Refresh" | kit `Alert` with a refresh `action` (no component) |
| A change's progress | Draft, saving, saved, kept on this device, conflict, failed, unknown | `SaveStatus` |
| Rows selected | How many, of what scope, the actions, "Clear selection" | `SelectionToolbar` |

`PageLoading`, `EmptyState` and `ErrorState` (in `src/ui/kit.tsx`) remain, because apps use them. They map onto `StatePanel`'s `loading`, `empty` and `failed`. New code uses `StatePanel`, which also has `no-matches`, `denied` and `offline`.

## StatePanel

When: a region has nothing to show. Pick the kind by why, not by how it looks.

```tsx
import { StatePanel } from "@ferrum/kit";
<StatePanel kind="no-matches" onClear={clearFilters}>{t("Nothing matches “{q}”.", { q })}</StatePanel>
<StatePanel kind="failed" error={query.error} onRetry={() => query.refetch()} />
<StatePanel kind="offline">{t("Your changes are kept on this device until you are back online.")}</StatePanel>
```

Accessibility: `failed` is `role="alert"`; `loading` is `role="status"` with `aria-busy`; `no-matches` is `role="status"` (it replaces content after the user's action); the others announce nothing. Icons are decorative, one size; tone differs per kind (only `failed` is red).

Do not: show `loading` for longer than the load; use `empty` when a filter hid the rows (that is `no-matches`); say in `denied` what the thing is or whether it exists; claim in `offline` that work is kept unless the caller keeps it (the sentence is the caller's `children`); replace a screen with `failed` when stale content could stay; hide the retry.

## Content-shaped loading

When: a route, dialog or list is waiting and its shape is known. A blank or spinner-only fallback loses the user's place; `fallback={null}` is a lint finding (`blank-fallback`).

```tsx
import { ListSkeleton, TableSkeleton } from "@ferrum/kit";
<Suspense fallback={<TableSkeleton columns={4} rows={4} />}><ApiKeys /></Suspense>
```

`ListSkeleton` (leading mark, two lines, trailing value; Mail and file lists), `TableSkeleton` (header and rows), `FormSkeleton` (label and control pairs at the control height of the density), `ReaderSkeleton` (title, who and when, paragraphs; a message or document). Widths vary by position, never at random, so snapshots and hydration agree.

Accessibility: one wrapper with `role="status"` and `aria-label` "Loading…"; the shapes are `aria-hidden`. The pulse stops for reduced motion (`motion-reduce` and the global rule in `styles.css`).

Do not: keep a skeleton once data arrives, even empty; use one for a background refresh (keep the content); use a skeleton of another shape "because it exists". A tiny inline control (a field's lazy editor) may keep a small spinner.

## SaveStatus

When: a change is being made and the user needs to know where it stands.

```tsx
import { SaveStatus } from "@ferrum/kit";
<SaveStatus state={saving ? "saving" : dirty ? "draft" : "saved"} at={savedAt} />
```

States: `draft` (changes not sent), `saving`, `saved` (the server confirmed), `local` (kept on this device, not on the server), `conflict` (someone else changed it first), `failed`, `unknown` (no answer, so nothing is claimed). `at` is shown with `formatMoment`.

Accessibility: `role="status"`, polite; icon plus words, never colour alone.

Do not: show `saved` before the durable milestone, or for `local`; lose the draft on `failed` or `conflict`; invent other states.

## SelectionToolbar

When: rows are selected. `BulkBar` (the list's bulk actions) renders through it.

```tsx
import { SelectionToolbar } from "@ferrum/kit";
<SelectionToolbar label={t("Actions for the {what} selected", { what })} count={n} scope={all ? "matching" : "shown"} of={total} onClear={clear} extend={selectAllButtons}>{actions}</SelectionToolbar>
```

Scope sentence: "3 selected"; "All 240 matching selected"; "500 selected" with "of 1,200 matching" when a cap applies. `extend` holds the buttons that widen the selection; children are the actions. Escape clears.

Accessibility: `role="toolbar"` with the caller's `aria-label`. There is no arrow-key roving between its buttons (BulkBar has none); each is a tab stop. Focus return after the bar unmounts is the caller's (BulkBar returns it to the list).

Do not: say "All" when the count is a capped fetch; put destructive actions without confirmation; hide the count.

## Task layouts

These are compositions of what exists, not components.

- **Inbox** (Mail): a list pane and a reader pane in `resizable.tsx` (`ResizablePanelGroup`), `ListSkeleton` while loading, `ReaderSkeleton` for the reader, `StatePanel` for empty, no matches and failed, `SelectionToolbar` for multi-select.
- **File browser** (Drive): a `FilterBar`/breadcrumb above a list or table, `TableSkeleton`, `Menu` for row actions, `SelectionToolbar`, `StatePanel kind="empty"` with the upload action.
- **Editor** (Docs, designers): the document in the main area, `SaveStatus` in the header, `useUnsavedGuard` for leaving, `Dialog` for decisions; a `resizable.tsx` inspector beside it where there is one.
- **Record workspace** (ERP, CRM): `PageHeader`, `Tabs` with `TabPanel`, the record form (`FormSkeleton` while loading), `RecordPeek` and `Related` for context, `Alert` for stale and conflicts.
- **Builder** (Studio): a canvas, a palette and an inspector in `resizable.tsx`, `SaveStatus`, `Dialog` for publish decisions.
- **Analytics** (dashboards, reports): `PageHeader`, `FilterBar`, chart cards, `StatePanel` per card for loading, no data and failed, so one failing card does not blank the page.

## Not built yet

No kit implementation exists; each waits for the screen that should drive it.

- **ContextInspector**: a side panel for the selected thing. Drive it from `src/app/list/RecordPeek.tsx` and Mail's reader.
- **ApprovalPreview**: what an approval will do, before it is done. Drive it from `src/app/ActionDialog.tsx` and the bulk submit/cancel confirmations in `BulkBar`.
- **TransferTray**: uploads and downloads in flight, with retry. Drive it from Drive's upload flow.
- **AppHeader / ViewToolbar** as distinct components: today `PageHeader` and each app's own toolbar. Drive them from the ERP list header and Mail's toolbar.
- **StaleBanner**: no real consumer found; use `Alert` with a refresh action until one appears.
