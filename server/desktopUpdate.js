/*
 * Auto update for Electron apps released on GitHub Releases (`@mn/blocks/desktop-update`).
 *
 * - Private repos work with a fine-grained read-only token (Contents: read, that one repo),
 *   kept encrypted with Electron safeStorage by tokenStore().
 * - Windows: downloads the NSIS installer and runs it silently (`--updated /S`).
 * - macOS: the apps aren't Developer ID signed, so Squirrel.Mac (electron-updater) refuses
 *   them. Instead it downloads the release .zip, unzips it with ditto and, after the app
 *   quits, swaps the new .app into place, clears quarantine and (optionally) reopens it.
 * - Every download is checked against the asset's size and GitHub's sha256 digest.
 * - No dependencies and no `import 'electron'`: the app passes `app` in, so it runs from
 *   CommonJS (`await import('@mn/blocks/desktop-update')`) and in tests.
 *
 * Decisions: docs/decisions/auto-update.md
 */
import { createHash } from 'node:crypto';
import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants, createWriteStream, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { compareVersions, isNewer } from '../src/version.js';

export { compareVersions, isNewer };

export const UPDATE_MODES = ['auto', 'notify', 'off'];

const API = 'https://api.github.com';

/** Pick the release file for this computer: the .exe installer on Windows, the .zip on macOS. */
export function pickAsset(assets = [], { platform = process.platform, arch = process.arch } = {}) {
  const files = assets.filter((a) => a && a.name && !/\.blockmap$/i.test(a.name));
  let pool;
  if (platform === 'win32') pool = files.filter((a) => /\.exe$/i.test(a.name));
  else if (platform === 'darwin') pool = files.filter((a) => /\.zip$/i.test(a.name) && !/[-_. ](win|windows)([-_. ]|$)/i.test(a.name));
  else return null;
  if (!pool.length) return null;
  const archOf = (n) => (/arm64|aarch64/i.test(n) ? 'arm64' : /x64|x86_64|amd64/i.test(n) ? 'x64' : /universal/i.test(n) ? 'universal' : null);
  // Never hand a build for another chip to a machine that can't run it. Apple Silicon Macs run
  // x64 builds under Rosetta, so that's the only cross-arch fallback.
  return pool.find((a) => archOf(a.name) === arch)
    || pool.find((a) => archOf(a.name) === 'universal')
    || pool.find((a) => archOf(a.name) === null)
    || (platform === 'darwin' && arch === 'arm64' && pool.find((a) => archOf(a.name) === 'x64'))
    || null;
}

/** Where the running .app bundle lives (macOS), from process.execPath. */
export function appBundlePath(execPath = process.execPath) {
  const i = execPath.indexOf('.app/Contents/MacOS/');
  return i === -1 ? null : execPath.slice(0, i + 4);
}

/**
 * Keep a GitHub token encrypted next to the app's settings.
 * tokenStore({ safeStorage, file }) -> { get(), set(token), has() }; set('') removes it.
 */
export function tokenStore({ safeStorage, file }) {
  const canEncrypt = () => { try { return !!safeStorage?.isEncryptionAvailable(); } catch { return false; } };
  return {
    get() {
      try {
        const raw = readFileSync(file, 'utf8').trim();
        if (!raw) return null;
        if (raw.startsWith('enc:')) return canEncrypt() ? safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64')) : null;
        return raw.startsWith('plain:') ? raw.slice(6) : null;
      } catch { return null; }
    },
    set(token) {
      const t = String(token ?? '').trim();
      if (!t) { try { unlinkSync(file); } catch { /* already gone */ } return; }
      mkdirSync(dirname(file), { recursive: true });
      const body = canEncrypt() ? 'enc:' + safeStorage.encryptString(t).toString('base64') : 'plain:' + t;
      writeFileSync(file, body, { mode: 0o600 });
    },
    has() { return !!this.get(); },
    /** False when the OS gives no encryption, so set() would store the token as plain text. */
    encrypted: canEncrypt,
  };
}

const MESSAGES = {
  'needs-token': 'Add a GitHub token in Settings to get updates (the repo is private).',
  'bad-token': 'The GitHub token was refused. Paste a new one in Settings.',
  'no-release': 'No release found on GitHub yet.',
  'no-asset': 'The newest release has no file for this computer.',
  'not-installed': 'Running from source, so updates can’t install here. Pull the code instead.',
  'not-writable': 'Can’t write to the app’s folder, so the update can’t install. Move the app to Applications.',
  'bad-download': 'The download didn’t match the release file. Try again later.',
  stalled: 'The download stalled. Will try again later.',
  'disk': 'Couldn’t save the update (is the disk full?).',
  offline: 'Couldn’t reach GitHub. Will try again later.',
};

