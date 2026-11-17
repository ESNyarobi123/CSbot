#!/usr/bin/env bash
# Deploy CSbot on the shared production server.
#
# Run from the repository root on the server:  ./scripts/deploy.sh
#
# Pulls the latest commit, rebuilds the image and restarts the app containers.
# The PostgreSQL volume is untouched, so conversations and linked numbers
# survive a deploy. Migrations run before the new code starts and are additive.
set -euo pipefail
cd "$(dirname "$0")/.."

compose=(docker compose -f compose.yaml -f compose.prod.yaml)

echo "==> Pulling latest changes"
git pull --ff-only

echo "==> Building image"
# The compose file points every service at this tag, so build it directly:
# `compose build` skips services whose image already exists on disk.
docker build -t csbot-backend:local .

echo "==> Applying migrations"
"${compose[@]}" run --rm migrate

echo "==> Restarting app containers"
"${compose[@]}" up -d --no-deps --force-recreate api worker whatsapp-gateway

echo "==> Removing dangling build layers"
docker image prune -f >/dev/null || true

echo "==> Status"
"${compose[@]}" ps
