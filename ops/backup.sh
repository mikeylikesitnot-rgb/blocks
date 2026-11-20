#!/bin/sh
# Blocks: nightly VPS backup. One restic snapshot per run of a Postgres dump,
# chosen files (e.g. .env) and folders (uploads, files), encrypted on the VPS
# and stored in Google Drive through rclone; healthchecks.io emails on a
# failed or missed night. Generalised from AutoDealer's scripts/backup.sh.
#
#   backup.sh <config-file>
#
# An app's deploy copies this file from node_modules/@mn/blocks/ops/ to the
# VPS (e.g. ~/<app>/scripts/backup.sh) so the crontab line never changes:
#
#   30 8 * * * $HOME/<app>/scripts/backup.sh $HOME/.config/<app>-backup/env >> $HOME/backups/<app>/backup.log 2>&1
#
# The config is a shell file that lives only on the VPS, never in a repo:
#
#   NAME=turoapp                                  # restic --host; one per app
#   RESTIC_REPOSITORY=rclone:gdrive:TuroApp-backups
#   RESTIC_PASSWORD_FILE=$HOME/.config/turoapp-backup/restic-password
#   HC_PING_URL=https://hc-ping.com/<uuid>        # optional
#   DB_CONTAINER=turoapp-prod-db                  # optional; pg_dump runs inside it
#   DB_FORMAT=plain                               # plain (db.sql.gz) | custom (db.dump)
#   COPY_FILES="$HOME/turoapp/.env $HOME/turoapp/server/.env"   # copied mode 600
#   BACKUP_PATHS="$HOME/turoapp/server/public"    # folders snapshotted in place
#   LOCAL_DIR=$HOME/backups/turoapp               # default $HOME/backups/$NAME
#   KEEP_LOCAL=7 KEEP_DAILY=14 KEEP_WEEKLY=8      # defaults shown
#   CHECK_WEEKDAY=7                               # prune + check day (1=Mon, 7=Sun; 0 = never)
#
# The dump and the folders share one snapshot on purpose: a database that
# holds file metadata restored next to a different night's files points at
# nothing. restic uploads only what changed, so big folders cost little.
#
# The restic password is the only key to the Drive copy. Keep it in the
# password file and in the owner's password manager; lose both and the
# backups cannot be read.
#
# Restore:
#   set -a; . <config-file>; set +a
#   restic snapshots --compact --host "$NAME"
#   restic restore latest --host "$NAME" --target /tmp/restore
set -eu

CONFIG=${1:?usage: backup.sh <config-file>}
. "$CONFIG"

: "${NAME:?set NAME in $CONFIG}"
: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY in $CONFIG}"
: "${RESTIC_PASSWORD_FILE:?set RESTIC_PASSWORD_FILE in $CONFIG}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
LOCAL_DIR=${LOCAL_DIR:-$HOME/backups/$NAME}
DB_FORMAT=${DB_FORMAT:-plain}
KEEP_LOCAL=${KEEP_LOCAL:-7}
KEEP_DAILY=${KEEP_DAILY:-14}
KEEP_WEEKLY=${KEEP_WEEKLY:-8}
CHECK_WEEKDAY=${CHECK_WEEKDAY:-7}
RETRY_WAIT=${RETRY_WAIT:-120}

now() { date -u +%FT%TZ; }
ping_hc() { [ -z "${HC_PING_URL:-}" ] || curl -fsS -m 10 --retry 3 -o /dev/null "$HC_PING_URL${1:-}" || true; }

mkdir -p "$LOCAL_DIR"
# One run at a time: a slow Drive upload must not overlap the next night.
if command -v flock >/dev/null 2>&1; then
  exec 9> "$LOCAL_DIR/.lock"
  flock -n 9 || { echo "$(now) another $NAME backup is still running"; exit 1; }
fi

# Any exit other than success reports a failure, so healthchecks.io emails
# right away instead of waiting out the grace period.
trap 'rc=$?; [ "$rc" = 0 ] || ping_hc /fail' EXIT
ping_hc /start
echo "$(now) $NAME backup starting"

DIR=$LOCAL_DIR/$(date -u +%F)
mkdir -p "$DIR"

if [ -n "${DB_CONTAINER:-}" ]; then
  case $DB_FORMAT in
    plain)
      docker exec "$DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$DIR/db.sql.gz"
      gzip -dc "$DIR/db.sql.gz" | grep -q "PostgreSQL database dump complete" \
        || { echo "$(now) pg_dump output is incomplete"; exit 1; } ;;
    custom)
      docker exec "$DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$DIR/db.dump"
      docker exec -i "$DB_CONTAINER" pg_restore --list < "$DIR/db.dump" > /dev/null \
        || { echo "$(now) pg_dump output is unreadable"; exit 1; } ;;
    *) echo "$(now) DB_FORMAT must be plain or custom, not $DB_FORMAT"; exit 1 ;;
  esac
fi

for f in ${COPY_FILES:-}; do
  [ -f "$f" ] || { echo "$(now) missing file to copy: $f"; exit 1; }
  # parent folder name + file name, so two .env files don't collide
  install -m 600 "$f" "$DIR/$(basename "$(dirname "$f")")-$(basename "$f" | sed 's/^\.//')"
done
for p in ${BACKUP_PATHS:-}; do
  [ -e "$p" ] || { echo "$(now) missing path to back up: $p"; exit 1; }
done

# Drive sometimes times out answering rclone ("context deadline exceeded").
# restic picks up where it left off, so three tries before calling it a
# failure. `unlock` clears only locks left by a dead run, never a live one.
for try in 1 2 3; do
  # shellcheck disable=SC2086  # BACKUP_PATHS is a space-separated list
  restic backup --quiet --host "$NAME" --tag nightly "$DIR" ${BACKUP_PATHS:-} && break
  [ "$try" = 3 ] && { echo "$(now) Drive upload failed 3 times"; exit 1; }
  echo "$(now) Drive upload failed (try $try), retrying in ${RETRY_WAIT}s"
  sleep "$RETRY_WAIT"
  restic unlock --quiet || true
done
restic forget --quiet --host "$NAME" --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY"
# Pruning and checking read back from Drive, so only once a week.
if [ "$(date -u +%u)" = "$CHECK_WEEKDAY" ]; then
  restic prune --quiet
  restic check
fi

# Local copies: the newest KEEP_LOCAL dated folders.
ls -d "$LOCAL_DIR"/20??-??-?? | sort -r | tail -n +"$((KEEP_LOCAL + 1))" | while read -r old; do rm -rf "$old"; done

echo "$(now) $NAME backup done: $(du -sh "$DIR" | cut -f1) local, snapshot $(restic snapshots --compact --host "$NAME" | awk '/^[0-9a-f]{8} /{id=$1} END{print id}')"
ping_hc
