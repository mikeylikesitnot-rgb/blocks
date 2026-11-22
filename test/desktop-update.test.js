import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { appBundlePath, compareVersions, createUpdater, isNewer, pickAsset, SWAP_SCRIPT, tokenStore } from '../server/desktopUpdate.js';
import { nextVersion, releaseFiles } from '../ops/desktop-release.mjs';

describe('compareVersions', () => {
  it('compares numerically, ignores v, sorts pre-releases first', () => {
    expect(compareVersions('v1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('1.6.0', '1.6.0')).toBe(0);
    expect(compareVersions('1.6', '1.6.0')).toBe(0);
    expect(compareVersions('1.6.0-beta.1', '1.6.0')).toBe(-1);
    expect(compareVersions('junk', '0.0.1')).toBe(-1);
    expect(isNewer('1.6.0', '1.5.1')).toBe(true);
    expect(isNewer('1.5.1', '1.5.1')).toBe(false);
  });
});

describe('pickAsset', () => {
  const assets = [
    { name: 'SnagIt-Setup-1.6.0-win-x64.exe' }, { name: 'SnagIt-Setup-1.6.0-win-x64.exe.blockmap' },
    { name: 'SnagIt-1.6.0-mac-arm64.zip' }, { name: 'SnagIt-1.6.0-mac-x64.zip' }, { name: 'SnagIt-1.6.0-mac-arm64.dmg' },
  ];
  it('takes the installer on Windows and the matching zip on macOS', () => {
    expect(pickAsset(assets, { platform: 'win32', arch: 'x64' }).name).toBe('SnagIt-Setup-1.6.0-win-x64.exe');
    expect(pickAsset(assets, { platform: 'darwin', arch: 'arm64' }).name).toBe('SnagIt-1.6.0-mac-arm64.zip');
    expect(pickAsset(assets, { platform: 'darwin', arch: 'x64' }).name).toBe('SnagIt-1.6.0-mac-x64.zip');
  });
  it('falls back to a zip without an arch, and has nothing for Linux or a dmg-only release', () => {
    expect(pickAsset([{ name: 'App-1.0.0-mac.zip' }], { platform: 'darwin', arch: 'arm64' }).name).toBe('App-1.0.0-mac.zip');
    expect(pickAsset(assets, { platform: 'linux', arch: 'x64' })).toBeNull();
    expect(pickAsset([{ name: 'a.dmg' }], { platform: 'darwin', arch: 'arm64' })).toBeNull();
  });
  it('never gives an Intel Mac an arm64 build; Apple Silicon may take x64 (Rosetta)', () => {
    expect(pickAsset([{ name: 'SnagIt-1.6.0-mac-arm64.zip' }], { platform: 'darwin', arch: 'x64' })).toBeNull();
    expect(pickAsset([{ name: 'SnagIt-1.6.0-mac-x64.zip' }], { platform: 'darwin', arch: 'arm64' }).name).toBe('SnagIt-1.6.0-mac-x64.zip');
    expect(pickAsset([{ name: 'Winamp-1.0.0-mac-arm64.zip' }], { platform: 'darwin', arch: 'arm64' }).name).toBe('Winamp-1.0.0-mac-arm64.zip');
  });
});

it('appBundlePath finds the .app from the binary path', () => {
  expect(appBundlePath('/Applications/SnagIt.app/Contents/MacOS/SnagIt')).toBe('/Applications/SnagIt.app');
  expect(appBundlePath('/usr/local/bin/electron')).toBeNull();
});

describe('tokenStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-'));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from([...s].reverse().join('')),
    decryptString: (b) => [...b.toString()].reverse().join(''),
  };
  it('encrypts, reads back and removes', () => {
    const file = join(dir, 'gh-token');
    const t = tokenStore({ safeStorage, file });
    expect(t.get()).toBeNull();
    t.set('  github_pat_abc  ');
    expect(readFileSync(file, 'utf8')).not.toContain('github_pat_abc');
    expect(t.get()).toBe('github_pat_abc');
    expect(t.has()).toBe(true);
    t.set('');
    expect(existsSync(file)).toBe(false);
  });
  it('will not read an encrypted token when encryption is unavailable', () => {
    const file = join(dir, 'gh2');
    tokenStore({ safeStorage, file }).set('x');
    expect(tokenStore({ safeStorage: { isEncryptionAvailable: () => false }, file }).get()).toBeNull();
  });
});

