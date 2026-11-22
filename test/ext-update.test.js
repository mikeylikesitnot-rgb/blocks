import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyExtUpdate, checkExtUpdate, EXT_UPDATE_ALARM, EXT_UPDATE_KEY, extUpdateStatus, startExtUpdate } from '../src/extUpdate.js';

function fakeChrome({ running = '1.0.0', alarms = true } = {}) {
  const store = {};
  const listeners = [];
  return {
    store, listeners,
    runtime: { getManifest: () => ({ name: 'Ext', version: running }), getURL: (p) => `chrome-extension://id/${p}`, reload: vi.fn() },
    storage: { local: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { delete store[k]; },
    } },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}), setTitle: vi.fn(async () => {}) },
    alarms: alarms ? { onAlarm: { addListener: (fn) => listeners.push(fn) }, get: vi.fn(async () => undefined), create: vi.fn() } : undefined,
  };
}
const disk = (version) => vi.fn(async () => ({ ok: true, json: async () => ({ version }) }));

describe('checkExtUpdate', () => {
  it('auto: reloads when the manifest on disk is newer', async () => {
    const c = fakeChrome();
    const r = await checkExtUpdate({ chrome: c, fetch: disk('1.1.0'), mode: 'auto' });
    expect(r.action).toBe('reload');
    expect(c.runtime.reload).toHaveBeenCalled();
  });
  it('does nothing when the disk version is the same or older', async () => {
    const c = fakeChrome({ running: '1.1.0' });
    expect((await checkExtUpdate({ chrome: c, fetch: disk('1.0.0') })).action).toBe('none');
    expect(c.runtime.reload).not.toHaveBeenCalled();
  });
  it('notify: badge + stored version, cleared once the extension is current', async () => {
    const c = fakeChrome();
    const r = await checkExtUpdate({ chrome: c, fetch: disk('1.2.0'), mode: 'notify' });
    expect(r.action).toBe('notified');
    expect(c.action.setBadgeText).toHaveBeenLastCalledWith({ text: '↑' });
    expect(await extUpdateStatus({ chrome: c })).toEqual({ current: '1.0.0', version: '1.2.0' });
    applyExtUpdate({ chrome: c });
    expect(c.runtime.reload).toHaveBeenCalledTimes(1);
    const after = fakeChrome({ running: '1.2.0' });
    after.store[EXT_UPDATE_KEY] = c.store[EXT_UPDATE_KEY];
    await checkExtUpdate({ chrome: after, fetch: disk('1.2.0'), mode: 'notify' });
    expect(after.store[EXT_UPDATE_KEY]).toBeUndefined();
    expect(after.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });
  it('off: never reloads; an unreadable manifest is not an update', async () => {
    const c = fakeChrome();
    expect((await checkExtUpdate({ chrome: c, fetch: disk('9.0.0'), mode: 'off' })).action).toBe('none');
    expect((await checkExtUpdate({ chrome: c, fetch: vi.fn(async () => { throw new Error('x'); }) })).newer).toBe(false);
    expect(c.runtime.reload).not.toHaveBeenCalled();
  });
});

describe('startExtUpdate', () => {
  it('checks now, sets an alarm and checks again when it fires; mode can be a function', async () => {
    const c = fakeChrome();
    const mode = vi.fn(async () => 'notify');
    const fetch = disk('1.0.0');
    const { first } = startExtUpdate({ chrome: c, fetch, mode, intervalMinutes: 15 });
    await first;
    await Promise.resolve();
    expect(c.alarms.create).toHaveBeenCalledWith(EXT_UPDATE_ALARM, { periodInMinutes: 15 });
    c.listeners[0]({ name: 'other' });
    c.listeners[0]({ name: EXT_UPDATE_ALARM });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mode).toHaveBeenCalledTimes(2);
  });
  it('works without the alarms permission', async () => {
    const c = fakeChrome({ alarms: false });
    const r = await startExtUpdate({ chrome: c, fetch: disk('2.0.0') }).first;
    expect(r.action).toBe('reload');
  });
});

