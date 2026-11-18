#!/usr/bin/env bash
# Weekly housekeeping for the small VPS CSbot shares with the shop.
#
# Build cache and unused layers grow with every deploy; the disk filled to 68%
# with ~2 GB of cache before this existed. Images that a running container uses
# are never removed, and CSBOT_KEEP_HOURS (default 168) protects recent ones.
#
#   47 3 * * 0 /opt/csbot/scripts/maintenance.sh >> /var/log/csbot-cleanup.log 2>&1
set -euo pipefail

KEEP=${CSBOT_KEEP_HOURS:-168}

echo "== $(date -u +%FT%TZ) disk before"
df -h / | tail -1

docker builder prune -af --filter "until=${KEEP}h" > /dev/null
docker image prune -af --filter "until=${KEEP}h" > /dev/null
# Only logs of containers that are gone; json-file logging is capped per service.
docker container prune -f > /dev/null

echo "== disk after"
df -h / | tail -1
