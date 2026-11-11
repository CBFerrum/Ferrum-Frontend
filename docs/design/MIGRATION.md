# Migrating to one component contract

Kit components (`src/ui/kit.tsx`), the legacy class names (`src/styles.css`) and the shadcn primitives (`src/components/ui/*`, `@ferrum/kit/primitives`) now render the same controls from the same tokens. This page is the map, what moved, and how to roll back.

## What to use

1. New code: kit components first (`Button`, `Badge`, `StatusBadge`, `Field`, `Dialog`...).
2. To compose something the kit lacks: the primitives.
3. The legacy class names (`.btn`, `.icon-btn`, `.input`, `.select`, `.textarea`, `.badge`, `.tab`, `.dialog`) stay for existing screens and selectors. Do not write them into new code; they are not going away in this release.

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
| kit `Badge tone` / `.badge-*` | `Badge variant` | both 22px high, 12px, weight 600. Tones (`neutral blue green amber red purple`) are the kit's; the primitive's variants are `default secondary destructive outline` |
| kit `Dialog` / `.dialog` | `Dialog`, `AlertDialog`, `Sheet`, `Drawer` | 12px radius, 16px padding, `text-xl` title, footer right-aligned, 8px gap, secondary action first and the primary last |

One rule for both implementations: text is `text-base` (14px), `text-sm` (13px) for `sm`; weight 500; radius 6px; gap 6px; side padding 12px (10px for `sm`, 8px for `xs`); hover `--surface-2`, pressed `--surface-3` (filled accent: `--primary-hover`); disabled opacity 0.5; transition `var(--duration-state)`; focus a 2px `--ring` outline with 2px offset (an outline, so forced-colors mode keeps it). On touch screens both are at least 44px.

## Geometry, old to new (px at the default root)

"Old" is before the tokens slice (`git show HEAD~3:src/styles.css`, and Tailwind's 3.5px unit for the primitives); the legacy classes were then raised to `--control-h` 36 by the tokens slice. Standard density.

| Control | Legacy before | Primitive before | Now (both) |
|---|---|---|---|
| Button default / md | 34 | 31.5 | 36 (compact 32, touch 44) |
| Button sm | 28 | 28 | 32 (touch 44) |
| Button xs | none | 21 | 24 |
| Button lg | none | 35 | 40 (touch 44) |
| Icon button / sm | 32 / 26 | 31.5 / 28 | 36 / 32 |
| Input, select trigger | 34 | 31.5 | 36 |
| Textarea min height | 72 | 56 | 72 |
| Toggle default / sm | none | 31.5 / 28 | 36 / 32 |
| Tab list (primitive) | none | 31.5 | 36 |
| Badge | 22 | auto (about 20) | 22 |
| Dialog radius / padding | 12 / 16 | 7 / 21 | 12 / 16 |
| Dialog title | 16px, weight 650 | 16px | 18px, weight 600 |
| Button side padding | 12 / 9 (sm) | 14 / 10.5 (sm) | 12 / 10 (sm) |
| Input side padding | 10 | 10.5 | 10 |

`--control-h-sm` is 32px (36 on touch), it was 28.

## The spacing unit

Tailwind's spacing unit was `0.25rem`, which is 3.5px under the 87.5% root, so every `h-9`, `p-4`, `gap-2` was 12.5% smaller than written. `--spacing` is now `calc(4 / 14 * 1rem)` (`src/index.css`, in the `@theme static` block). An app that rebuilds against this kit sees everything that is Tailwind-spaced grow by 14.3% (`p-4` 14 to 16px, `h-9` 31.5 to 36, `w-72` 252 to 288). Fixed sizes written in `rem`, `px` or tokens do not move (sidebar width, the topbar, grid templates like `minmax(18rem, ...)`). Type changes are those in FOUNDATIONS.md (type roles). The collapsed sidebar rail changed from `3rem` to 48px so the 32px menu button fits inside its padding.

## Status colour

`statusTone(value, tones?)` no longer reads words. A `tones` record of exact stored state ids wins; otherwise a whole, case-insensitive match in `src/lib/statusTones.ts`; anything else is `neutral`. `<StatusBadge value tones? label? />` is the badge. Documents use `docstatusTone(0|1|2)` (neutral, green, red).

What turns neutral: every value outside the table, so "Not approved" and "Not verified" (were green), "Scheduled", "Held", "Locked", "Returned", "Inactive" (were blue, amber or red), any translated text and anything unfamiliar (was blue). Of the 187 distinct status/state option values in the packages, 80 are in the table (9 of them explicitly neutral) and 107 are neutral by default.

Follow-up (server, not in this repository): a per-option tone in field metadata (`options: [{value: Open, tone: neutral}]`) is the long-term owner. Pass it as `tones` once the platform sends it, and shrink the built-in table.

## Rollback

- Spacing unit: delete the `--spacing: calc(4 / 14 * 1rem);` line in `src/index.css` (Tailwind's default returns). Also restore `--control-h-sm` to `calc(28 / 14 * 1rem)` and `SIDEBAR_WIDTH_ICON` to `"3rem"` in `src/components/ui/sidebar.tsx`.
- Type scale: delete the `--text-*` lines in the `@theme static` block of `src/index.css`.
- Palette: revert the colour tokens in `:root` of `src/index.css` (`src/tokens.test.ts` shows which pairs then fail).
