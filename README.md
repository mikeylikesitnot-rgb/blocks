# Blocks

`@mn/blocks` (called mn-kit, `@mn/kit`, before v0.9.0). Shared code for all of Michael's web apps, so no app rebuilds buttons,
modals, a login screen, sign-in sessions or emails again.

**UI (`@mn/blocks`)**

- **Tokens:** colour, type, spacing, radius and shadow from AutoDealer, plus a dark theme.
- **One button system:** 7 variants, 4 sizes, loading and icon-only.
- **Layout:** PageHeader, Panel, StatCard/StatGrid, Tabs, Segmented, Toolbar.
- **App frame:** `SidebarLayout` (sidebar on desktop, slide-out menu on phones), `NavList`, `InitialIcon`, `ThemeSwitch`.
- **Lists:** `FilterMenu` (checklist dropdown), `RangeFilter` (price/cost slider with Min/Max boxes), `GroupedList` (grouped rows with ID, badge and side cells), `highlight`.
- **List filters:** `useSavedFilters` (filters in the URL, remembered per browser session and saved per browser or account; a shared link wins), `listParam`, `rangeParam`, `inRange`, `rangeBounds`.
- **Tables you build yourself:** `SortTh` + `useSort` (sortable header cells), `ColumnOrder` + `useColumnOrder` (show, hide and move columns, remembered), `OrderedCells` (hand-written cells in the saved order, with header drag), `MenuButton` (a short action menu).
- **Attachments:** `FileDrop` (drag, drop or pick, with type and size checks), `usePasteFiles` (⌘V a screenshot anywhere in a panel, even while typing; text pastes stay text), `AttachmentGrid` (image thumbnails that open in a `Lightbox`, other files as download rows), `formatBytes`, `checkFiles`. UI only: the app uploads and serves the files.
- **Inputs:** Input, Textarea, SearchInput, Select, Field (label + hint/error, wired for screen readers).
- **DataTable:** sortable columns, sticky header, drag-to-reorder columns, auto right-aligned numbers, built-in loading/empty/filtered states, and a card list on phones. Pass `singleLayout` when cells hold inputs, selects or buttons: only the layout for the current width is rendered, so each control exists once.
- **States:** EmptyState (empty / filtered / error), Skeleton, SkeletonRows, SkeletonStats, Banner.
- **Overlays:** Modal (bottom sheet on phones), plus `useConfirm`, `useAlert` and `useToast` to replace `window.confirm`/`alert`.
- **Login:** `LoginPage` (password, Google, emailed code, and sign-up when the server allows it), `SessionProvider`, `useSession`, `AuthGate`.
- **Rich text editor (`@mn/blocks/editor`, optional):** `RichTextEditor` (Tiptap), `RichText` viewer, lazy `RichTextField`. See below.
- **Helpers:** `matchesQuery` (forgiving search), `useUrlState` (state kept in `?key=`), `useUrlList` (a list kept as `?key=a,b`), `useTheme` (light/dark/system), and inline SVG icons.

**Server (`@mn/blocks/server`, Express)**
- **Sign-in:** `createAuth()` covers password, Google and email-code login, password reset, logout on every device, 30-minute idle and 8-hour hard timeouts, and roles.
- **Users:** `pgStores(pool)` + `authSchemaSql()` for a new Postgres app, `memoryUserStore()` for prototypes, or three functions over an existing users table.
- **Email:** `createMailer()` (SMTP; prints to the console in dev) and branded templates: `loginCodeEmail`, `passwordChangedEmail`, `inviteEmail`, `notificationEmail`, `renderEmail`.
- **Rich text (`@mn/blocks/server/richtext`):** `sanitizeRich` / `cleanRich` clean editor HTML before it is stored (needs `sanitize-html`; kept off the main `/server` entry so that one never needs it).
- **Saved UI choices:** `uiPrefsRouter({ store })` serves GET/PUT `/:key` (mount after `express.json()`) for `useSavedPref` and `useSavedFilters`; pass the app's own `{get, set}` or `pgUiPrefStore(pool)` (`@mn/blocks/server/ui-prefs` alone needs only Express).
- **Also:** `createLimiter` / `createFormLimiter` / `createCostLimiter`, `encrypt` / `decrypt` for stored secrets.

