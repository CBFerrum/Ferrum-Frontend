# Development skills manifest

These eleven agent skills are development-time advisers for the design-system upgrade of the enterprise web suite (React 19, Vite 7, TanStack Query/Table/Virtual, Tailwind v4, shadcn/Radix, TipTap/Yjs). They were reviewed on 2026-11-11 at the pinned revisions recorded below. Every file was read through the GitHub API only; nothing was installed, no package was fetched with a package manager, and no script from any repository was executed. Statements about what a skill "executes" describe what its files instruct, not anything that was run.

The suite's own design documents and its business and security contracts take precedence over every skill listed here. A skill is a source of questions and checks, never a source of tokens, palettes, fonts or architecture. An upgrade of any skill means a fresh review at a new revision, and a new row in this manifest. The pinned revision is the full commit SHA of the default branch head at read time.

## Summary

| Skill | Repo @ sha (short) | Licence | Verdict | Role |
|---|---|---|---|---|
| building-components | vercel/components.build @ 0861fbcf | Apache-2.0 notice in LICENSE (GitHub: NOASSERTION) | adviser | implementation (component API, a11y, tokens) |
| vercel-composition-patterns | vercel-labs/agent-skills @ 1a2c79d4 | MIT (SKILL.md frontmatter + README); no LICENSE file | adviser | implementation (component API shape) |
| web-design-guidelines | vercel-labs/agent-skills @ 1a2c79d4, plus vercel-labs/web-interface-guidelines @ 434b7f91 | MIT for the guidelines repo; skill itself declares none | adviser-with-overrides | review |
| vercel-react-best-practices | vercel-labs/agent-skills @ 1a2c79d4 | MIT (frontmatter + README); no LICENSE file | adviser-with-overrides | review (performance only) |
| shadcn | shadcn-ui/ui @ 8ab27715 | MIT | adviser-with-overrides | implementation |
| frontend-design | anthropics/skills @ 2c5958ec | Apache-2.0 (skill LICENSE.txt); repo has no root licence | watchlist | none assigned |
| webapp-testing | anthropics/skills @ 2c5958ec | Apache-2.0 (skill LICENSE.txt) | adviser-with-overrides | verification |
| Interface Design | dammyjay93/interface-design @ 2f9be320 | MIT | adviser-with-overrides | composition |
| Impeccable | pbakaus/impeccable @ c1e0e549 | Apache-2.0 | adviser-with-overrides | refinement, deliberate invocation only |
| UI/UX Pro Max | nextlevelbuilder/ui-ux-pro-max-skill @ 6ae86f61 | MIT | reject | none |
| Dashboard Design Skill | abdiraimov-otabek/dashboard-design-skill @ 463b8fdf | MIT | watchlist | none assigned |

Full SHAs and file hashes are in each section. Stars and dates were read from the API on 2026-11-11.

---

## 1. building-components

- Repository: github.com/vercel/components.build. Default branch `main`. Head at read time: `0861fbcfe4f78c50eaafc202f5fb7661d641ddff` (2026-11-10).
- Path: `skills/building-components/SKILL.md` (exists as shortlisted, no move). Sub-directory `skills/building-components/references/` holds 15 `.mdx` files (about 119 KB).
- SHA-256 of SKILL.md: `c26a17c53e59d119df99eade77bd608f864f888ac877979bfc4ffbba25792eb8`
- Licence: `LICENSE` is a 552-byte Apache-2.0 notice ("Copyright 2023 Vercel, Inc.", pointing at the Apache text, without the full text), which is why the GitHub API reports `NOASSERTION`. SKILL.md has no licence field. Treat as Apache-2.0 by intent, with the caveat that the full licence text is absent.
- Beyond markdown: nothing in the skill directory. The repository has a CI workflow (`.github/workflows/sync-skill-docs.yml`) and `scripts/sync-skill-docs.sh` that copy the site's docs into `references/` on push; this runs in the maintainers' CI and not at install or use. No hooks, no commands, no runtime network fetch, no instruction to write theme, palette or memory files.
- Size and signal: SKILL.md 37 lines (an index of 15 references). Last commit to the skill directory 2026-02-12; repo last pushed 2026-11-10; 802 stars; repo created 2025-09-18.
- Executes or instructs: the reference documents contain example commands (for instance `npm install @radix-ui/react-use-controllable-state` in the state reference, and registry/npm publishing walkthroughs). These are teaching examples; do not act on them.
- Verdict: **adviser.** It is a pure documentation skill that describes the same compound-component, data-attribute and semantic-token conventions the shadcn/Radix layer already uses, and it contains nothing that acts on the machine. The registry, npm and marketplace references are out of scope for an internal kit and should simply not be consulted.
- Rules that apply:
  1. Expose state through `data-state`, `data-disabled`, `data-loading`, `data-orientation` and `data-slot` attributes instead of per-state className props, so consumers style with one `className` and Tailwind variants.
  2. Support both controlled and uncontrolled use (`value`, `defaultValue`, `onValueChange`) in every stateful component; merge the two with one shared helper rather than ad hoc per component.
  3. Build components as Root, Item, Trigger, Content parts sharing context; use one naming scheme (Root, Trigger, Content, Title, Description) across the kit.
  4. Each part wraps a single element, extends that element's HTML attributes, spreads `...props` last, and exports its prop types.
  5. Use semantic HTML first, then ARIA; every interactive part needs keyboard operation, visible focus (`:focus-visible`), focus trapping in modal surfaces and focus restoration on close.
  6. Use `asChild` composition for polymorphism instead of an `as` prop with unsound types.
  7. Colour and spacing come from semantic tokens (background/foreground, primary/primary-foreground pairs) defined as CSS variables mapped through Tailwind v4 `@theme inline`; components never hard-code a value.
  8. For data-heavy components (long lists, tables) keep the dependency footprint small and plan virtualisation from the start.

