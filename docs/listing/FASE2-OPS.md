# Fase 2.2 — Ops LBP → TimelockLpSeeder (Opção A)

Pré-requisito: [`FASE2-GTM.md`](./FASE2-GTM.md) decidido **A**.

AMM real (router USDT) fica **depois** do escrow: este runbook leva até `finalizeToLp` → `TimelockLpSeeder.seedAndLock`.

## Artefactos

| Peça | Path |
|---|---|
| Plano produto | `contracts/sale/public-distribution.json` |
| Preços LBP | `contracts/sale/public-lbp-delivery.json` |
| Endereços deploy | `contracts/sale/public-lbp-addresses.json` |
| Contratos | `PublicVault.sol` · `TimelockLpSeeder.sol` |
| Deploy | `contracts/scripts/deploy-public-lbp.mjs` |
| Abrir janela | `contracts/scripts/open-public-lbp.mjs` |
| Keeper finalize | `contracts/scripts/finalize-public-keeper.mjs` |
| Relayer público | `SALE_MODE=public` · porta **8788** |
| UI | https://eavscan.com/sale/public |

## Checklist (ordem)

### A · Contas

```bash
# gera admin + relayer (chaves em .secrets/ gitignored; 0x públicos no JSON)
node contracts/scripts/prepare-public-lbp-wallets.mjs
```

- [x] Relayer + admin `0x` gerados localmente (`prepare-public-lbp-wallets.mjs`)
- [ ] Confirmar / trocar admin por multisig antes de fundear 45B (`transferAdmin`)
- [ ] Sweep / ops multisig `0x` (hoje = admin temporário)
- [x] Confirmar saldos na custódia pública `E7AADB…8320` (~45B → 2,25B incentives após fund)
- [x] Fundear **deployer híbrido** com **≥ 8 000 EAV7**, depois `stake 7000`:
  - E7: `E78EF2F3C0AC82E4AC65C7CDE63573204D`
  - Motivo: `fees.EAVM_DEPLOY=200000` só libera ~1000 gas de VM; stake dá energia para o CREATE
  - Wallet local (gitignored): `contracts/sale/relayer/.secrets/deployer.wallet.json`

```bash
# após o transfer on-chain (CLI só fala HTTP claro na API pública):
eav7-cli stake --wallet contracts/sale/relayer/.secrets/deployer.wallet.json \
  --amount 7000 --node http://api.eavscan.com
```

Systemd (hub): [`deploy/eav7-sale-public-relayer.service.example`](../../deploy/eav7-sale-public-relayer.service.example) · env [`deploy/sale-public-relayer.env.example`](../../deploy/sale-public-relayer.env.example).

### B · Deploy (dry-run → live)

Deploy **nativo** (híbrido + stake) — eth `ContractFactory` não tem energia suficiente:

```bash
# dry-run
RELAYER_ADDRESS=0x… node contracts/scripts/native-deploy-public-lbp.mjs

# live + setBuckets + setLpSeeder
RELAYER_ADDRESS=0x… EAV7_NODE=http://api.eavscan.com \
  node contracts/scripts/native-deploy-public-lbp.mjs --setup --live
```

- [x] `public-lbp-addresses.json` preenchido (`publicVault0x`, `timelockLpSeeder0x`)
- [x] Fundar **PublicVault** com **42,75B** (lbp+lpSeed+buffer) a partir da custódia pública
  - Destino E7 do vault: `E7F27692A901B85A20A2B85F9BDF058A87`
  - Incentives 2,25B ficam na custódia `E7AADB…8320`
  - Carteira: `secrets/genesis-vaults/public-vault/validator-wallet.json`
  - Script: `fund-public-vault.mjs --live` · status `vault-funded`
- [x] Verificar balance do vault no explorer

### C · Relayer + front

```bash
cd contracts/sale/relayer
SALE_MODE=public PORT=8788 \
  PUBLIC_VAULT_ADDRESS=0x… \
  RELAYER_PRIVATE_KEY=0x… \
  SALE_OPS_TOKEN=… \
  EAV7_RPC=https://rpc.eavscan.com \
  node index.mjs serve
```

