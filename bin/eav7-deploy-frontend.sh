#!/usr/bin/env bash
# Re-deploy só do frontend standalone. IPs em deploy/nodes.env.
# Uso: bash bin/eav7-deploy-frontend.sh
set -euo pipefail

# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

STANDALONE="web-next/.next/standalone"
[[ -d "$STANDALONE" ]] || {
  echo "falta $STANDALONE — rode: cd web-next && npm run build" >&2
  exit 1
}

# Next monorepo tracing às vezes aninha em standalone/web-next/; outras vezes fica flat.
APP_SRC=""
if [[ -f "$STANDALONE/web-next/server.js" ]]; then
  APP_SRC="$STANDALONE/web-next"
elif [[ -f "$STANDALONE/server.js" ]]; then
  APP_SRC="$STANDALONE"
else
  echo "standalone sem server.js (nem em web-next/) — abort" >&2
  exit 1
fi

# Guardrail: nunca rsyncar o monorepo (rust/ docs/ …) para o hub.
if [[ -d "$STANDALONE/rust" ]] || [[ -d "$APP_SRC/rust" ]]; then
  echo "AVISO: standalone ainda contém rust/ (build com tracing errado)." >&2
  echo "  Deploy vai usar só o app em $APP_SRC (lean). Rebuild com outputFileTracingRoot=web-next." >&2
fi

STAGE="${TMPDIR:-/tmp}/eav7-web-lean-$$"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT
mkdir -p "$STAGE"

# Copia só o app Node (server.js + node_modules + .next do standalone).
rsync -a \
  --exclude rust \
  --exclude docs \
  --exclude contracts \
  --exclude bin \
  --exclude deploy \
  --exclude secrets \
  --exclude services \
  --exclude chain-registry \
  --exclude vectors \
  --exclude scripts \
  --exclude e2e \
  --exclude src \
  --exclude '*.md' \
  --exclude 'tmp-*' \
  --exclude 'PROMPT-*' \
  --exclude 'AUDITORIA*' \
  --exclude '20*-*-*.md' \
  "$APP_SRC/" "$STAGE/"

# node_modules na raiz do standalone (layout aninhado antigo)
if [[ "$APP_SRC" == "$STANDALONE/web-next" && -d "$STANDALONE/node_modules" && ! -d "$STAGE/node_modules" ]]; then
  rsync -a "$STANDALONE/node_modules/" "$STAGE/node_modules/"
fi

# Ritual Next standalone: static + public do build atual
mkdir -p "$STAGE/.next"
rm -rf "$STAGE/.next/static"
cp -R web-next/.next/static "$STAGE/.next/static"
rm -rf "$STAGE/public"
cp -R web-next/public "$STAGE/public"

# Conteúdo runtime (preço / whitepaper) se existir no app fonte
if [[ -d web-next/data ]]; then
  mkdir -p "$STAGE/data"
  rsync -a web-next/data/ "$STAGE/data/"
fi
if [[ -d web-next/content ]]; then
  mkdir -p "$STAGE/content"
  rsync -a web-next/content/ "$STAGE/content/"
fi

[[ -f "$STAGE/server.js" ]] || { echo "stage sem server.js — abort" >&2; exit 1; }
[[ -d "$STAGE/.next/static/chunks" ]] || {
  echo "stage sem .next/static/chunks — abort" >&2
  exit 1
}

SIZE_BYTES="$(du -sm "$STAGE" | awk '{print $1}')"
# Limite soft: ~3GB. Acima disso algo entrou errado (ex.: data monorepo / rust).
if (( SIZE_BYTES > 3072 )); then
  echo "stage lean muito grande: ${SIZE_BYTES}MB — abort (esperado < ~3GB)" >&2
  du -sh "$STAGE"/* 2>/dev/null | sort -hr | head -20 >&2
  exit 1
fi

eav7_deploy_say "FRONTEND lean ${SIZE_BYTES}MB → ${EAV7_REMOTE_WEB_DIR}"

# Front público só no hub (Cloudflare Tunnel → :3000).
hub_ip="${EAV7_NODE_PAIRS[1]:-}"
hub_name="${EAV7_NODE_PAIRS[0]:-hub}"
[[ -n "$hub_ip" ]] || { echo "deploy/nodes.env sem hub" >&2; exit 1; }

eav7_deploy_say "FRONTEND $hub_name ($hub_ip)"
eav7_deploy_rsync --delete --progress "$STAGE/" \
  "${EAV7_SSH_USER}@${hub_ip}:${EAV7_REMOTE_WEB_DIR}/"
eav7_deploy_ssh "$hub_ip" "sudo systemctl restart eav7-web
for i in \$(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null && break; sleep 1; done
echo -n '  / -> ';  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
css=\$(curl -sS http://127.0.0.1:3000/ | tr '\"' '\\n' | grep '_next/static/.*\\.css' | head -1)
echo -n \"  \${css} -> \"; curl -sS -o /dev/null -w '%{http_code}\\n' \"http://127.0.0.1:3000\${css}\"
du -sh ${EAV7_REMOTE_WEB_DIR}
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
