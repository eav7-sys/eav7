#!/usr/bin/env bash
# Renderiza deck.html em EAV7-apresentacao.pdf (slides 16:9, 13.333in x 7.5in).
set -euo pipefail

cd "$(dirname "$0")"

SRC="deck.html"
OUT="EAV7-apresentacao.pdf"

CANDIDATES=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
)
# Chromium do Playwright, se instalado (o sufixo da pasta muda a cada versão).
while IFS= read -r p; do
  CANDIDATES+=("$p")
done < <(ls -d "$HOME"/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium 2>/dev/null || true)

BROWSER=""
for c in "${CANDIDATES[@]}"; do
  if [[ -x "$c" ]]; then BROWSER="$c"; break; fi
done

if [[ -z "$BROWSER" ]]; then
  echo "Nenhum Chrome/Chromium encontrado. Instale o Google Chrome ou rode: npx playwright install chromium" >&2
  exit 1
fi

PROFILE="$(mktemp -d)"
rm -f "$OUT"

# Chrome em modo headless às vezes escreve o PDF e não encerra o processo,
# então roda em background e finaliza assim que o arquivo estabiliza.
"$BROWSER" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --no-first-run \
  --user-data-dir="$PROFILE" \
  --no-pdf-header-footer \
  --print-to-pdf="$PWD/$OUT" \
  "file://$PWD/$SRC" >/dev/null 2>&1 &
CHROME_PID=$!
trap 'kill -9 "$CHROME_PID" 2>/dev/null || true; rm -rf "$PROFILE"' EXIT

LAST=0
for _ in $(seq 1 60); do
  sleep 1
  SIZE=$(stat -f%z "$OUT" 2>/dev/null || echo 0)
  # Espera estabilizar acima de ~50 KB (PDF real, não stub).
  if [[ "$SIZE" -gt 50000 && "$SIZE" -eq "$LAST" ]]; then break; fi
  LAST="$SIZE"
done

kill -9 "$CHROME_PID" 2>/dev/null || true
wait "$CHROME_PID" 2>/dev/null || true

if [[ ! -s "$OUT" ]]; then
  echo "Falha ao gerar $OUT" >&2
  exit 1
fi

echo "OK  $PWD/$OUT  ($(du -h "$OUT" | cut -f1))"
