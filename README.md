# Ferrum web

The web frontend for [Ferrum](https://github.com/CBFerrum/Ferrum), a metadata-driven ERP on Rust
and PostgreSQL. Every screen is rendered from metadata (`/api/meta`,
`/api/meta/{Entity}`): a new entity, package field or tenant custom field shows up in lists,
filters and forms without frontend changes.

Stack: Vite + React + TypeScript (strict), react-router, @tanstack/react-query, hand-written CSS.
No component kit, no grid library.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173/app/  (proxies /api and /files to http://127.0.0.1:5150)
```

Sign in with a tenant (workspace), email and password. There is no React plugin (to keep
`node_modules` small), so edits trigger a full page reload instead of Fast Refresh; add
`@vitejs/plugin-react` to `vite.config.ts` if you want Fast Refresh.

## Build, check, test

```sh
npm run typecheck  # tsc --noEmit (strict)
npm test           # vitest: expression evaluator, API errors, decimal formatting, filters, document diff/merge
npm run build      # type-check + production bundle in dist/
```

The app is built with `base: "/app/"`.

## Phones and installing as an app

Every screen works on phones: lists turn into cards with a Sort select, forms keep their actions in a
bar at the bottom, child tables show one card per row (tap to edit), dialogs open as bottom sheets,
and touch screens get 44px targets and 16px inputs (no zoom on iOS). Layouts respect the notch and
home indicator.

Ferrum is also an installable app (PWA): *Install the app* in the account menu (Chrome, Edge,
Android) or *Share → Add to Home Screen* in Safari on iOS. The service worker (`public/sw.js`,
registered by production builds only) caches the app shell and its content-hashed bundles, at
install and on every online page load, so the app opens offline. API calls, file downloads, MCP,
OAuth and WebSockets always go to the network and are never cached: they are authenticated tenant
data, and devices may be shared. Pages load from the network first, so a deploy or a rollback shows
on the next load; open tabs look for a new deployment hourly and whenever they are shown again, and
offer to reload (a form with unsaved changes asks first). To try it locally:

```sh
npm run build && npx vite preview   # http://localhost:4173/app/, proxies the API like the dev server
```

## Deploy

The image (`ghcr.io/cbferrum/ferrum-frontend`) is unprivileged nginx on port 8080 serving the app at
`/app/` and proxying `/api`, `/files`, `/mcp` and `/ws` to the Ferrum server named by
`FERRUM_API_URL` (default `http://ferrum:5150`), so browsers talk to a single origin and no CORS
setup is needed. It keeps no state; run as many replicas as you like. Health check: `GET /healthz`.

```sh
docker build -t ferrum-frontend .
docker run -p 8080:8080 -e FERRUM_API_URL=http://host.docker.internal:5150 ferrum-frontend
```

Other settings:
* `FERRUM_MAX_UPLOAD` (default `32m`): the largest request body passed to the API.
* `FERRUM_OFFICE_ORIGIN`: Drive's online editor server (Collabora or ONLYOFFICE), which pages
  may frame and post to.
* `FERRUM_EDITORS_URL`: the server of Drive's browser editors, which pages may frame (Ferrum's
  `deploy/editors`, docs/operations.md "Browser editors").

For a single-binary setup the Ferrum server can also serve a build directly: point
`FERRUM_WEB_DIR` at `dist/` and `FERRUM_WEB_INDEX` (served for every other path under `/app/`) at
`dist/index.html`.

## Structure

```
src/
  main.tsx            router (basename /app), query client, global 401 → login
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
    pwa.ts            service worker registration, install prompt, online state, new-deployment check
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
