// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createAuth, memoryUserStore, hashPassword, renderEmail, loginCodeEmail, encrypt, decrypt, authSchemaSql, pgStores,
} from '../server/index.js';

const SECRET = 'x'.repeat(40);

function setup(opts = {}) {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return {}; }, sendQuietly: (m) => sent.push(m) };
  return hashPassword('correct horse').then((hash) => {
    const users = memoryUserStore([
      { email: 'ana@example.com', name: 'Ana', passwordHash: hash, role: 'admin' },
      { email: 'ben@example.com', role: 'user' },
    ]);
    const auth = createAuth({ secret: SECRET, users, mailer, rateLimits: false, brand: { appName: 'Test' }, ...opts });
    const app = express();
    app.use('/api/auth', auth.router);
    app.get('/api/private', auth.requireAuth, (req, res) => res.json({ user: req.user }));
    app.get('/api/admin', auth.requireAuth, auth.requireRole('admin'), (_req, res) => res.json({ ok: true }));
    app.get('/api/maybe', auth.optionalAuth, (req, res) => res.json({ user: req.user ?? null }));
    return { app, users, sent, auth };
  });
}

const cookieOf = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('session='))?.split(';')[0];

describe('password sign-in', () => {
  let ctx;
  beforeEach(async () => { ctx = await setup(); });

  it('signs in, sets an httpOnly cookie, and /me returns the user', async () => {
    const res = await request(ctx.app).post('/api/auth/login').send({ email: 'ANA@example.com ', password: 'correct horse' });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 1, email: 'ana@example.com', name: 'Ana', role: 'admin' });
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    const me = await request(ctx.app).get('/api/auth/me').set('Cookie', cookieOf(res));
    expect(me.body.user.email).toBe('ana@example.com');
  });

  it('rejects a wrong password, an unknown email, and a user with no password the same way', async () => {
    for (const body of [
      { email: 'ana@example.com', password: 'nope' },
      { email: 'nobody@example.com', password: 'correct horse' },
      { email: 'ben@example.com', password: 'anything' },
    ]) {
      const res = await request(ctx.app).post('/api/auth/login').send(body);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Wrong email or password');
    }
  });

  it('401 without a session; 403 for the wrong role', async () => {
    expect((await request(ctx.app).get('/api/private')).status).toBe(401);
    ctx.users.rows[0].role = 'user';
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'correct horse' });
    expect((await request(ctx.app).get('/api/admin').set('Cookie', cookieOf(login))).status).toBe(403);
  });

  it('a demotion takes effect on the next request', async () => {
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'correct horse' });
    expect((await request(ctx.app).get('/api/admin').set('Cookie', cookieOf(login))).status).toBe(200);
    ctx.users.rows[0].role = 'user';
    expect((await request(ctx.app).get('/api/admin').set('Cookie', cookieOf(login))).status).toBe(403);
  });

  it('logout revokes every copy of the cookie', async () => {
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'correct horse' });
    const other = await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'correct horse' });
    await request(ctx.app).post('/api/auth/logout').set('Cookie', cookieOf(login));
    expect((await request(ctx.app).get('/api/private').set('Cookie', cookieOf(login))).status).toBe(401);
    expect((await request(ctx.app).get('/api/private').set('Cookie', cookieOf(other))).status).toBe(401);
  });

  it('a deleted user loses access immediately', async () => {
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'correct horse' });
    ctx.users.rows.splice(0, 1);
    expect((await request(ctx.app).get('/api/private').set('Cookie', cookieOf(login))).status).toBe(401);
  });

  it('optionalAuth never blocks', async () => {
    expect((await request(ctx.app).get('/api/maybe')).body.user).toBeNull();
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'correct horse' });
    expect((await request(ctx.app).get('/api/maybe').set('Cookie', cookieOf(login))).body.user.email).toBe('ana@example.com');
  });

  it('rejects a forged cookie', async () => {
    const forged = createAuth({ secret: 'y'.repeat(40), users: ctx.users, rateLimits: false });
    const app2 = express();
    app2.use('/a', forged.router);
    const login = await request(app2).post('/a/login').send({ email: 'ana@example.com', password: 'correct horse' });
    expect((await request(ctx.app).get('/api/private').set('Cookie', cookieOf(login))).status).toBe(401);
  });
});

