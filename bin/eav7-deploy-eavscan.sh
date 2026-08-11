#!/usr/bin/env bash
# Go-live: Core Rust nos nós + Next standalone + health público.
# O caminho protocolo (rsync src/) foi aposentado — use bin/eav7-deploy-core.sh.
#
# Uso:
#   bash bin/eav7-deploy-eavscan.sh
#   bash bin/eav7-deploy-eavscan.sh --from-release v0.1.0
#   bash bin/eav7-deploy-eavscan.sh --skip-core
#   bash bin/eav7-deploy-eavscan.sh --skip-frontend
#   bash bin/eav7-deploy-eavscan.sh --skip-public-health
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

SKIP_CORE=0
SKIP_FRONTEND=0
SKIP_PUBLIC=0
CORE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-core|--skip-nodes) SKIP_CORE=1; shift ;;
    --skip-frontend) SKIP_FRONTEND=1; shift ;;
    --skip-public-health) SKIP_PUBLIC=1; shift ;;
    --from-release)
      CORE_ARGS+=(--from-release "${2:?}")
      shift 2
      ;;
    --from-release=*)
      CORE_ARGS+=(--from-release "${1#*=}")
      shift
      ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "arg desconhecido: $1" >&2
      exit 2
      ;;
  esac
done

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

if [[ "$SKIP_CORE" -eq 0 ]]; then
  bash "$ROOT/bin/eav7-deploy-core.sh" "${CORE_ARGS[@]}"
else
  eav7_deploy_say "CORE: pulado"
fi

STANDALONE_DIR="web-next/.next/standalone"
if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
  eav7_deploy_say "BUILD frontend (web-next standalone)"
  (
    cd web-next
    npm ci --prefer-offline
    # NEXT_PUBLIC_* é bake no build — systemd NÃO altera o bundle do browser.
    NEXT_PUBLIC_USE_MOCK=false \
      NEXT_PUBLIC_API_BASE=/api \
      NEXT_PUBLIC_NETWORK=mainnet \
      npm run build
    # Standalone NÃO inclui .next/static; sem isto CSS/JS viram 404 no eavscan.
    mkdir -p .next/standalone/.next
    rm -rf .next/standalone/.next/static .next/standalone/public
    cp -R .next/static .next/standalone/.next/static
    cp -R public .next/standalone/public
    mkdir -p .next/standalone/data
    if [[ -d data ]]; then cp -R data/. .next/standalone/data/; fi
    printf '%s\n' \
      'NEXT_PUBLIC_API_BASE=/api' \
      'NEXT_PUBLIC_USE_MOCK=false' \
      'NEXT_PUBLIC_NETWORK=mainnet' \
      > .next/standalone/.env.production
    [[ -d .next/standalone/.next/static/chunks ]] || {
      echo "standalone sem .next/static/chunks — abort" >&2
      exit 1
    }
  )

  SERVER_JS="$(find "$STANDALONE_DIR" -name server.js | head -1)"
  [[ -n "$SERVER_JS" ]] || { echo "standalone sem server.js — build falhou?" >&2; exit 1; }
  WEB_SUM="$(sha256_file "$SERVER_JS")"
  mkdir -p deploy/checksums
  printf '%s  %s\n' "$WEB_SUM" "web-next/.next/standalone/server.js" \
    > deploy/checksums/web-standalone.sha256
  echo "  server.js sha256 = $WEB_SUM"

  # Cloudflare Tunnel só aponta eavscan.com → hub:3000.
  hub_name="${EAV7_NODE_PAIRS[0]:-hub}"
  hub_ip="${EAV7_NODE_PAIRS[1]:-}"
  [[ -n "$hub_ip" ]] || { echo "deploy/nodes.env sem hub" >&2; exit 1; }
  eav7_deploy_say "FRONTEND $hub_name ($hub_ip)"
  eav7_deploy_rsync --delete "$STANDALONE_DIR/" \
    "${EAV7_SSH_USER}@${hub_ip}:${EAV7_REMOTE_WEB_DIR}/"
  eav7_deploy_ssh "$hub_ip" "sudo systemctl daemon-reload && sudo systemctl restart eav7-web"
  eav7_deploy_ssh "$hub_ip" '
    for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null && break; sleep 1; done
    echo -n "  eav7-web / -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
    css=$(curl -sS http://127.0.0.1:3000/ | tr \" "\n" | grep "_next/static/.*\\.css" | head -1)
    echo -n "  ${css} -> "; curl -sS -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000${css}"
  '
  echo "  -> $hub_name frontend OK"
else
  eav7_deploy_say "FRONTEND: pulado"
fi

if [[ "$SKIP_PUBLIC" -eq 0 ]]; then
  eav7_deploy_say "HEALTHCHECK público (${EAV7_PUBLIC_URL})"
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 30 "${EAV7_PUBLIC_URL}/" || echo fail)"
  [[ "$code" == "200" || "$code" == "304" ]] || {
    echo "healthcheck público falhou: GET ${EAV7_PUBLIC_URL}/ → $code" >&2
    echo "Dica: --skip-public-health se o túnel ainda estiver off." >&2
    exit 1
  }
  api_ok=0
  for path in /api/status /status; do
    if curl -fsS -H 'accept: application/json' --max-time 30 "${EAV7_PUBLIC_URL}${path}" \
      | python3 -c 'import sys,json; d=json.load(sys.stdin); assert "height" in d' 2>/dev/null; then
      echo "  ✔ ${EAV7_PUBLIC_URL}${path}"
      api_ok=1
      break
    fi
  done
  [[ "$api_ok" -eq 1 ]] || { echo "healthcheck API público falhou" >&2; exit 1; }
else
  eav7_deploy_say "HEALTHCHECK público: pulado"
fi

eav7_deploy_say "DEPLOY CONCLUÍDO (Core + Next)"
echo "Confira: ${EAV7_PUBLIC_URL}"
