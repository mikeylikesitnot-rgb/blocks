import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/*
 * One-time sign-in codes (6 digits, emailed). The rules, from AutoDealer's
 * customer portal:
 *   - a code lives 10 minutes and only the newest one counts;
 *   - 5 wrong guesses kill it;
 *   - one address gets at most 3 codes per 15 minutes (every code is an
 *     email to a real person, so this is the cap on using the form to spam);
 *   - only an HMAC of the code is stored, bound to the address.
 *
 * Storage is a small adapter so the same rules run on memory or Postgres:
 *   insert({ key, hash, expiresAt, createdAt }) -> void
 *   recent(key, sinceMs)  -> rows newest first: { id, hash, expiresAt, usedAt, attempts }
 *   addAttempt(id)        -> void
 *   markUsed(id)          -> true if this call used it (false if a racing request did)
 *   prune(beforeMs)       -> void   (optional)
 */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const CODES_PER_WINDOW = 3;
export const WINDOW_MS = 15 * 60 * 1000;

export function createCodes(store, secret) {
  if (!secret) throw new Error('createCodes: secret is required');
  const hash = (key, code) => createHmac('sha256', `${secret}:mn-login-code`).update(`${key}:${code}`).digest('hex');

  return {
    /** A fresh code, or null if this address has had its quota for the window. */
    async issue(key) {
      const now = Date.now();
      await store.prune?.(now - 24 * 60 * 60 * 1000);
      if ((await store.recent(key, WINDOW_MS)).length >= CODES_PER_WINDOW) return null;
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await store.insert({ key, hash: hash(key, code), expiresAt: now + CODE_TTL_MS, createdAt: now });
      return code;
    },

    /** True if `code` is the live code for `key`, consuming it. */
    async verify(key, code) {
      const clean = String(code ?? '').replace(/\D/g, '');
      if (clean.length !== 6) return false;
      const [latest] = await store.recent(key, CODE_TTL_MS);
      if (!latest || latest.usedAt || Number(latest.expiresAt) <= Date.now()) return false;
      if (Number(latest.attempts) >= MAX_ATTEMPTS) return false;
      const a = Buffer.from(latest.hash, 'hex');
      const b = Buffer.from(hash(key, clean), 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        await store.addAttempt(latest.id);
        return false;
      }
      return store.markUsed(latest.id);
    },
  };
}

/** In-memory code storage: fine for one process; codes vanish on restart (they live 10 minutes anyway). */
export function memoryCodeStore() {
  const rows = [];
  let next = 1;
  return {
    async insert(r) { rows.push({ id: next++, ...r, usedAt: null, attempts: 0 }); },
    async recent(key, sinceMs) {
      const since = Date.now() - sinceMs;
      return rows.filter((r) => r.key === key && r.createdAt > since).sort((x, y) => y.createdAt - x.createdAt || y.id - x.id);
    },
    async addAttempt(id) { const r = rows.find((x) => x.id === id); if (r) r.attempts += 1; },
    async markUsed(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.usedAt) return false;
      r.usedAt = Date.now();
      return true;
    },
    async prune(before) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].createdAt < before) rows.splice(i, 1); },
  };
}
