#!/usr/bin/env bash
# Deploy CSbot on the shared production server.
#
# Run from the repository root on the server:  ./scripts/deploy.sh
#
# Pulls the latest commit, rebuilds the images and restarts the stack. The
# PostgreSQL volume is untouched, so conversations and WhatsApp sessions
# survive a deploy. The migrate service runs on every `up` and only applies
# migrations that have not been recorded yet.
set -euo pipefail
cd "$(dirname "$0")/.."

compose=(docker compose -f compose.yaml -f compose.prod.yaml)

echo "==> Pulling latest changes"
git pull --ff-only

echo "==> Building images"
"${compose[@]}" build api

echo "==> Starting stack"
"${compose[@]}" up -d

echo "==> Removing dangling build layers"
docker image prune -f >/dev/null || true

echo "==> Status"
"${compose[@]}" ps
