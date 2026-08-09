#!/usr/bin/env bash
# Ensaiar candidatura: faucet → stake 1000 → set-mode candidate (Core).
# Requer testnet no ar com --with-core (endpoints em data/testnet/endpoints.env).
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${EAV7_TESTNET_ROOT:-$RAIZ/data/testnet}"
ENVF="$ROOT/endpoints.env"

[[ -f "$ENVF" ]] || { echo "rode antes: bash bin/eav7-testnet-up.sh --with-core" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENVF"; set +a

CORE_DIR="${EAV7_CORE_DIR:-$ROOT/core}"
[[ -f "$CORE_DIR/core.json" ]] || { echo "Core não inicializado em $CORE_DIR" >&2; exit 1; }

CORE_BIN="${EAV7_CORE_BIN:-}"
if [[ -z "$CORE_BIN" ]]; then
  if [[ -n "${CARGO_TARGET_DIR:-}" && -x "$CARGO_TARGET_DIR/debug/eav7-core" ]]; then
    CORE_BIN="$CARGO_TARGET_DIR/debug/eav7-core"
  elif [[ -x "$RAIZ/rust/target/debug/eav7-core" ]]; then
    CORE_BIN="$RAIZ/rust/target/debug/eav7-core"
  else
    CORE_BIN="$(command -v eav7-core || true)"
  fi
fi
[[ -x "${CORE_BIN:-}" ]] || { echo "eav7-core não encontrado — compile: cargo build -p eav7-core" >&2; exit 1; }

ADDR="$("$CORE_BIN" account --dir "$CORE_DIR" --url "${EAV7_CORE_URL:-http://127.0.0.1:6073}" 2>/dev/null | awk '/^conta /{print $2; exit}')"
if [[ -z "${ADDR:-}" ]]; then
  # fallback: ler do JSON da carteira
  ADDR="$(node -e "const w=require(process.argv[1]); const {walletAddress}=require('./src/crypto/keys.js'); console.log(w.address||walletAddress(w))" "$CORE_DIR/validator-wallet.json")"
fi
echo "[demo] endereço Core: $ADDR"

FAUCET="${EAV7_FAUCET_URL:-http://127.0.0.1:6090}"
echo "[demo] pedindo faucet em $FAUCET …"
curl -fsS -X POST "$FAUCET/faucet" \
  -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\"}" | tee "$ROOT/demo-faucet.json"
echo

# Espera inclusão (faucet submete tx; mineradores produzem a cada ~1s)
echo "[demo] aguardando saldo…"
for _ in $(seq 1 40); do
  bal="$("$CORE_BIN" account --dir "$CORE_DIR" --url "${EAV7_NODE_URL:-http://127.0.0.1:6070}" 2>/dev/null | awk '/saldo/{print $3; exit}' || true)"
  if [[ -n "${bal:-}" && "$bal" != "0" ]]; then
    echo "[demo] saldo=$bal EAV7"
    break
  fi
  sleep 0.5
done

echo "[demo] stake 1000 --wait"
"$CORE_BIN" stake --dir "$CORE_DIR" --url "${EAV7_NODE_URL:-http://127.0.0.1:6070}" \
  --amount 1000 --wait --timeout 120

"$CORE_BIN" set-mode candidate --dir "$CORE_DIR" \
  --url "${EAV7_NODE_URL:-http://127.0.0.1:6070}"
"$CORE_BIN" account --dir "$CORE_DIR" --url "${EAV7_NODE_URL:-http://127.0.0.1:6070}"
"$CORE_BIN" score --dir "$CORE_DIR" --url "${EAV7_NODE_URL:-http://127.0.0.1:6070}"

echo
echo "[demo] OK — para produzir blocos, reinicie o Core em modo candidate:"
echo "  bash bin/eav7-testnet-down.sh   # ou só mate o PID do core"
echo "  # edite/suba de novo com set-mode já gravado:"
echo "  EAV7_GENESIS_ACTIVE=1 EAV7_NODE_BIN=… eav7-core run --dir $CORE_DIR"
