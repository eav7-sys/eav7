#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load
hub="${EAV7_NODE_PAIRS[1]}"
want="${1:?nome}"

ip=""
i=0
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  if [[ "${EAV7_NODE_PAIRS[$i]}" == "$want" ]]; then
    ip="${EAV7_NODE_PAIRS[$((i+1))]}"
    break
  fi
  i=$((i+2))
done
[[ -n "$ip" ]]

echo "== $want ($ip) =="
eav7_deploy_ssh "$ip" 'sudo systemctl stop eav7-core || true'
scp $EAV7_SSH_OPTS /tmp/eav7-node-roll "${EAV7_SSH_USER}@${ip}:/tmp/eav7-node"
scp $EAV7_SSH_OPTS /tmp/eav7-core-roll "${EAV7_SSH_USER}@${ip}:/tmp/eav7-core"
eav7_deploy_ssh "$ip" '
set -euo pipefail
sudo install -m 755 /tmp/eav7-node /usr/local/bin/eav7-node
sudo install -m 755 /tmp/eav7-core /usr/local/bin/eav7-core
sudo systemctl start eav7-core
sleep 5
curl -fsS http://127.0.0.1:6070/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"h1\",d[\"height\"])"
sudo journalctl -u eav7-core --since "30 sec ago" --no-pager | grep -iE "chave|p2p \+|add_block" | tail -8
sleep 20
curl -fsS http://127.0.0.1:6070/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"h2\",d[\"height\"])"
'
echo OK "$want"
