import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from '../cx.js';
import { Button } from '../Button.jsx';
import { PageHeader, Segmented, Toolbar } from '../Layout.jsx';
import { Input, SearchInput, Field } from '../Inputs.jsx';
import { FilterMenu } from '../FilterMenu.jsx';
import { Banner, EmptyState, Skeleton } from '../States.jsx';
import { useConfirm, useToast } from '../Overlay.jsx';
import { useUrlState, useUrlList, patchUrl, URL_EVENT } from '../search.js';
import { CheckIcon, PlusIcon, XIcon } from '../icons.jsx';
import { RichText } from '../editor/RichText.jsx';
import { RichTextField } from '../editor/RichTextField.jsx';
import { isBlankHtml } from '../editor/value.js';
import { QuestionList, TagList, Ago } from './QuestionList.jsx';
import { VoteButtons } from './VoteButtons.jsx';
import { TagInput } from './TagInput.jsx';
import { qaClient } from './client.js';
import './qa.css';

export const QA_SORT_ITEMS = [
  { value: 'active', label: 'Active' },
  { value: 'newest', label: 'Newest' },
  { value: 'votes', label: 'Votes' },
  { value: 'unanswered', label: 'Unanswered' },
];

/* The editor's toolbar minus page-level headings: a post is a few paragraphs, code and lists. */
const EDITOR_DISABLE = ['heading', 'horizontalRule'];

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * A whole Stack Overflow-style board on one route: question list (sort, tag
 * filter, search, pages), ask form, question page with votes, accepted answer,
 * answers and comments. Talks to qaRouter from @mn/blocks/server/qa.
 *   <QaBoard apiBase="/api/qa" onSignIn={() => navigate('/login')} />
 * The view and filters live in the URL (?qa=12, ?qa=ask, ?qaSort=votes&qaTag=billing&qaQ=tax&qaPage=2),
 * so links to a question work and Back returns to the list. Needs OverlayProvider,
 * and the editor's Tiptap peers (loaded only when someone writes).
 */
export function QaBoard({
  apiBase = '/api/qa',
  client: clientProp,
  title = 'Questions',
  subtitle,
  urlKey = 'qa',
  onSignIn,
  askLabel = 'Ask a question',
  className = '',
}) {
  const client = useMemo(() => clientProp || qaClient(apiBase), [clientProp, apiBase]);
  const [view] = useUrlState(urlKey);
  const [tags, setTags] = useState([]);
  const [viewer, setViewer] = useState(undefined);

  const loadTags = useCallback(() => { client.tags().then(setTags, () => {}); }, [client]);
  useEffect(loadTags, [loadTags]);
  // Who is signed in, for every view (a deep link to ?qa=ask never loads the list).
  useEffect(() => {
    if (!client.me) return;
    client.me().then((r) => setViewer((v) => (v === undefined ? r?.viewer ?? null : v)), () => {});
  }, [client]);

  const go = useCallback((next) => {
    const url = new URL(window.location.href);
    if (next == null || next === '') url.searchParams.delete(urlKey); else url.searchParams.set(urlKey, String(next));
    window.history.pushState(window.history.state, '', url);
    window.dispatchEvent(new Event(URL_EVENT));
    try { window.scrollTo(0, 0); } catch { /* jsdom */ }
  }, [urlKey]);
  const hrefFor = useCallback((q) => {
    const url = new URL(window.location.href);
    url.searchParams.set(urlKey, String(q.id));
    return `${url.pathname}${url.search}`;
  }, [urlKey]);

  const shared = { client, go, viewer, setViewer, tags, loadTags, onSignIn, askLabel };
  const id = /^\d+$/.test(view) ? Number(view) : null;
  return (
    <div className={cx('mk-qa', className)}>
      {view === 'ask'
        ? <AskView {...shared} />
        : id
          ? <QuestionView key={id} id={id} {...shared} />
          : <ListView {...shared} title={title} subtitle={subtitle} urlKey={urlKey} hrefFor={hrefFor} />}
    </div>
  );
}

function SignInButton({ onSignIn, children }) {
  if (!onSignIn) return null;
  return <Button variant="secondary" onClick={onSignIn}>{children}</Button>;
}

// ---- list ------------------------------------------------------------------

