/*
 * A Stack Overflow-style Q&A board for any app: questions, answers, votes, an
 * accepted answer, tags and comments, on the app's own sign-in and database.
 *
 *   import { qaRouter, pgQaStore, qaSchemaSql } from '@mn/blocks/server/qa';
 *   await pool.query(qaSchemaSql());
 *   app.use('/api/qa', express.json(), auth.optionalAuth, qaRouter({ store: pgQaStore(pool) }));
 *
 * Reading works for whoever the app lets through (mount behind requireAuth for a
 * private board, optionalAuth for a public one). Every write needs a signed-in
 * person (user(req) returns one) or gets a 401.
 *
 * The rules live here, not in the stores, so the Postgres and memory stores behave alike:
 *   - authors edit and delete their own posts; moderators (moderator(req)) any post
 *   - a question with answers can only be deleted by a moderator
 *   - one vote per person per post (+1 / -1; 0 removes it), never on your own post
 *   - only the person who asked picks (or clears) the accepted answer
 *   - a closed question takes no new answers; moderators close and reopen
 * Bodies are cleaned with cleanRich (needs the optional peer sanitize-html); comments are plain text.
 *
 * Routes (JSON):
 *   GET    /questions?sort=newest|active|votes|unanswered&tag=a,b (any of them)&q=&page=1  -> {items, total, page, pageSize, viewer}
 *   POST   /questions {title, body, tags}                 -> question
 *   GET    /questions/:id                                 -> question with answers + comments (counts a view)
 *   PATCH  /questions/:id {title?, body?, tags?, closed?}  -> question
 *   DELETE /questions/:id
 *   POST   /questions/:id/answers {body}                  -> question
 *   PATCH  /answers/:id {body}                            -> question
 *   DELETE /answers/:id                                   -> question
 *   POST   /questions/:id/accept {answerId | null}        -> question
 *   POST   /questions/:id/vote, /answers/:id/vote {value} -> {score, myVote}
 *   POST   /questions/:id/comments, /answers/:id/comments {body} -> comment
 *   DELETE /comments/:id
 *   GET    /tags                                          -> [{tag, count}]
 *   GET    /me                                            -> {viewer}
 * A 400 carries {error, errors: {field: message}} for the form.
 */
import express from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { cleanRich, richToPlain, EDITOR_TAGS } from './richText.js';
import { createLimiter } from './rateLimit.js';
import { normalizeTag, QA_TAG_MAX } from '../src/qa/tags.js';

export { normalizeTag };

export const QA_SORTS = Object.freeze(['newest', 'active', 'votes', 'unanswered']);

/** Lengths the router enforces (and the screens show as hints). */
export const QA_LIMITS = Object.freeze({
  titleMin: 15, titleMax: 150, bodyMin: 20, answerMin: 10, bodyMax: 20000,
  commentMin: 2, commentMax: 600, tagsMin: 1, tagsMax: 5, tagMax: QA_TAG_MAX, pageSize: 20,
});

class QaError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}
const fail = (status, message, errors) => { throw new QaError(status, message, errors); };

function checkTitle(title, errors) {
  const t = String(title ?? '').trim().replace(/\s+/g, ' ');
  if (t.length < QA_LIMITS.titleMin) errors.title = `Make the title at least ${QA_LIMITS.titleMin} characters`;
  else if (t.length > QA_LIMITS.titleMax) errors.title = `Keep the title under ${QA_LIMITS.titleMax} characters`;
  return t;
}

function checkBody(body, min, errors) {
  const { value, tooLong } = cleanRich(body ?? null, { tags: EDITOR_TAGS, maxLength: QA_LIMITS.bodyMax });
  const text = richToPlain(value || '');
  if (tooLong) errors.body = 'That is too long';
  else if (text.length < min) errors.body = `Write at least ${min} characters`;
  return { body: value, bodyText: text };
}

function checkTags(tags, errors) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
  const out = [];
  for (const raw of list) {
    if (String(raw ?? '').trim() === '') continue;
    const t = normalizeTag(raw);
    if (!t) { errors.tags = `"${String(raw).slice(0, 30)}" can't be a tag (letters, digits, - . + #)`; return out; }
    if (!out.includes(t)) out.push(t);
  }
  if (out.length < QA_LIMITS.tagsMin) errors.tags = 'Add at least one tag';
  else if (out.length > QA_LIMITS.tagsMax) errors.tags = `Use at most ${QA_LIMITS.tagsMax} tags`;
  return out;
}

