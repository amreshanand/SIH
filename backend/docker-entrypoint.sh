#!/bin/sh

PORT="${PORT:-8000}"

echo "[docker] Running database migrations in background..."
(cd /app/backend && alembic upgrade head || echo "[docker] Alembic migration notice: continuing anyway") &

echo "[docker] Starting backend on 0.0.0.0:${PORT} ..."
exec python -m uvicorn backend.run:app --host 0.0.0.0 --port "${PORT}"