function fail(code, detail) {
  const e = new Error(MESSAGES[code] || code);
  e.code = code;
  if (detail) e.detail = detail;
  return e;
}

/**
 * createUpdater({ app, repo: 'owner/name', getToken, getMode, onState, ... })
 *   -> { start(), stop(), check({manual}), download(), install({relaunch}), state }
 *
 * getMode() returns 'auto' (download and install on quit), 'notify' (only say an update
 * is out) or 'off' (no background checks; a manual check still works).
 * onState(state) gets { status, current, latest, notes, url, progress, canInstall, error, errorCode, checkedAt }
 * where status is idle | checking | up-to-date | available | downloading | ready | error.
 */
export function createUpdater({
  app,
  repo,
  getToken = () => null,
  getMode = () => 'auto',
  onState = () => {},
  intervalHours = 6,
  firstCheckDelayMs = 15_000,
  stallMs = 60_000,
  logFile,
  fetch: fetchImpl = globalThis.fetch,
  spawn = nodeSpawn,
  unzip = defaultUnzip,
  platform = process.platform,
  arch = process.arch,
  execPath = process.execPath,
  pid = process.pid,
  tmp,
  log = () => {},
}) {
  if (!app || !repo) throw new Error('createUpdater needs app and repo');
  const workDir = tmp || join(tmpdir(), `${String(app.getName?.() || 'app').replace(/[^\w.-]+/g, '-')}-update`);
  const supported = platform === 'win32' || platform === 'darwin';
  const state = { status: 'idle', current: app.getVersion(), latest: null, notes: '', url: '', progress: 0, canInstall: false, error: null, errorCode: null, checkedAt: null };
  let release = null; // { version, asset }
  let ready = null; // { version, file, appPath }
  let timer = null;
  let first = null;
  let busy = null;
  let quitHooked = false;
  let installing = false;

  const set = (patch) => { Object.assign(state, patch); try { onState({ ...state }); } catch (e) { log('onState threw', e); } };
  const mode = () => (UPDATE_MODES.includes(getMode()) ? getMode() : 'auto');
  // Why an update can't install on this machine, checked BEFORE downloading anything.
  function installBlocker() {
    if (!supported) return 'no-asset';
    if (!app.isPackaged) return 'not-installed';
    if (platform === 'darwin') {
      const target = appBundlePath(execPath);
      if (!target || /AppTranslocation/.test(target)) return 'not-installed';
      try { accessSync(dirname(target), constants.W_OK); accessSync(target, constants.W_OK); } catch { return 'not-writable'; }
    }
    return null;
  }

  function headers(extra = {}) {
    const h = { 'User-Agent': `${app.getName?.() || 'app'}-updater`, 'X-GitHub-Api-Version': '2022-11-28', ...extra };
    const token = getToken();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async function latestRelease() {
    let res;
    try {
      res = await fetchImpl(`${API}/repos/${repo}/releases/latest`, { headers: headers({ Accept: 'application/vnd.github+json' }), signal: AbortSignal.timeout(30_000) });
    } catch (e) { throw fail('offline', e.message); }
    if (res.status === 401) throw fail('bad-token');
    if (res.status === 429 || (res.status === 403 && res.headers?.get?.('x-ratelimit-remaining') === '0')) throw fail('offline', 'GitHub rate limit');
    if (res.status === 404 || res.status === 403) throw fail(getToken() ? (res.status === 403 ? 'bad-token' : 'no-release') : 'needs-token');
    if (!res.ok) throw fail('offline', `GitHub answered ${res.status}`);
    return res.json();
  }

  async function check({ manual = false } = {}) {
    if (busy) return busy;
    if (!manual && mode() === 'off') return { ...state };
    busy = (async () => {
      set({ status: 'checking', error: null, errorCode: null });
      try {
        const rel = await latestRelease();
        const version = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
        const base = { latest: version, notes: rel.body || '', url: rel.html_url || '', checkedAt: Date.now() };
        if (!isNewer(version, state.current)) { release = null; set({ ...base, status: 'up-to-date', canInstall: false }); return {}; }
        // Already downloaded this one (or newer): keep waiting for quit or Restart.
        if (ready && !isNewer(version, ready.version)) { set({ ...base, latest: ready.version, status: 'ready', canInstall: true }); return {}; }
        if (ready) { ready = null; } // a newer release came out while one was waiting: fetch that instead
        const asset = pickAsset(rel.assets, { platform, arch });
        release = asset ? { version, asset } : null;
        const blocked = asset ? installBlocker() : 'no-asset';
        set({ ...base, status: 'available', canInstall: !blocked, progress: 0, error: blocked ? MESSAGES[blocked] : null, errorCode: blocked });
        if (!blocked && mode() === 'auto') return { download: true };
      } catch (e) {
        log('update check failed', e);
        set({ status: 'error', error: e.message, errorCode: e.code || 'offline', checkedAt: Date.now() });
      }
      return {};
    })().then((r) => { busy = null; return r.download ? download() : { ...state }; });
    return busy;
  }

  async function fetchAsset(asset, signal) {
    // Ask the API for the bytes, then follow GitHub's redirect to its file host WITHOUT the token.
    const first = await fetchImpl(asset.url, { headers: headers({ Accept: 'application/octet-stream' }), redirect: 'manual', signal });
    if (first.status >= 300 && first.status < 400) {
      const loc = first.headers.get('location');
      if (!loc) throw fail('bad-download', 'redirect without location');
      return fetchImpl(loc, { headers: { 'User-Agent': headers()['User-Agent'], Accept: 'application/octet-stream' }, signal });
    }
    return first;
  }

  async function download() {
    if (busy) return busy;
    if (ready) return { ...state };
    if (!release) return { ...state };
    const blocked = installBlocker();
    if (blocked) { set({ status: 'available', canInstall: false, error: MESSAGES[blocked], errorCode: blocked }); return { ...state }; }
    const { version, asset } = release;
    busy = (async () => {
      set({ status: 'downloading', progress: 0, error: null, errorCode: null });
      try {
        rmSync(workDir, { recursive: true, force: true });
        mkdirSync(workDir, { recursive: true });
        const file = join(workDir, asset.name.replace(/[^\w.-]+/g, '-'));
        // Abort when no bytes arrive for stallMs, so a dead connection can't leave us busy forever.
        const ctrl = new AbortController();
        let stall = setTimeout(() => ctrl.abort(), stallMs);
        const poke = () => { clearTimeout(stall); stall = setTimeout(() => ctrl.abort(), stallMs); };
        const out = createWriteStream(file);
        let diskError = null;
        out.on('error', (e) => { diskError = e; });
        let got = 0;
        const hash = createHash('sha256');
        try {
          let res;
          try { res = await fetchAsset(asset, ctrl.signal); } catch (e) { throw e.code ? e : fail(ctrl.signal.aborted ? 'stalled' : 'offline', e.message); }
          if (!res.ok || !res.body) throw fail(res.status === 401 || res.status === 404 ? 'bad-token' : 'offline', `download answered ${res.status}`);
          const total = Number(asset.size) || Number(res.headers.get('content-length')) || 0;
          let lastPct = -1;
          try {
            for await (const chunk of res.body) {
              poke();
              if (diskError) throw fail('disk', diskError.message);
              const buf = Buffer.from(chunk);
              hash.update(buf);
              got += buf.length;
              if (!out.write(buf)) {
                await new Promise((r) => { const done = () => { out.off('drain', done); out.off('error', done); r(); }; out.once('drain', done); out.once('error', done); });
              }
              const pct = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
              if (pct !== lastPct) { lastPct = pct; set({ progress: pct }); }
            }
          } catch (e) { throw e.code ? e : fail(ctrl.signal.aborted ? 'stalled' : 'offline', e.message); }
        } finally {
          clearTimeout(stall);
          await new Promise((r) => { if (out.destroyed || diskError) return r(); out.once('error', () => r()); out.end(r); });
        }
        if (diskError) throw fail('disk', diskError.message);
        if (asset.size && got !== Number(asset.size)) throw fail('bad-download', `size ${got} != ${asset.size}`);
        const digest = String(asset.digest || '');
        // GitHub records a sha256 for every release file; without one there's nothing to trust.
        if (!digest.startsWith('sha256:')) throw fail('bad-download', 'release file has no sha256 digest');
        if (digest.slice(7).toLowerCase() !== hash.digest('hex')) throw fail('bad-download', 'sha256 mismatch');

        let appPath = null;
        if (platform === 'darwin') {
          const dir = join(workDir, 'unzipped');
          mkdirSync(dir, { recursive: true });
          await unzip(file, dir);
          const name = readdirSync(dir).find((n) => n.endsWith('.app'));
          if (!name) throw fail('bad-download', 'zip has no .app');
          appPath = join(dir, name);
        }
        ready = { version, file, appPath };
        hookQuit();
        set({ status: 'ready', progress: 100, canInstall: true });
      } catch (e) {
        log('update download failed', e);
        set({ status: 'error', error: e.message, errorCode: e.code || 'offline' });
      } finally { busy = null; }
      return { ...state };
    })();
    return busy;
  }

  function hookQuit() {
    if (quitHooked) return;
    quitHooked = true;
    // Downloaded (automatically or because the person asked): install when the app quits for any
    // reason, without reopening it.
    app.on('will-quit', () => { if (ready && !installing) runInstaller(false); });
  }

  function runInstaller(relaunch) {
    if (!ready || installing) return false;
    installing = true;
    try {
      if (platform === 'win32') {
        const args = ['--updated', '/S'];
        if (relaunch) args.push('--force-run');
        spawn(ready.file, args, { detached: true, stdio: 'ignore' }).unref();
      } else {
        const script = join(workDir, 'swap.sh');
        writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 });
        spawn('/bin/sh', [script], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, MN_PID: String(pid), MN_NEW: ready.appPath, MN_TARGET: appBundlePath(execPath), MN_RELAUNCH: relaunch ? '1' : '0', MN_TMP: workDir, MN_LOG: logFile || join(dirname(workDir), `${basename(workDir)}.log`) },
        }).unref();
      }
      return true;
    } catch (e) {
      installing = false;
      log('could not start installer', e);
      set({ status: 'error', error: e.message, errorCode: 'install' });
      return false;
    }
  }

  /** Install the downloaded update now: quits the app; relaunch reopens it afterwards. */
  function install({ relaunch = true } = {}) {
    if (!runInstaller(relaunch)) return false;
    app.quit();
    return true;
  }

  function start() {
    stop();
    first = setTimeout(() => check(), firstCheckDelayMs);
    if (intervalHours > 0) timer = setInterval(() => check(), intervalHours * 3600_000);
    first.unref?.();
    timer?.unref?.();
  }

  function stop() {
    if (first) clearTimeout(first);
    if (timer) clearInterval(timer);
    first = timer = null;
  }

  return { start, stop, check, download, install, get state() { return { ...state }; } };
}

