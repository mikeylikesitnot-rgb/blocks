#!/usr/bin/env node
/*
 * Install and update Michael's own apps on this computer (Mac or Windows) from one list.
 *
 *   node ops/apps.mjs status  [name|all] [--json]
 *   node ops/apps.mjs install <name|all> [--force] [--json]
 *   node ops/apps.mjs update  [name|all] [--force] [--json]
 *   options: --manifest <file> (default ops/apps.json next to this script), --apps-dir <dir>,
 *            --progress (with --json: each step still goes to stderr, for a live UI)
 *
 * Kinds (see apps.json):
 * - electron-release: latest GitHub release. macOS: the .zip for this arch (pickAsset), sha256
 *   checked against GitHub's digest, the app quit if running, /Applications/<product>.app swapped,
 *   reopened if it was running. Windows: the NSIS .exe run silently (/S).
 * - script-repo: `gh repo clone` into the apps folder (~/apps, C:\apps on Windows; --apps-dir or
 *   APPS_DIR to change), or `git pull --ff-only`, then the hook for this OS from the repo folder.
 *   A repo with uncommitted changes is never pulled.
 * install = missing or behind; update = only apps already installed and behind; --force does it anyway.
 * - code-repo: a project kept current for working on it (nothing is deployed): cloned or pulled like
 *   script-repo, then set up: `npm ci` (`npm install` without a lockfile) when there's a package.json,
 *   a .venv plus `pip install -e .` when there's a pyproject.toml, nothing otherwise (setupCommands).
 * Per-computer folders: --folders '{"AutoDealer":"/Users/me/AutoDealer"}' uses an existing checkout for an app
 * instead of <apps folder>/<name> (check-folder <name> <path> says whether a path is a checkout of its repo).
 * open <name>: opens the app's folder in VS Code on this computer.
 * Tools: each app lists what it needs per OS (`needs`, ids from TOOLS). status reports the missing ones per
 * app (`missing`) and git / gh / a gh sign-in for the whole computer (`computer.missing`); install and update
 * refuse an app whose tools are missing, so a build doesn't fail minutes in. Only quick lookups, nothing installed.
 * All GitHub access goes through `gh` (its login reaches private repos). Exit 1 if anything failed.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, pickAsset } from '../server/desktopUpdate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Env for anything we start: ELECTRON_RUN_AS_NODE (set by VS Code's terminal) makes Electron apps quit silently. */
export function launchEnv(env = process.env) { const { ELECTRON_RUN_AS_NODE, ...rest } = env; return rest; }
export const COMMANDS = ['status', 'install', 'update', 'check-folder', 'open'];
export const KINDS = ['electron-release', 'script-repo', 'code-repo'];

export function loadManifest(file = join(HERE, 'apps.json')) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const apps = Array.isArray(data) ? data : data.apps;
  if (!Array.isArray(apps)) throw new Error(`${file}: no "apps" list`);
  for (const a of apps) {
    if (!a.name || !a.repo) throw new Error(`${file}: every app needs name and repo`);
    if (!KINDS.includes(a.kind)) throw new Error(`${a.name}: kind must be ${KINDS.join(' or ')}`);
  }
  return apps;
}

