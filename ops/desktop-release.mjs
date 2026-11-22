#!/usr/bin/env node
/*
 * Release an Electron app to GitHub Releases so @mn/blocks/desktop-update can find it.
 * Run from the app's folder, on its integration branch with a clean tree:
 *
 *   node node_modules/@mn/blocks/ops/desktop-release.mjs <patch|minor|major|x.y.z>
 *       [--notes-file notes.md | --notes "text"] [--mac] [--win] [--draft] [--dry-run]
 *
 * 1. checks the tree is clean and not behind its upstream;
 * 2. sets the new version in package.json (+ lock);
 * 3. builds: macOS dmg + zip (the zip is what the updater installs), Windows NSIS
 *    (`npm run dist:win` when the app has it). Default: both on a Mac, Windows elsewhere;
 * 4. commits "Release X", tags vX, pushes both (HEAD to the upstream branch, so a devflow
 *    worktree branch tracking main works);
 * 5. `gh release create vX` with the dmg, zip and exe (GitHub records each file's sha256,
 *    which the updater checks).
 * A failed build stops before anything is committed; package.json is put back. A failed push
 * undoes the local commit and tag; a failed `gh release create` prints the command to retry.
 * Mac only: the macOS zip has to be built on a Mac, and the Windows installer builds there too.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const bump = args.find((a) => !a.startsWith('--') && a !== opt('--notes') && a !== opt('--notes-file'));
const DRY = flag('--dry-run');

function die(msg) { console.error(`desktop-release: ${msg}`); process.exit(1); }
function sh(cmd, cmdArgs, { quiet = false, mutate = false } = {}) {
  if (mutate && DRY) { console.log(`[dry-run] ${cmd} ${cmdArgs.join(' ')}`); return ''; }
  if (!quiet) console.log(`$ ${cmd} ${cmdArgs.join(' ')}`);
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' }) ?? '';
}

export function nextVersion(current, how) {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [a, b, c] = current.split('-')[0].split('.').map(Number);
  if (how === 'major') return `${a + 1}.0.0`;
  if (how === 'minor') return `${a}.${b + 1}.0`;
  if (how === 'patch') return `${a}.${b}.${c + 1}`;
  return null;
}

/** Release files for this version from electron-builder's output folder. */
export function releaseFiles(names, version) {
  return names.filter((n) => n.includes(version) && /\.(dmg|zip|exe)$/i.test(n) && !/\.blockmap$/i.test(n) && !/uninstall/i.test(n));
}

function main() {
  if (!bump) die('say patch, minor, major or x.y.z');
  if (process.platform !== 'darwin') die('run releases from the Mac (the macOS zip the updater installs can only be built there)');
  const pkgPath = join(process.cwd(), 'package.json');
  if (!existsSync(pkgPath)) die('run it from the app folder (no package.json here)');
  const original = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(original);
  const version = nextVersion(pkg.version, bump);
  if (!version) die(`can't work out the version from "${bump}"`);
  const product = pkg.build?.productName || pkg.productName || pkg.name;
  const outDir = pkg.build?.directories?.output || 'dist';
  const doMac = flag('--mac') || !flag('--win');
  const doWin = flag('--win') || !flag('--mac');

  if (sh('git', ['status', '--porcelain'], { quiet: true }).trim()) die('the working tree has changes: commit or stash them first');
  sh('git', ['fetch', '--quiet'], { quiet: true });
  let behind;
  try { behind = sh('git', ['rev-list', '--count', 'HEAD..@{u}'], { quiet: true }).trim(); } catch { die('this branch has no upstream: push it once with `git push -u origin <branch>`'); }
  if (behind !== '0') die(`this branch is ${behind} commit(s) behind its upstream: pull first`);
  // Push to the upstream by name, so it also works from a worktree branch that tracks main.
  const upstream = sh('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { quiet: true }).trim();
  const remote = upstream.split('/')[0];
  const upBranch = upstream.slice(remote.length + 1);
  if (sh('git', ['tag', '--list', `v${version}`], { quiet: true }).trim()) die(`tag v${version} already exists`);
  try { sh('gh', ['--version'], { quiet: true }); } catch { die('the GitHub CLI (gh) is needed'); }

  console.log(`Releasing ${product} ${pkg.version} -> ${version} (${[doMac && 'macOS', doWin && 'Windows'].filter(Boolean).join(' + ')})${DRY ? ' [dry run]' : ''}`);
  const restore = () => { if (!DRY) { writeFileSync(pkgPath, original); try { sh('git', ['checkout', '--', 'package-lock.json'], { quiet: true }); } catch { /* no lock */ } } };
  try {
    sh('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], { mutate: true });
    if (doMac) sh('npx', ['electron-builder', '--mac', 'dmg', 'zip', '--publish', 'never'], { mutate: true });
    if (doWin) {
      if (pkg.scripts?.['dist:win']) sh('npm', ['run', 'dist:win', '--', '--publish', 'never'], { mutate: true });
      else sh('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never'], { mutate: true });
    }
  } catch (e) {
    restore();
    die(`build failed, nothing committed: ${e.message}`);
  }

  const files = DRY ? [] : releaseFiles(readdirSync(outDir), version).map((n) => join(outDir, n));
  if (!DRY && !files.length) { restore(); die(`no release files for ${version} in ${outDir}/`); }
  if (!DRY && doMac && !files.some((f) => f.endsWith('.zip'))) { restore(); die('no macOS .zip built: the updater needs it'); }
  console.log(files.length ? `Files:\n  ${files.join('\n  ')}` : '');

  const lock = existsSync('package-lock.json') ? ['package-lock.json'] : [];
  sh('git', ['add', 'package.json', ...lock], { mutate: true });
  sh('git', ['commit', '-m', `Release ${version}`], { mutate: true });
  sh('git', ['tag', `v${version}`], { mutate: true });
  try {
    sh('git', ['push', remote, `HEAD:${upBranch}`], { mutate: true });
  } catch (e) {
    // Someone pushed during the build: undo the local commit and tag so a re-run starts clean.
    sh('git', ['tag', '-d', `v${version}`], { quiet: true });
    sh('git', ['reset', '--soft', 'HEAD~1'], { quiet: true });
    restore();
    die(`push failed (pull, then run the release again); the local commit and tag were undone: ${e.message}`);
  }
  const notes = opt('--notes-file') ? ['--notes-file', opt('--notes-file')] : opt('--notes') ? ['--notes', opt('--notes')] : ['--generate-notes'];
  const ghArgs = ['release', 'create', `v${version}`, ...files, '--title', `${product} ${version}`, ...notes, ...(flag('--draft') ? ['--draft'] : [])];
  try {
    sh('git', ['push', remote, `v${version}`], { mutate: true });
    sh('gh', ghArgs, { mutate: true });
  } catch (e) {
    die(`the release commit is pushed but publishing failed: ${e.message}\nFinish it with:\n  git push origin v${version}\n  gh ${ghArgs.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  }
  console.log(DRY ? 'Dry run done: nothing was built, committed or published.' : `Released ${product} ${version}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
