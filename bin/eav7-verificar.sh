#!/usr/bin/env bash
# Verificação COMPLETA do projeto EAV7 — os dois clientes, nos dois modos de fork.
#
# `cargo test` sozinho cobre o build padrão (alturas de fork reais). Mas o
# relançamento da rede usa GÊNESE-ATIVO (todos os forks em 0), e é nesse modo que
# as regras novas ficam ligadas desde o bloco 1 — inclusive as que a cadeia curta
# do fixture não alcança. Um cliente verde só no modo padrão não diz nada sobre a
# rede que vai de fato rodar.
#
# Este script roda os dois. Uso: bash bin/eav7-verificar.sh
set -uo pipefail
cd "$(dirname "$0")/.."
falhas=0

secao() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
erro()  { printf '  \033[31m✗\033[0m %s\n' "$1"; falhas=$((falhas+1)); }

secao "Referência JavaScript"
if npm test >/tmp/eav7-js.log 2>&1; then
  ok "$(grep -oE '^ℹ pass [0-9]+' /tmp/eav7-js.log | head -1) testes"
else
  erro "suíte JS falhou — ver /tmp/eav7-js.log"
fi

secao "Config gerado está em dia com a referência"
node bin/eav7-config-rs.js >/dev/null 2>&1
if git diff --quiet -- rust/src/config.rs 2>/dev/null; then
  ok "rust/src/config.rs bate com src/config.js"
else
  erro "config.rs DESATUALIZADO — regenere e commite (o gerador acabou de corrigi-lo)"
fi

for modo in normal genesis-ativo; do
  secao "Cliente Rust — modo $modo"
  if [ "$modo" = genesis-ativo ]; then
    EAV7_GENESIS_ACTIVE=1 node bin/eav7-config-rs.js >/dev/null
    EAV7_GENESIS_ACTIVE=1 node bin/eav7-gerar-cadeia-replay.js /tmp/eav7-cadeia-ga >/dev/null 2>&1
    export EAV7_REPLAY_DIR=/tmp/eav7-cadeia-ga
  else
    node bin/eav7-config-rs.js >/dev/null
    unset EAV7_REPLAY_DIR
  fi

  # O binário PRECISA compilar nos dois modos: é ele que roda em produção.
  if (cd rust && cargo build --workspace >/tmp/eav7-build-$modo.log 2>&1); then
    ok "compila"
  else
    erro "NÃO compila — ver /tmp/eav7-build-$modo.log"
    continue
  fi

  # A suíte de testes só é exigida no modo padrão: os ~35 testes de "abaixo do
  # fork" não podem existir quando o fork está em 0, e forçá-los seria testar
  # outra coisa. O que importa no gênese-ativo é o REPLAY.
  if [ "$modo" = normal ]; then
    if (cd rust && cargo test --workspace >/tmp/eav7-test.log 2>&1); then
      ok "$(grep -oE '^test result: ok\. [0-9]+' /tmp/eav7-test.log | awk '{s+=$4} END {print s}') testes"
    else
      erro "suíte Rust falhou — ver /tmp/eav7-test.log"
    fi
    if (cd rust && cargo clippy --workspace --all-targets 2>&1 | grep -qE '^(warning|error)'); then
      erro "clippy tem avisos"
    else
      ok "clippy limpo"
    fi
  fi

  if (cd rust && cargo test -p eav7 --test replay -- --nocapture >/tmp/eav7-replay-$modo.log 2>&1) \
     && grep -q "replay OK" /tmp/eav7-replay-$modo.log; then
    ok "$(grep -oE 'replay OK: [0-9]+ blocos' /tmp/eav7-replay-$modo.log)"
    grep "NÃO exercitado" /tmp/eav7-replay-$modo.log | sed 's/^/    /'
  else
    erro "replay falhou ou PULOU — ver /tmp/eav7-replay-$modo.log"
  fi
done

# Sempre devolve o repositório ao modo padrão, mesmo se algo acima falhou.
node bin/eav7-config-rs.js >/dev/null
unset EAV7_REPLAY_DIR

secao "Resultado"
if [ "$falhas" -eq 0 ]; then
  printf '  \033[32mTUDO VERDE\033[0m — os dois clientes, nos dois modos de fork.\n\n'
else
  printf '  \033[31m%d verificação(ões) falharam\033[0m\n\n' "$falhas"
fi
exit "$falhas"
