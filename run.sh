#!/usr/bin/env bash
# Runs Curryforward locally: FastAPI backend (:8000) + Next.js dev server (:3000).
# Ctrl+C stops both.
set -e

cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  echo "Setting up backend virtualenv..."
  # Pinned to python3.11 specifically, not bare `python3` — the auto-research
  # feature depends on crewai, which requires Python >=3.10,<3.14, and
  # Homebrew's `python3` default has drifted to 3.14 (too new) on dev machines.
  if ! command -v python3.11 >/dev/null 2>&1; then
    echo "python3.11 is required (crewai doesn't support 3.14+). Install it with: brew install python@3.11"
    exit 1
  fi
  python3.11 -m venv backend/.venv
  backend/.venv/bin/pip install -r backend/requirements.txt
fi

if [ ! -f backend/.env ]; then
  echo "Creating backend/.env from .env.example — edit it to add ANTHROPIC_API_KEY and set ADMIN_TOKEN."
  cp backend/.env.example backend/.env
fi

if [ ! -d frontend-next/node_modules ]; then
  echo "Installing frontend dependencies..."
  (cd frontend-next && npm install)
fi

free_port() {
  local port="$1"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Port $port is in use (pid(s): $pids) — stopping leftover process..."
    kill $pids 2>/dev/null || true
    sleep 1
    # Still alive after a polite kill? Force it.
    pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  fi
}

free_port 8000
free_port 3000

cleanup() {
  echo ""
  echo "Stopping..."
  kill "$BACKEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000 --forwarded-allow-ips=) &
BACKEND_PID=$!

echo "Backend starting on http://127.0.0.1:8000 (pid $BACKEND_PID)"
echo "Frontend starting on http://localhost:3000"
echo ""

(cd frontend-next && npm run dev)
