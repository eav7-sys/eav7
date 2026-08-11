# EAV7 — Referência da API

O nó EAV7 expõe três superfícies: **API HTTP** (:6070), **JSON-RPC EAVM** (:7070, compat.
MetaMask/Trust Wallet) e **P2P**. Esta referência cobre a API HTTP pública. Todas as respostas
são JSON; envie `Accept: application/json`. Valores monetários são strings de inteiros em `e7`
(1 EAV7 = 10⁶ e7 — ver `CHAIN.UNIT`). Não confundir com `CHAIN.EAVM_WEI_PER_E7` = 10¹², o fator
de conversão usado só na superfície EAVM, onde as carteiras assumem 18 decimais.

## SDK

A forma recomendada de integrar é o SDK Rust (`eav7-sdk`):

```js
import { Eav7Client, generateKeyPair } from 'eav7/sdk';
const client = new Eav7Client({ url: 'https://eavscan.com', wallet });
await client.status();
await client.balance();                       // saldo da carteira do client
await client.transfer(destinoE7, 5n * client.UNIT);
await client.stake(1000n * client.UNIT);
await client.vote({ [candidatoE7]: (500n * client.UNIT).toString() });
await client.delegate(usuarioE7, 100n * client.UNIT);   // patrocina recurso (#6)
```

Métodos `build*` (ex.: `client.buildTransfer(to, amount, nonce)`) montam e **assinam localmente**
sem tocar a rede — úteis para assinar offline, testar e enfileirar.

## Endpoints de leitura (GET)

