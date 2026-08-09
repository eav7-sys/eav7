# O que já está de pé

Medido, não estimado.

## Camadas

| Camada | O que é | Linhas | Estado |
|---|---|---:|---|
| `eav7` | Consenso: hash, assinatura híbrida, estado, raiz de estado, armazenamento, EAVM | 36.885 | completa |
| `eav7-node` | Binário: API HTTP, P2P, RPC EAVM, produtor, camada de IA, guarda anti-abuso | 17.215 | completa |
| `eav7-sdk` | Carteira, montagem e assinatura de transação, cliente HTTP, relayer da ponte | 1.709 | completa |
| `eav7-wasm` | Criptografia da carteira no navegador, usando a MESMA implementação que o nó valida | 308 | completa |
| referência JS | Especificação executável; gera os vetores de conformidade | 10.649 | manter em passo |

**Total em Rust: 56.117 linhas.**

## Cobertura

| Suíte | Testes |
|---|---:|
| Rust (workspace inteiro) | 982 |
| JavaScript | 378 |
| Vetores de conformidade | 9 |

## Paridade de API

As 34 rotas existem nos dois clientes. Comparação feita extraindo os despachos de
`src/node/api.js` e as rotas registradas em `rust/node/src/api/*.rs`:

```
address  ai  app  assets  blocks  bridge  chain  contract  css  eavm
explorer  gateway  governance  guard  internal  js  logs  mempool  name
names  nfts  peers  proof  scan  search  security  stats  status  tokens
treasury  tx  txs  validators  wallet
```

## Forks definidos

20 alturas de ativação, das quais duas dormentes. As ativas relevantes:

| Fork | Altura |
|---|---:|
| `STRICT_PRODUCER_HEIGHT` | 49.500 |
| `BRIDGE_QUORUM_HEIGHT` | 1.000.000 |
| `CANONICAL_HASH_HEIGHT` | 1.000.000 |
| `STATEROOT_HEIGHT` | 1.200.000 |
| `BRIDGE_PROOF_HEIGHT` | 1.300.000 |
| `VOTING_HEIGHT` | 1.400.000 |
| `PERMISSIONS_HEIGHT` | 1.500.000 |
| `RESOURCE_HEIGHT` | 1.600.000 |
| `VESTING_HEIGHT` | 1.650.000 |
| `META_HEIGHT` | 1.680.000 |
| `GOVERNANCE_HEIGHT` / `TOKEN_ADMIN_HEIGHT` | 1.700.000 |
| `AI_ACCOUNTABILITY_HEIGHT` | 1.760.000 |
| `AI_QUORUM_HEIGHT` | 1.780.000 |
| `SLASHING_HEIGHT` / `AI_CHALLENGE_HEIGHT` | 1.800.000 |
| `AI_MARKET_HEIGHT` | 1.820.000 |
| `AI_PRIVATE_HEIGHT` | 1.840.000 |

Ver [rollout-forks.md](../rollout-forks.md) para o procedimento.

## Telas do explorador

Existem: `address` · `block` · `blocks` · `docs` · `governance` · `mining` ·
`names` · `nfts` · `search` · `token` · `tokens` · `tx` · `txs` · `validators` ·
`wallet`.

Componentes portados do desenho novo, em `web-next/src/components/scan/`:

```
header  home  latest  charts  stat-cards
lists/    blocks-list  txs-list  tokens-list  validators-list  table
detail/   address-view  block-view  tx-view  token-view
          address-holdings  csv-button  shell  tabs
```
