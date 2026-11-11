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

## Navigation icons

Every row of a left menu starts with a 16px stroke icon in a fixed slot, then an 8px gap and the label: the app sidebar (Home, each module's entities, reports, add-on pages, Administration), Studio's sidebar and Administration's section list. Group headings stay text. Colour is `--muted-foreground` at rest, `--text` on hover and `--primary` on the open row; never filled or coloured (the app's coloured tile is only in the sidebar head). Only a link to a page outside the app keeps a mark at the row's end. Icons are decorative (`aria-hidden`; the label is the name) and use `currentColor`. `navIcon({ icon, entity, kind, submittable, to })` (`packages/kit/src/navIconName.ts`) picks the name, in this order: (1) the icon the row declares (a lucide name in kebab-case, from metadata, an app's nav item or `EntitySummary.icon`; an unknown name falls through and is logged once in development); (2) the concept dictionary, keyed on the entity's stable name split into whole words (CamelCase or snake_case, plurals folded), the longest run of words first and the last such run when equal, so the same concept has the same icon in every app; (3) the kind: report, page, settings, document or submittable, otherwise a list. It is never empty. **Repetition rule**: within one app's menu no icon is on more than three rows unless the rows are the same kind of thing (every report shares the chart icon; a declared exception goes in `EXCEPTIONS` in `navIconName.test.tsx`, with the reason). The second word of a family says which member: Stays is a bed, Folios a receipt, Rooms a door, Night Audits a moon; Leads a user-plus, Opportunities a target, Pipelines a funnel, Sales Stages a milestone. A qualifier (Type, Group, Category, Class, Kind, Attribute) takes the icon of what it qualifies ("Item Groups" is the package, "Customer Groups" the users, "Leave Types" the leave icon) and is tags only when nothing else is named. Time reads as time (Fiscal Year and Period are calendar-range, Closing a lock). A new entity is checked by `navIconName.test.tsx`, which counts rows per icon per app from `navIconName.entities.json` (`python3 scripts/nav-icon-entities.py` regenerates it from the app repositories). **The dictionary (`CONCEPTS` in that file) is the place to add a concept**; a test requires every entity name in `navIconName.entities.json` (the installed apps' menu record types, by app) to resolve through a concept word, and that the drawing table (`NavIcon.tsx`) holds exactly the names the resolver can return. The drawing table (`NavIconTable.tsx`, about 47 KB raw, 14 KB gzip) is one lazy chunk, not part of any entry: `NavIcon` renders its 16px slot at once (empty, no spinner, no shift) and draws when `navIconsReady()` resolves, requested by the first row drawn and preloaded by the built HTML (`preloadNavIcons` in `packages/build/vite.mjs`, used by the shell, Studio and `ferrumApp`; the links say `data-budget="lazy"` so `budgets.mjs` does not count them as entry). Nothing static may import the table; use `NavIcon`. A test or capture script awaits `navIconsReady()`. `NavIcon`, `navIconsReady` and `navIcon` are exported from `@ferrum/kit` for an app that draws a left menu of its own; Mail's folders, Drive's places and Chat's channels keep their own marks.

## App icons

`AppIcon` (kit) draws an app's Lucide glyph in the app's colour; `tile` puts it on a soft tile of that colour, one rule for the bar, the launcher and the family navigation, with the glyph held to 3:1 against its tile in both themes (`packages/kit/src/AppIcon.test.ts`). A name outside the set shows the app's initial on the tile.

## Overlays

Menus, popovers, dialogs, sheets and toasts are one family: `--surface`, 1px `--border`, `--radius` (12px for dialogs), `--shadow` (the only floating elevation), opening with `--duration-overlay` fade and a 3px / 98% scale from the trigger, closing faster, nothing under reduced motion. Menu rows are 32px; a row that cannot be chosen says why. Focus moves into a dialog or menu when it opens and returns to the trigger when it closes (asserted for the list's overflow menu, a menu item that opens a dialog and the Administration dialogs by `evidence/integration-after/tab-order.json`). Toasts (`Toaster`) announce politely and never carry the only copy of an error. `toast(message, tone?, { action?: { label, onSelect }, duration? })` adds one button (Undo): it is a real button after the message, pressing it dismisses the toast and calls `onSelect` once, a toast with an action stays at least 8 seconds whatever `duration` says, and every toast's timer stops while the pointer is over it or focus is inside it. **Every destructive or filing action offers Undo for at least 8 seconds** (move to Trash, archive, file to a folder, remove from a list); an app does not build its own Undo bar. `announce(message)` speaks a sentence through the toaster's polite live region and shows nothing ("3 conversations moved to Trash" after a bulk action); the message is announced once, so pair it with a toast only when the toast has no text of its own.

**Where toasts sit** (`Toaster`). At the bottom end of the page, `--ferrum-bar-height` and the platform bar untouched, above sheets (z-index 200) and below native dialogs (top layer), as before. A page that occupies that corner (a compose window opening at the bottom end, covering Send) declares it instead of moving the toaster with its own CSS: `useToastPlacement("bottom-start" | "top-end")` in the component that is the occupant (the last one mounted wins; the earlier choice, or the default, comes back when it unmounts), or `data-toast-placement="bottom-start"` / `"top-end"` on any element in markup (`:root:has(...)`). `bottom-start` follows the start edge (the left, the right in right-to-left); `top-end` sits under the platform bar (`--ferrum-bar-height`, else `--topbar-h`, plus 8px). A stack that moves does not play its entrance animation again (it runs for a toast being added; `top-end` enters from above). **A phone (up to 600px) always keeps notices at the top, under the bar, whatever is asked:** a bottom corner would sit under the on-screen keyboard, and the page's bottom bar is already above it; the placement rules are for wider screens (gallery "Toast and confirm", `evidence/kit-followups/after/toast-*.png`).

**Where overlays are drawn** (`src/lib/portal.tsx`). A menu, select, popover, tooltip, hover card or context menu is portaled by Radix; to the end of `<body>` that is outside every landmark (axe `region`, measured on the gallery) and, from inside the kit's native `<dialog>` (a top-layer modal), outside the dialog, so the menu was drawn dimmed under the backdrop and could not be pressed. Every primitive's content now draws into `usePortalContainer()`: the open `Dialog` around it (the kit's `Dialog` provides itself through `PortalContainer`), else one page-wide root (`<div data-portal-root>`, last in `<body>`, no stacking context of its own, so z-index, clipping, scroll lock and focus are as they were) that is `role="region"` named "Menus and pop-ups" only while it holds something, and keeps out of the `aria-hidden` a modal Radix layer puts on its siblings. Callers need nothing; pass `container={element}` to a primitive's content to draw elsewhere. Radix dialogs and sheets are `role="dialog"` regions of their own and are not moved. Open menus still make axe report `aria-hidden-focus` and `page-has-heading-one`: that is Radix hiding the page behind a modal menu (focus is trapped in it), not the root.

**A confirm over another layer.** `confirmDialog` and `Dialog` are native modal `<dialog>`s: over another kit dialog the one below is inert, there is one `aria-modal` dialog in the accessibility tree, focus moves into the question and returns to the control that opened it, and Escape closes only the top one (measured with the browser's accessibility tree, gallery "Confirm over a dialog"). Over a Radix sheet or dialog two things were wrong and are fixed in `Dialog`: the layer below put `aria-hidden="true"` on the confirm's `<dialog>` (hidden from assistive technology and from role locators: `getByRole("button", { name: "Clear" })` found nothing, which is what Mail saw as "hard to reach"), and its document-level Escape closed the sheet instead of the question. An app needs no scoped click or extra handling.

## Toolbar and swatch palette

When: a row of tools over editable content (a document's formatting bar, a message editor's). The kit has no editor in it: `Toolbar`, `ToolbarGroup`, `ToolbarButton`, `ToolbarSeparator`, `ToolbarOverflow` and `SwatchPalette` take `pressed`, `onPress`, the colour and a change handler, and the app wires them to its editor (Docs and Mail each wrote these three things before: one tab stop with arrow keys, overflow into "More", a colour grid, a tool button with a pressed state and a shortcut tooltip).

```tsx
import { Toolbar, ToolbarGroup, ToolbarButton, SwatchPalette, rememberColor } from "@ferrum/kit";
<Toolbar label={t("Formatting")} onEscape={() => editor.commands.focus()}>
  <ToolbarGroup id="marks" keep>
    <ToolbarButton label={t("Bold")} shortcut="Mod-b" icon={<Bold />} pressed={s.bold} onPress={() => run().toggleBold().run()} />
  </ToolbarGroup>
  <ToolbarGroup id="lists">…</ToolbarGroup>
</Toolbar>
<SwatchPalette label={t("Text colour")} swatches={table} value={colour} noneLabel={t("Automatic")} recent={recent} onChange={(c) => { setColour(c); if (c) setRecent(rememberColor(recent, c)); }} />
```

`Toolbar`: `role="toolbar"`, one tab stop (the control last used, else the first); the arrows, Home and End move along it (the start arrow goes back, flipped right to left; in a text field the arrows move the caret until it is at the edge); Escape calls `onEscape`; keys that come from a popover or dialog React bubbles through it are left alone. Groups that do not fit go to a "More" popover, last first, by measured width (the same `foldActions` as `SelectionToolbar`, so at most two `keep` groups; a hidden copy is measured before paint and by a `ResizeObserver`: no shift); `scrollBelow={720}` keeps every group and scrolls the row (`scroll-cue`) under that width, as a phone's does. Groups are divided by the toolbar itself; `ToolbarSeparator` divides inside a group. `ToolbarButton`: a ghost icon button, `aria-pressed` only when `pressed` is given (the fill and a mark under it, colour is not the only signal), `aria-keyshortcuts`, a tooltip with the label and the shortcut written for the platform (`Mod-Shift-z` as "Ctrl+Shift+Z" or "⌘⇧Z"), and it does not take the caret from the text when pressed (`mousedown` is cancelled).

`SwatchPalette`: "Automatic" or "None" (`noneLabel`), a grid of the caller's `swatches` (`{ color, label }`, `columns` wide, 10 by default; colours are data a document owns, not tokens), one tab stop over the grid (on the colour in use), the arrows move over it by a cell or a row, Home and End jump; the recent colours as a second grid (the caller keeps them: `rememberColor(recent, colour)`); a custom value checked by `normalizeColor` (`#1F4E79`, `1f4e79` and `#fa0` are colours; alpha is dropped, a fully transparent value, a word or a wrong length is refused with a message and `aria-invalid`). It is controlled and holds nothing.

Not in the kit: the editor, what a button does, the colour table, where recents are stored. Measured on the gallery ("Toolbar and swatch palette") at 720 (all twelve controls), 420 (the lists group folds) and 260 (align folds too, the `keep` marks stay), light, dark and right to left, and with axe (`evidence/kit-followups/after/toolbar-*.png`).

## Generic reports

`ReportView` (`/…/r/<name>`) draws any report the server describes, with the discipline of a financial statement and only from what the data says: `_indent` (tree depth, 1.25rem a level), `_bold` (a group, subtotal or total: weight 600 and a single rule above, never a fill) and the `totals` row (a rule above, a double rule under). The table scrolls inside `.report-frame` so the head and the first column (what a row is) stay in view on a wide report. A figure whose own value is zero is faint, one with a minus in front is `--danger` (the text is shown exactly as the server sent it); figures are tabular, end-aligned and isolated so a minus stays in front in right-to-left. What was run (the company, currency and period the report states as text) is one quiet line under the title, followed by when; figures and ticks the report states stay in the summary above the table. No row kind is ever inferred from a word.

## Chips

`.chip` is a general pill: a filter, a tag, a toggle. It is a button, a link or a span; its content is centred whatever the children (text, icon, count); it wraps inside `.chips`. Hover is `--primary-soft` with accent text; pressed (`aria-pressed="true"`) is the accent fill, and a pressed chip that is hovered goes to `--primary-hover` with the same text, so it stays legible. The list filter's own token (field, value, remove button) is `.chip.chip-field`. The same hover-over-selected check holds for the segmented control, tabs, nav items, table rows and the toggle (pressed is the selection fill, hover does not change it).

## Printing

`@media print` (end of `src/styles.css`) prints a page as its content: the sidebar, bar offset, banners, toasts, tab lists, toolbars, filters, parameters, peek panel, row actions and "Add row" controls are hidden; `main` is the full page width; nothing is sticky or clipped (tables print whole, every row unbroken, headers and footers repeat); the colour scheme is forced to light whatever the theme, so text is dark on white; links are not underlined or coloured; controls print as plain boxes without arrows. The platform's own bar is hidden by the platform; the kit reserves no space for it. A record prints as a document: `@page` margin 14mm (only a real print or `page.pdf()` shows it; `emulateMedia` screenshots do not), the form card has no frame or padding, advisory alerts (not errors), collapsed sections (header included), link-out icons (`.combo-actions`), menus and empty child tables with their label are hidden, and an open section prints its heading without a chevron. A document leaves out what has no value: an optional field with nothing in it (editable or read-only; `print-blank` from `FormView`, plus `field-empty`) and an optional table with no rows are not printed, nor a section left with nothing; a required field stays, empty, so the gap is seen; table columns always stay. One record prints one date style: every date and moment is printed from `formatValue` in the person's locale (`PrintValue` in `widgets.tsx` sits beside the browser's date box, which is hidden in print), so a draft and a submitted record read alike. The print scale is a document's: 11pt body, 8px between field rows, 12px between sections, 3px table cell padding, so a record with a line or two fits one page with its totals (A4 and Letter); when it does not, the totals block carries the table's last rows with it (`break-before: avoid` on the totals section, `break-after: avoid` on a table's last row) and never moves alone. Checked by `page.pdf()` on a record, a list, a report and a long ledger (`evidence/integration-after/print-*.pdf`), and for this rule on the sales order and invoice at A4, Letter and a deliberately short page (`evidence/kit-tuning/after/print`).

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

Narrow bars: pass the actions as `actions={[{ id, label, icon?, onSelect, danger?, disabled?, title?, priority? }]}` and the bar folds them by measured width (`foldActions`, pure, in `src/ui/selectionFold.ts`): the count, Clear (an icon on a phone, its words kept for readers) and as many actions as fit stay, in the order given; the rest are the items of one "More" menu (the kit's own `Menu`, so the page's first load carries no Radix menu for it: Tab reaches the button, arrows the items, Escape returns to the button; on a phone it opens upward from the bar; a disabled action stays in it and says why). Mark one or two `priority` (Delete, the main action) and they are the last to fold; the first action that does not fit folds with every one after it, so a short later action never jumps ahead. A hidden copy of the actions and the More button (`aria-hidden`, `inert`, fixed and invisible) is measured in a layout effect before paint and by a `ResizeObserver` after, so there is no shift while measuring, and it works the same right to left. Children stay as before (drawn as given, never folded, so a caller whose actions are one component of its own keeps its own phone layout); move to `actions` to get the governed behaviour. Measured on the gallery at 390 (Delete and More), 600 (Archive, Assign to, Delete and More) and 1440 (all six), light, dark and right to left (`evidence/kit-followups/after/selection-*.png`).

Accessibility: `role="toolbar"` with the caller's `aria-label`. There is no arrow-key roving between its buttons (BulkBar has none); each is a tab stop. Focus return after the bar unmounts is the caller's (BulkBar returns it to the list).

Do not: say "All" when the count is a capped fetch; put destructive actions without confirmation; hide the count.

## Work home

An app's own home page answers "what needs me now?" for a person in a role. Use it for a landing page made of queues of work (contracts by stage, open incidents, today's trips) and tiles of things with a live state (tables, rooms, units). Not for dashboards of figures and charts (those are cards and `FilterBar`), nor for a list of records (the records list).

Anatomy, top to bottom, all from `@ferrum/kit`:

1. **`PageHead`** (the same component as `PageHeader`): `title` (the page's one `h1`, in the person's words: "Contracts", "The floor"), `description` (one quiet line built from numbers the page already has; leave it out rather than invent), `actions` at the end, `back` ({ to, label }) for a way up. The one main action is a primary `ButtonLink` with `icon="plus"` where it creates something; other actions are default buttons; more than three fold into a `Menu`. A bare text link is never an action. A date or site selector that scopes the page goes in `actions` as a small control with a visible label.
2. **What needs attention first**: a `Queue tone="attention"` for what is overdue or blocking, before the others, only when there is something.
3. **`QueueGrid`** of **`Queue`s**; each holds up to the app's limit of **`QueueItem`s** (default 5) and `more` for the rest.
4. **`TileGrid`** of **`Tile`s** for a small set of things with a live state.
5. First use (every queue empty and no records at all): one `StatePanel kind="empty"` with the main action under the head, not a row of zeros. Setup needed: a `StatePanel` with the action, under the head. Loading: `HomeSkeleton`; failure: `LoadFailed`; both under the `PageHead`, whose title needs no data.

Exports and props (all from `@ferrum/kit`; every prop is optional unless shown):

| Name | Props |
|---|---|
| `PageHead` | `title`, `description`, `actions`, `back: { to; label }`, `eyebrow` (a trail above the title) |
| `ButtonLink` | exactly one of `to` (a path in this app's router) or `href` (a destination outside it, e.g. another app's page: a plain anchor); `variant: "default" \| "primary" \| "ghost"`, `size: "sm" \| "md"`, `icon`, `download` (`true` or the file name), `target`, `rel` (with `target="_blank"` and no `rel`, `noopener noreferrer` is added), `children`. `download`, `target` and `rel` reach the anchor in both forms: a dataset link keeps `download`, an external link keeps its new tab. Both `to` and `href`: `to` wins; neither: nothing is drawn (both log an error). |
| `PageSplit` | `main`, `aside` (both required), `className`: a main column and a side column (about 2:1, the side 280 to 400px), one column under 900px with the main first; for a feed with its spaces, an overview with its side facts. The aside is a plain `div`, not a landmark. |
| `PageStack` | `gap: "md" \| "lg"` (16 / 24px between sections; the head is always 16px above the first), `className`, `children` |
| `QueueGrid` | `columns: 1` (a page that is one column of queues), `className`, `children` |
| `Queue` | `title` (required string: the section's name), `count`, `tone: "default" \| "attention"`, `link: { to; label }`, `empty` (default "Nothing waiting"), `more: { to; count }`, `progress: { value; max?; label?; tone? }`, `children` (`QueueItem`s) |
| `QueueItem` | `title` (required string), `to` (omit for a plain row), `meta`, `lead`, `trailing`, `action` |
| `TileGrid` | `min: "sm" \| "md" \| "lg"` (narrowest tile 200 / 280 / 360px), `label` (names the list), `className`, `children` |
| `Tile` | `title` (required), `to`, `meta` (one or two `span` lines), `figures: { label; value: ReactNode }[]`, `progress: { value; max?; label; tone? }` (label required), `status` |
| `HomeSection` | `title` (required), `count`, `link: { to; label }`, `actions` (buttons), `empty` (one quiet line when there are no children), `children` |
| `StatGrid` | `min: "sm" \| "md" \| "lg"` (narrowest stat 11 / 15 / 20rem; `lg` for figures like "1,676,650.75"), `className`, `children` |
| `Stat` | `label`, `value` (required), `hint`, `to`, `tone: "attention" \| "danger"`, `progress: { value; max?; label?; tone? }` |
| `Progress` | `value`, `max` (default 100), `label` (required: the accessible name), `tone: "default" \| "good" \| "attention" \| "danger"` |
| `HomeSkeleton` | `queues` (default 3), `className` |
| `Tone` (type) | `"neutral" \| "blue" \| "green" \| "amber" \| "red" \| "purple"`, for tone maps |

`lead`, `trailing` or `action`? **`lead`** is what the row is about in a column before the name: a time (09:30), a room number, a thumbnail (`<img>`, drawn 40px square, `object-fit: cover`); it sits in a fixed 3rem column with tabular numerals so leads align down the queue; keep it short. **`trailing`** is a state: a badge or mark, read, not pressed. **`action`** is what the person does to the row: a small `Button` or link ("Check in", "Apply"); it takes the click above the row link and comes after it in the keyboard order. If the row has no page to open, leave `to` out: it is a plain row (no hover, no link) and the action is the point. A string `meta` is also the row's tooltip, and takes two lines on a phone.

`Progress`, `Stat` and `Tile` meters: use the `Progress` export, never a hand-drawn bar (`.ast-tile` meter, `.trip-meter`). It needs no class: a block as wide as its container, 6px high, filling from the reading start. Place it by putting it in the parent's layout (a `Tile`'s or `Stat`'s or `Queue`'s `progress` prop, which adds the percentage at the end for `Queue` only: a `Stat`'s value is its figure, so its bar prints no percentage and keeps its accessible name (default: the stat's label) and value, or as a child of a `HomeSection` or any flex or grid cell). Name it for what it measures ("Key results done"), not "progress".

`progress.tone` is the same as `Progress`'s (`good`, `attention`, `danger`), on `Tile`, `Queue` and `Stat`.

A money or count value at a row's end goes in `trailing` as plain tabular text (`<span className="num">₹4,200.00</span>`), not in a badge: a badge is for a state. A `meta` that is a node wraps onto a second line on a phone like a string does.

`Stat` rules: one number a person should see first ("Applicants waiting 4"), in the text colour, `text-2xl` semibold, tabular. A zero, an empty value or a dash is quiet (muted, regular weight): nothing needs you. Never colour a number by default; `tone` is for a number that is itself a warning (overdue 3). The whole stat is a link when `to` is given. Pass money and dates already formatted. A value never breaks inside a number: if it does not fit it steps down one type role (and on a phone it starts a role smaller), then is cut with an ellipsis. `Stat` replaces the Assets `.ast-tile`, including the slim bar under "Depreciated 16%" (`progress`).

`HomeSection` is for a labelled group that is not a queue (a `TileGrid` per property, a `StatGrid`, a table, "What posts did" with two header buttons in `actions`); a `TileGrid`'s own `label` stays for a grid that only needs an accessible name. A tile's `status` may be a long phrase or several badges: they wrap onto a second line. `figures` (Worth, Certified, Held) are label at the start, value at the end; give a tile at most three.

`PageStack`'s track is `minmax(0, 1fr)`, so a wide child (a table, a long card) cannot push the page wider than the screen: no `min-w-0` on each section.

`PageStack` or `.page-head`'s own margin? Seventeen screens use `.page-head` and space themselves with its 16px bottom margin, so that stays as it is. `PageStack` (a grid, `gap` 16 or 24) is the one way to space a work home: inside it the head's margin is cancelled so the head never stacks a second gap. Do not wrap content in `grid gap-4`.

Queue grid: tracks are 300px at least, so a lone queue keeps one track's width instead of stretching; four queues use 400px tracks so they sit 2x2 where three and one would otherwise. Five stay 3+2; seven leave a last orphan (no clean CSS-only rule), so cap or group them.

Touch: on a coarse pointer everything a person presses is 44px: buttons, icon buttons, tabs, chips, menu and select items, each `.segmented` button (the frame is 50 with its border), the shadcn `xs` buttons, a 16px checkbox or radio and a 32x16 switch (their look stays; a transparent 44px hit area is drawn around them), the fold button of an empty run and the header link of a `HomeSection`. Read-only value fields are not pressed and stay 24px. Dense desktop sizes do not change.

File input: `<input type="file" className="input">` (or bare inside `Field`) is drawn in the control's frame with its selector as the default small button, in both themes, right to left, disabled and focused; no script.

Behaviour you get without asking: a queue is a `section` named by its heading, its rows are a list, the whole row is one link (focus ring on the row), the count is a quiet counter outside the heading (so the name is read once) with tabular numerals, an empty queue keeps its header and count 0 and is one row high, queues in a grid keep their tops aligned and fall to one column at 390, rows are 52px (44 compact), touch targets stay at 44px, an attention queue gets a warning edge and counter, logical properties throughout (RTL), tokens only, no motion.

Do:
- Put the count in `count`, never in the title: if a catalog string was "Active ({length})", use "Active".
- Pass `title` as a string, and cap the rows yourself (`slice(0, 5)`) with `more={{ to, count: total - 5 }}`.
- Keep a status's tone from its stored id (`StatusBadge`, `tones`), and keep severity or priority marks as they were.

Don't:
- Wrap queues in `card card-pad` or write `np-page` / `np-columns` again; stretch a badge across a row; make a tall hollow box for nothing; show "(0)" in a title; use a bare text link as the page's action; put an interactive control in `trailing`.

A typical home (Contracts), about twenty lines:

```tsx
export function Home() {
  const q = useQuery(homeQuery);
  const head = <PageHead title={t("Contracts")} actions={<ButtonLink to="/e/Contract/new" variant="primary" icon="plus">{t("New contract")}</ButtonLink>} />;
  if (q.isPending) return <><PageHead title={t("Contracts")} /><HomeSkeleton /></>;
  if (q.isError) return <>{head}<LoadFailed error={q.error} onRetry={() => void q.refetch()} /></>;
  const { contracts, obligations } = q.data;
  const notice = contracts.filter((c) => c.notice_due);
  const row = (c: Row) => <QueueItem key={c.id} to={`/e/Contract/${c.id}`} title={String(c.title)} meta={String(c.counterparty_name)} trailing={<Badge>{String(c.status)}</Badge>} />;
  return (
    <>
      <PageHead title={t("Contracts")} description={t("{n} notice due", { n: notice.length })} actions={<ButtonLink to="/e/Contract/new" variant="primary" icon="plus">{t("New contract")}</ButtonLink>} />
      <QueueGrid>
        {notice.length > 0 && <Queue title={t("Notice due before renewal")} count={notice.length} tone="attention">{notice.slice(0, 5).map(row)}</Queue>}
        {byStage(contracts).map(([stage, list]) => (
          <Queue key={stage} title={stage} count={list.length} more={{ to: "/e/Contract", count: list.length - 5 }}>{list.slice(0, 5).map(row)}</Queue>
        ))}
      </QueueGrid>
    </>
  );
}
```

The same home compiles and runs in `src/ui/home.test.tsx`; the gallery's "Work home" section shows a normal home, an empty one, one with an attention queue, tiles and the skeleton.

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
- **TransferTray**: uploads and downloads in flight, with retry. Drive it from Drive's upload flow. A transfer an app runs itself goes in the bar's tray through `shell().uploads.track({ label, size, cancel?, retry? })` (the handle reports `progress`, `retrying`, `sending`, `done`, `fail`; calls after `done` or `fail` do nothing); an app does not draw its own upload panel. Where the bar cannot track (no shell, a server older than the call) `uploads.canTrack` is false and `track` resolves to a handle that does nothing, so the app keeps its own panel on those servers only.
- **AppHeader / ViewToolbar** as distinct components: today `PageHeader` and each app's own toolbar. Drive them from the ERP list header and Mail's toolbar.
- **StaleBanner**: no real consumer found; use `Alert` with a refresh action until one appears.

## Scrolling rows

A row that scrolls sideways inside its frame (`.tabs`, `.segmented`, the family navigation, the document toolbar, anything given `.scroll-cue`, and `.table-wrap`) fades the edge that has more beyond: 44px (`--edge-cue`), reaching nothing at the edge so a cut-off label reads as "continues", mirrored in right-to-left. Which edges have more is a state, not motion: `watchEdges()` (`packages/client/src/edgeCue.ts`, started by the bootstrap every app loads) sets `data-more="end"` (at rest), `"both"` or `"start"` (scrolled to the end) from the scroll position and removes it when the row fits, and `src/styles.css` draws the mask from it. It was a scroll-driven animation until 12 Nov 2026; that cue did not survive a screenshot that disables animations (the animation is finished or cancelled: measured on Chrome 157), which is how reviewers saw "cut at the edge with no cue", and Firefox has no scroll timelines. Reduced motion does not matter to it. The fade steps aside while an item inside has keyboard focus, so a focus ring is never dimmed. A new scrolling row adds `scroll-cue`; the row itself stays focusable or holds focusable items, so the keyboard reaches what is cut off.

## Labels and direction

`.btn` sets `unicode-bidi: plaintext`: each label takes its direction from its own first strong letter, so an untranslated Latin label ending in punctuation ("What is in a bin?") reads correctly in a right-to-left page, while the button's own layout (icon on the start side) still follows the page direction.
