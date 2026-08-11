#!/usr/bin/env bash
# Deploy do EAV7 Core (Rust) nos nós — instala binários nos VPS.
#
# Uso:
#   bash bin/eav7-deploy-core.sh --from-release v0.1.0
#   EAV7_CORE_DIST=/path/to/dir-with-binaries bash bin/eav7-deploy-core.sh
set -euo pipefail

# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

REPO="$(pwd)"
FROM_RELEASE=""
DIST="${EAV7_CORE_DIST:-}"
REMOTE_BIN_DIR="${EAV7_REMOTE_BIN_DIR:-/usr/local/bin}"
REMOTE_DATA_DIR="${EAV7_REMOTE_DATA_DIR:-/var/lib/eav7}"
TARGET="${EAV7_CORE_TARGET:-x86_64-unknown-linux-gnu}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-release)
      FROM_RELEASE="${2:?tag ex.: v0.1.0}"
      shift 2
      ;;
    --from-release=*)
      FROM_RELEASE="${1#*=}"
      shift
      ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "arg desconhecido: $1" >&2
      exit 2
      ;;
  esac
done

die(){ printf '\n\033[1;31mABORTADO: %s\033[0m\n' "$*" >&2; exit 1; }

TMP_DL=""
cleanup(){ [[ -n "$TMP_DL" && -d "$TMP_DL" ]] && rm -rf "$TMP_DL"; }
trap cleanup EXIT

resolve_dist() {
  if [[ -n "$DIST" ]]; then
    [[ -d "$DIST" ]] || die "EAV7_CORE_DIST não é diretório: $DIST"
    return
  fi
  if [[ -n "$FROM_RELEASE" ]]; then
    local ver="${FROM_RELEASE#v}"
    local asset="eav7-core-v${ver}-${TARGET}.tar.gz"
    local url="https://github.com/eav7-sys/eav7/releases/download/v${ver}/${asset}"
    TMP_DL="$(mktemp -d)"
    eav7_deploy_say "Baixando Release $asset"
    curl -fsSL -o "$TMP_DL/$asset" "$url" || die "download falhou (repo privado? gh auth / token): $url"
    tar -C "$TMP_DL" -xzf "$TMP_DL/$asset"
    DIST="$(find "$TMP_DL" -maxdepth 1 -type d -name 'eav7-core-*' | head -1)"
    [[ -n "$DIST" ]] || die "tarball sem pasta eav7-core-*"
    return
  fi
  local built="$REPO/rust/target/${TARGET}/release"
  [[ -x "$built/eav7-core" ]] || built="$REPO/rust/target/release"
  if [[ -x "$built/eav7-core" && -x "$built/eav7-node" ]]; then
    DIST="$built"
    eav7_deploy_say "Usando binários locais em $DIST"
    return
  fi
  die "sem binários. Use --from-release v0.1.0 ou compile para $TARGET"
}

resolve_dist
[[ -f "$DIST/eav7-core" ]] || die "falta eav7-core em $DIST"
[[ -f "$DIST/eav7-node" ]] || die "falta eav7-node em $DIST"

IPS=()
NAMES=()
i=0
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  NAMES+=("${EAV7_NODE_PAIRS[i]}")
  IPS+=("${EAV7_NODE_PAIRS[i+1]}")
  i=$((i + 2))
done

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

CORE_SUM="$(sha256_file "$DIST/eav7-core")"
NODE_SUM="$(sha256_file "$DIST/eav7-node")"
mkdir -p deploy/checksums
{
  printf '%s  %s\n' "$CORE_SUM" "eav7-core"
  printf '%s  %s\n' "$NODE_SUM" "eav7-node"
} > deploy/checksums/core-binaries.sha256
echo "  eav7-core sha256 = $CORE_SUM"
echo "  eav7-node sha256 = $NODE_SUM"

install_unit() {
  local n="$1"
  eav7_deploy_rsync "$REPO/deploy/eav7-core.service.example" \
    "${EAV7_SSH_USER}@${n}:/tmp/eav7-core.service"
  eav7_deploy_ssh "$n" "
    set -e
    sudo mkdir -p '${REMOTE_DATA_DIR}' '${REMOTE_BIN_DIR}'
    sudo mv /tmp/eav7-core.service /etc/systemd/system/eav7-core.service
    if systemctl list-unit-files 2>/dev/null | grep -q '^eav7\\.service'; then
      sudo systemctl disable --now eav7 2>/dev/null || true
    fi
    sudo systemctl daemon-reload
    sudo systemctl enable eav7-core
  "
}

deploy_one() {
  local name="$1" n="$2"
  eav7_deploy_say "Core $name ($n)"
  eav7_deploy_rsync "$DIST/eav7-core" "$DIST/eav7-node" \
    "${EAV7_SSH_USER}@${n}:/tmp/"
  eav7_deploy_ssh "$n" "
    set -e
    echo '${CORE_SUM}  /tmp/eav7-core' | sha256sum -c -
    echo '${NODE_SUM}  /tmp/eav7-node' | sha256sum -c -
    sudo install -m 755 /tmp/eav7-core /tmp/eav7-node '${REMOTE_BIN_DIR}/'
    sudo mkdir -p '${REMOTE_DATA_DIR}'
    if [[ ! -f '${REMOTE_DATA_DIR}/core.json' ]]; then
      sudo '${REMOTE_BIN_DIR}/eav7-core' init --dir '${REMOTE_DATA_DIR}' \
        --mode validator --port 6070 --host 127.0.0.1 || true
    fi
  "
  install_unit "$n"
  eav7_deploy_ssh "$n" 'sudo systemctl restart eav7-core'
  echo "  aguardando /status…"
  for attempt in $(seq 1 60); do
    sleep 3
    st="$(eav7_deploy_ssh "$n" 'systemctl is-active eav7-core' 2>/dev/null || true)"
    [[ "$st" == active ]] || { echo "  ($attempt) serviço: $st"; continue; }
    if eav7_deploy_ssh "$n" 'curl -fsS -H accept:application/json --max-time 5 http://127.0.0.1:6070/status' \
      | python3 -c 'import sys,json; d=json.load(sys.stdin); print("height",d.get("height"),"head",str(d.get("headHash") or "")[:16])' 2>/dev/null; then
      echo "  ✔ $name Core OK"
      return 0
    fi
  done
  die "$name ($n) Core não respondeu /status"
}

for idx in "${!IPS[@]}"; do
  deploy_one "${NAMES[$idx]}" "${IPS[$idx]}"
done

eav7_deploy_say "CORE NOS NÓS"
echo "Unit protocolo eav7.service desabilitado onde existia."