## 2. vercel-composition-patterns

- Repository: github.com/vercel-labs/agent-skills. Default branch `main`. Head: `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` (2026-10-27).
- Path: `skills/composition-patterns/SKILL.md` (the directory is named `composition-patterns`; the frontmatter name is `vercel-composition-patterns`). Also `AGENTS.md` (a compiled 22 KB guide), `README.md`, `metadata.json`, and 8 rule files under `rules/`.
- SHA-256 of SKILL.md: `e38e0eaa609316b10423a9a138ed95e35099accd3f735585295c8a8f165c28a3`
- Licence: SKILL.md frontmatter says `license: MIT` and the README has a "License: MIT" section. The repository has no LICENSE file and the GitHub API reports no licence (`/license` returns 404). Declared MIT, not backed by a licence file.
- Beyond markdown: nothing in this skill directory. The wider repository contains other skills (deploy-to-vercel, vercel-cli-with-tokens, vercel-optimize, react-native-skills, react-view-transitions) and a build package for react-best-practices; none are in scope. No hooks, no runtime fetch, no instruction to write files.
- Size and signal: SKILL.md 89 lines. Last commit touching the skill directory 2026-01-28; repo last pushed 2026-10-28; 33,862 stars; repo created 2025-12-08.
- Executes or instructs: nothing.
- Verdict: **adviser.** Short, self-contained, framework-neutral (a few examples use React Native `TextInput`, which is cosmetic), and includes the React 19 changes the suite is on. It is directly applicable to a shared component kit.
- Rules that apply:
  1. Do not add boolean props to switch behaviour; compose variants or children instead.
  2. Structure complex components as compound components over a shared context.
  3. Give the context a generic `state` / `actions` / `meta` interface so the same UI works against different state providers (useful for kit components reused with TanStack Query-backed or Yjs-backed state).
  4. Only the provider knows how state is stored; lift state into the provider so sibling parts can read it.
  5. Create explicit variant components (for example separate edit and read-only forms) rather than mode flags.
  6. Prefer `children` composition over `renderX` props.
  7. React 19: pass `ref` as an ordinary prop (no `forwardRef`) and read context with `use()`.

## 3. web-design-guidelines

- Repository: github.com/vercel-labs/agent-skills. Head: `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`.
- Path: `skills/web-design-guidelines/SKILL.md` (exists as shortlisted). Frontmatter name `web-design-guidelines`, version 1.0.0. The directory contains only this file. Last commit touching it 2026-01-16.
- SHA-256 of SKILL.md: `f4647ca866a3accf763777f83e7682954f0187cd6bea7eea0399796652414e8f`
- Runtime fetch (confirmed): the skill tells the agent to fetch `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` with WebFetch "before each review". That URL tracks the `main` branch, so it floats. The document is in a repository and is pinned here:
  - Repository: github.com/vercel-labs/web-interface-guidelines, branch `main`, head `434b7f91364665f2f733b310ec54809bf8f37937` (2026-10-05). MIT (LICENSE file present). 1,147 stars.
  - File `command.md`, 191 lines, SHA-256 `d246b026f4f29b5823a9cc857f9edf3d2507002e055e32040cadeaf3b38e0234`. Immutable URL form: `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/434b7f91364665f2f733b310ec54809bf8f37937/command.md`.
  - The repository also holds `install.sh` (copies `command.md` from `main` into `~/.claude/commands`, `~/.cursor/commands` and similar via `curl`), `README.md` and `AGENTS.md`. The install script is not to be used.
- Licence: skill itself declares none; the agent-skills README says MIT (no LICENSE file in that repo); the guidelines repo is MIT.
- Beyond markdown: no scripts in the skill. The only dynamic element is the floating fetch above. The fetched document is rules plus an output format (`file:line - issue`); it contains no commands to run and no instructions to write files.
- Size and signal: SKILL.md 39 lines; guidelines document 191 lines. Guidelines repo last pushed 2026-10-05, so it is not frequently updated.
- Verdict: **adviser-with-overrides.** The checklist is dense, mechanical and well suited to review of data-dense UI. It must not be fetched live; use the pinned copy. Overrides:
  - Replace the live fetch with the pinned file above (or a vendored copy whose hash matches).
  - Ignore the "Hydration Safety" section (SSR-specific; the suite is a Vite SPA) and the `priority` image hint, which is Next-flavoured.
  - Its copy rules (Title Case headings and buttons, "&" over "and", ellipsis characters in placeholders, `autocomplete="off"` on non-auth fields) are a house style; the suite's own content guidelines win.
  - It names `virtua` for virtualisation and `nuqs` for URL state; the suite uses TanStack Virtual and its own router, so treat those as examples.
  - The terse output format is fine for review output but is not a substitute for the suite's own defect tracker conventions.
