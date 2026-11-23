import { describe, expect, it, vi } from 'vitest';
import { analyzeHar, captureHar, jsonShape, normPath, probeRequest, readSiteEnv, siteEnvPath, siteFetch, SiteApiError } from '../server/siteapi.js';

const entry = (url, body, { method = 'GET', status = 200, mime = 'application/json', headers = [], post } = {}) => ({
  request: { method, url, headers, postData: post ? { text: post } : undefined },
  response: { status, content: { mimeType: mime, text: typeof body === 'string' ? body : JSON.stringify(body) } },
});

describe('readSiteEnv', () => {
  it('reads KEY=value lines, skips comments, strips quotes, env vars win', () => {
    const files = { [siteEnvPath('acme', { home: '/h' })]: '# note\nCOOKIE="a=1; b=2"\nAUTHORIZATION=Bearer x\nbad line\n' };
    const env = readSiteEnv('acme', { home: '/h', env: { ACME_COOKIE: 'c=3', OTHER: 'no' }, exists: (p) => p in files, read: (p) => files[p] });
    expect(env).toEqual({ COOKIE: 'c=3', AUTHORIZATION: 'Bearer x' });
  });
  it('is empty without a file', () => {
    expect(readSiteEnv('none', { home: '/h', env: {}, exists: () => false })).toEqual({});
  });
});

describe('siteFetch', () => {
  const ok = (body, status = 200) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

  it('builds the url, sends secrets and extra headers, parses JSON', async () => {
    const f = vi.fn(async () => ok({ a: 1 }));
    const api = siteFetch({ base: 'https://s.com', env: { COOKIE: 'k=v', X_KEY: 'abc' }, headers: (e) => ({ 'x-api-key': e.X_KEY }), fetch: f, minGap: 0 });
    expect(await api.get('/api/list', { q: 'ford', page: 2, skip: null })).toEqual({ a: 1 });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe('https://s.com/api/list?q=ford&page=2');
    expect(init.headers.cookie).toBe('k=v');
    expect(init.headers['x-api-key']).toBe('abc');
    await api.post('/api/x', { b: 2 });
    expect(f.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{"b":2}' });
    expect(f.mock.calls[1][1].headers['content-type']).toBe('application/json');
  });

  it('waits minGap between calls, even when fired together', async () => {
    let t = 1000;
    const sleep = vi.fn(async (ms) => { t += ms; });
    const api = siteFetch({ base: 'https://s.com', env: {}, fetch: async () => ok([]), minGap: 1000, sleep, now: () => t });
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.every(([ms]) => ms === 1000)).toBe(true);
  });

  it('marks 401/403 and HTML pages as expired', async () => {
    const api = (res) => siteFetch({ base: 'https://s.com', site: 'acme', env: {}, fetch: async () => res, minGap: 0 });
    await expect(api(ok('nope', 403)).get('/x')).rejects.toMatchObject({ name: 'SiteApiError', status: 403, expired: true });
    await expect(api(ok('<html>login</html>')).get('/x')).rejects.toMatchObject({ expired: true });
    const e = await api(ok('boom', 500)).get('/x').catch((x) => x);
    expect(e).toBeInstanceOf(SiteApiError);
    expect(e.expired).toBe(false);
    expect(e.message).toContain('acme: HTTP 500');
  });
});

describe('analyzeHar', () => {
  const har = { log: { entries: [
    entry('https://www.shop.com/inventory', '<html><script id="__NEXT_DATA__" type="application/json">{"cars":[{"m":"Ford F-150"}]}</script></html>', { mime: 'text/html' }),
    entry('https://www.google-analytics.com/collect', { ok: 1 }),
    entry('https://www.shop.com/app.js', 'x', { mime: 'application/javascript' }),
    entry('https://api.shop.com/v1/cars?page=1', { items: [{ id: 1, make: 'Ford', model: 'F-150' }, { id: 2, make: 'GMC' }] }, { headers: [{ name: 'Cookie', value: 's=secret' }, { name: 'Accept', value: '*/*' }] }),
    entry('https://api.shop.com/v1/cars/1FTFW1R66DFB29398', { id: 1, make: 'Ford' }),
    entry('https://api.shop.com/v1/cars/1GCEK19J78Z123456', { id: 2, make: 'GMC', long: 'x'.repeat(50) }),
    entry('https://api.shop.com/graphql', { data: { x: 1 } }, { method: 'POST', post: '{"operationName":"Dealer","variables":{}}' }),
    entry('https://api.shop.com/v1/fail', { error: 1 }, { status: 500 }),
  ] } };

  it('ranks the endpoint holding the found text first, skips noise and static files', () => {
    const r = analyzeHar(har, { find: ['F-150'] });
    expect(r.pageHost).toBe('www.shop.com');
    expect(r.endpoints[0].endpoint).toBe('GET api.shop.com/v1/cars');
    expect(r.endpoints[0].found).toEqual(['f-150']);
    expect(r.endpoints[0].queryKeys).toEqual(['page']);
    expect(r.endpoints[0].authHeaders).toEqual(['cookie']);
    expect(r.endpoints[0].request.headers.Cookie).toBe('s=secret');
    expect(r.endpoints.map((e) => e.endpoint)).not.toContain('GET www.google-analytics.com/collect');
    expect(r.endpoints.at(-1).endpoint).toBe('GET api.shop.com/v1/fail');
  });

  it('groups ids (VINs) into one endpoint, keeps the richest example, labels GraphQL ops', () => {
    const r = analyzeHar(har);
    const detail = r.endpoints.find((e) => e.endpoint === 'GET api.shop.com/v1/cars/{id}');
    expect(detail.calls).toBe(2);
    expect(detail.sample.make).toBe('GMC');
    expect(r.endpoints.some((e) => e.endpoint === 'POST api.shop.com/graphql [gql:Dealer]')).toBe(true);
  });

  it('reports JSON embedded in the HTML', () => {
    const r = analyzeHar(har, { find: ['f-150'] });
    expect(r.embedded).toEqual([expect.objectContaining({ kind: '__NEXT_DATA__', found: ['f-150'] })]);
  });

  it('copes with an empty HAR', () => {
    expect(analyzeHar({})).toEqual({ pageHost: '', endpoints: [], embedded: [] });
  });
});

