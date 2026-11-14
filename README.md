# mn-kit

Shared code for all of Michael's web apps, so no app rebuilds buttons,
modals, a login screen, sign-in sessions or emails again.

**UI (`@mn/kit`)**

- **Tokens:** colour, type, spacing, radius and shadow from AutoDealer, plus a dark theme.
- **One button system:** 7 variants, 4 sizes, loading and icon-only.
- **Layout:** PageHeader, Panel, StatCard/StatGrid, Tabs, Segmented, Toolbar.
- **App frame:** `SidebarLayout` (sidebar on desktop, slide-out menu on phones), `NavList`, `InitialIcon`, `ThemeSwitch`.
- **Lists:** `FilterMenu` (checklist dropdown), `GroupedList` (grouped rows with ID, badge and side cells), `highlight`.
- **Inputs:** Input, Textarea, SearchInput, Select, Field (label + hint/error, wired for screen readers).
- **DataTable:** sortable columns, sticky header, drag-to-reorder columns, auto right-aligned numbers, built-in loading/empty/filtered states, and a card list on phones.
- **States:** EmptyState (empty / filtered / error), Skeleton, SkeletonRows, SkeletonStats, Banner.
- **Overlays:** Modal (bottom sheet on phones), plus `useConfirm`, `useAlert` and `useToast` to replace `window.confirm`/`alert`.
- **Login:** `LoginPage` (password, Google, emailed code), `SessionProvider`, `useSession`, `AuthGate`.
- **Rich text editor (`@mn/kit/editor`, optional):** `RichTextEditor` (Tiptap), `RichText` viewer, lazy `RichTextField`. See below.
- **Helpers:** `matchesQuery` (forgiving search), `useUrlState` (state kept in `?key=`), `useUrlList` (a list kept as `?key=a,b`), `useTheme` (light/dark/system), and inline SVG icons.

**Server (`@mn/kit/server`, Express)**
- **Sign-in:** `createAuth()` covers password, Google and email-code login, password reset, logout on every device, 30-minute idle and 8-hour hard timeouts, and roles.
- **Users:** `pgStores(pool)` + `authSchemaSql()` for a new Postgres app, `memoryUserStore()` for prototypes, or three functions over an existing users table.
- **Email:** `createMailer()` (SMTP; prints to the console in dev) and branded templates: `loginCodeEmail`, `passwordChangedEmail`, `inviteEmail`, `notificationEmail`, `renderEmail`.
- **Also:** `createLimiter` / `createFormLimiter` / `createCostLimiter`, `encrypt` / `decrypt` for stored secrets.

Plain CSS with `mk-` prefixed classes and `--mk-` variables. No Tailwind,
no icon library, no router needed. Peer dependencies: React 18 or later for the UI, Express 4.21 or later for the server.

## Use it in an app

```bash
npm install github:mikeylikesitnot-rgb/mn-kit
```

A client-only app needs nothing else. An app that uses `@mn/kit/server` or
`@mn/kit/email` also installs the server packages itself (since v0.5.0 they are
optional peer dependencies, so client installs stay small):

```bash
npm install jose bcryptjs express-rate-limit nodemailer
```

```jsx
// main.jsx
import '@mn/kit/kit.css';            // tokens + components; import before the app's own CSS
import { OverlayProvider } from '@mn/kit';

createRoot(root).render(<OverlayProvider><App /></OverlayProvider>);
```

```jsx
import { PageHeader, Button, Panel, Badge, useConfirm, useToast, PlusIcon } from '@mn/kit';

<PageHeader title="Customers" actions={<Button icon={PlusIcon}>Add</Button>} />
```

Add `class="mk-root"` to `<body>` for the kit's base font, colour and background (optional).

**Update** to the newest version: `npm update @mn/kit`. To pin a version: `github:mikeylikesitnot-rgb/mn-kit#v0.1.0`.

**Re-brand** by overriding tokens after the import. Never edit kit CSS from an app:

