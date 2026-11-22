import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ops/automation-chrome.sh with a stub curl standing in for the debug port.
function run({ answers, activePort }) {
  const root = mkdtempSync(join(tmpdir(), 'blocks-chrome-'));
  const bin = join(root, 'bin');
  const profile = join(root, 'profile');
  mkdirSync(bin);
  mkdirSync(profile);
  writeFileSync(join(bin, 'curl'), answers ? `#!/bin/sh\necho '{"webSocketDebuggerUrl":"ws://127.0.0.1:9222/x"}'\n` : '#!/bin/sh\nexit 22\n');
  chmodSync(join(bin, 'curl'), 0o755);
  if (activePort) writeFileSync(join(profile, 'DevToolsActivePort'), `${activePort}\n/devtools/browser/x\n`);
  return spawnSync('sh', [resolve('ops/automation-chrome.sh')], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PROFILE_DIR: profile, CHROME: '/nonexistent/chrome' }, encoding: 'utf8',
  });
}

describe('ops/automation-chrome.sh', () => {
  it('exits 0 when the port answers and it is the automation profile', () => {
    const r = run({ answers: true, activePort: 9222 });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/already running on 127\.0\.0\.1:9222/);
  });
  it('exits 1 when the port answers but it is another Chrome', () => {
    const r = run({ answers: true });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not the automation profile/);
  });
});
