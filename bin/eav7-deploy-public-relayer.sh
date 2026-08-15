#!/usr/bin/env bash
# Deploy public LBP relayer to hub + fund/stake relayer eth account for grants.
# Uso: bash bin/eav7-deploy-public-relayer.sh
set -euo pipefail

# shellcheck source=eav7-deploy-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

ROOT="$(pwd)"
hub_ip="${EAV7_NODE_PAIRS[1]:-}"
hub_name="${EAV7_NODE_PAIRS[0]:-hub}"
[[ -n "$hub_ip" ]] || { echo "deploy/nodes.env sem hub" >&2; exit 1; }

REMOTE_ROOT=/opt/eav7-contracts
SECRETS="$ROOT/contracts/sale/relayer/.secrets"
ADDR_JSON="$ROOT/contracts/sale/public-lbp-addresses.json"
PK_FILE="$SECRETS/relayer.private.key"
CUSTODY_WALLET="$ROOT/secrets/genesis-vaults/public-vault/validator-wallet.json"
CLI="$ROOT/rust/target/release/eav7-cli"
RELAYER_E7=E79DC6183BD18DB6ABFB1B6A5785B83D8E
STAKE_AMT=7000
FUND_AMT=8000

VAULT=$(python3 -c "import json;print(json.load(open('$ADDR_JSON'))['publicVault0x'])")
test -n "$VAULT"
test -f "$PK_FILE"
test -f "$CUSTODY_WALLET"
test -x "$CLI"

eav7_deploy_say "PUBLIC RELAYER $hub_name ($hub_ip)"

eav7_deploy_ssh "$hub_ip" "sudo mkdir -p $REMOTE_ROOT/sale/relayer $REMOTE_ROOT/artifacts /etc/eav7 && sudo chown -R eav7:eav7 $REMOTE_ROOT /etc/eav7"

eav7_deploy_rsync -a --delete \
  --exclude 'relayer/node_modules' \
  --exclude 'relayer/.secrets' \
  --exclude 'relayer/sale-state*.json' \
  --exclude 'relayer/price-history.json' \
  "$ROOT/contracts/sale/" "${EAV7_SSH_USER}@${hub_ip}:${REMOTE_ROOT}/sale/"

eav7_deploy_rsync -a \
  "$ROOT/contracts/artifacts/PublicVault.abi.json" \
  "$ROOT/contracts/artifacts/PublicVault.bin" \
  "${EAV7_SSH_USER}@${hub_ip}:${REMOTE_ROOT}/artifacts/"

eav7_deploy_ssh "$hub_ip" "cd $REMOTE_ROOT/sale/relayer && npm ci --omit=dev"

OPS_TOKEN=$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')
PK=$(tr -d '[:space:]' <"$PK_FILE")
case "$PK" in 0x*|0X*) ;; *) PK="0x$PK" ;; esac

ENV_TMP=$(mktemp)
umask 077
cat >"$ENV_TMP" <<EOF
SALE_MODE=public
PORT=8788
EAV7_RPC=http://127.0.0.1:7070
PUBLIC_VAULT_ADDRESS=$VAULT
RELAYER_PRIVATE_KEY=$PK
SALE_OPS_TOKEN=$OPS_TOKEN
BTC_USD=95000
POLL_MS=15000
EOF
# shellcheck disable=SC2086
scp $EAV7_SSH_OPTS "$ENV_TMP" "${EAV7_SSH_USER}@${hub_ip}:/tmp/sale-public-relayer.env"
rm -f "$ENV_TMP"
eav7_deploy_ssh "$hub_ip" 'sudo mv /tmp/sale-public-relayer.env /etc/eav7/sale-public-relayer.env && sudo chown root:eav7 /etc/eav7/sale-public-relayer.env && sudo chmod 640 /etc/eav7/sale-public-relayer.env'

# shellcheck disable=SC2086
scp $EAV7_SSH_OPTS \
  "$ROOT/deploy/eav7-sale-public-relayer.service.example" \
  "${EAV7_SSH_USER}@${hub_ip}:/tmp/eav7-sale-public-relayer.service"
