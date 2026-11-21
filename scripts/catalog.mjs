#!/usr/bin/env node
/*
 * Writes CATALOG.md: one line per exported piece, so agents read the catalog
 * instead of the source.
 *
 *   npm run catalog         rewrite CATALOG.md
 *   npm run catalog:check   exit 1 if CATALOG.md is stale (part of npm test)
 *
 * Names come from the real exports of each entry point. Every export must be
 * described below (as a `name` or in an `also` list) and every name below must
 * still be exported, or the script fails. Adding a component = add one line to
 * AREAS.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'CATALOG.md');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const PKG = pkg.name;
const REPO = String(pkg.repository || '').replace(/^github:/, '');

// Entry points: subpath -> file. `subsetOf` entries re-export pieces listed elsewhere.
const ENTRIES = [
  { sub: '', file: 'src/index.js' },
  { sub: '/editor', file: 'src/editor/index.js' },
  { sub: '/editor/lite', file: 'src/editor/lite.js', subsetOf: '/editor',
    note: 'RichText, RichTextField and the value helpers without loading Tiptap up front (use in bundles customers download).' },
  { sub: '/server', file: 'server/index.js' },
  { sub: '/email', file: 'server/email.js', subsetOf: '/server',
    note: 'just the email templates, no Express or nodemailer needed.' },
];

/*
 * The catalog. One item per line in CATALOG.md:
 *   name, also (related exports shown and imported with it), does (one
 *   sentence), props (key props/options, short). `icons: true` covers every
 *   export ending in "Icon" not named by another item.
 */
