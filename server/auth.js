import express from 'express';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { createCodes, memoryCodeStore, CODE_TTL_MS } from './codes.js';
import { createLimiter } from './rateLimit.js';
import { loginCodeEmail, passwordChangedEmail } from './email.js';

/*
 * Sign-in for an Express app, ported from AutoDealer (docs/decisions/auth.md
 * there) and made app-agnostic.
 *
 *   const auth = createAuth({ secret: process.env.SESSION_SECRET, users: store, mailer, brand,
 *                             google: { clientId: process.env.GOOGLE_CLIENT_ID } });
 *   app.use('/api/auth', auth.router);
 *   app.get('/api/things', auth.requireAuth, handler);          // req.user = { id, email, name, role }
 *   app.delete('/api/things/:id', auth.requireAuth, auth.requireRole('admin'), handler);
 *
 * Rules that carry over from AutoDealer, all load-bearing:
 *   - Session = a JWT in an httpOnly cookie, never in localStorage.
 *   - Idle timeout (30 min): every real request re-issues the cookie; a
 *     request with the X-Background-Request header (polling) does not renew,
 *     so an unattended tab still times out.
 *   - Absolute timeout (8 h) counted from sign-in, however active.
 *   - Logout bumps the user's token_version, ending every session on every
 *     device; a deleted user loses access on their next request.
 *   - Google proves who someone is, not that they may get in: the email must
 *     already be a user unless `signup` is on.
 *   - Role is read from the store per request, so a demotion is immediate.
 */

const BACKGROUND_HEADER = 'x-background-request';
// Lets a password be set without the old one shortly after an email-code
// sign-in: that is the "forgot password" flow.
const RESET_WINDOW_SEC = 15 * 60;
// Compared against when the email is unknown, so a wrong email and a wrong
// password take the same time.
const DUMMY_HASH = bcrypt.hashSync('mn-kit-timing-equaliser', 10);
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

