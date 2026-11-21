// Changelog folders: one per entry, changelog/<id>/entry.json plus its
// screenshots (before-1.jpg, after-1.jpg ...). ops/changelog-shot.mjs takes the
// screenshots; the Changelog block shows the list.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const CHANGELOG_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const CHANGELOG_IMAGE = /^(before|after)-\d{1,3}\.(jpg|jpeg|png|webp)$/;

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/**
 * Read every changelog/<id>/entry.json into one list for the Changelog block.
 * Each entry gets id = its folder name, and its image names become
 * "<id>/<file>" (so baseUrl + path finds them). Folders with an odd name, no
 * entry.json, broken JSON, or no title are skipped (normalizeChangelog then
 * drops entries without a real date). Images that aren't in the
 * folder, or whose name isn't before-N / after-N, are dropped.
 * `commits` ({ id: hash }, from changelogCommits) fills links.commit when the
 * entry doesn't have one.
 */
export function readChangelog(dir, { commits = {} } = {}) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const id of names.sort()) {
    if (!CHANGELOG_ID.test(id)) continue;
    const file = join(dir, id, 'entry.json');
    if (!isFile(file)) continue;
    let e;
    try { e = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.title !== 'string' || !e.title.trim()) continue;
    const img = (f) => (typeof f === 'string' && CHANGELOG_IMAGE.test(f) && isFile(join(dir, id, f)) ? `${id}/${f}` : null);
    const shots = (Array.isArray(e.shots) ? e.shots : [])
      .map((s) => (s && typeof s === 'object' ? { label: typeof s.label === 'string' ? s.label : '', before: img(s.before), after: img(s.after) } : null))
      .filter((s) => s && (s.before || s.after));
    const links = { ...(e.links && typeof e.links === 'object' ? e.links : {}) };
    if (!links.commit && commits[id]) links.commit = commits[id];
    out.push({ ...e, id, links, shots });
  }
  return out;
}

/**
 * { id: hash } of the commit that first added each changelog/<id>/entry.json,
 * so an entry gets its Commit link without anyone typing a hash. `dir` is the
 * changelog folder relative to the repo (default "changelog"). Returns {} when
 * git or the repo isn't there (e.g. on a server without git: run it at deploy
 * and ship the result), and in a shallow clone, where the oldest commit present
 * would be credited with every entry.
 */
export function changelogCommits(repoDir, { dir = 'changelog' } = {}) {
  const rel = relative(resolve(repoDir), resolve(repoDir, dir)).split('\\').join('/') || '.';
  const git = (args) => execFileSync('git', args, {
    cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024,
  });
  let text;
  try {
    if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') return {};
    text = git(['log', '--reverse', '--no-renames', '--diff-filter=A', '--format=%x00%H', '--name-only', '--', `${rel}/*/entry.json`]);
  } catch { return {}; }
  const map = {};
  for (const block of text.split('\0').slice(1)) {
    const [hash, ...files] = block.trim().split('\n');
    for (const f of files) {
      const m = f.trim().match(/([^/]+)\/entry\.json$/);
      if (m && CHANGELOG_ID.test(m[1]) && !map[m[1]]) map[m[1]] = hash.trim();
    }
  }
  return map;
}