- Rules that apply:
  1. Icon-only buttons need an accessible name; decorative icons are `aria-hidden`; use `<button>` for actions and `<a>`/router links for navigation, never clickable `div`s.
  2. Never remove the focus outline without a `:focus-visible` replacement; use `:focus-within` for compound controls; sticky headers and overlays must not cover the focused element (important for sticky table headers and docked panels).
  3. Numeric columns and comparisons use `font-variant-numeric: tabular-nums`.
  4. Text containers must survive long, short and empty content: truncate or clamp, `min-w-0` on flex children, defined empty states.
  5. Lists over about 50 rows are virtualised; avoid layout reads (`getBoundingClientRect`, `offsetHeight`) during render and batch DOM reads and writes.
  6. URL reflects state: filters, tabs, pagination and expanded panels are linkable; destructive actions need confirmation or undo.
  7. Animate only `transform` and `opacity`, never `transition: all`, and honour `prefers-reduced-motion`.
  8. Dates, numbers and currency go through `Intl.*`; mark identifiers and brand names `translate="no"`; set `color-scheme` for dark themes so native controls and scrollbars follow.

## 4. vercel-react-best-practices

- Repository: github.com/vercel-labs/agent-skills. Head: `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`.
- Path: `skills/react-best-practices/SKILL.md` (directory name `react-best-practices`; frontmatter name `vercel-react-best-practices`). Also `AGENTS.md` (108 KB compiled guide), `README.md`, `metadata.json`, a `react-best-practices.zip` archive one level up, and 70 rule files under `rules/`. Last commit touching the directory 2026-04-14.
- SHA-256 of SKILL.md: `71ed7794962fa6e803ee83030517b5b93a9f70fbfeb431ec4535c5480a8d8355`
- Licence: `license: MIT` in frontmatter and README; no LICENSE file in the repository.
- Beyond markdown: nothing at use time in the skill. The repository has `packages/react-best-practices-build/` (TypeScript that compiles rules into `AGENTS.md`) and a CI workflow; both are maintainers' tooling, not install-time. The zip is a duplicate bundle and was not opened.
- Size and signal: SKILL.md 149 lines, 70 rules in 8 categories.
- Executes or instructs: nothing. It does recommend `better-all` and the SWR library in specific rules.
- Verdict: **adviser-with-overrides.** The client-side re-render, rendering and JavaScript sections are good review material; the server and framework-specific sections are not applicable. Overrides:
  - Skip the whole `server-*` category (RSC, server actions, `React.cache`, `after()`), `async-api-routes`, `rendering-hydration-*`, `rendering-script-defer-async`, `rendering-resource-hints` and `bundle-dynamic-imports` as written (uses `next/dynamic`; use `React.lazy` and Vite dynamic `import()`).
  - `client-swr-dedup` must be overridden: the suite uses TanStack Query for request deduplication, caching and invalidation. Do not add SWR.
  - `bundle-barrel-imports` shows a Next.js `optimizePackageImports` fix; in Vite the equivalent is direct per-icon imports or a verified tree-shakeable entry, checked with the bundle visualiser.
  - `async-*` waterfall rules apply to route loaders and Query prefetching, translated to the suite's router; `async-dependencies` recommends `better-all`, which is a dependency the suite should not add.
- Rules that apply:
  1. Derive state during render rather than in effects (`rerender-derived-state-no-effect`); subscribe to derived booleans, not raw values.
  2. Do not define components inside components; hoist static JSX and default non-primitive props (`rerender-no-inline-components`, `rerender-hoist-jsx`, `rerender-memo-with-default-value`).
  3. Keep typing responsive in large tables and filters with `useDeferredValue` / `startTransition` and a memoised filter (`rerender-use-deferred-value`, `rerender-transitions`).
  4. Use functional `setState` for stable callbacks; keep frequently changing transient values in refs (`rerender-functional-setstate`, `rerender-use-ref-transient-values`).
  5. Build `Map`/`Set` indexes for repeated lookups and avoid repeated `filter().map()` passes over large arrays (`js-index-maps`, `js-set-map-lookups`, `js-combine-iterations`).
  6. Use `toSorted()` and other immutable array methods so memoised selectors stay correct (`js-tosorted-immutable`).
  7. Use `content-visibility: auto` with `contain-intrinsic-size` for long, non-virtualised lists; use passive listeners for scroll and deduplicate global listeners (`rendering-content-visibility`, `client-passive-event-listeners`, `client-event-listeners`).
  8. Load heavy modules (editor, charts) on demand and preload on hover or focus (`bundle-conditional`, `bundle-preload`), relevant to TipTap and chart code.

## 5. shadcn

- Repository: github.com/shadcn-ui/ui. Default branch `main`. Head: `8ab27715521cbd4f87ae6886cd989cbb678f6de7` (2026-11-08).
- Path: `skills/shadcn/SKILL.md` (at the repository root, not under `apps/`). The public description is `apps/v4/content/docs/(root)/skills.mdx`. The skill folder has 21 files, about 158 KB: `cli.md`, `customization.md`, `design-system.md`, `design-system-page.md`, `mcp.md`, `registry.md`, `rules/{base-vs-radix,chat,composition,forms,icons,styling}.md`, `evals/evals.json`, `scripts/showcase-coverage.mjs`, `agents/openai.yml`, `assets/`. A sibling skill `skills/migrate-radix-to-base/` exists in the same repository and is out of scope. Last commit touching `skills/shadcn` 2026-10-14.
- SHA-256 of SKILL.md: `93951e5e83f616a3e046491c00d770bd54c0a64164706cd1191822a233d27592`. Also `scripts/showcase-coverage.mjs`: `fb593e0806414d23b51354a46881f0b2873afc226bda0926a22f83cbd60af2fa`.
- Licence: MIT (repository LICENSE; GitHub API `MIT`). SKILL.md has no licence field.
- Beyond markdown and what runs:
  - The site documents install as `npx skills add shadcn/ui`; this was not run.
  - SKILL.md frontmatter has `allowed-tools: Bash(npx shadcn@latest *), Bash(pnpm dlx shadcn@latest *), Bash(bunx --bun shadcn@latest *)`, which pre-authorises running the floating `@latest` CLI.
  - SKILL.md embeds a dynamic injection block that runs `npx shadcn@latest info --json` every time the skill loads, and instructs the agent to run `npx shadcn@latest docs <component>` and fetch the returned ui.shadcn.com URLs before writing components.
  - It instructs `init`, `add`, `add --all`, `apply <preset>` (overwrites components, fonts and CSS variables), and, in `design-system.md`, installing Fontsource font packages via the package manager and mapping a DESIGN.md onto the theme variables.
  - `scripts/showcase-coverage.mjs` is a read-only Node script (reads a ui directory and showcase sources, prints a coverage count); read in full, no network, no writes.
  - Runtime network: ui.shadcn.com docs and registries through the CLI.