const nowSec = () => Math.floor(Date.now() / 1000);
const normEmail = (e) => String(e ?? '').trim().toLowerCase();
const looksLikeEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function readCookie(req, name) {
  if (req.cookies?.[name] !== undefined) return req.cookies[name];
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export const hashPassword = (password) => bcrypt.hash(String(password), 12);

export function createAuth(options) {
  const {
    secret,
    users,
    cookieName = 'session',
    idleMinutes = 30,
    maxHours = 8,
    secureCookie = process.env.NODE_ENV === 'production',
    google = null,
    mailer = null,
    brand = {},
    codeStore = memoryCodeStore(),
    signup = false,
    minPasswordLength = 8,
    rateLimits = true,
    publicUser = (u) => ({ id: u.id, email: u.email, name: u.name ?? null, role: u.role ?? 'user' }),
    logger = console,
  } = options || {};

  if (!secret || String(secret).length < 32) throw new Error('createAuth: `secret` must be at least 32 characters');
  if (!users?.findUser || !users?.bumpTokenVersion) throw new Error('createAuth: `users` needs findUser and bumpTokenVersion');
  if (signup && !users.createUser) throw new Error('createAuth: `signup` needs users.createUser(email, { name })');

  const key = new TextEncoder().encode(secret);
  const IDLE = idleMinutes * 60;
  const MAX = maxHours * 60 * 60;
  const codes = createCodes(codeStore, secret);
  const googleVerify = google?.clientId ? (google.verify || makeGoogleVerifier(google.clientId)) : null;

  // ── tokens and cookies ──
  async function sign({ email, tv, loginAt, via }) {
    const remaining = loginAt + MAX - nowSec();
    return new SignJWT({ tv, loginAt, via })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(email)
      .setIssuedAt()
      .setExpirationTime(nowSec() + Math.max(1, Math.min(IDLE, remaining)))
      .sign(key);
  }

  // Replaces a session cookie already set on this response (requireAuth's
  // renewal, then a password change's fresh session) instead of sending two.
  function setCookie(res, token) {
    const prior = [].concat(res.getHeader('Set-Cookie') ?? []);
    const kept = prior.filter((c) => !String(c).startsWith(`${cookieName}=`));
    if (kept.length !== prior.length) res.setHeader('Set-Cookie', kept);
    res.cookie(cookieName, token, { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: IDLE * 1000, path: '/' });
  }

  function clearCookie(res) {
    res.clearCookie(cookieName, { path: '/' });
  }

  async function startSession(res, user, via) {
    const token = await sign({ email: user.email, tv: Number(user.tokenVersion ?? 0), loginAt: nowSec(), via });
    setCookie(res, token);
    return publicUser(user);
  }

  /** The live session's { claims, user }, or null. */
  async function readSession(req) {
    const token = readCookie(req, cookieName);
    if (!token) return null;
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(token, key, { algorithms: ['HS256'] }));
    } catch {
      return null;
    }
    if (nowSec() >= claims.loginAt + MAX) return null;
    const user = await users.findUser(claims.sub);
    if (!user || Number(user.tokenVersion ?? 0) !== claims.tv) return null;
    return { claims, user };
  }

  // ── middleware ──
  async function requireAuth(req, res, next) {
    try {
      const session = await readSession(req);
      if (!session) return res.status(401).json({ error: 'Not signed in' });
      req.user = publicUser(session.user);
      req.session = session.claims;
      if (!req.get(BACKGROUND_HEADER)) setCookie(res, await sign({ email: session.user.email, ...pick(session.claims) }));
      next();
    } catch (err) {
      next(err);
    }
  }

  async function optionalAuth(req, res, next) {
    try {
      const session = await readSession(req);
      if (session) {
        req.user = publicUser(session.user);
        req.session = session.claims;
        if (!req.get(BACKGROUND_HEADER)) setCookie(res, await sign({ email: session.user.email, ...pick(session.claims) }));
      }
    } catch (err) {
      logger.warn?.('[blocks auth] session lookup failed:', err?.message || err);
    }
    next();
  }

  const requireRole = (...roles) => (req, res, next) =>
    roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'You don’t have access to this' });

  // ── routes ──
  const router = express.Router();
  router.use(express.json({ limit: '20kb' }));
  const limit = (opts) => (rateLimits ? createLimiter(opts) : (_q, _s, n) => n());
  const loginLimiter = limit({ limit: 10, message: 'Too many sign-in attempts. Please try again later.' });
  const codeLimiter = limit({ limit: 8, message: 'Too many code requests from this device. Please try again later.' });
  const verifyLimiter = limit({ limit: 15, message: 'Too many sign-in attempts. Please try again later.' });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  async function findOrCreate(email, extra) {
    const existing = await users.findUser(email);
    if (existing) return existing;
    if (!signup) return null;
    return users.createUser(email, extra);
  }

  // Which sign-in methods the login page should show.
  router.get('/config', (_req, res) => {
    res.json({ password: true, code: Boolean(mailer), google: google?.clientId || null, signup });
  });

  router.post('/login', loginLimiter, wrap(async (req, res) => {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    const user = email && password ? await users.findUser(email) : null;
    const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) return res.status(401).json({ error: 'Wrong email or password' });
    res.json({ user: await startSession(res, user, 'password') });
  }));

  router.post('/google', loginLimiter, wrap(async (req, res) => {
    if (!googleVerify) return res.status(404).json({ error: 'Google sign-in is not set up' });
    let profile;
    try {
      profile = await googleVerify(String(req.body?.credential ?? ''));
    } catch {
      return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
    }
    if (!profile?.email || profile.email_verified === false) return res.status(401).json({ error: 'That Google account has no verified email' });
    const user = await findOrCreate(normEmail(profile.email), { name: profile.name });
    if (!user) return res.status(403).json({ error: 'This Google account doesn’t have access' });
    res.json({ user: await startSession(res, user, 'google') });
  }));

  // Always answers the same way, so the form can't be used to find out who has an account.
  router.post('/code', codeLimiter, wrap(async (req, res) => {
    if (!mailer) return res.status(404).json({ error: 'Email sign-in is not set up' });
    const email = normEmail(req.body?.email);
    if (!looksLikeEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    const user = signup ? true : await users.findUser(email);
    if (user) {
      const code = await codes.issue(email);
      if (code) {
        try {
          await mailer.send({ to: email, ...loginCodeEmail({ brand, code, minutes: CODE_TTL_MS / 60000 }) });
        } catch (err) {
          logger.error?.('[blocks auth] could not send sign-in code:', err?.message || err);
          return res.status(502).json({ error: 'We couldn’t send the email. Please try again in a minute.' });
        }
      }
    }
    res.json({ sent: true });
  }));

  router.post('/code/verify', verifyLimiter, wrap(async (req, res) => {
    const email = normEmail(req.body?.email);
    if (!email || !(await codes.verify(email, req.body?.code))) {
      return res.status(401).json({ error: 'That code is wrong or has expired' });
    }
    // A sign-up form sends the person's name with the code; it is used only
    // when this sign-in creates the account.
    const name = String(req.body?.name ?? '').trim().slice(0, 100);
    const user = await findOrCreate(email, name ? { name } : {});
    if (!user) return res.status(401).json({ error: 'That code is wrong or has expired' });
    res.json({ user: await startSession(res, user, 'code') });
  }));

  // Set or change the password. The old one is required, except within 15
  // minutes of an email-code sign-in (the "forgot password" path).
  router.post('/password', requireAuth, wrap(async (req, res) => {
    if (!users.setPassword) return res.status(404).json({ error: 'Passwords can’t be changed here' });
    const password = String(req.body?.password ?? '');
    if (password.length < minPasswordLength) return res.status(400).json({ error: `Use at least ${minPasswordLength} characters` });
    const user = await users.findUser(req.user.email);
    const resetting = req.session.via === 'code' && nowSec() - req.session.loginAt < RESET_WINDOW_SEC;
    if (user.passwordHash && !resetting && !(await bcrypt.compare(String(req.body?.currentPassword ?? ''), user.passwordHash))) {
      return res.status(401).json({ error: 'Your current password is wrong' });
    }
    await users.setPassword(user.email, await hashPassword(password));
    await users.bumpTokenVersion(user.email, Number(user.tokenVersion ?? 0));
    const fresh = await users.findUser(user.email);
    const out = await startSession(res, fresh, req.session.via);
    mailer?.sendQuietly?.({ to: user.email, ...passwordChangedEmail({ brand }) });
    res.json({ user: out });
  }));

  // Revokes server-side too, so a copy of the cookie taken earlier stops
  // working. Checks the signature but not expiry: a timed-out session still
  // revokes. Never needs a live session.
  router.post('/logout', wrap(async (req, res) => {
    const token = readCookie(req, cookieName);
    if (token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], currentDate: new Date(0) });
        await users.bumpTokenVersion(payload.sub, payload.tv);
      } catch { /* bad or forged token: just clear the cookie */ }
    }
    clearCookie(res);
    res.json({ ok: true });
  }));

  router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

  return { router, requireAuth, optionalAuth, requireRole, readSession, startSession, hashPassword };
}

const pick = (c) => ({ tv: c.tv, loginAt: c.loginAt, via: c.via });

/** Verifies a Google Sign-In ID token against Google's published keys. */
export function makeGoogleVerifier(clientId) {
  const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return async (credential) => {
    const { payload } = await jwtVerify(credential, jwks, {
      issuer: ['accounts.google.com', 'https://accounts.google.com'],
      audience: clientId,
    });
    return payload;
  };
}
