# Backlog

1. **Adopt in apps:** TuroApp and AIAgent are on the kit; BigLoveInstall is being moved; AutoDealer last (largest CSS surface).
2. **AutoDealer on the server kit:** its auth has API tokens and a customer portal on top; move it only once another app has used the kit for a while.
3. **AutoDealer on the shared editor:** switch its RichTextEditor/RichText/RichTextField to `@mn/kit/editor` (pass `disable={['heading','codeBlock','horizontalRule']}`), with its own deploy.

## Done

- 2026-11-15: v0.7.0 rich text editor (F-017): `@mn/kit/editor` merges AutoDealer's and TuroApp's Tiptap editors, saving the same HTML; Tiptap packages are optional peer dependencies. TuroApp adopts it first; AutoDealer later
- 2026-11-14: v0.6.0 sign-up on LoginPage (F-016): "Create an account" with name + email and an emailed code, shown when the server has `signup` and a mailer; `/code/verify` takes the name for the new account
- 2026-11-14: v0.6.0 list filter pieces (F-015): RangeFilter, useSavedFilters, listParam/rangeParam/inRange/rangeBounds, SortTh + useSort, ColumnOrder + useColumnOrder, per AutoDealer list-filters.md
- 2026-11-14: v0.5.0 server packages (jose, bcryptjs, nodemailer, express-rate-limit) are optional peer dependencies, so client-only installs skip them
- 2026-11-14: v0.4.0 DataTable (F-014): sortable table with sticky header and card layout on phones, ported from TuroApp
- 2026-11-14: v0.3.0 Project Hub UI: SidebarLayout, NavList, InitialIcon, ThemeSwitch, FilterMenu, GroupedList, highlight, useUrlList
