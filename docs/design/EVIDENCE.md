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
| `npm test` | 102 files, 881 tests passing |
| `npm run lint:ui` | within its baseline (18 raw colours, 2 arbitrary text sizes left; no text under 12px, no blank fallback). The rule first read rem at 16px and missed 0.8rem text; it now reads it at the kit's 14px |
| `npm run build:apps` | shell entry 158.1 KB JS / 36.7 KB CSS, Studio 157.8 / 36.7, of 200 / 50. The entry grew about 14 KB when the shell's dialogs moved behind the kit's skeletons and state panel, and 17 KB more with the sidebar's icon table (134 named icons, no lazy chunk) |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| axe over the gallery (jsdom) | no violations in light theme. jsdom has no layout: it does not check contrast or focus order |

## The craft pass (11 Nov, second half)

Done in three isolated worktrees, each with its own server so its engineer looked at real pages, then merged and reviewed as a whole; a fourth pass crafted the platform's own bar and pages (they live in the platform repository, `server/shell/`), and a fifth ERP's own finance pages.

| Part | What changed (seen rendered, light and dark) |
|---|---|
| Chrome | Every sidebar row leads with a 16px stroke icon (declared, then by concept, then by kind) and only an outside link keeps an end mark; the open page is unmistakable and scrolled into view. The records home is the attention strip, recent records and text links in columns. App icons are a soft tile of the app's colour (a test holds the glyph to 3:1). Dialogs, menus, popovers, sheets and toasts share radius, hairline, shadow and motion |
| Record workspace | A value that cannot be edited is its label and text, not a greyed box; a run of read-only money fields is a totals column; three or more empty read-only fields fold into one line that opens; the header stays in view; the error summary names each field; Activity is a from → to timeline |
| Lists and data | One header anatomy (title and count, compact view switcher, one overflow menu, one primary action); 36px rows; selecting rows does not move the table; reports get statement discipline from the data's own row flags; Administration's fifteen tabs are a grouped side navigation with the same ids and URLs |
| Whole | One page-title size and place everywhere; a print stylesheet (checked as PDF: a record, a list, a report, a 37-page ledger); menus and dialogs return focus to their opener (asserted in a tab-order script for list, record and admin); relative times follow the page's language and keep their order right to left |
| Platform bar and pages | `theme.css` carries the kit's tokens value for value; the bar keeps its height; launcher, search palette, menus, notifications and the assistant share the kit's language; sign-in, sign-up, consent, portal and status pages are one calm card or state panel. Compiled and run for real: the bar's nine controls all have names |
| ERP's own pages | Home strip as linked counts by urgency; Accounts today as a queue; statements with indentation, weights, rules and a double rule under the final total. Bank, apply payments, revalue and portal were seen on fixture data only |

**Every app interface is adopted**: 43 interfaces, not 40 (the 40 app repositories, plus Warehouse and Shop Floor inside the ERP repository and Operations inside the platform, which the first pass missed because they are not a top-level `ui/`). `uikit/tools/rebuild-all.sh` rebuilds each against the final kit and runs its typecheck, tests, build and interface check; all 43 pass, each with an empty lint baseline. Twenty-two were adopted from source without being seen rendered at the time (the test workspace did not have them installed); the release-candidate capture below is where they are first seen.

**Found by looking, fixed:** an alarm's severity was coloured four ways in Edge (a Major alarm neutral on one tile); a pressed chip lost its text on hover; a long sender pushed Mail's time off the row; ERP's statement flipped a negative's sign right to left; POS's touch minimum rendered at 42px; Bookings' hour labels wrapped; several apps drew a refused page as an empty one.

**Local gates run:** this repository's typecheck, tests, UI lint and build; every app's `cli.mjs typecheck`, `test`, `build`, `check`; the platform's `cargo fmt --check`, a full build with all 40 app crates patched to their local worktrees, and its shell and app-fit tests (25 pass). Not run: the apps' Rust suites (interface-only changes), the platform's database suites, any image build.

## The release candidates (11 Nov, evening)

Two full builds were run as a real server on a seeded workspace and photographed, then reviewed picture by picture by a tester agent and again by the lead. The sets are kept for documentation in `ERP/ferrum-screens/sets/` (local, never pushed: they show a development workspace), each with `index.json`, a contact sheet and `REVIEW.md`.

| Set | Pictures | What it is |
|---|---|---|
| `2026-11-11_kit-v2-rc1` | 1,084 (52 apps and the shell; light, dark, 390 wide, right to left, compact, print) | The first time the 22 apps adopted from source were seen rendered |
| `2026-11-11_kit-v2-rc2` | 1,185 on real records seeded through each app's own actions | After the fixes below; 3 failed (Customer cards in dark, since fixed) |

