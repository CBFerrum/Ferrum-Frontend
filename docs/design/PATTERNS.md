# Patterns

Governed patterns of `@ferrum/kit` and the task layouts they compose. Everything here is exported from `@ferrum/kit` (`src/ui/patterns.tsx`); `npm run gallery` (port 5199, development only) shows each one in every state, in light and dark, comfortable and compact, normal and more contrast, left to right and right to left. The gallery's test runs axe over its sections. Component tests and axe in jsdom are not browser proof: layout, contrast and focus order still need a real browser and a person.

## Page anatomy

Every page of the shell, Studio, Administration and the record screens follows one frame (`src/styles.css`: `main`, `.page-head`, `.page-title`, `.page-sub`, `.page-actions`, `.crumbs`). The gallery's "Page anatomy" section shows it.

| Part | Rule |
|---|---|
| Content area (`main`) | 20px above, 24px at the sides, 48px below; 16px above and at the sides on phones. Pages with an app sidebar start 24px right of it (272px from the window edge at the standard sidebar); pages without one (Administration) start 24px from the window edge. The only centred pages are landings: the shell home and a person's account, at most 1180px / 760px wide. Work pages (lists, records, reports, dashboards, admin) fill the area; a single column of prose is capped by its own rule, never by the page. |
| Above the title | One optional line, `.crumbs` (`text-xs`, muted, 4px below): the parent list on a record, "Report", the section of a Studio page. Nothing else. |
| Title | `h1.page-title`: `text-2xl`, weight 600, tracking -0.015em, line height 1.25, one per page, sentence case. Its box is one control tall (`--control-h`), so a title and the buttons beside it share a centre line; its box starts 68px under the top of the window (the 48px bar and 20px of padding in `main`) on every page that has no line above it, and the first line of text sits 3px lower inside it. A count or state beside it sits on its baseline (`.page-titles`), muted. |
| Under the title | `.page-sub`: `text-base`, muted, 2px below. One line; where the line is only for assistive technology it is `sr-only`. |
| Action row | `.page-actions`, at the end of the title row, 8px between buttons, centred on the title line. At most one primary button; the rest are the default button; secondary and rare actions wait in one overflow menu ("More actions", an icon button with that name). Below 720px the row goes under the title. |
| Header to content | 16px (`.page-head` margin). A tab list or toolbar follows at the same 16px. |
| Work surfaces | One `.card` (or `.form-card`, `.list-card`): `--surface`, 1px `--border`, `--radius`. Cards do not nest. Dashboards and Studio's tiles use the same card. |
| Gaps | Between cards or sections 24px; between fields 16px (24px between columns); inside a card 16px; between a label and its control 6px. Only the 4/8/12/16/24/32/48 steps. |
| Section headings | `text-base`, weight 600, inside dense tools; `text-xl` only for a heading that names a whole region of a landing page. |
| Tables | One header style everywhere (`.table th`, `.line-grid th`, Studio's `TableHead`): `text-xs`, weight 500, muted, on `--surface-2`; rows 36px (32 compact); figures end-aligned and tabular. |
| Navigation | Record tabs, Administration's section list and Studio's sidebar differ by what they navigate, not by look: the selected item is `--primary-soft` with `--primary` text, hover is `--surface-2`, focus is the global outline. Segmented controls (list views) are for switching how the same data is shown. |
| Empty and failed regions | `StatePanel`, top-weighted: it starts where the content would, 48 to 64px under the region's top, never dead centre. |

## Read-only values

A value the person cannot edit is text in the field's own place (`.read-value`), not a disabled box; a control that is only temporarily unavailable keeps its shape (`:disabled`). A tick that cannot be changed is a word, "Yes" or "No" (`.read-text`; an `<output>` named by the label, so assertions by label keep working). A read-only field with nothing in it recedes: the label stays, the dash is fainter and the row tighter (`.field-empty`). Three or more of those side by side in one section fold into a single quiet line, "Not set: Web payment, Contact email, Ship to", a button (`aria-expanded`) that opens, by click, Enter or Space, to the fields as they are (`src/app/EmptyRun.tsx`, rule in `FormView.tsx`: `isQuiet`, `FOLD_EMPTY_MIN`). Editable fields, required fields and fields with an error are never folded; read-only fields are not tab stops, so folding hides nothing from the keyboard.

## The list toolbar

A list page is the page frame above, then one `.list-card` holding the toolbar and the table (or board, calendar, timeline). The header carries the view switcher (a segmented control: list, board, calendar, timeline), one "More actions" menu (import, export, columns, and the rest) and the primary "New" button. The toolbar row inside the card is search (`--control-h`), "Filter", the group-by control for boards, "Views" and "Columns"; its height is one control. Rows selected replace the toolbar with `SelectionToolbar`. `.select` is part of the same control family as `.input`: same height, boundary, radius and a quiet chevron (two token-coloured strokes, no image) in both themes and both directions.

## Administration

The page frame, then a two-column layout: a grouped section list (208px, `.admin-nav`; group labels are `text-xs`, weight 500, muted, sentence case, as the app sidebar's are) and the section's own card. Narrow screens turn the list into one scrolling strip. Row actions are `.row-actions` (a flex row with a 4px gap, not text spaces), with the rare ones in an overflow menu that is named per row ("Actions for ...").

## App icons

`AppIcon` (kit) draws an app's Lucide glyph in the app's colour; `tile` puts it on a soft tile of that colour, one rule for the bar, the launcher and the family navigation, with the glyph held to 3:1 against its tile in both themes (`packages/kit/src/AppIcon.test.ts`). A name outside the set shows the app's initial on the tile.

## Overlays

Menus, popovers, dialogs, sheets and toasts are one family: `--surface`, 1px `--border`, `--radius` (12px for dialogs), `--shadow` (the only floating elevation), opening with `--duration-overlay` fade and a 3px / 98% scale from the trigger, closing faster, nothing under reduced motion. Menu rows are 32px; a row that cannot be chosen says why. Focus moves into a dialog or menu when it opens and returns to the trigger when it closes (asserted for the list's overflow menu, a menu item that opens a dialog and the Administration dialogs by `evidence/integration-after/tab-order.json`). Toasts (`Toaster`) announce politely and never carry the only copy of an error.

## Generic reports

`ReportView` (`/…/r/<name>`) draws any report the server describes, with the discipline of a financial statement and only from what the data says: `_indent` (tree depth, 1.25rem a level), `_bold` (a group, subtotal or total: weight 600 and a single rule above, never a fill) and the `totals` row (a rule above, a double rule under). The table scrolls inside `.report-frame` so the head and the first column (what a row is) stay in view on a wide report. A figure whose own value is zero is faint, one with a minus in front is `--danger` (the text is shown exactly as the server sent it); figures are tabular, end-aligned and isolated so a minus stays in front in right-to-left. What was run (the company, currency and period the report states as text) is one quiet line under the title, followed by when; figures and ticks the report states stay in the summary above the table. No row kind is ever inferred from a word.

## Chips

`.chip` is a general pill: a filter, a tag, a toggle. It is a button, a link or a span; its content is centred whatever the children (text, icon, count); it wraps inside `.chips`. Hover is `--primary-soft` with accent text; pressed (`aria-pressed="true"`) is the accent fill, and a pressed chip that is hovered goes to `--primary-hover` with the same text, so it stays legible. The list filter's own token (field, value, remove button) is `.chip.chip-field`. The same hover-over-selected check holds for the segmented control, tabs, nav items, table rows and the toggle (pressed is the selection fill, hover does not change it).

## Printing

`@media print` (end of `src/styles.css`) prints a page as its content: the sidebar, bar offset, banners, toasts, tab lists, toolbars, filters, parameters, peek panel, row actions and "Add row" controls are hidden; `main` is the full page width; nothing is sticky or clipped (tables print whole, every row unbroken, headers and footers repeat); the colour scheme is forced to light whatever the theme, so text is dark on white; links are not underlined or coloured; controls print as plain boxes without arrows. The platform's own bar is hidden by the platform; the kit reserves no space for it. Checked by `page.pdf()` on a record, a list, a report and a long ledger (`evidence/integration-after/print-*.pdf`).

## Charts with two scales

A bar, line or area chart that plots measures of very different size (a count of 3 beside a sum of 22,000) would draw the small one as nothing. When the largest value of a measure is under 2% of the largest of the others (`smallSeries` in `src/app/studio/dashboard/charts.ts`), it gets its own axis on the right, named quietly in the measure's label, and a bar chart draws it as a line so the two never overlap. Data is never dropped or rescaled; stacked bars never split (their total is the point).

## State → what the user sees → component

| State | What the user sees | Component |
|---|---|---|
| Loading (shape known) | Grey shapes where the content will be | `ListSkeleton`, `TableSkeleton`, `FormSkeleton`, `ReaderSkeleton` |
| Loading (nothing to shape) | Spinner and "Loading…" | `StatePanel kind="loading"` |
| Loading (a route) | A title bar, a line and a few rows in quiet skeletons, named "Loading…" | `PageLoading` (same props as before; every app's route fallback) |
| First-use empty | What this is and the first step | `StatePanel kind="empty"` (`EmptyState` still works) |
| No matches | "No matches", why, "Clear filters" | `StatePanel kind="no-matches"` |
| Denied | "You don't have access to this" and how to ask; never what exists | `StatePanel kind="denied"` |
| Offline | "You're offline" and, if true for the caller, that work is kept; "Try again" when the caller passes `onRetry` | `StatePanel kind="offline"` |
| Failed | What failed, the reason, "Try again"; context stays | `StatePanel kind="failed"` (`ErrorState` still works) |
| Stale | The content stays; a non-blocking notice with "Refresh" | kit `Alert` with a refresh `action` (no component) |
| A change's progress | Draft, saving, saved, kept on this device, conflict, failed, unknown | `SaveStatus` |
| Rows selected | How many, of what scope, the actions, "Clear selection" | `SelectionToolbar` |

`EmptyState` and `ErrorState` (in `src/ui/kit.tsx`) remain, because apps use them; they map onto `StatePanel`'s `empty` and `failed`. `PageLoading` is no longer a spinner block: it is the shape of a page built from `Skeleton` (`role="status"`, `aria-busy`, its label read by assistive technology), so an app that still uses it as a route fallback improves without a change. New code uses `StatePanel`, which also has `no-matches`, `denied` and `offline`.

## StatePanel

For a request that failed, use `LoadFailed` (`<LoadFailed error={query.error} onRetry={() => query.refetch()} />`): it picks `denied` for 401 and 403, `offline` when there was no answer, `failed` otherwise, so apps do not each write that mapping. `failureKind(error)` gives the kind alone.

When: a region has nothing to show. Pick the kind by why, not by how it looks.

```tsx
import { StatePanel } from "@ferrum/kit";
<StatePanel kind="no-matches" onClear={clearFilters}>{t("Nothing matches “{q}”.", { q })}</StatePanel>
<StatePanel kind="failed" error={query.error} onRetry={() => query.refetch()} />
<StatePanel kind="offline" onRetry={() => query.refetch()}>{t("Your changes are kept on this device until you are back online.")}</StatePanel>
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