**Auto update ([docs/decisions/auto-update.md](docs/decisions/auto-update.md))**
- **Desktop apps (`@mn/blocks/desktop-update`, Electron main):** `createUpdater()` checks GitHub Releases (private repos with a read-only token kept by `tokenStore`), downloads with a sha256 check and installs: silent NSIS on Windows, an .app swap from the release .zip on macOS (works unsigned). `ops/desktop-release.mjs` builds and publishes a release.
- **Chrome extensions (`@mn/blocks/ext-update`):** `startExtUpdate()` reloads an unpacked extension when `ops/ext-update.sh` has copied in a newer manifest version (or shows a ↑ badge in notify mode).

Plain CSS with `mk-` prefixed classes and `--mk-` variables. No Tailwind,
no icon library, no router needed. Peer dependencies: React 18 or later for the UI, Express 4.21 or later for the server.

## Use it in an app

```bash
npm install github:mikeylikesitnot-rgb/blocks
```

A client-only app needs nothing else. An app that uses `@mn/blocks/server` or
`@mn/blocks/email` also installs the server packages itself (since v0.5.0 they are
optional peer dependencies, so client installs stay small):

```bash
npm install jose bcryptjs express-rate-limit nodemailer
```

```jsx
// main.jsx
import '@mn/blocks/kit.css';            // tokens + components; import before the app's own CSS
import { OverlayProvider } from '@mn/blocks';

createRoot(root).render(<OverlayProvider><App /></OverlayProvider>);
```

```jsx
import { PageHeader, Button, Panel, Badge, useConfirm, useToast, PlusIcon } from '@mn/blocks';

<PageHeader title="Customers" actions={<Button icon={PlusIcon}>Add</Button>} />
```

Add `class="mk-root"` to `<body>` for the kit's base font, colour and background (optional).

**Update** to the newest version: `npm update @mn/blocks`. To pin a version: `github:mikeylikesitnot-rgb/blocks#v0.1.0`.

**Re-brand** by overriding tokens after the import. Never edit kit CSS from an app:

```css
:root { --mk-primary: #0f766e; --mk-primary-hover: #115e59; }
```

**Dark mode** follows the OS. Force it with `<html data-theme="dark">`, or use `const [theme, setTheme] = useTheme()`.

## A Project Hub style page

```jsx
import { SidebarLayout, NavList, InitialIcon, ThemeSwitch, FilterMenu, GroupedList, Badge,
  SearchInput, Toolbar, Button, EmptyState, useUrlState, useUrlList } from '@mn/blocks';

const [q, setQ] = useUrlState('q');
const [status, setStatus] = useUrlList('status');           // ?status=live,planned

<SidebarLayout brand="My App" footer={<ThemeSwitch />} sidebar={
  <NavList label="Projects" value={slug} onChange={setSlug} items={[
    { value: '', label: 'All', icon: <InitialIcon tone="ink">✱</InitialIcon>, count: 42 },
    { section: 'Projects' },
    { value: 'kit', label: 'Blocks', icon: <InitialIcon name="Blocks" color={1} />, count: '2 building', hot: true },
  ]} />
}>
  <Toolbar>
    <SearchInput value={q} onChange={setQ} />
    <FilterMenu label="Status" allLabel="All statuses" value={status} onChange={setStatus}
      options={[{ value: 'live', label: 'Live' }, { value: 'planned', label: 'Planned' }]} />
    <Button variant="ghost" size="sm" onClick={reset}>Reset filters</Button>
  </Toolbar>
  <GroupedList query={q} columns={['ID', 'Status', 'Feature', 'Area', 'Live since']} groups={groups}
    empty={<EmptyState variant="filtered" onClear={reset} />} />
</SidebarLayout>
```

