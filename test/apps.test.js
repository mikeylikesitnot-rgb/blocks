import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appsDir, classify, launchEnv, createApps, formatTable, hookCommand, loadManifest, main, ROW_KEYS, selectApps, shouldAct, toRow } from '../ops/apps.mjs';
import { vi } from 'vitest';

describe('apps manifest', () => {
  const apps = loadManifest();
  it('ships SnagIt and WindowsManager with a valid kind', () => {
    expect(apps.map((a) => a.name)).toEqual(expect.arrayContaining(['SnagIt', 'WindowsManager']));
    expect(apps.find((a) => a.name === 'WindowsManager').hook).toEqual({ darwin: 'mac/install.sh', win32: 'windows/setup.ps1' });
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
    const { sh, calls } = fakeShell([
      ['gh repo clone', () => { cloned = true; return ''; }],
      ['git -C /apps/WM rev-parse --short HEAD', 'abc1234'],
      ['git -C /apps/WM rev-parse --short origin/main', 'abc1234'],
      ['git -C /apps/WM rev-list', '0'],
    ]);
    const hooks = [];
    const sh2 = (cmd, args, opts) => { if (cmd === 'sh') hooks.push(opts.cwd); return sh(cmd, args, opts); };
    const r = createApps({ platform: 'darwin', dir: '/apps', sh: sh2, exists: () => cloned, log: () => {} }).act(app, 'install');
    expect(calls[0]).toBe('gh repo clone o/WM /apps/WM -- --branch main');
    expect(hooks).toEqual(['/apps/WM']);
    expect(r).toMatchObject({ action: 'installed', state: 'current' });
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
