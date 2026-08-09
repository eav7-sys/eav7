#!/usr/bin/env bash
# Testnet local: gênese-ativo + 3 validadores JS + faucet.
# Opcional: --with-core (ouvinte Rust) e --demo (faucet→stake no Core).
#
# Uso:
#   bash bin/eav7-testnet-up.sh
#   bash bin/eav7-testnet-up.sh --fresh --with-core --demo
#   bash bin/eav7-testnet-down.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

ROOT="${EAV7_TESTNET_ROOT:-$RAIZ/data/testnet}"
GENESIS_DIR="$ROOT/genesis"
PIDS_FILE="$ROOT/testnet.pids"
PORT0="${EAV7_TESTNET_PORT0:-6070}"
PORT1="${EAV7_TESTNET_PORT1:-6071}"
PORT2="${EAV7_TESTNET_PORT2:-6072}"
# 16090 evita colidir com nós soltos que às vezes ficam em :6090 na máquina do operador.
PORT_FAUCET="${EAV7_TESTNET_FAUCET_PORT:-16090}"
PORT_CORE="${EAV7_TESTNET_CORE_PORT:-6073}"
FRESH=0
WITH_CORE=0
DEMO=0

for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --with-core) WITH_CORE=1 ;;
    --demo) DEMO=1; WITH_CORE=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# //'
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

if [[ ! -f "$GENESIS_DIR/genesis.json" ]]; then
  echo "[testnet] gerando gênese (3 validadores)…"
  EAV7_GENESIS_ACTIVE=1 node bin/eav7-genesis.js "$GENESIS_DIR" 3
fi

GENESIS_HASH="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).hash)" "$GENESIS_DIR/genesis.json")"
echo "$GENESIS_HASH" >"$ROOT/genesis.hash"
echo "[testnet] genesis hash: $GENESIS_HASH"

: >"$PIDS_FILE"
registrar_pid() {
  echo "$1" >>"$PIDS_FILE"
}

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

subir_no() {
  local idx=$1 port=$2
  local data="$ROOT/node-$idx"
  local peers=""
  case "$idx" in
    0) peers="http://127.0.0.1:${PORT1},http://127.0.0.1:${PORT2}" ;;
    1) peers="http://127.0.0.1:${PORT0},http://127.0.0.1:${PORT2}" ;;
    2) peers="http://127.0.0.1:${PORT0},http://127.0.0.1:${PORT1}" ;;
  esac
  mkdir -p "$data"
  echo "[testnet] nó$idx em :$port"
  EAV7_GENESIS_ACTIVE=1 node bin/eav7.js mine \
    --port "$port" --host 127.0.0.1 --data "$data" \
    --genesis "$GENESIS_DIR/genesis.json" \
    --genesis-hash "$GENESIS_HASH" \
    --validator "$GENESIS_DIR/validator-${idx}-wallet.json" \
    --peers "$peers" \
    --allow-private-peers \
    --no-eavm \
    >"$ROOT/node-$idx.log" 2>&1 &
  registrar_pid $!
}

subir_no 0 "$PORT0"
subir_no 1 "$PORT1"
subir_no 2 "$PORT2"

aguardar_status "$PORT0" "nó0"
aguardar_status "$PORT1" "nó1"
aguardar_status "$PORT2" "nó2"

liberar_porta() {
  local port=$1
  command -v lsof >/dev/null 2>&1 || return 0
  local stale
  stale=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  [[ -z "${stale:-}" ]] && return 0
  echo "[testnet] liberando :$port (pids $stale)"
  # shellcheck disable=SC2086
  kill $stale 2>/dev/null || true
  sleep 0.3
  stale=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${stale:-}" ]]; then
    # shellcheck disable=SC2086
    kill -9 $stale 2>/dev/null || true
    sleep 0.3
  fi
}
liberar_porta "$PORT_FAUCET"
echo "[testnet] faucet :$PORT_FAUCET"
EAV7_FAUCET_ENABLED=1 \
  EAV7_NODE_URL="http://127.0.0.1:${PORT0}" \
  EAV7_FAUCET_KEY="$GENESIS_DIR/treasury-wallet.json" \
  EAV7_FAUCET_AMOUNT="${EAV7_FAUCET_AMOUNT:-5000}" \
  PORT="$PORT_FAUCET" \
  node bin/eav7-faucet.js >"$ROOT/faucet.log" 2>&1 &