describe('timeouts', () => {
  afterEach(() => vi.useRealTimers());

  it('idle timeout ends the session; background polls do not renew it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const ctx = await setup();
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'correct horse' });
    const c = cookieOf(login);
    vi.setSystemTime(Date.now() + 20 * 60 * 1000);
    const poll = await request(ctx.app).get('/api/private').set('Cookie', c).set('X-Background-Request', '1');
    expect(poll.status).toBe(200);
    expect(cookieOf(poll)).toBeUndefined();
    const real = await request(ctx.app).get('/api/private').set('Cookie', c);
    const renewed = cookieOf(real);
    expect(renewed).toBeTruthy();
    vi.setSystemTime(Date.now() + 25 * 60 * 1000);
    expect((await request(ctx.app).get('/api/private').set('Cookie', c)).status).toBe(401);
    expect((await request(ctx.app).get('/api/private').set('Cookie', renewed)).status).toBe(200);
  });

  it('absolute timeout ends the session however active', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const ctx = await setup({ maxHours: 1 });
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'correct horse' });
    let c = cookieOf(login);
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(Date.now() + 25 * 60 * 1000);
      const r = await request(ctx.app).get('/api/private').set('Cookie', c);
      if (r.status !== 200) { c = null; break; }
      c = cookieOf(r) || c;
    }
    expect(c).toBeNull();
  });
});

describe('email code sign-in', () => {
  let ctx;
  beforeEach(async () => { ctx = await setup(); });
  const codeFrom = (m) => m.text.match(/Code: (\d{6})/)[1];

  it('sends a branded code and signs in with it once', async () => {
    const r = await request(ctx.app).post('/api/auth/code').send({ email: 'ben@example.com' });
    expect(r.body).toEqual({ sent: true });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].subject).toMatch(/^\d{6} is your Test sign-in code$/);
    expect(ctx.sent[0].html).toContain(codeFrom(ctx.sent[0]));
    const code = codeFrom(ctx.sent[0]);
    const ok = await request(ctx.app).post('/api/auth/code/verify').send({ email: 'ben@example.com', code });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe('ben@example.com');
    expect((await request(ctx.app).post('/api/auth/code/verify').send({ email: 'ben@example.com', code })).status).toBe(401);
  });

  it('answers the same for unknown emails and sends nothing', async () => {
    const r = await request(ctx.app).post('/api/auth/code').send({ email: 'stranger@example.com' });
    expect(r.body).toEqual({ sent: true });
    expect(ctx.sent).toHaveLength(0);
  });

  it('kills a code after 5 wrong guesses and caps codes per address', async () => {
    await request(ctx.app).post('/api/auth/code').send({ email: 'ben@example.com' });
    const code = codeFrom(ctx.sent[0]);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await request(ctx.app).post('/api/auth/code/verify').send({ email: 'ben@example.com', code: wrong });
    expect((await request(ctx.app).post('/api/auth/code/verify').send({ email: 'ben@example.com', code })).status).toBe(401);
    await request(ctx.app).post('/api/auth/code').send({ email: 'ben@example.com' });
    await request(ctx.app).post('/api/auth/code').send({ email: 'ben@example.com' });
    await request(ctx.app).post('/api/auth/code').send({ email: 'ben@example.com' });
    expect(ctx.sent).toHaveLength(3);
  });

  it('a code sign-in can set a password without the old one (reset), and other sessions end', async () => {
    const pw = await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'correct horse' });
    expect((await request(ctx.app).post('/api/auth/password').set('Cookie', cookieOf(pw)).send({ password: 'new password 1' })).status).toBe(401);
    await request(ctx.app).post('/api/auth/code').send({ email: 'ana@example.com' });
    const v = await request(ctx.app).post('/api/auth/code/verify').send({ email: 'ana@example.com', code: codeFrom(ctx.sent[0]) });
    const set = await request(ctx.app).post('/api/auth/password').set('Cookie', cookieOf(v)).send({ password: 'new password 1' });
    expect(set.status).toBe(200);
    expect(ctx.sent.at(-1).subject).toBe('Your password was changed');
    expect((await request(ctx.app).get('/api/private').set('Cookie', cookieOf(pw))).status).toBe(401);
    expect((await request(ctx.app).get('/api/private').set('Cookie', cookieOf(set))).status).toBe(200);
    expect((await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'new password 1' })).status).toBe(200);
  });

  it('password change with the current password; rejects short ones', async () => {
    const pw = await request(ctx.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'correct horse' });
    expect((await request(ctx.app).post('/api/auth/password').set('Cookie', cookieOf(pw)).send({ password: 'short' })).status).toBe(400);
    const ok = await request(ctx.app).post('/api/auth/password').set('Cookie', cookieOf(pw)).send({ currentPassword: 'correct horse', password: 'another long one' });
    expect(ok.status).toBe(200);
  });
});

