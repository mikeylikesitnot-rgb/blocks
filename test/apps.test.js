import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { appsDir, classify, launchEnv, createApps, formatTable, firstLine, hookCommand, loadManifest, sameRepo, TOOLS, setupCommands, main, ROW_KEYS, selectApps, shouldAct, toRow } from '../ops/apps.mjs';
import { vi } from 'vitest';

describe('apps manifest', () => {
  const apps = loadManifest();
  it('ships SnagIt and WindowsManager with a valid kind', () => {
    expect(apps.map((a) => a.name)).toEqual(expect.arrayContaining(['SnagIt', 'WindowsManager', 'AppShelf', 'ImageViewer']));
    expect(apps.find((a) => a.name === 'ImageViewer')).toMatchObject({ kind: 'script-repo', hook: { darwin: 'scripts/apps-hook.sh' } });
    expect(apps.find((a) => a.name === 'AppShelf')).toMatchObject({ kind: 'electron-release', product: 'AppShelf' });
    expect(apps.find((a) => a.name === 'WindowsManager').hook).toEqual({ darwin: 'mac/install.sh', win32: 'windows/setup.ps1' });
  });
  it('ships the Mac script apps with a hook for every platform they list', () => {
    expect(apps.map((a) => a.name)).toEqual(expect.arrayContaining(['edge-workspace-switcher', 'maclikewindows', 'Mac Explorer', 'ScreenShare']));
    for (const a of apps.filter((x) => x.kind === 'script-repo')) {
      for (const p of a.platforms) expect(a.hook?.[p], `${a.name} hook for ${p}`).toBeTruthy();
    }
    expect(apps.find((a) => a.name === 'Mac Explorer').folder).toBe('mac explorer');
    expect(apps.find((a) => a.name === 'edge-workspace-switcher').branch).toBe('master');
  });
  it('ships FinePrint, Vitals, claude-skills and the web projects as code-repos', () => {
    expect(apps.find((a) => a.name === 'FinePrint')).toMatchObject({ kind: 'script-repo', platforms: ['darwin'], hook: { darwin: 'scripts/apps-hook.sh' } });
    expect(apps.find((a) => a.name === 'Vitals')).toMatchObject({ kind: 'script-repo', platforms: ['win32'], hook: { win32: 'scripts/apps-hook.ps1' } });
    expect(apps.find((a) => a.name === 'claude-skills').hook).toEqual({ darwin: 'scripts/apps-hook.sh', win32: 'scripts/apps-hook.ps1' });
    const code = apps.filter((a) => a.kind === 'code-repo').map((a) => a.name);
    expect(code).toEqual(['AutoDealer', 'TuroApp', 'webmail', 'learning', 'auction', 'BigLoveInstall', 'mungercompany', 'llmlocal']);
    for (const a of apps.filter((x) => x.kind === 'code-repo')) expect(a.hook, `${a.name} needs no hook`).toBeUndefined();
    // Project Hub's agent refuses names outside this pattern.
    for (const a of apps) expect(a.name).toMatch(/^(?=.{1,64}$)[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+)*$/);
  });
  it('selects all, one (any case), or fails on an unknown name', () => {
    expect(selectApps(apps, 'all')).toHaveLength(apps.length);
    expect(selectApps(apps, 'snagit')[0].name).toBe('SnagIt');
    expect(() => selectApps(apps, 'nope')).toThrow(/no app "nope"/);
  });
  it('uses ~/apps on the Mac and C:\\apps on Windows', () => {
    expect(appsDir({ platform: 'darwin', home: '/Users/x', env: {} })).toBe('/Users/x/apps');
    expect(appsDir({ platform: 'win32', home: 'C:\\Users\\x', env: {} })).toBe('C:\\apps');
    expect(appsDir({ platform: 'darwin', env: { APPS_DIR: '/a' } })).toBe('/a');
  });
});

