#!/usr/bin/env bash
# Pré-voo antes de subir produção. Não deploya.
# Uso: bash bin/eav7-go-live-check.sh
#      bash bin/eav7-go-live-check.sh --full
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

FULL=0
[[ "${1:-}" == "--full" ]] && FULL=1

falhas=0
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$1"; }
erro(){ printf '  \033[31m✗\033[0m %s\n' "$1"; falhas=$((falhas+1)); }
secao(){ printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

secao "Git"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
echo "  branch: $BRANCH"
if git diff --quiet && git diff --cached --quiet; then
  ok "working tree limpa"
else
  erro "há mudanças sem commit"
fi
if git remote | grep -q .; then
  ok "remote: $(git remote | tr '\n' ' ')"
else
  erro "nenhum git remote"
fi

secao "Deploy inventário"
if [[ -f deploy/nodes.env ]]; then
  ok "deploy/nodes.env existe"
  set -a; # shellcheck disable=SC1091
  source deploy/nodes.env; set +a
  if [[ -n "${EAV7_NODES:-}" ]]; then
    # shellcheck disable=SC2206
    pairs=($EAV7_NODES)
    if (( ${#pairs[@]} % 2 == 0 && ${#pairs[@]} >= 2 )); then
      ok "EAV7_NODES: $((${#pairs[@]}/2)) nó(s)"
    else
      erro "EAV7_NODES malformado"
    fi
  else
    erro "EAV7_NODES vazio"
  fi
  KEY="${EAV7_SSH_KEY:-$HOME/.ssh/eav7_deploy}"
  [[ -f "$KEY" ]] && ok "chave SSH: $KEY" || erro "chave SSH ausente: $KEY"
  echo "  PUBLIC_URL=${EAV7_PUBLIC_URL:-https://eavscan.com}"
else
  erro "falta deploy/nodes.env"
fi

secao "Scripts"
for s in bin/eav7-deploy-core.sh bin/eav7-deploy-eavscan.sh bin/eav7-package-core.sh \
         bin/eav7-dev-up.sh .github/workflows/release-core.yml deploy/eav7-core.service.example; do
  [[ -f "$s" ]] && ok "$s" || erro "falta $s"
done
chmod +x bin/eav7-deploy-*.sh bin/eav7-go-live-check.sh bin/eav7-package-core.sh bin/eav7-dev-up.sh 2>/dev/null || true

if [[ "$FULL" -eq 1 ]]; then
  secao "Testes (--full)"
  if (cd rust && cargo test -p eav7 --lib >/tmp/eav7-golive-rs.log 2>&1); then
    ok "cargo test -p eav7 --lib"
  else
    erro "cargo test falhou — /tmp/eav7-golive-rs.log"
  fi
else
  secao "Testes"
  warn "pulei (use --full ou npm run verificar)"
fi

secao "Release Core"
if git tag -l 'v*' | grep -q .; then
  ok "tags: $(git tag -l 'v*' | tail -3 | tr '\n' ' ')"
else
  warn "nenhuma tag v* local"
fi

secao "Resultado"
if [[ "$falhas" -eq 0 ]]; then
  printf '\033[32mPronto — docs/go-live.md\033[0m\n'
  exit 0
fi
printf '\033[31m%d bloqueio(s)\033[0m\n' "$falhas"
exit 1
