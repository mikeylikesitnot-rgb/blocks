/*
 * Stores for qaRouter. The router checks permissions and input; a store only
 * reads and writes. Both stores return the same shapes:
 *
 *   list item  {id, title, excerpt, tags, authorId, authorName, createdAt, activityAt,
 *               score, answerCount, views, accepted, closed}
 *   question   list item fields + {body, editedAt, acceptedAnswerId, myVote, comments,
 *               answers: [{id, questionId, body, authorId, authorName, createdAt, editedAt,
 *                          score, myVote, accepted, comments}]}   accepted first, then votes
 *   comment    {id, body, authorId, authorName, createdAt}
 * Dates are ISO strings; ids are integers; authorId is a string.
 */

const EXCERPT = 200;
const excerpt = (text) => {
  const t = String(text || '');
  return t.length > EXCERPT ? `${t.slice(0, EXCERPT - 1).trimEnd()}…` : t;
};
const iso = (d) => (d instanceof Date ? d.toISOString() : d == null ? null : new Date(d).toISOString());
const byAnswerOrder = (a, b) => (b.accepted - a.accepted) || (b.score - a.score) || (a.createdAt < b.createdAt ? -1 : 1);

/** In-memory store, for tests, the demo and prototypes. `now` can be faked in tests. */
export function memoryQaStore({ now = () => new Date() } = {}) {
  const db = { questions: [], answers: [], comments: [], votes: new Map(), views: new Set(), seq: 0 };
  const nextId = () => ++db.seq;
  const stamp = () => now().toISOString();
  const findQ = (board, id) => db.questions.find((q) => q.id === id && q.board === board);
  const voteKey = (kind, id, userId) => `${kind}:${id}:${userId}`;
  const myVote = (kind, id, userId) => (userId == null ? 0 : db.votes.get(voteKey(kind, id, userId)) || 0);
  const commentsOf = (kind, id) => db.comments
    .filter((c) => c.kind === kind && c.postId === id)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id))
    .map(({ id: cid, body, authorId, authorName, createdAt }) => ({ id: cid, body, authorId, authorName, createdAt }));
  const answerCount = (qid) => db.answers.filter((a) => a.questionId === qid).length;
  const item = (q) => ({
    id: q.id, title: q.title, excerpt: excerpt(q.bodyText), tags: [...q.tags], authorId: q.authorId, authorName: q.authorName,
    createdAt: q.createdAt, activityAt: q.activityAt, score: q.score, answerCount: answerCount(q.id), views: q.views,
    accepted: q.acceptedAnswerId != null, closed: q.closed,
  });
  const dropVotes = (kind, id) => { for (const k of [...db.votes.keys()]) if (k.startsWith(`${kind}:${id}:`)) db.votes.delete(k); };
  const dropComments = (kind, id) => { db.comments = db.comments.filter((c) => !(c.kind === kind && c.postId === id)); };

  return {
    db,
    async listQuestions(board, { sort = 'active', tags = [], q = '', limit = 20, offset = 0 } = {}) {
      const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
      let rows = db.questions.filter((x) => x.board === board
        && (!tags.length || tags.some((t) => x.tags.includes(t)))
        && words.every((w) => `${x.title} ${x.bodyText}`.toLowerCase().includes(w)));
      if (sort === 'unanswered') rows = rows.filter((x) => answerCount(x.id) === 0);
      const cmp = {
        newest: (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id),
        unanswered: (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id),
        votes: (a, b) => (b.score - a.score) || b.id - a.id,
        active: (a, b) => (a.activityAt < b.activityAt ? 1 : a.activityAt > b.activityAt ? -1 : b.id - a.id),
      }[sort] || (() => 0);
      rows = [...rows].sort(cmp);
      return { items: rows.slice(offset, offset + limit).map(item), total: rows.length };
    },
    async tags(board) {
      const counts = new Map();
      for (const x of db.questions) if (x.board === board) for (const t of x.tags) counts.set(t, (counts.get(t) || 0) + 1);
      return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    },
    async getQuestion(board, id, userId) {
      const q = findQ(board, id);
      if (!q) return null;
      const answers = db.answers.filter((a) => a.questionId === id).map((a) => ({
        id: a.id, questionId: a.questionId, body: a.body, authorId: a.authorId, authorName: a.authorName,
        createdAt: a.createdAt, editedAt: a.editedAt, score: a.score, myVote: myVote('answer', a.id, userId),
        accepted: q.acceptedAnswerId === a.id, comments: commentsOf('answer', a.id),
      })).sort(byAnswerOrder);
      return {
        ...item(q), body: q.body, editedAt: q.editedAt, acceptedAnswerId: q.acceptedAnswerId,
        myVote: myVote('question', id, userId), comments: commentsOf('question', id), answers,
      };
    },
    async createQuestion(board, { title, body, bodyText, tags, authorId, authorName }) {
      const t = stamp();
      const q = { id: nextId(), board, title, body, bodyText, tags: [...tags], authorId, authorName,
        createdAt: t, editedAt: null, activityAt: t, score: 0, views: 0, acceptedAnswerId: null, closed: false };
      db.questions.push(q);
      return q.id;
    },
    async updateQuestion(board, id, { edited, ...patch }) {
      const q = findQ(board, id);
      if (!q) return;
      Object.assign(q, patch);
      if (edited) { q.editedAt = stamp(); q.activityAt = q.editedAt; }
    },
    async deleteQuestion(board, id) {
      if (!findQ(board, id)) return;
      for (const a of db.answers.filter((x) => x.questionId === id)) { dropVotes('answer', a.id); dropComments('answer', a.id); }
      db.answers = db.answers.filter((a) => a.questionId !== id);
      dropVotes('question', id); dropComments('question', id);
      for (const k of [...db.views]) if (k.startsWith(`${id}:`)) db.views.delete(k);
      db.questions = db.questions.filter((q) => q.id !== id);
    },
    async addView(board, id, userId) {
      const k = `${id}:${userId}`;
      const q = findQ(board, id);
      if (!q || db.views.has(k)) return false;
      db.views.add(k);
      q.views += 1;
      return true;
    },
    async getAnswer(board, id) {
      const a = db.answers.find((x) => x.id === id);
      if (!a || !findQ(board, a.questionId)) return null;
      return { id: a.id, questionId: a.questionId, authorId: a.authorId };
    },
    async createAnswer(board, questionId, { body, bodyText, authorId, authorName }) {
      const q = findQ(board, questionId);
      const t = stamp();
      const a = { id: nextId(), questionId, body, bodyText, authorId, authorName, createdAt: t, editedAt: null, score: 0 };
      db.answers.push(a);
      q.activityAt = t;
      return a.id;
    },
    async updateAnswer(board, id, { body, bodyText }) {
      const a = db.answers.find((x) => x.id === id);
      const q = a && findQ(board, a.questionId);
      if (!q) return;
      Object.assign(a, { body, bodyText, editedAt: stamp() });
      q.activityAt = a.editedAt;
    },
    async deleteAnswer(board, id) {
      const a = db.answers.find((x) => x.id === id);
      const q = a && findQ(board, a.questionId);
      if (!q) return;
      if (q.acceptedAnswerId === id) q.acceptedAnswerId = null;
      dropVotes('answer', id); dropComments('answer', id);
      db.answers = db.answers.filter((x) => x.id !== id);
    },
    async setAccepted(board, questionId, answerId) {
      const q = findQ(board, questionId);
      if (q) q.acceptedAnswerId = answerId;
    },
    async setVote(board, kind, id, userId, value) {
      const post = kind === 'question' ? findQ(board, id) : db.answers.find((a) => a.id === id);
      if (!post) return 0;
      const k = voteKey(kind, id, userId);
      if (value === 0) db.votes.delete(k); else db.votes.set(k, value);
      let score = 0;
      for (const [key, v] of db.votes) if (key.startsWith(`${kind}:${id}:`)) score += v;
      post.score = score;
      return score;
    },
    async addComment(board, kind, postId, { body, authorId, authorName }) {
      const c = { id: nextId(), kind, postId, body, authorId, authorName, createdAt: stamp() };
      db.comments.push(c);
      return { id: c.id, body, authorId, authorName, createdAt: c.createdAt };
    },
    async getComment(board, id) {
      const c = db.comments.find((x) => x.id === id);
      if (!c) return null;
      const qid = c.kind === 'question' ? c.postId : db.answers.find((a) => a.id === c.postId)?.questionId;
      if (!findQ(board, qid)) return null;
      return { id: c.id, authorId: c.authorId };
    },
    async deleteComment(board, id) { db.comments = db.comments.filter((c) => c.id !== id); },
  };
}