export function appsDir({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  if (env.APPS_DIR) return env.APPS_DIR;
  return platform === 'win32' ? 'C:\\apps' : join(home, 'apps');
}

/** Which apps a name picks: all (default) or one, case-insensitive. */
export function selectApps(apps, name) {
  if (!name || name === 'all') return apps;
  const hit = apps.filter((a) => a.name.toLowerCase() === String(name).toLowerCase());
  if (!hit.length) throw new Error(`no app "${name}" (have: ${apps.map((a) => a.name).join(', ')})`);
  return hit;
}

/** state: missing | current | behind | ahead | dirty | unsupported | error */
export function classify({ installed, latest, dirty = false }) {
  if (!installed) return 'missing';
  if (dirty) return 'dirty';
  if (!latest) return 'error';
  if (installed === latest) return 'current';
  if (/^[0-9a-f]{7,40}$/.test(installed)) return 'behind'; // git: different commit, ahead handled by caller
  const c = compareVersions(installed, latest);
  return c === 0 ? 'current' : c < 0 ? 'behind' : 'ahead';
}

/** Whether a command acts on an app in this state. */
export function shouldAct(command, state, force = false) {
  if (state === 'unsupported' || state === 'error') return false;
  if (state === 'dirty') return false;
  if (command === 'install') return force || state === 'missing' || state === 'behind';
  if (command === 'update') return state !== 'missing' && (force || state === 'behind');
  return false;
}

/** How to run a hook file on this OS: [command, args]. */
export function hookCommand(file, platform = process.platform) {
  if (/\.ps1$/i.test(file)) return [platform === 'win32' ? 'powershell' : 'pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file]];
  if (/\.(sh|bash)$/i.test(file)) return ['sh', [file]];
  if (/\.(mjs|js)$/i.test(file)) return ['node', [file]];
  if (/\.(cmd|bat)$/i.test(file)) return ['cmd', ['/c', file]];
  throw new Error(`don't know how to run hook ${file}`);
}

/** code-repo setup for the files a repo has: a list of [command, args] run in order from the repo folder. */
export function setupCommands(has, platform = process.platform) {
  const win = platform === 'win32';
  if (has('package.json')) return [['npm', has('package-lock.json') ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund']]];
  if (has('pyproject.toml')) {
    const pip = win ? join('.venv', 'Scripts', 'pip.exe') : join('.venv', 'bin', 'pip');
    return [[win ? 'python' : 'python3', ['-m', 'venv', '.venv']], [pip, ['install', '--quiet', '-e', '.']]];
  }
  return [];
}

/**
 * What apps can need, how to tell it's there (a command that exits 0, per OS) and how to get it.
 * `fix` is shown on the Apps page as is.
 */
export const TOOLS = {
  // On a Mac without the command-line tools, /usr/bin/git and xcrun are stubs that pop up Apple's install dialog,
  // so ask xcode-select (quiet) first, or look for Homebrew's git.
  git: { label: 'git', check: { darwin: ['sh', ['-c', 'xcode-select -p >/dev/null 2>&1 || test -x /opt/homebrew/bin/git || test -x /usr/local/bin/git']], win32: ['git', ['--version']] },
    fix: { darwin: 'xcode-select --install', win32: 'winget install Git.Git' } },
  gh: { label: 'GitHub CLI (gh)', check: { darwin: ['gh', ['--version']], win32: ['gh', ['--version']] },
    fix: { darwin: 'brew install gh', win32: 'winget install GitHub.cli' } },
  // gh auth token: no network, and only github.com (auth status fails for any bad host or when offline).
  'gh-auth': { label: 'GitHub CLI sign-in', check: { darwin: ['gh', ['auth', 'token', '--hostname', 'github.com']], win32: ['gh', ['auth', 'token', '--hostname', 'github.com']] },
    fix: { darwin: 'gh auth login', win32: 'gh auth login' } },
  node: { label: 'Node.js', check: { darwin: ['node', ['--version']], win32: ['node', ['--version']] },
    fix: { darwin: 'brew install node', win32: 'winget install OpenJS.NodeJS.LTS' } },
  python: { label: 'Python 3', check: { darwin: ['python3', ['--version']], win32: ['python', ['--version']] },
    fix: { darwin: 'brew install python', win32: 'winget install Python.Python.3.12' } },
  swift: { label: 'Xcode command-line tools', check: { darwin: ['sh', ['-c', 'xcode-select -p >/dev/null 2>&1 && xcrun --find swift >/dev/null']] },
    fix: { darwin: 'xcode-select --install' } },
  rust: { label: 'Rust', check: { darwin: ['cargo', ['--version']], win32: ['cargo', ['--version']] },
    fix: { darwin: 'curl https://sh.rustup.rs -sSf | sh', win32: 'winget install Rustlang.Rustup' } },
  msvc: { label: 'VS C++ Build Tools',
    check: { win32: ['C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe', ['-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']] },
    fix: { win32: 'winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet"' } },
};
/** What every computer needs for script and code apps (clone and pull go through git and gh). */
export const COMPUTER_TOOLS = ['git', 'gh', 'gh-auth'];

/** Characters cmd.exe treats as special, even in a quoted argument (`code` is a .cmd there). */
export const WIN_UNSAFE = /[&|^%<>()!"]/;

/** Whether a git remote URL points at owner/repo on GitHub (https or ssh, with or without .git, any case). */
export function sameRepo(url, repo) {
  const m = String(url || '').trim().match(/github\.com[:/]+([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
  return !!m && m[1].toLowerCase() === String(repo).toLowerCase();
}

export function createApps({
  platform = process.platform,
  arch = process.arch,
  dir = appsDir({ platform }),
  sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }),
  exists = existsSync,
  log = (m) => console.error(m),
  // --progress: what install steps print (clone, pull, hooks, npm) goes to stderr as it happens, so a UI can
  // show it live and keep it as the run's log. Off, it is captured and only its error line is kept.
  stream = false,
  folders = {},
} = {}) {
  // Each tool is looked up at most once per run. vswhere prints the install path; empty means not there.
  const seen = new Map();
  const hasTool = (id) => {
    if (!seen.has(id)) {
      const c = TOOLS[id]?.check?.[platform];
      let ok = false;
      if (c) { try { const out = sh(c[0], c[1], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }); ok = id !== 'msvc' || String(out ?? '').trim() !== ''; } catch { ok = false; } }
      seen.set(id, ok);
    }
    return seen.get(id);
  };
  const describe = (id) => ({ id, label: TOOLS[id]?.label ?? id, fix: TOOLS[id]?.fix?.[platform] ?? null });
  /** The tools this app needs here that aren't on this computer ([] when none, or none listed). */
  const missingFor = (app) => (app.needs?.[platform] ?? []).filter((id) => !hasTool(id)).map(describe);
  /** git, gh and a gh sign-in: needed by every script and code app, so reported once for the computer. */
  function computer() {
    const missing = [];
    if (!hasTool('git')) missing.push(describe('git'));
    if (!hasTool('gh')) missing.push(describe('gh'));
    else if (!hasTool('gh-auth')) missing.push(describe('gh-auth'));
    return { missing };
  }

  /** Where an app lives on this computer: an existing folder the owner picked, else <apps folder>/<folder or name>. */
  const pathOf = (app) => folders[app.name] || join(dir, app.folder || app.name);
  const out = stream ? ['ignore', 2, 2] : ['ignore', 'pipe', 'pipe'];
  const tryOut = (cmd, args, opts) => { try { return String(sh(cmd, args, opts) ?? '').trim(); } catch { return ''; } };
  /** Like tryOut, but keeps leading spaces (git status --porcelain columns). */
  const rawOut = (cmd, args) => { try { return String(sh(cmd, args) ?? ''); } catch { return ''; } };

  const latestRelease = (repo) => JSON.parse(sh('gh', ['api', `repos/${repo}/releases/latest`]));
  const macAppPath = (app) => app.macPath || `/Applications/${app.product || app.name}.app`;

  function electronInstalled(app) {
    if (platform === 'darwin') {
      const plist = join(macAppPath(app), 'Contents', 'Info.plist');
      return exists(plist) ? tryOut('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist]) || null : null;
    }
    if (platform === 'win32') {
      // electron-builder writes DisplayName "<product> <version>"; -cmatch is case-sensitive so
      // TechSmith's "Snagit 2024" never counts as our "SnagIt".
      const name = (app.product || app.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "''");
      const ps = "$k='Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';$w='Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';"
        + `Get-ItemProperty "HKCU:\\$k","HKLM:\\$k","HKLM:\\$w" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -cmatch '^${name}( \\d|$)' } | Select-Object -First 1 -ExpandProperty DisplayVersion`;
      return tryOut('powershell', ['-NoProfile', '-Command', ps]) || null;
    }
    return null;
  }

  function scriptInfo(app) {
    const path = pathOf(app);
    const picked = !!folders[app.name];
    // A folder the owner picked is never cloned into or used blindly: it must still be there, still be a
    // checkout of this app's repo, and be on its branch, or the app reads as an error with the reason.
    if (picked) {
      if (!exists(join(path, '.git'))) throw new Error(`the folder picked for ${app.name} (${path}) is gone or isn't a git checkout; pick another or use the apps folder`);
      const url = tryOut('git', ['-C', path, 'remote', 'get-url', 'origin']);
      if (!sameRepo(url, app.repo)) throw new Error(`${path} is now a checkout of ${url || 'no GitHub repo'}, not ${app.repo}`);
      const on = tryOut('git', ['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD']);
      if (on && on !== (app.branch || 'main')) throw new Error(`${path} is on branch ${on}, not ${app.branch || 'main'}; switch back to update it here`);
    }
    if (!exists(join(path, '.git'))) return { path, installed: null };
    const branch = app.branch || 'main';
    let fetched = true;
    try { sh('git', ['-C', path, 'fetch', '--quiet', 'origin', branch]); } catch { fetched = false; }
    const head = tryOut('git', ['-C', path, 'rev-parse', '--short', 'HEAD']);
    const remote = tryOut('git', ['-C', path, 'rev-parse', '--short', `origin/${branch}`]);
    const dirty = tryOut('git', ['-C', path, 'status', '--porcelain', '--untracked-files=no']) !== '';
    const behind = Number(tryOut('git', ['-C', path, 'rev-list', '--count', `HEAD..origin/${branch}`]) || 0);
    const ahead = Number(tryOut('git', ['-C', path, 'rev-list', '--count', `origin/${branch}..HEAD`]) || 0);
    // The commit whose hook last finished (installScript records it). A hook that failed after
    // the pull leaves HEAD current but the app stale; that must still read as needing an update.
    const hookPending = (app.kind === 'code-repo' || !!app.hook?.[platform]) && !!head && tryOut('git', ['-C', path, 'config', '--get', 'apps.hooked']) !== head;
    return { path, branch, installed: head || null, latest: remote || null, dirty, behind, ahead, fetched, hookPending };
  }

  function status(app) {
    const s = statusOf(app);
    if (s.state === 'unsupported') return s;
    const missing = missingFor(app);
    return missing.length ? { ...s, missing } : s;
  }

  function statusOf(app) {
    const base = { name: app.name, kind: app.kind, about: app.about || '' };
    if (app.platforms && !app.platforms.includes(platform)) return { ...base, state: 'unsupported', installed: null, latest: null };
    try {
      if (app.kind === 'electron-release') {
        const rel = latestRelease(app.repo);
        const latest = String(rel.tag_name || '').replace(/^v/, '') || null;
        const installed = electronInstalled(app);
        return { ...base, installed, latest, state: classify({ installed, latest }), release: rel };
      }
      const info = scriptInfo(app);
      let state = classify(info);
      if (state === 'behind' && !info.behind) state = 'ahead'; // local commits not on origin
      let note = info.installed && !info.fetched ? "couldn't reach GitHub; latest is from the last check" : null;
      if (state === 'current' && info.hookPending) { state = 'behind'; note = "install step hasn't finished for this version; Update runs it again"; }
      // What blocks an update: the changed files (up to 20) or the commits not on GitHub (up to 10).
      const changes = state === 'dirty' ? rawOut('git', ['-C', info.path, 'status', '--porcelain', '--untracked-files=no']).split('\n').filter((l) => l.trim()).slice(0, 20) : null;
      const commits = state === 'ahead' || (state === 'dirty' && info.ahead) ? tryOut('git', ['-C', info.path, 'log', '--oneline', '--no-decorate', '-n', '10', `origin/${info.branch}..HEAD`]).split('\n').filter(Boolean) : null;
      return { ...base, installed: info.installed, latest: info.latest, state, behind: info.behind, path: info.path, branch: info.branch, note, changes, commits };
    } catch (e) {
      return { ...base, installed: null, latest: null, state: 'error', note: firstLine(e) };
    }
  }

  function installElectron(app, s) {
    const asset = pickAsset(s.release.assets || [], { platform, arch });
    if (!asset) throw new Error(`release ${s.release.tag_name} has no file for ${platform}/${arch}`);
    const digest = String(asset.digest || '');
    if (!digest.startsWith('sha256:')) throw new Error(`${asset.name} has no sha256 digest on GitHub`);
    const tmp = mkdtempSync(join(tmpdir(), 'mn-apps-'));
    try {
      log(`  downloading ${asset.name}`);
      sh('gh', ['release', 'download', s.release.tag_name, '-R', app.repo, '-p', asset.name, '-D', tmp, '--clobber']);
      const file = join(tmp, asset.name);
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (hash !== digest.slice(7).toLowerCase()) throw new Error(`${asset.name}: sha256 mismatch, not installed`);
      const product = app.product || app.name;
      if (platform === 'win32') {
        const exe = `${product}.exe`;
        const running = () => tryOut('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH']).toLowerCase().includes(exe.toLowerCase());
        const wasRunning = running();
        if (wasRunning) {
          log(`  closing ${product}`);
          tryOut('taskkill', ['/IM', exe, '/T']);
          for (let i = 0; i < 20 && running(); i++) sh('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500']);
          if (running()) tryOut('taskkill', ['/IM', exe, '/T', '/F']);
        }
        log('  running the installer silently');
        // --force-run: electron-builder's NSIS starts the app again after a silent install.
        sh(file, wasRunning ? ['/S', '--force-run'] : ['/S'], { stdio: 'ignore', timeout: 10 * 60_000, env: launchEnv() });
        return;
      }
      const target = macAppPath(app);
      const out = join(tmp, 'x');
      sh('ditto', ['-x', '-k', file, out]);
      const bundle = join(out, `${product}.app`);
      if (!exists(bundle)) throw new Error(`${asset.name} has no ${product}.app inside`);
      const wasRunning = tryOut('pgrep', ['-x', product]) !== '';
      if (wasRunning) {
        log(`  quitting ${product}`);
        tryOut('osascript', ['-e', `quit app "${product}"`]);
        for (let i = 0; i < 30 && tryOut('pgrep', ['-x', product]); i++) sh('sleep', ['0.5']);
        if (tryOut('pgrep', ['-x', product])) throw new Error(`${product} did not quit; close it and try again`);
      }
      // Copy next to the old app first, then swap, so a failed copy never leaves no app.
      const fresh = `${target}.new`;
      const old = `${target}.old`;
      sh('rm', ['-rf', fresh, old]);
      sh('ditto', [bundle, fresh]);
      if (exists(target)) sh('mv', [target, old]);
      try { sh('mv', [fresh, target]); } catch (e) { if (exists(old)) sh('mv', [old, target]); throw e; }
      sh('rm', ['-rf', old]);
      tryOut('xattr', ['-dr', 'com.apple.quarantine', target]);
      if (wasRunning) tryOut('open', [target], { env: launchEnv() });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  function installScript(app, s) {
    const path = s.path || pathOf(app);
    if (s.state === 'missing') {
      log(`  cloning ${app.repo} into ${path}`);
      sh('gh', ['repo', 'clone', app.repo, path, '--', '--branch', app.branch || 'main'], { stdio: out });
    } else {
      log(`  pulling ${path}`);
      sh('git', ['-C', path, 'pull', '--ff-only', 'origin', app.branch || 'main'], { stdio: out });
    }
    const hook = app.hook?.[platform];
    // In a folder the owner picked (their working copy), packages already there are left alone: npm ci would
    // wipe node_modules under a running dev server.
    const installed = exists(join(path, 'node_modules')) || exists(join(path, '.venv'));
    const steps = app.kind === 'code-repo' ? (folders[app.name] && installed ? [] : setupCommands((f) => exists(join(path, f)), platform)) : hook ? [hookCommand(hook, platform)] : [];
    if (steps.length || app.kind === 'code-repo') {
      for (const [cmd, args] of steps) {
        log(`  running ${[cmd, ...args].join(' ')}`);
        // npm is npm.cmd on Windows, which Node only starts through a shell.
        sh(cmd, args, { cwd: path, stdio: out, env: launchEnv(), shell: platform === 'win32' && cmd === 'npm', timeout: 20 * 60_000 });
      }
      const head = tryOut('git', ['-C', path, 'rev-parse', '--short', 'HEAD']);
      if (head) sh('git', ['-C', path, 'config', 'apps.hooked', head]);
    }
  }

  function act(app, command, { force = false } = {}) {
    const before = status(app);
    if (before.state === 'error') return { ...before, action: 'failed' };
    if (!shouldAct(command, before.state, force)) return { ...before, action: 'skipped' };
    if (before.missing?.length) return { ...before, action: 'failed', note: `Needs ${before.missing.map((m) => m.label).join(', ')}` };
    log(`${app.name}: ${command} (${before.installed || 'not installed'} → ${before.latest || 'latest'})`);
    try {
      if (app.kind === 'electron-release') installElectron(app, before);
      else installScript(app, before);
    } catch (e) {
      return { ...before, action: 'failed', note: firstLine(e) };
    }
    const after = status(app);
    return { ...after, action: before.state === 'missing' ? 'installed' : 'updated', from: before.installed };
  }

  /** Whether `path` can stand in for this app here: a git checkout whose origin is the app's repo. */
  function checkFolder(app, path) {
    const base = { name: app.name, kind: app.kind, about: app.about || '', path };
    if (app.kind === 'electron-release') return { ...base, ok: false, note: `${app.name} is an installed app, not a folder` };
    if (!path || !/^(\/|[A-Za-z]:[\\/]|~)/.test(path)) return { ...base, ok: false, note: 'Give the full path, like /Users/me/AutoDealer' };
    if (platform === 'win32' && WIN_UNSAFE.test(path)) return { ...base, ok: false, note: 'On Windows the path can\'t contain & | ^ % < > ( ) ! or "' };
    const full = path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
    if (!exists(full)) return { ...base, path: full, ok: false, note: `${full} doesn't exist on this computer` };
    if (!exists(join(full, '.git'))) return { ...base, path: full, ok: false, note: `${full} isn't a git checkout` };
    const url = tryOut('git', ['-C', full, 'remote', 'get-url', 'origin']);
    if (!sameRepo(url, app.repo)) return { ...base, path: full, ok: false, note: `${full} is a checkout of ${url || 'no GitHub repo'}, not ${app.repo}` };
    return { ...base, path: full, ok: true, note: null };
  }

  /** Opens the app's folder in VS Code (the `code` command, else the app by name on a Mac). */
  function openFolder(app) {
    const base = { name: app.name, kind: app.kind, about: app.about || '' };
    if (app.kind === 'electron-release') return { ...base, ok: false, note: `${app.name} has no folder to open` };
    const path = pathOf(app);
    if (!exists(path)) return { ...base, path, ok: false, note: `${path} isn't on this computer yet` };
    if (platform === 'win32' && WIN_UNSAFE.test(path)) return { ...base, path, ok: false, note: 'Open it by hand: its path has characters Windows\' command line treats as special' };
    try {
      if (platform === 'win32') sh('cmd', ['/c', 'code', path], { stdio: 'ignore', env: launchEnv() });
      else { try { sh('code', [path], { stdio: 'ignore', env: launchEnv() }); } catch { sh('open', ['-a', 'Visual Studio Code', path], { stdio: 'ignore', env: launchEnv() }); } }
      return { ...base, path, ok: true, note: null };
    } catch (e) {
      return { ...base, path, ok: false, note: `Couldn't open VS Code: ${firstLine(e)}` };
    }
  }

  return { status, act, checkFolder, openFolder, computer, dir };
}

/** The line that says what went wrong: the first one that looks like an error, else the last real one. Never
 * Node's "Node.js vX" crash footer or a stack frame. */
export function firstLine(e) {
  const clean = (t) => String(t || '').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^Node\.js v\d/.test(l) && !/^at\s/.test(l) && !/^\^+$/.test(l) && !/^Command failed:/.test(l));
  // What the command printed first; the exception's own message only when it printed nothing.
  let lines = [...clean(e?.stderr), ...clean(e?.stdout)];
  if (!lines.length) lines = String(e?.message || (typeof e === 'string' ? e : '')).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^Node\.js v\d/.test(l));
  const hit = lines.find((l) => /\b(error|fatal|failed|not found|denied|cannot|could ?n[o']t)\b|ERR!/i.test(l));
  return (hit || lines.pop() || 'failed').slice(0, 300);
}

const STATE_LABEL = { missing: 'not installed', current: 'up to date', behind: 'update available', ahead: 'ahead of latest', dirty: 'local changes', unsupported: 'not for this OS', error: 'error' };

export function formatTable(rows) {
  const lines = [['App', 'Installed', 'Latest', 'Status']];
  for (const r of rows) {
    const label = STATE_LABEL[r.state] || r.state;
    const extra = r.action && r.action !== 'skipped' ? ` (${r.action})` : '';
    lines.push([r.name, r.installed || '-', r.latest || '-', label + extra + (r.note ? `: ${r.note}` : '')]);
  }
  const w = lines[0].map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  return lines.map((l) => l.map((c, i) => (i === l.length - 1 ? c : c.padEnd(w[i]))).join('  ')).join('\n');
}

export const ROW_KEYS = ['name', 'kind', 'about', 'state', 'installed', 'latest', 'behind', 'branch', 'path', 'action', 'from', 'note', 'changes', 'commits', 'ok', 'missing'];
/** Every row has the same keys (null when empty), so a UI can rely on them. */
export const toRow = (r) => Object.fromEntries(ROW_KEYS.map((k) => [k, r[k] ?? null]));
const FLAGS = ['--json', '--force', '--manifest', '--apps-dir', '--progress', '--folders'];

export function main(argv = process.argv.slice(2)) {
  const opt = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };
  const valued = new Set([opt('--manifest'), opt('--apps-dir'), opt('--folders')].filter(Boolean));
  const words = argv.filter((a) => !a.startsWith('--') && !valued.has(a));
  const [command = 'status', name] = words;
  const json = argv.includes('--json');
  const bad = (msg) => { if (json) console.log(JSON.stringify({ error: msg })); console.error(`apps: ${msg}`); return 2; };
  const unknown = argv.filter((a) => a.startsWith('--') && !FLAGS.includes(a));
  if (unknown.length) return bad(`unknown option ${unknown.join(' ')} (have ${FLAGS.join(' ')})`);
  if (!COMMANDS.includes(command)) return bad(`say ${COMMANDS.join(', ')}`);
  if (command === 'install' && !name) return bad('install <name|all>');
  if ((command === 'open' || command === 'check-folder') && (!name || name === 'all')) return bad(`${command} <name>${command === 'check-folder' ? ' <path>' : ''}`);
  if (command === 'check-folder' ? words.length !== 3 : words.length > 2) return bad(`one app at a time, or all (got ${words.slice(1).join(' ')})`);
  let folders = {};
  if (opt('--folders')) {
    try { folders = JSON.parse(opt('--folders')); } catch { return bad('--folders must be JSON: {"App":"/path"}'); }
    if (!folders || typeof folders !== 'object' || Array.isArray(folders) || Object.values(folders).some((v) => typeof v !== 'string')) return bad('--folders must be JSON: {"App":"/path"}');
  }
  let picked;
  try { picked = selectApps(loadManifest(opt('--manifest') || undefined), name); } catch (e) { return bad(e.message); }
  // --progress: with --json, still write each step ("pulling …", "running hook …") to stderr, so a UI
  // can show it live; stdout stays the one JSON answer.
  const quiet = json && !argv.includes('--progress');
  const apps = createApps({ ...(opt('--apps-dir') ? { dir: opt('--apps-dir') } : {}), log: quiet ? () => {} : undefined, stream: json && !quiet, folders });
  const one = (a) => {
    if (command === 'status') return apps.status(a);
    if (command === 'check-folder') return apps.checkFolder(a, words[2]);
    if (command === 'open') return apps.openFolder(a);
    return apps.act(a, command, { force: argv.includes('--force') });
  };
  const rows = picked.map((a) => toRow(one(a)));
  const extra = command === 'status' ? { computer: apps.computer() } : {};
  if (json) console.log(JSON.stringify({ platform: process.platform, dir: apps.dir, ...extra, apps: rows }, null, 2));
  else console.log(formatTable(rows));
  return rows.some((r) => r.action === 'failed' || r.ok === false) ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
