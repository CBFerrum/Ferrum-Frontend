---
name: ferrum-ui-craft
description: Use for any change to a Ferrum interface: in this repository (shell, Studio, @ferrum/kit) or in an app's ui/ built with packages/build/cli.mjs. Covers designing, implementing and reviewing screens (inbox, file browser, editor host, record, builder, analytics, administration) with the kit's tokens and components, keeping accessibility, drafts and recovery.
---

# Ferrum UI craft

For work on how a Ferrum interface looks, behaves and recovers. It is a development skill, not a runtime business skill. Read `CLAUDE.md` and `docs/design/README.md` first; the values (tokens, type roles, patterns) are in `docs/design/FOUNDATIONS.md` and `PATTERNS.md`, so read them there instead of copying numbers from memory. Decide first whether the task is a source audit, a visual design, an implementation or a validation, and do not substitute one for another.

## Workflow

1. Record what you start from: the app and `@ferrum/kit` versions, and the actual screen. Capture it in a real browser, or say that capture was not possible.
2. State the user's primary job, what matters most on the screen, the main action, and the states the screen needs (loading, first-use empty, no matches, denied, stale, failed), plus data volume and permission scope.
3. Pick an existing task layout from `docs/design/PATTERNS.md`. A new layout needs a reason drawn from the real content.
4. Use kit exports and semantic tokens. If the kit lacks a pattern, add a governed one to the kit (`src/` here) instead of forking in the app. Compare upstream before changing a locally owned shadcn component.
5. Build a small vertical slice. Do not change business ownership, permissions, money precision or file formats.
6. Run `npm run typecheck`, `npm test` and `npm run lint:ui` here; in an app's `ui/`, `cli.mjs typecheck`, `test` and `check`. A lint finding is fixed or explained with `ui-lint-allow <rule>: <reason>`; never raise the baseline to make a run pass.
7. Exercise keyboard, touch, locale (RTL, Arabic, Hindi), narrow viewports, slow network and conflict cases that the task touches. Keep drafts through navigation and failure; never show success before the durable milestone.
8. Record the result against the matching scenarios in `docs/design/ACCEPTANCE.md`, with evidence. Leave the rest `not_run`.

## Evidence classes

These are different, and none may be claimed without having been done:

- source review: reading the code or a diff
- component test: a unit test of one component (vitest)
- real-browser capture: the running interface, with pinned browser, fonts, data, role, theme, locale and viewport
- human review: a person looked at it, or used it

Say which you did. "TypeScript compiles" and "the screenshot looks good" are not a pass. An automated accessibility scan does not replace human review. Do not upload private screenshots or documents to outside tools.

## Do not

Add per-app theme overrides or forked primitives, wrap every screen in cards and KPIs, match label text to choose a status colour, weaken an editor's iframe security, change the root font size, block zoom, or write a blank loading fallback. A good result makes the task clearer and more trustworthy: distinctive is not decorative, dense is not cramped, consistent is not identical.
