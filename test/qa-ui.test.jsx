import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { OverlayProvider } from '../src/index.js';
import { QaBoard, QuestionList, VoteButtons, TagInput, qaClient, timeAgo, normalizeTag } from '../src/qa/index.js';
import { memoryQaStore } from '../server/qaStores.js';
import { fakeQaClient, seedQa } from '../demo/qaFake.js';

afterEach(cleanup);
beforeEach(() => { window.history.replaceState(null, '', '/'); window.scrollTo = () => {}; });

const ANA = { id: 'u1', name: 'Ana Lopez', moderator: false };
const BEN = { id: 'u2', name: 'Ben Carter', moderator: false };

async function board(viewer = ANA, props = {}) {
  const store = memoryQaStore();
  const ids = await seedQa(store);
  const client = fakeQaClient({ store, getViewer: () => viewer });
  render(<OverlayProvider><QaBoard client={client} {...props} /></OverlayProvider>);
  return { store, ids, client };
}

describe('QaBoard list', () => {
  it('shows rows with counts, accepted marker and tags', async () => {
    await board();
    const row = (await screen.findByText(/export last month/)).closest('li');
    expect(within(row).getByText(/answers/).closest('.mk-qa-stat').className).toContain('mk-qa-stat-accepted');
    expect(within(row).getByRole('button', { name: 'export' })).toBeTruthy();
    expect(screen.getByText('4 questions')).toBeTruthy();
  });

  it('sort, tag and search go to the URL and the client', async () => {
    const { client } = await board();
    const list = vi.spyOn(client, 'list');
    await screen.findByText(/export last month/);
    fireEvent.click(screen.getByRole('button', { name: 'Unanswered' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'unanswered' })));
    expect(window.location.search).toContain('qaSort=unanswered');
    await waitFor(() => expect(screen.queryByText(/export last month/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    const tagBtn = await screen.findByRole('button', { name: 'email' });
    fireEvent.click(tagBtn);
    await waitFor(() => expect(window.location.search).toContain('qaTag=email'));
    await waitFor(() => expect(screen.getByText('1 question')).toBeTruthy());
  });

  it('shows the filtered empty state with Clear filters', async () => {
    window.history.replaceState(null, '', '/?qaQ=zzzz');
    await board();
    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await screen.findByText(/export last month/);
    expect(window.location.search).not.toContain('qaQ');
  });

  it('signed out: no Ask button, a sign-in button when onSignIn is given', async () => {
    const onSignIn = vi.fn();
    await board(null, { onSignIn });
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to ask' }));
    expect(onSignIn).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Ask a question/ })).toBeNull();
  });
});

