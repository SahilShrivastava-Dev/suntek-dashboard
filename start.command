#!/bin/bash
#
# Suntek Dashboard — one-click launcher (macOS)
# Runs: Docker SQL container + ngrok tunnel + full dev stack (API :3001 + Vite :5173)
# Double-click in Finder, or run:  ./start.command
#
set -e

# Always run from the folder this script lives in
cd "$(dirname "$0")"

CONTAINER="BusyFY2026"
NGROK_URL="https://impeach-police-overhaul.ngrok-free.dev"
API_PORT=3001

echo "==> [1/3] Starting SQL Server container ($CONTAINER)…"
if ! docker info >/dev/null 2>&1; then
  echo "!! Docker isn't running. Open Docker Desktop, wait for it to start, then re-run."
  exit 1
fi
docker start "$CONTAINER" >/dev/null
# Give Azure SQL Edge a few seconds to accept connections
printf "    waiting for SQL to come up"
for i in $(seq 1 15); do printf "."; sleep 1; done
echo " ready."

echo "==> [2/3] Starting ngrok tunnel ($NGROK_URL -> :$API_PORT)…"
ngrok http --url="$NGROK_URL" "$API_PORT" --log=stdout > ngrok.log 2>&1 &
NGROK_PID=$!

# Stop ngrok (and leave the container running) when you Ctrl+C / close the window
cleanup() {
  echo ""
  echo "==> Shutting down ngrok…"
  kill "$NGROK_PID" 2>/dev/null || true
  echo "    (SQL container '$CONTAINER' left running — stop it with: docker stop $CONTAINER)"
}
trap cleanup EXIT INT TERM

sleep 2
echo "    ngrok log -> ngrok.log"

echo "==> [3/3] Starting full dev stack (API :3001 + Vite :5173)…"
echo "    Open http://localhost:5173  (Ctrl+C here to stop everything)"
echo ""
npm run dev:full
