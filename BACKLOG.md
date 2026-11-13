# Backlog

1. **Server kit:** cookie JWT auth (password + Google Sign-In, idle/hard timeout, token_version logout), rate limiters, and the mailer, made generic from AutoDealer `server/middleware/auth.js`, `routes/auth.js` and `lib/mailer.js`.
2. **Email templates:** branded HTML emails (react-email) for login codes, password reset, notifications. Nothing exists yet; AutoDealer sends plain text.
3. **Login UI:** a LoginPage component (password + Google button + error states) to pair with the server kit.
4. **Rich text editor:** merge AutoDealer and TuroApp `RichTextEditor.jsx` (Tiptap) into one optional entry point, `@mn/kit/editor`.
5. **List filters:** port AutoDealer's MultiSelectFilter / FilterMenu / SortTh / ColumnOrder per AutoDealer `docs/decisions/list-filters.md`.
6. **DataTable:** a sortable table with sticky header and card layout on phones.
7. **Adopt in apps:** TuroApp first (closest match), then AIAgent and BigLoveInstall; AutoDealer last (largest CSS surface).
