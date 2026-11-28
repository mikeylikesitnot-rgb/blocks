# Auto update (desktop apps and Chrome extensions)

`@mn/blocks/desktop-update`, `@mn/blocks/ext-update`, `ops/desktop-release.mjs`, `ops/ext-update.sh`.

## Desktop apps (Electron)

- **Source: GitHub Releases of the app's own repo.** The repos are private, so the app needs
  a fine-grained token with *Contents: read* on that one repo. It is pasted once in the app's
  settings and kept encrypted with Electron `safeStorage` (`tokenStore`). No VPS feed, no
  public mirror: one less thing to run, and releasing is just `gh release create`.
- **No electron-updater.** On macOS it hands off to Squirrel.Mac, which refuses apps that
  aren't Developer ID signed, and ours aren't. One small module covering both platforms
  beats a dependency that only works on one.
  - Windows: the NSIS installer runs with `--updated /S` (plus `--force-run` for Restart now),
    the same flags electron-updater uses. Unsigned installers are fine here.
  - macOS: the release has a `.zip` next to the `.dmg`. It is unzipped with `ditto` (keeps
    symlinks and the ad-hoc signature), and a detached `/bin/sh` script waits for the app to
    exit, moves the old `.app` aside, copies the new one in, restores the old one if the copy
    fails, clears quarantine and reopens it when asked. Paths go to the script in env vars,
    never pasted into it.
- **Every download is checked** against the asset size and the sha256 GitHub records for each
  release file (`digest`). The token is sent to api.github.com only; the redirect to GitHub's
  file host is followed without it.
- **Modes:** `auto` (default: download quietly, install when the app quits, or now with
  Restart), `notify` (say an update is out; the person clicks to download and install),
  `off` (no background checks; Check for updates still works). First check 15 s after start,
  then every 6 h.
- **Running from source** (`app.isPackaged` false): updates are reported, never installed.
- **Permissions on macOS:** an ad-hoc signed app gets a new code identity each build, so macOS
  asks for Screen Recording (and similar) again after every update. electron-builder only finds
  Apple-issued identities on its own; with a self-signed one it silently falls back to ad-hoc.
  So each app names it in `package.json` (`build.mac.identity: "Local Code Signing"`, with
  `hardenedRuntime: false` and `gatekeeperAssess: false`), committed, since releases build only
  from a clean tree. The requirement is then "bundle id + that certificate", stable across
  builds. Build releases on the Mac that holds the certificate; check with
  `codesign -d -r- <App>.app` (it should name the certificate, not a `cdhash`). The first signed
  release after ad-hoc ones still costs the permission once.

## Chrome extensions

- Chrome only auto-updates Web Store extensions (or self-hosted ones on managed machines).
  Ours are loaded unpacked, and the Web Store adds a fee and a review wait per version.
- So `ops/ext-update.sh` (launchd / Task Scheduler, every 30 min) keeps a clean copy of each
  extension in `~/.mn-extensions/<name>`, fetched from its branch with the person's normal git
  login. It copies a new version in only when `manifest.json` "version" changes: bumping the
  version is the release. Work-in-progress commits never reach the browser.
- The extension's service worker calls `startExtUpdate()`. Unpacked extensions read files
  live, so it fetches its own `manifest.json`, compares with the running version and calls
  `chrome.runtime.reload()` (`auto`) or shows a ↑ badge (`notify`).
- Moving an extension to `~/.mn-extensions/<name>` means loading it unpacked once more from
  there; the pinned `"key"` in the manifest keeps its ID and saved data.
- Extensions without a build step can't import from `node_modules`. They add an npm script
  that copies `node_modules/@mn/blocks/src/{extUpdate,version}.js` into `vendor/mn-blocks/`
  (generated, never edited by hand) and import from there; the service worker must be
  `"type": "module"`.
- Extensions with a build step (esbuild, Tailwind) import `@mn/blocks/ext-update` normally; the
  bundler inlines it. Their built folder isn't in git, so the config line adds a build command
  (e.g. `dist corepack pnpm install --frozen-lockfile && corepack pnpm build`). The helper
  reads the version from the repo's root `manifest.json` and builds only when it changed; a
  failed build keeps the copy in use. Each machine needs node (corepack brings pnpm).
