#!/usr/bin/env bash
# Monitor de infra EAV7 (G20): pensado para rodar FORA do host do nó.
#
# Env:
#   EAV7_MONITOR_URL   URL pública ou privada do /status (default: http://127.0.0.1:6070)
#   EAV7_MONITOR_STATE arquivo de estado da altura (default: ~/.eav7-monitor-height)
#   EAV7_ALERT_WEBHOOK Discord/Slack/genérico (obrigatório para alerta se o nó cair)
#   EAV7_ADMIN_TOKEN   opcional — posta também em /security/alerts quando o nó responde
#   EAV7_DISK_PATH     se setado, checa % de uso desse filesystem (só faz sentido no host)
set -uo pipefail

NODE="${EAV7_MONITOR_URL:-http://127.0.0.1:6070}"
STATE="${EAV7_MONITOR_STATE:-$HOME/.eav7-monitor-height}"
ENVF="${EAV7_MONITOR_ENV:-/opt/eav7/eav7.env}"
[ -f "$ENVF" ] && { set -a; # shellcheck disable=SC1090
  . "$ENVF"; set +a; }

notify() { # kind severity message
  # Webhook primeiro: sobrevive à queda total do nó (G20).
  if [ -n "${EAV7_ALERT_WEBHOOK:-}" ]; then
    icon="⚠️"; [ "$2" = "critical" ] && icon="🚨"
    msg="$icon EAV7 [$2] $1: $3"
    curl -s --max-time 8 -X POST "$EAV7_ALERT_WEBHOOK" -H "content-type: application/json" \
      -d "{\"content\":\"$msg\",\"text\":\"$msg\",\"kind\":\"$1\",\"severity\":\"$2\"}" >/dev/null || true
  fi
  # Feed on-chain só se o nó ainda responde.
  curl -s --max-time 5 -X POST "$NODE/security/alerts" -H "content-type: application/json" \
    -H "x-admin-token: ${EAV7_ADMIN_TOKEN:-}" \
    -d "{\"kind\":\"$1\",\"severity\":\"$2\",\"message\":\"$3\"}" >/dev/null 2>&1 || true
}

H=$(curl -s --max-time 8 "$NODE/status" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).height))}catch{}})' || true)
if [ -z "$H" ]; then notify INFRA_NODE_DOWN critical "nó não responde em $NODE/status"; exit 0; fi
if [ -f "$STATE" ]; then
  PREV=$(cat "$STATE")
  if [ "$H" -le "$PREV" ]; then notify INFRA_CHAIN_STUCK critical "altura parada em $H (não avança)"; fi
fi
echo "$H" > "$STATE"

if [ -n "${EAV7_DISK_PATH:-}" ]; then
  USE=$(df "$EAV7_DISK_PATH" | awk 'END{gsub("%","",$5);print $5}')
  if [ "$USE" -ge 85 ]; then notify INFRA_DISK warning "disco em ${USE}% ($EAV7_DISK_PATH)"; fi
fi