registrar_pid $!
echo -n "[testnet] aguardando faucet"
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT_FAUCET}/" 2>/dev/null | grep -q '"faucet"'; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 0.25
done
curl -fsS "http://127.0.0.1:${PORT_FAUCET}/" | grep -q '"faucet"' \
  || { echo " falhou — veja $ROOT/faucet.log" >&2; exit 1; }

CORE_BIN=""
NODE_BIN=""
if [[ "$WITH_CORE" == "1" ]]; then
  echo "[testnet] regenerando config.rs gênese-ativo + compilando Core…"
  # Consts de fork são build-time no Rust: compila com ACTIVE=1 e restaura o fonte
  # SEM herdar EAV7_GENESIS_ACTIVE do ambiente (senão o "restore" continua ativo).
  EAV7_GENESIS_ACTIVE=1 node bin/eav7-config-rs.js
  (cd rust && cargo build -q -p eav7-core -p eav7-node)
  env -u EAV7_GENESIS_ACTIVE node bin/eav7-config-rs.js
  if grep -q 'GENESIS_ACTIVE_BUILD: bool = true' rust/src/config.rs; then
    echo "[testnet] AVISO: config.rs ainda gênese-ativo — forçando restore" >&2
    env -u EAV7_GENESIS_ACTIVE node bin/eav7-config-rs.js
  fi
  echo "[testnet] config.rs restaurado (binário já embutiu gênese-ativo)"

  TARGET_DIR="${CARGO_TARGET_DIR:-$RAIZ/rust/target}"
  CORE_BIN="$TARGET_DIR/debug/eav7-core"
  NODE_BIN="$TARGET_DIR/debug/eav7-node"
  [[ -x "$CORE_BIN" && -x "$NODE_BIN" ]] || { echo "binários Core ausentes em $TARGET_DIR/debug" >&2; exit 1; }

  CORE_DIR="$ROOT/core"
  if [[ ! -f "$CORE_DIR/core.json" ]]; then
    EAV7_NODE_BIN="$NODE_BIN" "$CORE_BIN" init --dir "$CORE_DIR" --mode listen \
      --port "$PORT_CORE" --host 127.0.0.1 \
      --peers "http://127.0.0.1:${PORT0},http://127.0.0.1:${PORT1},http://127.0.0.1:${PORT2}" \
      --allow-private-peers \
      --genesis "$GENESIS_DIR/genesis.json" \
      --genesis-hash "$GENESIS_HASH"
  fi
  echo "[testnet] Core listen :$PORT_CORE"
  # Binário foi compilado gênese-ativo: o runtime EXIGE o mesmo flag.
  EAV7_GENESIS_ACTIVE=1 EAV7_NODE_BIN="$NODE_BIN" "$CORE_BIN" run --dir "$CORE_DIR" \
    >"$ROOT/core.log" 2>&1 &
  registrar_pid $!
  aguardar_status "$PORT_CORE" "core"
fi

cat >"$ROOT/endpoints.env" <<EOF
EAV7_GENESIS_ACTIVE=1
EAV7_TESTNET_ROOT=$ROOT
EAV7_NODE_URL=http://127.0.0.1:${PORT0}
EAV7_FAUCET_URL=http://127.0.0.1:${PORT_FAUCET}
EAV7_GENESIS_HASH=$GENESIS_HASH
EAV7_CORE_DIR=$ROOT/core
EAV7_CORE_URL=http://127.0.0.1:${PORT_CORE}
EOF

echo
echo "========== TESTNET NO AR =========="
echo "  API nós   : http://127.0.0.1:${PORT0}  ${PORT1}  ${PORT2}"
echo "  faucet    : http://127.0.0.1:${PORT_FAUCET}/  (POST /faucet {\"address\":\"E7…\"})"
echo "  gênese    : $GENESIS_DIR"
echo "  logs      : $ROOT/*.log"
echo "  parar     : bash bin/eav7-testnet-down.sh"
if [[ "$WITH_CORE" == "1" ]]; then
  echo "  Core      : http://127.0.0.1:${PORT_CORE}  dir=$ROOT/core"
  echo "  account   : $CORE_BIN account --dir $ROOT/core"
fi
echo "==================================="

if [[ "$DEMO" == "1" ]]; then
  echo
  echo "[testnet] --demo: faucet → stake 1000 → set-mode candidate"
  bash bin/eav7-testnet-demo.sh
fi
