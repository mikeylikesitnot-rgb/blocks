import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ops/backup.sh run against stub docker / restic / curl on PATH. The stubs log
// their arguments. Knobs: dump ('ok' | 'bad'), resticFail (first N `restic
// backup` calls fail), counts {live, restored} for the restore test.
const SCRIPT = resolve('ops/backup.sh');

function setup({ dump = 'ok', resticFail = 0, counts = { live: 10, restored: 10 }, config = {} } = {}) {
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
  const good = dump === 'ok';
  stub('docker', `
shift 3   # exec -i <container>
case "$*" in
  *pg_dump*-Fc*) echo ${good ? 'CUSTOM-DUMP' : 'BROKEN'} ;;
  *pg_dump*) printf '%s\\n' ${good ? `'COPY public."Turo" (id) FROM stdin;' '-- PostgreSQL database dump complete'` : `'-- half a dump'`} ;;
  "pg_restore --list") cat > /dev/null; ${good ? `echo "215; 0 16390 TABLE DATA public Turo turo"` : 'exit 1'} ;;
  pg_restore*) cat > /dev/null ;;
  "printenv POSTGRES_USER") echo turo ;;
  "printenv POSTGRES_DB") echo turo ;;
  *"-d restore_check -c SELECT"*) echo ${counts.restored} ;;
  *"-d turo -c SELECT"*) echo ${counts.live} ;;
  *"-d restore_check") cat > /dev/null ;;
esac
exit 0`);
  stub('restic', `
case "$1" in
  backup)
    n=$(cat "${root}/tries" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "${root}/tries"
    [ "$n" -le ${resticFail} ] && exit 1 ;;
  restore)
    while [ $# -gt 0 ]; do case "$1" in --include) inc=$2 ;; --target) tgt=$2 ;; esac; shift; done
    mkdir -p "$tgt$(dirname "$inc")" && echo restored > "$tgt$inc" ;;
  snapshots) echo "abcd1234 2026-11-20 host" ;;
esac
exit 0`);
  stub('curl', 'exit 0');
  const cfg = {
    NAME: 'testapp',
    RESTIC_REPOSITORY: 'rclone:gdrive:Test-backups',
    RESTIC_PASSWORD_FILE: join(root, 'pw'),
    HC_PING_URL: 'https://hc.example/uuid',
    DB_CONTAINER: 'test-db',
    COPY_FILES: `${join(app, '.env')} ${join(app, 'server', '.env')}:server.env`,
    BACKUP_PATHS: join(app, 'uploads'),
    LOCAL_DIR: join(root, 'backups'),
    RETRY_WAIT: '0',
    CHECK_WEEKDAY: '0',
    ...config,
  };
  const conf = join(root, 'env');
  writeFileSync(conf, Object.entries(cfg).map(([k, v]) => `${k}="${v}"`).join('\n') + '\n');
  const run = (env = {}) => spawnSync('sh', [SCRIPT, conf], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: root, RESTORE_TEST: '', ...env },
  });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  const days = () => readdirSync(cfg.LOCAL_DIR).filter((d) => /^20/.test(d)).sort();
  return { root, app, cfg, run, calls, days };
}

describe.skipIf(process.platform === 'win32')('ops/backup.sh', () => {
  it('passes sh -n', () => {
    execFileSync('sh', ['-n', SCRIPT]);
  });

  it('stages in one fixed folder, snapshots it with the folders, keeps a dated copy and pings success', () => {
    const t = setup();
    const r = t.run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const cur = join(t.cfg.LOCAL_DIR, 'current');
    expect(readdirSync(cur).sort()).toEqual(['app-env', 'db.sql.gz', 'server.env']);
    expect(t.days()).toHaveLength(1);
    expect(readdirSync(join(t.cfg.LOCAL_DIR, t.days()[0])).sort()).toEqual(['app-env', 'db.sql.gz', 'server.env']);
    const calls = t.calls();
    expect(calls).toMatch(`restic backup --quiet --host testapp --tag nightly ${cur} ${t.app}/uploads`);
    // grouped by host: a changing path would stop the keep rules from ever deleting
    expect(calls).toMatch('restic forget --quiet --host testapp --tag nightly --group-by host --keep-daily 14 --keep-weekly 8');
    expect(calls).not.toMatch('restic prune');
    expect(calls).toMatch('curl -fsS -m 10 --retry 3 -o /dev/null https://hc.example/uuid/start');
    expect(calls.trim().split('\n').pop()).toBe('curl -fsS -m 10 --retry 3 -o /dev/null https://hc.example/uuid');
    expect(r.stdout).toMatch('testapp backup done');
    expect(r.stdout).toMatch('snapshot abcd1234');
  });

  it('custom format: names the file, checks the table is in the dump', () => {
    const t = setup({ config: { DB_FORMAT: 'custom', DB_FILE: 'turo.dump', DB_CHECK_TABLE: 'Turo' } });
    const r = t.run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readdirSync(join(t.cfg.LOCAL_DIR, 'current'))).toContain('turo.dump');
    expect(t.calls()).toMatch('pg_restore --list');
  });

  it('fails when the checked table is missing from the dump', () => {
    const t = setup({ config: { DB_CHECK_TABLE: 'Nope' } });
    const r = t.run();
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch('pg_dump has no data for table Nope');
    expect(t.calls()).not.toMatch('restic backup');
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

  it('restore test: prunes, checks, restores into a scratch database and compares counts', () => {
    for (const fmt of ['plain', 'custom']) {
      const t = setup({ counts: { live: 12, restored: 10 }, config: { DB_FORMAT: fmt, RESTORE_TEST_TABLES: 'Turo Car' } });
      const r = t.run({ RESTORE_TEST: '1' });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const calls = t.calls();
      expect(calls).toMatch('restic prune');
      expect(calls).toMatch('restic check');
      expect(calls).toMatch(/restic restore latest --host testapp --include \S+\/current\/db\./);
      expect(calls).toMatch('CREATE DATABASE restore_check');
      expect(calls).toMatch('DROP DATABASE restore_check');
      expect(r.stdout).toMatch('restore test ok: restored Turo=10 Car=10, live Turo=12 Car=12');
    }
  });

  it('restore test fails on an empty restore and pings /fail', () => {
    const t = setup({ counts: { live: 12, restored: 0 }, config: { RESTORE_TEST_TABLES: 'Turo' } });
    const r = t.run({ RESTORE_TEST: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch('restore test FAILED');
    expect(t.calls()).toMatch('/uuid/fail');
  });

  it('keeps only the newest KEEP_LOCAL dated folders', () => {
    const t = setup({ config: { KEEP_LOCAL: '2' } });
    for (const d of ['2020-01-01', '2020-01-02', '2020-01-03']) mkdirSync(join(t.cfg.LOCAL_DIR, d), { recursive: true });
    const r = t.run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(t.days()).toHaveLength(2);
    expect(t.days()[0]).toBe('2020-01-03');
  });

  it('works without a database or a healthcheck', () => {
    const t = setup({ config: { DB_CONTAINER: '', HC_PING_URL: '' } });
    const r = t.run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(t.calls()).not.toMatch(/^docker|^curl/m);
  });
});
