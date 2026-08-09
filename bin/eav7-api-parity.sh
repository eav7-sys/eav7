#!/usr/bin/env bash
# Diffa respostas JSON de duas bases (JS vs Rust) nas rotas estáveis.
# Uso: bash bin/eav7-api-parity.sh http://127.0.0.1:6070 http://127.0.0.1:6071
set -euo pipefail

A="${1:-}"
B="${2:-}"
if [[ -z "$A" || -z "$B" ]]; then
  echo "uso: $0 <url-js> <url-rust>" >&2
  exit 2
fi

ROTAS=(
  "/status"
  "/blocks?limit=5"
  "/validators"
  "/stats"
  "/tokens"
  "/txs?limit=5"
)

# Remove campos voláteis entre processos (não são contrato de consenso).
normaliza() {
  jq 'del(.headTime, .peers, .mempool, .producer, .slotProducer) | walk(
        if type == "object" then del(.avgLatencyMs, .lastProducedHeight) else . end
      )'
}

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
falhas=0

for r in "${ROTAS[@]}"; do
  nome=$(echo "$r" | tr '/?=&' '____')
  curl -fsS "$A$r" | normaliza >"$tmpdir/a_$nome.json" || { echo "FALHA GET A $r"; falhas=$((falhas+1)); continue; }
  curl -fsS "$B$r" | normaliza >"$tmpdir/b_$nome.json" || { echo "FALHA GET B $r"; falhas=$((falhas+1)); continue; }
  if ! diff -u "$tmpdir/a_$nome.json" "$tmpdir/b_$nome.json" >"$tmpdir/diff_$nome.txt"; then
    echo "DIVERGE $r"
    cat "$tmpdir/diff_$nome.txt"
    falhas=$((falhas+1))
  else
    echo "ok $r"
  fi
done

exit "$falhas"