const AREAS = [
  { title: 'Layout & shell', sub: '', items: [
    { name: 'SidebarLayout', does: 'App frame: sidebar on desktop, slide-out menu behind a top bar on phones; collapsible lets people hide it on desktop too (☰ opens it, picking a page closes it).', props: 'brand, sidebar, footer, label, collapsible, pinned, defaultPinned, onPinnedChange' },
    { name: 'NavList', does: 'Sidebar nav list; `section` items are headings, selected item gets aria-current.', props: 'items [{value,label,icon,count,hot,note,href} | {section}] (note: tooltip + screen-reader text for the count), value, onChange' },
    { name: 'NavMenu', also: ['useNavMenu', 'arrangeNav', 'searchNav', 'navGroups', 'orderKeys', 'SHELL_OPEN_EVENT'], does: 'NavList people can search (⌘K or /, Enter opens the first match), star into a Favorites group, and rearrange or hide in Edit menu; choices saved per browser or account.', props: 'items (NavList items + keywords), value, onChange, prefKey, load, save, label, placeholder, favoritesLabel, shortcut (true: ⌘K and /; a key: ⌘ or Ctrl + that key; false: none)' },
    { name: 'InitialIcon', also: ['initials'], does: 'Coloured square with a name\'s initials (or any child) for nav rows.', props: 'name, color 0-n, tone, size' },
    { name: 'ThemeSwitch', does: 'Light / dark / system segmented switch wired to useTheme.', props: 'icons' },
    { name: 'useTheme', does: 'Light/dark/system choice, written to <html data-theme> and remembered as mk-theme.', props: 'returns [theme, setTheme]' },
    { name: 'PageHeader', does: 'Top of every page: title left, actions right, stacks on phones.', props: 'title, subtitle, actions, meta' },
    { name: 'Panel', does: 'Card section with optional header row.', props: 'title, subtitle, actions, flush, as' },
    { name: 'StatCard', does: 'One KPI tile with optional delta arrow.', props: 'label, value, sub, delta, deltaSuffix, invert, onClick' },
    { name: 'StatGrid', does: 'Responsive grid of StatCards.', props: 'cols (4)' },
    { name: 'Tabs', does: 'Underline tabs that scroll sideways on phones.', props: 'items [{value,label,count,icon}], value, onChange' },
    { name: 'Segmented', does: 'Segmented control for 2-5 options.', props: 'items, value, onChange, label' },
    { name: 'Toolbar', does: 'Filter/action bar that wraps on phones.', props: 'children, right' },
    { name: 'Button', also: ['BUTTON_VARIANTS'], does: 'The one button: 7 variants, 4 sizes, loading, icon-only, or a link with href.', props: 'variant primary|accent|danger|secondary|soft|soft-danger|ghost, size, icon, iconRight, loading, label, block, href; type defaults to "button"' },
    { name: 'CopyButton', also: ['copyText'], does: 'Small icon button that copies text: check icon for 1.5s plus a toast; clicks don\'t bubble (safe in clickable rows); copyText falls back to execCommand on http.', props: 'text (string or () => string), label (tooltip/aria, "Copy"), toast (true | "Copied car info" | false), variant (ghost), size (sm), onCopied(text), children for a text button' },
    { name: 'Badge', also: ['toneFor', 'TONES', 'STATUS_TONE'], does: 'Status pill; picks a tone from common status words.', props: 'text, tone, tones (extra word->tone), dot, size' },
    { name: 'Icons', icons: true, does: 'Inline SVG icons, 1em square, currentColor; any `icon` prop also takes a lucide-react icon.', props: 'className, any svg prop' },
    { name: 'cx', does: 'Join class names, skipping falsy ones.' },
  ] },
  { title: 'Inputs', sub: '', items: [
    { name: 'Input', does: 'Text input, same height as Select and a md Button.', props: 'invalid, any <input> prop' },
    { name: 'Textarea', does: 'Multi-line text input.', props: 'invalid, any <textarea> prop' },
    { name: 'SearchInput', does: 'Search box with magnifier and clear button; Esc clears.', props: 'value, onChange(string), placeholder' },
    { name: 'Select', does: 'Native select styled like Input.', props: 'active (highlight when filtering), any <select> prop' },
    { name: 'Field', does: 'Label + hint/error around one control, wired for screen readers.', props: 'label, hint, error, htmlFor' },
  ] },
  { title: 'Lists, filters & tables', sub: '', items: [
    { name: 'DataTable', does: 'Sortable table with sticky header, column drag, auto right-aligned numbers, loading/empty states and a card list on phones.', props: 'columns [{key,label,render,sortValue,align,mobile}], data, rowKey, onRowClick, defaultSort, onReorder | reorderable+storageKey, loading, filtered, onClearFilters, stickyHeader, dense, singleLayout (render only the active layout; use when cells hold controls)' },
    { name: 'SortTh', also: ['useSort', 'sortRows'], does: 'Sortable header cell for a table you build yourself.', props: 'col, sort (from useSort(rows, {values, defaultSort}) -> {rows, sortBy, sortDir, onSort})' },
    { name: 'ColumnOrder', also: ['useColumnOrder', 'orderColumns'], does: 'Show, hide and move columns, remembered per browser or account.', props: 'useColumnOrder(prefKey, columns, {load, save}) -> {columns, onReorder, menu}; <ColumnOrder {...cols.menu} />' },
    { name: 'FilterMenu', also: ['filterSummary'], does: 'Checklist dropdown for a category filter.', props: 'label, allLabel, options [{value,label}], value [], onChange(values), align' },
    { name: 'RangeFilter', does: 'Number-range dropdown (price, cost, $/day, days): two-handle slider plus Min/Max boxes.', props: 'label, allLabel, value [min,max] (null = open), bounds, step, onChange(min,max), format, formatValue, unit ("/day" after the figures)' },
    { name: 'useSavedFilters', does: 'A list\'s filters in the URL, remembered per session and saved per browser or account; a shared link wins.', props: '(prefKey, keys, {load, save, linkKeys}) -> {filters, setFilters, resetFilters}' },
    { name: 'listParam', also: ['listValue'], does: 'Parse "a,b" from a filter param into an array; listValue joins ticks back (null when none), escaping commas inside values.', props: '(value); listValue(values)' },
    { name: 'rangeParam', does: 'Read [min, max] numbers from two params.', props: '(params, minKey, maxKey, legacyKey)' },
    { name: 'inRange', does: 'Whether a number passes a [min, max] range (null = open end).', props: '(n, [min, max])' },
    { name: 'rangeBounds', does: 'Slider ends from the data, rounded to step, widened to include a picked range.', props: '(values, step, picked)' },
    { name: 'rangeSummary', also: ['money', 'shortMoney'], does: 'Button text for a range ("$5k-$12k"); money/shortMoney format dollars.', props: '([min,max], {allLabel, upTo, format, unit})' },
    { name: 'GroupedList', does: 'Grouped rows (ID chip, badge, title, side cells) with search highlighting; cards on phones.', props: 'groups [{key,title,note,items}], columns, query, empty, loading, error, onRetry' },
    { name: 'highlight', does: 'Mark every typed word inside a string for search results.', props: '(text, query)' },
    { name: 'matchesQuery', does: 'Forgiving search: every word must prefix-match some field; digits match anywhere.', props: '(query, fields[])' },
    { name: 'useUrlState', does: 'A string kept in ?key= (replaceState, no router needed).', props: '(key, fallback) -> [value, setValue]' },
    { name: 'useUrlList', does: 'A list kept in ?key=a,b.', props: '(key) -> [values, setValues]' },
    { name: 'patchUrl', also: ['URL_EVENT'], does: 'Set or remove some query params and tell URL hooks to re-read; a router app dispatches URL_EVENT on its own navigations so the hooks follow.', props: "({key: value|null}); window.dispatchEvent(new Event(URL_EVENT))" },
  ] },
  { title: 'Attachments', sub: '', items: [
    { name: 'FileDrop', does: 'Drop zone with an "Add files" button; rejected files (type or size) go to onReject. UI only: the app uploads.', props: 'onFiles(files), onReject([{file,reason}]), accept [\'image/*\', \'.log\'], maxSize, multiple, disabled, label, hint, compact' },
    { name: 'usePasteFiles', also: ['filesFromPaste', 'nameClipboardFile'], does: 'Paste a screenshot or file anywhere inside a panel; text fields keep pasted text; clipboard images get a dated name.', props: '(ref | null, onFiles, {enabled})' },
    { name: 'AttachmentGrid', does: 'Images as thumbnails that open a Lightbox, other files as download rows; optional remove button.', props: 'items [{id,name,size,mime,url,thumbUrl,pending,error,preview}], onRemove(item), removeLabel' },
    { name: 'Lightbox', does: 'Full-size image in a modal (bottom sheet on phones).', props: 'open, onClose, src, alt, title, footer' },
    { name: 'checkFiles', also: ['fileAccepted', 'formatBytes', 'isImage'], does: 'File helpers: split into ok/rejected by type and size, match an accept list, "1.4 MB" sizes, image mime check.', props: '(files, {accept, maxSize}) -> {ok, rejected}' },
  ] },
  { title: 'Changelog', sub: '', items: [
    { name: 'Changelog', also: ['normalizeChangelog', 'changelogDay', 'CHANGE_TYPES'], does: 'What changed, newest first and grouped by day: New / Fixed / Improved badges, F-id, Open page / Commit / PR links and before/after screenshots, with a type filter and search; normalizeChangelog cleans a changelog.json (bad entries dropped, hashes and PR numbers become links, image paths resolved).', props: 'entries (raw file or normalized), baseUrl (image folder), repoUrl, loading, error, onRetry, query/onQueryChange, types/onTypesChange, empty, toolbarRight' },
    { name: 'CompareImages', does: 'Before/after screenshots: drag slider (touch and arrow keys) or side by side; either opens full size in a Lightbox; one image shows alone.', props: 'before, after, label, beforeLabel, afterLabel, defaultMode slider|side' },
  ] },
  { title: 'States & overlays', sub: '', items: [
    { name: 'EmptyState', does: 'Empty, no-results or error message with the right icon and action.', props: 'variant empty|filtered|error, title, body, action, onClear, onRetry, compact' },
    { name: 'Skeleton', does: 'One grey loading block.', props: 'className, style' },
    { name: 'SkeletonRows', does: 'Loading placeholder for a table.', props: 'rows, cols' },
    { name: 'SkeletonStats', does: 'Loading placeholder for a StatGrid.', props: 'count' },
    { name: 'Banner', also: ['ErrorBanner'], does: 'Inline message bar, optionally with Retry.', props: 'tone (danger), onRetry' },
    { name: 'Modal', does: 'Dialog on desktop, bottom sheet on phones; Esc/backdrop close, focus trapped.', props: 'open, onClose, title, subtitle, footer, size' },
    { name: 'OverlayProvider', does: 'Wrap the app once so confirm, alert and toasts render.' },
    { name: 'useConfirm', does: 'Promise-based confirm instead of window.confirm.', props: 'await confirm({title, body, confirmLabel, danger})' },
    { name: 'useAlert', does: 'Promise-based alert instead of window.alert.', props: 'await alert({title, body})' },
    { name: 'useToast', does: 'Toasts.', props: "toast('Saved'), toast.error(msg), toast.info(msg)" },
  ] },
  { title: 'Sign-in UI', sub: '', items: [
    { name: 'SessionProvider', does: 'Holds the signed-in user from the server kit\'s /api/auth router.', props: 'apiBase (/api/auth)' },
    { name: 'useSession', does: 'Current session.', props: 'returns {user, loading, refresh, signOut, setUser, apiBase}' },
    { name: 'AuthGate', does: 'Renders children when signed in, the LoginPage when not.', props: 'login (LoginPage props), loading' },
    { name: 'LoginPage', does: 'Password, Google, emailed code and sign-up, as the server allows.', props: 'appName, logo, subtitle, apiBase, onSignedIn, footer' },
  ] },
  { title: 'Editor', sub: '/editor', items: [
    { name: 'RichTextEditor', also: ['DEFAULT_TOOLBAR', 'LINK_PROTOCOLS'], does: 'Tiptap rich text editor that saves the same HTML AutoDealer and TuroApp stored.', props: 'value, onChange(html), toolbar, disable [extension names], minRows, minHeight, storageKey, resizable, ariaLabel, disabled' },
    { name: 'RichTextField', does: 'RichTextEditor loaded on demand as its own chunk; same props.', props: 'same as RichTextEditor' },
    { name: 'RichText', does: 'Read-only view of a stored value, styled like the editor; no Tiptap.', props: 'html, as' },
    { name: 'editorExtensions', does: 'The exact Tiptap schema, for server-side or test round trips.', props: '({disable})' },
    { name: 'isBlankHtml', also: ['sameHtml', 'htmlToText', 'toRichHtml'], does: 'Value helpers: blank check, equality, plain text, plain-text-to-HTML.', props: '(html)' },
  ] },
  { title: 'Server: auth', sub: '/server', items: [
    { name: 'createAuth', does: 'Express sign-in: password, Google, email code, reset, sign-up, idle/hard timeouts, roles.', props: '{secret (32+), users, codeStore, mailer, brand, google:{clientId}, password (false = Google-only), rateLimitKey (req→client id), signup, idleMinutes 30, maxHours 8} -> {router, requireAuth, optionalAuth, requireRole, readSession, startSession}' },
    { name: 'pgStores', also: ['authSchemaSql'], does: 'Postgres user and code stores, plus the idempotent CREATE TABLE SQL.', props: '(pool, {users, codes}) -> {userStore, codeStore}' },
    { name: 'memoryUserStore', does: 'In-memory users for tests and prototypes.', props: '(users[])' },
    { name: 'createCodes', also: ['memoryCodeStore'], does: 'One-time 6-digit codes: 10 min, 5 tries, 3 per 15 min, HMAC stored.', props: '(store, secret) -> {issue, verify}' },
    { name: 'hashPassword', does: 'bcrypt hash (cost 12) for seeding users.', props: '(password)' },
    { name: 'makeGoogleVerifier', does: 'Verify a Google ID token against Google\'s keys.', props: '(clientId)' },
  ] },
  { title: 'Server: email', sub: '/server', items: [
    { name: 'createMailer', does: 'SMTP sender; prints to the console in dev when no host is set.', props: '{host, port, user, pass, from} or {getConfig} (SMTP_* env default) -> {send, sendQuietly, verify}' },
    { name: 'renderEmail', does: 'Branded HTML + text email from parts.', props: '{brand, subject, title, preheader, paragraphs, code, button, rows, footnote}' },
    { name: 'loginCodeEmail', does: 'Sign-in code email.', props: '{brand, code, minutes}' },
    { name: 'passwordChangedEmail', does: 'Password-changed notice.', props: '{brand, when}' },
    { name: 'inviteEmail', does: 'Invitation with a link.', props: '{brand, inviter, url}' },
    { name: 'notificationEmail', does: 'Alert email with a table of rows (new lead, etc.).', props: '{brand, title, intro, rows [[k,v]], button, footnote}' },
  ] },
  { title: 'Server: limits', sub: '/server', items: [
    { name: 'createLimiter', does: 'express-rate-limit factory; one counter per call.', props: '{minutes 15, limit, message, store}' },
    { name: 'createFormLimiter', does: 'Public form posts: 5 per 15 min.', props: 'same as createLimiter' },
    { name: 'createCostLimiter', does: 'Endpoints that cost money per call: 20 per hour.', props: 'same as createLimiter' },
  ] },
  { title: 'Server: crypto', sub: '/server', items: [
    { name: 'encrypt', also: ['decrypt'], does: 'AES-256-GCM for small stored secrets, keyed from an existing secret.', props: '(text, secret, salt)' },
  ] },
];

