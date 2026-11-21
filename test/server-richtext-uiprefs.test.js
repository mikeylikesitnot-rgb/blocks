import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  sanitizeRich, cleanRich, isBlankRich, richToPlain, NOTE_TAGS, MAX_RICH_LENGTH,
  uiPrefsRouter, memoryUiPrefStore, pgUiPrefStore, uiPrefSchemaSql,
} from '../server/index.js';
import * as richtextOnly from '../server/richText.js';
import * as prefsOnly from '../server/uiPrefs.js';

describe('sanitizeRich', () => {
  it('drops script, handlers, styles and images, keeps the text', () => {
    const out = sanitizeRich('<p style="color:red" onclick="x()">Hi <img src=x onerror=alert(1)><script>alert(1)</script><b>there</b></p>');
    expect(out).toBe('<p>Hi <strong>there</strong></p>');
  });
  it('allows only safe link schemes and forces rel/target', () => {
    expect(sanitizeRich('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer" target="_blank">x</a>');
    expect(sanitizeRich('<a href="data:text/html,hi">x</a>')).not.toContain('data:');
    expect(sanitizeRich('<a href="https://a.com" onclick="y">x</a>')).toBe('<a href="https://a.com" rel="noopener noreferrer" target="_blank">x</a>');
  });
  it('keeps editor output and writes <br>/<hr> like the editor', () => {
    expect(sanitizeRich('<h2>T</h2><p>a<br />b</p><hr /><pre><code>c</code></pre>')).toBe('<h2>T</h2><p>a<br>b</p><hr><pre><code>c</code></pre>');
  });
  it('NOTE_TAGS unwraps headings and rules', () => {
    expect(sanitizeRich('<h2>T</h2><hr>', { tags: NOTE_TAGS })).toBe('T');
  });
  it('turns old <div> lines into paragraphs', () => {
    expect(sanitizeRich('<div>one</div><div><i>two</i></div>')).toBe('<p>one</p><p><em>two</em></p>');
  });
  it("plainText 'keep' stores plain text exactly, still cleans HTML", () => {
    expect(sanitizeRich('Tom & Jerry, Price<a lot', { plainText: 'keep' })).toBe('Tom & Jerry, Price<a lot');
    expect(sanitizeRich('<p>x</p><script>y</script>', { plainText: 'keep' })).toBe('<p>x</p>');
    expect(sanitizeRich('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });
  it('null and undefined pass through', () => {
    expect(sanitizeRich(null)).toBe(null);
    expect(sanitizeRich(undefined)).toBe(undefined);
  });
});

describe('cleanRich', () => {
  it('blank becomes null', () => {
    for (const v of [null, '', '<p></p>', '<p>&nbsp;</p>', '<script>x</script>']) expect(cleanRich(v)).toEqual({ value: null, tooLong: false });
  });
  it('cleans, trims and flags too long', () => {
    expect(cleanRich('  <p>hi</p> ')).toEqual({ value: '<p>hi</p>', tooLong: false });
    expect(cleanRich(`<p>${'a'.repeat(MAX_RICH_LENGTH)}</p>`).tooLong).toBe(true);
    expect(cleanRich('<p>abcdef</p>', { maxLength: 5 }).tooLong).toBe(true);
  });
  it('helpers', () => {
    expect(isBlankRich('<p> </p>')).toBe(true);
    expect(richToPlain('<p>a &amp; b</p><ul><li>c</li></ul>')).toBe('a & b c');
  });
  it('the /server/richtext entry has the same pieces', () => {
    expect(richtextOnly.cleanRich).toBe(cleanRich);
  });
});

function app(opts = {}) {
  const store = opts.store || memoryUiPrefStore();
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { if (req.headers['x-user']) req.user = { id: req.headers['x-user'] }; next(); });
  a.use('/api/ui-prefs', uiPrefsRouter({ store, onError: () => {}, ...opts, store }));
  return { a, store };
}

describe('uiPrefsRouter', () => {
  it('saves, reads back per person, and deletes with null', async () => {
    const { a } = app();
    expect((await request(a).get('/api/ui-prefs/cols.leads').set('x-user', '1')).body).toEqual({ key: 'cols.leads', value: null });
    await request(a).put('/api/ui-prefs/cols.leads').set('x-user', '1').send({ value: { order: ['a', 'b'] } }).expect(200, { key: 'cols.leads', value: { order: ['a', 'b'] } });
    expect((await request(a).get('/api/ui-prefs/cols.leads').set('x-user', '1')).body.value).toEqual({ order: ['a', 'b'] });
    expect((await request(a).get('/api/ui-prefs/cols.leads').set('x-user', '2')).body.value).toBe(null);
    await request(a).put('/api/ui-prefs/cols.leads').set('x-user', '1').send({ value: null }).expect(200);
    expect((await request(a).get('/api/ui-prefs/cols.leads').set('x-user', '1')).body.value).toBe(null);
  });
  it('401 without a user, 400 for a bad key or missing value, 413 when too large', async () => {
    const { a } = app({ maxBytes: 50 });
    await request(a).get('/api/ui-prefs/x').expect(401);
    await request(a).get('/api/ui-prefs/..bad').set('x-user', '1').expect(400);
    await request(a).put('/api/ui-prefs/x').set('x-user', '1').send({}).expect(400);
    await request(a).put('/api/ui-prefs/x').set('x-user', '1').send({ value: 'y'.repeat(100) }).expect(413);
  });
  it('objectsOnly refuses scalars; a custom keyPattern applies', async () => {
    const { a } = app({ objectsOnly: true, keyPattern: /^[a-z]+$/ });
    await request(a).put('/api/ui-prefs/x').set('x-user', '1').send({ value: 3 }).expect(400);
    await request(a).put('/api/ui-prefs/x').set('x-user', '1').send({ value: [1] }).expect(200);
    await request(a).get('/api/ui-prefs/X1').set('x-user', '1').expect(400);
  });
  it('a store error with status 400 is passed on; others are 500 and logged', async () => {
    const onError = vi.fn();
    const store = { get: async () => { throw new Error('db down'); }, set: async () => { throw Object.assign(new Error('Too many saved settings'), { status: 400 }); } };
    const { a } = app({ store, onError });
    const r = await request(a).put('/api/ui-prefs/x').set('x-user', '1').send({ value: {} });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Too many saved settings');
    const g = await request(a).get('/api/ui-prefs/x').set('x-user', '1');
    expect(g.status).toBe(500);
    expect(g.body.error).not.toContain('db down');
    expect(onError).toHaveBeenCalledOnce();
  });
  it('custom userId', async () => {
    const store = memoryUiPrefStore();
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.admin = { id: 7 }; next(); });
    a.use('/p', uiPrefsRouter({ store, userId: (req) => req.admin?.id }));
    await request(a).put('/p/k').send({ value: { a: 1 } }).expect(200);
    expect(await store.get(7, 'k')).toEqual({ a: 1 });
  });
  it('needs a store', () => {
    expect(() => uiPrefsRouter({})).toThrow(/store/);
    expect(prefsOnly.uiPrefsRouter).toBe(uiPrefsRouter);
  });
});

describe('pgUiPrefStore', () => {
  it('sends JSON text and the right statements', async () => {
    const calls = [];
    const pool = { query: async (sql, params) => { calls.push([sql, params]); return { rows: sql.startsWith('SELECT') ? [{ value: { a: 1 } }] : [] }; } };
    const s = pgUiPrefStore(pool, { table: 'prefs' });
    expect(await s.get(3, 'k')).toEqual({ a: 1 });
    await s.set(3, 'k', ['x']);
    await s.set(3, 'k', null);
    expect(calls[0][1]).toEqual(['3', 'k']);
    expect(calls[1][0]).toMatch(/INSERT INTO prefs .*ON CONFLICT/s);
    expect(calls[1][1]).toEqual(['3', 'k', '["x"]']);
    expect(calls[2][0]).toMatch(/^DELETE FROM prefs/);
    expect(uiPrefSchemaSql({ table: 'prefs' })).toMatch(/CREATE TABLE IF NOT EXISTS prefs/);
    expect(() => pgUiPrefStore(pool, { table: 'x; drop' })).toThrow();
  });
});
