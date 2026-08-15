# Listagens e publicação pública

Plano mestre: **[`PLANO-PUBLICACAO.md`](./PLANO-PUBLICACAO.md)** — fases 0→5 (rede → mercado → CoinGecko/CMC → ecossistema).

QA Fase 1 (carteiras): **[`FASE1-QA.md`](./FASE1-QA.md)**.  
GTM Fase 2.1: **[`FASE2-GTM.md`](./FASE2-GTM.md)** (Opção A).  
Ops LBP Fase 2.2: **[`FASE2-OPS.md`](./FASE2-OPS.md)**.  
Comunicação TGE: **[`TGE-COMUNICACAO.md`](./TGE-COMUNICACAO.md)**.  
AMM pós-LBP: **[`FASE3-AMM.md`](./FASE3-AMM.md)**.

Add network (após deploy): https://eavscan.com/developers/networks#add-network  
Market / free float: https://eavscan.com/market  
LBP pública: https://eavscan.com/sale/public
Whitepaper: https://eavscan.com/whitepaper

## Status atual (snapshot)

| Destino | Status |
|---|---|
| LBP pública (`PublicVault`) | **Preparada** on-chain · marketing **adiado** · status `lbp-prepared` · preço front = private **$0.005** · ver [`FASE2-OPS.md`](./FASE2-OPS.md) |
| Private sale | **Foco atual** · https://eavscan.com/sale · Launch $0.005 |
| [`ethereum-lists/chains`](https://github.com/ethereum-lists/chains) · `eip155-72020` | **Mergeado** ([#8521](https://github.com/ethereum-lists/chains/pull/8521)) |
| [chainlist.org/chain/72020](https://chainlist.org/chain/72020) | **Visível** |
| Chainlist RPC seguro | **PR** [#3040](https://github.com/DefiLlama/chainlist/pull/3040) · CI verde · follow-up [comment](https://github.com/DefiLlama/chainlist/pull/3040#issuecomment-5261501741) |
| Ícone + nome `EAV7` | **PR** [#8591](https://github.com/ethereum-lists/chains/pull/8591) · CI verde · follow-up [comment](https://github.com/ethereum-lists/chains/pull/8591#issuecomment-5261501921) |
| Privacidade RPC | [eavscan.com/privacy#rpc](https://eavscan.com/privacy#rpc) |

## Pastas / arquivos

| Path | Papel |
|---|---|
| [`PLANO-PUBLICACAO.md`](./PLANO-PUBLICACAO.md) | Sequência oficial de publicação |
| [`TGE-COMUNICACAO.md`](./TGE-COMUNICACAO.md) | Copy PT/EN + riscos (post manual) |
| [`FASE3-AMM.md`](./FASE3-AMM.md) | Runbook seed AMM pós-finalize |
| [`chainlist/`](./chainlist/) | Pacote DefiLlama (RPC privacy) |
| `eip155-72020.json` | Registro EIP-155 (espelho) |
| `eav7-icon.json` | CID IPFS do ícone |
| `../../chain-registry/eip155-72020.json` | Espelho na raiz do repo |

## Observações técnicas

- `decimals: 18` no registro EVM (display MetaMask); on-chain EAV7 usa 6 (`EAVM_WEI_PER_E7` = 10¹²).
- Explorer EIP-3091: `/tx/…`, `/block/…`, `/address/…`.
- CoinMarketCap / CoinGecko só na **Fase 3**, depois de liquidez (Fase 2).