describe('google sign-in', () => {
  it('lets in existing users only, unless signup is on', async () => {
    const verify = async (cred) => ({ email: cred, email_verified: true, name: 'G' });
    const ctx = await setup({ google: { clientId: 'cid', verify } });
    expect((await request(ctx.app).get('/api/auth/config')).body).toEqual({ password: true, code: true, google: 'cid', signup: false });
    expect((await request(ctx.app).post('/api/auth/google').send({ credential: 'ben@example.com' })).status).toBe(200);
    expect((await request(ctx.app).post('/api/auth/google').send({ credential: 'new@example.com' })).status).toBe(403);

    const users = memoryUserStore([]);
    users.createUser = async (email, { name }) => { users.rows.push({ id: 9, email, name, role: 'user', tokenVersion: 0 }); return users.findUser(email); };
    const auth = createAuth({ secret: SECRET, users, google: { clientId: 'cid', verify }, signup: true, rateLimits: false });
    const app = express();
    app.use('/a', auth.router);
    const r = await request(app).post('/a/google').send({ credential: 'new@example.com' });
    expect(r.body.user).toEqual({ id: 9, email: 'new@example.com', name: 'G', role: 'user' });
  });

  it('rejects an unverified email and a bad credential', async () => {
    const ctx = await setup({ google: { clientId: 'cid', verify: async (c) => { if (c === 'bad') throw new Error('x'); return { email: 'ben@example.com', email_verified: false }; } } });
    expect((await request(ctx.app).post('/api/auth/google').send({ credential: 'bad' })).status).toBe(401);
    expect((await request(ctx.app).post('/api/auth/google').send({ credential: 'ok' })).status).toBe(401);
  });
});

describe('config guards', () => {
  it('refuses a short secret and a store without the required methods', () => {
    expect(() => createAuth({ secret: 'short', users: memoryUserStore() })).toThrow(/32 characters/);
    expect(() => createAuth({ secret: SECRET, users: {} })).toThrow(/findUser/);
  });
});

describe('email templates', () => {
  it('escapes everything and refuses non-http links', () => {
    const m = renderEmail({
      brand: { appName: '<b>App</b>', color: 'red;}', logoUrl: 'javascript:alert(1)' },
      title: '<script>x</script>', paragraphs: ['a & b'], button: { label: 'Go', url: 'javascript:alert(1)' },
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('a &amp; b');
    expect(m.html).not.toContain('javascript:');
    expect(m.html).not.toContain('red;}');
  });
  it('login code email has text and html', () => {
    const m = loginCodeEmail({ brand: { appName: 'X' }, code: '123456' });
    expect(m.text).toContain('Code: 123456');
    expect(m.html).toContain('123456');
  });
});

describe('crypto and schema', () => {
  it('round-trips and fails with the wrong secret', () => {
    const blob = encrypt('smtp-pass', SECRET);
    expect(decrypt(blob, SECRET)).toBe('smtp-pass');
    expect(() => decrypt(blob, 'z'.repeat(40))).toThrow();
  });
  it('refuses unsafe table names', () => {
    expect(() => authSchemaSql({ users: 'users; drop table x' })).toThrow();
    expect(() => pgStores({}, { codes: 'a b' })).toThrow();
    expect(authSchemaSql()).toContain('CREATE TABLE IF NOT EXISTS users');
  });
});