Front: `SALE_RELAYER_PUBLIC_URL=http://127.0.0.1:8788` (ou URL interna no hub).

- [x] `GET /quote` no relayer público mostra tiers LBP (0.008→0.015)
  - Serviço: `eav7-sale-public-relayer` · `http://127.0.0.1:8788`
  - Front: `SALE_RELAYER_PUBLIC_URL=http://127.0.0.1:8788`
  - Relayer eth staked 7000 (energy para `grant`)
- [x] `/sale/public` cria intent — smoke 12 ago 2026: page · quote `0.008` · POST intent `201` (`e4a8b072b0f8986f`, unpaid $100 eth-usdt) · GET intent OK
- [x] E2E local (sem mainnet): `npm run testnet:lbp-e2e` · [`docs/testnet.md`](../testnet.md) · mock `/confirm` → grant → release
- [x] Redeploy front — `/price` usa LBP só com status `lbp-open`; com `lbp-prepared` → private Launch **$0.005** (private-first · 12 ago 2026)

### D · Abrir LBP (TGE)

**Estado agora:** vault **preparado** on-chain (`openLbp` · deadline **262603** · `lbpSold=0`) · status JSON **`lbp-prepared`** · marketing = **private sale** até anunciar TGE.  
Ordem: private → TGE/LBP (`status: lbp-open`) → finalize/escrow → AMM DEX → CEX.

```bash
# dry-run
node contracts/scripts/open-public-lbp.mjs
# live (~72h) — admin nativo = deployer.wallet.json
node contracts/scripts/open-public-lbp.mjs --live
```

- [x] Data/hora TGE: `openLbp` on-chain (deadline **262603**) — **marketing público adiado**; JSON `lbp-prepared`
- [ ] Comunicação TGE pública — só quando voltar `status: lbp-open` · rascunho [`TGE-COMUNICACAO.md`](./TGE-COMUNICACAO.md)
- [x] Smoke intent público (12 ago 2026): `e4a8b072b0f8986f` · `$100` · `eth-usdt` · `pending` (aguarda pagamento exacto)
- [x] Keeper em watch no hub (`eav7-sale-public-keeper` · só observa até `--live`):

```bash
# local check
EAV7_RPC=https://rpc.eavscan.com node contracts/scripts/finalize-public-keeper.mjs --once
# hub (após open + deadline):
KEEPER_PRIVATE_KEY=0x… node scripts/finalize-public-keeper.mjs --once --live
```

Serviço exemplo: [`deploy/eav7-sale-public-keeper.service.example`](../../deploy/eav7-sale-public-keeper.service.example).

### E · Pós-finalize (AMM — fase seguinte)

Runbook completo: **[`FASE3-AMM.md`](./FASE3-AMM.md)**.  
Nota: `TimelockLpSeeder` atual é **escrow-only**; AMM entra em contrato seguinte após `finalizeToLp`.

- [ ] `finalizeToLp` no deadline / sold-out (keeper `--live`)
- [ ] Deploy router UniswapV2-style + pair EAV7/USDT
- [ ] `depositStable` (USDT da private-sale treasury)
- [ ] Seed AMM + LP lock
- [ ] Link Trade no site + `/price` passa a refletir pool
- [ ] Atualizar `/market` com endereços vault/pool

## Partição on-chain (e7)

| Bucket | EAV7 | e7 |
|---|---|---|
| LBP | 13,5 bi | `13500000000000000` |
| LP seed | 22,5 bi | `22500000000000000` |
| CEX buffer | 6,75 bi | `6750000000000000` |
| Incentives | 2,25 bi | `2250000000000000` |

## Não fazer

- Abrir LBP sem vault funded (grants revertem / falham na release)
- Usar chave de âncora no relayer
- Anunciar pool AMM antes de `ammRouter` real existir
- Submeter CoinGecko/CMC antes do pair com volume
