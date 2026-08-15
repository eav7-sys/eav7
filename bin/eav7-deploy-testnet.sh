#!/usr/bin/env bash
# Sobe a testnet pública no hub (sem tocar na mainnet 72020).
#
# - Core testnet: API :6170 · EAVM RPC :7170 · chain id 72021
# - Explorer: :3001 · NEXT_PUBLIC_NETWORK=testnet (banner amarelo)
# - Cloudflare: testnet.eavscan.com → :3001 · rpc-testnet.eavscan.com → :7170
#
# Uso:
#   bash bin/eav7-deploy-testnet.sh
#   bash bin/eav7-deploy-testnet.sh --fresh-chain   # apaga dados testnet e re-gênese
#   bash bin/eav7-deploy-testnet.sh --skip-build    # só front + units (bins já no hub)
#   bash bin/eav7-deploy-testnet.sh --skip-front
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

FRESH=0
SKIP_BUILD=0
SKIP_FRONT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fresh-chain) FRESH=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-front) SKIP_FRONT=1; shift ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "arg desconhecido: $1" >&2; exit 2 ;;
  esac
done

hub_name="${EAV7_NODE_PAIRS[0]:-hub}"
hub_ip="${EAV7_NODE_PAIRS[1]:-}"
[[ -n "$hub_ip" ]] || { echo "deploy/nodes.env sem hub" >&2; exit 1; }

REMOTE_SRC="/opt/eav7-testnet-src"
REMOTE_DATA="/var/lib/eav7-testnet"
REMOTE_WEB="/opt/eav7-web-testnet"
API_PORT=6170
RPC_PORT=7170
WEB_PORT=3001
TUNNEL_ID="df6c61fd-cad8-48bf-bc0a-8f8b7b2bed2d"

eav7_deploy_say "TESTNET hub $hub_name ($hub_ip) · chain 72021"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  eav7_deploy_say "Rsync rust → $REMOTE_SRC"
  eav7_deploy_ssh "$hub_ip" "sudo mkdir -p '$REMOTE_SRC' && sudo chown '${EAV7_SSH_USER}:${EAV7_SSH_USER}' '$REMOTE_SRC'"
  eav7_deploy_rsync -a --delete \
    --exclude target \
    --exclude dist \
    --exclude .git \
    "$ROOT/rust/" "${EAV7_SSH_USER}@${hub_ip}:${REMOTE_SRC}/"

  eav7_deploy_say "Build eav7-*-testnet (feature testnet) no hub"
  eav7_deploy_ssh "$hub_ip" "
    set -euo pipefail
    export PATH=\"\$HOME/.cargo/bin:/usr/local/cargo/bin:\$PATH\"
    if ! command -v rustc >/dev/null 2>&1; then
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
      # shellcheck disable=SC1091
      source \"\$HOME/.cargo/env\"
    fi
    rustc --version
    cd '$REMOTE_SRC'
    cargo build --release -p eav7-node --features testnet
    cargo build --release -p eav7-core --features testnet
    sudo install -m 755 target/release/eav7-node /usr/local/bin/eav7-node-testnet
    sudo install -m 755 target/release/eav7-core /usr/local/bin/eav7-core-testnet
    /usr/local/bin/eav7-node-testnet --help >/dev/null 2>&1 || true
    echo \"  bins instalados\"
  "
fi

eav7_deploy_say "Init / unit Core testnet"
eav7_deploy_rsync "$ROOT/deploy/eav7-core-testnet.service.example" \
  "${EAV7_SSH_USER}@${hub_ip}:/tmp/eav7-core-testnet.service"
