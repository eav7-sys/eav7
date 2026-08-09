#!/usr/bin/env bash
# Pré-voo local antes de subir produção. Não deploya.
# Uso: bash bin/eav7-go-live-check.sh
#      bash bin/eav7-go-live-check.sh --full   # inclui npm test + cargo test
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
  erro "há mudanças sem commit — não suba código sujo"
fi
if git remote | grep -q .; then
  ok "remote: $(git remote | tr '\n' ' ')"
  if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    ok "upstream: $(git rev-parse --abbrev-ref '@{u}')"
  else
    warn "branch sem upstream — configure git push -u"
  fi
else
  erro "nenhum git remote — sem isso não há Release Core (Windows .exe) no GitHub"
fi

secao "Deploy inventário"
if [[ -f deploy/nodes.env ]]; then
  ok "deploy/nodes.env existe"
  # shellcheck disable=SC1091
  set -a; source deploy/nodes.env; set +a
  if [[ -n "${EAV7_NODES:-}" ]]; then
    # shellcheck disable=SC2206
    pairs=($EAV7_NODES)
    if (( ${#pairs[@]} % 2 == 0 && ${#pairs[@]} >= 2 )); then
      ok "EAV7_NODES: $((${#pairs[@]}/2)) nó(s)"
    else
      erro "EAV7_NODES malformado (pares nome ip)"
    fi
  else
    erro "EAV7_NODES vazio"
  fi
  KEY="${EAV7_SSH_KEY:-$HOME/.ssh/eav7_deploy}"
  [[ -f "$KEY" ]] && ok "chave SSH: $KEY" || erro "chave SSH ausente: $KEY"
  echo "  PUBLIC_URL=${EAV7_PUBLIC_URL:-https://eavscan.com}"
else
  erro "falta deploy/nodes.env (cp deploy/nodes.example deploy/nodes.env)"
fi

secao "Scripts go-live"
for s in bin/eav7-deploy-nodes.sh bin/eav7-deploy-eavscan.sh bin/eav7-package-core.sh \
         bin/eav7-verificar.sh .github/workflows/release-core.yml; do
  [[ -f "$s" ]] && ok "$s" || erro "falta $s"
done
[[ -x bin/eav7-deploy-nodes.sh ]] || chmod +x bin/eav7-deploy-*.sh bin/eav7-go-live-check.sh bin/eav7-package-core.sh 2>/dev/null || true

secao "Config Rust ↔ JS"
node bin/eav7-config-rs.js >/dev/null 2>&1 || true
if git diff --quiet -- rust/src/config.rs 2>/dev/null; then
  ok "rust/src/config.rs sincronizado"
else
  erro "config.rs divergente — rode node bin/eav7-config-rs.js e commit"
fi

if [[ "$FULL" -eq 1 ]]; then
  secao "Testes (--full)"
  if npm test >/tmp/eav7-golive-js.log 2>&1; then
    ok "npm test"
  else
    erro "npm test falhou — /tmp/eav7-golive-js.log"
  fi
  if (cd rust && cargo test -p eav7 --lib >/tmp/eav7-golive-rs.log 2>&1); then
    ok "cargo test -p eav7 --lib"
  else
    erro "cargo test falhou — /tmp/eav7-golive-rs.log"
  fi
else
  secao "Testes"
  warn "pulei suíte (use --full). Recomendado: npm run verificar antes do tag."
fi

secao "Release Core"
if git tag -l 'v*' | grep -q .; then
  ok "tags locais: $(git tag -l 'v*' | tail -3 | tr '\n' ' ')"
else
  warn "nenhuma tag v* local — após verde: git tag v0.1.0 && git push origin v0.1.0"
fi
if [[ -f rust/dist/*.tar.gz ]] 2>/dev/null || ls rust/dist/eav7-core-*.tar.gz >/dev/null 2>&1; then
  ok "pacote local em rust/dist/"
else
  warn "sem pacote local — bash bin/eav7-package-core.sh 0.1.0 (só host atual)"
fi

secao "Resultado"
if [[ "$falhas" -eq 0 ]]; then
  printf '\033[32mPronto para o checklist de docs/go-live.md\033[0m\n'
  exit 0
fi
printf '\033[31m%d bloqueio(s) — corrija antes de subir\033[0m\n' "$falhas"
exit 1
