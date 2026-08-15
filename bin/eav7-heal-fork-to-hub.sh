#!/usr/bin/env bash
# Realinha a2–a7 na cadeia canónica do hub (explorer).
# Uso: bash bin/eav7-heal-fork-to-hub.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

hub_ip="${EAV7_NODE_PAIRS[1]:-}"
[[ -n "$hub_ip" ]] || { echo "deploy/nodes.env sem hub" >&2; exit 1; }

eav7_deploy_say "Snapshot canónico no hub ($hub_ip)"
eav7_deploy_ssh "$hub_ip" '
set -euo pipefail
sudo mkdir -p /tmp/eav7-heal
sudo cp -f /var/lib/eav7/blocks.jsonl /tmp/eav7-heal/blocks.jsonl
sudo python3 - <<"PY"
from pathlib import Path
p = Path("/tmp/eav7-heal/blocks.jsonl")
data = p.read_bytes()
if data and not data.endswith(b"\n"):
    data = data.rsplit(b"\n", 1)[0] + b"\n"
    p.write_bytes(data)
    print("trimmed incomplete trailing line")
print("lines", data.count(b"\n"))
PY
sudo chown eav7:eav7 /tmp/eav7-heal/blocks.jsonl
ls -lh /tmp/eav7-heal/blocks.jsonl
curl -fsS http://127.0.0.1:6070/status | python3 -c "import sys,json;d=json.load(sys.stdin); print(\"live_tip\", d[\"height\"], d[\"headHash\"][:16])"
'

eav7_deploy_say "Parar a2–a7"
i=2
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  name="${EAV7_NODE_PAIRS[$i]}"
  ip="${EAV7_NODE_PAIRS[$((i+1))]}"
  i=$((i+2))
  echo -n "  $name: "
  eav7_deploy_ssh "$ip" 'sudo systemctl stop eav7-core && echo stopped'
done

heal_one() {
  local name="$1" ip="$2"
  local ts
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  eav7_deploy_say "Heal $name ($ip)"
  eav7_deploy_ssh "$ip" "
set -euo pipefail
DATA=/var/lib/eav7
TS='$ts'
sudo systemctl stop eav7-core || true
sudo mkdir -p \"\$DATA/fork-backup-\$TS\"
for f in blocks.jsonl blocks.idx hashes.bin estado.snap; do
  if [[ -f \"\$DATA/\$f\" ]]; then
    sudo mv \"\$DATA/\$f\" \"\$DATA/fork-backup-\$TS/\$f\"
  fi
done
sudo mkdir -p \"\$DATA\"
sudo chown eav7:eav7 \"\$DATA\"
echo \"  backed up -> \$DATA/fork-backup-\$TS\"
"
  echo "  streaming blocks.jsonl from hub..."
  # shellcheck disable=SC2086
  ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@${hub_ip}" 'cat /tmp/eav7-heal/blocks.jsonl' \
    | ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@${ip}" 'sudo -u eav7 tee /var/lib/eav7/blocks.jsonl >/dev/null'
  eav7_deploy_ssh "$ip" '
set -euo pipefail
sudo chown eav7:eav7 /var/lib/eav7/blocks.jsonl
wc -l /var/lib/eav7/blocks.jsonl
sudo systemctl start eav7-core
ready=0
for n in $(seq 1 180); do
  if curl -fsS --max-time 2 http://127.0.0.1:6070/status >/dev/null 2>&1; then
    ready=1
    echo "  RPC up try=$n"
    curl -fsS http://127.0.0.1:6070/status | python3 -c "import sys,json;d=json.load(sys.stdin); print(\"  tip\", d.get(\"height\"), str(d.get(\"headHash\"))[:20])"
    break
  fi
  if (( n % 15 == 0 )); then
    echo "  waiting boot try=$n"
    sudo journalctl -u eav7-core -n 2 --no-pager | tail -2 || true
  fi
  sleep 5
done
[[ $ready -eq 1 ]] || { echo "RPC timeout" >&2; sudo journalctl -u eav7-core -n 40 --no-pager; exit 1; }
'
}

i=2
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  name="${EAV7_NODE_PAIRS[$i]}"
  ip="${EAV7_NODE_PAIRS[$((i+1))]}"
  i=$((i+2))
  heal_one "$name" "$ip"
done

eav7_deploy_say "Verificação tip/head"
eav7_deploy_ssh "$hub_ip" 'python3 - <<"PY"
import json, urllib.request, time
time.sleep(2)

def st(ip):
    return json.load(urllib.request.urlopen(f"http://{ip}:6070/status", timeout=10))

hub = st("10.10.10.11")
print("HUB", hub["height"], hub["headHash"][:24])
ok = True
for i, name in enumerate(["a2", "a3", "a4", "a5", "a6", "a7"], start=12):
    d = st(f"10.10.10.{i}")
    delta = d["height"] - hub["height"]
    same_head = d["headHash"] == hub["headHash"]
    flag = "OK" if same_head or abs(delta) <= 30 else "DRIFT"
    if abs(delta) > 200:
        ok = False
    print(name, d["height"], d["headHash"][:24], "delta", delta, flag)
print("RESULT", "PASS" if ok else "CHECK")
PY'

eav7_deploy_say "HEAL DONE — conferir https://eavscan.com (validators)"
