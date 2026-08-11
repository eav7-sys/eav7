#!/usr/bin/env bash
# Backup cifrado da EAV7: carteira do validador + cadeia (blocks.jsonl).
# Grava local (rotaciona 7) e, se EAV7_BACKUP_S3 estiver configurado no eav7.env,
# envia a cópia cifrada para o S3 (off-site / recuperação de desastre).
set -euo pipefail
ENVF=/opt/eav7/eav7.env
[ -f "$ENVF" ] && { set -a; . "$ENVF"; set +a; }
D=/opt/eav7/data/node-6070
OUT=/opt/eav7/backups
PASS=/opt/eav7/backup.pass
mkdir -p "$OUT"
TS=$(date +%Y%m%d-%H%M)
TMP=$(mktemp -d)
cp "$D/validator-wallet.json" "$TMP/"
[ -f "$D/blocks.jsonl" ] && cp "$D/blocks.jsonl" "$TMP/" || true
tar czf "$TMP/b.tar.gz" -C "$TMP" $(cd "$TMP" && ls validator-wallet.json blocks.jsonl 2>/dev/null)
FILE="$OUT/eav7-$TS.tar.gz.enc"
openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:"$PASS" -in "$TMP/b.tar.gz" -out "$FILE"
rm -rf "$TMP"

# off-site: envia para o S3 se configurado (EAV7_BACKUP_S3=s3://bucket/prefixo)
if [ -n "${EAV7_BACKUP_S3:-}" ]; then
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$FILE" "${EAV7_BACKUP_S3%/}/eav7-$TS.tar.gz.enc" >/dev/null 2>&1 \
      && echo "off-site: enviado para ${EAV7_BACKUP_S3}" \
      || echo "off-site: FALHA no envio ao S3 (verifique credenciais/bucket)"
  else
    echo "off-site: aws CLI ausente — instale para habilitar o envio ao S3"
  fi
fi

# rotação: mantém os 7 backups locais mais recentes
ls -1t "$OUT"/eav7-*.tar.gz.enc 2>/dev/null | tail -n +8 | xargs -r rm -f
