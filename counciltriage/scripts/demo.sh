#!/usr/bin/env bash
# One-command pitch setup: checks the local AI, starts the image service, rebuilds the
# demo data, builds the app and serves it on http://localhost:${PORT:-3100}.
#   npm run demo            # full reset (seed + AI triage, ~7 min) then build and start
#   npm run demo -- --fast  # keep the current database, just build and start
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3100}"
ML="../ml"

echo "1/5 Ollama + qwen3:8b"
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null; then
  echo "   starting ollama serve"; (ollama serve >/tmp/ollama.log 2>&1 &); sleep 3
fi
ollama list | grep -q "qwen3:8b" || ollama pull qwen3:8b
# Warm the model so the first live report is fast.
curl -s http://127.0.0.1:11434/api/generate -d '{"model":"qwen3:8b","prompt":"ok","stream":false,"think":false,"keep_alive":"4h","options":{"num_predict":1}}' >/dev/null

echo "2/5 Image model service (port 8765)"
if ! curl -sf http://127.0.0.1:8765/health >/dev/null; then
  (nohup "$ML/.venv/bin/python" "$ML/vision_service.py" >"$ML/vision.log" 2>&1 &)
  until curl -sf http://127.0.0.1:8765/health >/dev/null; do sleep 1; done
fi
# Warm the image model (the first call compiles the Metal kernels).
WARM_PHOTO="$(ls data/uploads/fms/*.jpeg 2>/dev/null | head -1 || true)"
[[ -n "$WARM_PHOTO" ]] && curl -s -X POST http://127.0.0.1:8765/analyse -H 'content-type: application/json' -d "{\"path\":\"$PWD/$WARM_PHOTO\"}" >/dev/null || true

if [[ "${1:-}" != "--fast" ]]; then
  # The seed replaces the database file, so stop servers using the old one first.
  lsof -ti "tcp:$PORT" | xargs kill 2>/dev/null || true
  echo "3/5 Seeding data"; npm run -s seed
  echo "4/5 AI triage of open reports"; npm run -s ai:process
else
  echo "3-4/5 Keeping the current database"
fi

echo "5/5 Building and starting on http://localhost:$PORT"
npm run -s build
# Stop any server still holding the port (it would also hold the old database file).
lsof -ti "tcp:$PORT" | xargs kill 2>/dev/null || true
sleep 1
exec npm run -s start -- -p "$PORT"
