#!/usr/bin/env bash
# Sobe nó JS local + web-next apontando a ele. Ctrl+C derruba os dois.
# Uso: bash bin/eav7-dev-up.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

PORT="${EAV7_PORT:-6070}"
DATA="${EAV7_DATA:-$RAIZ/data/dev-local}"
WEB_PORT="${EAV7_WEB_PORT:-3000}"
ENV_LOCAL="$RAIZ/web-next/.env.local"

mkdir -p "$DATA"

if [[ ! -f "$ENV_LOCAL" ]]; then
  if [[ -f "$RAIZ/web-next/.env.example" ]]; then
    sed -e "s|127.0.0.1:6070|127.0.0.1:${PORT}|g" \
      "$RAIZ/web-next/.env.example" >"$ENV_LOCAL"
    echo "[dev-up] criou web-next/.env.local a partir de .env.example"
  else
    cat >"$ENV_LOCAL" <<EOF
NEXT_PUBLIC_API_BASE=/api
EAV7_API_ORIGIN=http://127.0.0.1:${PORT}
EOF
    echo "[dev-up] criou web-next/.env.local mínimo"
  fi
fi

pids=()
cleanup() {
  local p
  for p in "${pids[@]:-}"; do
    kill "$p" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev-up] nó JS em :$PORT (data=$DATA)"
node bin/eav7.js mine --port "$PORT" --data "$DATA" --host 127.0.0.1 &
pids+=($!)

echo -n "[dev-up] aguardando /status"
for _ in $(seq 1 60); do
  if curl -fsS -H 'accept: application/json' "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 0.5
done
curl -fsS -H 'accept: application/json' "http://127.0.0.1:${PORT}/status" >/dev/null \
  || { echo " falhou — nó não respondeu" >&2; exit 1; }

if [[ ! -d "$RAIZ/web-next/node_modules" ]]; then
  echo "[dev-up] npm ci em web-next…"
  (cd "$RAIZ/web-next" && npm ci)
fi

echo "[dev-up] Next em :$WEB_PORT  →  http://127.0.0.1:${WEB_PORT}"
echo "[dev-up] API     →  http://127.0.0.1:${PORT}"
(
  cd "$RAIZ/web-next"
  export EAV7_API_ORIGIN="http://127.0.0.1:${PORT}"
  export NEXT_PUBLIC_API_BASE="${NEXT_PUBLIC_API_BASE:-/api}"
  npx next dev -p "$WEB_PORT" -H 127.0.0.1
) &
pids+=($!)

wait
