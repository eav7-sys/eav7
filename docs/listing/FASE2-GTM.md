# Fase 2.1 — Decisão GTM do bucket público (45%)

Status: **decidido — Opção A** (11 ago 2026).

Documento de produto canónico: [`contracts/sale/public-distribution.json`](../../contracts/sale/public-distribution.json).

## Decisão

| Campo | Valor |
|---|---|
| Opção | **A · LBP / dutch 72h → seed AMM EAV7/USDT** |
| Partição | 30% LBP · 50% LP seed (lock 18m) · 15% CEX buffer · 5% incentives |
| Fallback | **B** (pool DEX direto) só se a data de open market não aguentar PublicVault + relayer |
| Preço até open | Continua sale-tier em `/price`; mcap = free float |

### Porquê A (padrão alinhado ao plano)

- É o caminho documentado no JSON e no whitepaper (líquido / LBP).
- Discovery público + LP canónico é o que trackers e exchanges leem como “mercado real”.
- Buffer CEX e incentives ficam explícitos — sem overclaim de liquidez eterna.

## Opções (histórico)

| Opção | O que é | Resultado |
|---|---|---|
| **A · LBP → seed AMM** | JSON completo | **Escolhida** |
| **B · Pool DEX direto** | Seed sem LBP | Contingência de calendário |
| **C · Só venda documentada** | Tiers / intents | Rejeitada (não desbloqueia CG/CMC) |

## Critério para desbloquear 2.2

- [x] Opção escolhida: **A**
- [ ] Data alvo TGE / open market: ________
- [ ] Stable side (USDT origem): private-sale treasury / ops
- [ ] Multisig ops confirmado
- [ ] PublicVault + TimelockLpSeeder deployados (ver [`FASE2-OPS.md`](./FASE2-OPS.md))
- [ ] Relayer `SALE_MODE=public` no ar
- [ ] `openLbp` + keeper `finalizeToLp`
- [ ] Endereço do pool AMM + LP lock anunciáveis (depois do escrow)

Pacote ops: **[`FASE2-OPS.md`](./FASE2-OPS.md)** · scripts em `contracts/scripts/*public-lbp*`.

Até 2.2 live: `/market` e `/circulating` publicam free float; `/price` continua sale-tier (private) com mcap sobre free float.
