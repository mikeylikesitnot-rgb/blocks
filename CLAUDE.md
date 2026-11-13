# mn-kit

Shared React UI kit (tokens, components, overlays) consumed by Michael's apps
as a git dependency: `npm install github:mikeylikesitnot-rgb/mn-kit`.

- Source is shipped as-is (`src/*.jsx`, no build step); consumers' Vite compiles it.
- Plain CSS: classes `mk-*`, variables `--mk-*`. No Tailwind, no icon lib, no router.
- Rules: [docs/decisions/style-guide.md](docs/decisions/style-guide.md). Read before changing anything visual.
- Every change: update `demo/main.jsx`, add tests in `test/`, run `npm test` and `npm run build:demo`,
  and check the demo at 390px and 1280px in light and dark.
- Breaking a component's props is a minor version bump plus a note in README; tag releases `vX.Y.Z`.

## Process (devflow)

- tier: light
- verify: `npm test && npm run build:demo`
- branch: `main`
- worktrees: `.claude/worktrees/<task>` (always `--lock`)
- backlog: `BACKLOG.md`
- mockups: no (the demo page is the mockup)
- ship: commit → verify → merge to `main` → push → tag `vX.Y.Z`
- deploy: none (apps pull it with `npm update @mn/kit`)
- features: `features.json`
