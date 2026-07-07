# EAV7 — blockchain com protocolo eav20

Blockchain própria inspirada na Tron, com consenso DPoS, tokenomics no padrão TRX,
padrão de token **EAV20** (equivalente ao TRC20), **segurança pós-quântica** com
modelo de assinatura próprio, **camada nativa de inteligência artificial**,
**ponte cross-chain** e **plataforma de mineração** embutida.

100% Node.js puro (>= 24) — **zero dependências externas**. Nada de `npm install`.

```bash
# subir um nó minerador (cria a carteira e a gênese sozinho)
node bin/eav7.js mine

# plataforma de mineração:  http://127.0.0.1:6070/app
# testes:                   npm test
```

## Identidade da rede

| Item | Valor |
|---|---|
| Nome da blockchain | **EAV7** |
| Protocolo | **eav20** (v1) |
| Moeda nativa | **EAV7** — 6 decimais (1 EAV7 = 1.000.000 e7, como TRX/sun) |
| Hashes | `E7` + SHA3-256 — **64 caracteres** (mesmo comprimento do txid da Tron), toda hash da rede começa com `E7` |
| Carteiras | `E7` + 28 hex + 4 hex de checksum = **34 caracteres** (mesmo comprimento do endereço Tron), ex.: `E71E4C02FF5690D6118FA8E23331C9DA5A` |
| Token padrão | **EAV20**: create, transfer, approve, transferFrom, balanceOf, allowance |

## Tokenomics (padrão Tron)

| Parâmetro | EAV7 | Referência Tron |
|---|---|---|
| Supply gênese | 100 bilhões de EAV7 | ~100 bi TRX |
| Recompensa por bloco | **16 EAV7 para o minerador** (+ taxas) | 16 TRX por bloco |
| Tempo de bloco | **1s — 3x mais rápido** | 3s |
| Validadores ativos | até 27 (DPoS, eleitos por stake) | 27 Super Representatives |
| Stake mínimo p/ minerar | 1.000 EAV7 | — |
| **Stake ≥ 100 EAV7 → taxa zero** | equivalente ao freeze/bandwidth | freeze TRX |
| Taxa de transferência (sem stake) | 0,01 EAV7 | — |

## Segurança pós-quântica — modelo próprio `eav7-hybrid-1`

Toda carteira, transação e bloco carrega **duas assinaturas**, e a verificação
exige as duas válidas:

1. **ECDSA secp256k1** — mesma curva da Tron/Bitcoin (maturidade)
2. **ML-DSA-44** — assinatura pós-quântica padronizada pelo NIST (FIPS 204)

O endereço `E7…` é derivado do SHA3-256 das **duas** chaves públicas: para forjar
uma transação seria preciso quebrar as duas primitivas ao mesmo tempo — inclusive
a resistente a computadores quânticos. O hashing (SHA3-256) também é considerado
seguro no cenário pós-quântico.

Complementando, a **sentinela de segurança 24h por IA** (`eav7 ai sentinel`)
monitora a rede continuamente: reorganizações/forks, transferências acima de 1%
do supply, rajadas de transações, concentração de produtores e flood de mempool.
Com `ANTHROPIC_API_KEY` definida, um analista LLM (Claude) emite pareceres
periódicos publicados em `GET /security/alerts` e no dashboard.

## Consenso — DPoS estilo Tron

- Contas com stake ≥ 1.000 EAV7 entram na eleição; as 27 maiores viram validadores.
- Produção round-robin determinística por slot de 1s (`floor(timestamp/1000) % n`).
- Bloco assinado pelo produtor do slot (assinatura híbrida); produtor fora do slot é rejeitado.
- **Um bloco por slot** (`slotFor(block.timestamp) > slotFor(head.timestamp)`) — impede grinding de timestamp e inflação de recompensa.
- Recompensa de 16 EAV7 + todas as taxas do bloco vão para o minerador.
- Fork choice: cadeia válida mais longa com a mesma gênese (limitada por slots decorridos).

## EAVM — carteiras universais (MetaMask / Trust Wallet)

O **EAVM** é o protocolo de contas externas próprio da EAV7 (o equivalente ao que a
TVM é para a Tron), implementado do zero neste projeto (keccak-256, secp256k1 com
ecrecover, RLP — sem nenhuma dependência). O nó expõe um **RPC** que a MetaMask e a
Trust Wallet entendem, permitindo adicionar a EAV7 como **rede customizada**:

```
Nome da rede : EAV7
URL do RPC   : http://SEU_IP:<porta+1000>   (ex.: 7070)
Chain ID     : 72020
Símbolo      : EAV7
```

Contas EAVM (`0x…`) são autenticadas por secp256k1 e mapeadas para endereços E7
determinísticos; transações da carteira viram `EAVM_TRANSFER` no protocolo eav20.
Contas nativas E7 mantêm a proteção pós-quântica total.

## Camada de inteligência artificial (nativa do protocolo)

Fluxo on-chain de tarefas de IA com escrow, **oráculo designado** e prova de resultado:

| Transação | Papel |
|---|---|
| `AI_TASK` | solicitante escrowa a recompensa, publica o prompt e **designa o oráculo** (`--oracle`) |
| `ORACLE_REGISTER` | operador stakea ≥ 500 EAV7 e vira oráculo de IA |
| `AI_RESULT` | **só o oráculo designado** entrega o output; a **hash E7 do resultado** fica on-chain e a recompensa é liberada |
| `AI_REFUND` | solicitante reaver o escrow se a tarefa não for atendida até o prazo |

O worker (`eav7 ai worker`) só processa tarefas designadas a ele; usa a API da
Anthropic quando `ANTHROPIC_API_KEY` está definida, ou um handler local.

## Ponte cross-chain (interligação com outras blockchains)

Modelo lock-and-release genérico — qualquer cadeia (TRON, ETH, BTC, …) é plugada
por um `ChainAdapter` no relayer (`src/bridge/gateway.js`):

- `BRIDGE_OUT` — trava EAV7 (ou token EAV20) com cadeia + endereço de destino.
- `BRIDGE_IN` — **relayer autorizado** (allowlist semeada na gênese) libera fundos
  travados, com **idempotência por `sourceTxHash`** (sem replay).
- `BRIDGE_SETTLE` — marca a saída como paga on-chain (evita double-payout no reinício).

## Plataforma de mineração

Servida pelo próprio nó em **`/app`**: estatísticas em tempo real, últimos blocos,
mineradores e stakes, alertas da sentinela, tokens EAV20, ponte, **gerador de
carteira pós-quântica** e **faucet de 2.000 EAV7** (propagação dos tokens).

```bash
# nó semente
node bin/eav7.js mine --port 6070

# segundo minerador entrando na rede
node bin/eav7.js mine --port 6071 --peers http://127.0.0.1:6070
node bin/eav7.js faucet <ENDEREÇO_DO_MINERADOR_2> --node http://127.0.0.1:6070
node bin/eav7.js stake --wallet data/node-6071/validator-wallet.json --amount 1000
```

## CLI

```text
eav7 wallet new | wallet show <arquivo>
eav7 mine | node start [--port] [--peers] [--observer] [--no-faucet]
eav7 status | balance <E7...> | faucet <E7...>
eav7 send --wallet w.json --to E7... --amount 12.5
eav7 stake|unstake --wallet w.json --amount 1000
eav7 token create|send|list|info
eav7 ai task|tasks|worker|sentinel
eav7 bridge out|transfers
```

## API REST do nó

`GET /status · /blocks · /blocks/:alturaOuHash · /chain · /tx/:id · /address/:E7 ·
/mempool · /validators · /tokens · /tokens/:id · /ai/tasks · /ai/oracles ·
/bridge/transfers · /security/alerts · /peers` — e
`POST /tx · /blocks · /peers · /wallet/new · /faucet · /security/alerts`.

## Arquitetura

```
src/config.js          parâmetros do protocolo eav20 (tokenomics, taxas, tempos)
src/crypto/hash.js     hash E7 (SHA3-256, 64 chars), JSON canônico, merkle
src/crypto/keys.js     modelo eav7-hybrid-1: secp256k1 + ML-DSA-44, endereços E7
src/core/transaction.js  12 tipos de transação assinados (dupla assinatura)
src/core/block.js      blocos assinados pelo produtor + bloco gênese
src/core/state.js      máquina de estado: contas, stakes, tokens, IA, ponte
src/core/mempool.js    pool com seleção executável por nonce
src/core/blockchain.js cadeia, validação DPoS, fork choice, persistência+replay
src/token/eav20.js     padrão de token EAV20
src/ai/bridge.js       builders das transações de IA
src/ai/worker.js       oráculo de IA off-chain (Anthropic API ou local)
src/ai/sentinel.js     vigilância de segurança 24h por IA
src/bridge/gateway.js  relayer cross-chain com adapters plugáveis
src/node/{node,api,p2p}.js  nó completo: produção, REST, gossip e sync
bin/eav7.js            CLI
public/app.html        plataforma de mineração (dashboard web)
test/                  15 testes (node:test)
```

## Segurança e auditoria

O código passou por uma **auditoria adversarial multi-agente** (Claude Fable 5):
21 vulnerabilidades confirmadas — incluindo grinding de slot no consenso, replay e
dreno da ponte, e roubo de escrow de IA — foram **corrigidas e cobertas por testes
de regressão**. O relatório completo, com correções e limitações residuais, está em
[`AUDITORIA.md`](AUDITORIA.md).

> **Status**: protótipo funcional com correções de segurança aplicadas — pronto para
> testnet/demonstração. Antes de uma mainnet real ainda são necessários (ver
> `AUDITORIA.md`): descentralização da ponte (quórum M-de-N + provas de origem),
> finalidade de consenso com slashing, verificação de resultado de IA, banco de dados
> incremental, P2P autenticado e **auditoria por firma externa independente**.
