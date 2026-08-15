#!/usr/bin/env bash
# Testnet local: 1 produtor Core + 2 ouvintes (peers).
#
# Uso:
#   bash bin/eav7-testnet-up.sh
#   bash bin/eav7-testnet-up.sh --fresh
#   bash bin/eav7-testnet-down.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

# Binário atual é GENESIS_ACTIVE_BUILD=true — o nó recusa arrancar sem o env.
export EAV7_GENESIS_ACTIVE=1

ROOT="${EAV7_TESTNET_ROOT:-$RAIZ/data/testnet}"
PIDS_FILE="$ROOT/testnet.pids"
PORT0="${EAV7_TESTNET_PORT0:-6070}"
PORT1="${EAV7_TESTNET_PORT1:-6071}"
PORT2="${EAV7_TESTNET_PORT2:-6072}"
FRESH=0

for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --with-core|--demo)
      # flags antigas ignoradas — a rede já é só Core
      ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "flag desconhecida: $arg" >&2; exit 2 ;;
  esac
done

if [[ -f "$PIDS_FILE" ]]; then
  echo "[testnet] já há PIDs em $PIDS_FILE — rode: bash bin/eav7-testnet-down.sh" >&2
  exit 1
fi

if [[ "$FRESH" == "1" ]]; then
  echo "[testnet] --fresh: apagando $ROOT"
  rm -rf "$ROOT"
fi
mkdir -p "$ROOT"

echo "[testnet] compilando eav7-core + eav7-node…"
(cd rust && cargo build -q -p eav7-core -p eav7-node)
CORE_BIN="$RAIZ/rust/target/debug/eav7-core"
NODE_BIN="$RAIZ/rust/target/debug/eav7-node"
export EAV7_NODE_BIN="$NODE_BIN"

: >"$PIDS_FILE"
registrar_pid() { echo "$1" >>"$PIDS_FILE"; }

aguardar_status() {
  local port=$1 nome=$2
  echo -n "[testnet] aguardando $nome :$port"
  for _ in $(seq 1 90); do
    if curl -fsS -H 'accept: application/json' "http://127.0.0.1:${port}/status" >/dev/null 2>&1; then
      echo " ok"
      return 0
    fi
    echo -n "."
    sleep 0.4
  done
  echo " timeout" >&2
  return 1
}

init_e_rodar() {
  local nome=$1 port=$2 modo=$3 peers=$4
  local dir="$ROOT/$nome"
  mkdir -p "$dir"
  if [[ ! -f "$dir/core.json" ]]; then
    # shellcheck disable=SC2086
    "$CORE_BIN" init --dir "$dir" --mode "$modo" --port "$port" --host 127.0.0.1 \
      --allow-private-peers ${peers:+--peers "$peers"}
  fi
  echo "[testnet] $nome ($modo) :$port"
  "$CORE_BIN" run --dir "$dir" >"$ROOT/${nome}.log" 2>&1 &
  registrar_pid $!
}

init_e_rodar "node0" "$PORT0" validator ""
aguardar_status "$PORT0" "node0"

init_e_rodar "node1" "$PORT1" listen "http://127.0.0.1:${PORT0}"
init_e_rodar "node2" "$PORT2" listen "http://127.0.0.1:${PORT0},http://127.0.0.1:${PORT1}"

aguardar_status "$PORT1" "node1"
aguardar_status "$PORT2" "node2"

cat >"$ROOT/endpoints.env" <<EOF
EAV7_GENESIS_ACTIVE=1
EAV7_TESTNET_ROOT=$ROOT
EAV7_NODE_URL=http://127.0.0.1:${PORT0}
EAV7_CORE_DIR=$ROOT/node0
EAV7_CORE_URL=http://127.0.0.1:${PORT0}
EAV7_RPC=http://127.0.0.1:$((PORT0 + 1000))
EOF

echo
echo "========== TESTNET =========="
echo "  produtor : http://127.0.0.1:${PORT0}  (node0)"
echo "  ouvintes : http://127.0.0.1:${PORT1}  ${PORT2}"
echo "  logs     : $ROOT/*.log"
echo "  parar    : bash bin/eav7-testnet-down.sh"
echo "============================="
