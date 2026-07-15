# EAV7 — Referência da API

O nó EAV7 expõe três superfícies: **API HTTP** (:6070), **JSON-RPC EAVM** (:7070, compat.
MetaMask/Trust Wallet) e **P2P**. Esta referência cobre a API HTTP pública. Todas as respostas
são JSON; envie `Accept: application/json`. Valores monetários são strings de inteiros em `e7`
(1 EAV7 = 10¹² e7 — ver `CHAIN.UNIT`).

## SDK

A forma recomendada de integrar é o SDK (`src/sdk/eav7.js`):

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
| `/status` | Estado da cadeia: `height`, `finalizedHeight` (#2), `headHash`, `supply`, `minted`, `burned`, `validators`, `blockReward`, energia. |
| `/address/:end` | Conta (E7… ou 0x… EAVM): `balance`, `staked`, `nonce`, `nextNonce` (ciente do mempool), `energy`, `feeExempt`, `isValidator`, `tokens`. |
| `/address/:end/txs?limit&before` | Transações da carteira, mais novas primeiro (via índice por endereço). |
| `/chain?from&limit` | Faixa de blocos (limite `MAX_CHAIN_PAGE`). |
| `/block/:ref` | Bloco por altura ou hash. |
| `/tx/:id` | Transação por id (confirmada ou no mempool). |
| `/validators` | Conjunto ativo: `current` (top por peso = stake + votos, #4), `maxValidators`, `slotProducer`. |
| `/tokens` | Tokens EAV20 emitidos. |
| `/mempool` | Transações pendentes. |
| `/search?q=` | Busca por endereço/token/bloco/tx (índice por prefixo, #M2). |
| `/stats` | Agregados do explorer (cacheados por altura). |
| `/contract/:addr` | Metadados de verificação de um contrato EAVM (#8), ou 404. |
| `/bridge/transfers` | Transferências de ponte. |

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

`TRANSFER`, `STAKE`, `UNSTAKE`, `VOTE` (#4), `DELEGATE_RESOURCE`/`UNDELEGATE_RESOURCE` (#6),
`PERMISSION_UPDATE`/`MULTISIG_PROPOSE`/`MULTISIG_APPROVE` (#5), `TOKEN_CREATE`/`TOKEN_TRANSFER`/
`TOKEN_APPROVE`/`TOKEN_TRANSFER_FROM`, `AI_TASK`/`AI_RESULT`, `BRIDGE_OUT`/`BRIDGE_IN`/`BRIDGE_SETTLE`,
`EAVM_DEPLOY`/`EAVM_CALL`. Cada tx tem um `fee` (LIMITE de queima autorizado); a queima real vem
do modelo de recursos (energia + bandwidth), não vai ao produtor.

## Faucet (testnet)

Serviço separado (`bin/eav7-faucet.js`), habilitado só com `EAV7_FAUCET_ENABLED=1`:

```
POST /faucet  { "address": "E7…" }   →  { ok, amount, id }   (cooldown por endereço)
```