describe('classify + shouldAct', () => {
  it('names the state', () => {
    expect(classify({ installed: null, latest: '1.0.0' })).toBe('missing');
    expect(classify({ installed: '1.7.0', latest: '1.8.0' })).toBe('behind');
    expect(classify({ installed: '1.8.0', latest: 'v1.8.0'.slice(1) })).toBe('current');
    expect(classify({ installed: '1.9.0', latest: '1.8.0' })).toBe('ahead');
    expect(classify({ installed: 'abc1234', latest: 'def5678' })).toBe('behind');
    expect(classify({ installed: 'abc1234', latest: 'abc1234', dirty: true })).toBe('dirty');
  });
  it('install: missing or behind; update: installed and behind; force widens both but never touches dirty', () => {
    expect(shouldAct('install', 'missing')).toBe(true);
    expect(shouldAct('install', 'current')).toBe(false);
    expect(shouldAct('install', 'current', true)).toBe(true);
    expect(shouldAct('update', 'missing')).toBe(false);
    expect(shouldAct('update', 'behind')).toBe(true);
    expect(shouldAct('update', 'current')).toBe(false);
    expect(shouldAct('update', 'dirty', true)).toBe(false);
    expect(shouldAct('install', 'dirty', true)).toBe(false);
    expect(shouldAct('update', 'unsupported', true)).toBe(false);
  });
  it('runs hooks by extension', () => {
    expect(hookCommand('mac/install.sh', 'darwin')).toEqual(['sh', ['mac/install.sh']]);
    expect(hookCommand('windows/setup.ps1', 'win32')[0]).toBe('powershell');
    expect(() => hookCommand('x.exe')).toThrow();
  });
});

// A fake shell: records calls, answers from a table of `cmd args...` prefixes.
function fakeShell(answers) {
  const calls = [];
  const sh = (cmd, args, opts) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    for (const [prefix, out] of answers) if (line.startsWith(prefix)) return typeof out === 'function' ? out(cmd, args, opts) : out;
    return '';
  };
  return { sh, calls };
}

describe('electron-release', () => {
  const app = { name: 'SnagIt', kind: 'electron-release', repo: 'o/SnagIt', product: 'SnagIt' };
  const zip = Buffer.from('fake zip');
  const release = (digest) => JSON.stringify({ tag_name: 'v1.8.0', assets: [{ name: 'SnagIt-1.8.0-mac-arm64.zip', digest }] });
  const good = `sha256:${createHash('sha256').update(zip).digest('hex')}`;

  it('reports installed vs latest from the plist and the latest release', () => {
    const { sh } = fakeShell([['gh api', release(good)], ['plutil', '1.7.0']]);
    const s = createApps({ platform: 'darwin', arch: 'arm64', sh, exists: () => true }).status(app);
    expect(s).toMatchObject({ installed: '1.7.0', latest: '1.8.0', state: 'behind' });
  });

  it('downloads, checks sha256, swaps the .app, reopens it if it was running', () => {
    let installed = '1.7.0';
    let running = true;
    const { sh, calls } = fakeShell([
      ['gh api', release(good)],
      ['plutil', () => installed],
      ['gh release download', (c, a) => writeFileSync(join(a[a.indexOf('-D') + 1], a[a.indexOf('-p') + 1]), zip)],
      ['pgrep', () => { if (!running) throw new Error('none'); return '123'; }],
      ['osascript', () => { running = false; return ''; }],
      ['ditto /', () => { installed = '1.8.0'; return ''; }],
    ]);
    const r = createApps({ platform: 'darwin', arch: 'arm64', sh, exists: () => true, log: () => {} }).act(app, 'update');
    expect(r).toMatchObject({ action: 'updated', from: '1.7.0', installed: '1.8.0', state: 'current' });
    expect(calls.some((c) => c.startsWith('rm -rf /Applications/SnagIt.app'))).toBe(true);
    expect(calls.some((c) => c === 'open /Applications/SnagIt.app')).toBe(true);
  });

  it('refuses a download whose sha256 does not match', () => {
    const { sh, calls } = fakeShell([
      ['gh api', release(`sha256:${'0'.repeat(64)}`)],
      ['plutil', '1.7.0'],
      ['gh release download', (c, a) => writeFileSync(join(a[a.indexOf('-D') + 1], a[a.indexOf('-p') + 1]), zip)],
    ]);
    const r = createApps({ platform: 'darwin', arch: 'arm64', sh, exists: () => true, log: () => {} }).act(app, 'update');
    expect(r.action).toBe('failed');
    expect(r.note).toMatch(/sha256 mismatch/);
    expect(calls.some((c) => c.startsWith('rm -rf'))).toBe(false);
  });

  it('runs the NSIS installer silently on Windows', () => {
    const { sh, calls } = fakeShell([
      ['gh api', JSON.stringify({ tag_name: 'v1.8.0', assets: [{ name: 'SnagIt-Setup-1.8.0-win-x64.exe', digest: good }] })],
      ['powershell', '1.7.0'],
      ['gh release download', (c, a) => writeFileSync(join(a[a.indexOf('-D') + 1], a[a.indexOf('-p') + 1]), zip)],
    ]);
    createApps({ platform: 'win32', arch: 'x64', sh, exists: () => true, log: () => {} }).act(app, 'update');
    expect(calls.some((c) => /SnagIt-Setup-1\.8\.0-win-x64\.exe \/S$/.test(c))).toBe(true);
  });
});