- Persistent files / design authority: `design-system.md` and `design-system-page.md` tell the agent to turn a DESIGN.md into theme tokens, radius, shadows and fonts, restyle component variants, and build a design-system page. `customization.md` and the preset commands rewrite the Tailwind CSS file's variables. These are all design-authority actions.
- Size and signal: SKILL.md 296 lines. Repo last pushed 2026-11-10; 127,877 stars; repo created 2023-01-04.
- Verdict: **adviser-with-overrides.** The critical rules and rule files are accurate, current guidance for exactly the component layer the suite uses (including Radix-specific `asChild`). The automation around it is the problem. Overrides:
  - Do not install through `npx skills add`. Vendor the reviewed markdown and strip the `allowed-tools` line and the `!`-injection block, or the first load will execute `npx shadcn@latest`.
  - Never use `@latest`: use the CLI version pinned in the suite's lockfile (`pnpm exec shadcn`), and only for `info`, `docs`, `view`, `add --dry-run` and `--diff`.
  - Do not follow `design-system.md`, `design-system-page.md`, `apply`, `init --preset`, `add --all` or the Fontsource step. The suite's own tokens and fonts govern; no palette, font or radius decisions come from this skill.
  - The Next/RSC details (`isRSC`, `"use client"`) do not apply to a Vite SPA; `base` must be treated as `radix`.
  - "Registry must be explicit" (item 8 of its workflow) stays: never add third-party registry components without review of the item source.
  - Ignore `chat.md` unless a chat surface is being built.
- Rules that apply:
  1. Use existing components first; compose (settings page is Tabs plus Card plus form controls) before writing custom markup.
  2. `className` is for layout, not for overriding colour or typography; use variants first, then add a variant in the component's `cva`.
  3. Use semantic colour tokens only (`bg-background`, `text-muted-foreground`); no raw colour utilities and no manual `dark:` colour overrides.
  4. Use `flex` with `gap-*`, never `space-x/y-*`; `size-*` for equal width and height; `truncate`; `cn()` for conditional classes; no manual `z-index` on overlay components.
  5. Forms use `FieldGroup` and `Field`, with `data-invalid` on the field and `aria-invalid` on the control; use `FieldSet`/`FieldLegend` for related checkbox or radio groups.
  6. Items stay inside their Group; Dialog, Sheet and Drawer always carry a Title (visually hidden if needed); Tabs triggers live in `TabsList`; Avatar always has a fallback.
  7. Button has no loading prop: compose `Spinner` with `data-icon` and `disabled`; icons in buttons use `data-icon` and take no size classes.
  8. Use `Empty`, `Skeleton`, `Badge`, `Separator`, `Alert` rather than hand-built equivalents; after adding any registry item, read the files and fix imports and aliases.

## 6. frontend-design

