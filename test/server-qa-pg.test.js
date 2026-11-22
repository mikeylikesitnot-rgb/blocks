/*
 * pgQaStore against a real Postgres. Skipped unless QA_PG_URL is set, e.g.
 *   docker run --rm -d --name blocks-qa-pg -e POSTGRES_PASSWORD=pw -p 127.0.0.1:5499:5432 postgres:16-alpine
 *   QA_PG_URL=postgres://postgres:pw@127.0.0.1:5499/postgres npx vitest run test/server-qa-pg.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { qaRouter, pgQaStore, qaSchemaSql } from '../server/qa.js';

const URL = process.env.QA_PG_URL;
const USERS = { ana: { id: 1, name: 'Ana' }, ben: { id: 2, name: 'Ben' }, mod: { id: 9, name: 'Mo', role: 'admin' } };

describe.skipIf(!URL)('pgQaStore (real Postgres)', () => {
  let pool; let as;
  beforeAll(async () => {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: URL });
    await pool.query('DROP TABLE IF EXISTS t_views, t_votes, t_comments, t_answers, t_questions CASCADE');
    await pool.query(qaSchemaSql({ prefix: 't_' }));
    await pool.query(qaSchemaSql({ prefix: 't_' })); // twice: idempotent
    const app = express();
    app.use(express.json());
    app.use((req, _r, n) => { req.user = USERS[req.get('x-user')]; n(); });
    app.use('/qa', qaRouter({ store: pgQaStore(pool, { prefix: 't_' }), limiter: false, onError: (e) => { throw e; } }));
    as = (who) => ({
      get: (p) => request(app).get(`/qa${p}`).set('x-user', who || ''),
      post: (p, b) => request(app).post(`/qa${p}`).set('x-user', who || '').send(b),
      patch: (p, b) => request(app).patch(`/qa${p}`).set('x-user', who || '').send(b),
      del: (p) => request(app).delete(`/qa${p}`).set('x-user', who || ''),
    });
  });
  afterAll(async () => {
    await pool?.query('DROP TABLE IF EXISTS t_views, t_votes, t_comments, t_answers, t_questions CASCADE');
    await pool?.end();
  });

  it('runs the whole flow', async () => {
    const q = (await as('ana').post('/questions', { title: 'Invoices do not show the tax line', body: '<p>The PDF invoice is missing sales tax.</p>', tags: ['billing', 'pdf'] })).body;
    expect(q).toMatchObject({ id: expect.any(Number), tags: ['billing', 'pdf'], answerCount: 0, myVote: 0 });
    const q2 = (await as('ben').post('/questions', { title: 'Login code email takes ten minutes', body: '<p>The sign-in code arrives very late.</p>', tags: ['auth'] })).body;

    expect((await as('ben').get(`/questions/${q.id}`)).body.views).toBe(1);
    expect((await as('ben').get(`/questions/${q.id}`)).body.views).toBe(1);

    expect((await as('ben').post(`/questions/${q.id}/vote`, { value: 1 })).body.score).toBe(1);
    expect((await as('mod').post(`/questions/${q.id}/vote`, { value: 1 })).body.score).toBe(2);
    expect((await as('mod').post(`/questions/${q.id}/vote`, { value: -1 })).body.score).toBe(0);
    expect((await as('mod').post(`/questions/${q.id}/vote`, { value: 0 })).body.score).toBe(1);

    const withA = (await as('ben').post(`/questions/${q.id}/answers`, { body: '<p>Turn on tax in Settings first.</p>' })).body;
    const a1 = withA.answers[0];
    const a2 = (await as('mod').post(`/questions/${q.id}/answers`, { body: '<p>It is a known bug, fixed next week.</p>' })).body.answers.find((a) => a.id !== a1.id);
    await as('ana').post(`/answers/${a2.id}/vote`, { value: 1 });
    let view = (await as('ana').get(`/questions/${q.id}`)).body;
    expect(view.answerCount).toBe(2);
    expect(view.answers.map((a) => a.id)).toEqual([a2.id, a1.id]);
    expect(view.answers[0].myVote).toBe(1);

    view = (await as('ana').post(`/questions/${q.id}/accept`, { answerId: a1.id })).body;
    expect(view.answers[0]).toMatchObject({ id: a1.id, accepted: true });

    const c = (await as('ben').post(`/questions/${q.id}/comments`, { body: 'Which plan are you on?' })).body;
    await as('ana').post(`/answers/${a1.id}/comments`, { body: 'That fixed it, thanks' });
    view = (await as('ana').get(`/questions/${q.id}`)).body;
    expect(view.comments.map((x) => x.body)).toEqual(['Which plan are you on?']);
    expect(view.answers[0].comments.map((x) => x.body)).toEqual(['That fixed it, thanks']);
    expect((await as('ben').del(`/comments/${c.id}`)).status).toBe(200);

    const edited = (await as('ben').patch(`/answers/${a1.id}`, { body: '<p>Turn on sales tax in Settings, then reissue.</p>' })).body;
    expect(edited.answers[0].editedAt).toBeTruthy();
    const titled = (await as('ana').patch(`/questions/${q.id}`, { title: 'PDF invoices do not show the tax line', tags: ['billing'] })).body;
    expect(titled).toMatchObject({ title: 'PDF invoices do not show the tax line', tags: ['billing'] });

    const ids = async (qs) => (await as().get(`/questions?${qs}`)).body.items.map((x) => x.id);
    expect(await ids('sort=newest')).toEqual([q2.id, q.id]);
    expect(await ids('sort=active')).toEqual([q.id, q2.id]);
    expect(await ids('sort=votes')).toEqual([q.id, q2.id]);
    expect(await ids('sort=unanswered')).toEqual([q2.id]);
    expect(await ids('tag=billing')).toEqual([q.id]);
    expect(await ids('q=invoice')).toEqual([q.id]);
    expect(await ids('q=sign-in code')).toEqual([q2.id]);
    expect((await as().get('/tags')).body).toEqual([{ tag: 'auth', count: 1 }, { tag: 'billing', count: 1 }]);

    view = (await as('mod').del(`/answers/${a1.id}`)).body;
    expect(view).toMatchObject({ acceptedAnswerId: null, answerCount: 1 });
    expect((await as('mod').del(`/questions/${q.id}`)).status).toBe(200);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM t_votes WHERE kind = 'question' AND post_id = $1", [q.id]);
    expect(rows[0].n).toBe(0);
    expect((await as().get('/questions')).body.total).toBe(1);
  });
});
