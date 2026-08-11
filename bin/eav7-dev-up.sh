#!/usr/bin/env bash
# Sobe Core Rust local + web-next. Ctrl+C derruba os dois.
# Uso: bash bin/eav7-dev-up.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

PORT="${EAV7_PORT:-6070}"
DATA="${EAV7_DATA:-$RAIZ/data/dev-local}"
WEB_PORT="${EAV7_WEB_PORT:-3000}"
ENV_LOCAL="$RAIZ/web-next/.env.local"
CORE_BIN="${EAV7_CORE_BIN:-}"
NODE_BIN="${EAV7_NODE_BIN:-}"

mkdir -p "$DATA"

# Prefer release, depois debug
if [[ -z "$CORE_BIN" ]]; then
  for c in \
    "$RAIZ/rust/target/release/eav7-core" \
    "$RAIZ/rust/target/debug/eav7-core"; do
    [[ -x "$c" ]] && CORE_BIN="$c" && break
  done
fi
if [[ -z "$NODE_BIN" ]]; then
  for n in \
    "$RAIZ/rust/target/release/eav7-node" \
    "$RAIZ/rust/target/debug/eav7-node"; do
    [[ -x "$n" ]] && NODE_BIN="$n" && break
  done
fi

if [[ -z "$CORE_BIN" || -z "$NODE_BIN" ]]; then
  echo "[dev-up] compilando eav7-core + eav7-node…"
  (cd "$RAIZ/rust" && cargo build -p eav7-core -p eav7-node)
  CORE_BIN="$RAIZ/rust/target/debug/eav7-core"
  NODE_BIN="$RAIZ/rust/target/debug/eav7-node"
fi
export EAV7_NODE_BIN="$NODE_BIN"

if [[ ! -f "$DATA/core.json" ]]; then
  echo "[dev-up] eav7-core init em $DATA"
  "$CORE_BIN" init --dir "$DATA" --mode validator --port "$PORT" \
    --host 127.0.0.1 --allow-private-peers
fi

if [[ ! -f "$ENV_LOCAL" ]]; then
  if [[ -f "$RAIZ/web-next/.env.example" ]]; then
    sed -e "s|127.0.0.1:6070|127.0.0.1:${PORT}|g" \
      "$RAIZ/web-next/.env.example" >"$ENV_LOCAL"
  else
    cat >"$ENV_LOCAL" <<EOF
NEXT_PUBLIC_API_BASE=/api
EAV7_API_ORIGIN=http://127.0.0.1:${PORT}
EOF
  fi
  echo "[dev-up] criou web-next/.env.local"
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

echo "[dev-up] Core Rust em :$PORT (data=$DATA)"
"$CORE_BIN" run --dir "$DATA" &
pids+=($!)

echo -n "[dev-up] aguardando /status"
for _ in $(seq 1 90); do
  if curl -fsS -H 'accept: application/json' "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 0.5
done
curl -fsS -H 'accept: application/json' "http://127.0.0.1:${PORT}/status" >/dev/null \
  || { echo " falhou — Core não respondeu" >&2; exit 1; }

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
