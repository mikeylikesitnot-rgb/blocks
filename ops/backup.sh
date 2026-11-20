#!/bin/sh
# Blocks: nightly VPS backup. One restic snapshot per run of a Postgres dump,
# chosen files (e.g. .env) and folders (uploads, files), encrypted on the VPS
# and stored in Google Drive through rclone; healthchecks.io emails on a
# failed or missed night; once a week the dump is read back from Drive and
# restored into a scratch database to prove it works. Built from TuroApp's and
# AutoDealer's scripts/backup.sh.
#
#   backup.sh <config-file>
#   RESTORE_TEST=1 backup.sh <config-file>    # run the restore test today too
#
# An app's deploy copies this file from node_modules/@mn/blocks/ops/ to the
# VPS (e.g. ~/<app>/scripts/backup.sh) so the crontab line never changes:
#
#   30 10 * * * $HOME/<app>/scripts/backup.sh $HOME/.config/<app>-backup/env >> $HOME/backups/<app>/backup.log 2>&1
#
# The config is a shell file that lives only on the VPS, never in a repo:
#
#   NAME=turoapp                                  # restic --host; one per app
#   RESTIC_REPOSITORY=rclone:gdrive:TuroApp-backups
#   RESTIC_PASSWORD_FILE=$HOME/.config/turoapp-backup/restic-password
#   HC_PING_URL=https://hc-ping.com/<uuid>        # optional
#   DB_CONTAINER=turoapp-prod-db                  # optional; pg_dump runs inside it
#   DB_FORMAT=custom                              # plain (gzipped SQL) | custom (pg_dump -Fc)
#   DB_FILE=turo.dump                             # default db.sql.gz / db.dump
#   DB_CHECK_TABLE=Turo                           # optional: the dump must hold this table's data
#   RESTORE_TEST_TABLES="Turo Task Car"           # optional: weekly restore test compares these counts
#   COPY_FILES="$HOME/turoapp/.env:env $HOME/turoapp/server/.env:server.env"   # path[:name], mode 600
#   BACKUP_PATHS="$HOME/turoapp/server/public"    # folders snapshotted in place
#   LOCAL_DIR=$HOME/backups/turoapp               # default $HOME/backups/$NAME
#   KEEP_LOCAL=7 KEEP_DAILY=14 KEEP_WEEKLY=8      # defaults shown
#   CHECK_WEEKDAY=7                               # prune, check, restore test (1=Mon, 7=Sun; 0 = never)
#
# The dump and the folders share one snapshot on purpose: a database that
# holds file metadata restored next to a different night's files points at
# nothing. restic uploads only what changed, so big folders cost little.
#
# Tonight's files are staged in one fixed folder ($LOCAL_DIR/current) and
# `forget` groups by host: restic groups snapshots by the paths backed up, so
# a dated path would make every night its own group and the keep rules would
# never delete anything. A dated local copy is made afterwards.
#
# The restic password is the only key to the Drive copy. Keep it in the
# password file and in the owner's password manager; lose both and the
# backups cannot be read.
#
# Restore:
#   set -a; . <config-file>; set +a
#   restic snapshots --compact --host "$NAME"
#   restic restore latest --host "$NAME" --target /tmp/restore
#   # the dump is at /tmp/restore$LOCAL_DIR/current/$DB_FILE
set -eu

CONFIG=${1:?usage: backup.sh <config-file>}
. "$CONFIG"

: "${NAME:?set NAME in $CONFIG}"
: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY in $CONFIG}"
: "${RESTIC_PASSWORD_FILE:?set RESTIC_PASSWORD_FILE in $CONFIG}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
LOCAL_DIR=${LOCAL_DIR:-$HOME/backups/$NAME}
DB_FORMAT=${DB_FORMAT:-plain}
case $DB_FORMAT in
  plain) DB_FILE=${DB_FILE:-db.sql.gz} ;;
  custom) DB_FILE=${DB_FILE:-db.dump} ;;
  *) echo "DB_FORMAT must be plain or custom, not $DB_FORMAT"; exit 1 ;;
esac
KEEP_LOCAL=${KEEP_LOCAL:-7}
KEEP_DAILY=${KEEP_DAILY:-14}
KEEP_WEEKLY=${KEEP_WEEKLY:-8}
CHECK_WEEKDAY=${CHECK_WEEKDAY:-7}
RETRY_WAIT=${RETRY_WAIT:-120}
RESTORE_TEST=${RESTORE_TEST:-}

log() { echo "$(date -u +%FT%TZ) $NAME $*"; }
ping_hc() { [ -z "${HC_PING_URL:-}" ] || curl -fsS -m 10 --retry 3 -o /dev/null "$HC_PING_URL${1:-}" || true; }
dbx() { docker exec -i "$DB_CONTAINER" "$@"; }

mkdir -p "$LOCAL_DIR"
# One run at a time: a slow Drive upload must not overlap the next night.
if command -v flock >/dev/null 2>&1; then
  exec 9> "$LOCAL_DIR/.lock"
  flock -n 9 || { log "another backup is still running"; exit 1; }
fi

# Any exit other than success reports a failure, so healthchecks.io emails
# right away. It also removes the restore test's temp folder.
T=
trap 'rc=$?; [ -z "$T" ] || rm -rf "$T"; [ "$rc" = 0 ] || ping_hc /fail' EXIT
ping_hc /start
log "backup starting"