// ---- Postgres ---------------------------------------------------------------

const IDENT = /^[a-z_][a-z0-9_]*$/i;
const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return name;
};
const tables = (prefix) => {
  const p = ident(prefix);
  return { q: `${p}questions`, a: `${p}answers`, c: `${p}comments`, v: `${p}votes`, w: `${p}views` };
};

/** Postgres SQL for the board's tables (idempotent). Tables are `<prefix>questions` etc. */
export function qaSchemaSql({ prefix = 'qa_' } = {}) {
  const t = tables(prefix);
  return `
CREATE TABLE IF NOT EXISTS ${t.q} (
  id                 SERIAL PRIMARY KEY,
  board              TEXT NOT NULL DEFAULT 'main',
  title              TEXT NOT NULL,
  body               TEXT,
  body_text          TEXT NOT NULL DEFAULT '',
  tags               TEXT[] NOT NULL DEFAULT '{}',
  author_id          TEXT NOT NULL,
  author_name        TEXT NOT NULL,
  score              INTEGER NOT NULL DEFAULT 0,
  answer_count       INTEGER NOT NULL DEFAULT 0,
  views              INTEGER NOT NULL DEFAULT 0,
  accepted_answer_id INTEGER,
  closed             BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at          TIMESTAMPTZ,
  activity_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ${t.q}_board_activity ON ${t.q} (board, activity_at DESC);
CREATE INDEX IF NOT EXISTS ${t.q}_tags ON ${t.q} USING GIN (tags);
CREATE INDEX IF NOT EXISTS ${t.q}_search ON ${t.q} USING GIN (to_tsvector('english', title || ' ' || body_text));
CREATE TABLE IF NOT EXISTS ${t.a} (
  id          SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES ${t.q}(id) ON DELETE CASCADE,
  body        TEXT,
  body_text   TEXT NOT NULL DEFAULT '',
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ${t.a}_question ON ${t.a} (question_id);
CREATE TABLE IF NOT EXISTS ${t.c} (
  id          SERIAL PRIMARY KEY,
  question_id INTEGER REFERENCES ${t.q}(id) ON DELETE CASCADE,
  answer_id   INTEGER REFERENCES ${t.a}(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((question_id IS NULL) <> (answer_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ${t.c}_question ON ${t.c} (question_id);
CREATE INDEX IF NOT EXISTS ${t.c}_answer ON ${t.c} (answer_id);
CREATE TABLE IF NOT EXISTS ${t.v} (
  kind    TEXT NOT NULL CHECK (kind IN ('question', 'answer')),
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  value   SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (kind, post_id, user_id)
);
CREATE TABLE IF NOT EXISTS ${t.w} (
  question_id INTEGER NOT NULL REFERENCES ${t.q}(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  PRIMARY KEY (question_id, user_id)
);`;
}