// ---- the updater against a fake GitHub ------------------------------------------------

function fakeApp({ version = '1.5.1', packaged = true } = {}) {
  const handlers = {};
  return {
    getName: () => 'SnagIt', getVersion: () => version, isPackaged: packaged,
    on: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    emit: (ev) => (handlers[ev] || []).forEach((fn) => fn()),
    quit: vi.fn(),
  };
}

function res(status, body, headers = {}) {
  const bytes = typeof body === 'string' || Buffer.isBuffer(body) ? Buffer.from(body) : null;
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    body: bytes ? (async function* gen() { yield bytes.subarray(0, 3); yield bytes.subarray(3); })() : null,
  };
}

function fakeGitHub({ tag = 'v1.6.0', payload = Buffer.from('installer-bytes'), digest, assetName = 'SnagIt-Setup-1.6.0-win-x64.exe', status = 200 } = {}) {
  const sha = createHash('sha256').update(payload).digest('hex');
  const calls = [];
  const fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization });
    if (url.endsWith('/releases/latest')) {
      if (status !== 200) return res(status, {});
      return res(200, { tag_name: tag, body: 'notes', html_url: 'https://github.com/o/r/releases/tag/' + tag,
        assets: [{ name: assetName, url: 'https://api.github.com/assets/1', size: payload.length, digest: digest ?? `sha256:${sha}` }] });
    }
    if (url === 'https://api.github.com/assets/1') return res(302, null, { location: 'https://objects.githubusercontent.com/file' });
    if (url === 'https://objects.githubusercontent.com/file') return res(200, payload, { 'content-length': String(payload.length) });
    return res(404, {});
  });
  return { fetch, calls };
}

const base = (o) => ({ repo: 'o/r', getToken: () => 'tok', tmp: mkdtempSync(join(tmpdir(), 'upd-')), platform: 'win32', arch: 'x64', ...o });