const positiveId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
};

/**
 * Express router for the board. Mount after express.json().
 *   store          pgQaStore(pool) or memoryQaStore() (required)
 *   user           (req) -> {id, name} | null   (default: req.user's id and name; never the email,
 *                  which a public board would show on every post: no name -> "Someone")
 *   moderator      (req) -> boolean            (default: req.user.role in moderatorRoles)
 *   moderatorRoles roles that moderate (['admin'])
 *   board          'main' or (req) -> string; one app can run several boards
 *   limits         per-person write budgets per 15 min, each its own counter:
 *                  {posts 20 (questions, answers, edits, deletes, accept, close), votes 60, comments 30}
 *   rateLimitKey   (req) -> client id for signed-out callers behind a proxy (as createAuth's); signed-in
 *                  people are always counted by their id
 *   limiter        one express middleware for every write instead of `limits`; false for no limits
 *   onEvent        (type, data, req) -> void after a write: 'question' | 'answer' | 'comment' | 'accept'
 *                  (send a notificationEmail from here); errors are logged, never fail the request
 *   onError        (err, req) -> void for 500s (console.error)
 */
export function qaRouter({
  store,
  user = (req) => (req.user?.id != null ? { id: String(req.user.id), name: req.user.name || 'Someone' } : null),
  moderatorRoles = ['admin'],
  moderator = (req) => Boolean(req.user && moderatorRoles.includes(req.user.role)),
  board = 'main',
  limits = {},
  rateLimitKey = null,
  limiter,
  onEvent,
  onError = (err) => console.error('[qa]', err),
} = {}) {
  if (!store || typeof store.listQuestions !== 'function') throw new Error('qaRouter needs a store (pgQaStore or memoryQaStore)');
  const router = express.Router();
  const boardOf = (req) => (typeof board === 'function' ? board(req) : board) || 'main';
  const viewerOf = (req) => {
    const u = user(req);
    return u && u.id != null && u.id !== '' ? { id: String(u.id), name: String(u.name || 'Someone'), moderator: Boolean(moderator(req)) } : null;
  };
  const needViewer = (req) => viewerOf(req) || fail(401, 'Sign in first');

  // Writes: refuse signed-out callers first (so they spend no budget), then one counter per
  // kind of write, keyed on the person, so votes never block an answer and a shared proxy IP
  // never pools a whole office into one budget.
  const signedIn = (req, res, next) => (viewerOf(req) ? next() : res.status(401).json({ error: 'Sign in first' }));
  const keyGenerator = (req) => {
    const v = viewerOf(req);
    if (v) return `u:${v.id}`;
    return ipKeyGenerator(String((rateLimitKey && rateLimitKey(req)) || req.ip || req.socket?.remoteAddress || 'unknown'));
  };
  const budget = (limit, message) => createLimiter({ minutes: 15, limit, message, keyGenerator });
  const none = (_q, _s, next) => next();
  const shared = limiter === false ? none : limiter || null;
  const L = {
    posts: shared || budget(limits.posts ?? 20, 'You are posting too fast. Try again in a few minutes.'),
    votes: shared || budget(limits.votes ?? 60, 'Too many votes in a row. Try again in a few minutes.'),
    comments: shared || budget(limits.comments ?? 30, 'Too many comments in a row. Try again in a few minutes.'),
  };
  const write = (kind) => [signedIn, L[kind]];
  const emit = (type, data, req) => {
    if (!onEvent) return;
    Promise.resolve().then(() => onEvent(type, data, req)).catch((err) => { try { onError(err, req); } catch { /* ignore */ } });
  };

  const handle = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      if (err instanceof QaError) return res.status(err.status).json({ error: err.message, ...(err.errors ? { errors: err.errors } : {}) });
      try { onError(err, req); } catch { /* a broken logger must not hang the request */ }
      res.status(500).json({ error: 'Something went wrong. Try again.' });
    }
  };

  const idParam = (req) => positiveId(req.params.id) || fail(404, 'Not found');
  const loadQuestion = async (req, id, viewer) => (await store.getQuestion(boardOf(req), id, viewer?.id ?? null)) || fail(404, 'That question is gone');
  const loadAnswer = async (req, id) => (await store.getAnswer(boardOf(req), id)) || fail(404, 'That answer is gone');
  const canEdit = (viewer, authorId) => viewer.moderator || viewer.id === String(authorId);
  const shape = (q, viewer) => ({ ...q, viewer });

  router.get('/questions', handle(async (req) => {
    const viewer = viewerOf(req);
    const sort = QA_SORTS.includes(req.query.sort) ? req.query.sort : 'active';
    const page = positiveId(req.query.page) || 1;
    const tags = String(req.query.tag || '').split(',').map(normalizeTag).filter(Boolean).slice(0, 10);
    const q = String(req.query.q || '').trim().slice(0, 200);
    const pageSize = QA_LIMITS.pageSize;
    const { items, total } = await store.listQuestions(boardOf(req), { sort, tags, q, limit: pageSize, offset: (page - 1) * pageSize });
    return { items, total, page, pageSize, viewer };
  }));

  router.get('/tags', handle(async (req) => store.tags(boardOf(req))));
  router.get('/me', handle(async (req) => ({ viewer: viewerOf(req) })));

  router.post('/questions', write('posts'), handle(async (req) => {
    const viewer = needViewer(req);
    const errors = {};
    const title = checkTitle(req.body?.title, errors);
    const { body, bodyText } = checkBody(req.body?.body, QA_LIMITS.bodyMin, errors);
    const tags = checkTags(req.body?.tags, errors);
    if (Object.keys(errors).length) fail(400, 'Check the highlighted fields', errors);
    const id = await store.createQuestion(boardOf(req), { title, body, bodyText, tags, authorId: viewer.id, authorName: viewer.name });
    const q = await loadQuestion(req, id, viewer);
    emit('question', { question: q, user: viewer }, req);
    return shape(q, viewer);
  }));

  router.get('/questions/:id', handle(async (req) => {
    const viewer = viewerOf(req);
    const id = idParam(req);
    let q = await loadQuestion(req, id, viewer);
    if (viewer && viewer.id !== q.authorId && await store.addView(boardOf(req), id, viewer.id)) q = { ...q, views: q.views + 1 };
    return shape(q, viewer);
  }));

  router.patch('/questions/:id', write('posts'), handle(async (req) => {
    const viewer = needViewer(req);
    const id = idParam(req);
    const q = await loadQuestion(req, id, viewer);
    const b = req.body || {};
    const errors = {};
    const patch = {};
    if ('closed' in b) {
      if (!viewer.moderator) fail(403, 'Only a moderator can close or reopen a question');
      patch.closed = Boolean(b.closed);
    }
    const editing = ['title', 'body', 'tags'].some((k) => k in b);
    if (editing && !canEdit(viewer, q.authorId)) fail(403, 'You can only edit your own question');
    if ('title' in b) patch.title = checkTitle(b.title, errors);
    if ('body' in b) Object.assign(patch, checkBody(b.body, QA_LIMITS.bodyMin, errors));
    if ('tags' in b) patch.tags = checkTags(b.tags, errors);
    if (Object.keys(errors).length) fail(400, 'Check the highlighted fields', errors);
    if (!Object.keys(patch).length) fail(400, 'Nothing to change');
    await store.updateQuestion(boardOf(req), id, { ...patch, edited: editing });
    return shape(await loadQuestion(req, id, viewer), viewer);
  }));

  router.delete('/questions/:id', write('posts'), handle(async (req) => {
    const viewer = needViewer(req);
    const id = idParam(req);
    const q = await loadQuestion(req, id, viewer);
    if (!canEdit(viewer, q.authorId)) fail(403, 'You can only delete your own question');
    if (!viewer.moderator && q.answerCount > 0) fail(409, 'This question has answers, so only a moderator can delete it');
    await store.deleteQuestion(boardOf(req), id);
    return { ok: true };
  }));

  router.post('/questions/:id/answers', write('posts'), handle(async (req) => {
    const viewer = needViewer(req);
    const id = idParam(req);
    const q = await loadQuestion(req, id, viewer);
    if (q.closed) fail(409, 'This question is closed');
    const errors = {};
    const { body, bodyText } = checkBody(req.body?.body, QA_LIMITS.answerMin, errors);
    if (Object.keys(errors).length) fail(400, 'Check your answer', errors);
    const answerId = await store.createAnswer(boardOf(req), id, { body, bodyText, authorId: viewer.id, authorName: viewer.name });
    const out = await loadQuestion(req, id, viewer);
    emit('answer', { question: out, answer: out.answers.find((a) => a.id === answerId), user: viewer }, req);
    return shape(out, viewer);
  }));

  router.patch('/answers/:id', write('posts'), handle(async (req) => {
    const viewer = needViewer(req);
    const a = await loadAnswer(req, idParam(req));
    if (!canEdit(viewer, a.authorId)) fail(403, 'You can only edit your own answer');
    const errors = {};
    const { body, bodyText } = checkBody(req.body?.body, QA_LIMITS.answerMin, errors);
    if (Object.keys(errors).length) fail(400, 'Check your answer', errors);
    await store.updateAnswer(boardOf(req), a.id, { body, bodyText });
    return shape(await loadQuestion(req, a.questionId, viewer), viewer);
  }));

  router.delete('/answers/:id', write('posts'), handle(async (req) => {
    const viewer = needViewer(req);
    const a = await loadAnswer(req, idParam(req));
    if (!canEdit(viewer, a.authorId)) fail(403, 'You can only delete your own answer');
    await store.deleteAnswer(boardOf(req), a.id);
    return shape(await loadQuestion(req, a.questionId, viewer), viewer);
  }));

  router.post('/questions/:id/accept', write('posts'), handle(async (req) => {
    const viewer = needViewer(req);
    const id = idParam(req);
    const q = await loadQuestion(req, id, viewer);
    if (viewer.id !== q.authorId) fail(403, 'Only the person who asked can accept an answer');
    const raw = req.body?.answerId;
    let answerId = null;
    if (raw != null) {
      answerId = positiveId(raw);
      if (!answerId || !q.answers.some((a) => a.id === answerId)) fail(400, 'That answer is not on this question');
    }
    await store.setAccepted(boardOf(req), id, answerId);
    const out = await loadQuestion(req, id, viewer);
    if (answerId) emit('accept', { question: out, answer: out.answers.find((a) => a.id === answerId), user: viewer }, req);
    return shape(out, viewer);
  }));

  const vote = (kind) => handle(async (req) => {
    const viewer = needViewer(req);
    const id = idParam(req);
    const value = Number(req.body?.value);
    if (![1, -1, 0].includes(value)) fail(400, 'value must be 1, -1 or 0');
    const post = kind === 'question' ? await loadQuestion(req, id, viewer) : await loadAnswer(req, id);
    if (post.authorId === viewer.id) fail(403, 'You can’t vote on your own post');
    const score = await store.setVote(boardOf(req), kind, id, viewer.id, value);
    return { score, myVote: value };
  });
  router.post('/questions/:id/vote', write('votes'), vote('question'));
  router.post('/answers/:id/vote', write('votes'), vote('answer'));

  const comment = (kind) => handle(async (req) => {
    const viewer = needViewer(req);
    const id = idParam(req);
    const body = String(req.body?.body ?? '').trim().replace(/\s+/g, ' ');
    if (body.length < QA_LIMITS.commentMin || body.length > QA_LIMITS.commentMax) {
      fail(400, 'Check your comment', { body: `Comments are ${QA_LIMITS.commentMin}–${QA_LIMITS.commentMax} characters` });
    }
    const question = kind === 'question' ? await loadQuestion(req, id, viewer) : null;
    const answer = kind === 'answer' ? await loadAnswer(req, id) : null;
    const c = await store.addComment(boardOf(req), kind, id, { body, authorId: viewer.id, authorName: viewer.name });
    emit('comment', { comment: c, kind, questionId: question?.id ?? answer.questionId, user: viewer }, req);
    return c;
  });
  router.post('/questions/:id/comments', write('comments'), comment('question'));
  router.post('/answers/:id/comments', write('comments'), comment('answer'));

  router.delete('/comments/:id', write('comments'), handle(async (req) => {
    const viewer = needViewer(req);
    const c = (await store.getComment(boardOf(req), idParam(req))) || fail(404, 'That comment is gone');
    if (!canEdit(viewer, c.authorId)) fail(403, 'You can only delete your own comment');
    await store.deleteComment(boardOf(req), c.id);
    return { ok: true };
  }));

  return router;
}

export { memoryQaStore, pgQaStore, qaSchemaSql, sqliteQaStore, qaSqliteSchemaSql } from './qaStores.js';
