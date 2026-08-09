#!/usr/bin/env bash
# Deploy escalonado dos fixes de segurança (auditoria). IPs em deploy/nodes.env.
#
# Grupos: hardening ativa na hora; forks de consenso ficam dormentes até a altura
# em config.js. Deploy UM nó por vez; confere convergência. Nunca toca data/ nem segredos.
#
# Uso:  bash deploy-security-fixes.sh
set -euo pipefail

# shellcheck source=bin/eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/bin/eav7-deploy-lib.sh"
eav7_deploy_load

REPO="$(pwd)"
SSH="ssh $EAV7_SSH_OPTS"
RSYNC_SSH="ssh $EAV7_SSH_OPTS"

IPS=()
i=0
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  IPS+=("${EAV7_NODE_PAIRS[i+1]}")
  i=$((i + 2))
done
(( ${#IPS[@]} >= 1 )) || { echo "EAV7_NODES vazio" >&2; exit 2; }

say(){ eav7_deploy_say "$*"; }
die(){ printf '\n\033[1;31mABORTADO: %s\033[0m\n' "$*" >&2; exit 1; }

head_of(){ $SSH "${EAV7_SSH_USER}@$1" "curl -s --max-time 8 http://127.0.0.1:6070/status -H 'accept: application/json'" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.height+" "+j.headHash+" "+j.minted)})'; }

say "0) Pré-voo: conectividade + estado"
for n in "${IPS[@]}"; do
  info=$($SSH "${EAV7_SSH_USER}@$n" 'echo -n "$(node -v) | eav7="$(systemctl is-active eav7)"' 2>&1) || die "sem SSH em $n"
  h=$(head_of "$n") || die "sem /status em $n"
  echo "  $n -> $info | altura/headHash/minted: $h"
done

NODE1="${IPS[0]}"
say "1) Prova replay-compat: boota a cadeia VIVA com o código NOVO"
LIVE=$(head_of "$NODE1"); LIVE_H=$(echo "$LIVE" | cut -d' ' -f1); LIVE_M=$(echo "$LIVE" | cut -d' ' -f3)
TMP=$(mktemp -d)
echo "  baixando estado de $NODE1 para $TMP (read-only)…"
rsync -az -e "$RSYNC_SSH" \
  "${EAV7_SSH_USER}@${NODE1}:${EAV7_REMOTE_NODE_DIR}/data/blocks.jsonl" \
  "${EAV7_SSH_USER}@${NODE1}:${EAV7_REMOTE_NODE_DIR}/data/snapshot.json" \
  "$TMP/" 2>/dev/null || true
node --input-type=module -e '
  import { Blockchain } from "'"$REPO"'/src/core/blockchain.js";
  const bc = new Blockchain({ dataDir: "'"$TMP"'" });
  const h = bc.height, m = bc.state.totalMinted?.toString?.() ?? "n/a";
  console.log("  código novo -> altura="+h+" minted="+m);
  const liveH = '"$LIVE_H"', liveM = "'"$LIVE_M"'";
  if (h < liveH - 5) { console.error("  ALTURA divergente (novo "+h+" vs vivo "+liveH+")"); process.exit(3); }
  if (m !== "n/a" && liveM && m !== liveM) { console.error("  MINTED divergente (novo "+m+" vs vivo "+liveM+")"); process.exit(3); }
  console.log("  ✔ replay-compat OK (altura e minted batem com a cadeia viva)");
' || { rm -rf "$TMP"; die "replay-compat FALHOU — NÃO deployar"; }
rm -rf "$TMP"

deploy_one(){
  local n="$1"
  say "2) Deploy em $n (rsync src/ bin/ public/ → restart → aguarda replay)"
  rsync -az --delete --exclude='.DS_Store' -e "$RSYNC_SSH" \
    "$REPO/src/" "${EAV7_SSH_USER}@${n}:${EAV7_REMOTE_NODE_DIR}/src/"
  rsync -az --delete --exclude='.DS_Store' -e "$RSYNC_SSH" \
    "$REPO/bin/" "${EAV7_SSH_USER}@${n}:${EAV7_REMOTE_NODE_DIR}/bin/"
  rsync -az --delete --exclude='.DS_Store' -e "$RSYNC_SSH" \
    "$REPO/public/" "${EAV7_SSH_USER}@${n}:${EAV7_REMOTE_NODE_DIR}/public/"
  $SSH "${EAV7_SSH_USER}@$n" 'sudo systemctl restart eav7'
  echo "  aguardando o serviço voltar e a cabeça avançar…"
  for i in $(seq 1 60); do
    sleep 5
    st=$($SSH "${EAV7_SSH_USER}@$n" 'systemctl is-active eav7' 2>/dev/null || true)
    [ "$st" = active ] || { echo "  ($i) serviço: $st"; continue; }
    h=$(head_of "$n" 2>/dev/null || true); [ -n "$h" ] && { echo "  ($i) ativo, altura/headHash: $h"; break; }
  done
  [ "$($SSH "${EAV7_SSH_USER}@$n" 'systemctl is-active eav7')" = active ] || die "$n não voltou a ficar ativo"
}

converge_check(){
  say "3) Convergência: nós no MESMO headHash numa altura comum"
  declare -a H HASH
  local idx=0
  for n in "${IPS[@]}"; do
    read -r H[$idx] HASH[$idx] _ <<<"$(head_of "$n")"
    echo "  $n @ ${H[$idx]} ${HASH[$idx]}"
    idx=$((idx + 1))
  done
  local common=${H[0]}
  for ((i=1; i<${#IPS[@]}; i++)); do
    [ "${H[$i]}" -lt "$common" ] && common=${H[$i]}
  done
  echo "  comparando o bloco na altura comum $common…"
  local ref=""
  for n in "${IPS[@]}"; do
    bh=$($SSH "${EAV7_SSH_USER}@$n" "curl -s --max-time 8 http://127.0.0.1:6070/chain?from=$common\&limit=1 -H 'accept: application/json'" \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);console.log((a.blocks?.[0]?.hash)||(a[0]?.hash)||"?")}catch(e){console.log("?")}})')
    echo "    $n hash@$common = $bh"
    [ -z "$ref" ] && ref="$bh"
    [ "$bh" = "$ref" ] || die "DIVERGÊNCIA na altura $common ($n tem $bh, esperado $ref)"
  done
  echo "  ✔ nós convergem no mesmo hash @ $common"
}

for n in "${IPS[@]}"; do
  deploy_one "$n"
  converge_check
done

say "CONCLUÍDO"
echo "Hardening ATIVO. Confirme config de fork nos nós."
