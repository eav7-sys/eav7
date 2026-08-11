#!/usr/bin/env bash
# Mostra conta/stake do produtor da testnet (Core).
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${EAV7_TESTNET_ROOT:-$RAIZ/data/testnet}"
ENVF="$ROOT/endpoints.env"

[[ -f "$ENVF" ]] || { echo "rode antes: bash bin/eav7-testnet-up.sh" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENVF"; set +a

CORE_BIN="${EAV7_CORE_BIN:-$RAIZ/rust/target/debug/eav7-core}"
[[ -x "$CORE_BIN" ]] || CORE_BIN="$(command -v eav7-core || true)"
[[ -x "${CORE_BIN:-}" ]] || { echo "eav7-core não encontrado" >&2; exit 1; }

DIR="${EAV7_CORE_DIR:-$ROOT/node0}"
URL="${EAV7_CORE_URL:-http://127.0.0.1:6070}"

"$CORE_BIN" account --dir "$DIR" --url "$URL"
"$CORE_BIN" status --dir "$DIR" --url "$URL" || true