describe('script-repo', () => {
  const app = { name: 'WM', kind: 'script-repo', repo: 'o/WM', branch: 'main', hook: { darwin: 'mac/install.sh' } };

  it('clones a missing repo into the apps folder and runs the hook there', () => {
    let cloned = false;
    const hooks = [];
    const { sh, calls } = fakeShell([
      ['gh repo clone', () => { cloned = true; return ''; }],
      ['git -C /apps/WM rev-parse --short HEAD', 'abc1234'],
      ['git -C /apps/WM config --get apps.hooked', () => (hooks.length ? 'abc1234' : '')],
      ['git -C /apps/WM rev-parse --short origin/main', 'abc1234'],
      ['git -C /apps/WM rev-list', '0'],
    ]);
    const sh2 = (cmd, args, opts) => { if (cmd === 'sh') hooks.push(opts.cwd); return sh(cmd, args, opts); };
    const r = createApps({ platform: 'darwin', dir: '/apps', sh: sh2, exists: () => cloned, log: () => {} }).act(app, 'install');
    expect(calls[0]).toBe('gh repo clone o/WM /apps/WM -- --branch main');
    expect(hooks).toEqual(['/apps/WM']);
    expect(r).toMatchObject({ action: 'installed', state: 'current' });
  });

  it('records the commit once its hook finishes', () => {
    const { sh, calls } = fakeShell([
      ['git -C /apps/WM rev-parse --short HEAD', 'abc1234'],
      ['git -C /apps/WM rev-parse --short origin/main', 'def5678'],
      ['git -C /apps/WM rev-list', '1'],
    ]);
    createApps({ platform: 'darwin', dir: '/apps', sh, exists: () => true, log: () => {} }).act(app, 'update');
    expect(calls).toContain('git -C /apps/WM config apps.hooked abc1234');
  });

  it('a hook that failed after the pull still reads as needing an update, and Update re-runs it', () => {
    const answers = [
      ['git -C /apps/WM rev-parse --short HEAD', 'abc1234'],
      ['git -C /apps/WM rev-parse --short origin/main', 'abc1234'],
      ['git -C /apps/WM config --get apps.hooked', 'old0000'],
      ['git -C /apps/WM rev-list', '0'],
    ];
    const { sh, calls } = fakeShell(answers);
    const apps = createApps({ platform: 'darwin', dir: '/apps', sh, exists: () => true, log: () => {} });
    const s = apps.status(app);
    expect(s.state).toBe('behind');
    expect(s.note).toMatch(/install step hasn't finished/);
    apps.act(app, 'update');
    expect(calls.some((c) => c.startsWith('sh mac/install.sh'))).toBe(true);
    // An app with no hook for this OS never reads as pending.
    expect(createApps({ platform: 'darwin', dir: '/apps', sh: fakeShell(answers).sh, exists: () => true }).status({ ...app, hook: {} }).state).toBe('current');
  });

  it('never pulls a repo with local changes', () => {
    const { sh, calls } = fakeShell([
      ['git -C /apps/WM rev-parse --short HEAD', 'abc1234'],
      ['git -C /apps/WM rev-parse --short origin/main', 'def5678'],
      ['git -C /apps/WM status', ' M mac/zones.lua'],
      ['git -C /apps/WM rev-list', '2'],
    ]);
    const r = createApps({ platform: 'darwin', dir: '/apps', sh, exists: () => true, log: () => {} }).act(app, 'update', { force: true });
    expect(r).toMatchObject({ state: 'dirty', action: 'skipped' });
    expect(calls.some((c) => c.includes('pull'))).toBe(false);
  });

  it('calls local-only commits "ahead", not behind', () => {
    const { sh } = fakeShell([
      ['git -C /apps/WM rev-parse --short HEAD', 'abc1234'],
      ['git -C /apps/WM rev-parse --short origin/main', 'def5678'],
      ['git -C /apps/WM rev-list', '0'],
    ]);
    expect(createApps({ platform: 'darwin', dir: '/apps', sh, exists: () => true }).status(app).state).toBe('ahead');
  });

  it('skips apps not made for this OS', () => {
    const s = createApps({ platform: 'linux', sh: () => '' }).status({ ...app, platforms: ['darwin'] });
    expect(s.state).toBe('unsupported');
  });
});

describe('code-repo', () => {
  const app = { name: 'Web', kind: 'code-repo', repo: 'o/Web', branch: 'main' };
  const pulled = [
    ['git -C /apps/Web rev-parse --short HEAD', 'abc1234'],
    ['git -C /apps/Web rev-parse --short origin/main', 'def5678'],
    ['git -C /apps/Web rev-list', '1'],
  ];

  it('picks the setup from the files the repo has', () => {
    const has = (...files) => (f) => files.includes(f);
    expect(setupCommands(has('package.json', 'package-lock.json'), 'darwin')).toEqual([['npm', ['ci', '--no-audit', '--no-fund']]]);
    expect(setupCommands(has('package.json'), 'darwin')).toEqual([['npm', ['install', '--no-audit', '--no-fund']]]);
    expect(setupCommands(has('pyproject.toml'), 'darwin')).toEqual([['python3', ['-m', 'venv', '.venv']], [join('.venv', 'bin', 'pip'), ['install', '--quiet', '-e', '.']]]);
    expect(setupCommands(has('pyproject.toml'), 'win32')[0][0]).toBe('python');
    expect(setupCommands(has('pyproject.toml'), 'win32')[1][0]).toBe(join('.venv', 'Scripts', 'pip.exe'));
    expect(setupCommands(has(), 'darwin')).toEqual([]);
  });

  it('pulls, runs npm ci in the repo, and records the commit', () => {
    const { sh, calls } = fakeShell(pulled);
    const opts = [];
    const sh2 = (cmd, args, o) => { if (cmd === 'npm') opts.push(o); return sh(cmd, args, o); };
    const files = new Set(['/apps/Web/.git', '/apps/Web/package.json', '/apps/Web/package-lock.json']);
    createApps({ platform: 'darwin', dir: '/apps', sh: sh2, exists: (p) => files.has(p), log: () => {} }).act(app, 'update');
    expect(calls).toContain('git -C /apps/Web pull --ff-only origin main');
    expect(calls).toContain('npm ci --no-audit --no-fund');
    expect(opts[0]).toMatchObject({ cwd: '/apps/Web', shell: false });
    expect(calls).toContain('git -C /apps/Web config apps.hooked abc1234');
  });

  it('starts npm through a shell on Windows (npm.cmd)', () => {
    const { sh } = fakeShell(pulled);
    const opts = [];
    const sh2 = (cmd, args, o) => { if (cmd === 'npm') opts.push(o); return sh(cmd, args, o); };
    const has = (p) => p.endsWith('.git') || p.endsWith('package.json');
    createApps({ platform: 'win32', dir: '/apps', sh: sh2, exists: has, log: () => {} }).act(app, 'update');
    expect(opts[0].shell).toBe(true);
  });

  it('a repo with nothing to set up is just kept current, and a failed setup reads as pending', () => {
    const answers = [
      ['git -C /apps/Web rev-parse --short HEAD', 'abc1234'],
      ['git -C /apps/Web rev-parse --short origin/main', 'abc1234'],
      ['git -C /apps/Web config --get apps.hooked', ''],
      ['git -C /apps/Web rev-list', '0'],
    ];
    expect(createApps({ platform: 'darwin', dir: '/apps', sh: fakeShell(answers).sh, exists: () => true }).status(app).state).toBe('behind');
    const { sh, calls } = fakeShell(pulled);
    createApps({ platform: 'darwin', dir: '/apps', sh, exists: (p) => p.endsWith('.git'), log: () => {} }).act(app, 'update');
    expect(calls.some((c) => c.startsWith('npm') || c.startsWith('python'))).toBe(false);
    expect(calls).toContain('git -C /apps/Web config apps.hooked abc1234');
  });

  it('never pulls or sets up a repo with local changes', () => {
    const { sh, calls } = fakeShell([...pulled, ['git -C /apps/Web status', ' M server.js']]);
    const r = createApps({ platform: 'darwin', dir: '/apps', sh, exists: () => true, log: () => {} }).act(app, 'update', { force: true });
    expect(r).toMatchObject({ state: 'dirty', action: 'skipped' });
    expect(calls.some((c) => c.includes('pull') || c.startsWith('npm'))).toBe(false);
  });
});

it('formats a table', () => {
  const t = formatTable([{ name: 'SnagIt', installed: '1.7.0', latest: '1.8.0', state: 'behind' }]);
  expect(t).toMatch(/SnagIt\s+1\.7\.0\s+1\.8\.0\s+update available/);
});

describe('review fixes', () => {
  const electron = { name: 'SnagIt', kind: 'electron-release', repo: 'o/SnagIt', product: 'SnagIt' };
  it('a GitHub error fails install instead of skipping it', () => {
    const sh = (cmd) => { if (cmd === 'gh') throw Object.assign(new Error('x'), { stderr: 'gh: not logged in' }); return ''; };
    const r = createApps({ platform: 'darwin', sh, exists: () => false, log: () => {} }).act(electron, 'install');
    expect(r).toMatchObject({ state: 'error', action: 'failed', note: 'gh: not logged in' });
  });
  it('says so when git fetch fails instead of claiming up to date silently', () => {
    const app = { name: 'WM', kind: 'script-repo', repo: 'o/WM' };
    const sh = (cmd, args) => {
      if (args.includes('fetch')) throw new Error('offline');
      if (args.includes('rev-parse')) return 'abc1234';
      return args.includes('rev-list') ? '0' : '';
    };
    const s = createApps({ platform: 'darwin', dir: '/apps', sh, exists: () => true }).status(app);
    expect(s.state).toBe('current');
    expect(s.note).toMatch(/couldn't reach GitHub/);
  });
  it('matches only our app in the Windows uninstall list, case-sensitively, incl. WOW6432Node', () => {
    const calls = [];
    const sh = (cmd, args) => { calls.push([cmd, ...args].join(' ')); if (cmd === 'gh') return JSON.stringify({ tag_name: 'v1.8.0', assets: [] }); return ''; };
    createApps({ platform: 'win32', sh, exists: () => true }).status(electron);
    const ps = calls.find((c) => c.startsWith('powershell'));
    expect(ps).toContain("-cmatch '^SnagIt( \\d|$)'");
    expect(ps).toContain('WOW6432Node');
  });
  it('closes the running app on Windows and restarts it after the silent install', () => {
    const zip = Buffer.from('x');
    const digest = `sha256:${createHash('sha256').update(zip).digest('hex')}`;
    let running = true;
    const calls = [];
    const sh = (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'gh' && args[0] === 'api') return JSON.stringify({ tag_name: 'v1.8.0', assets: [{ name: 'SnagIt-Setup-1.8.0-win-x64.exe', digest }] });
      if (cmd === 'gh') { writeFileSync(join(args[args.indexOf('-D') + 1], args[args.indexOf('-p') + 1]), zip); return ''; }
      if (cmd === 'powershell' && args[1] === '-Command' && args[2].includes('Uninstall')) return '1.7.0';
      if (cmd === 'tasklist') return running ? 'SnagIt.exe 123 Console' : 'INFO: No tasks';
      if (cmd === 'taskkill') { running = false; return ''; }
      return '';
    };
    createApps({ platform: 'win32', arch: 'x64', sh, exists: () => true, log: () => {} }).act(electron, 'update');
    expect(calls.some((c) => c.startsWith('taskkill /IM SnagIt.exe'))).toBe(true);
    expect(calls.some((c) => c.endsWith('.exe /S --force-run'))).toBe(true);
  });
  it('copies the new .app beside the old one before swapping', () => {
    const zip = Buffer.from('z');
    const digest = `sha256:${createHash('sha256').update(zip).digest('hex')}`;
    const calls = [];
    const sh = (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'gh' && args[0] === 'api') return JSON.stringify({ tag_name: 'v1.8.0', assets: [{ name: 'SnagIt-1.8.0-mac-arm64.zip', digest }] });
      if (cmd === 'gh') { writeFileSync(join(args[args.indexOf('-D') + 1], args[args.indexOf('-p') + 1]), zip); return ''; }
      if (cmd === 'plutil') return '1.7.0';
      if (cmd === 'pgrep') throw new Error('none');
      return '';
    };
    createApps({ platform: 'darwin', arch: 'arm64', sh, exists: () => true, log: () => {} }).act(electron, 'update');
    const i = (prefix) => calls.findIndex((c) => c.startsWith(prefix));
    expect(i('ditto /') ).toBeGreaterThan(-1);
    expect(calls[i('ditto /')]).toMatch(/SnagIt\.app\.new$/);
    expect(i('mv /Applications/SnagIt.app /Applications/SnagIt.app.old')).toBeGreaterThan(i('ditto /'));
    expect(i('rm -rf /Applications/SnagIt.app.old')).toBeGreaterThan(i('mv /Applications/SnagIt.app.new'));
  });
  it('JSON rows always have the same keys; bad args print a JSON error', () => {
    expect(Object.keys(toRow({ name: 'x', state: 'current' }))).toEqual(ROW_KEYS);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['status', '--focre', '--json'])).toBe(2);
    expect(JSON.parse(log.mock.calls[0][0]).error).toMatch(/unknown option --focre/);
    log.mockRestore(); err.mockRestore();
  });
});

