# Backlog

1. **Rich text editor:** merge AutoDealer and TuroApp `RichTextEditor.jsx` (Tiptap) into one optional entry point, `@mn/kit/editor`.
2. **List filters (rest):** the checklist `FilterMenu` shipped in v0.3.0; still to port: the price/cost range slider, SortTh and ColumnOrder, per AutoDealer `docs/decisions/list-filters.md`.
3. **DataTable:** a sortable table with sticky header and card layout on phones.
4. **Adopt in apps:** TuroApp first (closest match), then AIAgent and BigLoveInstall; AutoDealer last (largest CSS surface).
5. **Signup UI:** a self-serve sign-up form (the server side already supports `signup: true`).
6. **AutoDealer on the server kit:** its auth has API tokens and a customer portal on top; move it only once another app has used the kit for a while.

## Done

- 2026-11-14: v0.3.0 Project Hub UI: SidebarLayout, NavList, InitialIcon, ThemeSwitch, FilterMenu, GroupedList, highlight, useUrlList
