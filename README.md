# EAV7 — blockchain com protocolo eav20

Blockchain própria inspirada na Tron, com consenso DPoS, tokenomics no padrão TRX,
padrão de token **EAV20** (equivalente ao TRC20) e **EAV721** (NFT, equivalente ao
TRC721), **segurança pós-quântica** com modelo de assinatura próprio, **camada nativa
de inteligência artificial**, **ponte cross-chain trustless** e **plataforma de
mineração** embutida.

Além do núcleo, a EAV7 traz uma camada L1 completa no estilo Tron: **finalidade BFT**,
**state root** (light clients e provas de conta), **votação de validadores** com
**recompensa de eleitores**, **permissões de conta / multisig**, **recursos** (energia
+ bandwidth com delegação), **governança on-chain** com **tesouraria** e **timelock**,
**vesting**, **meta-transações** (gasless) e um **serviço de nomes** (EAV-NS).

100% Node.js puro (>= 20) — **zero dependências externas**. Nada de `npm install`.

```bash
# stack local (nó JS + explorador Next) — ver docs/local.md
npm run dev:local

# ou só o nó minerador
node bin/eav7.js mine

# plataforma de mineração:  http://127.0.0.1:6070/app
# testes:                   npm test
# paridade API JS↔Rust:     npm run parity
# Core (Rust):              cd rust && cargo build -p eav7-core -p eav7-node
#                           ver docs/core.md
```

## Identidade da rede

| Item | Valor |
|---|---|
| Nome da blockchain | **EAV7** |
| Protocolo | **eav20** (v1) |
| Moeda nativa | **EAV7** — 6 decimais (1 EAV7 = 1.000.000 e7, como TRX/sun) |
| Hashes | `E7` + SHA3-256 — **64 caracteres** (mesmo comprimento do txid da Tron), toda hash da rede começa com `E7` |
| Carteiras | `E7` + 28 hex + 4 hex de checksum = **34 caracteres** (mesmo comprimento do endereço Tron), ex.: `E71E4C02FF5690D6118FA8E23331C9DA5A` |
| Token padrão | **EAV20**: create, transfer, approve, transferFrom, balanceOf, allowance + admin (mint, burn, pause, blacklist, freeze) |
| NFT | **EAV721**: create (coleção), mint, transfer, approve, burn — URI por token |
| Nomes | **EAV-NS**: nomes legíveis → endereço E7 (register, update, transfer, release) |

## Tokenomics (padrão Tron)

| Parâmetro | EAV7 | Referência Tron |
|---|---|---|
| Supply gênese | 100 bilhões de EAV7 | ~100 bi TRX |
| Recompensa por bloco | **16 EAV7** (produtor + eleitores + tesouraria) | 16 TRX por bloco |
| Halving | recompensa cai pela metade a cada ~4 anos | — |
| Tempo de bloco | **1s — 3x mais rápido** | 3s |
| Validadores ativos | até 27 (DPoS, eleitos por stake + votos) | 27 Super Representatives |
| Stake mínimo p/ minerar | 1.000 EAV7 | — |
| Unbonding do unstake | ~7 dias (fundos voltam após a janela) | freeze/unfreeze v2 |
| **Stake ≥ 100 EAV7 → taxa zero** | equivalente ao freeze/bandwidth | freeze TRX |
| Taxa de transferência (sem stake) | 0,01 EAV7 | — |
| Tesouraria | % governável da recompensa vai a um cofre on-chain | — |

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

- Contas com stake ≥ 1.000 EAV7 entram na eleição; as 27 de maior **peso** viram validadores.
- **Votação de validadores** (`VOTE`): detentores alocam poder de voto (= stake) a candidatos;
  o conjunto ativo é o top-27 por **peso = self-stake + votos recebidos**. Sem votos, degrada
  para top-por-stake (retrocompatível), como os 27 Super Representatives da Tron.
