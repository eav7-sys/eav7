#!/usr/bin/env bash
# E2E Public LBP on local testnet (mock payment → grant). Never touches mainnet.
#
# Uso:
#   bash bin/eav7-lbp-e2e-local.sh
#   bash bin/eav7-lbp-e2e-local.sh --keep-testnet   # não derruba no fim
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep-testnet) KEEP=1 ;;
    -h|--help)
      sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "flag desconhecida: $arg" >&2; exit 2 ;;
  esac
done

cleanup() {
  if [[ "$KEEP" == "0" ]]; then
    bash bin/eav7-testnet-down.sh >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -f data/testnet/testnet.pids ]]; then
  bash bin/eav7-testnet-down.sh || true
fi

echo "[e2e-lbp] testnet --fresh"
bash bin/eav7-testnet-up.sh --fresh

export EAV7_GENESIS_ACTIVE=1
# Avoid macOS AnyDesk on :6070 (arcp) — override with EAV7_TESTNET_PORT0 if needed.
export EAV7_TESTNET_PORT0="${EAV7_TESTNET_PORT0:-6270}"
export EAV7_TESTNET_PORT1="${EAV7_TESTNET_PORT1:-6271}"
export EAV7_TESTNET_PORT2="${EAV7_TESTNET_PORT2:-6272}"
export EAV7_CLI="${EAV7_CLI:-$RAIZ/rust/target/debug/eav7-cli}"
export EAV7_NODE="${EAV7_NODE:-http://127.0.0.1:${EAV7_TESTNET_PORT0}}"
export EAV7_RPC="${EAV7_RPC:-http://127.0.0.1:$((EAV7_TESTNET_PORT0 + 1000))}"
export EAV7_TESTNET_ROOT="${EAV7_TESTNET_ROOT:-$RAIZ/data/testnet}"

if [[ ! -d contracts/sale/relayer/node_modules/ethers ]]; then
  echo "[e2e-lbp] npm ci (relayer)"
  (cd contracts/sale/relayer && npm ci --omit=dev)
fi

echo "[e2e-lbp] run script"
node contracts/scripts/e2e-public-lbp-local.mjs

echo "[e2e-lbp] done"
