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

## Reference apps (adopted on each app's `ui/kit-adoption` branch, not released)

Each was rebuilt against this branch, checked with `cli.mjs typecheck`, `test`, `build` and `check`, and looked at in the browser through the server's development override. "Before" is the release installed in the workspace; where that is older than the app's main, the pictures differ by more than this work.

| App | Tests | Entry JS / CSS | Lint before → after | Text under 12px | Control heights on the main screen |
|---|---|---|---|---|---|
| Drive (0.15.0 before and after) | 98 pass | 181.5 / 34.6 KB | 3 → 0, no exceptions | 1 → 0 | 17.5, 26, 28, 30, 34 → 18 (marks), 32, 36 |
| Docs (0.7.12 before) | 113 pass | 134.0 / 32.7 KB | 8 → 0; three exceptions, all white text on a collaborator's server-chosen colour | 213 → 0 on home, 2 → 0 in the editor | filters now the suite's select at 36 |
| ERP (older release before) | 94 pass | 140.2 / 33.4 KB | 1 → 0, no exceptions | 13 to 15 → 0 | 26, 28, 32, 34, 40.5 → 32, 36, 40 |
| Comms (source 0.12.0) | 61 pass | 124.3 / 32.6 KB | 6 → 0; two exceptions (LiveKit's own variable in `meet.css`; the stylesheet for authored mail inside its sandboxed frame) | Chat 4 → 0, a conversation 19 → 0, Calendar month 71 → 0 | Chat 21, 28, 31.5 → 24, 32, 36 |

What changed in each, beyond sizes: loading shows skeletons shaped like the content; empty, no matches (with one way to clear), denied (403), offline and failed are separate states; Docs shows the kit's `SaveStatus` and never "Saved" for work kept only in the browser; ERP passes explicit tone maps for invoice, order and bill states.

**Found by looking at ERP at full density, fixed in the kit** (`after-erp-kitfix/`, measured): the line-item table's class collided with Tailwind's `grid` utility, so headers did not sit over their columns (now `display: table`, header and first-row cells equal in left edge and width); phone cards dropped Rate and Amount; the link field's clear button covered its text; Home's module links looked like selected filters; the list bar had a third control height; a refused save did not say which fields (now lists them, and each moves focus: checked for Customer and Items); a list did not say whether it was empty or filtered to nothing; a hovered primary button lost its fill under white text (a specificity bug that was also on main).

**Mail was seen on fixture data only.** The workspace has no hosted mail domain, so the server shows "You have no mailbox here" (captured). The list, reader, composer and the empty, no-matches, failed, loading and locked states were rendered by a development-only page in the app (`ui/dev/mail-harness.tsx`, not part of the build) that mounts the real Mail page and answers its requests in the page. That shows layout and states, not behaviour against a mail server: sending, drafts surviving failure, and shortcuts while typing were not exercised and their logic was not changed. Looking at it found a long-standing overflow (a long sender pushed the time and star off the row), now fixed; open, unread, starred and keyboard-cursor rows are distinct in both themes. Meet's call screens need LiveKit, which was not running.

**Not seen or not done in the apps:** right-to-left; a read-only document; the bank workbench with data (the workspace has no bank account); ERP's portal pages; row-cell focus from the error summary (no such error could be produced); Drive's New menu capture opened a dialog instead. Drive's own bulk bar was left as it is rather than moved onto `SelectionToolbar`. ERP's metadata-driven field order on a draft order (many low-value fields at full weight around the totals) and its small status badges are noted in the backlog below, not changed.

## Checks run on `ui/kit-foundations`

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 91 files, 809 tests passing |
| `npm run lint:ui` | within its baseline (20 raw colours, 2 arbitrary text sizes left; no text under 12px, no blank fallback). The rule first read rem at 16px and missed 0.8rem text; it now reads it at the kit's 14px |
| `npm run build:apps` | shell entry 140.2 KB JS / 30.6 KB CSS, Studio 139.9 / 30.6, of 200 / 50. The entry grew about 14 KB: the shell's dialogs now load behind the kit's skeletons and state panel |
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

## Backlog

| Item | Owner | Done when |
|---|---|---|
| A tone per option in field metadata, so status colour is declared with the state | Platform (entity metadata) | `StatusBadge` reads it; the fallback table in `src/lib/statusTones.ts` shrinks |
| Human design review of the palette, type roles and control sizes on the captured screens | The owner | A recorded yes or changes, per `DESIGN_REVIEW_SCORECARD` in the handoff |
| Keyboard, screen-reader, forced-colours and touch passes on shell, Mail, Drive, Docs, an ERP order | Someone with the tools | Recorded per scenario in `acceptance.json` |
| Native review of the Arabic and Hindi strings added here | A native speaker | Catalog entries confirmed or corrected |
| Mail against a real mailbox; editors with the editors server; Meet with LiveKit; a Metrics dashboard | Whoever next runs those services locally | Captures beside the others, with their `captures.json` |
| Rebuild and release the adopted apps; then the other 33 interfaces, adopting the lint each time | Each app | `cli.mjs check` passes with a committed baseline; version bumped |
| An online/offline hook exported from the kit (`useOnline` lives in a module that acts on load) | Kit | Apps stop inferring offline from a status of 0 |
| ERP's draft order: sections for the low-value fields; larger status and locked-state treatment; the header's eight actions on narrow widths | ERP metadata, then kit | Reviewed on captures at 1440 and 390 |
| Patterns named in the brief with no kit component yet: context inspector, approval preview, transfer tray, a shared app header and view toolbar | Kit, each driven by one app screen | Listed as built in `PATTERNS.md` with a consumer |
| Unchecked checkboxes and switch tracks in dark mode read heavy since `--input` became the control border | Kit | Looked at in the gallery in dark; adjusted or accepted |
| Drive's entry bundle is at 181.5 of 200 KB | Drive | Lazy-load what its first page does not need |
| Geist evaluation; the root at 100% | Kit | Decided with captures |
