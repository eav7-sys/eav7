#!/usr/bin/env bash
# Empacota eav7-core + eav7-node release para a plataforma atual (macOS/Linux).
# Windows e cross-target: use o workflow release-core (tag v* no GitHub).
#
# Uso: bash bin/eav7-package-core.sh [versão]
# Saída: dist/eav7-core-<ver>-<target>.tar.gz(+.sha256)
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

VER="${1:-$(git describe --tags --always --dirty 2>/dev/null || echo 0.1.0)}"
VER="${VER#v}"

HOST="$(rustc -vV | awk '/host:/{print $2}')"
eav7_say(){ printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

eav7_say "cargo build --release ($HOST)"
(
  cd rust
  cargo build --release -p eav7-core -p eav7-node --target "$HOST"
)

OUT="eav7-core-v${VER}-${HOST}"
mkdir -p "rust/dist/$OUT"
cp "rust/target/${HOST}/release/eav7-core" "rust/dist/$OUT/"
cp "rust/target/${HOST}/release/eav7-node" "rust/dist/$OUT/"
cp docs/core.md "rust/dist/$OUT/README-core.md"
# nota de instalação Windows (mesmo pacote de docs)
cp deploy/eav7-core.windows-service.md "rust/dist/$OUT/" 2>/dev/null || true

tar -C rust/dist -czf "rust/dist/${OUT}.tar.gz" "$OUT"
(
  cd rust/dist
  shasum -a 256 "${OUT}.tar.gz" > "${OUT}.tar.gz.sha256"
)

eav7_say "OK"
echo "  rust/dist/${OUT}.tar.gz"
echo "  rust/dist/${OUT}.tar.gz.sha256"
echo
echo "Para Windows/Linux arm64: publique tag v${VER} no GitHub (workflow release-core)."