function ListView({ client, go, viewer, setViewer, tags, onSignIn, askLabel, title, subtitle, urlKey, hrefFor }) {
  const [sort, setSort] = useUrlState(`${urlKey}Sort`, 'active');
  const [tagFilter, setTagFilter] = useUrlList(`${urlKey}Tag`);
  const [q, setQ] = useUrlState(`${urlKey}Q`);
  const [pageRaw] = useUrlState(`${urlKey}Page`, '1');
  const page = Math.max(1, Number(pageRaw) || 1);
  const [text, setText] = useState(q);
  const typed = useDebounced(text, 300);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [reload, setReload] = useState(0);
  const seq = useRef(0);

  useEffect(() => { if (typed !== q) patchUrl({ [`${urlKey}Q`]: typed || null, [`${urlKey}Page`]: null }); }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setText(q); }, [q]);

  const tagKey = tagFilter.join(',');
  useEffect(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    client.list({ sort, tags: tagFilter, q, page }).then(
      (data) => { if (n === seq.current) { setState({ loading: false, error: null, data }); setViewer(data.viewer ?? null); } },
      (error) => { if (n === seq.current) setState((s) => ({ ...s, loading: false, error })); },
    );
  }, [client, sort, tagKey, q, page, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPage = (p) => { patchUrl({ [`${urlKey}Page`]: p > 1 ? p : null }); try { window.scrollTo(0, 0); } catch { /* jsdom */ } };
  const changeSort = (v) => { setSort(v); patchUrl({ [`${urlKey}Page`]: null }); };
  const changeTags = (v) => { setTagFilter(v); patchUrl({ [`${urlKey}Page`]: null }); };
  const addTag = (t) => { if (!tagFilter.includes(t)) changeTags([...tagFilter, t]); };
  const filtered = Boolean(tagFilter.length || q || sort === 'unanswered');
  const clear = () => { setText(''); patchUrl({ [`${urlKey}Tag`]: null, [`${urlKey}Q`]: null, [`${urlKey}Page`]: null, [`${urlKey}Sort`]: sort === 'unanswered' ? null : sort }); };

  const data = state.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  // An old link or a delete can leave the page past the end: go back to the first page.
  useEffect(() => { if (data && !state.loading && page > pages) patchUrl({ [`${urlKey}Page`]: null }); }, [data, state.loading, page, pages, urlKey]);
  const tagOptions = useMemo(() => {
    const opts = tags.map((t) => ({ value: t.tag, label: t.tag, count: t.count }));
    for (const t of tagFilter) if (!opts.some((o) => o.value === t)) opts.push({ value: t, label: t });
    return opts;
  }, [tags, tagFilter]);
  const askButton = viewer
    ? <Button icon={PlusIcon} onClick={() => go('ask')}>{askLabel}</Button>
    : viewer === null ? <SignInButton onSignIn={onSignIn}>Sign in to ask</SignInButton> : null;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={askButton} />
      <Toolbar right={data ? `${data.total.toLocaleString()} ${data.total === 1 ? 'question' : 'questions'}` : null}>
        <Segmented label="Sort questions" items={QA_SORT_ITEMS} value={sort} onChange={changeSort} />
        <FilterMenu label="Tags" allLabel="All tags" options={tagOptions} value={tagFilter} onChange={changeTags} search={8} searchPlaceholder="Find a tag" />
        <SearchInput value={text} onChange={setText} placeholder="Search questions" className="mk-qa-search" />
      </Toolbar>
      {state.error && data && <Banner onRetry={() => setReload((r) => r + 1)}>Couldn’t refresh: {state.error.message}</Banner>}
      <QuestionList
        items={data?.items || []}
        loading={state.loading}
        error={data ? null : state.error}
        onRetry={() => setReload((r) => r + 1)}
        onOpen={(item) => go(item.id)}
        hrefFor={hrefFor}
        onTag={addTag}
        query={q}
        filtered={filtered}
        onClearFilters={clear}
        empty={<EmptyState title="No questions yet" body="Ask the first one." action={askButton} />}
      />
      {pages > 1 && (
        <nav className="mk-qa-pager" aria-label="Pages">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </nav>
      )}
    </>
  );
}

// ---- ask / edit --------------------------------------------------------------