**Found in rc1 and fixed** (each seen again in rc2): Developer Hub rendered unstyled (its stylesheet never imported the kit's; `cli.mjs check` now fails any app whose built CSS lacks the kit base); Chat was wider than a phone; the printed record kept the bar; Drive's search snippet ran under its columns; the Create menu ran off the screen (now grouped by app, capped, with a filter); Administration's users table had no phone layout; tab strips and chip rows clipped at 390; Calendar's titles lost their start right to left; CJK names made two-character initials; the API-key form was misaligned; Docs' share dialog overflowed; three apps showed a letter where an icon belongs.

**Found by the lead, not the tester:** about nineteen industry apps opened on a home page copied from one template (a small heading, a bare text link as the page's main action, hollow boxes titled "Active (0)", badges stretched to the card's width). Because every one was a copy, the fix was a governed pattern in the kit (`PageHead`, `QueueGrid`/`Queue`/`QueueItem`, `TileGrid`/`Tile`, `StatGrid`/`Stat`, `HomeSection`, `Progress`, `PageStack`, `PageSplit`, `ButtonLink`, `HomeSkeleton`; `PATTERNS.md`, "Work home") and each home rebuilt on it, then a second pass that deleted the workarounds the first pass needed.

**Found in rc2 and fixed:** a printed record still printed advisory banners, collapsed sections, link icons, required marks and its card frame (the `@page` margin was already there: a print-emulated screenshot never shows it, `page.pdf()` does); scrolling tab strips, chip rows and the Docs toolbar gave no cue (the table's edge fade now covers `.tabs`, `.segmented` and `.scroll-cue`; four apps had a reduced-motion rule that switched it off); an untranslated Latin button label put its question mark at the wrong end right to left (`unicode-bidi: plaintext` on `.btn`); an app page of the workspace never got the chosen language and direction on its document (the bar's runtime sets them now), which is why Customer cards did not mirror, and its example hard-coded a light palette; Metrics printed a raw number; Digital Assets drew an empty square for an asset without a preview.

**Asked for by the owner after rc2:** an icon on every left-menu row. `navIcon()` in the kit resolves it: what the row declares, then a concept dictionary on the entity's stable name (about 550 words to 110 icons; all 490 entity names in the installed apps resolve through a concept, held by a test over a checked-in list), then the row's kind. Seen rendered in ERP (136 rows), People (64), Contracts, Studio and Administration; the other apps use the same code and were not looked at before the final capture.

**Decided, not changed:** sidebar group headings measure 6.14:1 in light and 8.72:1 in dark, so they stay; "Console PIN…" in Operations is its label (the ellipsis means a dialog), not truncation; Intelligence's "Recent questions" showed ids because the seeded records have no question text (the field is written only by asking), which is data, not the page.

**Seen and left** (known debt): Hospitality's housekeeping page counts tasks, not dirty rooms; Nonprofit's figures count paid records without saying so; the printed totals block moves whole to the next page when it does not fit; Warehouse has no translation catalogs; fourteen apps still carry some page-head, meter or stat classes of their own (Projects, Campaigns, Commerce, Field Service, Bookings, CRM, People, Drive's meter, Helpdesk, Sign, Edge, POS, Forms, ERP); the edge fade needs `animation-timeline`, so Firefox and Safari show none; seven queues in a grid still leave one alone on its row; no write path (check-in, roll save, scan, booking) was clicked through in the rebuilt homes; Control was rendered on stand-in answers only, and Control and Cloud are not in the capture sets (the stores do not offer them).

## Not done, and why

- **Human review.** The palette and type scale are the handoff's candidate, applied and measured; nobody has approved them as the final theme.
- **Assistive technology, keyboard walk-throughs, forced-colours and touch rendering.** Not run. The focus indicator is an outline, which forced colours keeps; that is source reasoning, not an observation.
- **Arabic and Hindi.** The new strings were translated by the implementer, not a native speaker. Right to left was captured for the gallery and for about a hundred app screens in each release-candidate set; most apps were seen with the direction flipped over partly translated text.
- **Mail's inbox, reader and composer.** The demo workspace has no hosted mail domain. See the Comms section.
- **Sheets, Slides and PDF editors.** The editors server was not running; only the host pages could be seen.
- **Metrics.** Seen in the release candidates on its home page only; a Studio dashboard stood in as the dashboard reference.
- **Performance.** Only bundle sizes were measured. No rendering or interaction timing.
- **Geist.** Not evaluated: it needs licensed, self-hosted font files and a bundle-budget and script-fallback review. The system font stack stays.
- **The root at 100%.** Deferred; with the spacing unit and type roles explicit, what remains is rewriting the `calc(N / 14 * 1rem)` values.
- **The 58 acceptance scenarios** (`acceptance.json`) all still read `not_run`. This work produced evidence towards several (UX-001 baseline, the token, type, status and loading ones) but none was run as written, with its full evidence list.
- **Office-suite features.** This work is the look, structure and states of the interface. It did not add features: the owner's review after rc2 (Mail against Gmail, Docs/Sheets/Slides against Google and Microsoft) is a separate body of work with its own gap lists (`ERP/OFFICE-GAPS-COMMS-2026-11-11.md`, `ERP/OFFICE-GAPS-DOCS-2026-11-11.md`).
- **The apps' Rust suites and the platform's database suites.** Not run: the app releases change interfaces only.

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
| An `icon` on an entity's own metadata, so a sidebar row's icon is declared with the record type | Platform (meta crate, entity summary) | The kit's `navIcon()` already reads `EntitySummary.icon`; the dictionary becomes the fallback |
| The apps that still carry their own page-head, meter or stat classes move to the kit's | Each app named above | The classes are gone and `cli.mjs check` passes |
| An online/offline hook exported from the kit (`useOnline` lives in a module that acts on load) | Kit | Apps stop inferring offline from a status of 0 |
| ERP's draft order: sections for the low-value fields; larger status and locked-state treatment; the header's eight actions on narrow widths | ERP metadata, then kit | Reviewed on captures at 1440 and 390 |
| Patterns named in the brief with no kit component yet: context inspector, approval preview, transfer tray, a shared app header and view toolbar | Kit, each driven by one app screen | Listed as built in `PATTERNS.md` with a consumer |
| Unchecked checkboxes and switch tracks in dark mode read heavy since `--input` became the control border | Kit | Looked at in the gallery in dark; adjusted or accepted |
| Drive's entry bundle is at 181.5 of 200 KB | Drive | Lazy-load what its first page does not need |
| Geist evaluation; the root at 100% | Kit | Decided with captures |
