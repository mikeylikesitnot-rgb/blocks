# mn-kit

Shared React UI for all of Michael's web apps, so no app rebuilds buttons,
modals, empty states or a colour palette again.

- **Tokens:** colour, type, spacing, radius and shadow from AutoDealer, plus a dark theme.
- **One button system:** 7 variants, 4 sizes, loading and icon-only.
- **Layout:** PageHeader, Panel, StatCard/StatGrid, Tabs, Segmented, Toolbar.
- **Inputs:** Input, Textarea, SearchInput, Select, Field (label + hint/error, wired for screen readers).
- **States:** EmptyState (empty / filtered / error), Skeleton, SkeletonRows, SkeletonStats, Banner.
- **Overlays:** Modal (bottom sheet on phones), plus `useConfirm`, `useAlert` and `useToast` to replace `window.confirm`/`alert`.
- **Helpers:** `matchesQuery` (forgiving search), `useUrlState` (state kept in `?key=`), `useTheme` (light/dark/system), and inline SVG icons.

Plain CSS with `mk-` prefixed classes and `--mk-` variables. No Tailwind,
no icon library, no router needed. Its only peer dependencies are React and React DOM, version 18 or later.

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

## Work on the kit

```bash
npm install
npm run dev       # demo of every component at http://localhost:5173
npm test          # vitest
```

Rules for changes are in [docs/decisions/style-guide.md](docs/decisions/style-guide.md).
