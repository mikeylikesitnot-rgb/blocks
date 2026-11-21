import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowedRequest, isLocalBase, parseArgs, parseLogin, plan, recordShots, ShotError } from '../ops/changelog-shot.mjs';
import { changelogCommits, readChangelog } from '../server/index.js';

const SCRIPT = resolve('ops/changelog-shot.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'blocks-cl-'));
const ok = ['--base', 'http://localhost:5173', '--out', 'changelog/f-092', '--name', 'before'];

describe('changelog-shot options', () => {
  it('reads every option and the pages', () => {
    const o = parseArgs([...ok, '--login', 'POST /api/auth/dev-login {"role":"admin"}', '--phone', '--hide', '.clock', '--hide', 'time', '--wait', 'main', '--full', '/admin?tab=leads', '/admin']);
    expect(o).toMatchObject({ base: 'http://localhost:5173', out: 'changelog/f-092', name: 'before', phone: true, full: true, wait: 'main', hide: ['.clock', 'time'], pages: ['/admin?tab=leads', '/admin'] });
    expect(o.login).toEqual({ method: 'POST', path: '/api/auth/dev-login', data: { role: 'admin' } });
  });

  it('refuses missing or bad options with a plain message', () => {
    expect(() => parseArgs(['--out', 'x', '--name', 'before', '/'])).toThrow(/--base is required/);
    expect(() => parseArgs(['--base', 'http://localhost:1', '--name', 'before', '/'])).toThrow(/--out is required/);
    expect(() => parseArgs([...ok.slice(0, 4), '--name', 'later', '/'])).toThrow(/before or after/);
    expect(() => parseArgs(ok)).toThrow(/at least one page/);
    expect(() => parseArgs([...ok, 'admin'])).toThrow(/starting with \//);
    expect(() => parseArgs([...ok, '//evil.com/x'])).toThrow(/starting with \//);
    expect(() => parseArgs([...ok, '--bogus', '/'])).toThrow(/unknown option/);
    expect(() => parseArgs([...ok, '--hide'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--base', 'http://localhost', '--out', 'changelog/F-092', '--name', 'after', '/'])).toThrow(/lowercase/);
    expect(() => parseArgs([...ok, '/a\\b'])).toThrow(/starting with \//);
    expect(() => parseLogin('POST //evil.com/login')).toThrow(ShotError);
    expect(() => parseLogin('dev-login')).toThrow(ShotError);
    expect(() => parseLogin('POST /login {bad')).toThrow(/not valid JSON/);
    expect(parseLogin('get /me')).toEqual({ method: 'GET', path: '/me', data: undefined });
  });

  it('only allows this computer', () => {
    for (const b of ['http://localhost:5173', 'http://127.0.0.1:3001', 'https://localhost', 'http://[::1]:5173', 'http://127.5.0.1', 'ws://localhost:5173/']) {
      expect(isLocalBase(b), b).toBe(true);
    }
    for (const b of ['https://nextgencarstrucks.com', 'http://192.168.1.4:5173', 'http://localhost.evil.com', 'http://user:pw@localhost', 'file:///etc', 'ftp://localhost', 'localhost:5173', 'http://10.0.0.1', 'http://128.0.0.1', 'http://app.localhost:5173']) {
      expect(isLocalBase(b), b).toBe(false);
    }
    for (const b of ['data:image/png;base64,x', 'blob:http://localhost/1', 'http://localhost/api']) expect(allowedRequest(b), b).toBe(true);
    for (const b of ['https://nextgencarstrucks.com/api/leads', 'https://fonts.gstatic.com/x.woff2']) {
      expect(allowedRequest(b), b).toBe(false);
    }
    expect(() => parseArgs(['--base', 'https://nextgencarstrucks.com', '--out', 'x', '--name', 'after', '/admin'])).toThrow(/not a local address/);
  });

  it('the script stops on a production address before opening a browser', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--base', 'https://nextgencarstrucks.com', '--out', 'x', '--name', 'before', '/admin'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not a local address/);
    const h = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    expect(h.status).toBe(0);
    expect(h.stdout).toMatch(/--phone/);
  });

  it('numbers the shots, desktop then phone for each page', () => {
    expect(plan(parseArgs([...ok, '/a', '/b'])).map((s) => [s.file, s.viewport.width, s.label]))
      .toEqual([['before-1.jpg', 1280, '/a'], ['before-2.jpg', 1280, '/b']]);
    expect(plan(parseArgs([...ok, '--phone', '/a'])).map((s) => [s.file, s.viewport.width, s.label]))
      .toEqual([['before-1.jpg', 1280, '/a (desktop)'], ['before-2.jpg', 390, '/a (phone)']]);
  });

  it('writes the files into entry.json shots, pairing before-N with after-N', () => {
    const dir = tmp();
    recordShots(dir, 'before', [{ file: 'before-1.jpg', label: '/a' }]);
    writeFileSync(join(dir, 'entry.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8')), title: 'Leads', shots: [{ label: 'Leads list', before: 'before-1.jpg' }] }));
    const { entry: e, warnings } = recordShots(dir, 'after', [{ file: 'after-1.jpg', label: '/a' }, { file: 'after-2.jpg', label: '/b' }]);
    expect(e.title).toBe('Leads');
    expect(e.shots).toEqual([{ label: 'Leads list', page: '/a', before: 'before-1.jpg', after: 'after-1.jpg' }, { label: '/b', page: '/b', after: 'after-2.jpg' }]);
    expect(warnings).toEqual([]);
    // A re-run with fewer pages clears that side's old shots; a shot of nothing is dropped.
    expect(recordShots(dir, 'after', [{ file: 'after-1.jpg', label: '/a' }]).entry.shots)
      .toEqual([{ label: 'Leads list', page: '/a', before: 'before-1.jpg', after: 'after-1.jpg' }]);
    // before and after of different pages at the same number is called out.
    expect(recordShots(dir, 'before', [{ file: 'before-1.jpg', label: '/z' }]).warnings[0]).toMatch(/shot 1: before is \/z but after is \/a/);
    writeFileSync(join(dir, 'entry.json'), '{oops');
    expect(() => recordShots(dir, 'after', [])).toThrow(/not valid JSON/);
  });
});

function entryDir(root, id, entry, files = []) {
  mkdirSync(join(root, id), { recursive: true });
  if (entry !== undefined) writeFileSync(join(root, id, 'entry.json'), typeof entry === 'string' ? entry : JSON.stringify(entry));
  for (const f of files) writeFileSync(join(root, id, f), 'x');
}

describe('readChangelog', () => {
  it('reads each folder, prefixes images, and skips broken ones', () => {
    const root = tmp();
    entryDir(root, 'f-091-whats-new', { date: '2026-11-20', type: 'feature', title: 'What is new', links: { page: '/admin' }, shots: [{ label: 'List', before: 'before-1.jpg', after: 'after-1.jpg' }, { before: 'before-9.jpg' }, { after: '../secret.jpg' }] }, ['before-1.jpg', 'after-1.jpg']);
    entryDir(root, 'no-title', { date: '2026-11-20' });
    entryDir(root, 'bad-json', '{');
    entryDir(root, 'array', '[]');
    entryDir(root, 'Upper', { title: 'x', date: '2026-11-20' });
    entryDir(root, 'empty');
    writeFileSync(join(root, 'stray.json'), '{}');
    const list = readChangelog(root, { commits: { 'f-091-whats-new': 'abc1234' } });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'f-091-whats-new', title: 'What is new', links: { page: '/admin', commit: 'abc1234' } });
    expect(list[0].shots).toEqual([{ label: 'List', before: 'f-091-whats-new/before-1.jpg', after: 'f-091-whats-new/after-1.jpg' }]);
  });

  it('keeps a commit the entry already names, and returns [] for a missing folder', () => {
    const root = tmp();
    entryDir(root, 'a', { title: 'A', date: '2026-11-19', links: { commit: 'fff0000' } });
    expect(readChangelog(root, { commits: { a: 'abc1234' } })[0].links.commit).toBe('fff0000');
    expect(readChangelog(join(root, 'nope'))).toEqual([]);
  });
});

describe('changelogCommits', () => {
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();

  it('finds the commit that added each entry, not later edits', () => {
    const repo = tmp();
    git(repo, 'init', '-q');
    entryDir(join(repo, 'changelog'), 'f-089', { title: 'One', date: '2026-11-18' });
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'one');
    const first = git(repo, 'rev-parse', 'HEAD');
    entryDir(join(repo, 'changelog'), 'f-089', { title: 'One, edited', date: '2026-11-18' });
    entryDir(join(repo, 'changelog'), 'f-090', { title: 'Two', date: '2026-11-19' });
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'two');
    const second = git(repo, 'rev-parse', 'HEAD');
    expect(changelogCommits(repo)).toEqual({ 'f-089': first, 'f-090': second });
    expect(changelogCommits(repo, { dir: 'elsewhere' })).toEqual({});
    // A renamed folder is a new entry, credited to the rename commit.
    git(repo, 'mv', 'changelog/f-090', 'changelog/f-090-two');
    git(repo, 'commit', '-qm', 'rename');
    expect(changelogCommits(repo)['f-090-two']).toBe(git(repo, 'rev-parse', 'HEAD'));
    // A shallow clone can't say which commit added what.
    const shallow = tmp();
    git(shallow, 'clone', '-q', '--depth', '1', `file://${repo}`, 'c');
    expect(changelogCommits(join(shallow, 'c'))).toEqual({});
  });

  it('credits an entry added in a merge commit to that merge, and a merged-in entry to its own commit', () => {
    const repo = tmp();
    git(repo, 'init', '-q', '-b', 'main');
    entryDir(join(repo, 'changelog'), 'a-1', { title: 'A', date: '2026-11-18' });
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'a');
    // Another session ships a-2 on main while this branch is open.
    git(repo, 'checkout', '-qb', 'story');
    writeFileSync(join(repo, 'code.txt'), 'story');
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'story code');
    git(repo, 'checkout', '-q', 'main');
    entryDir(join(repo, 'changelog'), 'a-2', { title: 'Other', date: '2026-11-19' });
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'other');
    const other = git(repo, 'rev-parse', 'HEAD');
    // The story merges main in and writes its entry while resolving the merge,
    // then ships by fast-forward (as devflow's ship.sh does).
    git(repo, 'checkout', '-q', 'story');
    git(repo, 'merge', '-q', '--no-commit', '--no-ff', 'main');
    entryDir(join(repo, 'changelog'), 'a-3', { title: 'Story', date: '2026-11-20' });
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'merge main; add entry');
    const merge = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '-q', 'main'); git(repo, 'merge', '-q', '--ff-only', 'story');
    const map = changelogCommits(repo);
    expect(map['a-3']).toBe(merge);
    expect(map['a-2']).toBe(other);
    expect(Object.keys(map).sort()).toEqual(['a-1', 'a-2', 'a-3']);
  });

  it('returns {} outside a git repo', () => {
    expect(changelogCommits(tmp())).toEqual({});
  });
});