describe('createUpdater', () => {
  it('says up-to-date when the release is not newer', async () => {
    const { fetch } = fakeGitHub({ tag: 'v1.5.1' });
    const u = createUpdater(base({ app: fakeApp(), fetch }));
    expect((await u.check()).status).toBe('up-to-date');
  });

  it('auto mode: downloads, checks the digest, drops the token on the redirect, installs on quit', async () => {
    const app = fakeApp();
    const { fetch, calls } = fakeGitHub();
    const spawn = vi.fn(() => ({ unref() {} }));
    const states = [];
    const u = createUpdater(base({ app, fetch, spawn, onState: (s) => states.push(s.status) }));
    const s = await u.check();
    expect(s.status).toBe('ready');
    expect(s.latest).toBe('1.6.0');
    expect(states).toEqual(expect.arrayContaining(['checking', 'available', 'downloading', 'ready']));
    expect(calls.find((c) => c.url.includes('objects.githubusercontent')).auth).toBeUndefined();
    expect(calls.find((c) => c.url.endsWith('/latest')).auth).toBe('Bearer tok');
    app.emit('will-quit');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][1]).toEqual(['--updated', '/S']);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('install() relaunches through the installer and quits once', async () => {
    const app = fakeApp();
    const spawn = vi.fn(() => ({ unref() {} }));
    const u = createUpdater(base({ app, fetch: fakeGitHub().fetch, spawn }));
    await u.check();
    expect(u.install()).toBe(true);
    expect(spawn.mock.calls[0][1]).toEqual(['--updated', '/S', '--force-run']);
    expect(app.quit).toHaveBeenCalledTimes(1);
    app.emit('will-quit');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('notify mode only reports; download() then fetches', async () => {
    const u = createUpdater(base({ app: fakeApp(), fetch: fakeGitHub().fetch, getMode: () => 'notify' }));
    const s = await u.check();
    expect(s.status).toBe('available');
    expect(s.canInstall).toBe(true);
    expect((await u.download()).status).toBe('ready');
  });

  it('off mode skips background checks but a manual check works', async () => {
    const { fetch } = fakeGitHub();
    const u = createUpdater(base({ app: fakeApp(), fetch, getMode: () => 'off' }));
    await u.check();
    expect(fetch).not.toHaveBeenCalled();
    expect((await u.check({ manual: true })).status).toBe('available');
  });

  it('rejects a download whose sha256 does not match', async () => {
    const u = createUpdater(base({ app: fakeApp(), fetch: fakeGitHub({ digest: 'sha256:' + '0'.repeat(64) }).fetch }));
    const s = await u.check();
    expect(s.status).toBe('error');
    expect(s.errorCode).toBe('bad-download');
  });

  it('refuses a release file without a sha256 digest', async () => {
    const u = createUpdater(base({ app: fakeApp(), fetch: fakeGitHub({ digest: '' }).fetch }));
    expect((await u.check()).errorCode).toBe('bad-download');
  });

  it('a newer release replaces one already waiting; the same one stays ready', async () => {
    const gh = { tag: 'v1.6.0' };
    const fetch = vi.fn((url, init) => fakeGitHub(gh).fetch(url, init));
    const u = createUpdater(base({ app: fakeApp(), fetch }));
    expect((await u.check()).status).toBe('ready');
    expect((await u.check()).status).toBe('ready');
    gh.tag = 'v1.7.0';
    const s = await u.check();
    expect(s.status).toBe('ready');
    expect(s.latest).toBe('1.7.0');
  });

  it('macOS: checks the app folder is writable before downloading anything', async () => {
    const { fetch } = fakeGitHub({ assetName: 'SnagIt-1.6.0-mac-arm64.zip' });
    const u = createUpdater(base({ app: fakeApp(), fetch, platform: 'darwin', arch: 'arm64', execPath: '/System/NoSuch.app/Contents/MacOS/NoSuch' }));
    const s = await u.check();
    expect(s.status).toBe('available');
    expect(s.errorCode).toBe('not-writable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a stalled download gives up instead of staying busy', async () => {
    const payload = Buffer.from('x');
    const fetch = vi.fn(async (url, init = {}) => {
      if (url.endsWith('/releases/latest')) return res(200, { tag_name: 'v1.6.0', assets: [{ name: 'A-Setup-1.6.0-win-x64.exe', url: 'https://api.github.com/assets/1', size: 1, digest: 'sha256:00' }] });
      return { status: 200, ok: true, headers: { get: () => null }, body: (async function* gen() {
        await new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
        yield payload;
      })() };
    });
    const u = createUpdater(base({ app: fakeApp(), fetch, stallMs: 30 }));
    const s = await u.check();
    expect(s.status).toBe('error');
    expect(s.errorCode).toBe('stalled');
  });

  it('asks for a token on a private repo and flags a bad one', async () => {
    const noTok = createUpdater(base({ app: fakeApp(), getToken: () => null, fetch: fakeGitHub({ status: 404 }).fetch }));
    expect((await noTok.check()).errorCode).toBe('needs-token');
    const bad = createUpdater(base({ app: fakeApp(), fetch: fakeGitHub({ status: 401 }).fetch }));
    expect((await bad.check()).errorCode).toBe('bad-token');
  });

  it('running from source: reports the update but never downloads', async () => {
    const { fetch } = fakeGitHub();
    const u = createUpdater(base({ app: fakeApp({ packaged: false }), fetch }));
    const s = await u.check();
    expect(s.status).toBe('available');
    expect(s.canInstall).toBe(false);
    expect((await u.download()).errorCode).toBe('not-installed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('macOS: unzips the .app and swaps it after quit via env vars', async () => {
    const appsDir = mkdtempSync(join(tmpdir(), 'apps-'));
    mkdirSync(join(appsDir, 'SnagIt.app'));
    const app = fakeApp();
    const spawn = vi.fn(() => ({ unref() {} }));
    const unzip = async (file, dir) => { mkdirSync(join(dir, 'SnagIt.app', 'Contents'), { recursive: true }); };
    const u = createUpdater(base({ app, fetch: fakeGitHub({ assetName: 'SnagIt-1.6.0-mac-arm64.zip' }).fetch, spawn, unzip,
      platform: 'darwin', arch: 'arm64', execPath: join(appsDir, 'SnagIt.app/Contents/MacOS/SnagIt'), pid: 4242 }));
    expect((await u.check()).status).toBe('ready');
    u.install({ relaunch: true });
    const [cmd, args, opts] = spawn.mock.calls[0];
    expect(cmd).toBe('/bin/sh');
    expect(readFileSync(args[0], 'utf8')).toBe(SWAP_SCRIPT);
    expect(opts.env).toMatchObject({ MN_PID: '4242', MN_TARGET: join(appsDir, 'SnagIt.app'), MN_RELAUNCH: '1' });
    expect(opts.env.MN_NEW).toMatch(/SnagIt\.app$/);
  });
});

describe.runIf(process.platform === 'darwin')('SWAP_SCRIPT on a real folder', () => {
  it('replaces the target app and keeps nothing behind', () => {
    const d = mkdtempSync(join(tmpdir(), 'swap-'));
    mkdirSync(join(d, 'Old.app'), { recursive: true }); writeFileSync(join(d, 'Old.app', 'v'), '1');
    mkdirSync(join(d, 'new', 'Old.app'), { recursive: true }); writeFileSync(join(d, 'new', 'Old.app', 'v'), '2');
    writeFileSync(join(d, 'swap.sh'), SWAP_SCRIPT);
    execFileSync('/bin/sh', [join(d, 'swap.sh')], { env: { ...process.env, MN_PID: '999999', MN_NEW: join(d, 'new', 'Old.app'), MN_TARGET: join(d, 'Old.app'), MN_RELAUNCH: '0', MN_TMP: join(d, 'new'), MN_LOG: join(d, 'log') } });
    expect(readFileSync(join(d, 'Old.app', 'v'), 'utf8')).toBe('2');
    expect(readFileSync(join(d, 'log'), 'utf8')).toContain('updated');
    expect(existsSync(join(d, 'Old.app.new-update'))).toBe(false);
    expect(existsSync(join(d, 'Old.app.old-update'))).toBe(false);
    expect(existsSync(join(d, 'new'))).toBe(false);
  });
});

describe.runIf(process.platform === 'darwin')('SWAP_SCRIPT when the copy fails', () => {
  it('keeps the current app untouched and logs why', () => {
    const d = mkdtempSync(join(tmpdir(), 'swap-'));
    mkdirSync(join(d, 'Old.app'), { recursive: true }); writeFileSync(join(d, 'Old.app', 'v'), '1');
    writeFileSync(join(d, 'swap.sh'), SWAP_SCRIPT);
    expect(() => execFileSync('/bin/sh', [join(d, 'swap.sh')], { stdio: 'pipe', env: { ...process.env, MN_PID: '999999', MN_NEW: join(d, 'missing.app'), MN_TARGET: join(d, 'Old.app'), MN_RELAUNCH: '0', MN_TMP: join(d, 'x'), MN_LOG: join(d, 'log') } })).toThrow();
    expect(readFileSync(join(d, 'Old.app', 'v'), 'utf8')).toBe('1');
    expect(readFileSync(join(d, 'log'), 'utf8')).toContain('copy failed');
  });
});

describe('desktop-release helpers', () => {
  it('works out the next version', () => {
    expect(nextVersion('1.5.1', 'minor')).toBe('1.6.0');
    expect(nextVersion('1.5.1', 'patch')).toBe('1.5.2');
    expect(nextVersion('1.5.1', 'major')).toBe('2.0.0');
    expect(nextVersion('1.5.1', '3.0.0')).toBe('3.0.0');
    expect(nextVersion('1.5.1', 'huge')).toBeNull();
  });
  it('picks only this version\'s dmg, zip and exe', () => {
    expect(releaseFiles(['SnagIt-1.6.0-mac-arm64.dmg', 'SnagIt-1.6.0-mac-arm64.zip', 'SnagIt-Setup-1.6.0-win-x64.exe',
      'SnagIt-Setup-1.6.0-win-x64.exe.blockmap', 'SnagIt Setup 1.5.1.exe', 'latest.yml', 'builder-debug.yml'], '1.6.0'))
      .toEqual(['SnagIt-1.6.0-mac-arm64.dmg', 'SnagIt-1.6.0-mac-arm64.zip', 'SnagIt-Setup-1.6.0-win-x64.exe']);
  });
});
