#!/usr/bin/env bash
# G5: gera fixture, sobe JS (observer) + Rust na mesma cadeia, diffa API, derruba.
# Uso: bash bin/eav7-api-parity-boot.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

JS_PORT="${EAV7_PARITY_JS_PORT:-16070}"
RS_PORT="${EAV7_PARITY_RS_PORT:-16071}"
WORKDIR="${EAV7_PARITY_DIR:-$(mktemp -d -t eav7-parity.XXXXXX)}"
KEEP="${EAV7_PARITY_KEEP:-0}"

pids=()
cleanup() {
  local p
  for p in "${pids[@]:-}"; do
    kill "$p" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  if [[ "$KEEP" != "1" && -d "$WORKDIR" && "$WORKDIR" == *eav7-parity* ]]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT INT TERM

echo "[parity] workdir=$WORKDIR"
mkdir -p "$WORKDIR"
node bin/eav7-gerar-cadeia-replay.js "$WORKDIR/chain"

# Cópias isoladas: nenhum processo escreve no fixture do outro.
rm -rf "$WORKDIR/js" "$WORKDIR/rust"
cp -a "$WORKDIR/chain" "$WORKDIR/js"
cp -a "$WORKDIR/chain" "$WORKDIR/rust"

BIN_RS="${EAV7_NODE_BIN:-}"
if [[ -z "$BIN_RS" ]]; then
  echo "[parity] compilando eav7-node…"
  (cd rust && cargo build -q -p eav7-node)
  BIN_RS="$RAIZ/rust/target/debug/eav7-node"
fi
[[ -x "$BIN_RS" ]] || { echo "binário Rust ausente: $BIN_RS" >&2; exit 1; }

echo "[parity] JS observer :$JS_PORT"
node bin/eav7.js mine --observer --port "$JS_PORT" --host 127.0.0.1 \
  --data "$WORKDIR/js" --no-eavm &
pids+=($!)

echo "[parity] Rust       :$RS_PORT"
"$BIN_RS" --port "$RS_PORT" --host 127.0.0.1 --data "$WORKDIR/rust" --no-eavm &
pids+=($!)

aguarda() {
  local url=$1 nome=$2
  echo -n "[parity] aguardando $nome"
  for _ in $(seq 1 90); do
    if curl -fsS -H 'accept: application/json' "$url/status" >/dev/null 2>&1; then
      echo " ok"
      return 0
    fi
    echo -n "."
    sleep 0.4
  done
  echo " timeout" >&2
  return 1
}

aguarda "http://127.0.0.1:$JS_PORT" "JS"
aguarda "http://127.0.0.1:$RS_PORT" "Rust"

echo "[parity] alturas:"
curl -fsS -H 'accept: application/json' "http://127.0.0.1:$JS_PORT/status" | jq '{js: {height, headHash}}'
curl -fsS -H 'accept: application/json' "http://127.0.0.1:$RS_PORT/status" | jq '{rust: {height, headHash}}'

bash bin/eav7-api-parity.sh "http://127.0.0.1:$JS_PORT" "http://127.0.0.1:$RS_PORT"
echo "[parity] OK"