function QuestionForm({ initial, tags, onSubmit, onCancel, submitLabel }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [body, setBody] = useState(initial?.body || '');
  const [tagList, setTagList] = useState(initial?.tags || []);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const tagsId = useId();

  const submit = async (e) => {
    e.preventDefault();
    const local = {};
    if (title.trim().length < 15) local.title = 'Make the title at least 15 characters';
    if (isBlankHtml(body)) local.body = 'Say what you tried and what happened';
    if (!tagList.length) local.tags = 'Add at least one tag';
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      await onSubmit({ title: title.trim(), body, tags: tagList });
    } catch (err) {
      setErrors(err.errors || {});
      setFormError(err.errors ? '' : err.message);
      setSaving(false);
    }
  };

  return (
    <form className="mk-qa-form" onSubmit={submit} noValidate>
      {formError && <Banner>{formError}</Banner>}
      <Field label="Title" hint="One specific sentence, like you would say it to a colleague." error={errors.title}>
        <Input value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} placeholder="How do I…?" />
      </Field>
      <Field label="Details" hint="What you tried, what happened, what you expected." error={errors.body}>
        <div className={cx(errors.body && 'mk-qa-invalid')}>
          <RichTextField value={body} onChange={setBody} disable={EDITOR_DISABLE} minRows={8} ariaLabel="Details" />
        </div>
      </Field>
      <Field label="Tags" hint="Up to 5. Press Enter or comma after each." error={errors.tags} htmlFor={tagsId}>
        <TagInput id={tagsId} value={tagList} onChange={setTagList} suggestions={tags} invalid={Boolean(errors.tags)} />
      </Field>
      <div className="mk-qa-form-actions">
        <Button type="submit" loading={saving}>{submitLabel}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </form>
  );
}

function AskView({ client, go, tags, loadTags, viewer, onSignIn }) {
  const toast = useToast();
  return (
    <>
      <PageHeader title="Ask a question" />
      {viewer === null && (
        <Banner tone="info">You need to sign in to post. <SignInButton onSignIn={onSignIn}>Sign in</SignInButton></Banner>
      )}
      <QuestionForm
        tags={tags}
        submitLabel="Post question"
        onCancel={() => go('')}
        onSubmit={async (data) => {
          const q = await client.ask(data);
          loadTags();
          toast('Question posted');
          go(q.id);
        }}
      />
    </>
  );
}

// ---- question page -------------------------------------------------------------

