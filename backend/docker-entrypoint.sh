#!/bin/sh
# Container entrypoint for the UrbanSense backend.
# Runs pending migrations against the configured database, then starts the app.
#
# NOTE: Docker is NOT available in this dev environment, so this script is
# written for correctness but has not been executed here.
set -e

echo "[docker] Running database migrations..."
(cd /app/backend && alembic upgrade head)

echo "[docker] Starting backend on 0.0.0.0:8000 ..."
exec python -m uvicorn backend.run:app --host 0.0.0.0 --port 8000
