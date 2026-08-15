#!/usr/bin/env bash
# Instala/atualiza o faucet da testnet pública no hub.
#
# Uso: bash bin/eav7-deploy-faucet-testnet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

hub_ip="${EAV7_NODE_PAIRS[1]:-}"
[[ -n "$hub_ip" ]] || { echo "deploy/nodes.env sem hub" >&2; exit 1; }

REMOTE_DIR="/opt/eav7-faucet"
TUNNEL_ID="df6c61fd-cad8-48bf-bc0a-8f8b7b2bed2d"

eav7_deploy_say "Faucet → $hub_ip"
eav7_deploy_ssh "$hub_ip" "sudo mkdir -p '$REMOTE_DIR' && sudo chown '${EAV7_SSH_USER}:${EAV7_SSH_USER}' '$REMOTE_DIR'"
eav7_deploy_rsync "$ROOT/services/faucet/index.mjs" \
  "${EAV7_SSH_USER}@${hub_ip}:${REMOTE_DIR}/index.mjs"
eav7_deploy_rsync "$ROOT/deploy/eav7-faucet-testnet.service.example" \
  "${EAV7_SSH_USER}@${hub_ip}:/tmp/eav7-faucet-testnet.service"

eav7_deploy_ssh "$hub_ip" "
  set -euo pipefail
  # CLI precisa de leitura da carteira do validador (0600 eav7:eav7).
  sudo chown -R eav7:eav7 '$REMOTE_DIR'
  sudo chmod 755 '$REMOTE_DIR'
  sudo chmod 644 '$REMOTE_DIR/index.mjs'
  sudo mv /tmp/eav7-faucet-testnet.service /etc/systemd/system/eav7-faucet-testnet.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now eav7-faucet-testnet
  sudo systemctl restart eav7-faucet-testnet
  for i in \$(seq 1 20); do
    curl -fsS http://127.0.0.1:8790/status >/dev/null 2>&1 && break
    sleep 0.5
  done
  echo -n '  /status -> '
  curl -fsS http://127.0.0.1:8790/status
  echo
"

eav7_deploy_say "Cloudflare faucet-testnet.eavscan.com"
eav7_deploy_ssh "$hub_ip" "
  set -euo pipefail
  CFG=/etc/cloudflared/config.yml
  sudo cp -a \"\$CFG\" \"\$CFG.bak.faucet.\$(date +%s)\"
  sudo python3 - <<'PY'
from pathlib import Path
p = Path('/etc/cloudflared/config.yml')
lines = p.read_text().splitlines()
out = []
i = 0
host = 'faucet-testnet.eavscan.com'
while i < len(lines):
    line = lines[i]
    stripped = line.strip()
    if stripped.startswith('- hostname:') and stripped.split(':',1)[1].strip() == host:
        i += 1
        while i < len(lines) and (lines[i].startswith(' ') or lines[i].startswith('\t')):
            i += 1
        continue
    out.append(line)
    i += 1
text = '\n'.join(out).rstrip() + '\n'
insert = (
    '  - hostname: faucet-testnet.eavscan.com\n'
    '    service: http://127.0.0.1:8790\n'
)
catch = '  - service: http_status:404'
if catch in text:
    text = text.replace(catch, insert + catch, 1)
else:
    text += insert + catch + '\n'
Path('/tmp/cloudflared-config-faucet.yml').write_text(text)
print('ok')
PY
  sudo mv /tmp/cloudflared-config-faucet.yml \"\$CFG\"
  export TUNNEL_ORIGIN_CERT=/home/eav7/.cloudflared/cert.pem
  sudo -E cloudflared tunnel route dns --overwrite-dns $TUNNEL_ID faucet-testnet.eavscan.com \
    || echo '  (DNS: confira cert / Cloudflare)'
  sudo systemctl restart cloudflared
  sleep 3
"

eav7_deploy_say "Smoke"
sleep 2
curl -fsS --max-time 20 https://faucet-testnet.eavscan.com/status
echo
eav7_deploy_say "FAUCET NO AR"
echo "  https://faucet-testnet.eavscan.com/status"
echo "  POST /faucet {\"address\":\"E7…\"} · 100 EAV7 / hora"
