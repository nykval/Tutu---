#!/bin/zsh
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8765
PYTHON_BIN="$(command -v python3)"

cd "$PROJECT_DIR" || exit 1

if [[ -z "$PYTHON_BIN" ]]; then
  /usr/bin/osascript -e 'display alert "Не найден Python 3" message "Установите Python 3 или откройте index.html напрямую для работы с общим сервером."'
  exit 1
fi

"$PYTHON_BIN" local_server/server.py --port "$PORT" &
SERVER_PID=$!

trap '/bin/kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM
/bin/sleep 1
/usr/bin/open "http://127.0.0.1:$PORT"
wait "$SERVER_PID"
