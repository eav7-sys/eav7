#!/usr/bin/env bash
# Envia o backup DIÁRIO da cadeia para armazenamento fora do ESXi (OneDrive/M365
# via rclone). Corre só no HUB — os outros nós mantêm o backup local horário.
#
# Porquê só o hub: os 7 nós convergem na mesma cadeia, portanto uma cópia boa
# fora do host chega para recuperar a rede. Os backups locais dos outros cobrem
# a recuperação nó-a-nó. Isto mantém o token da nuvem em UMA máquina em vez de
# sete — o backup local de cada nó continua a ser a primeira linha de defesa.
#
# Envia o diário (não o horário) e comprimido: a cadeia cresce ~4,4 KB/bloco a
# 1 bloco/s ≈ 384 MB/dia em bruto; o JSON comprime ~8x.
#
# NÃO envia wallets. O backup de origem já as exclui de propósito — material de
# chave não vai para armazenamento de terceiros.
#
# Uso: eav7-backup-cloud.sh [--src /var/backups/eav7] [--remote eav7onedrive] \
#                           [--path EAV7-backups] [--keep-days 30]
set -euo pipefail

SRC=/var/backups/eav7
REMOTE=eav7onedrive
RPATH=EAV7-backups
KEEP_DAYS=30

while [[ $# -gt 0 ]]; do
  case "$1" in
    --src)        SRC="${2:?}"; shift 2 ;;
    --remote)     REMOTE="${2:?}"; shift 2 ;;
    --path)       RPATH="${2:?}"; shift 2 ;;
    --keep-days)  KEEP_DAYS="${2:?}"; shift 2 ;;
    -h|--help)    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "arg desconhecido: $1" >&2; exit 2 ;;
  esac
done

command -v rclone >/dev/null || { echo "rclone não instalado" >&2; exit 1; }

# Falha cedo e claro se o remote não estiver configurado — senão o timer falha
# todos os dias em silêncio, que é o pior modo de falha para um backup.
if ! rclone listremotes 2>/dev/null | grep -q "^${REMOTE}:"; then
  echo "remote '${REMOTE}:' não configurado no rclone — correr a autorização primeiro" >&2
  exit 1
fi

HOST="$(hostname)"
HOJE="$(date -u +%Y%m%d)"

# Empacota o `latest`, NÃO o diretório diário. O diário é um ponto-no-tempo criado
# na primeira corrida do dia e nunca mais avança — enviá-lo punha na nuvem uma
# cópia até 24 h atrasada. Aqui queremos o estado mais fresco no momento do envio.
# (Encontrado num teste de restauro: o tar trazia altura 2733 com o nó em 3249.)
ORIGEM="$SRC/$HOST/latest"

[[ -d "$ORIGEM" ]] || { echo "sem backup em $ORIGEM — correr eav7-backup-chain.sh antes" >&2; exit 1; }

# Atualiza o `latest` mesmo antes de empacotar, para o envio refletir a tip atual.
if command -v eav7-backup-chain.sh >/dev/null 2>&1; then
  eav7-backup-chain.sh --dst "$SRC" >/dev/null 2>&1 || true
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

TAR="$TMP/${HOST}-${HOJE}.tar.gz"
tar -czf "$TAR" -C "$ORIGEM" .
TAM="$(du -h "$TAR" | cut -f1)"
ALTURA="$(grep -m1 '^linhas' "$ORIGEM/BACKUP.txt" 2>/dev/null | awk '{print $3}')"

# `copyto` e não `sync`: o sync apagaria no destino o que não existe na origem,
# e a origem é um diretório temporário. Um backup nunca deve poder apagar
# histórico no destino.
rclone copyto "$TAR" "${REMOTE}:${RPATH}/${HOST}/${HOST}-${HOJE}.tar.gz" \
  --retries 3 --low-level-retries 10 --timeout 5m

# Retenção no destino: apaga só o que passou de KEEP_DAYS, nunca o resto.
rclone delete "${REMOTE}:${RPATH}/${HOST}" --min-age "${KEEP_DAYS}d" 2>/dev/null || true

echo "[cloud] $HOST $HOJE ($TAM, ${ALTURA:-?} linhas) -> ${REMOTE}:${RPATH}/${HOST}/  | retenção ${KEEP_DAYS}d"
