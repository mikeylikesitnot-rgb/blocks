# Backlog

1. **Rich text editor:** merge AutoDealer and TuroApp `RichTextEditor.jsx` (Tiptap) into one optional entry point, `@mn/kit/editor`.
2. **Adopt in apps:** TuroApp first (closest match), then AIAgent and BigLoveInstall; AutoDealer last (largest CSS surface).
3. **AutoDealer on the server kit:** its auth has API tokens and a customer portal on top; move it only once another app has used the kit for a while.

## Done

- 2026-11-14: v0.6.0 sign-up on LoginPage (F-016): "Create an account" with name + email and an emailed code, shown when the server has `signup` and a mailer; `/code/verify` takes the name for the new account
- 2026-11-14: v0.6.0 list filter pieces (F-015): RangeFilter, useSavedFilters, listParam/rangeParam/inRange/rangeBounds, SortTh + useSort, ColumnOrder + useColumnOrder, per AutoDealer list-filters.md
- 2026-11-14: v0.5.0 server packages (jose, bcryptjs, nodemailer, express-rate-limit) are optional peer dependencies, so client-only installs skip them
- 2026-11-14: v0.4.0 DataTable (F-014): sortable table with sticky header and card layout on phones, ported from TuroApp
- 2026-11-14: v0.3.0 Project Hub UI: SidebarLayout, NavList, InitialIcon, ThemeSwitch, FilterMenu, GroupedList, highlight, useUrlList
