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
mkdir -p web-next/.next/standalone/.next
rm -rf web-next/.next/standalone/.next/static
cp -R web-next/.next/static web-next/.next/standalone/.next/static
rm -rf web-next/.next/standalone/public
cp -R web-next/public web-next/.next/standalone/public
[[ -d web-next/.next/standalone/.next/static/chunks ]] || {
  echo "standalone sem .next/static/chunks — abort" >&2
  exit 1
}

# Front público só no hub (Cloudflare Tunnel → :3000).
hub_ip="${EAV7_NODE_PAIRS[1]:-}"
hub_name="${EAV7_NODE_PAIRS[0]:-hub}"
[[ -n "$hub_ip" ]] || { echo "deploy/nodes.env sem hub" >&2; exit 1; }

eav7_deploy_say "FRONTEND $hub_name ($hub_ip)"
eav7_deploy_rsync --delete web-next/.next/standalone/ \
  "${EAV7_SSH_USER}@${hub_ip}:${EAV7_REMOTE_WEB_DIR}/"
eav7_deploy_ssh "$hub_ip" "sudo systemctl restart eav7-web
for i in \$(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null && break; sleep 1; done
echo -n '  / -> ';  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
css=\$(curl -sS http://127.0.0.1:3000/ | tr '\"' '\\n' | grep '_next/static/.*\\.css' | head -1)
echo -n \"  \${css} -> \"; curl -sS -o /dev/null -w '%{http_code}\\n' \"http://127.0.0.1:3000\${css}\"
"
echo "  -> $hub_name OK"

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
