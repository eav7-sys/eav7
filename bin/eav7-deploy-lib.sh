#!/usr/bin/env bash
# Carrega inventário de deploy (IPs fora do git). Sourceado pelos scripts eav7-deploy-*.
# Uso:  source "$(dirname "$0")/eav7-deploy-lib.sh" && eav7_deploy_load
set -euo pipefail

eav7_deploy_raiz() {
  cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  pwd
}

eav7_deploy_load() {
  local raiz
  raiz="$(eav7_deploy_raiz)"
  cd "$raiz"

  local arquivo="${EAV7_NODES_FILE:-$raiz/deploy/nodes.env}"
  if [[ -f "$arquivo" ]]; then
    # shellcheck disable=SC1090
    set -a
    # shellcheck source=/dev/null
    source "$arquivo"
    set +a
  fi

  EAV7_SSH_KEY="${EAV7_SSH_KEY:-$HOME/.ssh/eav7_deploy}"
  EAV7_SSH_USER="${EAV7_SSH_USER:-ubuntu}"
  EAV7_REMOTE_NODE_DIR="${EAV7_REMOTE_NODE_DIR:-/opt/eav7}"
  EAV7_REMOTE_WEB_DIR="${EAV7_REMOTE_WEB_DIR:-/opt/eav7-web}"
  EAV7_PUBLIC_URL="${EAV7_PUBLIC_URL:-https://eavscan.com}"
  EAV7_SSH_OPTS="${EAV7_SSH_OPTS:--i $EAV7_SSH_KEY -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new}"

  if [[ -z "${EAV7_NODES:-}" ]]; then
    echo "defina EAV7_NODES ou crie $arquivo (veja deploy/nodes.example)" >&2
    exit 2
  fi

  # shellcheck disable=SC2206
  EAV7_NODE_PAIRS=($EAV7_NODES)
  if (( ${#EAV7_NODE_PAIRS[@]} % 2 != 0 )); then
    echo "EAV7_NODES deve ser pares 'nome ip' (ex.: node1 203.0.113.10 node2 203.0.113.11)" >&2
    exit 2
  fi
}

eav7_deploy_say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

eav7_deploy_ssh() {
  # shellcheck disable=SC2086
  ssh $EAV7_SSH_OPTS "${EAV7_SSH_USER}@$1" "${@:2}"
}

eav7_deploy_rsync() {
  # shellcheck disable=SC2086
  rsync -az -e "ssh $EAV7_SSH_OPTS" "$@"
}