eav7_deploy_ssh "$hub_ip" "
  set -euo pipefail
  if [[ '$FRESH' == '1' ]]; then
    sudo systemctl stop eav7-core-testnet 2>/dev/null || true
    sudo rm -rf '$REMOTE_DATA'
  fi
  sudo mkdir -p '$REMOTE_DATA'
  sudo chown eav7:eav7 '$REMOTE_DATA'
  if [[ ! -f '$REMOTE_DATA/core.json' ]]; then
    sudo -u eav7 env EAV7_NODE_BIN=/usr/local/bin/eav7-node-testnet EAV7_GENESIS_ACTIVE=1 \
      /usr/local/bin/eav7-core-testnet init --dir '$REMOTE_DATA' \
      --mode validator --port $API_PORT --host 127.0.0.1
  fi
  sudo mv /tmp/eav7-core-testnet.service /etc/systemd/system/eav7-core-testnet.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now eav7-core-testnet
  sudo systemctl restart eav7-core-testnet
  for i in \$(seq 1 60); do
    if curl -fsS -H 'accept: application/json' --max-time 3 http://127.0.0.1:$API_PORT/status >/dev/null 2>&1; then
      echo -n '  /status -> '
      curl -fsS -H 'accept: application/json' http://127.0.0.1:$API_PORT/status \
        | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"height\", d.get(\"height\"), \"chain\", d.get(\"chain\"))'
      break
    fi
    sleep 1
  done
  echo -n '  eth_chainId -> '
  curl -fsS --max-time 5 -X POST http://127.0.0.1:$RPC_PORT \
    -H 'content-type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_chainId\",\"params\":[]}'
  echo
"