- Repository: github.com/anthropics/skills. Default branch `main`. Head: `2c5958ecac7cee2b583967a2c4981d0f4a75c579` (2026-11-06).
- Path: `skills/frontend-design/SKILL.md` (exists as shortlisted). Files: `SKILL.md`, `LICENSE.txt`. Last commit touching the skill 2026-09-03.
- SHA-256 of SKILL.md: `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3`
- Licence: skill points to `LICENSE.txt`, which is the Apache License 2.0. The repository has no root LICENSE (API licence null) and its README says many skills are Apache-2.0 while the document skills have their own terms.
- Beyond markdown: nothing. No scripts, hooks, fetches or file-writing instructions. It mentions, as optional, a space to "jot down notes" about what was tried; no path is given.
- Size and signal: 71 lines. Repo created 2025-09-22; last pushed 2026-11-06; 192,605 stars.
- Verdict: **watchlist.** The skill's purpose is to produce a distinctive, brief-specific visual identity: a new palette of 4 to 6 named hex values, deliberately chosen typefaces, a layout concept and aesthetic risk. For an upgrade of an existing enterprise suite with one design authority, that purpose is the wrong tool. Its only reusable material is the writing section and the restraint/quality-floor paragraph, which other shortlisted skills already cover for review. No role assigned.
- Rules that apply (limited, and only the parts that do not touch visual identity):
  1. Name actions by what happens ("Save changes", not "Submit") and keep the same name for an action through the whole flow, including its confirmation message.
  2. Errors say what went wrong and how to fix it, without apologising; empty states point to the next action.
  3. Write from the user's task, in plain language, not from system internals (users manage notifications, not webhooks).
  4. Keep line length under about 80 characters for reading text; give serif body text slightly more line-height.
  5. Quality floor to meet without ceremony: responsive down to mobile, visible keyboard focus, reduced motion respected, accessible contrast.
  6. Where a brief fixes a direction, follow the brief exactly (this is the rule that keeps the suite's own documents in charge).

## 7. webapp-testing

- Repository: github.com/anthropics/skills. Head: `2c5958ecac7cee2b583967a2c4981d0f4a75c579`.
- Path: `skills/webapp-testing/SKILL.md` (exists). Files: `LICENSE.txt`, `scripts/with_server.py`, `examples/{console_logging,element_discovery,static_html_automation}.py`. Last commit touching the skill 2026-04-20.
- SHA-256 of SKILL.md: `51b7349e77ec63b7744a6f63647e7566a0b4d2e301121cc10e8c2113af6556a2`. `scripts/with_server.py`: `b0dcf4918935b795f4eda9821579b9902119235ff4447f687a30286e7d0925fd`.
- Licence: Apache-2.0 (skill `LICENSE.txt`); no repository root licence.
- Beyond markdown and what runs:
  - `scripts/with_server.py` (about 3.7 KB, read in full): starts one or more server commands with `subprocess.Popen(..., shell=True)`, polls a local TCP port until ready, then runs a following command and terminates the servers. It executes whatever command string it is given and makes no network calls other than a `localhost` socket probe.
  - The three example scripts are Playwright (Python) snippets for `localhost`; the console-logging example writes captured logs to a file.
  - SKILL.md tells the agent to run scripts with `--help` first and explicitly "DO NOT read the source", treating them as black boxes. That instruction is reversed here: the script has been read and hashed above.
  - It requires Python Playwright and a Chromium download, which SKILL.md does not install or pin.
  - No hooks, no runtime fetch, no persistent files beyond `/tmp` screenshots in the examples.
- Size and signal: SKILL.md 95 lines.
- Verdict: **adviser-with-overrides.** The reconnaissance-then-action pattern and the console-capture idea are sound, and the helper script is small and benign on inspection. The suite already has its own test runner, so this is a supplement, not the primary mechanism. Overrides:
  - Use only the pinned `with_server.py` (hash above), never a later copy, and only with fixed server commands written by the team. Do not pass commands derived from page content or fetched text.
  - Do not follow the "do not read the source" instruction for any other script.
  - Do not install Playwright or browsers as a side effect of the skill; the suite's existing browser-test tooling is used if browser verification is needed.
  - Screenshot output goes to the working scratch area, not `/tmp` paths hard-coded in examples.
  - SKILL.md says to use `networkidle` waits; with long-lived connections (Yjs websockets, query polling) that wait can hang, so wait for a named element instead.
- Rules that apply:
  1. Distinguish static from dynamic pages: read HTML for selectors when static; for dynamic apps navigate, wait for the app to render, then inspect.
  2. Reconnaissance first (screenshot or DOM dump), then choose selectors from the rendered state, then act.
  3. Prefer role, text and id selectors over brittle CSS paths.
  4. Capture browser console output during interaction and treat console errors as test findings.
  5. Always launch headless and close the browser at the end of every script.
  6. Add explicit waits for the target element rather than fixed sleeps.

## 8. Interface Design

- Repository: github.com/dammyjay93/interface-design. Default branch `main`. Head: `2f9be3206855bcb2d1d0af262c8bae25cba6658d` (2026-06-20).
- Path: `.claude/skills/interface-design/SKILL.md` (there is no top-level `skills/` folder; `.claude-plugin/plugin.json` points at `./.claude/skills`). Also `.claude/skills/interface-design/agents/openai.yaml`, commands `.claude/commands/design-review.md` and `design-deslop.md`, `reference/` examples, `.githooks/pre-commit`, a `website/` folder.
- SHA-256 of SKILL.md: `720b31a31276e899fbe3006a33cbfeaceb77a73ba4c27b80d29afd38c8b7b208`
- Licence: MIT (LICENSE file; API `MIT`).
- Beyond markdown: two slash commands (markdown only); `agents/openai.yaml` is UI metadata for Codex with `allow_implicit_invocation: true`; `.githooks/pre-commit` is a maintainer script that rewrites the plugin version with `sed` and `git add`, relevant only to contributors. No scripts in the skill, no Claude Code hooks, no runtime fetch. The README's install path is `npx skills add ...` (not run) or the Claude Code plugin marketplace.
- Persistent files and design authority: it tells the agent, after every task, to offer to save patterns and, if accepted, to write `.interface-design/system.md` (direction, depth strategy, spacing base, type scale, component measurements). It reads that file at the start of later work and treats it as decided. It also tells the agent to derive a "domain", a "color world" and a signature element, to name tokens after the product's world, and to avoid default system or Inter fonts where a direction was set. It optionally suggests image generation or an inline render tool for direction boards. All of this competes with the suite's design authority.
- Size and signal: SKILL.md 320 lines. Last commit 2026-06-20 (about five months before review, with no commits since); 5,958 stars. The version string is date-stamped and the pre-commit hook rewrites it on every commit.
- Verdict: **adviser-with-overrides.** The hierarchy, density, layering, "use what exists" and states material is exactly the composition vocabulary data-dense product UI needs, and it is scoped to dashboards, admin panels and tools. Overrides:
  - Never write or read `.interface-design/system.md`; decline the "save these patterns" offer. The suite's design documents are the only memory.
  - Do not run the domain/colour-world/signature exploration to choose a palette, fonts or token names; those exist already. Use only the hierarchy and layering questions.
  - Drop the mandatory per-component "Intent / Palette / Typography" declaration block, the "avoid Inter/system fonts" rule, the image-reference and render-tool steps, and the two commands unless a human invokes them for a bounded review.
  - Its "borders-only, shadows, layered or surface shifts: choose one and commit" must be answered by the suite's existing depth tokens, not by the skill.
- Rules that apply:
  1. One focal point per view; make it win by size, weight, contrast or surrounding space, and demote the rest deliberately.
  2. Hierarchy comes from three levers together: size, weight and colour or opacity. A single body size can carry value, label and meta tiers through weight and tone.
  3. Pick a type-scale ratio and step it (about 1.2 for dense UI) instead of choosing sizes by feel; four text-tone levels (primary, secondary, tertiary, muted) are the minimum.
  4. Decide density as concrete pixel values and hold them everywhere; use a 4 or 8 px base and multiples only.
  5. Surface elevation in small steps; popovers sit one level above their parent; inputs read as inset; borders are low-opacity and the squint test should still show structure.
  6. Native element first, then a headless primitive, then hand-rolled as a last resort; bind styling to semantic tokens and extract a component on the second real reuse.
  7. Every interactive element has default, hover, active, focus and disabled; data has loading, empty and error. Dynamic numbers use tabular figures; hit areas are at least 40 to 44 px.
  8. Concentric radius for nested rounded elements (outer = inner + padding); animate only `transform` and `opacity`; UI motion under about 300 ms; no animation on actions repeated hundreds of times a day.

## 9. Impeccable

- Repository: github.com/pbakaus/impeccable. Default branch `main`. Head: `c1e0e5492fbb524f5df84d635ecfae7dc438ec45` (2026-11-11). Plugin and skill version 4.8.2; engine binary version 0.1.22.
- Paths: there is no single skill file. The same skill is committed once per harness (about 28 directories such as `.claude/skills/impeccable/`, `.cursor/skills/`, `.agents/skills/`, `plugin/skills/impeccable/`, `cursor-plugin/skills/`), generated from `skill/SKILL.src.md` plus `skill/reference/`, `skill/agents/` and `skill/scripts/`. The Claude Code project layout is `.claude/skills/impeccable/SKILL.md`; the Claude Code plugin build is `plugin/skills/impeccable/SKILL.md`. Last commit touching the Claude skill 2026-11-09.
- SHA-256: `.claude/skills/impeccable/SKILL.md` = `637b7b727122a273912454e6c7c2d7775186eb0c3c379c2a7c13bec595c61619`; `plugin/skills/impeccable/SKILL.md` = `07336fc855b26edc34d2c211d3f91f8a32398221bf7e2c952a8e9c631c5f46bd` (differs only by path variables). Launcher `.claude/skills/impeccable/scripts/impeccable` (shell): `9a82c1d8a5fc34b0edb3040cf25098c7c5a662e703118e99f96bacd543ed6d68`.
- Licence: Apache-2.0 (LICENSE; API `Apache-2.0`). `NOTICE.md` credits MIT-licensed material derived from ehmo/platform-design-skills for the iOS and Android references.
- Beyond markdown and what runs (this is the largest surface of any skill reviewed):
  - A shell launcher `scripts/impeccable` and `impeccable.cmd`. SKILL.md Setup step 1 requires running `scripts/impeccable context` at the start of every session. The launcher looks for a binary in order (an env override, a sibling binary, `~/.impeccable/bin`, a version cache) and, as a last resort, downloads a platform binary with `curl` or `wget` from `https://github.com/pbakaus/impeccable/releases/download` (engine tag `engine-v0.1.22`), verifies it against `scripts/engine-checksums.txt`, caches it under the user's home directory and executes it. The binary was not fetched or inspected; its Rust source is in `crates/`, which was not audited.
  - Hooks: `.claude/settings.json` and `plugin/hooks/hooks.json` register `SessionStart`, `PostToolUse` (matcher `Edit|Write`) and `Stop` hooks that run `scripts/impeccable hook` (5 s, 5 s and 30 s timeouts). The README says the installer (`npx impeccable install`) sets these up. Codex, Cursor, Grok and Copilot hook files exist too.
  - `reference/live.md` describes a local helper HTTP server that injects a script (`live-browser.js`, 564 KB, plus several smaller scripts) into the running dev page to pick elements and hot-swap variants, writing temporary components into `node_modules/.impeccable-live/`. `reference/doctor.md` and `reference/hooks.md` modify project files and the hook.
  - Runtime network: the engine download above; `font-match` uses a bundled 1.1 MB Google Fonts index; the README also lists a browser extension and `npx impeccable detect <url>`.
  - A dozen sub-agents are defined under `plugin/agents/`.
- Persistent files and design authority: `init` writes `PRODUCT.md`; `document` and new-work write `DESIGN.md` (and a sidecar); config goes to `.impeccable/config.json` and `.impeccable/live/`, with review images and a build journal under `.impeccable/`. SKILL.md says DESIGN.md wins on visual decisions. New-work can "choose a replacement world" and replace DESIGN.md, and the redesign rule says to treat the old look as an anti-reference. This is a full competing design authority by default.
- Size and signal: SKILL.md 87 lines, but with about 40 reference files (`new-work.md` alone 64 KB, `critique.md` 46 KB) and a large script payload. 107,763 stars; very active (head commit the morning of the review; two releases on 2026-11-09).
- Verdict: **adviser-with-overrides.** The `audit`, `critique`, `polish`, `harden`, `layout` and `typeset` references are substantive, and the `craft-floor.md` checks are specific. But as shipped, installation fetches and runs an unreviewed binary and installs three hooks that act on every edit. It is therefore usable only as a content-only subset, invoked deliberately. Overrides:
  - Do not install via `npx impeccable install` or the plugin; do not enable the hooks; do not run `scripts/impeccable` in any form, including `context`, `hook`, `live`, `pin`, `detect` and `doctor`. Use the launcher-unavailable path that SKILL.md itself describes: read PRODUCT.md and DESIGN.md directly. Because those two names would collide with the suite's own documents, point the skill at the suite's design documents and refuse any step that creates or rewrites `PRODUCT.md`, `DESIGN.md` or `.impeccable/`.
  - Do not use `init`, `document`, `extract`, `new-work`, `live`, `generate`, `overdrive`, `bolder`, `delight` or the `comp` build path. Permit only `audit`, `critique`, `polish`, `harden`, `layout`, `typeset`, `clarify` and `adapt`, each as a read-and-report pass or a bounded edit to named files.
  - Its refusals are tuned for marketing sites and clash with data-dense product UI: bans on the hero-metric pattern, sparklines, progress rings and identical cards would reject legitimate KPI and table-row patterns; the suite's component kit decides those.
  - Its font and "load a hosted face" guidance must not override the suite's font stack.
  - Re-review at any new `skill-v` or `engine-v` tag before use, since the engine binary changes independently of the markdown.
- Rules that apply:
  1. Verify against the rendered result at shipped widths and batch the checks; fix everything one look reveals before looking again.
  2. Contrast: body and placeholder text at least 4.5:1, large text at least 3:1; tint secondary text from the surface hue rather than using flat grey.
  3. Check every state: hover, disabled, loading, error, empty, plus real content, working controls and keyboard focus.
  4. Theme the browser-default surfaces too: selection colour, caret, scrollbars, focus rings and tabular numerals in data tables.
  5. Keep a refinement inside the incumbent identity: a refinement preserves behaviour, copy and everything outside the named scope (this is the property that makes it safe next to a design authority).
  6. Body measure of 65 to 75 characters for reading text; run the real copy at every breakpoint and fix overflow.
  7. On Operate-mode surfaces (apps, dashboards, editors, settings) scanability and consistency outrank expression; brand lives in precise detail.
  8. Run hardening on error, long-text, empty and i18n cases before shipping.

## 10. UI/UX Pro Max

- Repository: github.com/nextlevelbuilder/ui-ux-pro-max-skill. Default branch `main`. Head: `6ae86f61f520d6ca229d2f40e070410638c908c5` (2026-11-10). Version 2.15.0.
- Path: `.claude/skills/ui-ux-pro-max/SKILL.md`. The skill is duplicated at `src/ui-ux-pro-max/` (source) and `cli/assets/skills/` (npm package assets). Companion skills in the same repo: `ui-styling`, `design`, `design-system`, `brand`, `banner-design`, `slides`. Last commit to the SKILL.md 2026-11-07.
- SHA-256 of SKILL.md: `14f43337edfbf7822e091428e4ae0c6f92f86e3353deda6a30f6613121e2cf2d`
- Licence: MIT (LICENSE; plugin manifest and API agree). One companion (`ui-styling`) carries an Apache-style `LICENSE.txt` of its own.
- Beyond markdown and what runs:
  - Python scripts (`scripts/search.py`, `core.py`, `design_system.py`, `reasoning_contract.py`, `validate_data.py`) invoked as `python "${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py" ...` at every query. Core scripts `core.py`, `design_system.py`, `search.py` and `reasoning_contract.py` were read for network and subprocess use (pattern search) and showed none; `validate_data.py` (52 KB) and the test fixtures were not read.
  - Several MB of local data (CSV palettes, fonts, icons and a 747 KB Google Fonts table, a 823 KB Phosphor icon JSON).
  - Companion skills ship network and process code: `design/scripts/logo/generate.py` calls `api.atlascloud.ai` and `api.muapi.ai`; `design/scripts/icon/generate.py` needs `GEMINI_API_KEY` and loads `.env` values into the environment; `design-system/scripts/fetch-background.py` references Pexels image URLs; `ui-styling/scripts/shadcn_add.py` runs `subprocess` shell commands. None of these are in scope, but `npx`-style install of the whole repository (`cli/`, package `uipro-cli`) would deliver them. A `stack/` folder contains a sample `.claude/settings.json` with permissive Bash and MCP allowances (`enableAllProjectMcpServers: true`) and a `setup.sh`.
  - No Claude Code hooks found in the plugin manifest.
- Persistent files and design authority: Step 2 of the workflow is marked REQUIRED for new pages: generate a design system (pattern, style, palette, typography, effects) from its tables. Step 2b with `--persist` writes `design-system/<project>/MASTER.md` and `pages/*.md` as a "Global Source of Truth", to be re-read and treated as authoritative in later sessions. This is a second design authority by design.
- Size and signal: SKILL.md 217 lines plus `references/quick-reference.md` (about 25 KB, 120 rules) and `references/pro-rules.md`. 147,912 stars; very active. Its examples and the Pre-Delivery Checklist are weighted toward consumer and mobile products (marketing landing pages, iOS and Android, GSAP presets, glassmorphism styles).
- Verdict: **reject** for this programme. Its central function, generating and persisting a palette, font pairing and style, is the one thing the suite does not permit, and the large companion payload (image-generation and shell scripts, API keys) widens the install surface far beyond what a review adviser needs. The checklists it contains duplicate material in the other advisers. If its rules are ever wanted, read `references/quick-reference.md` as a document rather than installing the skill.
- Rules (from `references/quick-reference.md`, not from the workflow) that apply if the document is consulted:
  1. Charts need a legend near the chart, tooltips that are also keyboard-reachable, and a text summary or `aria-label` stating the key insight.
  2. Never use colour alone to separate series; add shape, pattern or direct labels; data marks need at least 3:1 contrast, data text 4.5:1.
  3. Data tables are sortable with `aria-sort` and offer a table alternative to charts.
  4. Virtualise lists of 50 or more items; aggregate or sample chart data beyond about 1,000 points and provide drill-down.
  5. Locale-aware number, date and currency formatting on axes and labels.
  6. Specific errors sit below the field and are linked with `aria-describedby`; focus must not be obscured by sticky UI (WCAG 2.2).
  7. Empty, loading and error states for charts must be designed, not blank axes.

## 11. Dashboard Design Skill

- Repository: github.com/abdiraimov-otabek/dashboard-design-skill. Default branch `main`. Head: `463b8fdf62c640180ec1ba731f3616c2319bf68c` (2026-11-09).
- Path: `skills/dashboard-design/SKILL.md`, with 10 files under `references/` (`components.md`, `snippets.md`, `swiftui.md`, `perception.md`, `qa.md`, `tokens.md`, `layout.md`, `sources.md` and two case studies). Also `examples/` with three standalone HTML pages and `docs/images/`. Last commit to the SKILL.md 2026-11-09.
- SHA-256 of SKILL.md: `f3aa51ab461bb3ae12319a8d97964a6fa84ddf0e8526f2988ea84cb73b2c665e`
- Licence: MIT (LICENSE; manifest and API agree).
- Beyond markdown: nothing executes. The three example HTML files and screenshots are static. `qa.md` suggests installing Playwright (`npm i -D playwright && npx playwright install chromium`) for screenshot checks; that is advice text, not run. No hooks, no scripts, no runtime fetch. `snippets.md` is React plus Tailwind code; `swiftui.md` is out of scope.
- Persistent files and design authority: no memory files. But `tokens.md` supplies a complete starter palette (accent `#3e63dd`, money green, light and dark values) and the SKILL.md "House style" paragraph sets a default look; it does state that a project's own design system wins and that a user's stated taste wins over both.
- Promotional content: the skill's "Sign-off" section tells the agent to end each finished job with a line promoting the author's two commercial Mac apps with referral-tagged links. That is an instruction to emit third-party advertising in output and must be removed.
- Size and signal: SKILL.md 115 lines. Repo created 2026-10-20 (three weeks before review), 13 commits, 446 stars, 25 forks. Cites its sources, including Few, Tufte, Knaflic and NN/g, and a case study of its own redesigns.
- Verdict: **watchlist.** The content is the most on-topic of the set for dashboards and data-dense screens (honest numbers, comparison baselines, known-totals testing), but the repository is three weeks old with a small history and a promotional instruction. Revisit after it has a longer track record; meanwhile its rules may be read as a document by a human. No role assigned.
- Rules that apply:
  1. Name the screen's one question, the three to six numbers that answer it and the problem thresholds as numbers before any UI work.
  2. Every headline number has one baseline (previous period at the same elapsed time, target, or normal range); a number shown twice must agree everywhere.
  3. Numbers use tabular figures, right-aligned in columns; `—` for no data rather than a fake zero; tiny bases never produce a red minus 100 percent.
  4. Verify numbers before pixels: seed a fixed dataset, work out totals outside the dashboard code, and make a test that fails when a tile, chart and table disagree.
  5. Colour follows meaning: grey for healthy data, a warm hue only for what needs attention; red and green never carry meaning alone; define every colour as a light and dark token.
  6. Design every state: loading, stale, error, empty, tiny data, sample data.
  7. Test on messy real data (zero days, a huge outlier, longest names and locale) and with colour-vision emulation and forced colours.
  8. Dashboards use the available width (more columns, not a narrow centred column), and the monitoring view fits above the fold at 1440 by 900.

---

## Operating rules

1. One design authority. The suite's own design documents decide palette, type, spacing, radius, elevation, density and copy. No skill creates, stores or reads a competing token set, `system.md`, `MASTER.md`, `PRODUCT.md`, `DESIGN.md` or similar file. A skill's offer to "save" or "remember" is declined.
2. No global installs. No `npx skills add`, `npx impeccable install`, plugin-marketplace installs, or `-g` variants. A skill is used only as a vendored, hash-checked copy of the reviewed markdown, with executable parts (dynamic injection lines, `allowed-tools` grants, hooks, launchers) removed. The CLI versions the suite already pins are the only CLIs that run.
3. No unreviewed scripts. Only files listed in this manifest with a recorded hash may be executed, and only the two small scripts read in full (`webapp-testing/scripts/with_server.py` and `shadcn/scripts/showcase-coverage.mjs`) qualify today. The Impeccable launcher and engine, every UI/UX Pro Max script and every companion-skill generator remain unreviewed and unused.
4. No floating content fetched during builds or reviews. The web-design-guidelines document is read from commit `434b7f91364665f2f733b310ec54809bf8f37937`, never from `main`. Documentation URLs returned by `shadcn docs` are consulted by a human, not injected into automated runs.
5. Assigned roles. Composition: Interface Design. Implementation: shadcn plus building-components (with vercel-composition-patterns as the API-shape reference). Review: web-design-guidelines, with vercel-react-best-practices for performance review only. Refinement: Impeccable, when deliberately invoked by a person, content-only, restricted to the commands listed in its section. Verification: the suite's existing tests, with webapp-testing as a supplement. frontend-design and Dashboard Design Skill are on the watchlist with no role; UI/UX Pro Max is rejected.
6. Precedence and upgrades. The suite's design documents and its business and security contracts override any skill. Where two skills disagree, the more conservative rule applies and the conflict is noted in the review. A skill is upgraded only by re-reviewing it at a new revision and recording a new SHA and file hash here.