- Produção round-robin determinística por slot de 1s (`floor(timestamp/1000) % n`).
- Bloco assinado pelo produtor do slot (assinatura híbrida); produtor fora do slot é rejeitado.
- **Um bloco por slot** (`slotFor(block.timestamp) > slotFor(head.timestamp)`) — impede grinding de timestamp e inflação de recompensa.
- **Recompensa de eleitores**: o produtor fica com a **comissão** (`SET_COMMISSION`, padrão 20%);
  o resto da recompensa de bloco é partilhado entre quem votou nele, proporcional aos votos
  (acumulador O(1) por bloco; o eleitor resgata com `CLAIM_VOTER_REWARD`). Uma fração governável
  (`TREASURY_PCT`) pode ir à **tesouraria**.
- **Finalidade BFT**: um bloco é **final** quando ≥ 2/3+1 validadores distintos constroem em cima
  dele — um reorg nunca reverte abaixo do finalizado (`/status.finalizedHeight`).
- **State root**: cada header carrega o compromisso Merkle do estado após o bloco, verificado no
  `addBlock` — destrava light clients e provas de conta (ver abaixo).
- **Unbonding**: `UNSTAKE` remove voto/validação na hora, mas os fundos só voltam após ~7 dias —
  barra o ataque de sair-e-dumpar e o long-range. **Slashing** de assinatura dupla existe no
  protocolo (`SLASH_DOUBLE_SIGN`), desligado por ora (a finalidade BFT é a garantia primária).
- Fork choice: cadeia válida mais longa com a mesma gênese, **limitada pela finalidade** e por slots decorridos.

## Provas de estado e light clients

A partir do **state root** no header, o nó serve **provas de conta** (Merkle) em
`GET /proof/:endereço`: um cliente leve confere o saldo/nonce de uma conta contra o
`stateRoot` do bloco **sem baixar o estado inteiro** — a base para carteiras e pontes
que não confiam no nó, só na cadeia.

## Contas, permissões e multisig (estilo owner/active da Tron)

- `PERMISSION_UPDATE` transforma uma conta em **multisig**: define `{ threshold, keys{addr:peso} }`.
- A partir daí a conta só move fundos / altera permissão via **`MULTISIG_PROPOSE` + `MULTISIG_APPROVE`**
  (M-de-N); operações pendentes expiram por TTL. Cobre transfer, stake/unstake e token transfer.

## Recursos: energia e bandwidth (estilo Tron freeze v2)

- **Energia** paga a computação (transações e execução EAVM); **bandwidth** paga o tamanho em bytes.
- Cada conta tem uma cota **grátis** + bônus por **stake**, que **regenera** ao longo de ~24h.
- Faltando recurso, a transação **queima** EAV7 (deflacionário) proporcional ao déficit — o campo
  `fee` é o **limite** de queima autorizado (feeLimit, como na Tron).
- **Delegação** (`DELEGATE_RESOURCE` / `UNDELEGATE_RESOURCE`): ceder recurso a outra conta **sem
  perder poder de voto** — dApps patrocinam as taxas dos usuários.

## Governança on-chain, tesouraria e timelock

- `GOV_PROPOSE` propõe alterar um **parâmetro governável** (recompensa de bloco, stake mínimo,
  nº de validadores, `TREASURY_PCT`, …); validadores votam com `GOV_VOTE`.
- Ao atingir **2/3+1 dos validadores ativos**, o valor é sobrescrito on-chain — substitui o ajuste
  manual por SSH. Um **timelock** atrasa a aplicação (~11h), dando tempo de reação.
- A **tesouraria** acumula a fração `TREASURY_PCT` da recompensa; a governança a gasta por proposta.
- Trava anti-brick: uma mudança que esvaziaria o conjunto de validadores é revertida.

## Vesting e meta-transações

- **Vesting** (`VESTING_CREATE` / `VESTING_CLAIM`): trava fundos para um beneficiário com **cliff**
  e liberação **linear** — ideal para alocação de time/investidor que nasce vestida no gênese.
- **Meta-transações** (gasless): um relayer embrulha a tx **assinada** do usuário num `META_TX` e
  **paga a taxa**; o efeito roda como o usuário, com o nonce dele — onboarding sem o usuário ter EAV7.

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
| `AI_RESULT` | **só o oráculo designado** entrega o output; a **hash E7 do resultado** fica on-chain |
| `AI_REFUND` | solicitante reaver o escrow se a tarefa não for atendida até o prazo |

