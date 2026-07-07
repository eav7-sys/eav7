#!/usr/bin/env bash
# Monitor de infra da EAV7: nó no ar? cadeia avança? disco?
# Dispara alerta no feed on-chain (/security/alerts) e, se configurado, num
# webhook externo (Discord/Slack/genérico) — assim você é avisado de verdade.
set -uo pipefail
NODE=http://127.0.0.1:6070
ENVF=/opt/eav7/eav7.env
[ -f "$ENVF" ] && { set -a; . "$ENVF"; set +a; }
STATE=/opt/eav7/data/.monitor_height

notify() { # kind severity message
  curl -s -X POST "$NODE/security/alerts" -H "content-type: application/json" \
    -H "x-admin-token: ${EAV7_ADMIN_TOKEN:-}" \
    -d "{\"kind\":\"$1\",\"severity\":\"$2\",\"message\":\"$3\"}" >/dev/null || true
  if [ -n "${EAV7_ALERT_WEBHOOK:-}" ]; then
    icon="⚠️"; [ "$2" = "critical" ] && icon="🚨"
    msg="$icon EAV7 [$2] $1: $3"
    # Discord usa "content"; Slack/Mattermost usam "text"; genérico recebe ambos.
    curl -s --max-time 8 -X POST "$EAV7_ALERT_WEBHOOK" -H "content-type: application/json" \
      -d "{\"content\":\"$msg\",\"text\":\"$msg\",\"kind\":\"$1\",\"severity\":\"$2\"}" >/dev/null || true
  fi
}

H=$(curl -s --max-time 8 "$NODE/status" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).height))}catch{}})' || true)
if [ -z "$H" ]; then notify INFRA_NODE_DOWN critical "no nao responde em /status"; exit 0; fi
if [ -f "$STATE" ]; then PREV=$(cat "$STATE"); if [ "$H" -le "$PREV" ]; then notify INFRA_CHAIN_STUCK critical "altura parada em $H (nao avanca)"; fi; fi
echo "$H" > "$STATE"
USE=$(df / | awk 'END{gsub("%","",$5);print $5}')
if [ "$USE" -ge 85 ]; then notify INFRA_DISK warning "disco em ${USE}%"; fi
