#!/usr/bin/env bash
# Derruba a testnet iniciada por eav7-testnet-up.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${EAV7_TESTNET_ROOT:-$RAIZ/data/testnet}"
PIDS_FILE="$ROOT/testnet.pids"

if [[ ! -f "$PIDS_FILE" ]]; then
  echo "[testnet] nada para parar ($PIDS_FILE ausente)"
  exit 0
fi

echo "[testnet] encerrando PIDs de $PIDS_FILE"
while read -r pid; do
  [[ -z "${pid:-}" ]] && continue
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    # filhos do node às vezes ficam
    wait "$pid" 2>/dev/null || true
  fi
done <"$PIDS_FILE"

# Varredura gentil: processos nossos nestas portas padrão
for port in 6070 6071 6072 6073 6090 16090; do
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [[ -n "${pids:-}" ]]; then
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
      sleep 0.2
      pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
      # shellcheck disable=SC2086
      [[ -n "${pids:-}" ]] && kill -9 $pids 2>/dev/null || true
    fi
  fi
done

rm -f "$PIDS_FILE"
echo "[testnet] parada. dados preservados em $ROOT (use --fresh no up para regenerar)"
