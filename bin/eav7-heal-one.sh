#!/usr/bin/env bash
# Heal um anchor (nome) para a tip do hub — snap+bins inclusos.
# Uso: bash bin/eav7-heal-one.sh eav7-a3
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

want="${1:?nome do nó (ex: eav7-a3)}"
hub="${EAV7_NODE_PAIRS[1]}"
ip=""
i=0
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  if [[ "${EAV7_NODE_PAIRS[$i]}" == "$want" ]]; then
    ip="${EAV7_NODE_PAIRS[$((i+1))]}"
    break
  fi
  i=$((i+2))
done
[[ -n "$ip" ]] || { echo "nó desconhecido: $want" >&2; exit 2; }

ts="$(date -u +%Y%m%dT%H%M%SZ)"
echo "== Heal $want ($ip) =="

echo "  refresh package on hub"
eav7_deploy_ssh "$hub" '
set -euo pipefail
curl -fsS http://127.0.0.1:6070/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"hub\",d[\"height\"],d[\"headHash\"][:16])"
sudo mkdir -p /tmp/eav7-heal
sudo cp -f /var/lib/eav7/blocks.jsonl /tmp/eav7-heal/
sudo cp -f /var/lib/eav7/estado.snap /tmp/eav7-heal/ || true
sudo cp -f /var/lib/eav7/blocks.idx /tmp/eav7-heal/ 2>/dev/null || true
sudo cp -f /var/lib/eav7/hashes.bin /tmp/eav7-heal/ 2>/dev/null || true
sudo cp -f /usr/local/bin/eav7-node /tmp/eav7-heal/
sudo cp -f /usr/local/bin/eav7-core /tmp/eav7-heal/
sudo chown -R eav7:eav7 /tmp/eav7-heal
'

echo "  stop + backup on $want"
eav7_deploy_ssh "$ip" "
set -euo pipefail
sudo systemctl stop eav7-core || true
sudo mkdir -p /var/lib/eav7/fork-backup-$ts
for f in blocks.jsonl blocks.idx hashes.bin estado.snap; do
  [[ -f /var/lib/eav7/\$f ]] && sudo mv /var/lib/eav7/\$f /var/lib/eav7/fork-backup-$ts/\$f || true
done
sudo chown eav7:eav7 /var/lib/eav7
echo backed_up
"

echo "  stream chain+snap+bins"
# shellcheck disable=SC2086
ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@${hub}" \
  'cd /tmp/eav7-heal && tar cf - blocks.jsonl estado.snap blocks.idx hashes.bin eav7-node eav7-core' \
  | ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@${ip}" \
  'sudo -u eav7 tar xf - -C /var/lib/eav7'

echo "  install bins + start"
eav7_deploy_ssh "$ip" '
set -euo pipefail
if [[ -f /var/lib/eav7/eav7-node ]]; then
  sudo install -m 755 /var/lib/eav7/eav7-node /usr/local/bin/eav7-node
  sudo install -m 755 /var/lib/eav7/eav7-core /usr/local/bin/eav7-core
  sudo rm -f /var/lib/eav7/eav7-node /var/lib/eav7/eav7-core
fi
sudo chown eav7:eav7 /var/lib/eav7/blocks.jsonl /var/lib/eav7/estado.snap 2>/dev/null || true
sudo chown eav7:eav7 /var/lib/eav7/blocks.idx /var/lib/eav7/hashes.bin 2>/dev/null || true
t0=$(date +%s)
sudo systemctl start eav7-core
for n in $(seq 1 90); do
  if curl -fsS --max-time 2 http://127.0.0.1:6070/status >/tmp/st.json 2>/dev/null; then
    echo "RPC_UP_SEC=$(( $(date +%s) - t0 ))"
    python3 -c "import json;d=json.load(open(\"/tmp/st.json\"));print(\"tip\",d.get(\"height\"),str(d.get(\"headHash\"))[:20])"
    exit 0
  fi
  sleep 2
done
echo FAIL
sudo journalctl -u eav7-core -n 20 --no-pager
exit 1
'
echo "OK $want"
