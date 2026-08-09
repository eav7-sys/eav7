#!/usr/bin/env bash
# Go-live / redeploy completo: nós (src+bin) + Next standalone + health público.
# IPs em deploy/nodes.env.
#
# Uso:
#   bash bin/eav7-deploy-eavscan.sh
#   bash bin/eav7-deploy-eavscan.sh --skip-nodes
#   bash bin/eav7-deploy-eavscan.sh --skip-frontend
#   bash bin/eav7-deploy-eavscan.sh --skip-public-health
#   bash bin/eav7-deploy-eavscan.sh --skip-replay
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

SKIP_NODES=0
SKIP_FRONTEND=0
SKIP_PUBLIC=0
SKIP_REPLAY=0
for arg in "$@"; do
  case "$arg" in
    --skip-nodes) SKIP_NODES=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --skip-public-health) SKIP_PUBLIC=1 ;;
    --skip-replay) SKIP_REPLAY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
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

if [[ "$SKIP_NODES" -eq 0 ]]; then
  NODE_ARGS=()
  [[ "$SKIP_REPLAY" -eq 1 ]] && NODE_ARGS+=(--skip-replay)
  bash "$ROOT/bin/eav7-deploy-nodes.sh" "${NODE_ARGS[@]}"
else
  eav7_deploy_say "NÓS: pulado (--skip-nodes)"
fi

STANDALONE_DIR="web-next/.next/standalone"
if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
  eav7_deploy_say "BUILD frontend (web-next standalone)"
  (
    cd web-next
    npm ci --prefer-offline
    NEXT_PUBLIC_USE_MOCK=false npm run build
    mkdir -p .next/standalone/web-next/.next
    cp -R .next/static .next/standalone/web-next/.next/static 2>/dev/null \
      || cp -R .next/static .next/standalone/.next/static
    cp -R public .next/standalone/web-next/public 2>/dev/null \
      || cp -R public .next/standalone/public
  )

  SERVER_JS="$(find "$STANDALONE_DIR" -name server.js | head -1)"
  [[ -n "$SERVER_JS" ]] || { echo "standalone sem server.js — build falhou?" >&2; exit 1; }
  WEB_SUM="$(sha256_file "$SERVER_JS")"
  mkdir -p deploy/checksums
  printf '%s  %s\n' "$WEB_SUM" "web-next/.next/standalone/server.js" \
    > deploy/checksums/web-standalone.sha256
  echo "  server.js sha256 = $WEB_SUM"

  i=0
  while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
    name="${EAV7_NODE_PAIRS[i]}"
    ip="${EAV7_NODE_PAIRS[i+1]}"
    i=$((i + 2))
    eav7_deploy_say "FRONTEND $name ($ip): rsync standalone + restart eav7-web"
    eav7_deploy_rsync --delete "$STANDALONE_DIR/" \
      "${EAV7_SSH_USER}@${ip}:${EAV7_REMOTE_WEB_DIR}/"
    eav7_deploy_ssh "$ip" "sudo systemctl daemon-reload && sudo systemctl restart eav7-web"
    eav7_deploy_ssh "$ip" '
      for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null && break; sleep 1; done
      echo -n "  eav7-web / -> ";     curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
      echo -n "  eav7-web /nfts -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/nfts
    '
    echo "  -> $name frontend OK"
  done
else
  eav7_deploy_say "FRONTEND: pulado (--skip-frontend)"
fi

if [[ "$SKIP_PUBLIC" -eq 0 ]]; then
  eav7_deploy_say "HEALTHCHECK público (${EAV7_PUBLIC_URL})"
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 30 "${EAV7_PUBLIC_URL}/" || echo fail)"
  [[ "$code" == "200" || "$code" == "304" ]] || {
    echo "healthcheck público falhou: GET ${EAV7_PUBLIC_URL}/ → $code" >&2
    echo "Dica: se o DNS/túnel ainda está off, use --skip-public-health e confira depois." >&2
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
  eav7_deploy_say "HEALTHCHECK público: pulado (--skip-public-health)"
fi

eav7_deploy_say "DEPLOY CONCLUÍDO"
echo "Confira: ${EAV7_PUBLIC_URL}"