A liquidação depende da altura: no fluxo original a recompensa era paga na própria `AI_RESULT`;
a partir de `AI_CHALLENGE_HEIGHT` ela fica retida numa **janela de contestação** e só é paga por
`AI_CLAIM` (sem contestação) ou pelo veredito do júri.

Além desse fluxo base, o protocolo implementa mais quatro mecanismos de garantia, cada um
gated por altura de fork:

| Mecanismo | Transações | O que resolve |
|---|---|---|
| Responsabilização | (em `AI_REFUND`) | não-entrega penaliza o stake do oráculo e compensa o solicitante |
| Quórum commit-reveal | `AI_COMMIT`, `AI_REVEAL` | N oráculos independentes; ninguém copia a resposta do outro |
| Janela de desafio + júri | `AI_CLAIM`, `AI_CHALLENGE`, `AI_VERDICT` | resultado contestável com fiança; júri decide e o perdedor é slashado |
| Leilão de oráculos | `AI_BID`, `AI_AWARD` | tarefa aberta com orçamento, adjudicada por lance |

Resultados podem ainda ser entregues só como hash (+URI), mantendo o output off-chain, e
liquidados na hora mediante atestação assinada por um atestador registrado por governança.

O worker (`eav7 ai worker`) só processa tarefas designadas a ele; usa a API da
Anthropic quando `ANTHROPIC_API_KEY` está definida, ou um handler local.

## Ponte cross-chain trustless (interligação com outras blockchains)

Modelo lock-and-release genérico — qualquer cadeia (TRON, ETH, BTC, …) é plugada
por um `ChainAdapter` no relayer (`src/bridge/gateway.js`):

- `BRIDGE_OUT` — trava EAV7 (ou token EAV20) com cadeia + endereço de destino.
- `BRIDGE_IN` — libera fundos travados **mediante prova criptográfica** do evento de lock na
  cadeia de origem: um **comitê de origem** assina o evento e o `BRIDGE_IN` só credita com um
  **quórum de assinaturas** (M-de-N) verificado on-chain — não mais por confiança na identidade
  do relayer. Idempotência por `sourceTxHash` (sem replay).
- `BRIDGE_SETTLE` — marca a saída como paga on-chain (evita double-payout no reinício).
- **Rotação de comitê** (`BRIDGE_COMMITTEE_UPDATE`): o comitê de origem é rotacionado por
  **handoff assinado pelo comitê atual** — a confiança migra pela prova, não por um admin.

Evolução em relação ao modelo antigo (federação 1-de-N por identidade): o quórum M-de-N e a
exigência de prova de origem eliminam o ponto único de falha em que um relayer sozinho drenava
o pool. As alturas de fork correspondentes (`BRIDGE_QUORUM_HEIGHT`, `BRIDGE_PROOF_HEIGHT`)
nascem ativas no gênese-ativo.

## Plataforma de mineração

Servida pelo próprio nó em **`/app`**: estatísticas em tempo real, últimos blocos,
mineradores e stakes, alertas da sentinela, tokens EAV20, ponte e **gerador de
carteira pós-quântica**.

```bash
# nó semente
node bin/eav7.js mine --port 6070

# segundo minerador entrando na rede
node bin/eav7.js mine --port 6071 --peers http://127.0.0.1:6070
node bin/eav7.js stake --wallet data/node-6071/validator-wallet.json --amount 1000
```

Para financiar contas em testnet existe um serviço separado (`bin/eav7-faucet.js`), que só
sobe com `EAV7_FAUCET_ENABLED=1` e nunca deve ser exposto em mainnet — ver `docs/api.md`.

## CLI

```text
eav7 wallet new | wallet show <arquivo>
eav7 mine | node start [--port] [--peers] [--url] [--observer]
eav7 status | balance <E7...>
eav7 send --wallet w.json --to E7... --amount 12.5
eav7 stake|unstake --wallet w.json --amount 1000
eav7 token create|send|list|info
eav7 ai task|tasks|worker|sentinel
eav7 bridge out|transfers
eav7 eavm address <E7...>
```

## API REST do nó

Referência completa em [`docs/api.md`](docs/api.md). Resumo:

