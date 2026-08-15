#!/usr/bin/env bash
# Rebuild no hub + instala bin em hub e a2–a7 + restart (boot rápido com producer_keys).
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
hub="${EAV7_NODE_PAIRS[1]}"

echo "== sync sources =="
scp $EAV7_SSH_OPTS "$ROOT/rust/src/blockchain.rs" "${EAV7_SSH_USER}@${hub}:/tmp/blockchain.rs"
scp $EAV7_SSH_OPTS "$ROOT/rust/node/src/p2p.rs" "${EAV7_SSH_USER}@${hub}:/tmp/p2p.rs"
eav7_deploy_ssh "$hub" '
set -euo pipefail
sudo install -m 644 -o eav7 -g eav7 /tmp/blockchain.rs /opt/eav7-testnet-src/src/blockchain.rs
sudo install -m 644 -o eav7 -g eav7 /tmp/p2p.rs /opt/eav7-testnet-src/node/src/p2p.rs
export PATH=/home/eav7/.cargo/bin:$PATH
source /home/eav7/.cargo/env 2>/dev/null || true
cd /opt/eav7-testnet-src
cargo build --release -p eav7-node -p eav7-core
grep -n "chave(s) de produtor" src/blockchain.rs | head -1
sudo install -m 755 target/release/eav7-node /usr/local/bin/eav7-node
sudo install -m 755 target/release/eav7-core /usr/local/bin/eav7-core
sudo cp -f /usr/local/bin/eav7-node /usr/local/bin/eav7-core /tmp/eav7-heal/
sudo systemctl restart eav7-core
sleep 5
curl -fsS http://127.0.0.1:6070/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"hub\",d[\"height\"])"
sudo journalctl -u eav7-core --since "1 min ago" --no-pager | grep -iE "chave|snapshot|API|p2p \+" | tail -15
'

i=2
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  name="${EAV7_NODE_PAIRS[$i]}"; ip="${EAV7_NODE_PAIRS[$((i+1))]}"; i=$((i+2))
  echo "== install+restart $name =="
  ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@${hub}" 'cat /tmp/eav7-heal/eav7-node' \
    | ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@${ip}" 'sudo tee /usr/local/bin/eav7-node >/dev/null && sudo chmod 755 /usr/local/bin/eav7-node'
  ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@${hub}" 'cat /tmp/eav7-heal/eav7-core' \
    | ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@${ip}" 'sudo tee /usr/local/bin/eav7-core >/dev/null && sudo chmod 755 /usr/local/bin/eav7-core'
  eav7_deploy_ssh "$ip" '
set -euo pipefail
sudo systemctl restart eav7-core
sleep 6
curl -fsS http://127.0.0.1:6070/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"h1\",d[\"height\"])"
sleep 25
curl -fsS http://127.0.0.1:6070/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"h2\",d[\"height\"])"
sudo journalctl -u eav7-core --since "1 min ago" --no-pager | grep -iE "chave|p2p|add_block|snapshot" | tail -12
'
done

echo "== final tips =="
eav7_deploy_ssh "$hub" '
curl -fsS http://127.0.0.1:6070/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"hub\",d[\"height\"],d[\"headHash\"][:16])"
for ip in 10.10.10.12 10.10.10.13 10.10.10.14 10.10.10.15 10.10.10.16 10.10.10.17; do
  curl -fsS --max-time 3 http://$ip:6070/status 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"$ip\",d.get(\"height\"),str(d.get(\"headHash\"))[:16])" || echo "$ip DOWN"
done
'
echo DONE