// Shell scripts under ops/: not imports, so listed by hand. Each file must exist.
const OPS = [
  { file: 'ops/backup.sh', does: 'Nightly VPS backup: Postgres dump + files + folders in one restic snapshot, encrypted to Google Drive via rclone, healthchecks.io pings, retries, keep rules that really delete, weekly restore test into a scratch database, local copies.', use: 'deploy copies it to the VPS; cron runs `backup.sh <config>` (config keys in the header: NAME, RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE, HC_PING_URL, DB_CONTAINER, DB_FORMAT, DB_FILE, DB_CHECK_TABLE, RESTORE_TEST_TABLES, COPY_FILES, BACKUP_PATHS, KEEP_*); `RESTORE_TEST=1` runs the restore test now' },
];
for (const o of OPS) {
  try { readFileSync(join(ROOT, o.file)); } catch { console.error(`catalog: ${o.file} is listed in OPS but missing`); process.exit(1); }
}

// ---- read the real exports ----------------------------------------------

function exportsOf(file, seen = new Set()) {
  const path = join(ROOT, file);
  if (seen.has(path)) return [];
  seen.add(path);
  const src = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const names = [];
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name && name !== 'default') names.push(name);
    }
  }
  for (const m of src.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    names.push(...exportsOf(join(dirname(file), m[1]), seen));
  }
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.push(m[1]);
  }
  return [...new Set(names)];
}

