# Backlog

1. **List filters (rest):** the checklist `FilterMenu` shipped in v0.3.0; still to port: the price/cost range slider, SortTh and ColumnOrder, per AutoDealer `docs/decisions/list-filters.md`.
2. **Adopt in apps:** TuroApp first (closest match), then AIAgent and BigLoveInstall; AutoDealer last (largest CSS surface).
3. **Signup UI:** a self-serve sign-up form (the server side already supports `signup: true`).
4. **AutoDealer on the server kit:** its auth has API tokens and a customer portal on top; move it only once another app has used the kit for a while.

## Done

- 2026-11-14: v0.7.0 rich text editor (F-016): `@mn/kit/editor` merges AutoDealer's and TuroApp's Tiptap editors, saving the same HTML; Tiptap packages are optional peer dependencies. TuroApp adopts it first; AutoDealer later
- 2026-11-14: v0.5.0 server packages (jose, bcryptjs, nodemailer, express-rate-limit) are optional peer dependencies, so client-only installs skip them
- 2026-11-14: v0.4.0 DataTable (F-014): sortable table with sticky header and card layout on phones, ported from TuroApp
- 2026-11-14: v0.3.0 Project Hub UI: SidebarLayout, NavList, InitialIcon, ThemeSwitch, FilterMenu, GroupedList, highlight, useUrlList
