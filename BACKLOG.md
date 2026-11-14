# Backlog

1. **Rich text editor:** merge AutoDealer and TuroApp `RichTextEditor.jsx` (Tiptap) into one optional entry point, `@mn/kit/editor`.
2. **List filters:** port AutoDealer's MultiSelectFilter / FilterMenu / SortTh / ColumnOrder per AutoDealer `docs/decisions/list-filters.md`.
3. **Adopt in apps:** TuroApp first (closest match), then AIAgent and BigLoveInstall; AutoDealer last (largest CSS surface).
4. **Signup UI:** a self-serve sign-up form (the server side already supports `signup: true`).
5. **AutoDealer on the server kit:** its auth has API tokens and a customer portal on top; move it only once another app has used the kit for a while.

## Done

- **DataTable** (F-011, 2026-11-14): sortable table with sticky header and card layout on phones, ported from TuroApp.
