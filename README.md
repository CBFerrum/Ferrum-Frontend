# Ferrum web

The web frontend for [Ferrum](https://github.com/CBFerrum/Ferrum), a metadata-driven ERP on Rust
and PostgreSQL. Every screen is rendered from metadata (`/api/meta`,
`/api/meta/{Entity}`): a new entity, package field or tenant custom field shows up in lists,
filters and forms without frontend changes.

Stack: Vite + React + TypeScript (strict), react-router, @tanstack/react-query, hand-written CSS.
No component kit, no grid library.

## Develop

Ferrum's server answers every page: Home, the store, administration, the account and records
(`apps/shell`), and ERP (`apps/erp`), built here into `dist-apps/` and registered when the server
starts. With Ferrum's checkout beside this one (`ferrum/web` is this repository):

```sh
npm install
npm run build:apps                                              # dist-apps/shell, dist-apps/erp
cd ../server && FERRUM_UI_DIR=../web/dist-apps cargo run -- start   # http://127.0.0.1:5150/
```

Rebuild and restart the server to see a change. There is no React plugin (to keep `node_modules`
small).

## Build, check, test

```sh
npm run typecheck  # tsc --noEmit (strict)
npm test           # vitest: expression evaluator, API errors, decimal formatting, filters, document diff/merge
npm run build      # type-check + the interfaces in dist-apps/
```

## Phones

Every screen works on phones: lists turn into cards with a Sort select, forms keep their actions in a
bar at the bottom, child tables show one card per row (tap to edit), dialogs open as bottom sheets,
and touch screens get 44px targets and 16px inputs (no zoom on iOS). Layouts respect the notch and
home indicator.

## Deploy

Nothing to deploy from here: Ferrum's server image builds the interfaces from this repository at
the commit its Dockerfile pins (`FRONTEND_REV`), or from another checkout
(`docker build --build-context frontend=<this checkout> <ferrum checkout>`). This repository's CI
does the latter and runs Ferrum's `deploy/smoke.sh` against the result.

## Structure

```
src/
  styles.css          design tokens (light/dark via prefers-color-scheme), layout, components
  lib/
    api.ts            fetch wrapper: bearer token (memory + sessionStorage), error parsing,
                      retries on connection errors, authenticated downloads, print via blob URL
    meta.ts           metadata types + hooks, field state (visible / required / read-only)
    expr.ts           evaluator for the common CEL subset used by visible_if / required_if /
                      read_only_if and action/workflow conditions
    format.ts         exact decimal formatting/comparison (money stays a string), dates
    filters.ts        list filter state ⇄ URL ⇄ API `filters` JSON
    doc.ts            create/patch bodies, merging `_calc` previews into the edited document
    pwa.ts            install prompt, online state
    *.test.ts         unit tests
  ui/kit.tsx          design system: Button, Field, Dialog (native <dialog>), Tabs, Badge,
                      Menu, toasts, confirm dialog, states, error boundary, icons
  app/
    Shell.tsx         auth guard, sidebar from modules, search (/), command palette (Ctrl/Cmd+K),
                      notifications, user menu (password, API keys, sign out [everywhere])
    Home.tsx          module quick links + recent documents
    ListView.tsx      /e/:entity — columns, filters, search, sort, pagination, CSV export
    FormView.tsx      /e/:entity/:id — sections, live totals, save/If-Match, 409/422 handling,
                      submit/cancel/amend/delete, custom actions, workflow, print, audit trail
    widgets.tsx       field widgets, link autocomplete, child-table grid (cards on phones), attachments
    records.css       phone layouts of lists, forms and child tables
    ReportView.tsx    /r/:name — parameter form, tree/bold rows, totals, CSV download
    Customize.tsx     /customize/:entity — fields, custom fields, properties, rules, change sets
    Admin.tsx         /admin — users, roles matrix, packages, webhooks, automations, plugins, API keys
```

## Apps' own interfaces and the packages

Ferrum's apps own their interfaces (docs/plan/apps-ui.md in the Ferrum repository). This repository
holds the shell's and ERP's (`apps/shell`, `apps/erp`, built into `dist-apps/` by `npm run
build:apps`), and the packages every interface uses: `@ferrum/client` (the bootstrap, the shell API
with fallbacks, requests with the browser's session, errors, formatting, uploads), `@ferrum/kit`
(the components and the look; `@ferrum/kit/primitives` for the shadcn building blocks),
`@ferrum/records` (lists, forms, reports, people, comments, the record picker) and
`@ferrum/testing` (a fake bootstrap and shell).

Comms, Drive and Docs keep their interfaces in their own repositories' `ui/`, built with this
checkout as their sibling (`../../ferrum/web` from their `ui/`), until the packages are published:

```
node ../../ferrum/web/packages/build/cli.mjs build      # vite build into dist/, stamped with its sources
node ../../ferrum/web/packages/build/cli.mjs check      # CI: dist/ was built from the sources as they are
node ../../ferrum/web/packages/build/cli.mjs typecheck
node ../../ferrum/web/packages/build/cli.mjs test
```

`packages/build/vite.mjs` resolves an app's libraries as this repository's, so the app and the kit
share one React and one query client: this repository's dependencies (LiveKit, TipTap, Yjs among
them) are the apps' too. An app never imports this repository's own modules (`@/…`); the build
refuses it.

## Conventions

- Money and decimals are strings end to end. The UI never does arithmetic on them: totals come from
  `POST /api/v1/{Entity}/_calc` (debounced 400 ms while editing); display uses `Intl.NumberFormat`
  on the decimal string (exact rounding) with the record currency's precision when known.
- Conditions the evaluator cannot parse (function calls, arithmetic…) resolve permissively (field
  shown, action offered); the server is the authority and its 422 errors are shown inline,
  including child-row errors (`row: [table, index]`).
- Saves send `If-Match: "v<version>"`; a 409 offers a reload. Creates send an `Idempotency-Key`,
  so the client may safely retry them on connection errors.
- Print HTML is opened from a blob URL with a script-blocking CSP injected (print templates are
  tenant-editable).

Keyboard: `/` search, `Ctrl/Cmd+K` command palette, `Ctrl/Cmd+S` save a form; in child tables
`Alt+↑/↓` moves a row and `Ctrl+Enter` inserts one below.
