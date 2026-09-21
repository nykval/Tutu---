#!/bin/zsh
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8765

cd "$PROJECT_DIR" || exit 1
/usr/bin/python3 server.py --port "$PORT" &
SERVER_PID=$!

trap '/bin/kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM
/bin/sleep 1
/usr/bin/open "http://127.0.0.1:$PORT"
wait "$SERVER_PID"