if [[ "$SKIP_FRONT" -eq 0 ]]; then
  eav7_deploy_say "BUILD frontend testnet (standalone :$WEB_PORT)"
  (
    cd "$ROOT/web-next"
    if [[ ! -d node_modules ]]; then npm ci --prefer-offline; fi
    NEXT_PUBLIC_USE_MOCK=false \
      NEXT_PUBLIC_API_BASE=/api \
      NEXT_PUBLIC_NETWORK=testnet \
      EAV7_API_ORIGIN=http://127.0.0.1:$API_PORT \
      npm run build
    mkdir -p .next/standalone/.next
    rm -rf .next/standalone/.next/static .next/standalone/public
    cp -R .next/static .next/standalone/.next/static
    cp -R public .next/standalone/public
    mkdir -p .next/standalone/data
    if [[ -d data ]]; then cp -R data/. .next/standalone/data/; fi
    printf '%s\n' \
      'NEXT_PUBLIC_API_BASE=/api' \
      'NEXT_PUBLIC_USE_MOCK=false' \
      'NEXT_PUBLIC_NETWORK=testnet' \
      > .next/standalone/.env.production
    find .next/standalone -name server.js | head -1 | grep -q . || {
      echo "standalone sem server.js" >&2
      exit 1
    }
  )

  eav7_deploy_rsync "$ROOT/deploy/eav7-web-testnet.service.example" \
    "${EAV7_SSH_USER}@${hub_ip}:/tmp/eav7-web-testnet.service"
  eav7_deploy_ssh "$hub_ip" "sudo mkdir -p '$REMOTE_WEB' && sudo chown '${EAV7_SSH_USER}:${EAV7_SSH_USER}' '$REMOTE_WEB'"
  eav7_deploy_rsync --delete "$ROOT/web-next/.next/standalone/" \
    "${EAV7_SSH_USER}@${hub_ip}:${REMOTE_WEB}/"
  # server.js pode estar em subpasta do standalone — normaliza WorkingDirectory
  eav7_deploy_ssh "$hub_ip" "
    set -euo pipefail
    SERVER=\$(find '$REMOTE_WEB' -name server.js | head -1)
    [[ -n \"\$SERVER\" ]] || { echo 'sem server.js'; exit 1; }
    WEB_DIR=\$(dirname \"\$SERVER\")
    sudo chown -R eav7:eav7 '$REMOTE_WEB'
    sudo sed \"s|WorkingDirectory=/opt/eav7-web-testnet|WorkingDirectory=\${WEB_DIR}|\" \
      /tmp/eav7-web-testnet.service | sudo tee /etc/systemd/system/eav7-web-testnet.service >/dev/null
    # se server.js não está na raiz do rsync, ajusta ExecStart cwd via unit já tem WorkingDirectory
    sudo systemctl daemon-reload
    sudo systemctl enable --now eav7-web-testnet
    sudo systemctl restart eav7-web-testnet
    for i in \$(seq 1 40); do
      curl -s -o /dev/null http://127.0.0.1:$WEB_PORT/ 2>/dev/null && break
      sleep 1
    done
    echo -n '  testnet web / -> '
    curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$WEB_PORT/
  "
fi

eav7_deploy_say "Cloudflare ingress (testnet + rpc-testnet)"
eav7_deploy_ssh "$hub_ip" "
  set -euo pipefail
  CFG=/etc/cloudflared/config.yml
  sudo cp -a \"\$CFG\" \"\$CFG.bak.testnet.\$(date +%s)\"
  sudo python3 - <<'PY'
from pathlib import Path
p = Path('/etc/cloudflared/config.yml')
raw = p.read_text()
# Strip any prior testnet host rules (hostname line + following indented lines).
lines = raw.splitlines()
out = []
i = 0
hosts = {'testnet.eavscan.com', 'rpc-testnet.eavscan.com'}
while i < len(lines):
    line = lines[i]
    stripped = line.strip()
    drop = False
    if stripped.startswith('- hostname:'):
        host = stripped.split(':', 1)[1].strip()
        if host in hosts:
            drop = True
            i += 1
            while i < len(lines) and (lines[i].startswith(' ') or lines[i].startswith('\t')):
                i += 1
            continue
    if not drop:
        out.append(line)
        i += 1
text = '\n'.join(out).rstrip() + '\n'
insert = (
    '  - hostname: testnet.eavscan.com\n'
    '    service: http://127.0.0.1:3001\n'
    '  - hostname: rpc-testnet.eavscan.com\n'
    '    service: http://127.0.0.1:7170\n'
)
catch = '  - service: http_status:404'
if catch in text:
    text = text.replace(catch, insert + catch, 1)
else:
    text = text + insert + catch + '\n'
Path('/tmp/cloudflared-config-testnet.yml').write_text(text)
print('ok')
PY
  sudo mv /tmp/cloudflared-config-testnet.yml \"\$CFG\"
  export TUNNEL_ORIGIN_CERT=/home/eav7/.cloudflared/cert.pem
  sudo -E cloudflared tunnel route dns --overwrite-dns $TUNNEL_ID testnet.eavscan.com \
    || echo '  (DNS testnet: falhou — confira cert.pem / Cloudflare)'
  sudo -E cloudflared tunnel route dns --overwrite-dns $TUNNEL_ID rpc-testnet.eavscan.com \
    || echo '  (DNS rpc-testnet: falhou — confira cert.pem / Cloudflare)'
  sudo systemctl restart cloudflared
  sleep 3
  sudo systemctl is-active cloudflared
"

eav7_deploy_say "Healthcheck público"
sleep 3
for url in \
  "https://testnet.eavscan.com/" \
  "https://rpc-testnet.eavscan.com/"; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$url" || echo fail)"
  echo "  $url -> $code"
done
echo -n "  eth_chainId público -> "
curl -fsS --max-time 30 -X POST https://rpc-testnet.eavscan.com/ \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' || echo fail
echo
echo -n "  /api/status testnet -> "
curl -fsS --max-time 30 https://testnet.eavscan.com/api/status \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("height", d.get("height"))' \
  || echo fail

eav7_deploy_say "TESTNET NO AR"
echo "  Explorer  https://testnet.eavscan.com  (banner amarelo)"
echo "  RPC       https://rpc-testnet.eavscan.com  (chainId 72021 / 0x11955)"
echo "  Mainnet   intocada (eavscan.com · :6070/:7070/:3000)"
