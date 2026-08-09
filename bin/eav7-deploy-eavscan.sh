#!/usr/bin/env bash
# Deploy escalonado: api.js + frontend standalone. IPs vêm de deploy/nodes.env.
# Uso: bash bin/eav7-deploy-eavscan.sh
set -euo pipefail

# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

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
  eav7_deploy_say "BACKEND $name ($ip): rsync api.js + restart eav7"
  eav7_deploy_rsync src/node/api.js "${EAV7_SSH_USER}@${ip}:${EAV7_REMOTE_NODE_DIR}/src/node/api.js"
  eav7_deploy_ssh "$ip" "sudo systemctl restart eav7"
  verify_node "$ip"
  echo "  -> $name backend OK"
done

i=0
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  name="${EAV7_NODE_PAIRS[i]}"
  ip="${EAV7_NODE_PAIRS[i+1]}"
  i=$((i + 2))
  eav7_deploy_say "FRONTEND $name ($ip): rsync bundle + restart eav7-web"
  eav7_deploy_rsync --delete web-next/.next/standalone/ \
    "${EAV7_SSH_USER}@${ip}:${EAV7_REMOTE_WEB_DIR}/"
  eav7_deploy_ssh "$ip" "sudo systemctl daemon-reload && sudo systemctl restart eav7-web"
  eav7_deploy_ssh "$ip" '
    for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null && break; sleep 1; done
    echo -n "  eav7-web / -> ";     curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
    echo -n "  eav7-web /nfts -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/nfts
  '
  echo "  -> $name frontend OK"
done

eav7_deploy_say "DEPLOY CONCLUÍDO"
echo "Confira: ${EAV7_PUBLIC_URL}"
