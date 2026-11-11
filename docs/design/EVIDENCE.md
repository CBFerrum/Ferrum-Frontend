# Evidence

What was checked, how, and what was not. Evidence classes are kept apart: **source** (read in the code), **test** (a unit or component test in this repository), **browser** (a real page rendered in Chrome and measured or looked at), **human** (a person reviewed it). Nothing below has had a human design review, an assistive-technology session or a user study.

## Baseline (11 Nov 2026)

| Item | Value |
|---|---|
| Ferrum-Frontend | `e065883` (main; also the `FRONTEND_REV` the platform's Dockerfile pins). The audit this work started from named `e0658836…`: the same commit |
| Platform | main `88fb749`; the server used for captures is a local debug build of 10 Nov from a development branch, not a released image |
| Libraries | React 19.2.9, Vite 7.3.7, Tailwind 4.3.3, radix-ui 1.8.1, lucide-react 1.57.0, TipTap 3.32.0, Yjs 13.6.33, pdfjs-dist 6.4.299 |
| Editor engines (pinned in the platform's `deploy/editors/builds.txt`) | gridcraft 0.13.0, wordcraft 0.12.0, pdfcraft 0.15.0. The editors server was not running; no editor was opened |
| Workspace used | `demo` in a private copy of the local development database; signed in as its seeded administrator. Installed releases there: comms 0.12.0, drive 0.12.0, docs 0.6.0, erp 0.5.0, studio 0.2.0 |
| Before this work | `npm run typecheck` clean; 85 test files, 766 tests passing; shell entry 126.1 KB JS / 30.3 KB CSS, Studio 126.6 / 30.3 |

## The audit's findings, rechecked

| Finding | Recheck | Class | Now |
|---|---|---|---|
| Root is 14px and rem sizes shrink | True. `text-xs` rendered 10.5px (222 uses), `text-sm` 12.25px, `h-9` 31.5px; touch controls 38.5px, not 44 | source, browser | Root is `87.5%`; type roles 12/13/14/16/18/24; spacing unit a true 4px; touch 44px |
| `--faint` on small labels | True: 3.11:1 on white, 2.87:1 on the page | source, test | 4.84:1 or better in light, 6.62:1 in dark (`src/tokens.test.ts`) |
| Control boundary | New finding: `--input` was 1.65:1 on white | test | `--border-control`, 3.14:1 or better |
| Primitive focus ring | New finding: `ring-ring/50` blends to under 3:1 | source | One 2px outline at full strength, kept in forced colours |
| `statusTone()` guesses from English | True: "Not approved" and "Not verified" came out green, anything unknown blue | source, test | Exact state ids or the caller's map; anything else neutral (`src/ui/kit.test.tsx`) |
| Two Button contracts | True: 34px legacy, 31.5px primitive, different defaults | source, browser | Same height, radius, weight and focus; mapping in `MIGRATION.md`. Gallery measures both at 32/36px |
| Blank lazy fallbacks | True here (`Admin.tsx`, three in `Shell.tsx`) and in apps | source | Shaped skeletons; `blank-fallback` is a lint rule |
| Mixed control heights on one screen | Browser: a draft sales order rendered controls at 26, 28, 32, 34 and 40.5px | browser | See the app sections below |
| Text under 12px | Browser: 213 text nodes on Docs' home, 13 to 18 on ERP and Studio pages | browser | 0 on the shell, Studio and admin pages captured after |

## Captures

All in `ERP/uikit/evidence/` on the machine that did this work (not in the repository: they show a development workspace). Each folder has `captures.json` with route, role, viewport, theme, locale, the interface release that was served, and what the page measured (root size, font sizes in use, control heights). Chrome (installed channel) headless, 1440×900, device scale 1, `en-US`, UTC, reduced motion.

| Folder | What |
|---|---|
| `before/` | Shell home, Mail, Drive, Docs, Sheets, ERP (home, invoice list, a draft order, a new order), Helpdesk, CRM, Projects, Studio (home, a dashboard, a report), Administration; light and dark |
| `after/` | The pages this repository serves (shell home, Studio home, dashboard, report, Administration) on the new build; light and dark |
| `gallery/` | `npm run gallery` in light, dark, compact, high contrast (both themes) and right-to-left; measured |
| `before-<app>/`, `after-<app>/` | The reference apps, see below |

A browser measurement caught what no test did: the first build rendered a 16px root (the `font` shorthand on `html, body` reset it), so every control was 41px. Fixed, and a test now holds the cause.

## Checks run on `ui/kit-foundations`

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 90 files, 802 tests passing |
| `npm run lint:ui` | within its baseline (20 raw colours, 4 arbitrary text sizes left; no text under 12px, no blank fallback) |
| `npm run build:apps` | shell entry 138.7 KB JS / 30.4 KB CSS, Studio 137.0 / 30.4, of 200 / 50. The entry grew about 12 KB: the shell's dialogs now load behind the kit's skeletons and state panel |
| axe over the gallery (jsdom) | no violations in light theme. jsdom has no layout: it does not check contrast or focus order |

## Not done, and why

- **Human review.** The palette and type scale are the handoff's candidate, applied and measured; nobody has approved them as the final theme.
- **Assistive technology, keyboard walk-throughs, forced-colours and touch rendering.** Not run. The focus indicator is an outline, which forced colours keeps; that is source reasoning, not an observation.
- **Arabic and Hindi.** The new strings were translated by the implementer, not a native speaker. The gallery was captured right-to-left; app screens were not.
- **Mail's inbox, reader and composer.** The demo workspace has no hosted mail domain. See the Comms section.
- **Sheets, Slides and PDF editors.** The editors server was not running; only the host pages could be seen.
- **Metrics.** Not installed in the workspace; a Studio dashboard stood in as the dashboard reference.
- **Performance.** Only bundle sizes were measured. No rendering or interaction timing.
- **Geist.** Not evaluated: it needs licensed, self-hosted font files and a bundle-budget and script-fallback review. The system font stack stays.
- **The root at 100%.** Deferred; with the spacing unit and type roles explicit, what remains is rewriting the `calc(N / 14 * 1rem)` values.
- **The 58 acceptance scenarios** (`acceptance.json`) all still read `not_run`. This work produced evidence towards several (UX-001 baseline, the token, type, status and loading ones) but none was run as written, with its full evidence list.
- **Other apps.** 33 app interfaces still build against the old kit until each is rebuilt; nothing here changes them.

## Release and rollback

- Order: this repository first; then the platform's `FRONTEND_REV`; then each app rebuilds its `ui/` against the new revision and releases. An app keeps its old look until it is rebuilt, so the shell and an app can differ for a while; only the bar is shared, and its height did not change.
- An app adopts the lint with `cli.mjs lint --update-baseline`; without a baseline `check` only reports.
- Rollback is per line (`MIGRATION.md`): the spacing unit, the type scale and the palette each revert on their own.
- `statusTone` turns 107 of 187 known status values neutral that used to be guessed. The lasting owner is a per-option tone in the platform's field metadata; that server change is not made.