const errors = [];
const exported = Object.fromEntries(ENTRIES.map((e) => [e.sub, exportsOf(e.file)]));

const named = new Set(AREAS.flatMap((a) => a.items.flatMap((i) => (i.icons ? [] : [i.name, ...(i.also || [])]))));
const iconNames = (sub) => exported[sub].filter((n) => /Icon$/.test(n) && !named.has(n));
const namesOf = (item, sub) => (item.icons ? iconNames(sub) : [item.name, ...(item.also || [])]);

const described = Object.fromEntries(ENTRIES.filter((e) => !e.subsetOf).map((e) => [e.sub, new Set()]));
for (const area of AREAS) {
  for (const item of area.items) {
    if (!item.does) errors.push(`${item.name}: no description`);
    for (const n of namesOf(item, area.sub)) {
      if (!exported[area.sub]?.includes(n)) errors.push(`${n}: described under "${area.title}" but not exported from ${PKG}${area.sub}`);
      described[area.sub].add(n);
    }
  }
}
for (const e of ENTRIES) {
  const pool = described[e.subsetOf ?? e.sub];
  for (const n of exported[e.sub]) {
    if (!pool.has(n)) errors.push(`${PKG}${e.sub} exports ${n} with no description: add it to AREAS in scripts/catalog.mjs`);
  }
}
if (errors.length) {
  console.error(`catalog: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

// ---- write -----------------------------------------------------------------

const line = (item, sub) => {
  const names = namesOf(item, sub);
  const shown = item.icons ? `Icons (${names.map((n) => n.replace(/Icon$/, '')).join(', ')})` : item.name;
  const extra = item.icons || !item.also ? '' : ` (+ ${item.also.join(', ')})`;
  const imp = item.icons ? `import { PlusIcon } from '${PKG}${sub}'` : `import { ${names.join(', ')} } from '${PKG}${sub}'`;
  const props = item.props ? ` Props: ${item.props}.` : '';
  return `- **${shown}**${extra}: ${item.does}${props} \`${imp}\``;
};

const install = REPO ? `github:${REPO}#v${pkg.version}` : `${PKG}@${pkg.version}`;
const out = [
  `# Blocks catalog (\`${PKG}\` v${pkg.version})`,
  '',
  '<!-- Generated by `npm run catalog` from scripts/catalog.mjs. Do not edit by hand. -->',
  '',
  'Every exported piece, one line each. Read this instead of the source; use a block',
  'before writing your own. Missing an option? Add it to the block here, never fork it into an app.',
  '',
  '## How apps use it',
  '',
  `- **Install (client):** \`npm install "${PKG}@${install}"\`. A client-only app needs nothing else.`,
  `- **Server pieces** (\`${PKG}/server\`, \`${PKG}/email\`): the app also installs \`jose bcryptjs express-rate-limit nodemailer\` (optional peers).`,
  `- **Editor** (\`${PKG}/editor\`): the app also installs \`@tiptap/react @tiptap/pm @tiptap/starter-kit\`.`,
  `- **CSS:** \`import '${PKG}/kit.css'\` once (brings tokens.css), before the app's own CSS. With Tailwind, put it in the components layer (\`@import "${PKG}/kit.css" layer(components);\`) so utilities passed as \`className\` win. The editor imports its own \`editor.css\`.`,
  '- **Wrap** the app in `<OverlayProvider>` (confirm, alert, toasts); add `class="mk-root"` to `<body>` for base font and colours (optional).',
  '- **Theme:** override tokens after the import, e.g. `:root { --mk-primary: #0f766e; --mk-primary-hover: #115e59; }`; set the same tokens in the dark blocks too. Never edit kit CSS; classes stay `mk-*`.',
  '- **Dark mode** follows the OS; force with `<html data-theme="light|dark">` or `useTheme()`.',
  '',
];
for (const e of ENTRIES) {
  const areas = AREAS.filter((a) => a.sub === e.sub);
  if (e.subsetOf) {
    out.push(`**\`${PKG}${e.sub}\`**: ${e.note}`, '');
    continue;
  }
  out.push(`## \`${PKG}${e.sub}\``, '');
  for (const a of areas) {
    out.push(`### ${a.title}`, '');
    for (const item of a.items) out.push(line(item, a.sub));
    out.push('');
  }
}
out.push('## Ops scripts (`node_modules/' + PKG + '/ops/`)', '');
for (const o of OPS) out.push(`- **${o.file.replace(/^ops\//, '')}**: ${o.does} Use: ${o.use}.`);
out.push('');
const text = out.join('\n').replace(/\n+$/, '\n');

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing counts as stale */ }
  if (current !== text) {
    console.error('CATALOG.md is stale: run `npm run catalog` and commit it.');
    process.exit(1);
  }
  console.log('CATALOG.md is up to date.');
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote CATALOG.md (${text.split('\n').length - 1} lines).`);
}
