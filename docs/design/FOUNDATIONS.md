# Design foundations

The visual rules every screen and component builds on. `src/index.css` is the single source of every value; this page says what each token is for and what holds it to account (`src/tokens.test.ts`). It does not restate hex values.

## Direction

Precise and calm. One interaction accent (`--primary`); everything else is neutral. Status colours (success, warning, danger, purple) keep their meaning in every theme and are never used as decoration. Hierarchy comes from size, weight and spacing, not from low contrast: secondary text is still readable text.

## Root scale

`html` is `87.5%`, which is 14px at the browser's default and follows the user's font-size setting. All type and geometry tokens are written in rem as `calc(N / 14 * 1rem)`, so they equal N px at the default root and scale with it. Body text is `1rem` with a line height of 20/14.

## Type roles

The roles are Tailwind's `text-*` scale, redefined once in `src/index.css` (`@theme static`). There is no separate type vocabulary. Hand-written CSS uses the same values as `var(--text-xs)` and so on. Nothing renders below 12px.

| Utility | Role | Size / line height (px at default root) |
|---|---|---|
| `text-xs` | caption | 12 / 16 |
| `text-sm` | compact UI | 13 / 18 |
| `text-base` | standard UI | 14 / 20 |
| `text-lg` | reading, message body | 16 / 24 |
| `text-xl` | section heading | 18 / 24 |
| `text-2xl` | page heading | 24 / 32 |

Larger steps stay at Tailwind's defaults. Do not write `text-[Npx]`; pick a role.

## Colour roles

| Token | Purpose |
|---|---|
| `--bg` | page background |
| `--surface` | cards, panels, popovers, inputs |
| `--surface-2` | recessed or hovered areas, table headers |
| `--surface-3` | pressed states, strong fills (text must still pass on it) |
| `--text` | primary text |
| `--muted-foreground` | secondary text |
| `--faint` | tertiary labels; it sits close to `--muted-foreground` on purpose |
| `--border`, `--border-strong` | decorative separators: dividers, card edges. Not the boundary of a control |
| `--border-control` | the essential boundary of form controls (shadcn alias `--input` points at it), at least 3:1 |
| `--primary`, `--primary-hover`, `--primary-text` | the accent as a fill, its hover, and text on it. `--primary` is also accent text on surfaces |
| `--primary-soft` | selected surface; `--primary` text must pass on it |
| `--success`, `--warning`, `--danger`, `--purple` | status text and icons; each has a `-soft` background they must pass on. `--danger-hover` for destructive buttons |
| `--focus-ring` | the focus box-shadow; its blended colour is held to 3:1 |
| `--chart-1` to `--chart-8` | data series, 3:1 on `--surface` |

The shadcn names (`--background`, `--card`, `--input`, `--ring`, `--sidebar-*`...) are aliases of these tokens; change the token, not the alias.

### Measured contrast

`src/tokens.test.ts` resolves `light-dark()` and `var()` in `src/index.css` for light, dark, and each under `data-contrast="more"`, and fails with the pair, theme and ratio. Required minimums: text, secondary text, faint, accent text, status text, `--primary-text` on the accent: 4.5. Control borders, focus ring, chart series: 3. In high contrast `--text` on surfaces: 7, `--border-strong`: 3. Lowest measured value per pair across the three base surfaces (light / dark):