/** Postgres store on a pg Pool (run qaSchemaSql once at start-up). */
export function pgQaStore(pool, { prefix = 'qa_' } = {}) {
  const t = tables(prefix);
  const LIST_COLS = `q.id, q.title, q.body_text, q.tags, q.author_id, q.author_name, q.created_at, q.activity_at,
    q.score, q.answer_count, q.views, q.accepted_answer_id, q.closed`;
  const item = (r) => ({
    id: r.id, title: r.title, excerpt: excerpt(r.body_text), tags: r.tags || [], authorId: r.author_id, authorName: r.author_name,
    createdAt: iso(r.created_at), activityAt: iso(r.activity_at), score: r.score, answerCount: r.answer_count, views: r.views,
    accepted: r.accepted_answer_id != null, closed: r.closed,
  });
  const comment = (r) => ({ id: r.id, body: r.body, authorId: r.author_id, authorName: r.author_name, createdAt: iso(r.created_at) });
  const recountAnswers = (db, qid) => db.query(
    `UPDATE ${t.q} SET answer_count = (SELECT count(*) FROM ${t.a} WHERE question_id = $1) WHERE id = $1`, [qid]);
  // Counts are recounted inside a transaction that first locks the post's row, so two
  // writes landing together queue up instead of each recounting a stale picture.
  const tx = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { c.release(); }
  };

  return {
    async listQuestions(board, { sort = 'active', tags = [], q = '', limit = 20, offset = 0 } = {}) {
      const where = ['q.board = $1'];
      const args = [board];
      if (tags.length) { args.push(tags); where.push(`q.tags && $${args.length}::text[]`); } // any ticked tag, like every FilterMenu
      if (q) { args.push(q); where.push(`to_tsvector('english', q.title || ' ' || q.body_text) @@ websearch_to_tsquery('english', $${args.length})`); }
      if (sort === 'unanswered') where.push('q.answer_count = 0');
      const order = {
        newest: 'q.created_at DESC, q.id DESC',
        unanswered: 'q.created_at DESC, q.id DESC',
        votes: 'q.score DESC, q.id DESC',
        active: 'q.activity_at DESC, q.id DESC',
      }[sort] || 'q.activity_at DESC, q.id DESC';
      const sqlWhere = where.join(' AND ');
      const [{ rows }, { rows: [{ n }] }] = await Promise.all([
        pool.query(`SELECT ${LIST_COLS} FROM ${t.q} q WHERE ${sqlWhere} ORDER BY ${order} LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, limit, offset]),
        pool.query(`SELECT count(*)::int AS n FROM ${t.q} q WHERE ${sqlWhere}`, args),
      ]);
      return { items: rows.map(item), total: n };
    },
    async tags(board) {
      const { rows } = await pool.query(
        `SELECT tag, count(*)::int AS count FROM ${t.q}, unnest(tags) AS tag WHERE board = $1 GROUP BY tag ORDER BY count DESC, tag`, [board]);
      return rows;
    },
    async getQuestion(board, id, userId) {
      const { rows: [r] } = await pool.query(`SELECT ${LIST_COLS}, q.body, q.edited_at FROM ${t.q} q WHERE q.id = $1 AND q.board = $2`, [id, board]);
      if (!r) return null;
      const uid = userId == null ? null : String(userId);
      const [answers, comments, votes] = await Promise.all([
        pool.query(`SELECT id, question_id, body, author_id, author_name, created_at, edited_at, score FROM ${t.a} WHERE question_id = $1`, [id]),
        pool.query(`SELECT c.id, c.question_id, c.answer_id, c.body, c.author_id, c.author_name, c.created_at FROM ${t.c} c
                    LEFT JOIN ${t.a} a ON a.id = c.answer_id
                    WHERE c.question_id = $1 OR a.question_id = $1 ORDER BY c.created_at, c.id`, [id]),
        uid == null ? { rows: [] } : pool.query(
          `SELECT kind, post_id, value FROM ${t.v} WHERE user_id = $2 AND (
             (kind = 'question' AND post_id = $1) OR
             (kind = 'answer' AND post_id IN (SELECT id FROM ${t.a} WHERE question_id = $1)))`, [id, uid]),
      ]);
      const vote = (kind, pid) => votes.rows.find((v) => v.kind === kind && v.post_id === pid)?.value || 0;
      const commentsFor = (key, pid) => comments.rows.filter((c) => c[key] === pid).map(comment);
      return {
        ...item(r), body: r.body, editedAt: iso(r.edited_at), acceptedAnswerId: r.accepted_answer_id,
        myVote: vote('question', id), comments: commentsFor('question_id', id),
        answers: answers.rows.map((a) => ({
          id: a.id, questionId: a.question_id, body: a.body, authorId: a.author_id, authorName: a.author_name,
          createdAt: iso(a.created_at), editedAt: iso(a.edited_at), score: a.score, myVote: vote('answer', a.id),
          accepted: r.accepted_answer_id === a.id, comments: commentsFor('answer_id', a.id),
        })).sort(byAnswerOrder),
      };
    },
    async createQuestion(board, { title, body, bodyText, tags, authorId, authorName }) {
      const { rows: [r] } = await pool.query(
        `INSERT INTO ${t.q} (board, title, body, body_text, tags, author_id, author_name) VALUES ($1, $2, $3, $4, $5::text[], $6, $7) RETURNING id`,
        [board, title, body, bodyText, tags, String(authorId), authorName]);
      return r.id;
    },
    async updateQuestion(board, id, { edited, ...patch }) {
      const cols = { title: 'title', body: 'body', bodyText: 'body_text', tags: 'tags', closed: 'closed' };
      const sets = [];
      const args = [id, board];
      for (const [k, col] of Object.entries(cols)) {
        if (!(k in patch)) continue;
        args.push(patch[k]);
        sets.push(`${col} = $${args.length}${k === 'tags' ? '::text[]' : ''}`);
      }
      if (edited) sets.push('edited_at = now()', 'activity_at = now()');
      if (!sets.length) return;
      await pool.query(`UPDATE ${t.q} SET ${sets.join(', ')} WHERE id = $1 AND board = $2`, args);
    },
    async deleteQuestion(board, id) {
      const { rows } = await pool.query(`DELETE FROM ${t.q} WHERE id = $1 AND board = $2 RETURNING id`, [id, board]);
      if (!rows.length) return;
      // Answers, comments and views go by ON DELETE CASCADE; votes have no foreign key.
      await pool.query(`DELETE FROM ${t.v} WHERE (kind = 'question' AND post_id = $1)
        OR (kind = 'answer' AND post_id NOT IN (SELECT id FROM ${t.a}))`, [id]);
    },
    async addView(board, id, userId) {
      const { rowCount } = await pool.query(
        `INSERT INTO ${t.w} (question_id, user_id) SELECT id, $2 FROM ${t.q} WHERE id = $1 AND board = $3 ON CONFLICT DO NOTHING`,
        [id, String(userId), board]);
      if (rowCount) await pool.query(`UPDATE ${t.q} SET views = views + 1 WHERE id = $1`, [id]);
      return rowCount > 0;
    },
    async getAnswer(board, id) {
      const { rows: [r] } = await pool.query(
        `SELECT a.id, a.question_id, a.author_id FROM ${t.a} a JOIN ${t.q} q ON q.id = a.question_id WHERE a.id = $1 AND q.board = $2`, [id, board]);
      return r ? { id: r.id, questionId: r.question_id, authorId: r.author_id } : null;
    },
    async createAnswer(board, questionId, { body, bodyText, authorId, authorName }) {
      return tx(async (c) => {
        const { rows: [q] } = await c.query(`SELECT id FROM ${t.q} WHERE id = $1 AND board = $2 FOR UPDATE`, [questionId, board]);
        if (!q) return null;
        const { rows: [r] } = await c.query(
          `INSERT INTO ${t.a} (question_id, body, body_text, author_id, author_name) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [questionId, body, bodyText, String(authorId), authorName]);
        await c.query(`UPDATE ${t.q} SET activity_at = now() WHERE id = $1`, [questionId]);
        await recountAnswers(c, questionId);
        return r.id;
      });
    },
    async updateAnswer(board, id, { body, bodyText }) {
      const { rows: [r] } = await pool.query(
        `UPDATE ${t.a} a SET body = $3, body_text = $4, edited_at = now() FROM ${t.q} q
         WHERE a.id = $1 AND q.id = a.question_id AND q.board = $2 RETURNING a.question_id`, [id, board, body, bodyText]);
      if (r) await pool.query(`UPDATE ${t.q} SET activity_at = now() WHERE id = $1`, [r.question_id]);
    },
    async deleteAnswer(board, id) {
      await tx(async (c) => {
        const { rows: [q] } = await c.query(
          `SELECT q.id FROM ${t.q} q JOIN ${t.a} a ON a.question_id = q.id WHERE a.id = $1 AND q.board = $2 FOR UPDATE OF q`, [id, board]);
        if (!q) return;
        await c.query(`DELETE FROM ${t.a} WHERE id = $1`, [id]);
        await c.query(`DELETE FROM ${t.v} WHERE kind = 'answer' AND post_id = $1`, [id]);
        await c.query(`UPDATE ${t.q} SET accepted_answer_id = NULL WHERE id = $1 AND accepted_answer_id = $2`, [q.id, id]);
        await recountAnswers(c, q.id);
      });
    },
    async setAccepted(board, questionId, answerId) {
      await pool.query(`UPDATE ${t.q} SET accepted_answer_id = $3 WHERE id = $1 AND board = $2`, [questionId, board, answerId]);
    },
    async setVote(board, kind, id, userId, value) {
      const uid = String(userId);
      const table = kind === 'question' ? t.q : t.a;
      return tx(async (c) => {
        const { rows: [post] } = await c.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
        if (!post) return 0;
        if (value === 0) {
          await c.query(`DELETE FROM ${t.v} WHERE kind = $1 AND post_id = $2 AND user_id = $3`, [kind, id, uid]);
        } else {
          await c.query(
            `INSERT INTO ${t.v} (kind, post_id, user_id, value) VALUES ($1, $2, $3, $4)
             ON CONFLICT (kind, post_id, user_id) DO UPDATE SET value = excluded.value`, [kind, id, uid, value]);
        }
        // Recount rather than add a delta, under the row lock: the score always equals the votes.
        const { rows: [r] } = await c.query(
          `UPDATE ${table} SET score = (SELECT coalesce(sum(value), 0)::int FROM ${t.v} WHERE kind = $1 AND post_id = $2)
           WHERE id = $2 RETURNING score`, [kind, id]);
        return r.score;
      });
    },
    async addComment(board, kind, postId, { body, authorId, authorName }) {
      const col = kind === 'question' ? 'question_id' : 'answer_id';
      const { rows: [r] } = await pool.query(
        `INSERT INTO ${t.c} (${col}, body, author_id, author_name) VALUES ($1, $2, $3, $4)
         RETURNING id, body, author_id, author_name, created_at`, [postId, body, String(authorId), authorName]);
      return comment(r);
    },
    async getComment(board, id) {
      const { rows: [r] } = await pool.query(
        `SELECT c.id, c.author_id FROM ${t.c} c LEFT JOIN ${t.a} a ON a.id = c.answer_id
         JOIN ${t.q} q ON q.id = coalesce(c.question_id, a.question_id) WHERE c.id = $1 AND q.board = $2`, [id, board]);
      return r ? { id: r.id, authorId: r.author_id } : null;
    },
    async deleteComment(board, id) { await pool.query(`DELETE FROM ${t.c} WHERE id = $1`, [id]); },
  };
}
