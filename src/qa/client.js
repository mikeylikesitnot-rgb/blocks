/*
 * Talks to qaRouter (@mn/blocks/server/qa). QaBoard takes any object with these
 * methods, so a test or the demo can pass a fake.
 *   const client = qaClient('/api/qa');
 * A failed call throws an Error with .status and .errors ({field: message} on a 400).
 */
export function qaClient(apiBase = '/api/qa', { fetch: fetchFn, headers = {} } = {}) {
  const base = String(apiBase).replace(/\/$/, '');
  const call = async (method, path, body) => {
    const f = fetchFn || globalThis.fetch;
    const res = await f(`${base}${path}`, {
      method,
      credentials: 'include',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data?.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.errors = data?.errors || null;
      throw err;
    }
    return data;
  };
  const kindPath = (kind) => (kind === 'answer' ? 'answers' : 'questions');
  return {
    list({ sort, tags = [], q, page } = {}) {
      const p = new URLSearchParams();
      if (sort) p.set('sort', sort);
      if (tags.length) p.set('tag', tags.join(','));
      if (q) p.set('q', q);
      if (page > 1) p.set('page', String(page));
      const qs = p.toString();
      return call('GET', `/questions${qs ? `?${qs}` : ''}`);
    },
    tags: () => call('GET', '/tags'),
    me: () => call('GET', '/me'),
    get: (id) => call('GET', `/questions/${id}`),
    ask: (data) => call('POST', '/questions', data),
    update: (id, patch) => call('PATCH', `/questions/${id}`, patch),
    remove: (id) => call('DELETE', `/questions/${id}`),
    answer: (questionId, body) => call('POST', `/questions/${questionId}/answers`, { body }),
    updateAnswer: (id, body) => call('PATCH', `/answers/${id}`, { body }),
    removeAnswer: (id) => call('DELETE', `/answers/${id}`),
    accept: (questionId, answerId) => call('POST', `/questions/${questionId}/accept`, { answerId }),
    vote: (kind, id, value) => call('POST', `/${kindPath(kind)}/${id}/vote`, { value }),
    comment: (kind, id, body) => call('POST', `/${kindPath(kind)}/${id}/comments`, { body }),
    removeComment: (id) => call('DELETE', `/comments/${id}`),
  };
}
