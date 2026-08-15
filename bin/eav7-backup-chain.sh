#!/usr/bin/env bash
# Backup da cadeia de UM nó EAV7. Corre NA VM (systemd timer horário).
#
# Porque existe: em 2026-08-12 um bug de boot truncou o blocks.jsonl em 7 nós ao
# mesmo tempo. A cadeia só existia dentro das VMs, portanto não havia de onde
# restaurar. Este script é a rede de segurança de nível 1 (local, na própria VM);
# o pull para fora do ESXi é o nível 2 e está documentado em
# docs/ops/CHAIN-DURABILITY.md.
#
# Uso:  eav7-backup-chain.sh [--dir /var/lib/eav7] [--dst /var/backups/eav7] [--keep 7]
set -euo pipefail

DIR=/var/lib/eav7
DST=/var/backups/eav7
KEEP=7

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)  DIR="${2:?}"; shift 2 ;;
    --dst)  DST="${2:?}"; shift 2 ;;
    --keep) KEEP="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "arg desconhecido: $1" >&2; exit 2 ;;
  esac
done

[[ -f "$DIR/blocks.jsonl" ]] || { echo "sem $DIR/blocks.jsonl — nada a fazer" >&2; exit 1; }

HOST="$(hostname)"
HOJE="$(date -u +%Y%m%d)"
AGORA="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LATEST="$DST/$HOST/latest"
DIARIO="$DST/$HOST/$HOJE"

mkdir -p "$LATEST"

# --- 1. cópia corrente (horária) -------------------------------------------
# NÃO inclui validator-wallet.json: é material de chave e já está guardado fora
# da VM (secrets/foundation-ancoras/). Espalhar chaves por diretórios de backup
# aumenta a superfície sem acrescentar recuperação — o restore usa a wallet do
# cofre, não a do backup.
rsync -a "$DIR/blocks.jsonl" "$LATEST/" 2>/dev/null || cp -f "$DIR/blocks.jsonl" "$LATEST/"
for f in estado.snap genesis.json core.json blocks.idx hashes.bin; do
  [[ -f "$DIR/$f" ]] && { rsync -a "$DIR/$f" "$LATEST/" 2>/dev/null || cp -f "$DIR/$f" "$LATEST/"; }
done

# --- 2. metadados de verificação -------------------------------------------
# Sem isto o backup é um ficheiro opaco: no restore não há como saber a que
# altura corresponde nem se está íntegro.
LINHAS="$(wc -l < "$LATEST/blocks.jsonl" | tr -d ' ')"
TIP="$(tail -1 "$LATEST/blocks.jsonl" | python3 -c 'import sys,json;b=json.load(sys.stdin);print(b["height"], b["hash"])' 2>/dev/null || echo "? ?")"
SUM="$(sha256sum "$LATEST/blocks.jsonl" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$LATEST/blocks.jsonl" | awk '{print $1}')"
API="$(curl -s -H 'accept: application/json' --max-time 5 http://127.0.0.1:6070/status 2>/dev/null \
        | python3 -c 'import sys,json;s=json.load(sys.stdin);print(s["height"], s["headHash"])' 2>/dev/null || echo "? ?")"

cat > "$LATEST/BACKUP.txt" <<EOF
host        : $HOST
gravado_em  : $AGORA
linhas      : $LINHAS
tip_ficheiro: $TIP
tip_api     : $API
sha256      : $SUM
EOF

# --- 3. snapshot datado (1x/dia) + retenção --------------------------------
if [[ ! -d "$DIARIO" ]]; then
  cp -a "$LATEST" "$DIARIO"
fi
# Apaga diários mais antigos que KEEP dias. `latest` nunca entra nesta conta.
find "$DST/$HOST" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP" -exec rm -rf {} + 2>/dev/null || true

echo "[backup] $HOST altura=$LINHAS tip=$TIP -> $LATEST (diário: $DIARIO)"