eav7_deploy_ssh "$hub_ip" 'sudo mv /tmp/eav7-sale-public-relayer.service /etc/systemd/system/eav7-sale-public-relayer.service && sudo systemctl daemon-reload && sudo systemctl enable --now eav7-sale-public-relayer && sleep 2 && systemctl is-active eav7-sale-public-relayer'
echo -n "  /quote -> "
eav7_deploy_ssh "$hub_ip" 'curl -sf http://127.0.0.1:8788/quote | head -c 500; echo'

eav7_deploy_say "FUND+STAKE relayer ($RELAYER_E7)"
HAVE=$($CLI balance "$RELAYER_E7" --node http://api.eavscan.com | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("balance","0"))')
NEED=$((FUND_AMT * 1000000))
if (( HAVE < NEED )); then
  echo "  send $FUND_AMT EAV7 custody → relayer"
  $CLI send --wallet "$CUSTODY_WALLET" --to "$RELAYER_E7" --amount "$FUND_AMT" --node http://api.eavscan.com
  for i in $(seq 1 20); do
    HAVE=$($CLI balance "$RELAYER_E7" --node http://api.eavscan.com | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("balance","0"))')
    (( HAVE >= NEED )) && break
    sleep 2
  done
fi

node --input-type=commonjs <<EOF
const { createRequire } = require("module");
const path = require("path");
const fs = require("fs");
const requireE = createRequire(path.join("$ROOT/contracts/sale/relayer", "package.json"));
const { Wallet, JsonRpcProvider, parseUnits } = requireE("ethers");
const pk = fs.readFileSync("$PK_FILE","utf8").trim().replace(/^(?!0x)/,"0x");
const provider = new JsonRpcProvider("https://rpc.eavscan.com", 72020, { staticNetwork: true });
provider.getFeeData = async () => ({ gasPrice: 475000000000n, maxFeePerGas: null, maxPriorityFeePerGas: null });
const w = new Wallet(pk, provider);
(async () => {
  const r = await fetch("http://api.eavscan.com/address/$RELAYER_E7");
  const j = await r.json();
  console.log("  relayer", w.address);
  if (BigInt(j.staked || "0") >= ${STAKE_AMT}n * 1_000_000n) {
    console.log("  already staked", j.stakedFormatted);
    return;
  }
  const stakeTo = "0x0000000000000000000000000000000000007001";
  const value = parseUnits("$STAKE_AMT", 18);
  const bal = await provider.getBalance(w.address);
  console.log("  wei bal", bal.toString());
  if (bal < value) { console.error("insufficient balance for stake"); process.exit(1); }
  const tx = await w.sendTransaction({ to: stakeTo, value, gasLimit: 100000n, gasPrice: 475000000000n, type: 0 });
  console.log("  stake tx", tx.hash);
  // eth receipt may not map native STAKE id — poll account instead
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const a = await (await fetch("http://api.eavscan.com/address/$RELAYER_E7")).json();
    if (BigInt(a.staked || "0") >= ${STAKE_AMT}n * 1_000_000n) {
      console.log("  stake OK", a.stakedFormatted);
      return;
    }
  }
  throw new Error("stake timeout");
})().catch((e) => { console.error(e); process.exit(1); });
EOF

eav7_deploy_say "FRONT env SALE_RELAYER_PUBLIC_URL"
eav7_deploy_ssh "$hub_ip" 'if grep -q "^SALE_RELAYER_PUBLIC_URL=" /opt/eav7-web/.env.production 2>/dev/null; then sudo sed -i "s|^SALE_RELAYER_PUBLIC_URL=.*|SALE_RELAYER_PUBLIC_URL=http://127.0.0.1:8788|" /opt/eav7-web/.env.production; else echo "SALE_RELAYER_PUBLIC_URL=http://127.0.0.1:8788" | sudo tee -a /opt/eav7-web/.env.production >/dev/null; fi; grep "^SALE_RELAYER_PUBLIC_URL=" /opt/eav7-web/.env.production'

echo "OK — next: rebuild+deploy frontend (vault-funded JSON + sale-server)"
