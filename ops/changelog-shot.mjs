// Blocks: before/after screenshots for a changelog entry.
//
//   node node_modules/@mn/blocks/ops/changelog-shot.mjs \
//     --base http://localhost:5173 --out changelog/<id> --name before \
//     --login 'POST /api/auth/dev-login {"role":"admin"}' \
//     /admin?tab=leads /admin?tab=vehicles
//
// Signs in (optional), opens each page at 1280px (--phone adds 390px), waits
// for the network to go quiet, and saves <name>-1.jpg, <name>-2.jpg ... in
// --out (JPEG quality 80). It also writes the file names into
// <out>/entry.json's `shots` (shot N pairs before-N with after-N), creating
// the file if it isn't there yet. A re-run replaces that name's shots.
//
// Only this computer (localhost, 127.x, ::1): screenshots come from the local
// app with demo data, never from production with customer data. The browser
// refuses every request to another host (redirects, API calls, images), and a
// page that ends up anywhere but the path asked for (e.g. sent to the sign-in
// page) or gets a 401/403 from the API stops the script. It cannot see past
// the local server: a dev proxy that forwards /api to production would still
// show production data, so run the app on its demo data.
//
// Options:
//   --base <url>      app address (required, local only)
//   --out <dir>       entry folder, named changelog/<id> (required)
//   --name <before|after>
//   --login '<METHOD> <path> [json]'   sign-in request sent before the pages
//   --phone           also take each page at 390px
//   --hide <css>      hide elements that change on every load (repeatable)
//   --wait <css>      wait for this element on each page (instead of network quiet)
//   --full            full-page screenshots (default: the first 900px)
//
// Needs Playwright (`playwright` or `@playwright/test`) in the app.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DESKTOP = { width: 1280, height: 900 };
export const PHONE = { width: 390, height: 844 };
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/; // same as server/changelog.js CHANGELOG_ID

export class ShotError extends Error {}

/** argv (without node and script) -> options. Throws ShotError on bad input. */
export function parseArgs(argv) {
  const o = { base: '', out: '', name: '', login: null, phone: false, full: false, hide: [], wait: '', pages: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new ShotError(`${a} needs a value`);
      return v;
    };
    if (a === '--base') o.base = val();
    else if (a === '--out') o.out = val();
    else if (a === '--name') o.name = val();
    else if (a === '--login') o.login = parseLogin(val());
    else if (a === '--hide') o.hide.push(val());
    else if (a === '--wait') o.wait = val();
    else if (a === '--phone') o.phone = true;
    else if (a === '--full') o.full = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--')) throw new ShotError(`unknown option ${a}`);
    else o.pages.push(a);
  }
  if (o.help) return o;
  if (!o.base) throw new ShotError('--base is required (e.g. http://localhost:5173)');
  if (!isLocalBase(o.base)) throw new ShotError(`${o.base} is not a local address. Screenshots come only from the local app with demo data, never from production.`);
  if (!o.out) throw new ShotError('--out is required (e.g. changelog/<id>)');
  if (!ID.test(basename(resolve(o.out)))) throw new ShotError(`--out folder name must be lowercase letters, digits and dashes (e.g. changelog/f-093-whats-new), not ${basename(resolve(o.out))}`);
  if (!['before', 'after'].includes(o.name)) throw new ShotError('--name must be before or after');
  if (!o.pages.length) throw new ShotError('give at least one page, e.g. /admin?tab=leads');
  for (const p of o.pages) {
    if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\')) throw new ShotError(`page ${p} must be a path starting with / (the --base address is added)`);
  }
  return o;
}

/** "POST /api/auth/dev-login {\"role\":\"admin\"}" -> { method, path, data } */
export function parseLogin(s) {
  const m = String(s).trim().match(/^([A-Za-z]+)\s+(\/(?![/\\])\S*)(?:\s+([\s\S]+))?$/);
  if (!m) throw new ShotError(`--login must look like 'POST /api/auth/dev-login {"role":"admin"}'`);
  let data;
  if (m[3]) {
    try { data = JSON.parse(m[3]); } catch { throw new ShotError('--login body is not valid JSON'); }
  }
  return { method: m[1].toUpperCase(), path: m[2], data };
}