describe('QaBoard question page', () => {
  it('opens from the list, shows the accepted answer first, and Back returns', async () => {
    await board(BEN);
    fireEvent.click(await screen.findByRole('link', { name: /export last month/ }));
    await screen.findByRole('heading', { name: /export last month/ });
    expect(window.location.search).toMatch(/qa=\d+/);
    const answers = screen.getAllByRole('article').filter((a) => a.getAttribute('aria-label')?.startsWith('Answer'));
    expect(answers[0].getAttribute('aria-label')).toBe('Answer by Chris Wu');
    expect(within(answers[0]).getByText('Accepted answer')).toBeTruthy();
    expect(within(answers[0]).getByText(/CSV opens fine/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← All questions' }));
    await screen.findByText('4 questions');
  });

  it('votes update the score and aria-pressed; your own post cannot be voted on', async () => {
    const { ids } = await board(ANA);
    window.history.replaceState(null, '', `/?qa=${ids.q3}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const q = await screen.findByRole('article', { name: 'Question' });
    const up = within(q).getByRole('button', { name: 'Upvote this question' });
    expect(up.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(up);
    await waitFor(() => expect(up.getAttribute('aria-pressed')).toBe('true'));
    const score = () => q.querySelector('.mk-qa-vote-score').textContent;
    expect(score()).toBe('Score 1');
    fireEvent.click(up);
    await waitFor(() => expect(score()).toBe('Score 0'));
    const mine = screen.getByRole('article', { name: 'Answer by Ana Lopez' });
    expect(within(mine).getByRole('button', { name: 'Upvote this answer' }).disabled).toBe(true);
  });

  it('the asker accepts an answer; others only see the mark', async () => {
    const { ids } = await board({ id: 'u3', name: 'Chris Wu', moderator: false });
    window.history.replaceState(null, '', `/?qa=${ids.q3}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const accept = await screen.findByRole('button', { name: 'Accept this answer' });
    fireEvent.click(accept);
    await screen.findByText('Accepted answer');
    expect(screen.getByRole('button', { name: /Accepted answer. Click to unaccept/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('adds and deletes a comment', async () => {
    const { ids } = await board(BEN);
    window.history.replaceState(null, '', `/?qa=${ids.q3}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const q = await screen.findByRole('article', { name: 'Question' });
    fireEvent.click(within(q).getByRole('button', { name: 'Add a comment' }));
    fireEvent.change(within(q).getByLabelText('Comment'), { target: { value: 'Were you both on the price field?' } });
    fireEvent.click(within(q).getByRole('button', { name: 'Comment' }));
    await within(q).findByText('Were you both on the price field?');
    fireEvent.click(within(q).getByRole('button', { name: 'Delete comment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(q).queryByText('Were you both on the price field?')).toBeNull());
  });

  it('shows edit and delete only to the author; delete is hidden once answered', async () => {
    const { ids } = await board(BEN);
    window.history.replaceState(null, '', `/?qa=${ids.q1}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const q = await screen.findByRole('article', { name: 'Question' });
    expect(within(q).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(within(q).queryByRole('button', { name: 'Delete' })).toBeNull();
    const chris = screen.getByRole('article', { name: 'Answer by Chris Wu' });
    expect(within(chris).queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('a missing question says so', async () => {
    window.history.replaceState(null, '', '/?qa=999');
    await board();
    await screen.findByText('That question is gone');
  });
});

describe('QaBoard guards', () => {
  it('a second click while a vote saves is ignored', async () => {
    const { ids, client } = await board(BEN);
    let release;
    const vote = vi.spyOn(client, 'vote').mockImplementation(() => new Promise((r) => { release = () => r({ score: 1, myVote: 1 }); }));
    window.history.replaceState(null, '', `/?qa=${ids.q3}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const q = await screen.findByRole('article', { name: 'Question' });
    const up = within(q).getByRole('button', { name: 'Upvote this question' });
    fireEvent.click(up);
    fireEvent.click(up);
    expect(vote).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(up.getAttribute('aria-pressed')).toBe('true'));
  });
  it('a page past the end goes back to page 1', async () => {
    window.history.replaceState(null, '', '/?qaPage=7');
    await board();
    await screen.findByText(/export last month/);
    await waitFor(() => expect(window.location.search).not.toContain('qaPage'));
  });
  it('a signed-out deep link to the ask form says to sign in', async () => {
    window.history.replaceState(null, '', '/?qa=ask');
    await board(null, { onSignIn: () => {} });
    expect(await screen.findByText(/You need to sign in to post/)).toBeTruthy();
  });
});

describe('QaBoard ask form', () => {
  it('checks fields before sending and shows server field errors', async () => {
    window.history.replaceState(null, '', '/?qa=ask');
    const { client } = await board();
    const ask = vi.spyOn(client, 'ask').mockRejectedValueOnce(Object.assign(new Error('Check'), { errors: { title: 'Someone already asked this' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Post question' }));
    expect(await screen.findByText('Make the title at least 15 characters')).toBeTruthy();
    expect(screen.getByText('Add at least one tag')).toBeTruthy();
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('VoteButtons', () => {
  it('toggles off when you click your current vote', () => {
    const onVote = vi.fn();
    render(<VoteButtons score={4} value={1} onVote={onVote} label="answer" />);
    fireEvent.click(screen.getByRole('button', { name: 'Upvote this answer' }));
    expect(onVote).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Downvote this answer' }));
    expect(onVote).toHaveBeenLastCalledWith(-1);
  });
  it('disabled keeps the score and explains why', () => {
    render(<VoteButtons score={2} disabled disabledReason="Sign in to vote" />);
    const up = screen.getAllByRole('button')[0];
    expect(up.disabled).toBe(true);
    expect(up.title).toBe('Sign in to vote');
    expect(screen.getByText('2')).toBeTruthy();
  });
});

describe('TagInput', () => {
  function Harness({ initial = [], ...rest }) {
    const [v, setV] = useState(initial);
    return <><TagInput value={v} onChange={setV} aria-label="Tags" {...rest} /><output>{v.join('|')}</output></>;
  }
  it('adds on Enter and comma, normalizes, removes with Backspace and ×', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Tags');
    fireEvent.change(input, { target: { value: 'React JS' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'C++' } });
    fireEvent.keyDown(input, { key: ',' });
    fireEvent.change(input, { target: { value: 'react-js' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.querySelector('output').textContent).toBe('react-js|c++');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(document.querySelector('output').textContent).toBe('react-js');
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag react-js' }));
    expect(document.querySelector('output').textContent).toBe('');
  });
  it('suggests matching tags and picks one with the arrow keys', () => {
    render(<Harness suggestions={[{ tag: 'billing', count: 3 }, 'bugs', 'auth']} />);
    const input = screen.getByLabelText('Tags');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'b' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['billing3', 'bugs']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.querySelector('output').textContent).toBe('bugs');
  });
  it('stops at max', () => {
    render(<Harness initial={['a', 'b']} max={2} />);
    expect(screen.getByLabelText('Tags').disabled).toBe(true);
  });
});

describe('QuestionList and helpers', () => {
  it('error state retries', () => {
    const onRetry = vi.fn();
    render(<QuestionList error={new Error('Network down')} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
  it('timeAgo', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    expect(timeAgo('2026-11-22T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-11-22T11:00:00Z', now)).toBe('1 h ago');
    expect(timeAgo('2026-11-20T12:00:00Z', now)).toBe('2 d ago');
  });
  it('normalizeTag matches the server', async () => {
    const server = await import('../server/qa.js');
    for (const t of ['React JS', 'C++', '<x>', '  ']) expect(normalizeTag(t)).toBe(server.normalizeTag(t));
  });
  it('qaClient sends JSON with credentials and throws field errors', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ score: 1, myVote: 1 }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'Check', errors: { title: 'Too short' } }) });
    const c = qaClient('/api/qa/', { fetch });
    expect(await c.vote('answer', 7, 1)).toEqual({ score: 1, myVote: 1 });
    expect(fetch).toHaveBeenCalledWith('/api/qa/answers/7/vote', expect.objectContaining({ method: 'POST', credentials: 'include', body: '{"value":1}' }));
    await expect(c.ask({})).rejects.toMatchObject({ status: 400, errors: { title: 'Too short' } });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });
    await c.list({ sort: 'votes', tags: ['a', 'b'], q: 'tax', page: 2 });
    expect(fetch.mock.calls[2][0]).toBe('/api/qa/questions?sort=votes&tag=a%2Cb&q=tax&page=2');
  });
});
