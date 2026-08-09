#!/usr/bin/env bash
# Deploy do código do nó (src/ + bin/ + package.json) — NÃO toca data/ nem wallets.
# Replay-compat local contra a cadeia viva, um nó por vez, checagem de convergência.
#
# Uso: bash bin/eav7-deploy-nodes.sh
#      bash bin/eav7-deploy-nodes.sh --skip-replay   # só rsync+restart (emergência)
set -euo pipefail

# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

REPO="$(pwd)"
SKIP_REPLAY=0
for arg in "$@"; do
  case "$arg" in
    --skip-replay) SKIP_REPLAY=1 ;;
    -h|--help)
      echo "Uso: bash bin/eav7-deploy-nodes.sh [--skip-replay]"
      exit 0
      ;;
  esac
done

IPS=()
NAMES=()
i=0
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  NAMES+=("${EAV7_NODE_PAIRS[i]}")
  IPS+=("${EAV7_NODE_PAIRS[i+1]}")
  i=$((i + 2))
done
(( ${#IPS[@]} >= 1 )) || { echo "EAV7_NODES vazio" >&2; exit 2; }

die(){ printf '\n\033[1;31mABORTADO: %s\033[0m\n' "$*" >&2; exit 1; }

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

head_of(){
  eav7_deploy_ssh "$1" "curl -s --max-time 8 http://127.0.0.1:6070/status -H 'accept: application/json'" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.height+" "+j.headHash+" "+(j.minted??""))})'
}

eav7_deploy_say "0) Pré-voo: SSH + /status"
for idx in "${!IPS[@]}"; do
  n="${IPS[$idx]}"
  name="${NAMES[$idx]}"
  info="$(eav7_deploy_ssh "$n" 'echo -n "$(node -v) | eav7=$(systemctl is-active eav7)"' 2>&1)" \
    || die "sem SSH em $name ($n)"
  h="$(head_of "$n")" || die "sem /status em $name ($n)"
  echo "  $name ($n) -> $info | altura/head/minted: $h"
done

NODE1="${IPS[0]}"
if [[ "$SKIP_REPLAY" -eq 0 ]]; then
  eav7_deploy_say "1) Replay-compat: código local × cadeia viva ($NODE1)"
  LIVE="$(head_of "$NODE1")"
  LIVE_H="$(echo "$LIVE" | cut -d' ' -f1)"
  LIVE_M="$(echo "$LIVE" | cut -d' ' -f3)"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "  baixando blocks.jsonl/snapshot (read-only)…"
  eav7_deploy_rsync \
    "${EAV7_SSH_USER}@${NODE1}:${EAV7_REMOTE_NODE_DIR}/data/blocks.jsonl" \
    "${EAV7_SSH_USER}@${NODE1}:${EAV7_REMOTE_NODE_DIR}/data/snapshot.json" \
    "$TMP/" 2>/dev/null || true
  [[ -f "$TMP/blocks.jsonl" ]] || die "não foi possível baixar blocks.jsonl de $NODE1"
  node --input-type=module -e '
    import { Blockchain } from "'"$REPO"'/src/core/blockchain.js";
    const bc = new Blockchain({ dataDir: "'"$TMP"'" });
    const h = bc.height;
    const m = bc.state.totalMinted?.toString?.() ?? "n/a";
    console.log("  código novo -> altura="+h+" minted="+m);
    const liveH = '"$LIVE_H"', liveM = "'"$LIVE_M"'";
    if (h < liveH - 5) {
      console.error("  ALTURA divergente (novo "+h+" vs vivo "+liveH+")");
      process.exit(3);
    }
    if (m !== "n/a" && liveM && m !== liveM) {
      console.error("  MINTED divergente (novo "+m+" vs vivo "+liveM+")");
      process.exit(3);
    }
    console.log("  ✔ replay-compat OK");
  ' || die "replay-compat FALHOU — NÃO deployar"
  rm -rf "$TMP"
  trap - EXIT
fi

# Marcadores de código (G7/G8 + API) — prova pós-rsync
BC_SUM="$(sha256_file src/core/blockchain.js)"
BS_SUM="$(sha256_file src/core/blockstore.js)"
API_SUM="$(sha256_file src/node/api.js)"
mkdir -p deploy/checksums
{
  printf '%s  %s\n' "$BC_SUM" "src/core/blockchain.js"
  printf '%s  %s\n' "$BS_SUM" "src/core/blockstore.js"
  printf '%s  %s\n' "$API_SUM" "src/node/api.js"
} > deploy/checksums/node-core.sha256
echo "  blockchain.js = $BC_SUM"
echo "  blockstore.js = $BS_SUM"
echo "  api.js        = $API_SUM"

