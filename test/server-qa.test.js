import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { qaRouter, memoryQaStore, qaSchemaSql, pgQaStore, normalizeTag, QA_LIMITS } from '../server/qa.js';
import * as serverEntry from '../server/index.js';

const USERS = {
  ana: { id: 1, name: 'Ana', role: 'user' },
  ben: { id: 2, name: 'Ben', role: 'user' },
  mod: { id: 9, name: 'Mo', role: 'admin' },
};

function makeApp(opts = {}) {
  const store = memoryQaStore();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = USERS[req.get('x-user')]; next(); });
  app.use('/qa', qaRouter({ store, limiter: false, onError: () => {}, ...opts }));
  const as = (who) => ({
    get: (p) => request(app).get(`/qa${p}`).set('x-user', who || ''),
    post: (p, body) => request(app).post(`/qa${p}`).set('x-user', who || '').send(body),
    patch: (p, body) => request(app).patch(`/qa${p}`).set('x-user', who || '').send(body),
    del: (p) => request(app).delete(`/qa${p}`).set('x-user', who || ''),
  });
  return { app, store, as };
}

const Q = { title: 'How do I reset the admin password?', body: '<p>I lost it and the email never comes.</p>', tags: ['Auth', 'email'] };
const A = { body: '<p>Use the emailed code sign-in instead.</p>' };

async function seed(as) {
  const q = (await as('ana').post('/questions', Q)).body;
  return q;
}