| Pair | Minimum | Light | Dark |
|---|---|---|---|
| `--text` on surfaces | 4.5 | 12.68 (on `--surface-3`) | 11.23 (on `--surface-3`) |
| `--muted-foreground` on surfaces | 4.5 | 5.43 | 7.75 |
| `--faint` on surfaces | 4.5 | 4.84 | 6.62 |
| `--primary` on surface, bg, soft | 4.5 | 5.25 | 5.96 |
| `--primary-text` on `--primary` / hover | 4.5 | 6.08 | 8.71 |
| `--success` on soft / surface | 4.5 | 5.52 | 7.92 |
| `--warning` on soft / surface | 4.5 | 5.43 | 8.63 |
| `--danger` on soft / surface | 4.5 | 5.93 | 7.97 |
| `--purple` on soft / surface | 4.5 | 5.75 | 7.60 |
| `--border-control` on surfaces | 3 | 3.14 | 4.50 |
| focus ring on surface, bg | 3 | 3.49 | 5.84 |
| `--chart-1..8` on surface | 3 | 3.64 (`--chart-3`) | 6.17 (`--chart-5`) |
| high contrast: `--text` on surfaces | 7 | 19.59 | 18.59 |
| high contrast: `--border-strong` | 3 | 8.08 | 8.91 |

Before this change `--faint` was 3.11:1 on white (2.87:1 on the page) and the control border (`--input`, then `--border-strong`) 1.65:1.

## Geometry and density

| Token | Standard | Compact | Coarse pointer |
|---|---|---|---|
| `--control-h` | 36px | 32px | 44px |
| `--control-h-sm` | 28px | 28px | 36px |
| `--cell-py` | 8px | 6px | unchanged |

Radii: `--radius` 8px for panels, `--radius-sm` 6px for controls. Tailwind's mapping gives `rounded-sm` 4, `rounded-md` 6, `rounded-lg` 8, `rounded-xl` 12 (large dialogs). Density is `data-density="compact"` on `<html>`; touch targets are 44px whatever the density.

## Motion

`--duration-state` 100ms (hover, press), `--duration-overlay` 140ms (menus, dialogs), `--duration-panel` 180ms (sliding panels). All are 0ms under `prefers-reduced-motion: reduce`. A global rule in `src/styles.css` also cuts every animation and transition to 0.01ms there, so hand-written motion needs no extra handling.

## Focus

Keyboard focus is always visible: `:focus-visible` draws a 2px `--primary` outline, and components that use `--focus-ring` draw its 3px ring. Never remove focus styling without replacing it.

## Theming

- Every colour is defined once with `light-dark()`; `lib/theme.ts` writes `data-theme` (which pins `color-scheme`) and `data-contrast`.
- High contrast (`:root[data-contrast="more"]`) overrides text, borders, `--border-control` and the focus ring. New text tokens must be added to the test and to this block if they need it.
- A brand accent is set inline by `lib/theme.ts` (`--primary`, `--primary-hover`, `--primary-soft`, `--primary-text`, `--focus-ring`, `--chart-1`). It adjusts the colour until it passes 4.5:1 with its text and 3:1 on the dark surface; keep the constants in that file in step with `--surface` and `--primary-text` in dark mode.
- Fonts are the system stack (`--font`, `--mono`); no font files are shipped.

## What must not use UI tokens

Authored content keeps its own styling and must not follow the UI's theme, density, type roles or root scale: document bodies (the rich-text editor content), print and PDF templates, slide and spreadsheet content, anything exported. Their sizes belong to the document, not to the interface. None of the hand-written CSS swept for the type roles was of this kind.

## Deferred

- Root at 100%: moving `html` from 87.5% to 100% changes every rem value and needs a separate rem and geometry audit (Tailwind spacing, fixed px, icon sizes).
- Geist (or another webfont): needs licensed self-hosted files, a review of script fallback for non-Latin languages, and a check against the bundle budgets.
- `src/ui/kit.tsx`, `src/components/ui/*` and `packages/build/*` still use their own sizes and heights (for example `text-[0.8rem]` in `components/ui/calendar.tsx`); moving them to the roles and `--control-h` is the next step.
- Legacy CSS that keeps px sizes on purpose: `.page-title` at 20px (between the section and page heading roles), the fluid `clamp()` heading in `apps/shell/src/shell.css`, grid cell controls at 32px, and the 44px touch overrides in the narrow-screen block of `src/styles.css`.
- Inline `fontSize` in TSX (`app/Shell.tsx`, `app/Collab.tsx`, SVG chart labels at 9 to 11) is not covered by the class sweep.