function QuestionView({ id, client, go, setViewer, tags, loadTags, onSignIn }) {
  const [q, setQ] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const [voting, setVoting] = useState({}); // "question:12" -> true while that vote saves
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    let live = true;
    setError(null);
    client.get(id).then((data) => { if (live) { setQ(data); setViewer(data.viewer ?? null); } }, (err) => { if (live) setError(err); });
    return () => { live = false; };
  }, [client, id, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !q) {
    return (
      <>
        <BackLink go={go} />
        <EmptyState variant="error" title={error.status === 404 ? 'That question is gone' : undefined} body={error.status === 404 ? 'It may have been deleted.' : error.message} onRetry={error.status === 404 ? undefined : () => setReload((r) => r + 1)} />
      </>
    );
  }
  if (!q) return <QuestionSkeleton />;

  const viewer = q.viewer || null;
  const mine = (authorId) => viewer && (viewer.moderator || viewer.id === authorId);
  const run = async (fn, okText) => {
    try {
      const out = await fn();
      if (out && out.answers) setQ(out);
      if (okText) toast(okText);
      return out;
    } catch (err) { toast.error(err.message); throw err; }
  };

  // One vote in flight per post: replies can't land out of order, a double click can't send +1 twice.
  const vote = (kind, post) => async (value) => {
    const key = `${kind}:${post.id}`;
    if (voting[key]) return;
    setVoting((v) => ({ ...v, [key]: true }));
    try {
      const { score, myVote } = await client.vote(kind, post.id, value);
      setQ((cur) => (kind === 'question'
        ? { ...cur, score, myVote }
        : { ...cur, answers: cur.answers.map((a) => (a.id === post.id ? { ...a, score, myVote } : a)) }));
    } catch (err) { toast.error(err.message); } finally {
      setVoting((v) => { const { [key]: _done, ...rest } = v; return rest; });
    }
  };
  const voteProps = (kind, post) => ({
    score: post.score,
    value: post.myVote || 0,
    onVote: vote(kind, post),
    busy: Boolean(voting[`${kind}:${post.id}`]),
    label: kind,
    disabled: !viewer || viewer.id === post.authorId,
    disabledReason: !viewer ? 'Sign in to vote' : 'You can’t vote on your own post',
  });

  const deleteQuestion = async () => {
    if (!(await confirm({ title: 'Delete this question?', body: 'Its answers and comments go too. This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return;
    try { await client.remove(q.id); toast('Question deleted'); loadTags(); go(''); } catch (err) { toast.error(err.message); }
  };
  const toggleClosed = () => run(() => client.update(q.id, { closed: !q.closed }), q.closed ? 'Question reopened' : 'Question closed');

  if (editing) {
    return (
      <>
        <PageHeader title="Edit question" />
        <QuestionForm
          initial={q}
          tags={tags}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (data) => { setQ(await client.update(q.id, data)); loadTags(); setEditing(false); toast('Saved'); }}
        />
      </>
    );
  }

  const isAsker = viewer && viewer.id === q.authorId;
  const answers = q.answers || [];
  return (
    <>
      <BackLink go={go} />
      <PageHeader
        title={q.title}
        meta={(
          <span className="mk-qa-meta">
            <span>Asked <Ago value={q.createdAt} /></span>
            {q.editedAt && <span>Edited <Ago value={q.editedAt} /></span>}
            <span>{q.views} {q.views === 1 ? 'view' : 'views'}</span>
          </span>
        )}
      />
      {q.closed && <Banner tone="warning">This question is closed. It takes no new answers.</Banner>}

      <Post
        kind="question"
        post={q}
        vote={voteProps('question', q)}
        tags={q.tags}
        viewer={viewer}
        client={client}
        onComments={(update) => setQ((cur) => ({ ...cur, comments: update(cur.comments || []) }))}
        actions={(
          <>
            {mine(q.authorId) && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
            {mine(q.authorId) && (viewer.moderator || !answers.length) && <Button variant="ghost" size="sm" onClick={deleteQuestion}>Delete</Button>}
            {viewer?.moderator && <Button variant="ghost" size="sm" onClick={toggleClosed}>{q.closed ? 'Reopen' : 'Close'}</Button>}
          </>
        )}
      />

      <h2 className="mk-qa-answers-title">{answers.length} {answers.length === 1 ? 'answer' : 'answers'}</h2>
      {answers.map((a) => (
        <AnswerPost
          key={a.id}
          answer={a}
          q={q}
          viewer={viewer}
          isAsker={isAsker}
          client={client}
          voteProps={voteProps('answer', a)}
          canEdit={mine(a.authorId)}
          run={run}
          confirm={confirm}
          setQ={setQ}
        />
      ))}

      {!q.closed && (viewer
        ? <AnswerForm onPost={(body) => run(() => client.answer(q.id, body), 'Answer posted')} />
        : viewer === null && onSignIn && (
          <div className="mk-qa-signin">
            <p>Know the answer?</p>
            <SignInButton onSignIn={onSignIn}>Sign in to answer</SignInButton>
          </div>
        ))}
    </>
  );
}

function BackLink({ go }) {
  return <button type="button" className="mk-link-btn mk-qa-back" onClick={() => go('')}>← All questions</button>;
}

function QuestionSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="mk-qa-skel">
      <Skeleton style={{ height: 16, width: 120 }} />
      <Skeleton style={{ height: 32, width: '70%', marginTop: 16 }} />
      <Skeleton style={{ height: 14, width: '90%', marginTop: 24 }} />
      <Skeleton style={{ height: 14, width: '85%', marginTop: 8 }} />
      <Skeleton style={{ height: 14, width: '60%', marginTop: 8 }} />
    </div>
  );
}

function Post({ kind, post, vote, tags, viewer, client, onComments, actions, side, badge, children, className }) {
  return (
    <article className={cx('mk-qa-post', className)} aria-label={kind === 'question' ? 'Question' : `Answer by ${post.authorName}`}>
      <div className="mk-qa-post-side">
        <VoteButtons {...vote} />
        {side}
      </div>
      <div className="mk-qa-post-main">
        {badge}
        {children || <RichText html={post.body} className="mk-qa-body" clean />}
        {tags && <TagList tags={tags} />}
        <div className="mk-qa-post-foot">
          <div className="mk-qa-post-actions">{actions}</div>
          <div className="mk-qa-author">
            <span className="mk-qa-author-name">{post.authorName}</span>
            <span className="mk-qa-author-when">
              {kind === 'question' ? 'asked' : 'answered'} <Ago value={post.createdAt} />
              {post.editedAt && <> · edited <Ago value={post.editedAt} /></>}
            </span>
          </div>
        </div>
        <Comments kind={kind} post={post} viewer={viewer} client={client} onChange={onComments} />
      </div>
    </article>
  );
}

function AnswerPost({ answer: a, q, viewer, isAsker, client, voteProps, canEdit, run, confirm, setQ }) {
  const [editing, setEditing] = useState(false);
  const accept = () => run(() => client.accept(q.id, a.accepted ? null : a.id), a.accepted ? 'Unaccepted' : 'Answer accepted');
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this answer?', body: 'Its comments go too. This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return;
    run(() => client.removeAnswer(a.id), 'Answer deleted').catch(() => {});
  };
  const side = isAsker
    ? (
      <Button
        variant="ghost"
        icon={CheckIcon}
        label={a.accepted ? 'Accepted answer. Click to unaccept' : 'Accept this answer'}
        title={a.accepted ? 'Unaccept' : 'Accept this answer'}
        className={cx('mk-qa-accept', a.accepted && 'mk-qa-accept-on')}
        aria-pressed={a.accepted}
        onClick={() => accept().catch(() => {})}
      />
    )
    : a.accepted && <span className="mk-qa-accept mk-qa-accept-on mk-qa-accept-static" title="Accepted answer"><CheckIcon className="mk-icon" aria-hidden /></span>;

  return (
    <Post
      kind="answer"
      post={a}
      vote={voteProps}
      viewer={viewer}
      client={client}
      className={a.accepted ? 'mk-qa-post-accepted' : undefined}
      side={side}
      badge={a.accepted && <p className="mk-qa-accepted-label"><CheckIcon className="mk-icon" aria-hidden /> Accepted answer</p>}
      onComments={(update) => setQ((cur) => ({ ...cur, answers: cur.answers.map((x) => (x.id === a.id ? { ...x, comments: update(x.comments || []) } : x)) }))}
      actions={canEdit && !editing && (
        <>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={remove}>Delete</Button>
        </>
      )}
    >
      {editing && (
        <AnswerForm
          initial={a.body}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onPost={async (body) => { await run(() => client.updateAnswer(a.id, body), 'Saved'); setEditing(false); }}
        />
      )}
    </Post>
  );
}