/** Only this computer: localhost, 127.0.0.0/8, ::1 (no *.localhost: Node resolves those through DNS). */
export function isLocalBase(base) {
  let u;
  try { u = new URL(base); } catch { return false; }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return false;
  if (u.username || u.password) return false;
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

/** Requests the browser may make: this computer, plus data:/blob: (no network). */
export const allowedRequest = (url) => /^(data|blob):/i.test(url) || isLocalBase(url);

/** The shots to take, in file order: each page at desktop, then phone if asked. */
export function plan(o) {
  const shots = [];
  for (const page of o.pages) {
    shots.push({ page, size: 'desktop', viewport: DESKTOP });
    if (o.phone) shots.push({ page, size: 'phone', viewport: PHONE });
  }
  return shots.map((s, i) => ({ ...s, file: `${o.name}-${i + 1}.jpg`, label: o.phone ? `${s.page} (${s.size})` : s.page }));
}

/**
 * Write the taken files into <out>/entry.json's shots (before-N pairs with
 * after-N). This name's old shots past the new count are cleared. Returns the
 * entry and a list of warnings (a shot whose label doesn't match the other
 * side's, i.e. before and after were taken of different pages).
 */
export function recordShots(out, name, shots) {
  const file = join(out, 'entry.json');
  let entry = {};
  if (existsSync(file)) {
    try { entry = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new ShotError(`${file} is not valid JSON; fix it and run again`); }
  }
  const warnings = [];
  const list = (Array.isArray(entry.shots) ? entry.shots : []).map((s) => (s && typeof s === 'object' ? { ...s } : {}));
  shots.forEach((s, i) => {
    const prev = list[i] || {};
    const other = name === 'before' ? 'after' : 'before';
    if (prev[other] && prev.page && prev.page !== s.label) warnings.push(`shot ${i + 1}: ${name} is ${s.label} but ${other} is ${prev.page}`);
    list[i] = { label: prev.label || s.label, ...prev, page: prev.page || s.label, [name]: s.file };
  });
  for (let i = shots.length; i < list.length; i++) delete list[i][name];
  entry.shots = list.filter((s) => s.before || s.after);
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`);
  return { entry, warnings };
}

async function loadPlaywright() {
  const req = createRequire(join(process.cwd(), 'package.json'));
  for (const name of ['playwright', '@playwright/test']) {
    try { return await import(pathToFileURL(req.resolve(name)).href); } catch { /* try the next */ }
  }
  throw new ShotError('Playwright is not installed in this app: npm i -D playwright && npx playwright install chromium');
}

const pathOf = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

export async function run(o, log = console.log) {
  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  const shots = plan(o);
  const pw = await loadPlaywright();
  const chromium = pw.chromium || pw.default?.chromium;
  const browser = await chromium.launch();
  const base = o.base.replace(/\/+$/, '');
  const tmp = (f) => join(out, `.tmp-${f}`);
  try {
    const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
    // Nothing leaves this computer: redirects, API calls, images, fonts.
    const blocked = [];
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (allowedRequest(url)) return route.continue();
      blocked.push(url);
      return route.abort('blockedbyclient');
    });
    if (o.login) {
      let res;
      try {
        res = await context.request.fetch(base + o.login.path, { method: o.login.method, data: o.login.data, maxRedirects: 0 });
      } catch (e) {
        throw new ShotError(`sign-in failed: ${e.message.split('\n')[0]}. Is the app running at ${o.base}?`);
      }
      if (!res.ok()) throw new ShotError(`sign-in failed: ${o.login.method} ${o.login.path} returned ${res.status()}. Is the app running with its dev login on?`);
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`script error: ${e.message}`));
    page.on('response', (r) => {
      if ([401, 403].includes(r.status()) && isLocalBase(r.url())) errors.push(`${pathOf(r.url())} returned ${r.status()} (not signed in?)`);
    });
    const hideCss = [
      '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
      ...o.hide.map((sel) => `${sel}{visibility:hidden!important}`),
    ].join('\n');
    for (const s of shots) {
      await page.setViewportSize(s.viewport);
      errors.length = 0;
      let res;
      try {
        res = await page.goto(base + s.page, { waitUntil: o.wait ? 'load' : 'networkidle', timeout: 30000 });
      } catch (e) {
        throw new ShotError(`could not open ${s.page}: ${e.message.split('\n')[0]}. Is the app running at ${o.base}?`);
      }
      if (res && res.status() >= 400) throw new ShotError(`${s.page} returned ${res.status()}`);
      if (o.wait) await page.waitForSelector(o.wait, { timeout: 15000 }).catch(() => { throw new ShotError(`${s.page}: ${o.wait} never appeared`); });
      await page.addStyleTag({ content: hideCss });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);
      if (!isLocalBase(page.url())) throw new ShotError(`${s.page} went to ${page.url()}, which is not this computer`);
      const want = new URL(base + s.page);
      const got = new URL(page.url());
      if (got.pathname !== want.pathname) throw new ShotError(`${s.page} ended up on ${got.pathname}${got.search}: not signed in, or the page moved. Check --login.`);
      if (errors.length) throw new ShotError(`${s.page}: ${errors[0]}`);
      await page.screenshot({ path: tmp(s.file), type: 'jpeg', quality: 80, fullPage: o.full });
      log(`took ${s.page} at ${s.viewport.width}px`);
    }
    if (blocked.length) log(`blocked ${blocked.length} request(s) to other hosts, e.g. ${blocked[0]}`);
  } catch (e) {
    for (const s of shots) rmSync(tmp(s.file), { force: true });
    throw e;
  } finally {
    await browser.close();
  }
  // All taken: replace this name's old files at once, so a failed run leaves the old set whole.
  const mine = new RegExp(`^${o.name}-\\d+\\.(jpg|jpeg|png|webp)$`);
  for (const f of readdirSync(out)) if (mine.test(f)) rmSync(join(out, f));
  for (const s of shots) { renameSync(tmp(s.file), join(out, s.file)); log(`saved ${join(o.out, s.file)}`); }
  const { warnings } = recordShots(out, o.name, shots);
  for (const w of warnings) log(`warning: ${w}`);
  return shots;
}

const HELP = readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(1, 32)
  .map((l) => l.replace(/^\/\/ ?/, '')).join('\n');

// Run as a script, including through a symlink (npm link, file: deps).
const isMain = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

if (process.argv[1] && isMain()) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) console.log(HELP);
    else await run(o);
  } catch (e) {
    console.error(`changelog-shot: ${e instanceof ShotError ? e.message : e.stack || e}`);
    process.exit(1);
  }
}
