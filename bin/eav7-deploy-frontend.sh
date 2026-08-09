#!/usr/bin/env bash
# Re-deploy só do frontend standalone. IPs em deploy/nodes.env.
# Uso: bash bin/eav7-deploy-frontend.sh
set -euo pipefail

# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

[[ -d web-next/.next/standalone ]] || {
  echo "falta web-next/.next/standalone — rode: cd web-next && npm run build" >&2
  exit 1
}
[[ -d web-next/.next/standalone/.next/static ]] || \
  cp -r web-next/.next/static web-next/.next/standalone/.next/static
[[ -d web-next/.next/standalone/public ]] || {
  [[ -d web-next/public ]] && cp -r web-next/public web-next/.next/standalone/public
}

i=0
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  name="${EAV7_NODE_PAIRS[i]}"
  ip="${EAV7_NODE_PAIRS[i+1]}"
  i=$((i + 2))
  eav7_deploy_say "FRONTEND $name ($ip)"
  eav7_deploy_rsync --delete web-next/.next/standalone/ \
    "${EAV7_SSH_USER}@${ip}:${EAV7_REMOTE_WEB_DIR}/"
  eav7_deploy_ssh "$ip" "sudo systemctl restart eav7-web
for i in \$(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null && break; sleep 1; done
echo -n '  / -> ';  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/"
  echo "  -> $name OK"
done

echo
echo "=== teste público (opcional) ==="
if curl -fsS -o /dev/null --max-time 15 "${EAV7_PUBLIC_URL}/" 2>/dev/null; then
  A=$(curl -fsS -L --max-time 15 "${EAV7_PUBLIC_URL}/" | grep -oE '/_next/static/[^"]+\.js' | head -1 || true)
  if [[ -n "${A:-}" ]]; then
    echo -n "  ${EAV7_PUBLIC_URL}${A} -> "
    curl -fsS -L -o /dev/null -w "%{http_code}\n" --max-time 15 "${EAV7_PUBLIC_URL}${A}" || true
  fi
else
  echo "  (público inacessível agora — ok se ainda estiver só no local)"
fi