deploy_one(){
  local name="$1" n="$2"
  eav7_deploy_say "2) Nó $name ($n): rsync src/ bin/ package.json → restart"
  eav7_deploy_rsync --delete --exclude='.DS_Store' \
    "$REPO/src/" "${EAV7_SSH_USER}@${n}:${EAV7_REMOTE_NODE_DIR}/src/"
  eav7_deploy_rsync --delete --exclude='.DS_Store' \
    "$REPO/bin/" "${EAV7_SSH_USER}@${n}:${EAV7_REMOTE_NODE_DIR}/bin/"
  eav7_deploy_rsync "$REPO/package.json" \
    "${EAV7_SSH_USER}@${n}:${EAV7_REMOTE_NODE_DIR}/package.json"
  eav7_deploy_rsync deploy/checksums/node-core.sha256 \
    "${EAV7_SSH_USER}@${n}:${EAV7_REMOTE_NODE_DIR}/deploy/checksums/node-core.sha256"

  remote_bc="$(eav7_deploy_ssh "$n" "sha256sum ${EAV7_REMOTE_NODE_DIR}/src/core/blockchain.js | awk '{print \$1}'")"
  remote_bs="$(eav7_deploy_ssh "$n" "sha256sum ${EAV7_REMOTE_NODE_DIR}/src/core/blockstore.js | awk '{print \$1}'")"
  remote_api="$(eav7_deploy_ssh "$n" "sha256sum ${EAV7_REMOTE_NODE_DIR}/src/node/api.js | awk '{print \$1}'")"
  [[ "$remote_bc" == "$BC_SUM" ]] || die "checksum blockchain.js divergiu em $n"
  [[ "$remote_bs" == "$BS_SUM" ]] || die "checksum blockstore.js divergiu em $n"
  [[ "$remote_api" == "$API_SUM" ]] || die "checksum api.js divergiu em $n"

  eav7_deploy_ssh "$n" 'sudo systemctl restart eav7'
  echo "  aguardando serviço + /status…"
  for attempt in $(seq 1 60); do
    sleep 5
    st="$(eav7_deploy_ssh "$n" 'systemctl is-active eav7' 2>/dev/null || true)"
    [[ "$st" == active ]] || { echo "  ($attempt) serviço: $st"; continue; }
    h="$(head_of "$n" 2>/dev/null || true)"
    [[ -n "$h" ]] && { echo "  ($attempt) ativo: $h"; break; }
  done
  [[ "$(eav7_deploy_ssh "$n" 'systemctl is-active eav7')" == active ]] \
    || die "$name ($n) não voltou ativo"
}

converge_check(){
  eav7_deploy_say "3) Convergência (mesmo hash @ altura comum)"
  declare -a H HASH
  local idx=0
  for n in "${IPS[@]}"; do
    read -r "H[$idx]" "HASH[$idx]" _ <<<"$(head_of "$n")"
    echo "  $n @ ${H[$idx]} ${HASH[$idx]}"
    idx=$((idx + 1))
  done
  local common=${H[0]}
  for ((j=1; j<${#IPS[@]}; j++)); do
    (( H[j] < common )) && common=${H[j]}
  done
  echo "  altura comum: $common"
  local ref=""
  for n in "${IPS[@]}"; do
    bh="$(eav7_deploy_ssh "$n" "curl -s --max-time 8 'http://127.0.0.1:6070/chain?from=${common}&limit=1' -H 'accept: application/json'" \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);console.log((a.blocks?.[0]?.hash)||(a[0]?.hash)||"?")}catch(e){console.log("?")}})')"
    echo "    $n hash@$common = $bh"
    [[ -z "$ref" ]] && ref="$bh"
    [[ "$bh" == "$ref" ]] || die "DIVERGÊNCIA @ $common ($n tem $bh, esperado $ref)"
  done
  echo "  ✔ convergência OK"
}

for idx in "${!IPS[@]}"; do
  deploy_one "${NAMES[$idx]}" "${IPS[$idx]}"
  converge_check
done

eav7_deploy_say "NÓS ATUALIZADOS"
echo "Código em ${EAV7_REMOTE_NODE_DIR}/{src,bin} nos ${#IPS[@]} hosts."