DIR=$LOCAL_DIR/current
rm -rf "$DIR"
mkdir -p "$DIR"

if [ -n "${DB_CONTAINER:-}" ]; then
  if [ "$DB_FORMAT" = plain ]; then
    dbx sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$DIR/$DB_FILE"
    gzip -dc "$DIR/$DB_FILE" | grep -q "PostgreSQL database dump complete" \
      || { log "pg_dump output is incomplete"; exit 1; }
    if [ -n "${DB_CHECK_TABLE:-}" ]; then
      gzip -dc "$DIR/$DB_FILE" | grep -Eq "^COPY public\.\"?$DB_CHECK_TABLE\"? " \
        || { log "pg_dump has no data for table $DB_CHECK_TABLE"; exit 1; }
    fi
  else
    dbx sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$DIR/$DB_FILE"
    dbx pg_restore --list < "$DIR/$DB_FILE" > "$DIR/.list" || { log "pg_dump output is unreadable"; exit 1; }
    if [ -n "${DB_CHECK_TABLE:-}" ]; then
      grep -q "TABLE DATA public $DB_CHECK_TABLE " "$DIR/.list" \
        || { log "pg_dump has no data for table $DB_CHECK_TABLE"; exit 1; }
    fi
    rm -f "$DIR/.list"
  fi
fi

for item in ${COPY_FILES:-}; do
  src=${item%%:*}
  name=${item#*:}
  # no :name given → parent folder + file name, so two .env files don't collide
  [ "$name" != "$item" ] || name="$(basename "$(dirname "$src")")-$(basename "$src" | sed 's/^\.//')"
  [ -f "$src" ] || { log "missing file to copy: $src"; exit 1; }
  install -m 600 "$src" "$DIR/$name"
done
for p in ${BACKUP_PATHS:-}; do
  [ -e "$p" ] || { log "missing path to back up: $p"; exit 1; }
done

# Drive sometimes times out answering rclone ("context deadline exceeded").
# restic picks up where it left off, so three tries before calling it a
# failure. `unlock` clears only locks left by a dead run, never a live one.
for try in 1 2 3; do
  # BACKUP_PATHS is a space-separated list, split on purpose
  restic backup --quiet --host "$NAME" --tag nightly "$DIR" ${BACKUP_PATHS:-} && break
  [ "$try" = 3 ] && { log "Drive upload failed 3 times"; exit 1; }
  log "Drive upload failed (try $try), retrying in ${RETRY_WAIT}s"
  sleep "$RETRY_WAIT"
  restic unlock --quiet || true
done
restic forget --quiet --host "$NAME" --tag nightly --group-by host --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY"

# Weekly: prune and check (both read back from Drive), and prove a restore works.
if [ "$(date -u +%u)" = "$CHECK_WEEKDAY" ] || [ -n "$RESTORE_TEST" ]; then
  restic prune --quiet
  restic check
  if [ -n "${DB_CONTAINER:-}" ] && [ -n "${RESTORE_TEST_TABLES:-}" ]; then
    T=$(mktemp -d)
    restic restore latest --host "$NAME" --include "$DIR/$DB_FILE" --target "$T" --quiet
    PGU=$(dbx printenv POSTGRES_USER)
    PGD=$(dbx printenv POSTGRES_DB)
    psql_in() { db=$1; shift; dbx psql -q -tA -v ON_ERROR_STOP=1 -U "$PGU" -d "$db" "$@"; }
    psql_in postgres -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check TEMPLATE template0"
    if [ "$DB_FORMAT" = plain ]; then
      gzip -dc "$T$DIR/$DB_FILE" | psql_in restore_check > /dev/null
    else
      dbx pg_restore -U "$PGU" -d restore_check --no-owner < "$T$DIR/$DB_FILE"
    fi
    bad=; got=; live=
    for t in $RESTORE_TEST_TABLES; do
      g=$(psql_in restore_check -c "SELECT COUNT(*) FROM \"$t\"")
      l=$(psql_in "$PGD" -c "SELECT COUNT(*) FROM \"$t\"")
      got="$got $t=$g"; live="$live $t=$l"
      # Live may have gained rows since the dump; the restored copy must not be empty or bigger.
      { [ "$g" -gt 0 ] && [ "$g" -le "$l" ]; } || bad=1
    done
    psql_in postgres -c "DROP DATABASE restore_check"
    rm -rf "$T"; T=
    [ -z "$bad" ] || { log "restore test FAILED: restored$got, live$live"; exit 1; }
    log "restore test ok: restored$got, live$live"
  fi
fi

# Local copies: tonight's files as a dated folder; the newest KEEP_LOCAL kept.
DAY=$LOCAL_DIR/$(date -u +%F)
rm -rf "$DAY"
cp -a "$DIR" "$DAY"
ls -d "$LOCAL_DIR"/20??-??-?? | sort -r | tail -n +"$((KEEP_LOCAL + 1))" | while read -r old; do rm -rf "$old"; done

log "backup done: $(du -sh "$DAY" | cut -f1) local, snapshot $(restic snapshots --compact --host "$NAME" | awk '/^[0-9a-f]{8} /{id=$1} END{print id}')"
ping_hc
