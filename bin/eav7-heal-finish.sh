#!/usr/bin/env bash
# Termina o heal: a5–a7 (e opcionalmente re-copia quem ainda diverge).
# Usa snapshot do hub + idx/hashes para boot mais rápido.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load
hub_ip="${EAV7_NODE_PAIRS[1]}"

TARGETS=()
if [[ $# -gt 0 ]]; then
  TARGETS=("$@")
else
  TARGETS=(eav7-a5 eav7-a6 eav7-a7)
fi

ip_for() {
  local want="$1" i=0
  while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
    if [[ "${EAV7_NODE_PAIRS[$i]}" == "$want" ]]; then
      echo "${EAV7_NODE_PAIRS[$((i+1))]}"
      return 0
    fi
    i=$((i+2))
  done
  return 1
}

eav7_deploy_say "Snapshot hub (+ idx/hashes)"
eav7_deploy_ssh "$hub_ip" '
set -euo pipefail
sudo mkdir -p /tmp/eav7-heal
sudo cp -f /var/lib/eav7/blocks.jsonl /tmp/eav7-heal/blocks.jsonl
sudo cp -f /var/lib/eav7/blocks.idx /tmp/eav7-heal/blocks.idx 2>/dev/null || true
sudo cp -f /var/lib/eav7/hashes.bin /tmp/eav7-heal/hashes.bin 2>/dev/null || true
sudo python3 - <<"PY"
from pathlib import Path
p = Path("/tmp/eav7-heal/blocks.jsonl")
data = p.read_bytes()
if data and not data.endswith(b"\n"):
    p.write_bytes(data.rsplit(b"\n", 1)[0] + b"\n")
print("lines", p.read_bytes().count(b"\n"))
PY
sudo chown -R eav7:eav7 /tmp/eav7-heal
ls -lh /tmp/eav7-heal/
'

for name in "${TARGETS[@]}"; do
  ip="$(ip_for "$name")"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  eav7_deploy_say "Heal $name ($ip)"
  eav7_deploy_ssh "$ip" "
set -euo pipefail
DATA=/var/lib/eav7
TS='$ts'
sudo systemctl stop eav7-core || true
sudo mkdir -p \"\$DATA/fork-backup-\$TS\"
for f in blocks.jsonl blocks.idx hashes.bin estado.snap; do
  [[ -f \"\$DATA/\$f\" ]] && sudo mv \"\$DATA/\$f\" \"\$DATA/fork-backup-\$TS/\$f\" || true
done
sudo chown eav7:eav7 \"\$DATA\"
"
  for f in blocks.jsonl blocks.idx hashes.bin; do
    echo "  stream $f"
    # shellcheck disable=SC2086
    ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@${hub_ip}" "cat /tmp/eav7-heal/$f" 2>/dev/null \
      | ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@${ip}" "sudo -u eav7 tee /var/lib/eav7/$f >/dev/null" \
      || echo "  skip $f"
  done
  eav7_deploy_ssh "$ip" '
set -euo pipefail
sudo chown eav7:eav7 /var/lib/eav7/blocks.jsonl
sudo rm -f /var/lib/eav7/estado.snap
wc -l /var/lib/eav7/blocks.jsonl
sudo systemctl start eav7-core
for n in $(seq 1 200); do
  if curl -fsS --max-time 2 http://127.0.0.1:6070/status >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:6070/status | python3 -c "import sys,json;d=json.load(sys.stdin); print(\"  tip\", d[\"height\"], d[\"headHash\"][:16])"
    exit 0
  fi
  (( n % 20 == 0 )) && echo "  waiting try=$n"
  sleep 5
done
echo RPC timeout >&2
sudo journalctl -u eav7-core -n 20 --no-pager
exit 1
'
done
eav7_deploy_say "HEAL-FINISH DONE"