describe('helpers', () => {
  it('normPath replaces numbers, uuids and VINs', () => {
    expect(normPath('/a/123/b/0f8fad5b-d9cb-469f-a165-70867728950e/1FTFW1R66DFB29398/new')).toBe('/a/{id}/b/{id}/{id}/new');
  });
  it('jsonShape summarises structure', () => {
    expect(jsonShape([{ a: 1, b: 'x', c: { d: { e: 1 } } }])).toEqual(['1 items', { a: 'number', b: 'string', c: '{1 keys}' }]);
  });
});

describe('probeRequest', () => {
  it('finds the least headers that still return JSON', async () => {
    const f = vi.fn(async (url, { headers }) => (Object.keys(headers).some((k) => k.toLowerCase() === 'cookie')
      ? { status: 200, text: async () => '{"ok":1}' }
      : { status: 401, text: async () => '<html>sign in</html>' }));
    const r = await probeRequest({ method: 'GET', url: 'https://s.com/api', headers: { Cookie: 'x', 'User-Agent': 'u', 'X-Token': 't', 'Accept-Encoding': 'gzip' } }, { fetch: f });
    expect(r.levels.map((l) => [l.name, l.status, l.json])).toEqual([
      ['none', 401, false], ['browser headers', 401, false], ['+ cookies', 200, true], ['full captured', 200, true],
    ]);
    expect(r.minimum).toBe('+ cookies');
    expect(r.extraHeaders).toEqual(['X-Token']);
    expect(f.mock.calls[3][1].headers).not.toHaveProperty('Accept-Encoding');
  });
});

describe('captureHar', () => {
  function fakePage(responses) {
    const handlers = {};
    return {
      on: (ev, fn) => { handlers[ev] = fn; },
      goto: vi.fn(async () => { for (const r of responses) handlers.response?.(r); }),
      waitForTimeout: vi.fn(async () => {}),
      mouse: { wheel: vi.fn(async () => {}) },
      close: vi.fn(async () => {}),
    };
  }
  const res = (url, type, mime, text) => ({
    request: () => ({ resourceType: () => type, method: () => 'GET', url: () => url, allHeaders: async () => ({ cookie: 'c' }), headers: () => ({}), postData: () => null }),
    headers: () => ({ 'content-type': mime }), status: () => 200, text: async () => text,
  });

  it('records xhr/document traffic from a new tab in the automation Chrome, then closes only that tab', async () => {
    const page = fakePage([res('https://s.com/api/x', 'xhr', 'application/json', '{"a":1}'), res('https://s.com/i.png', 'image', 'image/png', '')]);
    const browser = { close: vi.fn(async () => {}) };
    const context = { newPage: async () => page };
    browser.contexts = () => [context];
    const importer = async () => ({ chromium: { connectOverCDP: async () => browser } });
    const har = await captureHar('https://s.com', { chrome: true, importer, scroll: 1 });
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0]).toMatchObject({ request: { url: 'https://s.com/api/x', headers: [{ name: 'cookie', value: 'c' }] }, response: { status: 200, content: { text: '{"a":1}' } } });
    expect(page.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it('launches installed Chrome first for a fresh capture', async () => {
    const page = fakePage([]);
    const launch = vi.fn(async () => ({ newContext: async () => ({ newPage: async () => page }), close: vi.fn(async () => {}) }));
    await captureHar('https://s.com', { importer: async () => ({ chromium: { launch } }), scroll: 0 });
    expect(launch.mock.calls[0][0]).toMatchObject({ headless: true, channel: 'chrome' });
  });
});
