# Style guide

These rules apply to every app built on Blocks. They come from what went
wrong in AutoDealer and TuroApp before each grew a single system.

## Tokens, never literals
Every colour, font size, space, radius and shadow is a `--mk-*` variable
from `src/tokens.css`. A literal like `#fee2e2` pins one control to a colour
the palette can no longer move, and it breaks dark mode. Apps re-brand by
overriding `--mk-primary*` / `--mk-accent*`, not by editing component CSS.

## Premium look (opt-in)
`src/premium.css` (`@mn/blocks/premium.css`) re-skins the kit for apps that want the calm
Apple-style look: blue `#0071e3`, cool greys, the system font first, softer shadows, 16px cards,
a 28-34px page title at weight 700, and true-black dark with `#1c1c1e` surfaces. It is token
overrides only, so it follows every rule here. Import it right after `kit.css`, in the same
Tailwind layer. Apps that don't import it look exactly as before. Any token it sets for light
it also sets in both dark blocks (`test/premium.test.js`).

It also sets the optional button tokens kit.css reads with a fallback (`--mk-btn-radius`,
`--mk-btn-secondary-*`, `--mk-btn-disabled-*`): pill buttons, secondary as a soft grey fill with no
outline, and disabled buttons as a neutral grey fill instead of a faded colour. Unset, buttons look
as before. For quiet status in lists use `<Badge plain>` (tone dot + muted text, no pill).

## One size per job
| Job | Token |
|---|---|
| Page title | `--mk-text-h1`, weight 800 (`PageHeader`) |
| Panel title | `--mk-text-base`, 600 (`Panel`) |
| Body, form controls | `--mk-text-base` (16px on phones, so iOS does not zoom) |
| Table cells, dense UI | `--mk-text-sm` |
| Labels, badges, hints | `--mk-text-xs`; section labels are uppercase (`.mk-eyebrow`) |
| Stat figures | `--mk-text-2xl`, tabular numbers |

Spacing is a 4px grid (`--mk-space-N` = N x 4px). Hairlines and 1-2px nudges stay literal.

## One button system
`<Button>` only. Never style a raw `<button>` as an action, and never start
a second family. That is how AutoDealer ended up with `.action-btn` next to `.btn`.
- **Solid** (`primary`, `accent`, `danger`) commits something. One per area.
- **Soft** (`secondary`, `soft`, `soft-danger`, `ghost`) is for row actions. A solid button repeated down
  every table row drowns out the one action that matters.
- All controls share heights: xs 28, sm 32, md 40, lg 48. An md button sits
  level with an Input or Select.
- An icon-only button must pass `label`, which becomes its accessible name and tooltip.

## Colour is never the only signal
Badges are text plus a tint. Deltas carry an arrow as well as colour. Status words map
to tones through `toneFor`; an app adds its own words with the `tones` prop.

## Every list has three states
Loading uses a `SkeletonRows`/`SkeletonStats` shaped like the content. Empty uses
`EmptyState`, picking the variant that says *why* it's empty: nothing yet,
nothing matches the filters (with Clear filters), or failed to load (with Try again). A failed
refresh over stale data gets a `Banner` with Retry, not a blank screen.

## No browser dialogs
Use `useConfirm` / `useAlert` / `useToast`, never `window.confirm` or `alert`. Destructive
confirms pass `danger: true` and a verb label ("Delete", not "OK").

## Phones first
- Nothing scrolls sideways at 390px.
- Modals become bottom sheets on phones.
- Tabs scroll sideways instead of wrapping.
- Toolbars wrap.
- Touch targets are at least 32px.

Check with `npm run dev` at phone width in both light and dark.

## Adding to the kit
A component belongs here once two apps need it. Keep it app-agnostic: no API calls,
no app vocabulary (TuroApp's `VehicleName` stayed in TuroApp). Each new component
gets a demo section and tests in the same change.
