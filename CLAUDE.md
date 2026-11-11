# Ferrum-Frontend

React 19 / Vite 7 / Tailwind v4 / shadcn-Radix web interfaces (shell, Studio) and `@ferrum/kit`, the public design-system contract that ~37 app repositories build against via `packages/build/cli.mjs`.

Start with `docs/design/README.md`; for any interface change use the `ferrum-ui-craft` skill (`.claude/skills/ferrum-ui-craft/SKILL.md`).

## Hard rules for UI work
- Use `@ferrum/kit` exports. Missing pattern: add a governed one to the kit. Never fork a primitive in an app or import `radix-ui` / `class-variance-authority` there. Edit locally owned shadcn components only after comparing upstream.
- Semantic tokens only: no hex / `rgb()` / `hsl()` / `oklch()` outside the token file. Type roles only (`text-xs`..`text-2xl`): no `text-[13px]`, nothing under 12px.
- Do not change the root font size. Do not add `user-scalable=no` / `maximum-scale=1`. Use logical properties (RTL, Arabic, Hindi).
- Status colour comes from a stable state id, never from label text.
- Loading, first-use empty, no matches, denied, stale and failed are different states. No `fallback={null}`; use content-shaped skeletons.
- Never show save, send, payment or approval as done before the durable milestone. Keep drafts through navigation and failure.
- Keep TanStack Query and virtualization; no new animation or component library for one flourish.
- Never weaken iframe sandbox/CSP for an editor. No customer CSS over warnings or host chrome.
- Evidence classes differ: source review, component test, real-browser capture, human review. Claim only what was done. Compiling is not "done".
- `src/**` token and kit changes are versioned: record the kit version in what you ship.

## Commands
- `npm run typecheck`
- `npm test`
- `npm run lint:ui` (ratchet against `ui-lint-baseline.json`; `-- --update-baseline` only lowers it; explain an exception with `ui-lint-allow <rule>: <reason>`)
- `npm run build:apps`

Never run prettier here: the repository is not formatted by it, and a reformat buries real changes. Match the surrounding style.