A row passes when it matches any value ticked in a menu, and every menu together.
See the demo's **Project hub** tab for a full page.

## Saved list filters

The rules are AutoDealer's `docs/decisions/list-filters.md`: checklists for categories,
a slider for money, everything in the URL, saved, and a shared link always wins.

```jsx
import { FilterMenu, RangeFilter, ColumnOrder, DataTable, useSavedFilters, useColumnOrder,
  listParam, rangeParam, inRange, rangeBounds } from '@mn/blocks';

// load/save are optional; without them the set is saved in this browser only.
const prefs = { load: (k) => api.get(`/ui-prefs/${k}`), save: (k, v) => api.put(`/ui-prefs/${k}`, v) };
const { filters, setFilters, resetFilters } = useSavedFilters('cars.filters', ['make', 'minPrice', 'maxPrice'],
  { ...prefs, linkKeys: ['q'] });                 // never put the search box or page number in keys
const make = listParam(filters.make);             // ?make=Honda,Toyota
const price = rangeParam(filters, 'minPrice', 'maxPrice');
const rows = cars.filter((c) => (!make.length || make.includes(c.make)) && inRange(c.price, price));
const cols = useColumnOrder('cars.columns', COLUMNS, prefs);

<FilterMenu label="Make" allLabel="All makes" value={make} options={makes}
  onChange={(v) => setFilters({ make: v.join(',') || null })} />
<RangeFilter label="Price" allLabel="Any price" value={price} step={500}
  bounds={rangeBounds(cars.map((c) => c.price), 500, price)}
  onChange={(min, max) => setFilters({ minPrice: min, maxPrice: max })} />
<ColumnOrder {...cols.menu} />
<Button variant="ghost" size="sm" onClick={() => resetFilters({ q: null })}>Reset filters</Button>
<DataTable columns={cols.columns} onReorder={cols.onReorder} data={rows} />
```

What the URL starts with: a link naming any key or `linkKey` is shown as is and saves nothing;
otherwise the filters last set on that list in this browser session; otherwise
the saved set. Every `setFilters` saves the whole set; `resetFilters` clears the URL and the
saved copy. For a table you build by hand, `useSort(rows)` + `<SortTh col="name" sort={sort}>`
gives the same sortable headers DataTable has. See the demo's **Filters** tab.

## Rich text editor

`@mn/blocks/editor` is a separate entry point, so apps that never edit rich text
never load Tiptap. Install the Tiptap packages yourself when you use it (they are
optional peer dependencies, like the server packages):

```bash
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit
```

```jsx
import { RichTextEditor, RichText } from '@mn/blocks/editor';

<RichTextEditor value={notes} onChange={setNotes} ariaLabel="Notes" storageKey="myapp_notes_height" />
<RichText html={row.notes} />   // read-only view, styled like the editor
```

- **Props:** `value` (or `content`), `onChange` (or `onUpdate`) gets the HTML, `""` when empty.
  `toolbar` lists buttons in order (`'|'` is a separator; default: undo, redo, bold, italic,
  underline, strike, link, bullet and numbered lists, quote, code block). `disable` switches
  StarterKit extensions off, e.g. `['heading', 'codeBlock', 'horizontalRule']`, which also
  hides their buttons and stops that markup being typed or pasted in. `minRows` (4) or
  `minHeight` (px), `storageKey` (user-resizable, height remembered), `resizable`, `id`,
  `ariaLabel`, `disabled`, `className`. Ctrl/Cmd+K opens the link form.