it('starts apps without ELECTRON_RUN_AS_NODE', () => {
  expect(launchEnv({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' })).toEqual({ PATH: '/bin' });
});

describe('error lines and streamed output', () => {
  it('picks the error, not the Node crash footer or a stack frame', () => {
    const stderr = 'node:internal/x:1\n  throw err;\nError: Cannot find module \'/a/apps.mjs\'\n    at Module._resolve (x:1)\n\nNode.js v22.23.2\n';
    expect(firstLine({ stderr })).toBe("Error: Cannot find module '/a/apps.mjs'");
    expect(firstLine({ stderr: 'step 1\nstep 2\n' })).toBe('step 2');
    expect(firstLine({ message: 'Command failed: sh x.sh', stderr: 'npm ERR! code ELIFECYCLE\n' })).toBe('npm ERR! code ELIFECYCLE');
    expect(firstLine({})).toBe('failed');
  });
  it('with stream, hook and setup output goes to stderr (fd 2) instead of being captured', () => {
    const seen = [];
    const { sh } = fakeShell([['git -C /apps/Web rev-parse --short HEAD', 'abc1234'], ['git -C /apps/Web rev-parse --short origin/main', 'def5678'], ['git -C /apps/Web rev-list', '1']]);
    const sh2 = (cmd, args, o) => { if (cmd === 'npm' || args.includes('pull')) seen.push(o.stdio); return sh(cmd, args, o); };
    createApps({ platform: 'darwin', dir: '/apps', sh: sh2, exists: (p) => p.endsWith('.git') || p.endsWith('package.json'), log: () => {}, stream: true })
      .act({ name: 'Web', kind: 'code-repo', repo: 'o/Web', branch: 'main' }, 'update');
    expect(seen).toEqual([['ignore', 2, 2], ['ignore', 2, 2]]);
  });
});

describe('per-computer folders, check-folder, open, what blocks an update', () => {
  const web = { name: 'AutoDealer', kind: 'code-repo', repo: 'o/AutoDealer', branch: 'master' };
  it('matches a GitHub remote in any form', () => {
    expect(sameRepo('git@github.com:o/AutoDealer.git', 'o/AutoDealer')).toBe(true);
    expect(sameRepo('https://github.com/O/autodealer', 'o/AutoDealer')).toBe(true);
    expect(sameRepo('https://github.com/o/AutoDealer-old.git', 'o/AutoDealer')).toBe(false);
    expect(sameRepo('', 'o/AutoDealer')).toBe(false);
  });
  it('uses the folder given for this computer instead of the apps folder', () => {
    const { sh, calls } = fakeShell([['git -C /Users/me/AutoDealer remote get-url origin', 'https://github.com/o/AutoDealer.git'], ['git -C /Users/me/AutoDealer rev-parse --abbrev-ref HEAD', 'master'], ['git -C /Users/me/AutoDealer rev-parse --short HEAD', 'abc1234'], ['git -C /Users/me/AutoDealer rev-parse --short origin/master', 'abc1234'], ['git -C /Users/me/AutoDealer rev-list', '0']]);
    const s = createApps({ platform: 'darwin', dir: '/apps', sh, exists: () => true, folders: { AutoDealer: '/Users/me/AutoDealer' } }).status(web);
    expect(s.path).toBe('/Users/me/AutoDealer');
    expect(calls.some((c) => c.includes('/apps/AutoDealer'))).toBe(false);
  });
  it("accepts only a checkout of the app's own repo", () => {
    const { sh } = fakeShell([['git -C /Users/me/AutoDealer remote get-url origin', 'git@github.com:o/AutoDealer.git'], ['git -C /Users/me/auction remote get-url origin', 'git@github.com:o/auction.git']]);
    const apps = createApps({ platform: 'darwin', dir: '/apps', sh, exists: (p) => !p.startsWith('/nope') && !p.startsWith('/Users/me/plain/') });
    expect(apps.checkFolder(web, '/Users/me/AutoDealer')).toMatchObject({ ok: true, path: '/Users/me/AutoDealer' });
    expect(apps.checkFolder(web, '/Users/me/auction').note).toMatch(/not o\/AutoDealer/);
    expect(apps.checkFolder(web, '/nope').note).toMatch(/doesn't exist/);
    expect(apps.checkFolder(web, 'AutoDealer').note).toMatch(/full path/);
    expect(apps.checkFolder({ name: 'SnagIt', kind: 'electron-release', repo: 'o/SnagIt' }, '/x').ok).toBe(false);
  });
  it('lists changed files for local changes and unpushed commits for ahead', () => {
    const base = [['git -C /apps/AutoDealer rev-parse --short HEAD', 'abc1234'], ['git -C /apps/AutoDealer rev-parse --short origin/master', 'def5678'], ['git -C /apps/AutoDealer rev-list --count HEAD..', '0']];
    const dirty = fakeShell([...base, ['git -C /apps/AutoDealer status', ' M server.js\n M web/app.tsx\n'], ['git -C /apps/AutoDealer rev-list --count origin', '0']]);
    expect(createApps({ platform: 'darwin', dir: '/apps', sh: dirty.sh, exists: () => true }).status(web)).toMatchObject({ state: 'dirty', changes: [' M server.js', ' M web/app.tsx'], commits: null });
    const ahead = fakeShell([...base, ['git -C /apps/AutoDealer rev-list --count origin', '2'], ['git -C /apps/AutoDealer log', 'abc1234 Fix lot\n9f8e7d6 Add VIN\n']]);
    expect(createApps({ platform: 'darwin', dir: '/apps', sh: ahead.sh, exists: () => true }).status(web)).toMatchObject({ state: 'ahead', changes: null, commits: ['abc1234 Fix lot', '9f8e7d6 Add VIN'] });
  });
  it('opens the folder in VS Code, and never runs anything else', () => {
    const { sh, calls } = fakeShell([]);
    expect(createApps({ platform: 'darwin', dir: '/apps', sh, exists: () => true }).openFolder(web)).toMatchObject({ ok: true, path: '/apps/AutoDealer' });
    expect(calls).toEqual(['code /apps/AutoDealer']);
  });
  it('the CLI refuses bad --folders and wants a name for open and check-folder', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['status', '--json', '--folders', 'nope'])).toBe(2);
    expect(main(['status', '--json', '--folders', '{"A":1}'])).toBe(2);
    expect(main(['open', '--json'])).toBe(2);
    expect(main(['check-folder', 'SnagIt', '--json'])).toBe(2);
    out.mockRestore(); err.mockRestore();
  });
});

describe('review fixes for picked folders', () => {
  const web = { name: 'AutoDealer', kind: 'code-repo', repo: 'o/AutoDealer', branch: 'master' };
  const folders = { AutoDealer: '/Users/me/AutoDealer' };
  const good = [['git -C /Users/me/AutoDealer remote get-url origin', 'git@github.com:o/AutoDealer.git'], ['git -C /Users/me/AutoDealer rev-parse --abbrev-ref HEAD', 'master'],
    ['git -C /Users/me/AutoDealer rev-parse --short HEAD', 'abc1234'], ['git -C /Users/me/AutoDealer rev-parse --short origin/master', 'def5678'], ['git -C /Users/me/AutoDealer rev-list --count HEAD..', '1']];
  it('a picked folder that is gone, another repo, or on another branch is an error, never cloned into or pulled', () => {
    const gone = fakeShell([]);
    const s1 = createApps({ platform: 'darwin', dir: '/apps', sh: gone.sh, exists: () => false, folders, log: () => {} }).act(web, 'install');
    expect(s1).toMatchObject({ state: 'error', action: 'failed' });
    expect(s1.note).toMatch(/gone/);
    expect(gone.calls.some((c) => c.includes('clone'))).toBe(false);
    const other = fakeShell([['git -C /Users/me/AutoDealer remote get-url origin', 'git@github.com:o/auction.git']]);
    expect(createApps({ platform: 'darwin', dir: '/apps', sh: other.sh, exists: () => true, folders }).status(web).note).toMatch(/not o\/AutoDealer/);
    const branch = fakeShell([['git -C /Users/me/AutoDealer remote get-url origin', 'git@github.com:o/AutoDealer.git'], ['git -C /Users/me/AutoDealer rev-parse --abbrev-ref HEAD', 'feature-x']]);
    const s3 = createApps({ platform: 'darwin', dir: '/apps', sh: branch.sh, exists: () => true, folders, log: () => {} }).act(web, 'update', { force: true });
    expect(s3.note).toMatch(/on branch feature-x/);
    expect(branch.calls.some((c) => c.includes('pull'))).toBe(false);
  });
  it('updates a picked folder without npm ci when its packages are already there', () => {
    const { sh, calls } = fakeShell(good);
    createApps({ platform: 'darwin', dir: '/apps', sh, exists: () => true, folders, log: () => {} }).act(web, 'update');
    expect(calls).toContain('git -C /Users/me/AutoDealer pull --ff-only origin master');
    expect(calls.some((c) => c.startsWith('npm'))).toBe(false);
  });
  it('on Windows, refuses paths cmd.exe would read as commands', () => {
    const { sh, calls } = fakeShell([]);
    const apps = createApps({ platform: 'win32', dir: 'C:\\apps', sh, exists: () => true, folders: { AutoDealer: 'C:\\src\\x&calc' } });
    expect(apps.checkFolder(web, 'C:\\src\\x&calc').ok).toBe(false);
    expect(apps.openFolder(web).ok).toBe(false);
    expect(calls.some((c) => c.startsWith('cmd'))).toBe(false);
  });
});

describe('tools each app needs (PH-167)', () => {
  const vitals = { name: 'Vitals', kind: 'script-repo', repo: 'o/vitals', branch: 'main', platforms: ['win32'], hook: { win32: 'scripts/apps-hook.ps1' }, needs: { win32: ['node', 'rust', 'msvc'] } };
  const shell = (missing, extra = []) => {
    const calls = [];
    const sh = (cmd, args) => {
      const line = [cmd, ...args].join(' ');
      calls.push(line);
      for (const m of missing) if (line.startsWith(m)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      for (const [p, out] of extra) if (line.startsWith(p)) return out;
      if (cmd.endsWith('vswhere.exe')) return 'C:\\BuildTools';
      return '';
    };
    return { sh, calls };
  };
  it('every listed need is a known tool with a check and a fix for that OS', () => {
    for (const a of loadManifest()) for (const [os, ids] of Object.entries(a.needs ?? {})) for (const id of ids) {
      expect(TOOLS[id], `${a.name}: ${id}`).toBeTruthy();
      expect(TOOLS[id].check[os], `${a.name}: ${id} check on ${os}`).toBeTruthy();
      expect(TOOLS[id].fix[os], `${a.name}: ${id} fix on ${os}`).toBeTruthy();
    }
    expect(loadManifest().find((a) => a.name === 'Vitals').needs).toEqual({ win32: ['node', 'rust', 'msvc'] });
  });
  it('reports what is missing with its fix, and refuses to install until it is there', () => {
    const { sh, calls } = shell(['cargo']);
    const apps = createApps({ platform: 'win32', dir: 'C:\\apps', sh, exists: () => false, log: () => {} });
    expect(apps.status(vitals).missing).toEqual([{ id: 'rust', label: 'Rust', fix: 'winget install Rustlang.Rustup' }]);
    const r = apps.act(vitals, 'install');
    expect(r).toMatchObject({ action: 'failed', note: 'Needs Rust' });
    expect(calls.some((c) => c.includes('clone'))).toBe(false);
    expect(calls.filter((c) => c.startsWith('cargo'))).toHaveLength(1); // looked up once per run
  });
  it('an empty vswhere answer means no Build Tools', () => {
    const { sh } = shell([], [['C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe', '']]);
    expect(createApps({ platform: 'win32', dir: 'C:\\apps', sh, exists: () => false }).status(vitals).missing.map((m) => m.id)).toEqual(['msvc']);
  });
  it('git, gh and a gh sign-in are the computer\'s, reported once', () => {
    expect(createApps({ platform: 'darwin', sh: shell([]).sh }).computer()).toEqual({ missing: [] });
    expect(createApps({ platform: 'darwin', sh: shell(['gh auth token --hostname github.com']).sh }).computer().missing.map((m) => m.id)).toEqual(['gh-auth']);
    expect(createApps({ platform: 'darwin', sh: shell(['gh']).sh }).computer().missing.map((m) => m.id)).toEqual(['gh']);
    expect(createApps({ platform: 'win32', sh: shell(['git']).sh }).computer().missing[0]).toEqual({ id: 'git', label: 'git', fix: 'winget install Git.Git' });
    // On a Mac, git and Swift are asked through xcode-select first, never the stubs that pop up a dialog.
    expect(TOOLS.git.check.darwin[1][1]).toMatch(/^xcode-select -p/);
    expect(TOOLS.swift.check.darwin[1][1]).toMatch(/^xcode-select -p/);
  });
  it('apps with no needs, or not for this OS, are never marked', () => {
    const { sh } = shell(['cargo', 'node']);
    const apps = createApps({ platform: 'darwin', dir: '/apps', sh, exists: () => false });
    expect(apps.status({ name: 'X', kind: 'code-repo', repo: 'o/X' }).missing).toBeUndefined();
    expect(apps.status(vitals)).toMatchObject({ state: 'unsupported' });
  });
});

describe('--progress', () => {
  it('is accepted with --json, and stdout stays one JSON answer', () => {
    const file = join(tmpdir(), `apps-progress-${process.pid}.json`);
    writeFileSync(file, JSON.stringify({ apps: [{ name: 'X', kind: 'script-repo', repo: 'o/X', platforms: ['nope'] }] }));
    const out = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m) => out.push(m));
    try {
      expect(main(['status', '--json', '--progress', '--manifest', file])).toBe(0);
    } finally { spy.mockRestore(); }
    expect(JSON.parse(out.join('\n')).apps[0]).toMatchObject({ name: 'X', state: 'unsupported' });
  });
});
