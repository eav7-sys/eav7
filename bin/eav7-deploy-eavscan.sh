#!/usr/bin/env bash
# Deploy escalonado: build Next + checksum + api.js + healthcheck público.
# IPs vêm de deploy/nodes.env. Uso: bash bin/eav7-deploy-eavscan.sh
set -euo pipefail

# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

eav7_deploy_say "BUILD frontend (web-next standalone)"
(
  cd web-next
  npm ci --prefer-offline
  NEXT_PUBLIC_USE_MOCK=false npm run build
  # Standalone precisa dos estáticos ao lado do server.js
  mkdir -p .next/standalone/web-next/.next
  cp -R .next/static .next/standalone/web-next/.next/static 2>/dev/null \
    || cp -R .next/static .next/standalone/.next/static
  cp -R public .next/standalone/web-next/public 2>/dev/null \
    || cp -R public .next/standalone/public
)

API_JS="src/node/api.js"
STANDALONE_DIR="web-next/.next/standalone"
API_SUM="$(sha256_file "$API_JS")"
# Checksum do marcador do build (server.js) — prova que o bundle bate com o local.
SERVER_JS="$(find "$STANDALONE_DIR" -name server.js | head -1)"
[[ -n "$SERVER_JS" ]] || { echo "standalone sem server.js — build falhou?" >&2; exit 1; }
WEB_SUM="$(sha256_file "$SERVER_JS")"
echo "  api.js sha256     = $API_SUM"
echo "  server.js sha256  = $WEB_SUM"
mkdir -p deploy/checksums
printf '%s  %s\n' "$API_SUM" "$API_JS" > deploy/checksums/api.js.sha256
printf '%s  %s\n' "$WEB_SUM" "web-next/.next/standalone/server.js" > deploy/checksums/web-standalone.sha256

verify_node() {
  local ip=$1
  eav7_deploy_ssh "$ip" '
    for i in $(seq 1 60); do curl -s -H accept:application/json http://127.0.0.1:6070/status >/dev/null 2>&1 && break; sleep 1; done
    echo -n "  status : "; curl -s -H accept:application/json http://127.0.0.1:6070/status \
      | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"height\",d[\"height\"],\"| finalized\",d.get(\"finalizedHeight\"),\"| validators\",d[\"validators\"])"
    echo -n "  /nfts       -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:6070/nfts
    echo -n "  /names      -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:6070/names
    echo -n "  /governance -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:6070/governance
  '
}

i=0
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  name="${EAV7_NODE_PAIRS[i]}"
  ip="${EAV7_NODE_PAIRS[i+1]}"
  i=$((i + 2))
  eav7_deploy_say "BACKEND $name ($ip): rsync api.js + verify checksum + restart"
  eav7_deploy_rsync "$API_JS" "${EAV7_SSH_USER}@${ip}:${EAV7_REMOTE_NODE_DIR}/src/node/api.js"
  eav7_deploy_rsync deploy/checksums/api.js.sha256 \
    "${EAV7_SSH_USER}@${ip}:${EAV7_REMOTE_NODE_DIR}/deploy/checksums/api.js.sha256"
  remote_sum="$(eav7_deploy_ssh "$ip" "sha256sum ${EAV7_REMOTE_NODE_DIR}/src/node/api.js | awk '{print \$1}'")"
  [[ "$remote_sum" == "$API_SUM" ]] || { echo "checksum api.js divergiu em $ip ($remote_sum)" >&2; exit 1; }
  eav7_deploy_ssh "$ip" "sudo systemctl restart eav7"
  verify_node "$ip"
  echo "  -> $name backend OK"
done

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

eav7_deploy_say "HEALTHCHECK público (${EAV7_PUBLIC_URL})"
code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 30 "${EAV7_PUBLIC_URL}/" || echo fail)"
[[ "$code" == "200" || "$code" == "304" ]] || {
  echo "healthcheck público falhou: GET ${EAV7_PUBLIC_URL}/ → $code" >&2
  exit 1
}
# API via proxy do nó (ou rewrite Next /api) — tenta /api/status e cai em /status no host público.
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

eav7_deploy_say "DEPLOY CONCLUÍDO"
echo "Confira: ${EAV7_PUBLIC_URL}"
