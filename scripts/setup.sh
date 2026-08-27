#!/bin/bash
set -e

echo "============================================"
echo "  UrbanSense AI — Setup Script"
echo "============================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo ""
echo "[1/5] Creating .env from .env.example..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "  .env created"
else
    echo "  .env already exists"
fi

echo ""
echo "[2/5] Installing Python dependencies..."
pip install -q --upgrade pip
pip install -q -r backend/requirements.txt
echo "  Backend deps installed"

echo ""
echo "[3/5] Setting up database..."
# Check for running PostgreSQL
if psql postgres -c "SELECT 1" > /dev/null 2>&1; then
    psql postgres -c "CREATE USER urbansense WITH PASSWORD 'urbansense';" 2>/dev/null || true
    psql postgres -c "CREATE DATABASE urbansense;" 2>/dev/null || true
    psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE urbansense TO urbansense;" 2>/dev/null || true
    psql urbansense -c "GRANT ALL ON SCHEMA public TO urbansense;" 2>/dev/null || true
    
    cd backend
    alembic upgrade head
    cd ..
    echo "  Database ready"
else
    echo "  PostgreSQL not running. Start it or use Docker:"
    echo "    docker-compose up -d postgres"
fi

echo ""
echo "[4/5] Setting up frontend..."
cd frontend
if [ ! -d node_modules ]; then
    npm install --silent
fi
cd ..
echo "  Frontend ready"

echo ""
echo "[5/5] Creating directories..."
mkdir -p data/videos data/evidence data/gps data/demo
echo "  Directories ready"

echo ""
echo "============================================"
echo "  Setup Complete!"
echo ""
echo "  Start backend:   cd backend && python run.py"
echo "  Start frontend:  cd frontend && npm run dev"
echo "  Start edge AI:   python edge/main.py"
echo ""
echo "  Seed demo data:  curl -X POST http://localhost:8000/api/demo/seed"
echo "  API docs:        http://localhost:8000/docs"
echo "  Dashboard:       http://localhost:3000"
echo "============================================"
