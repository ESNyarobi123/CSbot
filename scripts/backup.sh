#!/usr/bin/env bash
# Nightly CSbot database backup.
#
# The chats, sales and customer memory are the only copy of the shop's history,
# and until now there was no backup of this database at all. Run from cron:
#
#   17 1 * * * /opt/csbot/scripts/backup.sh >> /var/log/csbot-backup.log 2>&1
#
# The dump is written to CSBOT_BACKUP_DIR (default /opt/csbot-backups) and kept
# for CSBOT_BACKUP_KEEP days (default 14). Copy the folder off the VPS too: a
# backup on the same disk does not survive a lost server.
set -euo pipefail

cd "$(dirname "$0")/.."

DIR=${CSBOT_BACKUP_DIR:-/opt/csbot-backups}
KEEP=${CSBOT_BACKUP_KEEP:-14}
COMPOSE=${CSBOT_COMPOSE:-"docker compose -f compose.yaml -f compose.prod.yaml"}

mkdir -p "$DIR"
stamp=$(date -u +%Y%m%d-%H%M%S)
file="$DIR/csbot-$stamp.dump"

echo "== $(date -u +%FT%TZ) backup to $file"
# Custom format (-Fc) is compressed and restorable table by table.
$COMPOSE exec -T postgres pg_dump -U csbot -d csbot -Fc -Z6 > "$file"

if [ ! -s "$file" ]; then
  echo "backup is empty; keeping no file" >&2
  rm -f "$file"
  exit 1
fi

# Read the archive back through pg_restore so a truncated dump fails here and
# not on the day it is needed.
if ! $COMPOSE exec -T postgres pg_restore --list < "$file" > /dev/null; then
  echo "backup cannot be read by pg_restore" >&2
  mv "$file" "$file.broken"
  exit 1
fi

find "$DIR" -name 'csbot-*.dump' -type f -mtime +"$KEEP" -delete
echo "== $(du -h "$file" | cut -f1) written; keeping the last $KEEP days"
