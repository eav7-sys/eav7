#!/usr/bin/env bash
# Ativa a camada de IA no hub: oráculo (+ sentinela opcional).
#
# - Gera /var/lib/eav7/oracle-wallet.json se não existir
# - Financia ~600 EAV7 a partir da carteira do validador (stake mín. 500)
# - Liga EAV7_ORACLE_WALLET (+ EAV7_SENTINEL=1) no unit e reinicia o Core
#
# Uso:
#   bash bin/eav7-activate-ai.sh
#   bash bin/eav7-activate-ai.sh --no-sentinel
#   bash bin/eav7-activate-ai.sh --amount 600
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

SENTINEL=1
AMOUNT="600"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-sentinel) SENTINEL=0; shift ;;
    --amount) AMOUNT="${2:?}"; shift 2 ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "arg desconhecido: $1" >&2; exit 2 ;;
  esac
done

hub_ip="${EAV7_NODE_PAIRS[1]:-}"
[[ -n "$hub_ip" ]] || { echo "deploy/nodes.env sem hub" >&2; exit 1; }

DATA="/var/lib/eav7"
ORACLE_WALLET="$DATA/oracle-wallet.json"
VALIDATOR_WALLET="$DATA/validator-wallet.json"
NODE_URL="http://127.0.0.1:6070"
CLI="/usr/local/bin/eav7-cli"

eav7_deploy_say "Ativar IA no hub ($hub_ip)"

# 1) Patch run.rs → rebuild só eav7-core no hub (fonte já pode estar em testnet-src;
#    rsync o core/run.rs + rebuild rápido a partir do source testnet se existir,
#    senão usa wrapper no EAV7_NODE_BIN).
eav7_deploy_say "Garantir eav7-core + eav7-node (ORACLE_WALLET + retry de registo)"
eav7_deploy_rsync "$ROOT/rust/core/src/run.rs" \
  "${EAV7_SSH_USER}@${hub_ip}:/tmp/eav7-core-run.rs"
eav7_deploy_rsync "$ROOT/rust/node/src/ai/worker.rs" \
  "${EAV7_SSH_USER}@${hub_ip}:/tmp/eav7-ai-worker.rs"

