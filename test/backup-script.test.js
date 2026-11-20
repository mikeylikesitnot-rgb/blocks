import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ops/backup.sh run against stub docker / restic / curl on PATH. The stubs log
// their arguments; RESTIC_FAIL makes the first N `restic backup` calls fail.
const SCRIPT = resolve('ops/backup.sh');

function setup({ dump = 'ok', resticFail = 0, config = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'blocks-backup-'));
  const bin = join(root, 'bin');
  const app = join(root, 'app');
  mkdirSync(bin);
  mkdirSync(join(app, 'uploads'), { recursive: true });
  mkdirSync(join(app, 'server'), { recursive: true });
  writeFileSync(join(app, '.env'), 'SECRET=1\n');
  writeFileSync(join(app, 'server', '.env'), 'KEY=2\n');
  writeFileSync(join(root, 'pw'), 'pw\n');
  const log = join(root, 'calls.log');
  const stub = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('docker', dump === 'ok'
    ? 'echo "-- PostgreSQL database dump complete"'
    : 'echo "-- half a dump"');
  stub('restic', `
if [ "$1" = backup ]; then
  n=$(cat "${root}/tries" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "${root}/tries"
  [ "$n" -le ${resticFail} ] && exit 1
fi
[ "$1" = snapshots ] && echo "abcd1234 2026-11-20 host"
exit 0`);
  stub('curl', 'exit 0');
  const cfg = {
    NAME: 'testapp',
    RESTIC_REPOSITORY: 'rclone:gdrive:Test-backups',
    RESTIC_PASSWORD_FILE: join(root, 'pw'),
    HC_PING_URL: 'https://hc.example/uuid',
    DB_CONTAINER: 'test-db',
    COPY_FILES: `${join(app, '.env')} ${join(app, 'server', '.env')}`,
    BACKUP_PATHS: join(app, 'uploads'),
    LOCAL_DIR: join(root, 'backups'),
    RETRY_WAIT: '0',
    CHECK_WEEKDAY: '0',
    ...config,
  };
  const conf = join(root, 'env');
  writeFileSync(conf, Object.entries(cfg).map(([k, v]) => `${k}="${v}"`).join('\n') + '\n');
  const run = () => spawnSync('sh', [SCRIPT, conf], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: root },
  });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  return { root, app, cfg, run, calls };
}

describe.skipIf(process.platform === 'win32')('ops/backup.sh', () => {
  it('passes sh -n', () => {
    execFileSync('sh', ['-n', SCRIPT]);
  });

  it('dumps, copies files, snapshots everything once and pings success', () => {
    const t = setup();
    const r = t.run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const [day] = readdirSync(t.cfg.LOCAL_DIR).filter((d) => /^20/.test(d));
    const dir = join(t.cfg.LOCAL_DIR, day);
    expect(readdirSync(dir).sort()).toEqual(['app-env', 'db.sql.gz', 'server-env']);
    const calls = t.calls();
    expect(calls).toMatch(`restic backup --quiet --host testapp --tag nightly ${dir} ${t.app}/uploads`);
    expect(calls).toMatch('restic forget --quiet --host testapp --keep-daily 14 --keep-weekly 8');
    expect(calls).not.toMatch('restic prune');
    expect(calls).toMatch('curl -fsS -m 10 --retry 3 -o /dev/null https://hc.example/uuid/start');
    expect(calls.trim().split('\n').pop()).toBe('curl -fsS -m 10 --retry 3 -o /dev/null https://hc.example/uuid');
    expect(r.stdout).toMatch('testapp backup done');
    expect(r.stdout).toMatch('snapshot abcd1234');
  });

  it('fails and pings /fail when the dump is incomplete, before uploading', () => {
    const t = setup({ dump: 'bad' });
    const r = t.run();
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch('pg_dump output is incomplete');
    expect(t.calls()).not.toMatch('restic backup');
    expect(t.calls()).toMatch('/uuid/fail');
  });

  it('retries a failed upload, unlocking between tries', () => {
    const t = setup({ resticFail: 2 });
    const r = t.run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(t.calls().match(/restic backup/g)).toHaveLength(3);
    expect(t.calls().match(/restic unlock/g)).toHaveLength(2);
  });

  it('gives up after three failed uploads', () => {
    const t = setup({ resticFail: 3 });
    const r = t.run();
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch('Drive upload failed 3 times');
    expect(t.calls()).toMatch('/uuid/fail');
  });

  it('refuses a missing folder or file instead of backing up less', () => {
    const t = setup({ config: { BACKUP_PATHS: '/nope/uploads' } });
    const r = t.run();
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch('missing path to back up: /nope/uploads');
    expect(t.calls()).not.toMatch('restic backup');
  });

  it('keeps only the newest KEEP_LOCAL dated folders', () => {
    const t = setup({ config: { KEEP_LOCAL: '2' } });
    for (const d of ['2020-01-01', '2020-01-02', '2020-01-03']) mkdirSync(join(t.cfg.LOCAL_DIR, d), { recursive: true });
    const r = t.run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const left = readdirSync(t.cfg.LOCAL_DIR).filter((d) => /^20/.test(d)).sort();
    expect(left).toHaveLength(2);
    expect(left[0]).toBe('2020-01-03');
  });

  it('works without a database or a healthcheck', () => {
    const t = setup({ config: { DB_CONTAINER: '', HC_PING_URL: '' } });
    const r = t.run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(t.calls()).not.toMatch(/^docker|^curl/m);
  });
});