function defaultUnzip(file, dir) {
  // ditto keeps the .app's symlinks, permissions and signature (unzip doesn't).
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/ditto', ['-x', '-k', file, dir], (err) => (err ? reject(fail('bad-download', err.message)) : resolve()));
  });
}

// Runs detached after the app quits. Paths arrive in env vars, never pasted into the script.
export const SWAP_SCRIPT = `#!/bin/sh
# Copy first, then two quick renames, so a shutdown mid-copy never leaves a half-built app.
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$MN_LOG" 2>/dev/null; }
i=0
while kill -0 "$MN_PID" 2>/dev/null; do
  i=$((i+1)); if [ $i -gt 600 ]; then log "app still running after 2 min; update skipped"; exit 1; fi
  sleep 0.2
done
NEW="$MN_TARGET.new-update"
OLD="$MN_TARGET.old-update"
rm -rf "$NEW" "$OLD"
if ! /usr/bin/ditto "$MN_NEW" "$NEW"; then log "copy failed; kept the current app"; rm -rf "$NEW"; [ "$MN_RELAUNCH" = 1 ] && /usr/bin/open "$MN_TARGET"; exit 1; fi
/usr/bin/xattr -dr com.apple.quarantine "$NEW" 2>/dev/null
if ! mv "$MN_TARGET" "$OLD"; then log "could not move the current app aside; update skipped"; rm -rf "$NEW"; [ "$MN_RELAUNCH" = 1 ] && /usr/bin/open "$MN_TARGET"; exit 1; fi
if ! mv "$NEW" "$MN_TARGET"; then log "could not move the new app in; restored the old one"; mv "$OLD" "$MN_TARGET"; rm -rf "$NEW"; [ "$MN_RELAUNCH" = 1 ] && /usr/bin/open "$MN_TARGET"; exit 1; fi
rm -rf "$OLD"
log "updated $MN_TARGET"
if [ "$MN_RELAUNCH" = 1 ]; then /usr/bin/open "$MN_TARGET"; fi
rm -rf "$MN_TMP"
`;