`GET /status` (com `finalizedHeight` e `treasury`) `· /block/:alturaOuHash · /chain · /tx/:id ·
/address/:E7 · /address/:E7/txs · /mempool · /validators · /tokens · /tokens/:id ·
/proof/:E7` (prova de conta contra o state root) `· /logs` (eventos EAVM) `· /name/:nome` (EAV-NS)
`· /contract/:addr` (verificação) `· /search · /stats · /ai/tasks · /ai/oracles ·
/bridge/transfers · /security/alerts · /peers` — e
`POST /tx · /eavm/tx · /blocks · /contract/:addr/verify · /peers · /security/alerts`.

Endpoints administrativos (`/peers`, `/security/alerts` em POST) exigem `x-admin-token`.

## Arquitetura

```
src/config.js          parâmetros do protocolo eav20 (tokenomics, taxas, tempos, alturas de fork)
src/crypto/hash.js     hash E7 (SHA3-256, 64 chars), JSON canônico, merkle
src/crypto/keys.js     modelo eav7-hybrid-1: secp256k1 + ML-DSA-44, endereços E7
src/core/transaction.js  55 tipos de transação assinados (dupla assinatura)
src/core/block.js      blocos assinados pelo produtor (+ state root) + bloco gênese
src/core/state.js      máquina de estado: contas, stakes, votos, tokens/NFT, nomes,
                       permissões, recursos, governança, tesouraria, vesting, IA, ponte
src/core/stateroot.js  compromisso Merkle do estado + provas de conta (light clients)
src/core/mempool.js    pool com seleção executável por nonce
src/core/blockstore.js blocos em disco + janela em RAM (boot por snapshot, reorg O(janela))
src/core/blockchain.js cadeia, validação DPoS, finalidade BFT, fork choice, persistência+replay
src/token/eav20.js     padrão de token EAV20 (+ admin: mint/burn/pause/blacklist/freeze)
src/ai/bridge.js       builders das transações de IA
src/ai/worker.js       oráculo de IA off-chain (Anthropic API ou local)
src/ai/sentinel.js     vigilância de segurança 24h por IA
src/bridge/gateway.js  relayer cross-chain com adapters plugáveis
src/bridge/proof.js    prova de comitê da ponte trustless (quórum M-de-N + rotação)
src/eavm/rpc.js        RPC compatível com MetaMask/Trust Wallet (Chain ID 72020)
src/node/{node,api,p2p}.js  nó completo: produção, REST, gossip e sync
src/sdk/eav7.js        SDK cliente (assina localmente, fala com a API)
bin/eav7.js            CLI
public/app.html        plataforma de mineração (dashboard web)
test/                  213 testes em 47 arquivos (node:test)
```

## Segurança e auditoria

O código passou por **auditorias adversariais multi-agente** (Claude Fable 5): vulnerabilidades
confirmadas — incluindo grinding de slot no consenso, replay e dreno da ponte, roubo de escrow
de IA, maleabilidade de hash de bloco e snapshot não autenticado — foram **corrigidas e cobertas
por testes de regressão**. O relatório completo, com correções e limitações residuais, está em
[`AUDITORIA.md`](AUDITORIA.md).

Já entregues em relação aos requisitos de mainnet: **descentralização da ponte** (quórum M-de-N +
provas de origem + rotação de comitê), **finalidade de consenso** (BFT determinística, com unbonding
e slashing no protocolo), **state root** (light clients / provas de conta) e **banco de dados
incremental** (blocos em disco + snapshot). Toda mudança de consenso é **gated por altura de fork**
(histórico grandfathered); `EAV7_GENESIS_ACTIVE=1` nasce com tudo ativo no bloco 0.

> **Status**: protótipo funcional com a camada L1 completa e correções de segurança aplicadas —
> pronto para testnet/demonstração. Antes de uma mainnet real ainda são desejáveis (ver
> `AUDITORIA.md`): ativação do **slashing** com evidência anti-equivocação endurecida, **verificação
> de resultado de IA**, **P2P autenticado**, otimização do estado O(1)/bloco (ver
> [`docs/scaling.md`](docs/scaling.md)) e **auditoria por firma externa independente**.
