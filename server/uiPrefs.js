/*
 * Saved screen choices per signed-in person (columns, list filters, sidebar),
 * the server half of useSavedPref / useSavedFilters / useColumnOrder.
 *
 *   app.use('/api/ui-prefs', requireAuth, uiPrefsRouter({ store, userId: (req) => req.user.id }));
 *
 *   GET /:key -> { key, value }   value null when nothing is saved
 *   PUT /:key { value }           value null deletes
 *
 * Mount it after express.json(). Each person only reads and writes their own (userId(req)); no userId -> 401.
 * Values are layout, never data. A store is any object with:
 *   get(userId, key)         -> value | null
 *   set(userId, key, value)  -> void      value null deletes
 * Throw an error with status 400 from set to refuse (e.g. too many keys).
 *
 * Lifted from AutoDealer's routes/uiPrefs.js and TuroApp's routes/ui-prefs.js.
 */
import express from 'express';

/** Letters, digits, dot, dash, underscore; starts with a letter or digit; up to 100 long. */
export const UI_PREF_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Express router for saved UI choices.
 *   store        { get, set } (required)
 *   userId       (req) -> id of the signed-in person (default req.user?.id)
 *   keyPattern   RegExp (or anything with test(key)) a key must match (UI_PREF_KEY)
 *   maxBytes     largest stored JSON per key (16 KB)
 *   objectsOnly  refuse strings, numbers and booleans (false)
 *   onError      (err, req) -> void, for logging 500s (console.error)
 */
export function uiPrefsRouter({
  store,
  userId = (req) => req.user?.id,
  keyPattern = UI_PREF_KEY,
  maxBytes = 16 * 1024,
  objectsOnly = false,
  onError = (err) => console.error('[ui-prefs]', err),
} = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new Error('uiPrefsRouter needs a store with get(userId, key) and set(userId, key, value)');
  }
  const router = express.Router();
  const fail = (err, req, res) => {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    try { onError(err, req); } catch { /* a broken logger must not hang the request */ }
    res.status(500).json({ error: 'Could not reach saved settings' });
  };

  router.use('/:key', (req, res, next) => {
    const id = userId(req);
    if (id == null || id === '') return res.status(401).json({ error: 'Sign in first' });
    if (!keyPattern.test(req.params.key)) return res.status(400).json({ error: 'Bad setting name' });
    req.uiPrefUser = id;
    next();
  });

  router.get('/:key', async (req, res) => {
    try {
      const value = await store.get(req.uiPrefUser, req.params.key);
      res.json({ key: req.params.key, value: value ?? null });
    } catch (err) { fail(err, req, res); }
  });

  router.put('/:key', async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || !('value' in req.body)) {
      return res.status(400).json({ error: 'Send { value }' });
    }
    const { key } = req.params;
    const value = req.body.value ?? null;
    if (value !== null && objectsOnly && typeof value !== 'object') {
      return res.status(400).json({ error: 'value must be an object, an array or null' });
    }
    if (value !== null && Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) {
      return res.status(413).json({ error: `Setting is too large (max ${Math.floor(maxBytes / 1024)} KB)` });
    }
    try {
      await store.set(req.uiPrefUser, key, value);
      res.json({ key, value });
    } catch (err) { fail(err, req, res); }
  });

  return router;
}

/** In-memory store, for tests and prototypes. */
export function memoryUiPrefStore() {
  const rows = new Map();
  const id = (userId, key) => `${userId}\u0000${key}`;
  return {
    rows,
    async get(userId, key) { return rows.has(id(userId, key)) ? structuredClone(rows.get(id(userId, key))) : null; },
    async set(userId, key, value) {
      if (value == null) rows.delete(id(userId, key));
      else rows.set(id(userId, key), structuredClone(value));
    },
  };
}

const IDENT = /^[a-z_][a-z0-9_]*$/i;
const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return name;
};

/** Postgres SQL for the ui_prefs table (idempotent). */
export function uiPrefSchemaSql({ table = 'ui_prefs' } = {}) {
  const t = ident(table);
  return `
CREATE TABLE IF NOT EXISTS ${t} (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);`;
}

/** Postgres store on a pg Pool: one row per person and key (run uiPrefSchemaSql once). */
export function pgUiPrefStore(pool, { table = 'ui_prefs' } = {}) {
  const t = ident(table);
  return {
    async get(userId, key) {
      const { rows } = await pool.query(`SELECT value FROM ${t} WHERE user_id = $1 AND key = $2`, [String(userId), key]);
      return rows[0]?.value ?? null;
    },
    async set(userId, key, value) {
      if (value == null) {
        await pool.query(`DELETE FROM ${t} WHERE user_id = $1 AND key = $2`, [String(userId), key]);
        return;
      }
      // Stringify: pg sends a JS array as a Postgres array literal, not JSON.
      await pool.query(
        `INSERT INTO ${t} (user_id, key, value) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = now()`,
        [String(userId), key, JSON.stringify(value)],
      );
    },
  };
}
