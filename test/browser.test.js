import { describe, expect, it, vi } from 'vitest';
import { chromeArgs, chromeCommand, connectChrome, downloadText, needsLogin, withPage } from '../server/browser.js';

describe('chromeCommand', () => {
  it('uses the Mac path, port 9222, loopback and the expanded profile', () => {
    const { command, args } = chromeArgs({ platform: 'darwin', home: '/Users/m' });
    expect(command).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(args).toContain('--remote-debugging-port=9222');
    expect(args).toContain('--remote-debugging-address=127.0.0.1');
    expect(args).toContain('--user-data-dir=/Users/m/ChromeAutomation');
  });
  it('uses the Windows path and honours port, profile and chromePath', () => {
    expect(chromeArgs({ platform: 'win32', home: 'C:\\Users\\m' }).command).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    const a = chromeArgs({ platform: 'darwin', home: '/h', port: 9333, profileDir: '~/Other', chromePath: '/x/chrome' });
    expect(a.command).toBe('/x/chrome');
    expect(a.args).toContain('--remote-debugging-port=9333');
    expect(a.args).toContain('--user-data-dir=/h/Other');
    expect(chromeArgs({ profileDir: '/abs/dir' }).args).toContain('--user-data-dir=/abs/dir');
  });
  it('falls back to the per-user Windows Chrome and quotes without POSIX escaping', () => {
    const local = 'C:\\Users\\m\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
    const opts = { platform: 'win32', home: 'C:\\Users\\m', env: { LOCALAPPDATA: 'C:\\Users\\m\\AppData\\Local' }, exists: (p) => p === local };
    expect(chromeArgs(opts).command).toBe(local);
    const s = chromeCommand({ ...opts, exists: () => true });
    expect(s.startsWith('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote')).toBe(true);
    expect(s).not.toContain('\\"');
  });
  it('quotes paths with spaces in the command string', () => {
    const s = chromeCommand({ platform: 'darwin', home: '/Users/m' });
    expect(s.startsWith('"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222')).toBe(true);
  });
});

describe('connectChrome', () => {
  it('names npm i playwright-core when it is missing', async () => {
    const importer = async () => { throw Object.assign(new Error("Cannot find package 'playwright-core'"), { code: 'ERR_MODULE_NOT_FOUND' }); };
    await expect(connectChrome({ importer })).rejects.toThrow(/npm i playwright-core/);
  });
  it('explains how to start Chrome when the connection fails', async () => {
    const importer = async () => ({ chromium: { connectOverCDP: async () => { throw new Error('ECONNREFUSED'); } } });
    await expect(connectChrome({ importer, port: 9333 })).rejects.toThrow(/isn't running with remote debugging.*Start it with: .*--remote-debugging-port=9333/);
  });
  it('refuses a Chrome with no context instead of using a logged-out one', async () => {
    const close = vi.fn(async () => {});
    const importer = async () => ({ chromium: { connectOverCDP: async () => ({ contexts: () => [], close }) } });
    await expect(connectChrome({ importer })).rejects.toThrow(/no browser window/);
    expect(close).toHaveBeenCalled();
  });
  it('connects to loopback and returns the first context', async () => {
    const context = {};
    const connectOverCDP = vi.fn(async () => ({ contexts: () => [context] }));
    const r = await connectChrome({ importer: async () => ({ chromium: { connectOverCDP } }) });
    expect(connectOverCDP.mock.calls[0][0]).toBe('http://127.0.0.1:9222');
    expect(r.context).toBe(context);
  });
});

function fakeChrome(pageOver = {}) {
  const page = { goto: vi.fn(async () => {}), close: vi.fn(async () => {}), ...pageOver };
  const context = { newPage: vi.fn(async () => page) };
  const browser = { close: vi.fn(async () => {}) };
  return { page, context, browser, connect: async () => ({ browser, context }) };
}

describe('withPage', () => {
  it('opens a new tab, returns the result, closes the tab and disconnects', async () => {
    const f = fakeChrome();
    const out = await withPage('https://x.test/a', async (p) => (p === f.page ? 'ok' : 'wrong'), { connect: f.connect });
    expect(out).toBe('ok');
    expect(f.context.newPage).toHaveBeenCalledOnce();
    expect(f.page.goto).toHaveBeenCalledWith('https://x.test/a', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
    expect(f.page.close).toHaveBeenCalledOnce();
    expect(f.browser.close).toHaveBeenCalledOnce();
  });
  it('closes the tab even when fn throws', async () => {
    const f = fakeChrome();
    await expect(withPage('https://x.test', async () => { throw new Error('boom'); }, { connect: f.connect })).rejects.toThrow('boom');
    expect(f.page.close).toHaveBeenCalledOnce();
    expect(f.browser.close).toHaveBeenCalledOnce();
  });
  it('closes the tab when navigation fails', async () => {
    const f = fakeChrome({ goto: async () => { throw new Error('timeout'); } });
    await expect(withPage('https://x.test', async () => 1, { connect: f.connect })).rejects.toThrow('timeout');
    expect(f.page.close).toHaveBeenCalledOnce();
  });
});

describe('needsLogin', () => {
  const page = (url, passwords = 0, waitForLoadState = async () => {}) => ({ url: () => url, waitForLoadState, locator: () => ({ count: async () => passwords }) });
  it('flags sign-in URLs', async () => {
    expect(await needsLogin(page('https://a.test/Login?next=/x'))).toBe(true);
    expect(await needsLogin(page('https://a.test/sign-in'))).toBe(true);
  });
  it('flags a password field and passes a normal page', async () => {
    expect(await needsLogin(page('https://a.test/home', 1))).toBe(true);
    expect(await needsLogin(page('https://a.test/home'))).toBe(false);
  });
  it('waits for networkidle first and ignores a timeout', async () => {
    const w = vi.fn(async () => { throw new Error('Timeout'); });
    expect(await needsLogin(page('https://a.test/home', 0, w))).toBe(false);
    expect(w.mock.calls[0][0]).toBe('networkidle');
    const w2 = vi.fn();
    await needsLogin(page('https://a.test/home', 0, w2), { waitFor: false });
    expect(w2).not.toHaveBeenCalled();
  });
  it('uses custom urlIncludes', async () => {
    expect(await needsLogin(page('https://a.test/auth/start'), { urlIncludes: ['/auth/'] })).toBe(true);
  });
});

describe('downloadText', () => {
  it('returns the downloaded file name and text', async () => {
    const download = { failure: async () => null, suggestedFilename: () => 'r.csv', createReadStream: async () => (async function* () { yield '\uFEFFa,b\n'; yield '1,2\n'; })() };
    const page = { waitForEvent: async (ev) => (ev === 'download' ? download : null) };
    const trigger = vi.fn(async () => {});
    expect(await downloadText(page, trigger)).toEqual({ fileName: 'r.csv', text: 'a,b\n1,2\n' });
    expect(trigger).toHaveBeenCalledWith(page);
  });
  it('throws when the download failed', async () => {
    const download = { failure: async () => 'canceled', suggestedFilename: () => 'r.csv' };
    const page = { waitForEvent: async () => download };
    await expect(downloadText(page, async () => {})).rejects.toThrow(/canceled/);
  });
});
