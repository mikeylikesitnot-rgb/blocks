// Blocks: siteapi. Turn any website into an API: find the site's own internal
// JSON calls (capture traffic -> analyzeHar -> probeRequest) and call them with
// siteFetch. No dependencies (Node 18+ fetch); captureHar loads playwright-core
// only when used. Rules: docs/decisions/siteapi.md. CLI: ops/siteapi.mjs.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---- client --------------------------------------------------------------

/** Where a site's secrets live: ~/.config/siteapi/<site>.env (KEY=value lines). */
export function siteEnvPath(site, { home = homedir() } = {}) {
  return join(home, '.config', 'siteapi', `${site}.env`);
}

/**
 * A site's secrets: the env file, then <SITE>_KEY process variables on top
 * (e.g. NEXTGEN_COOKIE). Missing file = {}.
 */
export function readSiteEnv(site, { home = homedir(), env = process.env, read = readFileSync, exists = existsSync } = {}) {
  const out = {};
  const file = siteEnvPath(site, { home });
  if (exists(file)) {
    for (const raw of String(read(file, 'utf8')).split(/\r?\n/)) {
      const line = raw.trim();
      const i = line.indexOf('=');
      if (!line || line.startsWith('#') || i < 1) continue;
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  const prefix = `${String(site).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`;
  for (const [k, v] of Object.entries(env)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

export class SiteApiError extends Error {
  constructor(message, { status = 0, body = '', expired = false } = {}) {
    super(message);
    this.name = 'SiteApiError';
    this.status = status;
    this.body = body;
    this.expired = expired;
  }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * A polite JSON client for one site's internal API.
 * opts: base (https://site.com), site (env file name), minGap ms between calls
 * (1000), headers (extra, or (env) => headers for tokens beyond COOKIE /
 * AUTHORIZATION), timeoutMs (30000), env (replaces readSiteEnv), fetch, sleep (tests).
 * Returns { get(path, params), post(path, body, params), call(method, path, {params, body, headers}), env }.
 * Throws SiteApiError; .expired is true on 401/403 or an HTML page where JSON was expected.
 */
export function siteFetch({ base, site, minGap = 1000, headers = {}, timeoutMs = 30000, env, fetch: f = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  if (!base) throw new Error('siteFetch needs base');
  const secrets = env || (site ? readSiteEnv(site) : {});
  let last = 0;
  let queue = Promise.resolve();

  async function send(method, path, { params, body, headers: extra = {} } = {}) {
    const wait = minGap - (now() - last);
    if (last && wait > 0) await sleep(wait);
    last = now();
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const h = { 'user-agent': UA, accept: 'application/json', referer: new URL(base).origin + '/' };
    if (secrets.COOKIE) h.cookie = secrets.COOKIE;
    if (secrets.AUTHORIZATION) h.authorization = secrets.AUTHORIZATION;
    Object.assign(h, typeof headers === 'function' ? headers(secrets) : headers, extra);
    let payload;
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (typeof body !== 'string') h['content-type'] = 'application/json';
    }
    const name = site || url.hostname;
    let res;
    try {
      res = await f(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    } catch (e) {
      throw new SiteApiError(`${name}: request failed: ${e.message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      const expired = res.status === 401 || res.status === 403;
      throw new SiteApiError(`${name}: HTTP ${res.status}${expired ? ' (session expired or blocked: refresh the env file)' : ''}: ${text.slice(0, 200)}`, { status: res.status, body: text, expired });
    }
    try {
      return JSON.parse(text);
    } catch {
      const html = /^\s*</.test(text);
      throw new SiteApiError(`${name}: expected JSON, got ${html ? 'an HTML page (logged out or a bot wall?)' : 'text'}: ${text.slice(0, 120)}`, { status: res.status, body: text, expired: html });
    }
  }
  // One request at a time, so minGap holds even when callers fire in parallel.
  const call = (method, path, opts) => {
    const p = queue.then(() => send(method, path, opts));
    queue = p.catch(() => {});
    return p;
  };
  return {
    call,
    get: (path, params) => call('GET', path, { params }),
    post: (path, body, params) => call('POST', path, { params, body }),
    env: secrets,
  };
}

// ---- analyze -------------------------------------------------------------

const NOISE_HOSTS = /(google-analytics|googletagmanager|doubleclick|googlesyndication|facebook\.(com|net)|fbcdn|segment\.(io|com)|hotjar|sentry|newrelic|nr-data|datadog|clarity\.ms|bing\.com|tiktok|snapchat|pinterest|linkedin|twitter|optimizely|launchdarkly|intercom|zendesk|hubspot|mixpanel|amplitude|heap|fullstory|cookielaw|onetrust|recaptcha|gstatic|cloudflareinsights|adsrvr|criteo|quantserve|scorecardresearch|braze|branch\.io)/i;
const STATIC_EXT = /\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|map)$/i;
const ID_SEG = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-HJ-NPR-Z0-9]{17})$/i;
const AUTHY = /^(authorization|cookie|x-.*|.*token.*|.*csrf.*|.*xsrf.*|.*api[-_]?key.*|.*session.*)$/i;
const EMBED = [
  ['__NEXT_DATA__', /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/],
  ['__NUXT__', /window\.__NUXT__\s*=\s*([\s\S]{0,200000}?)<\/script>/],
  ['initial state', /window\.__(?:INITIAL|PRELOADED|APOLLO)_STATE__\s*=\s*([\s\S]{0,200000}?)<\/script>/],
  ['ld+json', /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/],
];

/** Path with ids (numbers, uuids, hashes, VINs) replaced by {id}. */
export function normPath(path) {
  return path.split('/').map((s) => (ID_SEG.test(s) ? '{id}' : s)).join('/') || '/';
}

/** Compact structure of a JSON value: keys and types, arrays as ['N items', first]. */
export function jsonShape(v, depth = 0) {
  if (Array.isArray(v)) return v.length ? [`${v.length} items`, jsonShape(v[0], depth + 1)] : [];
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth >= 2) return `{${keys.length} keys}`;
    return Object.fromEntries(keys.slice(0, 25).map((k) => [k, jsonShape(v[k], depth + 1)]));
  }
  return v === null ? 'null' : typeof v;
}

function biggestList(v, depth = 0) {
  if (depth > 4) return 0;
  if (Array.isArray(v)) return Math.max(v.length, ...v.slice(0, 3).map((x) => biggestList(x, depth + 1)));
  if (v && typeof v === 'object') return Math.max(0, ...Object.values(v).map((x) => biggestList(x, depth + 1)));
  return 0;
}

function bodyText(content = {}) {
  const t = content.text || '';
  return t && content.encoding === 'base64' ? Buffer.from(t, 'base64').toString('utf8') : t;
}

const sameSite = (a, b) => String(a).split('.').slice(-2).join('.') === String(b).split('.').slice(-2).join('.');

/**
 * Ranks the JSON endpoints in a HAR ({log: {entries}}) by how likely they hold
 * the page's data. find: strings seen on the page (the strongest signal).
 * Returns { pageHost, endpoints: [{n, score, endpoint, calls, status, exampleUrl,
 * queryKeys, postKeys, authHeaders, bytes, biggestList, found, shape, sample,
 * request}], embedded: [{url, kind, chars, found}] }. `request` holds the full
 * captured headers (cookies too): keep it local.
 */
export function analyzeHar(har, { find = [], allHosts = false } = {}) {
  const entries = har?.log?.entries || [];
  const finds = find.map((x) => String(x).toLowerCase()).filter(Boolean);
  const groups = new Map();
  const embedded = [];
  let pageHost = '';

  for (const e of entries) {
    const req = e.request || {};
    const res = e.response || {};
    let u;
    try { u = new URL(req.url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (!pageHost) pageHost = u.hostname;
    if (STATIC_EXT.test(u.pathname)) continue;
    if (!allHosts && NOISE_HOSTS.test(u.hostname)) continue;
    const mime = String(res.content?.mimeType || '').toLowerCase();
    const text = bodyText(res.content);

    if (mime.includes('html') && text) {
      for (const [kind, rx] of EMBED) {
        const m = text.match(rx);
        if (m) {
          const low = m[1].toLowerCase();
          embedded.push({ url: req.url, kind, chars: m[1].length, found: finds.filter((x) => low.includes(x)) });
        }
      }
      continue;
    }
    if (!text || !(mime.includes('json') || /^\s*[[{]/.test(text))) continue;
    let data;
    try { data = JSON.parse(text); } catch { continue; }

    const post = req.postData?.text || '';
    let op = '';
    let postKeys = [];
    if (post) {
      try {
        const pj = JSON.parse(post);
        if (pj && typeof pj === 'object' && !Array.isArray(pj)) { postKeys = Object.keys(pj).slice(0, 20); op = pj.operationName || ''; }
      } catch { postKeys = [...new URLSearchParams(post).keys()].slice(0, 20); }
    }
    const key = `${req.method} ${u.hostname}${normPath(u.pathname)}${op ? ` [gql:${op}]` : ''}`;
    let g = groups.get(key);
    if (!g) {
      g = { endpoint: key, calls: 0, status: new Set(), queryKeys: new Set(), postKeys, authHeaders: new Set(), bytes: -1, biggestList: 0, found: new Set(), same: false };
      groups.set(key, g);
    }
    g.calls += 1;
    g.status.add(res.status);
    for (const k of u.searchParams.keys()) g.queryKeys.add(k);
    const headers = (req.headers || []).filter((h) => !String(h.name).startsWith(':'));
    for (const h of headers) if (AUTHY.test(h.name)) g.authHeaders.add(h.name.toLowerCase());
    const low = text.toLowerCase();
    for (const x of finds) if (low.includes(x)) g.found.add(x);
    g.same = g.same || sameSite(pageHost, u.hostname);
    if (text.length >= g.bytes) {
      Object.assign(g, {
        bytes: text.length, data, exampleUrl: req.url,
        biggestList: Math.max(g.biggestList, biggestList(data)),
        request: { method: req.method, url: req.url, headers: Object.fromEntries(headers.map((h) => [h.name, h.value])), postData: post || null },
      });
    }
  }

  const score = (g) => g.found.size * 1000 + Math.min(g.biggestList, 200) * 3 + Math.min(Math.floor(g.bytes / 1000), 300)
    + (g.same ? 50 : 0) - ([...g.status].some((s) => s >= 200 && s < 300) ? 0 : 500);
  const endpoints = [...groups.values()].sort((a, b) => score(b) - score(a)).map((g, i) => ({
    n: i + 1, score: score(g), endpoint: g.endpoint, calls: g.calls, status: [...g.status].sort(), exampleUrl: g.exampleUrl,
    queryKeys: [...g.queryKeys].sort(), postKeys: g.postKeys, authHeaders: [...g.authHeaders].sort(), bytes: g.bytes,
    biggestList: g.biggestList, found: [...g.found].sort(), shape: jsonShape(g.data),
    sample: Array.isArray(g.data) ? g.data.slice(0, 3) : g.data, request: g.request,
  }));
  return { pageHost, endpoints, embedded };
}

// ---- probe ---------------------------------------------------------------

const BASIC = new Set(['user-agent', 'accept', 'accept-language', 'referer', 'origin', 'content-type']);

/**
 * Replays a captured request with fewer headers to find the least auth it
 * needs: none -> browser headers -> + cookies -> full captured.
 * Returns { levels: [{name, status, bytes, json}], minimum (level name or null), extraHeaders }.
 */
export async function probeRequest(req, { fetch: f = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const h = Object.fromEntries(Object.entries(req.headers || {}).filter(([k]) => !['accept-encoding', 'content-length', 'host'].includes(k.toLowerCase()) && !k.startsWith(':')));
  const basic = Object.fromEntries(Object.entries(h).filter(([k]) => BASIC.has(k.toLowerCase())));
  const cookie = Object.fromEntries(Object.entries(h).filter(([k]) => k.toLowerCase() === 'cookie'));
  const tries = [['none', {}], ['browser headers', basic], ['+ cookies', { ...basic, ...cookie }], ['full captured', h]];
  const levels = [];
  let minimum = null;
  for (const [name, headers] of tries) {
    let status = 0; let text = '';
    try {
      const r = await f(req.url, { method: req.method, headers, body: req.postData || undefined, signal: AbortSignal.timeout(timeoutMs) });
      status = r.status; text = await r.text();
    } catch (e) { text = String(e.message); }
    let json = false;
    try { JSON.parse(text); json = true; } catch { /* not JSON */ }
    levels.push({ name, status, bytes: text.length, json, preview: json ? '' : text.slice(0, 80).replace(/\s+/g, ' ') });
    if (!minimum && json && status >= 200 && status < 300) minimum = name;
  }
  const extraHeaders = Object.keys(h).filter((k) => !BASIC.has(k.toLowerCase()) && k.toLowerCase() !== 'cookie').sort();
  return { levels, minimum, extraHeaders };
}

// ---- capture -------------------------------------------------------------

const KEEP_TYPES = new Set(['xhr', 'fetch', 'document', 'other', 'eventsource']);

/**
 * Records a page's traffic as a minimal HAR (requests + JSON/HTML bodies).
 * opts.chrome: use the running, signed-in automation Chrome (a new tab, closed
 * after; see @mn/blocks/browser), else launch a fresh browser (installed Chrome,
 * then Playwright's own). browseMs: keep the page open this long for a person to
 * log in / search / page (headed only); scroll: lazy-load passes; headed.
 */
export async function captureHar(url, { chrome = false, headed = false, browseMs = 0, waitMs = 4000, scroll = 3, port, importer = (n) => import(n), log = () => {} } = {}) {
  const entries = [];
  const pending = [];
  const watch = (page) => page.on('response', (res) => {
    const req = res.request();
    if (!KEEP_TYPES.has(req.resourceType())) return;
    pending.push((async () => {
      const mimeType = (res.headers()['content-type'] || '').toLowerCase();
      let text = '';
      if (/json|html|javascript|text\/plain/.test(mimeType)) { try { text = await res.text(); } catch { /* body gone (redirect) */ } }
      entries.push({
        request: { method: req.method(), url: req.url(), headers: Object.entries(await req.allHeaders().catch(() => req.headers())).map(([name, value]) => ({ name, value })), postData: req.postData() ? { text: req.postData() } : undefined },
        response: { status: res.status(), content: { mimeType, text } },
      });
    })());
  });
  const drive = async (page) => {
    if (browseMs > 0) { log(`Browser open for ${Math.round(browseMs / 1000)}s: log in, search, open a detail page.`); await page.waitForTimeout(browseMs); return; }
    await page.waitForTimeout(waitMs);
    for (let i = 0; i < scroll; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(1200); }
  };

  if (chrome) {
    const { connectChrome } = await import('./browser.js');
    const { browser, context } = await connectChrome({ port, importer });
    const page = await context.newPage();
    try {
      watch(page);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => log(`load issue: ${e.message}`));
      await drive(page);
    } finally {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  } else {
    let mod;
    try { mod = await importer('playwright-core'); } catch {
      try { mod = await importer('playwright'); } catch { throw new Error('captureHar needs playwright-core: npm i playwright-core (in Blocks itself: npm install)'); }
    }
    const chromium = mod.chromium || mod.default?.chromium;
    let browser; let err;
    for (const extra of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
      try { browser = await chromium.launch({ headless: !headed, ...extra }); break; } catch (e) { err = e; }
    }
    if (!browser) throw new Error(`No browser to launch (${String(err?.message).split('\n')[0]}). Install Chrome, or: npx playwright install chromium`);
    try {
      const context = await browser.newContext({ userAgent: UA, viewport: { width: 1400, height: 900 } });
      const page = await context.newPage();
      watch(page);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => log(`load issue: ${e.message}`));
      await drive(page);
    } finally {
      await browser.close().catch(() => {});
    }
  }
  await Promise.allSettled(pending);
  return { log: { version: '1.2', creator: { name: '@mn/blocks siteapi' }, entries } };
}
