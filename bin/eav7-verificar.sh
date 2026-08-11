#!/usr/bin/env bash
# Verificação do workspace Rust (protocolo + nó + SDK + Core).
# Uso: bash bin/eav7-verificar.sh
set -uo pipefail
cd "$(dirname "$0")/.."
falhas=0

secao() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
erro()  { printf '  \033[31m✗\033[0m %s\n' "$1"; falhas=$((falhas+1)); }

secao "cargo build + test"
if (cd rust && cargo build --workspace >/tmp/eav7-build.log 2>&1); then
  ok "compila"
else
  erro "build falhou — /tmp/eav7-build.log"
fi

if (cd rust && cargo test --workspace >/tmp/eav7-test.log 2>&1); then
  ok "$(grep -oE '^test result: ok\. [0-9]+' /tmp/eav7-test.log | awk '{s+=$4} END {print s+0}') testes"
else
  erro "testes falharam — /tmp/eav7-test.log"
fi

secao "clippy"
if (cd rust && cargo clippy --workspace --all-targets 2>&1 | tee /tmp/eav7-clippy.log | grep -qE '^(warning|error)'); then
  erro "clippy — /tmp/eav7-clippy.log"
else
  ok "clippy limpo"
fi

secao "vetores versionados"
if [[ -d vectors ]]; then
  ok "vectors/ presente (fixtures congelados)"
else
  erro "falta vectors/"
fi

secao "Resultado"
if [[ "$falhas" -eq 0 ]]; then
  printf '\033[32mOK\033[0m\n'
  exit 0
fi
printf '\033[31m%d falha(s)\033[0m\n' "$falhas"
exit 1
