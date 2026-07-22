#!/usr/bin/env bash
# CutQuote dev server — usage: ./run-dev.sh [port]
set -e
cd "$(dirname "$0")"
PORT="${1:-8000}"
echo ""
echo "  CutQuote dev server"
echo "  → http://localhost:$PORT"
echo "  Ctrl+C to stop"
echo ""
# open the browser once the server is up
( sleep 1; command -v open >/dev/null && open "http://localhost:$PORT" ) &
python3 -m http.server "$PORT" --bind 127.0.0.1
