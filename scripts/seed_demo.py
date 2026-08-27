#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "Seeding demo data..."

# Start backend if not running
if ! curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "Backend not running. Starting..."
    python3 backend/run.py &
    sleep 3
fi

# Seed data
echo "POST /api/demo/seed"
curl -s -X POST http://localhost:8000/api/demo/seed | python3 -m json.tool

echo ""
echo "Demo data seeded!"
echo ""
echo "Try these endpoints:"
echo "  GET /api/buses"
echo "  GET /api/events"
echo "  GET /api/issues"
echo "  GET /api/incidents"
echo "  GET /api/dashboard/stats"
echo "  GET /docs"
