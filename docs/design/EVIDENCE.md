# Evidence

What is proven, how, and what is not. Evidence classes are kept apart: **source** (read in the code), **test** (a unit or component test in this repository), **browser** (a real page rendered in Chrome and measured or looked at), **human** (a person reviewed it). Nothing here has had a human design review, an assistive-technology session or a user study.

## Not done, and why

- **Human review.** The palette and type scale are candidates, applied and measured (`src/tokens.test.ts`); nobody has approved them as the final theme.
- **Assistive technology, keyboard walk-throughs, forced-colours and touch rendering.** Not run. The focus indicator is an outline, which forced colours keeps; that is source reasoning, not an observation.
- **Arabic and Hindi.** The strings were translated without a native speaker. Right to left was looked at in a browser on the gallery and on app screens, mostly over partly translated text.
- **Mail's inbox, reader and composer.** Seen only on fixture data, not against a hosted mailbox: sending, drafts surviving failure and shortcuts while typing were not exercised.
- **Sheets, Slides and PDF editors.** Only the host pages were seen; the editors were not run.
- **Metrics.** Seen on its home page only.
- **Performance.** Only bundle sizes are measured (`packages/build/budgets.mjs`). No rendering or interaction timing.
- **The 58 acceptance scenarios** (`acceptance.json`) all read `not_run`: none was run as written, with its full evidence list.

## Backlog

| Item | Owner | Done when |
|---|---|---|
| A tone per option in field metadata, so status colour is declared with the state | Platform (entity metadata) | `StatusBadge` reads it; the fallback table in `src/lib/statusTones.ts` shrinks |
| Human design review of the palette, type roles and control sizes on captured screens | The project's maintainers | A recorded yes or changes |
| Keyboard, screen-reader, forced-colours and touch passes on shell, Mail, Drive, Docs, an ERP order | Someone with the tools | Recorded per scenario in `acceptance.json` |
| Native review of the Arabic and Hindi strings | A native speaker | Catalog entries confirmed or corrected |
| Mail against a real mailbox; editors with the editors server; Meet with LiveKit; a Metrics dashboard | Whoever next runs those services locally | Captures beside the others |
| The apps that still carry their own page-head, meter or stat classes move to the kit's | Each such app | The classes are gone and `cli.mjs check` passes |
| An online/offline hook exported from the kit (`useOnline` is in `src/lib/pwa.ts`) | Kit | Apps stop inferring offline from a status of 0 |
| ERP's draft order: sections for the low-value fields; larger status and locked-state treatment; the header's eight actions on narrow widths | ERP metadata, then kit | Reviewed on captures at 1440 and 390 |
| Patterns with no kit component yet (see "Not built yet" in `PATTERNS.md`) | Kit, each driven by one app screen | Listed as built in `PATTERNS.md` with a consumer |
| Unchecked checkboxes and switch tracks in dark mode read heavy since `--input` became the control border | Kit | Looked at in the gallery in dark; adjusted or accepted |