eav7_deploy_ssh "$hub_ip" "
  set -euo pipefail
  SRC=''
  for cand in /opt/eav7-testnet-src /opt/eav7-src; do
    if [[ -f \"\$cand/core/src/run.rs\" ]]; then SRC=\"\$cand\"; break; fi
  done
  if [[ -z \"\$SRC\" ]]; then
    echo '  sem source Rust no hub — instalando wrapper EAV7_NODE_BIN'
    sudo tee /usr/local/bin/eav7-node-ai-wrap >/dev/null <<'WRAP'
#!/usr/bin/env bash
set -euo pipefail
EXTRA=()
if [[ -n \"\${EAV7_ORACLE_WALLET:-}\" && -f \"\$EAV7_ORACLE_WALLET\" ]]; then
  EXTRA+=(--oracle-wallet \"\$EAV7_ORACLE_WALLET\")
fi
if [[ \"\${EAV7_SENTINEL:-}\" == \"1\" ]]; then
  EXTRA+=(--sentinel)
fi
exec /usr/local/bin/eav7-node \"\${EXTRA[@]}\" \"\$@\"
WRAP
    sudo chmod 755 /usr/local/bin/eav7-node-ai-wrap
    NODE_BIN=/usr/local/bin/eav7-node-ai-wrap
  else
    cp /tmp/eav7-core-run.rs \"\$SRC/core/src/run.rs\"
    cp /tmp/eav7-ai-worker.rs \"\$SRC/node/src/ai/worker.rs\"
    export PATH=\"\$HOME/.cargo/bin:\$PATH\"
    # shellcheck disable=SC1091
    [[ -f \$HOME/.cargo/env ]] && source \"\$HOME/.cargo/env\"
    (cd \"\$SRC\" && cargo build --release -p eav7-core -p eav7-node)
    sudo install -m 755 \"\$SRC/target/release/eav7-core\" /usr/local/bin/eav7-core
    sudo install -m 755 \"\$SRC/target/release/eav7-node\" /usr/local/bin/eav7-node
    NODE_BIN=/usr/local/bin/eav7-node
    echo '  eav7-core + eav7-node rebuild OK'
  fi
  echo \"NODE_BIN=\$NODE_BIN\" > /tmp/eav7-ai-node-bin.env
"

eav7_deploy_say "Carteira do oráculo + fundo"
eav7_deploy_ssh "$hub_ip" "
  set -euo pipefail
  # shellcheck disable=SC1091
  source /tmp/eav7-ai-node-bin.env
  sudo mkdir -p '$DATA'
  if [[ ! -f '$ORACLE_WALLET' ]]; then
    tmp=\$(mktemp -d)
    cd \"\$tmp\"
    $CLI wallet new --out oracle-wallet.json >/tmp/eav7-oracle-new.txt
    sudo install -m 600 -o eav7 -g eav7 oracle-wallet.json '$ORACLE_WALLET'
    rm -rf \"\$tmp\"
    echo '  oracle wallet criada'
  else
    echo '  oracle wallet já existe'
  fi
  ADDR=\$($CLI wallet show '$ORACLE_WALLET' | awk -F: '/endereço/{gsub(/ /,\"\",\$2); print \$2; exit}')
  [[ -n \"\$ADDR\" ]] || { echo '  falha: endereço do oráculo vazio' >&2; exit 1; }
  echo \"  oracle=\$ADDR\"
  BAL=\$(curl -fsS '$NODE_URL/address/'\$ADDR | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get(\"balance\",\"0\"))')
  echo \"  balance=\$BAL need_e7~=$AMOUNT\"
  # Financia se saldo < 510 EAV7 (stake 500 + margem). set +e: exit 1 = precisa fundo.
  set +e
  python3 - <<PY
bal=int(\"\$BAL\")
need=510_000_000
raise SystemExit(0 if bal >= need else 1)
PY
  funded=\$?
  set -e
  if [[ \$funded -ne 0 ]]; then
    echo \"  transferindo $AMOUNT EAV7 do validador → oráculo\"
    sudo -u eav7 $CLI send --node '$NODE_URL' --wallet '$VALIDATOR_WALLET' --to \"\$ADDR\" --amount '$AMOUNT'
    sleep 2
  else
    echo '  saldo suficiente — skip fund'
  fi
  echo \"ORACLE_ADDR=\$ADDR\" > /tmp/eav7-ai-oracle.env
  echo \"NODE_BIN=\$NODE_BIN\" >> /tmp/eav7-ai-oracle.env
"

eav7_deploy_say "Systemd: ligar oráculo (+ sentinela)"
eav7_deploy_ssh "$hub_ip" "
  set -euo pipefail
  # shellcheck disable=SC1091
  source /tmp/eav7-ai-oracle.env
  UNIT=/etc/systemd/system/eav7-core.service
  sudo cp -a \"\$UNIT\" \"\$UNIT.bak.ai.\$(date +%s)\"
  # Remove Environment antigas de IA e reinsere.
  sudo python3 - <<PY
from pathlib import Path
p = Path('/etc/systemd/system/eav7-core.service')
lines = p.read_text().splitlines()
out = []
skip_keys = {'EAV7_ORACLE_WALLET', 'EAV7_SENTINEL', 'EAV7_NODE_BIN'}
i = 0
while i < len(lines):
    line = lines[i]
    if line.startswith('Environment='):
        key = line.split('=', 1)[1].split('=', 1)[0]
        if key in skip_keys:
            i += 1
            continue
    out.append(line)
    i += 1
# Insert after existing Environment=EAV7_GENESIS_ACTIVE=1 if present, else before ExecStart
insert = [
    f'Environment=EAV7_NODE_BIN={Path(\"\$NODE_BIN\").as_posix()}',
    'Environment=EAV7_ORACLE_WALLET=/var/lib/eav7/oracle-wallet.json',
]
if '$SENTINEL' == '1':
    insert.append('Environment=EAV7_SENTINEL=1')
text = '\n'.join(out)
marker = 'ExecStart='
block = '\n'.join(insert) + '\n'
if marker in text:
    text = text.replace(marker, block + marker, 1)
else:
    text = text.rstrip() + '\n' + block
Path('/tmp/eav7-core-ai.service').write_text(text + '\n')
print('unit drafted')
PY
  sudo mv /tmp/eav7-core-ai.service \"\$UNIT\"
  sudo systemctl daemon-reload
  sudo systemctl restart eav7-core
  # Restart pode forçar replay completo — aguarda até ~10 min.
  ready=0
  for i in \$(seq 1 120); do
    if curl -fsS --max-time 2 '$NODE_URL/status' >/dev/null 2>&1; then
      ready=1
      echo \"  RPC ok após \${i} tentativa(s)\"
      break
    fi
    if (( i % 12 == 0 )); then
      echo \"  aguardando RPC… try=\$i\"
    fi
    sleep 5
  done
  [[ \$ready -eq 1 ]] || { echo '  falha: RPC 6070 não subiu após restart' >&2; exit 1; }
  echo -n '  status ai -> '
  curl -fsS '$NODE_URL/status' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get(\"ai\"))'
  echo -n '  process args -> '
  ps -o args= -C eav7-node 2>/dev/null | head -1 || ps aux | grep '[e]av7-node' | head -1
"

eav7_deploy_say "Aguardar registro do oráculo (worker auto-register)"
eav7_deploy_ssh "$hub_ip" "
  set -euo pipefail
  # shellcheck disable=SC1091
  source /tmp/eav7-ai-oracle.env
  for i in \$(seq 1 30); do
    n=\$(curl -fsS '$NODE_URL/ai/oracles' | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))')
    echo \"  try \$i oracles=\$n\"
    [[ \"\$n\" != \"0\" ]] && break
    sleep 2
  done
  curl -fsS '$NODE_URL/ai/oracles' | python3 -m json.tool | head -40
"

eav7_deploy_say "IA ATIVA"
echo "  Explorer  https://eavscan.com/ai"
echo "  Oracles   https://eavscan.com/api/ai/oracles"
echo "  Nota: TEE (AI_TEE_HEIGHT) continua distante — só o worker/sentinela foram ligados."
echo "  Claude LLM: defina ANTHROPIC_API_KEY no unit se quiser inferência real (senão eco local)."
