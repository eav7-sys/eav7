#!/usr/bin/env bash
# Deploy escalonado dos fixes de segurança da auditoria 2026-07-14 para os 3 validadores.
#
# Grupos: hardening (L1,L2,L3,L6,C2,M2) ativa na hora; C1+M1 são consenso e ficam
# DORMENTES até a altura de fork 1.000.000 (config.js). Todos os nós precisam do
# código antes de a cadeia cruzar 1.000.000 — este deploy garante isso.
#
# Segurança: (1) prova replay-compat da cadeia viva ANTES de tocar em produção;
# (2) deploy UM nó por vez; (3) confere convergência (mesma altura/headHash nos 3)
# antes de seguir. Aborta em qualquer divergência. NUNCA toca em data/ nem segredos.
#
# Uso:  bash deploy-security-fixes.sh
set -euo pipefail

KEY="$HOME/.ssh/eav7_deploy"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
RSYNC_SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"
REPO="$(cd "$(dirname "$0")" && pwd)"

NODE1=13.39.82.95
NODE2=13.38.228.186
NODE3=13.38.121.150
NODES=($NODE1 $NODE2 $NODE3)

say(){ printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
die(){ printf '\n\033[1;31mABORTADO: %s\033[0m\n' "$*" >&2; exit 1; }

# Altura/headHash de um nó, via API local do próprio nó (fonte de verdade).
head_of(){ $SSH ubuntu@"$1" "curl -s --max-time 8 http://127.0.0.1:6070/status -H 'accept: application/json'" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.height+" "+j.headHash+" "+j.minted)})'; }

# ---------------------------------------------------------------------------
say "0) Pré-voo: conectividade + estado dos 3 nós"
for n in "${NODES[@]}"; do
  info=$($SSH ubuntu@"$n" 'echo -n "$(node -v) | eav7="$(systemctl is-active eav7)"' 2>&1) || die "sem SSH em $n"
  h=$(head_of "$n") || die "sem /status em $n"
  echo "  $n -> $info | altura/headHash/minted: $h"
done

# ---------------------------------------------------------------------------
say "1) Prova replay-compat: boota a cadeia VIVA com o código NOVO e confere altura+minted"
# Copia SÓ os arquivos de estado (nunca escreve em prod) de node1 para um dir temporário
# local e carrega com o código deste working tree. Como as alturas de fork (1.000.000)
# estão acima do head (~677k), todo o replay usa o caminho grandfather = idêntico ao antigo.
LIVE=$(head_of "$NODE1"); LIVE_H=$(echo "$LIVE" | cut -d' ' -f1); LIVE_M=$(echo "$LIVE" | cut -d' ' -f3)
TMP=$(mktemp -d)
echo "  baixando estado de $NODE1 para $TMP (read-only)…"
rsync -az -e "$RSYNC_SSH" \
  ubuntu@"$NODE1":/opt/eav7/data/blocks.jsonl \
  ubuntu@"$NODE1":/opt/eav7/data/snapshot.json \
  "$TMP/" 2>/dev/null || true
# snapshot.json.mac só existe se EAV7_SNAPSHOT_KEY estiver setada em prod (não está) — ok se faltar.
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

# ---------------------------------------------------------------------------
deploy_one(){
  local n="$1"
  say "2) Deploy em $n (rsync src/ bin/ public/ → restart → aguarda replay)"
  rsync -az --delete --exclude='.DS_Store' -e "$RSYNC_SSH" \
    "$REPO/src/" ubuntu@"$n":/opt/eav7/src/
  rsync -az --delete --exclude='.DS_Store' -e "$RSYNC_SSH" \
    "$REPO/bin/" ubuntu@"$n":/opt/eav7/bin/
  rsync -az --delete --exclude='.DS_Store' -e "$RSYNC_SSH" \
    "$REPO/public/" ubuntu@"$n":/opt/eav7/public/
  $SSH ubuntu@"$n" 'sudo systemctl restart eav7'
  echo "  aguardando o serviço voltar e a cabeça avançar…"
  for i in $(seq 1 60); do
    sleep 5
    st=$($SSH ubuntu@"$n" 'systemctl is-active eav7' 2>/dev/null || true)
    [ "$st" = active ] || { echo "  ($i) serviço: $st"; continue; }
    h=$(head_of "$n" 2>/dev/null || true); [ -n "$h" ] && { echo "  ($i) ativo, altura/headHash: $h"; break; }
  done
  [ "$($SSH ubuntu@"$n" 'systemctl is-active eav7')" = active ] || die "$n não voltou a ficar ativo"
}

converge_check(){
  say "3) Convergência: os 3 nós no MESMO headHash numa altura comum"
  # amostra alturas; usa a MENOR altura comum e compara o hash daquele bloco nos 3
  declare -a H HASH
  for i in 0 1 2; do read -r H[$i] HASH[$i] _ <<<"$(head_of "${NODES[$i]}")"; echo "  ${NODES[$i]} @ ${H[$i]} ${HASH[$i]}"; done
  local common=${H[0]}; for i in 1 2; do [ "${H[$i]}" -lt "$common" ] && common=${H[$i]}; done
  echo "  comparando o bloco na altura comum $common…"
  local ref=""; for i in 0 1 2; do
    bh=$($SSH ubuntu@"${NODES[$i]}" "curl -s --max-time 8 http://127.0.0.1:6070/chain?from=$common\&limit=1 -H 'accept: application/json'" \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);console.log((a.blocks?.[0]?.hash)||(a[0]?.hash)||"?")}catch(e){console.log("?")}})')
    echo "    ${NODES[$i]} hash@$common = $bh"
    [ -z "$ref" ] && ref="$bh"
    [ "$bh" = "$ref" ] || die "DIVERGÊNCIA na altura $common (${NODES[$i]} tem $bh, esperado $ref)"
  done
  echo "  ✔ os 3 nós convergem no mesmo hash @ $common"
}

deploy_one "$NODE1"; converge_check
deploy_one "$NODE2"; converge_check
deploy_one "$NODE3"; converge_check

say "CONCLUÍDO"
echo "Hardening ATIVO nos 3 nós. C1+M1 dormentes até a altura 1.000.000 (~3,7 dias)."
echo "Confirme que os 3 têm o mesmo config: CANONICAL_HASH_HEIGHT e BRIDGE_QUORUM_HEIGHT = 1000000."