- **HTML:** the same as AutoDealer and TuroApp saved before v0.7.0, so stored notes load and
  re-save unchanged (`test/editor.test.jsx` round-trips both apps' output). Links come out as
  `<a target="_blank" rel="noopener noreferrer" href="...">`; only http, https, mailto and tel links
  can be added. A value with no tags (plain text from before an app had an editor) is shown with
  its line breaks. Still sanitize on the server when saving: the editor is not a security control.
- **Bundle size:** Tiptap is ~130KB gzipped. In an app whose customers download one bundle,
  import from `@mn/blocks/editor/lite` instead: `RichTextField` (same props) loads the editor as
  its own chunk the first time it renders, and `RichText` never needs Tiptap.
- **CSS:** `editor.css` (`mk-rte-*` classes) is imported by the editor modules themselves, so it
  ships only with apps that use them. It reads the kit tokens, so `kit.css` must be loaded too.
  `@mn/blocks/editor.css` is exported if you would rather import it yourself.
- Helpers: `isBlankHtml`, `sameHtml`, `htmlToText`, `toRichHtml`, `editorExtensions()`
  (the exact Tiptap schema, for a server-side or test round trip).

## Q&A board

A Stack Overflow-style board (questions, answers, votes, accepted answer, tags,
comments) on the app's own sign-in and Postgres. Server:

```js
import { qaRouter, pgQaStore, qaSchemaSql } from '@mn/blocks/server/qa'; // needs sanitize-html, express-rate-limit
await pool.query(qaSchemaSql());                       // tables qa_questions, qa_answers, … (prefix option)
// SQLite instead: qaRouter({ store: sqliteQaStore(betterSqliteDb) })  — creates its own tables
app.use('/api/qa', express.json(), auth.optionalAuth,  // requireAuth for a private board
  qaRouter({ store: pgQaStore(pool), onEvent: (type, data) => { /* email the asker on 'answer' */ } }));
```

Screen (one route; needs `OverlayProvider` and the editor's Tiptap peers):

```jsx
import { QaBoard } from '@mn/blocks/qa';
<QaBoard apiBase="/api/qa" title="Questions" onSignIn={() => navigate('/login')} />
```

Writes are rate-limited per person and per kind (`limits: {posts, votes, comments}`); pass
`rateLimitKey` behind a proxy, as with `createAuth`. Author names come from `req.user.name`
(never the email). Authors edit and delete their own posts; people whose `req.user.role` is in
`moderatorRoles` (`['admin']`) can edit or delete any post and close questions.
The view and filters live in the URL (`?qa=12`, `?qa=ask`, `qaSort`, `qaTag`, `qaQ`, `qaPage`).
The demo's Q&A tab runs the board in the browser; `npm run example` serves the real API at `/api/qa`.

## Add sign-in to an app

Server (Express + Postgres):

```js
import pg from 'pg';
import { createAuth, pgStores, authSchemaSql, createMailer } from '@mn/blocks/server';

const pool = new pg.Pool();
await pool.query(authSchemaSql());                 // users + login_codes tables, idempotent
const { userStore, codeStore } = pgStores(pool);

const auth = createAuth({
  secret: process.env.SESSION_SECRET,              // 32+ chars
  users: userStore,
  codeStore,
  mailer: createMailer(),                          // SMTP_HOST/PORT/USER/PASS/FROM from env
  brand: { appName: 'My App', color: '#1a56db', url: 'https://myapp.com', logoUrl: 'https://myapp.com/logo.png' },
  google: { clientId: process.env.GOOGLE_CLIENT_ID }, // optional
  // password: false,                             // Google-only: no password form, /login answers 404
  // rateLimitKey: (req) => req.get('x-client-ip'), // behind a proxy chain that hides the client
});

app.use('/api/auth', auth.router);                  // /config /login /google /code /code/verify /password /logout /me
app.get('/api/orders', auth.requireAuth, handler);  // req.user = { id, email, name, role }
app.delete('/api/orders/:id', auth.requireAuth, auth.requireRole('admin'), handler);
```

Self-serve sign-up: pass `signup: true` and a `users.createUser(email, { name })`, plus a mailer.
The login page then shows "New here? Create an account" (name + email, then the emailed code);
`/code/verify` passes the name to `createUser` only when it creates the account.

Create a user: `INSERT INTO users (email, role) VALUES ('me@x.com', 'admin')`. They can sign in with an emailed code
straight away and then set a password. Already have a users table? Pass your own
`{ findUser, bumpTokenVersion, setPassword }` (see `server/stores.js`).

Front end:

```jsx
import { SessionProvider, AuthGate, useSession } from '@mn/blocks';

<SessionProvider>
  <AuthGate login={{ appName: 'My App', logo: '/logo.svg' }}><App /></AuthGate>
</SessionProvider>

const { user, signOut } = useSession();
```

Send any email:

```js
import { notificationEmail } from '@mn/blocks/server';
mailer.sendQuietly({ to: 'me@x.com', ...notificationEmail({ brand, title: 'New lead', rows: [['Name', 'Ana']] }) });
```

Try it all: `npm run example` (API + email previews at http://localhost:3009/emails), then `npm run dev` → Login tab.
Why it works this way: [docs/decisions/auth.md](docs/decisions/auth.md).

## Nightly VPS backup

`ops/backup.sh` backs up one app on the VPS each night: a Postgres dump from
its container, copies of files like `.env`, and folders like `uploads/`, all in
one restic snapshot (so the database and its files always restore as a pair).
restic encrypts it on the VPS and rclone stores it in Google Drive; a
healthchecks.io check emails on a failed or missed night. Once a week it
prunes, runs `restic check`, and restores the dump from Drive into a scratch
database, comparing row counts of `RESTORE_TEST_TABLES` with live.

Set up an app once, on the VPS:

1. Have the app's deploy copy `node_modules/@mn/blocks/ops/backup.sh` to
   `~/<app>/scripts/backup.sh`, so a Blocks bump updates it.
2. Write `~/.config/<app>-backup/env` (keys and defaults are in the script
   header) and a random `restic-password` next to it (`chmod 600` both). Put the
   password in the password manager too: it is the only key to the Drive copy.
3. `set -a; . ~/.config/<app>-backup/env; set +a; restic init` once.
   rclone's `gdrive` remote (scope `drive.file`) is shared by every app.
4. Create a healthchecks.io check (daily, 1 h grace) and set `HC_PING_URL`.
5. Add the cron line from the header, then run it once by hand with
   `RESTORE_TEST=1` and read the log: it should end `restore test ok` and
   `backup done`.

Restore: `restic snapshots --host <NAME>` then
`restic restore latest --host <NAME> --target /tmp/restore`; the dump is under
`/tmp/restore<LOCAL_DIR>/current/`.

## Browser jobs on the Mac

`@mn/blocks/browser` (needs `npm i playwright-core`) drives an already-running,
already-logged-in Chrome for scheduled Mac jobs that read pages behind a login
and push results to a server. Since Chrome 136 the debug port is ignored on the
everyday profile, so start a dedicated one: `ops/automation-chrome.sh` (profile
`~/ChromeAutomation`, port 9222 on 127.0.0.1; `automation-chrome.ps1` on Windows), sign in to your sites in that
window once, and it stays signed in.

```js
import { withPage, needsLogin, downloadText } from '@mn/blocks/browser';

const report = await withPage('https://example.com/reports', async (page) => {
  if (await needsLogin(page)) throw new Error('Log in to the automation profile first');
  return downloadText(page, (p) => p.getByRole('button', { name: 'Export' }).click());
});
```

`withPage` opens its own tab and closes it again; your tabs are never touched.
Headed Chrome binds loopback by default (`--remote-debugging-address` is only honoured headless). While a job is connected, manual downloads in that profile go to Playwright's temp folder.
Rules (127.0.0.1 only, Mac not VPS, site terms): `docs/decisions/browser.md`.

## Work on the kit

```bash
npm install
npm run dev       # demo of every component at http://localhost:5173
npm test          # vitest (includes the CATALOG.md check)
npm run catalog   # rewrite CATALOG.md after adding or changing an export
```

[CATALOG.md](CATALOG.md) lists every export in one line each, for agents and apps to
read instead of the source. It is generated from `scripts/catalog.mjs`: a new export
needs a line there, or `npm test` fails.

Rules for changes are in [docs/decisions/style-guide.md](docs/decisions/style-guide.md).
