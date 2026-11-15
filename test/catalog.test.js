import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

// CATALOG.md lists every export; scripts/catalog.mjs fails if an export has no
// description or the committed file is stale. Fix with `npm run catalog`.
describe('CATALOG.md', () => {
  it('describes every export and is up to date', () => {
    execFileSync(process.execPath, ['scripts/catalog.mjs', '--check'], { stdio: 'pipe' });
  });
});
