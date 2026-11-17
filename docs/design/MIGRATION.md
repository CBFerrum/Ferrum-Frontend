# Migrating to one component contract

Kit components (`src/ui/kit.tsx`), the legacy class names (`src/styles.css`) and the shadcn primitives (`src/components/ui/*`, `@ferrum/kit/primitives`) now render the same controls from the same tokens. This page is the map between them.

## What to use

1. New code: kit components first (`Button`, `Badge`, `StatusBadge`, `Field`, `Dialog`...).
2. To compose something the kit lacks: the primitives.
3. The legacy class names (`.btn`, `.icon-btn`, `.input`, `.select`, `.textarea`, `.badge`, `.tab`, `.dialog`) stay for existing screens and selectors. Do not write them into new code.

## The map

| Legacy / kit | Primitive | Notes |
|---|---|---|
| kit `Button variant="primary"` / `.btn-primary` | `Button variant="default"` | filled accent, hover `--primary-hover` |
| kit `Button` default / `.btn` | `Button variant="outline"` | `--surface`, `--border-strong` border |
| kit `Button variant="ghost"` / `.btn-ghost` | `Button variant="ghost"` | |
| kit `Button variant="danger"` / `.btn-danger` | none | outlined red: a low-emphasis destructive action in a toolbar or row |
| none | `Button variant="destructive"` | filled red: the confirming button of a destructive dialog (`AlertDialogAction`) |
| none | `variant="secondary"`, `"link"` | unchanged |
| kit `size="md"` / `size="sm"` | `size="default"` / `"sm"` | 36 / 32px; `xs` (24px, primitives only) and `lg` (40px) have no kit twin |
| `.icon-btn`, `.icon-btn-sm` | `Button size="icon"`, `"icon-sm"` | square at the control heights |
| `.input`, `.select`, `.textarea` | `Input`, `SelectTrigger`, `Textarea` | `--border-control` border, `--surface` fill, 10px side padding |
| kit `Badge tone` / `.badge-*` | `Badge variant` | both 22px high and 12px. Tones (`neutral blue green amber red purple`) are the kit's; the primitive's variants are `default secondary destructive outline ghost link` |
| kit `Dialog` / `.dialog` | `Dialog`, `AlertDialog`, `Sheet` | 12px radius, 16px padding, `text-xl` title, footer right-aligned, 8px gap, secondary action first and the primary last |

One rule for both implementations: text is `text-base` (14px), `text-sm` (13px) for `sm`; weight 500; radius 6px; gap 6px; side padding 12px (10px for `sm`, 8px for `xs`); hover `--surface-2`, pressed `--surface-3` (filled accent: `--primary-hover`); disabled opacity 0.5; transition `var(--duration-state)`; focus a 2px `--ring` outline with 2px offset (an outline, so forced-colors mode keeps it). On touch screens both are at least 44px.

## A home copied from the `np-page` template

If an app's home is `<div className="np-page">` with `<header className="row">`, an `h2`, a text `Link` for the main action, `section.card.card-pad` with `<h3>Title (N)</h3>` and `<ul className="stack">` rows with a `Badge` after each link: replace it with `PageHead` (title as the `h1`, the action as a primary `ButtonLink icon="plus"`), a `QueueGrid` of `Queue`s (`count={list.length}`, no "(N)" in the title) and `QueueItem`s (the link's text as `title`, the counterparty and date as `meta`, the badge as `trailing`), `HomeSkeleton` for `ListSkeleton className="np-page"`, and delete `.np-page` and `.np-columns` from the app's `styles.css`. Queries, filters and routes stay as they are. See "Work home" in PATTERNS.md.

## Geometry (px at the default root)

Standard density.

| Control | Kit and primitive |
|---|---|
| Button default / md | 36 (compact 32, touch 44) |
| Button sm | 32 (touch 44) |
| Button xs | 24 |
| Button lg | 40 (touch 44) |
| Icon button / sm | 36 / 32 |
| Input, select trigger | 36 |
| Textarea min height | 72 |
| Toggle default / sm | 36 / 32 |
| Tab list (primitive) | 36 |
| Badge | 22 |
| Dialog radius / padding | 12 / 16 |
| Dialog title | 18px, weight 600 |
| Button side padding | 12 / 10 (sm) |
| Input side padding | 10 |

## Status colour

`statusTone(value, tones?)` never reads words. A `tones` record of exact stored state ids wins; otherwise a whole, case-insensitive match in `src/lib/statusTones.ts`; anything else is `neutral`. `<StatusBadge value tones? label? />` is the badge. Documents use `docstatusTone(0|1|2)` (neutral, green, red).

Every value outside the table is neutral: "Not approved", any translated text, anything unfamiliar.

The platform does not send a per-option tone in field metadata yet. When it does (`options: [{value: Open, tone: neutral}]`), pass it as `tones` and shrink the built-in table.