describe('ops/ext-update.sh', () => {
  const script = join(process.cwd(), 'ops/ext-update.sh');
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

  it('copies a subfolder extension on first run and again only when the version changes', () => {
    const d = mkdtempSync(join(tmpdir(), 'extup-'));
    const repo = join(d, 'repo');
    mkdirSync(join(repo, 'chrome-extension'), { recursive: true });
    writeFileSync(join(repo, 'README.md'), 'app');
    writeFileSync(join(repo, 'chrome-extension/manifest.json'), '{ "name": "x", "version": "1.0.0" }');
    git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'one');
    const conf = join(d, 'conf');
    writeFileSync(conf, `# comment\r\nsms file://${repo} main chrome-extension`); // Windows line endings, no final newline
    const run = () => execFileSync('bash', [script, 'run', conf], { env: { ...process.env, MN_EXT_ROOT: join(d, 'root') }, encoding: 'utf8' });

    expect(run()).toContain('sms: none -> 1.0.0');
    const out = join(d, 'root/sms');
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).version).toBe('1.0.0');

    writeFileSync(join(repo, 'chrome-extension/content.js'), 'unreleased');
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'wip');
    expect(run()).toContain('sms: 1.0.0 (current)');

    writeFileSync(join(repo, 'chrome-extension/manifest.json'), '{ "name": "x", "version": "1.1.0" }');
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'release');
    expect(run()).toContain('sms: 1.0.0 -> 1.1.0');
    expect(readFileSync(join(out, 'content.js'), 'utf8')).toBe('unreleased');
    expect(() => readFileSync(join(out, 'README.md'))).toThrow();
  });

  it('builds only when the root manifest version changes, and keeps the old copy when a build fails', () => {
    const d = mkdtempSync(join(tmpdir(), 'extup-'));
    const repo = join(d, 'repo');
    mkdirSync(repo, { recursive: true });
    const manifest = (v) => writeFileSync(join(repo, 'manifest.json'), `{ "name": "x", "version": "${v}" }`);
    manifest('1.0.0');
    // The "build" copies manifest.json into dist/ and counts its runs; FAIL in the repo makes it fail.
    writeFileSync(join(repo, 'build.sh'), 'test -f FAIL && exit 3; mkdir -p dist && cp manifest.json dist/ && echo built >> ../builds.log\n');
    git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'one');
    const conf = join(d, 'conf');
    writeFileSync(conf, `ews file://${repo} main dist sh build.sh && echo done\n`);
    const env = { ...process.env, MN_EXT_ROOT: join(d, 'root') };
    const run = () => execFileSync('bash', [script, 'run', conf], { env, encoding: 'utf8', stdio: 'pipe' });
    const builds = () => readFileSync(join(d, 'root/.src/builds.log'), 'utf8').trim().split('\n').length;
    const installed = () => JSON.parse(readFileSync(join(d, 'root/ews/manifest.json'), 'utf8')).version;

    expect(run()).toContain('ews: none -> 1.0.0');
    expect(installed()).toBe('1.0.0');
    expect(() => readFileSync(join(d, 'root/ews/build.sh'))).toThrow();

    writeFileSync(join(repo, 'wip.txt'), 'x'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'wip');
    expect(run()).toContain('ews: 1.0.0 (current)');
    expect(builds()).toBe(1);

    manifest('1.1.0'); writeFileSync(join(repo, 'FAIL'), ''); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'broken');
    expect(run).toThrow();
    expect(installed()).toBe('1.0.0');

    git(repo, 'rm', '-q', 'FAIL'); git(repo, 'commit', '-qm', 'fixed');
    expect(run()).toContain('ews: 1.0.0 -> 1.1.0');
    expect(installed()).toBe('1.1.0');
    expect(builds()).toBe(2);
  });

  it('skips while another run holds the lock, logs with run-logged, and un-sparses a clone when a build is added', () => {
    const d = mkdtempSync(join(tmpdir(), 'extup-'));
    const repo = join(d, 'repo');
    mkdirSync(join(repo, 'ext'), { recursive: true });
    writeFileSync(join(repo, 'manifest.json'), '{ "name": "x", "version": "2.0.0" }');
    writeFileSync(join(repo, 'ext/manifest.json'), '{ "name": "x", "version": "1.0.0" }');
    mkdirSync(join(repo, 'src')); writeFileSync(join(repo, 'src/build.sh'), 'mkdir -p dist && cp manifest.json dist/\n');
    git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'one');
    const root = join(d, 'root');
    const env = { ...process.env, MN_EXT_ROOT: root };
    const conf = join(d, 'conf');
    const run = (cmd = 'run') => execFileSync('bash', [script, cmd, conf], { env, encoding: 'utf8', stdio: 'pipe' });

    writeFileSync(conf, `e file://${repo} main ext\n`);
    mkdirSync(join(root, '.lock'), { recursive: true });
    expect(run()).toContain('another run is in progress');
    rmSync(join(root, '.lock'), { recursive: true });
    expect(run()).toContain('e: none -> 1.0.0');

    writeFileSync(conf, `e file://${repo} main dist sh src/build.sh\n`);
    run('run-logged');
    expect(readFileSync(join(root, '.bin/ext-update.log'), 'utf8')).toContain('e: 1.0.0 -> 2.0.0');
    expect(JSON.parse(readFileSync(join(root, 'e/manifest.json'), 'utf8')).version).toBe('2.0.0');
    expect(() => readFileSync(join(root, '.lock'))).toThrow();
  });

  it('rejects unsafe names', () => {
    const d = mkdtempSync(join(tmpdir(), 'extup-'));
    writeFileSync(join(d, 'conf'), '../evil file:///nope main .\n');
    expect(() => execFileSync('bash', [script, 'run', join(d, 'conf')], { env: { ...process.env, MN_EXT_ROOT: join(d, 'root') }, stdio: 'pipe' })).toThrow();
  });
});