| Rota | Descrição |
|------|-----------|
| `/` | Índice JSON da API (`Accept: application/json`): `chain` (= `CHAIN.NAME`), `protocol`, `miningPlatform` (`/mining`), lista `endpoints`. HTML na raiz vai ao Next. |
| `/status` | Estado da cadeia: `height`, `finalizedHeight` (#2), `headHash`, `supply`, `minted`, `burned`, `treasury`, `validators`, `blockReward`, energia. |
| `/proof/:end` | **Prova de conta** (Merkle) contra o `stateRoot` (#1) — light client confere saldo/nonce sem baixar o estado. |
| `/address/:end` | Conta (E7… ou 0x… EAVM): `balance`, `staked`, `nonce`, `nextNonce` (ciente do mempool), `energy`/`bandwidth` (legado), **`gb`** `{max,available,used,unit}`, `feeExempt`, `isValidator`, `tokens`. |
| `/address/:end/txs?limit&before` | Transações da carteira, mais novas primeiro (via índice por endereço). |
| `/address/:end/analysis` | Agregados da conta (gráficos): `txCount`, `sent`/`received`, `byType`, etc. |
| `/chain?from&limit` | Faixa de blocos (limite `MAX_CHAIN_PAGE`). |
| `/blocks?limit&from` | Lista de blocos (paginação). |
| `/blocks/latest` | Cabeça da cadeia. |
| `/blocks/:ref` | Bloco por altura ou hash. Cada bloco inclui `size` — comprimento em bytes do JSON UTF-8 da linha do bloco (igual nos dois clientes). |
| `/txs?limit` | Feed global de transações (índice esparso). |
| `/tx/:id` | Transação por id (confirmada ou no mempool). |
| `/validators` | Conjunto ativo `current` (top por peso = stake + votos) + standby `bank` / `bankSize`; `maxValidators`, `slotProducer`, `performance`. |
| `/tokens` | Tokens EAV20 emitidos. |
| `/tokens/:id` | Detalhe de um token. |
| `/tokens/:id/holders` | Holders (paginado). |
| `/tokens/:id/transfers?limit&before` | Transferências do token (cursor `before`; teto de varredura). |
| `/nfts` · `/nfts/:id` | Coleções / item EAV721. |
| `/names` | Lista de nomes EAV-NS registrados. |
| `/mempool` | Transações pendentes. |
| `/search?q=` | Busca por endereço/token/bloco/tx (índice por prefixo, #M2). |
| `/stats` | Agregados do explorer (cache por altura): `accounts`, `staked`, `transactions`, `volume24h` (e7 string), `txCount24h`, **`tps`** (tx/s na janela varrida), `txSeries`, `volSeries`. |
| `/governance` · `/governance/proposals` · `/treasury` | Governança on-chain e tesouraria. |
| `/contract/:addr` | Metadados de verificação de um contrato EAVM (#8), ou 404. |
| `/logs` | Eventos EAVM recentes (índice node-local, ring buffer). |
| `/name/:nome` | Resolução do serviço de nomes EAV-NS → endereço E7, ou 404. |
| `/ai/tasks` · `/ai/oracles` | Oráculos de IA. |
| `/bridge/transfers` · `/bridge/transfers/:id` | Transferências de ponte. |
| `/gateway` · `/guard` | Observabilidade de gateway / auto-mitigação (JSON). |

## Endpoints de escrita (POST)

| Rota | Corpo | Descrição |
|------|-------|-----------|
| `/tx` | transação assinada | Submete uma tx do esquema híbrido (use o SDK ou `buildTransaction`). |
| `/eavm/tx` | envelope EAVM | Submete uma tx do esquema EAVM (raw secp256k1). |
| `/blocks` | bloco | Recebe um bloco (gossip P2P). |
| `/contract/:addr/verify` | `{ source, language, compiler, bytecode }` | Verifica um contrato: o `bytecode` deve bater com o código on-chain; guarda o `source` (#8). |

Endpoints administrativos (`/peers`, `/security/alerts`) exigem o header `x-admin-token`
(`EAV7_ADMIN_TOKEN`); ficam desabilitados sem token configurado.

## Tipos de transação

Os 55 tipos do protocolo (`TX_TYPES = Object.keys(CHAIN.FEES)`):

| Grupo | Tipos |
|-------|-------|
| Nativo | `TRANSFER`, `STAKE`, `UNSTAKE` (unbonding), `EAVM_TRANSFER` |
| Consenso / votação (#4) | `VOTE`, `SET_COMMISSION`, `CLAIM_VOTER_REWARD`, `SLASH_DOUBLE_SIGN` |
| Recursos (#6) | `DELEGATE_RESOURCE`, `UNDELEGATE_RESOURCE` |
| Permissões / multisig (#5) | `PERMISSION_UPDATE`, `MULTISIG_PROPOSE`, `MULTISIG_APPROVE` |
| Governança (#9) | `GOV_PROPOSE`, `GOV_VOTE` |
| Vesting / meta-tx | `VESTING_CREATE`, `VESTING_CLAIM`, `META_TX` |
| Token EAV20 | `TOKEN_CREATE`, `TOKEN_TRANSFER`, `TOKEN_APPROVE`, `TOKEN_TRANSFER_FROM`, `TOKEN_MINT`, `TOKEN_BURN`, `TOKEN_PAUSE`, `TOKEN_UNPAUSE`, `TOKEN_BLACKLIST`, `TOKEN_FREEZE`, `TOKEN_UNFREEZE` |
| NFT EAV721 | `NFT_CREATE`, `NFT_MINT`, `NFT_TRANSFER`, `NFT_APPROVE`, `NFT_BURN` |
| Nomes (EAV-NS) | `NAME_REGISTER`, `NAME_UPDATE`, `NAME_TRANSFER`, `NAME_RELEASE` |
| IA — base | `ORACLE_REGISTER`, `AI_TASK`, `AI_RESULT`, `AI_REFUND` |
| IA — quórum commit-reveal | `AI_COMMIT`, `AI_REVEAL` |
| IA — janela de desafio | `AI_CLAIM`, `AI_CHALLENGE`, `AI_VERDICT` |
| IA — leilão de oráculos | `AI_BID`, `AI_AWARD` |
| Ponte (#3) | `BRIDGE_OUT`, `BRIDGE_IN`, `BRIDGE_SETTLE`, `BRIDGE_COMMITTEE_UPDATE` |
| EAVM (contratos) | `EAVM_DEPLOY`, `EAVM_CALL` — **pagáveis** a partir de `EAVM_VALUE_HEIGHT` |

Cada tx tem um `fee` (LIMITE de queima autorizado); a queima real vem do modelo de recursos
e **não vai ao produtor**. Abaixo de `GB_FEE_HEIGHT`: energia + bandwidth. A partir do fork
(na gênese de entrega = 0): **GB · Assinatura Livre** — bytes ponderados (tamanho útil × fator
do tipo; assinaturas fora do consumo); shortfall × `BURN_PER_BYTE`. Se a queima apurada
**excede** o `fee`, a execução rejeita com mensagem do tipo
`GB insuficiente e limite de taxa excedido — faça stake ou aumente o limite`
(ou o análogo energia/bandwidth pré-fork). Assinar um `fee` alto **não** acelera a inclusão
no mempool. Mudanças de consenso são **gated por altura de fork** (ver `CHAIN.FORK_HEIGHTS`);
o flip `GENESIS_ACTIVE` / heights 0 é feito **só no servidor de entrega**, não no dev local.

## Faucet

Não faz parte do runtime de produção. Use transferências na testnet local.

## Transferências internas (Fase 2.3)

A partir de `CHAIN.EAVM_VALUE_HEIGHT` os contratos EAVM são **pagáveis** sobre um
**ledger unificado**: o saldo do mundo `0x` É o da conta nativa correspondente
(`decodeE7Dest ?? eavmToE7`), então o valor entra, circula e sai sem ficar preso — a
correção estrutural do achado A-3, em que a ponte de valor era unidirecional.

Valor movido *pela execução* de um contrato não é uma transação assinada e não tem hash
próprio. É indexado como **transferência interna**, num índice node-local derivável, fora
do consenso e do stateRoot — mesma natureza de `/logs`.

```http
GET /internal?address=E7…|0x…&from=<altura>&limit=100
→ { internal: [ { txId, kind, from, to, fromE7, toE7, amount, blockHeight } ] }
```

`from`/`to` são endereços do mundo `0x`; `fromE7`/`toE7` são as contas nativas
correspondentes. Só execuções bem-sucedidas emitem — uma chamada revertida não deixa
registro, e o valor volta ao remetente.

```http
GET /address/:endereco/analysis
→ { txCount, truncated, firstSeen, lastSeen, sent, received, feesPaid,
    byType, topCounterparties, daily }
```

Agregados da conta para gráficos (varredura limitada às transações mais recentes).