function AnswerForm({ initial = '', onPost, onCancel, submitLabel = 'Post your answer' }) {
  const [body, setBody] = useState(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(0);
  const submit = async (e) => {
    e.preventDefault();
    if (isBlankHtml(body)) { setError('Write your answer first'); return; }
    setSaving(true);
    setError('');
    try {
      await onPost(body);
      if (!onCancel) { setBody(''); setKey((k) => k + 1); }
    } catch (err) {
      setError(err.errors?.body || err.message);
    } finally { setSaving(false); }
  };
  return (
    <form className={cx('mk-qa-answer-form', onCancel && 'mk-qa-answer-form-inline')} onSubmit={submit} noValidate>
      {!onCancel && <h2 className="mk-qa-answers-title">Your answer</h2>}
      <div className={cx(error && 'mk-qa-invalid')}>
        <RichTextField key={key} value={body} onChange={setBody} disable={EDITOR_DISABLE} minRows={onCancel ? 4 : 6} ariaLabel="Your answer" />
      </div>
      {error && <p className="mk-error-text" role="alert">{error}</p>}
      <div className="mk-qa-form-actions">
        <Button type="submit" loading={saving}>{submitLabel}</Button>
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>}
      </div>
    </form>
  );
}

function Comments({ kind, post, viewer, client, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const comments = post.comments || [];

  const add = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (body.length < 2) { setError('Write a little more'); return; }
    setSaving(true);
    setError('');
    try {
      const c = await client.comment(kind, post.id, body);
      onChange((list) => [...list, c]);
      setText('');
      setOpen(false);
    } catch (err) { setError(err.errors?.body || err.message); } finally { setSaving(false); }
  };
  const remove = async (c) => {
    if (!(await confirm({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true }))) return;
    try { await client.removeComment(c.id); onChange((list) => list.filter((x) => x.id !== c.id)); } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="mk-qa-comments">
      {comments.length > 0 && (
        <ul className="mk-qa-comment-list" aria-label="Comments">
          {comments.map((c) => (
            <li key={c.id} className="mk-qa-comment">
              <span className="mk-qa-comment-body">{c.body}</span>
              <span className="mk-qa-comment-by"> – {c.authorName} <Ago value={c.createdAt} /></span>
              {viewer && (viewer.moderator || viewer.id === c.authorId) && (
                <Button variant="ghost" size="xs" icon={XIcon} label="Delete comment" className="mk-qa-comment-x" onClick={() => remove(c)} />
              )}
            </li>
          ))}
        </ul>
      )}
      {viewer && !open && <button type="button" className="mk-link-btn mk-qa-add-comment" onClick={() => setOpen(true)}>Add a comment</button>}
      {viewer && open && (
        <form className="mk-qa-comment-form" onSubmit={add} noValidate>
          <Input
            autoFocus
            value={text}
            maxLength={600}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setText(''); setError(''); } }}
            placeholder="Ask for detail or suggest an improvement"
            aria-label="Comment"
            invalid={Boolean(error)}
          />
          <Button type="submit" size="sm" loading={saving}>Comment</Button>
          <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setText(''); setError(''); }}>Cancel</Button>
          {error && <p className="mk-error-text mk-qa-comment-error" role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}

export default QaBoard;