```css
:root { --mk-primary: #0f766e; --mk-primary-hover: #115e59; }
```

**Dark mode** follows the OS. Force it with `<html data-theme="dark">`, or use `const [theme, setTheme] = useTheme()`.

## A Project Hub style page

```jsx
import { SidebarLayout, NavList, InitialIcon, ThemeSwitch, FilterMenu, GroupedList, Badge,
  SearchInput, Toolbar, Button, EmptyState, useUrlState, useUrlList } from '@mn/kit';

const [q, setQ] = useUrlState('q');
const [status, setStatus] = useUrlList('status');           // ?status=live,planned

<SidebarLayout brand="My App" footer={<ThemeSwitch />} sidebar={
  <NavList label="Projects" value={slug} onChange={setSlug} items={[
    { value: '', label: 'All', icon: <InitialIcon tone="ink">✱</InitialIcon>, count: 42 },
    { section: 'Projects' },
    { value: 'kit', label: 'mn-kit', icon: <InitialIcon name="mn-kit" color={1} />, count: '2 building', hot: true },
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
Saving filters to an account is the app's job (the kit makes no API calls): save the
lists on change, and have Reset filters clear the saved copy too. See the demo's
**Project hub** tab for a full page.

## Rich text editor

`@mn/kit/editor` is a separate entry point, so apps that never edit rich text
never load Tiptap. Install the Tiptap packages yourself when you use it (they are
optional peer dependencies, like the server packages):

```bash
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit
```

```jsx
import { RichTextEditor, RichText } from '@mn/kit/editor';

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
  import from `@mn/kit/editor/lite` instead: `RichTextField` (same props) loads the editor as
  its own chunk the first time it renders, and `RichText` never needs Tiptap.
- **CSS:** `editor.css` (`mk-rte-*` classes) is imported by the editor modules themselves, so it
  ships only with apps that use them. It reads the kit tokens, so `kit.css` must be loaded too.
  `@mn/kit/editor.css` is exported if you would rather import it yourself.
- Helpers: `isBlankHtml`, `sameHtml`, `htmlToText`, `toRichHtml`, `editorExtensions()`
  (the exact Tiptap schema, for a server-side or test round trip).

## Add sign-in to an app

Server (Express + Postgres):

```js
import pg from 'pg';
import { createAuth, pgStores, authSchemaSql, createMailer } from '@mn/kit/server';

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
});

app.use('/api/auth', auth.router);                  // /config /login /google /code /code/verify /password /logout /me
app.get('/api/orders', auth.requireAuth, handler);  // req.user = { id, email, name, role }
app.delete('/api/orders/:id', auth.requireAuth, auth.requireRole('admin'), handler);
```

Create a user: `INSERT INTO users (email, role) VALUES ('me@x.com', 'admin')`. They can sign in with an emailed code
straight away and then set a password. Already have a users table? Pass your own
`{ findUser, bumpTokenVersion, setPassword }` (see `server/stores.js`).

Front end:

```jsx
import { SessionProvider, AuthGate, useSession } from '@mn/kit';

<SessionProvider>
  <AuthGate login={{ appName: 'My App', logo: '/logo.svg' }}><App /></AuthGate>
</SessionProvider>

const { user, signOut } = useSession();
```

Send any email:

```js
import { notificationEmail } from '@mn/kit/server';
mailer.sendQuietly({ to: 'me@x.com', ...notificationEmail({ brand, title: 'New lead', rows: [['Name', 'Ana']] }) });
```

Try it all: `npm run example` (API + email previews at http://localhost:3009/emails), then `npm run dev` → Login tab.
Why it works this way: [docs/decisions/auth.md](docs/decisions/auth.md).

## Work on the kit

```bash
npm install
npm run dev       # demo of every component at http://localhost:5173
npm test          # vitest
```

Rules for changes are in [docs/decisions/style-guide.md](docs/decisions/style-guide.md).
