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
- **States:** EmptyState (empty / filtered / error), Skeleton, SkeletonRows, SkeletonStats, Banner.
- **Overlays:** Modal (bottom sheet on phones), plus `useConfirm`, `useAlert` and `useToast` to replace `window.confirm`/`alert`.
- **Login:** `LoginPage` (password, Google, emailed code), `SessionProvider`, `useSession`, `AuthGate`.
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
