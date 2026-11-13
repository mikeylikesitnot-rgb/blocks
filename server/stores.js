/*
 * User stores for createAuth. A store is any object with:
 *   findUser(email)                 -> { id, email, passwordHash, role, tokenVersion } | null   (case-insensitive)
 *   bumpTokenVersion(email, tv)     -> void   only if the row is still at tv (logout / password change)
 *   setPassword(email, hash)        -> void   optional; enables POST /password
 * An app with its own users table writes these three functions against it.
 */

/** In-memory users, for tests and prototypes. */
export function memoryUserStore(users = []) {
  const rows = users.map((u, i) => ({ id: u.id ?? i + 1, role: 'user', tokenVersion: 0, passwordHash: null, ...u }));
  const find = (email) => rows.find((r) => r.email.toLowerCase() === String(email).toLowerCase()) || null;
  return {
    rows,
    async findUser(email) { const r = find(email); return r && { ...r }; },
    async bumpTokenVersion(email, tv) { const r = find(email); if (r && r.tokenVersion === tv) r.tokenVersion += 1; },
    async setPassword(email, hash) { const r = find(email); if (r) r.passwordHash = hash; },
  };
}

const IDENT = /^[a-z_][a-z0-9_]*$/i;
const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return name;
};

/**
 * Postgres SQL for a new app. Run once (it is idempotent).
 *   await pool.query(authSchemaSql());
 */
export function authSchemaSql({ users = 'users', codes = 'login_codes' } = {}) {
  const u = ident(users);
  const c = ident(codes);
  return `
CREATE TABLE IF NOT EXISTS ${u} (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT,
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ${u}_email_lower ON ${u} (LOWER(email));
CREATE TABLE IF NOT EXISTS ${c} (
  id         SERIAL PRIMARY KEY,
  key        TEXT NOT NULL,
  hash       TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  used_at    BIGINT,
  attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ${c}_key_created ON ${c} (key, created_at DESC);
`;
}

/** createAuth stores backed by a `pg` Pool and the tables from authSchemaSql(). */
export function pgStores(pool, { users = 'users', codes = 'login_codes' } = {}) {
  const u = ident(users);
  const c = ident(codes);
  const toUser = (r) => r && {
    id: r.id, email: r.email, name: r.name ?? null, passwordHash: r.password_hash,
    role: r.role, tokenVersion: Number(r.token_version),
  };
  const toCode = (r) => ({
    id: r.id, hash: r.hash, expiresAt: Number(r.expires_at),
    usedAt: r.used_at == null ? null : Number(r.used_at), attempts: Number(r.attempts),
  });
  return {
    userStore: {
      async findUser(email) {
        const { rows } = await pool.query(`SELECT * FROM ${u} WHERE LOWER(email) = LOWER($1)`, [email]);
        return toUser(rows[0]) || null;
      },
      async bumpTokenVersion(email, tv) {
        await pool.query(`UPDATE ${u} SET token_version = token_version + 1 WHERE LOWER(email) = LOWER($1) AND token_version = $2`, [email, tv]);
      },
      async setPassword(email, hash) {
        await pool.query(`UPDATE ${u} SET password_hash = $2 WHERE LOWER(email) = LOWER($1)`, [email, hash]);
      },
    },
    codeStore: {
      async insert({ key, hash, expiresAt, createdAt }) {
        await pool.query(`INSERT INTO ${c} (key, hash, expires_at, created_at) VALUES ($1, $2, $3, $4)`, [key, hash, expiresAt, createdAt]);
      },
      async recent(key, sinceMs) {
        const { rows } = await pool.query(
          `SELECT * FROM ${c} WHERE key = $1 AND created_at > $2 ORDER BY created_at DESC, id DESC`,
          [key, Date.now() - sinceMs],
        );
        return rows.map(toCode);
      },
      async addAttempt(id) { await pool.query(`UPDATE ${c} SET attempts = attempts + 1 WHERE id = $1`, [id]); },
      async markUsed(id) {
        const { rows } = await pool.query(`UPDATE ${c} SET used_at = $2 WHERE id = $1 AND used_at IS NULL RETURNING id`, [id, Date.now()]);
        return rows.length === 1;
      },
      async prune(before) { await pool.query(`DELETE FROM ${c} WHERE created_at < $1`, [before]); },
    },
  };
}
