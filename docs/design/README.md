# Ferrum design

`@ferrum/kit` is the public design system, and the contract that about 37 separate app repositories build against (through `packages/build/cli.mjs`). It is layered: tokens, then primitives, then patterns, then task layouts, then each app's own experience. A layer uses only the ones below it. A fix made in the kit reaches every app on its next build; a fork made in one app reaches none and drifts.

- [FOUNDATIONS.md](FOUNDATIONS.md): tokens, type roles, density, geometry
- [PATTERNS.md](PATTERNS.md): governed patterns and task layouts
- [EVIDENCE.md](EVIDENCE.md): which kinds of proof exist and what each can claim
- [SKILLS.md](SKILLS.md): the rules for coding agents, and the `ferrum-ui-craft` skill
- [ACCEPTANCE.md](ACCEPTANCE.md): the 58 scenarios and their state

## How to stay consistent

1. Use what `@ferrum/kit` exports. If it lacks a pattern, add a governed one to the kit; do not fork Button, Menu or Dialog (or import Radix or `class-variance-authority`) in an app.
2. Colours come from semantic tokens, never from hex, `rgb()`, `hsl()` or `oklch()` literals. Raw values belong only in the token definitions.
3. Text sizes come from the type roles (`text-xs` to `text-2xl`). Nothing renders under 12px; no `text-[13px]`.
4. Keep these states apart, each with its own look and words: loading, first-use empty, no matches, denied, stale, failed. A blank Suspense fallback is not a loading state; shape it like the content.
5. Status tone comes from a stable state id, never from matching label text (labels are translated and edited).
6. Never block browser zoom (`user-scalable=no`, `maximum-scale=1`).
7. Run `npm run lint:ui` here, or `node .../packages/build/cli.mjs lint` in an app's `ui/` (the app's `check` runs it too). It fails when a file has more findings than `ui-lint-baseline.json` allows; when counts drop, run it with `--update-baseline` so the baseline only goes down.
8. An exception needs a reason, written where it is: `// ui-lint-allow raw-color: a user's own colour is data`.
