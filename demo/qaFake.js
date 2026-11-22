/*
 * A browser-only stand-in for qaRouter, on memoryQaStore, so the demo (and the UI
 * tests) run with no server. It follows the router's main rules loosely; the real
 * rules and their tests live in server/qa.js.
 */
import { memoryQaStore } from '../server/qaStores.js';
import { htmlToText } from '../src/editor/value.js';
import { normalizeTag } from '../src/qa/tags.js';

const err = (status, message, errors) => Object.assign(new Error(message), { status, errors: errors || null });

export function fakeQaClient({ store = memoryQaStore(), getViewer = () => null, delay = 0 } = {}) {
  const board = 'main';
  const wait = () => (delay ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve());
  const me = () => getViewer();
  const need = () => me() || (() => { throw err(401, 'Sign in first'); })();
  const full = async (id) => {
    const v = me();
    const q = await store.getQuestion(board, id, v?.id ?? null);
    if (!q) throw err(404, 'That question is gone');
    return { ...q, viewer: v };
  };
  const checkQ = ({ title = '', body = '', tags = [] }) => {
    const errors = {};
    if (title.trim().length < 15) errors.title = 'Make the title at least 15 characters';
    if (htmlToText(body).length < 20) errors.body = 'Write at least 20 characters';
    const clean = [...new Set(tags.map(normalizeTag).filter(Boolean))];
    if (!clean.length) errors.tags = 'Add at least one tag';
    if (Object.keys(errors).length) throw err(400, 'Check the highlighted fields', errors);
    return { title: title.trim(), body, bodyText: htmlToText(body), tags: clean };
  };

  return {
    store,
    async list({ sort = 'active', tags = [], q = '', page = 1 } = {}) {
      await wait();
      const { items, total } = await store.listQuestions(board, { sort, tags, q, limit: 20, offset: (page - 1) * 20 });
      return { items, total, page, pageSize: 20, viewer: me() };
    },
    async tags() { return store.tags(board); },
    async me() { return { viewer: me() }; },
    async get(id) {
      await wait();
      const v = me();
      const q = await full(id);
      if (v && v.id !== q.authorId) await store.addView(board, id, v.id);
      return full(id);
    },
    async ask(data) {
      const v = need();
      const id = await store.createQuestion(board, { ...checkQ(data), authorId: v.id, authorName: v.name });
      return full(id);
    },
    async update(id, patch) {
      need();
      const out = { ...patch };
      if ('title' in patch || 'body' in patch || 'tags' in patch) Object.assign(out, checkQ({ ...(await full(id)), ...patch }), { edited: true });
      await store.updateQuestion(board, id, out);
      return full(id);
    },
    async remove(id) { need(); await store.deleteQuestion(board, id); return { ok: true }; },
    async answer(qid, body) {
      const v = need();
      if (htmlToText(body).length < 10) throw err(400, 'Check your answer', { body: 'Write at least 10 characters' });
      await store.createAnswer(board, qid, { body, bodyText: htmlToText(body), authorId: v.id, authorName: v.name });
      return full(qid);
    },
    async updateAnswer(id, body) {
      need();
      const a = await store.getAnswer(board, id);
      await store.updateAnswer(board, id, { body, bodyText: htmlToText(body) });
      return full(a.questionId);
    },
    async removeAnswer(id) {
      need();
      const a = await store.getAnswer(board, id);
      await store.deleteAnswer(board, id);
      return full(a.questionId);
    },
    async accept(qid, answerId) { need(); await store.setAccepted(board, qid, answerId); return full(qid); },
    async vote(kind, id, value) {
      const v = need();
      return { score: await store.setVote(board, kind, id, v.id, value), myVote: value };
    },
    async comment(kind, id, body) {
      const v = need();
      return store.addComment(board, kind, id, { body, authorId: v.id, authorName: v.name });
    },
    async removeComment(id) { need(); await store.deleteComment(board, id); return { ok: true }; },
  };
}

/** A clock the demo store reads, so seeded posts get spread-out times. */
export function demoClock() {
  let fixed = null;
  return { now: () => fixed || new Date(), set: (d) => { fixed = d; }, release: () => { fixed = null; } };
}

/** A few believable questions for the demo. Pass the store's demoClock to spread their times. */
export async function seedQa(store, clock) {
  const start = Date.now() - 9 * 86400000;
  let step = 0;
  const tick = () => clock?.set(new Date(start + (step++) * 7 * 3600000));
  const orig = store;
  const q = (title, body, tags, authorId, authorName) => { tick(); return orig.createQuestion('main', { title, body, bodyText: htmlToText(body), tags, authorId, authorName }); };
  const a = (qid, body, authorId, authorName) => { tick(); return orig.createAnswer('main', qid, { body, bodyText: htmlToText(body), authorId, authorName }); };
  const q1 = await q('How do I export last month’s trips to a spreadsheet?',
    '<p>I need every trip from October with the guest, car and total so I can send it to my accountant. Is there a CSV export, or do I copy the table?</p>',
    ['export', 'reports'], 'u2', 'Ben Carter');
  const a1 = await a(q1, '<p>Open <strong>Trips</strong>, set the date filter to October, then use <code>Export → CSV</code> at the top right. It keeps your filters.</p>', 'u3', 'Chris Wu');
  await a(q1, '<p>If you need it every month, the Reports page can email it to you on the 1st.</p>', 'u1', 'Ana Lopez');
  await orig.setAccepted('main', q1, a1);
  await orig.setVote('main', 'question', q1, 'u1', 1);
  await orig.setVote('main', 'question', q1, 'u3', 1);
  await orig.setVote('main', 'answer', a1, 'u1', 1);
  await orig.setVote('main', 'answer', a1, 'u2', 1);
  tick();
  await orig.addComment('main', 'answer', a1, { body: 'That worked, thanks. The CSV opens fine in Excel.', authorId: 'u2', authorName: 'Ben Carter' });

  const q2 = await q('Sign-in code email takes ten minutes to arrive',
    '<p>When I choose <em>Email me a code</em>, the email shows up long after the code has expired. Password sign-in works. Is this on our side?</p>',
    ['sign-in', 'email'], 'u1', 'Ana Lopez');
  tick();
  await orig.addComment('main', 'question', q2, { body: 'Which email provider are you on? Outlook delays some senders.', authorId: 'u3', authorName: 'Chris Wu' });
  await orig.setVote('main', 'question', q2, 'u2', 1);

  const q3 = await q('Can two people edit the same car listing at once?',
    '<p>My partner and I both had the Edit Vehicle page open and one of our price changes disappeared. What happens when two people save?</p>',
    ['listings', 'autosave'], 'u3', 'Chris Wu');
  await a(q3, '<p>Each field saves on its own, so you only overwrite each other when you change the <em>same</em> field. The last save wins for that field.</p>', 'u1', 'Ana Lopez');

  await q('What does the red number next to Leads mean?',
    '<p>The sidebar shows a red <strong>3</strong> beside Leads. Hovering says “waiting over 2 hours”. Does it go away once I open them?</p>',
    ['leads', 'sidebar'], 'u2', 'Ben Carter');
  clock?.release();
  return { q1, q2, q3 };
}