describe('qaRouter: questions', () => {
  let ctx;
  beforeEach(() => { ctx = makeApp(); });

  it('needs sign-in to post, not to read', async () => {
    expect((await ctx.as().post('/questions', Q)).status).toBe(401);
    expect((await ctx.as().get('/questions')).status).toBe(200);
  });

  it('creates a question with cleaned body and normalized tags', async () => {
    const res = await ctx.as('ana').post('/questions', { ...Q, body: '<p onclick="x()">Hi there, this is a long enough body<script>alert(1)</script></p>' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: Q.title, tags: ['auth', 'email'], authorId: '1', authorName: 'Ana', score: 0, answers: [] });
    expect(res.body.body).toBe('<p>Hi there, this is a long enough body</p>');
    expect(res.body.viewer).toEqual({ id: '1', name: 'Ana', moderator: false });
  });

  it('returns field errors', async () => {
    const res = await ctx.as('ana').post('/questions', { title: 'short', body: '<p>x</p>', tags: [] });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.errors).sort()).toEqual(['body', 'tags', 'title']);
    const many = await ctx.as('ana').post('/questions', { ...Q, tags: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(many.body.errors.tags).toMatch(/at most 5/);
    const bad = await ctx.as('ana').post('/questions', { ...Q, tags: ['ok', '<script>'] });
    expect(bad.body.errors.tags).toMatch(/can't be a tag/);
  });

  it('only the author or a moderator edits; edits set editedAt', async () => {
    const q = await seed(ctx.as);
    expect((await ctx.as('ben').patch(`/questions/${q.id}`, { title: 'Ben rewrote this title fully' })).status).toBe(403);
    const own = await ctx.as('ana').patch(`/questions/${q.id}`, { title: 'How do I reset my admin password?' });
    expect(own.status).toBe(200);
    expect(own.body.editedAt).toBeTruthy();
    expect((await ctx.as('mod').patch(`/questions/${q.id}`, { tags: ['auth'] })).body.tags).toEqual(['auth']);
  });

  it('only moderators close; closed questions take no answers', async () => {
    const q = await seed(ctx.as);
    expect((await ctx.as('ana').patch(`/questions/${q.id}`, { closed: true })).status).toBe(403);
    const closed = await ctx.as('mod').patch(`/questions/${q.id}`, { closed: true });
    expect(closed.body.closed).toBe(true);
    expect(closed.body.editedAt).toBeNull();
    expect((await ctx.as('ben').post(`/questions/${q.id}/answers`, A)).status).toBe(409);
  });

  it('an author deletes an unanswered question; with answers only a moderator can', async () => {
    const q = await seed(ctx.as);
    await ctx.as('ben').post(`/questions/${q.id}/answers`, A);
    expect((await ctx.as('ben').del(`/questions/${q.id}`)).status).toBe(403);
    expect((await ctx.as('ana').del(`/questions/${q.id}`)).status).toBe(409);
    expect((await ctx.as('mod').del(`/questions/${q.id}`)).status).toBe(200);
    expect((await ctx.as('ana').get(`/questions/${q.id}`)).status).toBe(404);
    const q2 = await seed(ctx.as);
    expect((await ctx.as('ana').del(`/questions/${q2.id}`)).status).toBe(200);
  });

  it('counts one view per person, not the author', async () => {
    const q = await seed(ctx.as);
    await ctx.as('ana').get(`/questions/${q.id}`);
    expect((await ctx.as('ben').get(`/questions/${q.id}`)).body.views).toBe(1);
    expect((await ctx.as('ben').get(`/questions/${q.id}`)).body.views).toBe(1);
    expect((await ctx.as().get(`/questions/${q.id}`)).body.views).toBe(1);
  });

  it('404s bad ids and keeps boards apart', async () => {
    expect((await ctx.as('ana').get('/questions/abc')).status).toBe(404);
    const store = memoryQaStore();
    const mk = (board) => {
      const app = express();
      app.use(express.json());
      app.use((req, _r, n) => { req.user = USERS.ana; n(); });
      app.use('/qa', qaRouter({ store, board, limiter: false }));
      return app;
    };
    const created = await request(mk('one')).post('/qa/questions').send(Q);
    expect((await request(mk('two')).get(`/qa/questions/${created.body.id}`)).status).toBe(404);
    expect((await request(mk('two')).get('/qa/questions')).body.total).toBe(0);
  });
});

describe('qaRouter: answers, votes, accept, comments', () => {
  let ctx; let q;
  beforeEach(async () => { ctx = makeApp(); q = await seed(ctx.as); });

  it('answers, edits and deletes with ownership checks', async () => {
    const res = await ctx.as('ben').post(`/questions/${q.id}/answers`, A);
    expect(res.body.answerCount).toBe(1);
    const a = res.body.answers[0];
    expect((await ctx.as('ana').patch(`/answers/${a.id}`, { body: '<p>Ana edits Ben answer</p>' })).status).toBe(403);
    expect((await ctx.as('ben').patch(`/answers/${a.id}`, { body: '<p>short</p>' })).status).toBe(400);
    const edited = await ctx.as('ben').patch(`/answers/${a.id}`, { body: '<p>Edited answer text here</p>' });
    expect(edited.body.answers[0].editedAt).toBeTruthy();
    expect((await ctx.as('ben').del(`/answers/${a.id}`)).body.answerCount).toBe(0);
  });

  it('votes once per person, toggles off with 0, never on your own post', async () => {
    expect((await ctx.as('ana').post(`/questions/${q.id}/vote`, { value: 1 })).status).toBe(403);
    expect((await ctx.as('ben').post(`/questions/${q.id}/vote`, { value: 1 })).body).toEqual({ score: 1, myVote: 1 });
    expect((await ctx.as('ben').post(`/questions/${q.id}/vote`, { value: 1 })).body.score).toBe(1);
    expect((await ctx.as('mod').post(`/questions/${q.id}/vote`, { value: -1 })).body.score).toBe(0);
    expect((await ctx.as('ben').post(`/questions/${q.id}/vote`, { value: 0 })).body.score).toBe(-1);
    expect((await ctx.as('ben').post(`/questions/${q.id}/vote`, { value: 5 })).status).toBe(400);
    const a = (await ctx.as('ben').post(`/questions/${q.id}/answers`, A)).body.answers[0];
    await ctx.as('ana').post(`/answers/${a.id}/vote`, { value: 1 });
    const view = await ctx.as('ana').get(`/questions/${q.id}`);
    expect(view.body.answers[0]).toMatchObject({ score: 1, myVote: 1 });
    expect(view.body.myVote).toBe(0);
  });

  it('only the asker accepts; accepted answer comes first and clears on delete', async () => {
    const a1 = (await ctx.as('ben').post(`/questions/${q.id}/answers`, A)).body.answers[0];
    const res2 = await ctx.as('mod').post(`/questions/${q.id}/answers`, { body: '<p>Second answer by the moderator</p>' });
    const a2 = res2.body.answers.find((x) => x.id !== a1.id);
    await ctx.as('ana').post(`/answers/${a1.id}/vote`, { value: 1 });
    expect((await ctx.as('ben').post(`/questions/${q.id}/accept`, { answerId: a2.id })).status).toBe(403);
    expect((await ctx.as('ana').post(`/questions/${q.id}/accept`, { answerId: 999 })).status).toBe(400);
    const acc = await ctx.as('ana').post(`/questions/${q.id}/accept`, { answerId: a2.id });
    expect(acc.body.acceptedAnswerId).toBe(a2.id);
    expect(acc.body.answers[0]).toMatchObject({ id: a2.id, accepted: true });
    const list = await ctx.as().get('/questions');
    expect(list.body.items[0].accepted).toBe(true);
    const cleared = await ctx.as('mod').del(`/answers/${a2.id}`);
    expect(cleared.body.acceptedAnswerId).toBeNull();
    const un = await ctx.as('ana').post(`/questions/${q.id}/accept`, { answerId: null });
    expect(un.body.acceptedAnswerId).toBeNull();
  });

  it('comments are plain text with a length limit; owners or moderators delete', async () => {
    expect((await ctx.as('ben').post(`/questions/${q.id}/comments`, { body: 'x' })).status).toBe(400);
    expect((await ctx.as('ben').post(`/questions/${q.id}/comments`, { body: 'y'.repeat(QA_LIMITS.commentMax + 1) })).status).toBe(400);
    const c = (await ctx.as('ben').post(`/questions/${q.id}/comments`, { body: '  Which   app? <b>x</b> ' })).body;
    expect(c).toMatchObject({ body: 'Which app? <b>x</b>', authorName: 'Ben' });
    const a = (await ctx.as('ben').post(`/questions/${q.id}/answers`, A)).body.answers[0];
    await ctx.as('ana').post(`/answers/${a.id}/comments`, { body: 'Thanks, that worked' });
    const view = (await ctx.as('ana').get(`/questions/${q.id}`)).body;
    expect(view.comments).toHaveLength(1);
    expect(view.answers[0].comments[0].body).toBe('Thanks, that worked');
    expect((await ctx.as('ana').del(`/comments/${c.id}`)).status).toBe(403);
    expect((await ctx.as('mod').del(`/comments/${c.id}`)).status).toBe(200);
  });

  it('fires onEvent after writes and survives a throwing handler', async () => {
    const events = [];
    const onError = vi.fn();
    const c2 = makeApp({ onEvent: (type, data) => { events.push([type, data]); if (type === 'answer') throw new Error('mail down'); }, onError });
    const q2 = (await c2.as('ana').post('/questions', Q)).body;
    const res = await c2.as('ben').post(`/questions/${q2.id}/answers`, A);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(events.map((e) => e[0])).toEqual(['question', 'answer']);
    expect(events[1][1].answer.authorName).toBe('Ben');
    expect(onError).toHaveBeenCalled();
  });
});

describe('qaRouter: list', () => {
  it('sorts, filters by tag, searches and pages', async () => {
    let t = Date.parse('2026-11-01T00:00:00Z');
    const store = memoryQaStore({ now: () => new Date((t += 60000)) });
    const ctx = makeApp({ store });
    const make = (title, tags) => ctx.as('ana').post('/questions', { title, body: `<p>${title} has a body long enough</p>`, tags });
    const q1 = (await make('First question about payments', ['billing'])).body;
    const q2 = (await make('Second question about the login screen', ['auth'])).body;
    const q3 = (await make('Third question about invoices and billing', ['billing', 'pdf'])).body;
    await ctx.as('ben').post(`/questions/${q1.id}/answers`, A);
    await ctx.as('ben').post(`/questions/${q2.id}/vote`, { value: 1 });

    const ids = async (qs) => (await ctx.as().get(`/questions?${qs}`)).body.items.map((x) => x.id);
    expect(await ids('sort=newest')).toEqual([q3.id, q2.id, q1.id]);
    expect(await ids('sort=active')).toEqual([q1.id, q3.id, q2.id]);
    expect((await ids('sort=votes'))[0]).toBe(q2.id);
    expect(await ids('sort=unanswered')).toEqual([q3.id, q2.id]);
    expect(await ids('tag=billing')).toEqual([q1.id, q3.id]);
    expect(await ids('tag=auth,pdf')).toEqual([q3.id, q2.id]); // any ticked tag, like FilterMenu everywhere
    expect(await ids('q=invoices')).toEqual([q3.id]);
    const list = (await ctx.as().get('/questions?sort=bogus')).body;
    expect(list).toMatchObject({ total: 3, page: 1, pageSize: QA_LIMITS.pageSize, viewer: null });
    expect(list.items[0]).toHaveProperty('excerpt');
    expect(list.items[0]).not.toHaveProperty('body');
    expect((await ctx.as().get('/tags')).body).toEqual([{ tag: 'billing', count: 2 }, { tag: 'auth', count: 1 }, { tag: 'pdf', count: 1 }]);
  });
});

describe('qaRouter: limits, names, /me', () => {
  it('counts each kind of write per person: votes never block posting, one person never blocks another', async () => {
    const ctx = makeApp({ limiter: undefined, limits: { votes: 2, posts: 5 } });
    const q = (await ctx.as('ana').post('/questions', Q)).body;
    expect((await ctx.as('ben').post(`/questions/${q.id}/vote`, { value: 1 })).status).toBe(200);
    expect((await ctx.as('ben').post(`/questions/${q.id}/vote`, { value: 0 })).status).toBe(200);
    expect((await ctx.as('ben').post(`/questions/${q.id}/vote`, { value: 1 })).status).toBe(429);
    expect((await ctx.as('ben').post(`/questions/${q.id}/answers`, A)).status).toBe(200);
    expect((await ctx.as('mod').post(`/questions/${q.id}/vote`, { value: 1 })).status).toBe(200);
  });
  it('signed-out writes get 401 without spending the budget', async () => {
    const ctx = makeApp({ limiter: undefined, limits: { posts: 1 } });
    for (let i = 0; i < 3; i += 1) expect((await ctx.as().post('/questions', Q)).status).toBe(401);
    expect((await ctx.as('ana').post('/questions', Q)).status).toBe(200);
  });
  it('never shows an email as the author name', async () => {
    const store = memoryQaStore();
    const app = express();
    app.use(express.json());
    app.use((req, _r, n) => { req.user = { id: 5, email: 'private@example.com' }; n(); });
    app.use('/qa', qaRouter({ store, limiter: false }));
    const res = await request(app).post('/qa/questions').send(Q);
    expect(res.body.authorName).toBe('Someone');
    expect(JSON.stringify(res.body)).not.toContain('private@example.com');
  });
  it('/me says who is signed in', async () => {
    const ctx = makeApp();
    expect((await ctx.as('mod').get('/me')).body).toEqual({ viewer: { id: '9', name: 'Mo', moderator: true } });
    expect((await ctx.as().get('/me')).body).toEqual({ viewer: null });
  });
});

describe('qa helpers', () => {
  it('normalizeTag', () => {
    expect(normalizeTag(' React JS ')).toBe('react-js');
    expect(normalizeTag('C++')).toBe('c++');
    expect(normalizeTag('<x>')).toBeNull();
    expect(normalizeTag('a'.repeat(26))).toBeNull();
  });
  it('schema SQL is idempotent and refuses bad prefixes', () => {
    const sql = qaSchemaSql({ prefix: 'board_' });
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS board_questions');
    expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(() => qaSchemaSql({ prefix: 'x; drop' })).toThrow();
    expect(() => pgQaStore({}, { prefix: 'bad-name' })).toThrow();
  });
  it('the main /server entry does not load the board', () => {
    expect(serverEntry.qaRouter).toBeUndefined();
  });
});
