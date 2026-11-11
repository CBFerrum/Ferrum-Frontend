# Acceptance scenarios

58 scenarios for the interface of the whole ecosystem, kept in [acceptance.json](acceptance.json) (each with its exercise, expected result and the evidence it needs). This table is generated from that file; edit the file, not the table.

A scenario's state changes only with retained evidence: the artifact versions (kit, app, editor), the role, fixture, viewport, theme and locale, and the result. Nothing here has been run, so every state is `not_run`; a scenario passed on one app or one artifact says nothing about another.

| id | area | title | maps to | state |
|---|---|---|---|---|
| UX-001 | Baseline | Capture exact installed artifacts | `release` | not_run |
| UX-002 | Tokens | Measure root and component geometry | `kit:tokens` | not_run |
| UX-003 | Tokens | Meaningful text contrast | `kit:tokens` | not_run |
| UX-004 | Tokens | User accents and dark mode | `kit:tokens`, `shell` | not_run |
| UX-005 | Tokens | Semantic status mapping | `kit:tokens`, `kit:StatePanel` | not_run |
| UX-006 | Tokens | Font failure and scripts | `kit:tokens` | not_run |
| UX-007 | Tokens | Rem-scale migration | `kit:tokens`, `release` | not_run |
| UX-008 | Primitives | Button semantic compatibility | `kit:primitives` | not_run |
| UX-009 | Primitives | Overlay focus | `kit:primitives` | not_run |
| UX-010 | Primitives | Toolbar keyboard model | `kit:primitives` | not_run |
| UX-011 | Primitives | Touch hit areas | `kit:primitives` | not_run |
| UX-012 | Shell | Navigation hierarchy | `shell` | not_run |
| UX-013 | Shell | Restricted and empty navigation | `shell` | not_run |
| UX-014 | Shell | Narrow and short viewport | `shell` | not_run |
| UX-015 | Shell | Loading and stale state | `shell`, `kit:StatePanel` | not_run |
| UX-016 | Mail | Triage and reading | `app:comms/mail` | not_run |
| UX-017 | Mail | Pane resize | `app:comms/mail` | not_run |
| UX-018 | Mail | Draft preservation | `app:comms/mail` | not_run |
| UX-019 | Mail | Send ambiguity | `app:comms/mail` | not_run |
| UX-020 | Mail | Shortcut/input coexistence | `app:comms/mail` | not_run |
| UX-021 | Mail | Untrusted email | `app:comms/mail` | not_run |
| UX-022 | Mail | Mobile compose | `app:comms/mail` | not_run |
| UX-023 | Drive | Find and preview | `app:drive` | not_run |
| UX-024 | Drive | Bulk selection | `app:drive` | not_run |
| UX-025 | Drive | Upload failure | `app:drive` | not_run |
| UX-026 | Drive | Sharing lifecycle | `app:drive` | not_run |
| UX-027 | Drive | Long content | `app:drive` | not_run |
| UX-028 | Docs | Writing focus | `app:docs` | not_run |
| UX-029 | Docs | Collaborative change | `app:docs` | not_run |
| UX-030 | Docs | Offline/save boundary | `app:docs` | not_run |
| UX-031 | Docs | IME and undo | `app:docs`, `editors` | not_run |
| UX-032 | Docs | Document formatting contract | `app:docs`, `editors` | not_run |
| UX-033 | Editors | Engine and file readiness | `editors` | not_run |
| UX-034 | Editors | External appearance bridge | `editors`, `kit:tokens` | not_run |
| UX-035 | Sheets | Grid workflow | `editors`, `app:sheets` | not_run |
| UX-036 | Sheets | Large and complex workbook | `editors`, `app:sheets` | not_run |
| UX-037 | Slides | Object workflow | `editors`, `app:slides` | not_run |
| UX-038 | PDF | Form and annotation | `editors`, `app:pdf` | not_run |
| UX-039 | Records | Validation and conflict | `app:erp` | not_run |
| UX-040 | Records | Financial values | `app:erp` | not_run |
| UX-041 | Records | Destructive operation | `app:erp`, `kit:StatePanel` | not_run |
| UX-042 | Administration | Scope clarity | `shell`, `app:erp` | not_run |
| UX-043 | Studio | Accessible graph editing | `studio` | not_run |
| UX-044 | Studio | Draft versus deployment | `studio` | not_run |
| UX-045 | Analytics | Data semantics | `app:metrics` | not_run |
| UX-046 | AI | Proposed versus executed | `app:ai`, `shell` | not_run |
| UX-047 | Accessibility | Keyboard only | `kit:primitives`, `shell` | not_run |
| UX-048 | Accessibility | Assistive technology | `kit:primitives`, `shell` | not_run |
| UX-049 | Accessibility | Zoom and reflow | `shell`, `kit:tokens` | not_run |
| UX-050 | Accessibility | Reduced and forced display modes | `kit:tokens`, `kit:primitives` | not_run |
| UX-051 | Localization | RTL complete journey | `kit:tokens`, `shell` | not_run |
| UX-052 | Localization | Text expansion | `shell`, `kit:tokens` | not_run |
| UX-053 | Performance | Realistic frontend interaction | `shell`, `release` | not_run |
| UX-054 | Performance | Background activity | `shell` | not_run |
| UX-055 | Release | Mixed artifact versions | `release` | not_run |
| UX-056 | Release | Preference migration | `release`, `shell` | not_run |
| UX-057 | Release | Visual regression review | `release` | not_run |
| UX-058 | Release | Independent task evaluation | `release` | not_run |
