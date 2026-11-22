// Blocks: drive an already-running, already-logged-in Chrome from a Node job
// (a Mac launchd job that reads pages behind a login and pushes the result to
// a server). Playwright connects over the DevTools protocol; nothing here
// launches or closes Chrome. Rules: docs/decisions/browser.md.
//
// Needs the optional peer `playwright-core` (npm i playwright-core); it is
// loaded only when you connect, so importing this file costs nothing.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 9222;
export const DEFAULT_PROFILE_DIR = '~/ChromeAutomation';
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIN_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const winUserChrome = (env) => `${env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')}\\Google\\Chrome\\Application\\chrome.exe`;
const LINUX_CHROME = 'google-chrome';

function expandHome(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2));
  return p;
}

/**
 * The Chrome start command as { command, args }. The debug port is bound to
 * 127.0.0.1 and the profile is a dedicated folder (Chrome 136+ ignores
 * --remote-debugging-port on the default profile). `platform` and `home` exist
 * for tests.
 */
export function chromeArgs({ port = DEFAULT_PORT, profileDir = DEFAULT_PROFILE_DIR, chromePath, platform = process.platform, home = homedir(), exists = existsSync, env = process.env } = {}) {
  // Windows: Program Files, else the per-user install.
  const win = exists(WIN_CHROME) ? WIN_CHROME : exists(winUserChrome(env)) ? winUserChrome(env) : WIN_CHROME;
  const command = chromePath || (platform === 'darwin' ? MAC_CHROME : platform === 'win32' ? win : LINUX_CHROME);
  return {
    command,
    args: [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${expandHome(profileDir, home)}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  };
}

// POSIX: backslash-escape inside double quotes. Windows: plain double quotes (no escaping; paths can't hold ").
const quote = (s, platform) => (/^[\w@%+=:,./\\-]+$/.test(s) ? s : platform === 'win32' ? `"${s}"` : `"${s.replace(/(["\\$`])/g, '\\$1')}"`);

/** chromeArgs as one shell-ready string, e.g. for an error message or a plist note. */
export function chromeCommand(opts = {}) {
  const { command, args } = chromeArgs(opts);
  return [command, ...args].map((a) => quote(a, opts.platform || process.platform)).join(' ');
}

async function loadPlaywright(importer) {
  try {
    const mod = await importer('playwright-core');
    return mod.chromium || mod.default?.chromium;
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND' || /Cannot find (package|module)/i.test(e?.message || '')) {
      throw new Error('@mn/blocks/browser needs the playwright-core package. Install it in the app: npm i playwright-core');
    }
    throw e;
  }
}

/**
 * Connects to the running automation Chrome. Returns { browser, context }
 * (context = Chrome's existing default context, so its logins apply). Call
 * browser.close() when done: over CDP that only disconnects, Chrome stays open.
 * `importer` replaces the dynamic import (tests).
 */
export async function connectChrome({ port = DEFAULT_PORT, host = '127.0.0.1', timeoutMs = 10000, importer = (n) => import(n), ...chromeOpts } = {}) {
  const chromium = await loadPlaywright(importer);
  if (!chromium?.connectOverCDP) throw new Error('playwright-core has no chromium.connectOverCDP; update it: npm i playwright-core@latest');
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://${host}:${port}`, { timeout: timeoutMs });
  } catch (e) {
    const err = new Error(`Chrome isn't running with remote debugging on ${host}:${port}. Start it with: ${chromeCommand({ port, ...chromeOpts })}`);
    err.cause = e;
    throw err;
  }
  const context = browser.contexts()[0];
  if (!context) {
    // A fresh context would be logged out; refuse rather than scrape as nobody.
    await browser.close().catch(() => {});
    throw new Error(`Chrome on ${host}:${port} has no browser window/profile open. Start it with: ${chromeCommand({ port, ...chromeOpts })}`);
  }
  return { browser, context };
}

/**
 * Opens a NEW tab in the running Chrome, goes to `url`, runs fn(page), always
 * closes that tab, then disconnects (Chrome and the person's own tabs are never
 * touched). Returns fn's result. opts: port, host, timeoutMs, waitUntil
 * ('domcontentloaded'), navTimeoutMs (30000), connect (replaces connectChrome, tests).
 */
export async function withPage(url, fn, { waitUntil = 'domcontentloaded', navTimeoutMs = 30000, connect, ...connectOpts } = {}) {
  const { browser, context } = await (connect || connectChrome)(connectOpts);
  let page;
  try {
    page = await context.newPage();
    if (url) await page.goto(url, { waitUntil, timeout: navTimeoutMs });
    return await fn(page);
  } finally {
    try { if (page) await page.close(); } catch { /* tab already gone */ }
    try { await browser.close(); } catch { /* already disconnected */ }
  }
}

/**
 * Waits for the download that trigger(page) starts (e.g. a click on Export) and
 * returns { fileName, text } (UTF-8). The file is read from Playwright's temp
 * copy, not saved anywhere else.
 */
export async function downloadText(page, trigger, { timeoutMs = 30000 } = {}) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: timeoutMs }), trigger(page)]);
  const failure = await download.failure();
  if (failure) throw new Error(`Download failed: ${failure}`);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return { fileName: download.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '') };
}

/**
 * True when the page is a sign-in page (its address contains one of
 * urlIncludes, or it has a password field; waits for `waitFor` first, 'networkidle' by default, false to skip), so a job can report "log in to the
 * automation profile" instead of scraping it.
 */
export async function needsLogin(page, { urlIncludes = ['login', 'signin', 'sign-in'], waitFor = 'networkidle', waitTimeoutMs = 3000 } = {}) {
  // Let redirects to a sign-in page finish first; a page that never idles is fine.
  if (waitFor) {
    try { await page.waitForLoadState(waitFor, { timeout: waitTimeoutMs }); } catch { /* timeout: check what is there */ }
  }
  const url = String(page.url()).toLowerCase();
  if (urlIncludes.some((s) => url.includes(String(s).toLowerCase()))) return true;
  try {
    return (await page.locator('input[type="password"]').count()) > 0;
  } catch {
    return false;
  }
}
