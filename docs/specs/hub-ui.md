# Spec: Project Hub UI in mn-kit (v0.3.0)

Status: shipped 2026-11-14 as v0.3.0 (approved in chat, option A).

## Story
As the owner, I want the Project Hub layout in mn-kit, so any app can have the
sidebar, filters and grouped list without rebuilding them.

## Acceptance criteria
- [x] `SidebarLayout`, `NavList`, `FilterMenu`, `GroupedList` and `highlight` are exported from `@mn/kit`, using only `mk-*` classes and `--mk-*` tokens.
- [x] Nothing scrolls sideways at 390px; the sidebar becomes a slide-out menu on phones.
- [x] The demo has a "Project hub" tab that rebuilds the hub page from sample data.
- [x] Tests for each; `npm test && npm run build:demo` passes.
- [x] README and `features.json` updated; released as v0.3.0.

## Plan
- New: `src/Shell.jsx` (SidebarLayout, NavList, InitialIcon, ThemeSwitch), `src/FilterMenu.jsx`,
  `src/GroupedList.jsx`, `src/highlight.jsx`; `useUrlList` in `src/search.js`; `MenuIcon`.
- Tokens: 8 category colours, search highlight, sidebar surfaces (light and dark).
- `useTheme` now keeps every user in step (header toggle + sidebar switch).
- Demo tab `demo/HubDemo.jsx`; tests `test/hub-ui.test.jsx`.

## Not doing
- The price/cost range slider, SortTh and ColumnOrder (rest of backlog item 2).
- Saving filters to an account: apps own their API.
- Changing the hub page itself (single HTML file, no React).
