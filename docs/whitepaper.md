# EAV7 — Uma Blockchain de Camada 1 com Segurança Pós-Quântica e Camada Nativa de Inteligência Artificial

**Whitepaper Técnico · Versão 1.0 · 19 de julho de 2026**

Protocolo `eav20` · Símbolo `EAV7` · EAVM Chain ID `72020`

---

> **Aviso preliminar.** Este documento descreve um protocolo em estágio pré-lançamento. A Seção 13 (Estado de Maturidade) distingue explicitamente o que está implementado e testado, o que está implementado mas inativo, e o que é roadmap. A Seção 14 (Fatores de Risco) e a Seção 15 (Aviso Legal) são partes integrantes deste documento e não devem ser lidas isoladamente. Nenhuma parte deste whitepaper constitui oferta, recomendação de investimento ou garantia de resultado.

---

## Sumário

1. [Resumo Executivo](#1-resumo-executivo)
2. [Motivação e Posicionamento](#2-motivação-e-posicionamento)
3. [Visão Geral da Arquitetura](#3-visão-geral-da-arquitetura)
4. [Consenso](#4-consenso)
5. [Criptografia e Modelo Pós-Quântico](#5-criptografia-e-modelo-pós-quântico)
6. [Estrutura de Dados e Compromisso de Estado](#6-estrutura-de-dados-e-compromisso-de-estado)
7. [Modelo de Recursos e Taxas](#7-modelo-de-recursos-e-taxas)
8. [Staking, Validação e Governança](#8-staking-validação-e-governança)
9. [EAVM — Máquina Virtual e Compatibilidade de Carteiras](#9-eavm--máquina-virtual-e-compatibilidade-de-carteiras)
10. [Camada Nativa de Inteligência Artificial](#10-camada-nativa-de-inteligência-artificial)
11. [Ponte Cross-Chain](#11-ponte-cross-chain)
12. [Tokenomics](#12-tokenomics)
13. [Estado de Maturidade](#13-estado-de-maturidade)
14. [Fatores de Risco](#14-fatores-de-risco)
15. [Aviso Legal](#15-aviso-legal)
16. [Apêndice A — Parâmetros de Consenso](#apêndice-a--parâmetros-de-consenso)

---

## 1. Resumo Executivo

A EAV7 é uma blockchain de camada 1 (L1) construída do zero em JavaScript puro, sem dependências externas, que combina três decisões de projeto pouco usuais quando tomadas em conjunto:

**Assinatura híbrida pós-quântica obrigatória.** Toda carteira, transação e bloco carrega **duas** assinaturas independentes — ECDSA sobre secp256k1 e ML-DSA-44 (NIST FIPS 204) — e ambas precisam verificar para que o objeto seja aceito. Não é um modo opcional nem uma migração futura: é o único esquema que o protocolo conhece, chamado `eav7-hybrid-1`. Um adversário com computador quântico criptograficamente relevante que quebre a curva elíptica ainda enfrenta o reticulado; um adversário que encontre uma falha estrutural no ML-DSA ainda enfrenta a curva.

**Camada de IA como primitiva de consenso, não como narrativa.** A EAV7 define tipos de transação nativos para contratar, entregar, contestar e liquidar trabalho de inteligência artificial, com escrow on-chain, reputação de oráculo, quórum por commit-reveal, janela de contestação otimista com júri, leilão reverso de oráculos e liquidação imediata mediante atestação criptográfica. Igualmente importante é o que a IA **não** pode fazer: nenhum componente de IA da EAV7 tem poder vinculante sobre consenso, conjunto de validadores, stake ou código. Essa fronteira é arquitetural e verificável no código.

**Economia deflacionária com emissão mínima.** Cem bilhões de EAV7 no gênese, blocos de um segundo, 16 EAV7 de recompensa por bloco com halving a cada ~4 anos. A emissão do primeiro ano equivale a **0,50%** do supply de gênese, e a emissão total ao longo de todos os halvings soma 4.036.608.000 EAV7 — cerca de 4,04% adicionais. Em contrapartida, **100% das taxas de transação são queimadas**: não vão para o validador, não vão para a tesouraria. Sob uso relevante, a rede é estruturalmente deflacionária.

Sobre essa base a EAV7 entrega o conjunto de funcionalidades que se espera de uma L1 madura: DPoS com finalidade BFT, votação em validadores com recompensa a eleitores, permissões multi-assinatura por conta, modelo de recursos energia/largura de banda com delegação, governança on-chain com timelock, vesting, meta-transações sem gás, padrões de token EAV20 e EAV721, serviço de nomes e uma máquina virtual própria (EAVM) que fala o dialeto JSON-RPC compreendido pelas carteiras do ecossistema Ethereum.

---

## 2. Motivação e Posicionamento

### 2.1 O problema da colheita antecipada

A ameaça quântica à criptografia de curva elíptica não é simétrica no tempo. Um adversário pode capturar hoje o tráfego e o histórico público de uma blockchain e decifrá-lo anos depois, quando o hardware existir — a estratégia conhecida como *harvest now, decrypt later*. Para uma blockchain isso é particularmente grave: chaves públicas ficam permanentemente expostas no histórico assim que uma conta transaciona, e o registro é imutável e público por construção.

O NIST padronizou ML-DSA em agosto de 2024 (FIPS 204). A resposta da maioria das redes existentes tem sido postergar: a migração de um esquema de assinatura em uma cadeia com valor econômico significativo é uma das operações mais arriscadas que existem, porque exige coordenação de todo o ecossistema de carteiras, exchanges e contratos. A EAV7 parte do princípio de que **é infinitamente mais barato nascer híbrido do que migrar depois**, e aceita o custo — assinaturas maiores, verificação mais cara — como preço de entrada.

### 2.2 Por que uma camada de IA nativa

Serviços de inferência de IA são hoje consumidos por APIs centralizadas, com três propriedades ruins para aplicações on-chain: o resultado não é verificável, o pagamento não é atômico com a entrega, e o provedor não tem nada em risco se mentir ou não entregar.

A EAV7 trata a inferência como um mercado de oráculos com garantias econômicas explícitas. Um solicitante deposita a recompensa em escrow no momento em que cria a tarefa. O oráculo tem stake em risco. A entrega pode ser validada por concordância de múltiplos oráculos independentes (commit-reveal), por ausência de contestação em uma janela (verificação otimista com júri e fiança), ou por assinatura de um atestador registrado — e neste último caso liquida imediatamente, sem depender de reputação.

### 2.3 Herança de projeto: TRON

O modelo econômico e de recursos da EAV7 é declaradamente inspirado na TRON: mesmo supply de gênese (100 bilhões), modelo de recursos energia + largura de banda em vez de mercado de gás, DPoS com rodízio determinístico, padrões de token análogos. A EAV7 diverge em pontos deliberados: blocos de 1 segundo (contra 3 da TRON), 27 slots de validador, assinatura híbrida pós-quântica, camada de IA nativa e **queima integral das taxas**.

---

## 3. Visão Geral da Arquitetura

A EAV7 é um nó monolítico em Node.js (≥ 20), **sem nenhuma dependência externa de tempo de execução** — toda a criptografia de consenso vem de `node:crypto`, e keccak-256, RLP, secp256k1 e RIPEMD-160 usados pela EAVM são implementados do zero no repositório. O núcleo do protocolo tem cerca de 9.100 linhas de JavaScript.

Um nó expõe três superfícies:

| Superfície | Porta padrão | Função |
|---|---|---|
| API REST | 6070 | Consulta de estado, submissão de transações, endpoints administrativos |
| JSON-RPC EAVM | 7070 | Dialeto compatível com carteiras do ecossistema Ethereum |
| P2P | HTTP | Gossip de blocos e transações, sincronização |

O P2P trafega sobre HTTP simples com apenas três mensagens: `POST /tx` (gossip de transação), `POST /blocks` (gossip de bloco) e `GET /chain?from=&limit=` (sincronização por faixa). A descoberta de pares é por registro mútuo autenticado por token administrativo; a topologia legítima é semeada por `--peers`.

---

## 4. Consenso

### 4.1 DPoS com rodízio determinístico por slot

O tempo é dividido em slots de `BLOCK_TIME_MS` = 1.000 ms. O slot de um instante é `floor(timestamp / 1000)`, e o produtor esperado daquele slot é

```
validators[ slot mod N ]
```

onde `validators` é o conjunto ativo ordenado. Não há sorteio, VRF ou leilão: dado o relógio e o conjunto de validadores, o produtor de qualquer slot é uma função pura e universalmente computável.

O conjunto ativo é derivado do estado a cada bloco: contas com `staked ≥ MIN_VALIDATOR_STAKE` (1.000 EAV7), ordenadas por **peso = stake próprio + votos recebidos** em ordem decrescente, desempate por endereço ascendente, truncado em `MAX_VALIDATORS` (27). Contas gerenciadas pela EAVM são excluídas por construção, pois não possuem par de chaves híbrido e portanto não conseguem assinar blocos.

### 4.2 Regras de admissão de bloco

Um bloco é aceito somente se satisfizer, em ordem:

1. Integridade criptográfica (ambas as assinaturas verificam, hash confere).
2. `height == head.height + 1` e `previousHash == head.hash`.
3. `timestamp > head.timestamp`.
4. **Um bloco por slot**: `slot(bloco) > slot(head)`. Esta regra elimina o *slot grinding* — a tentativa de produzir múltiplos candidatos no mesmo slot para escolher o mais favorável.
5. `txCount ≤ MAX_TXS_PER_BLOCK` (500).
6. Slot não pertencente ao futuro além de `SLOT_FUTURE_TOLERANCE_MS` (400 ms) e deriva de relógio dentro de `MAX_CLOCK_DRIFT_MS` (2.000 ms).
7. Acima de `STRICT_PRODUCER_HEIGHT`, o produtor deve ser **exatamente** o produtor esperado do slot.
8. Acima de `STATEROOT_HEIGHT`, a raiz de estado recomputada deve bater com a declarada no cabeçalho.

A transição de estado é sempre simulada sobre um clone antes de ser comprometida, e a gravação em disco precede a mutação em memória.

### 4.3 Regra de escolha de cadeia e finalidade BFT

A regra base é **cadeia mais longa**, restringida por dois pisos de finalidade.

O piso dinâmico é derivado dos próprios produtores já presentes na cadeia: um bloco é considerado **final** quando pelo menos `floor(2N/3) + 1` validadores **distintos** produziram blocos acima dele. Não existe subprotocolo de votação, mensagem de *precommit* ou rodada de consenso separada — a finalidade é lida da história. Reorganizações que tentem reverter altura finalizada são rejeitadas.

A finalidade é desativada (`-1`) quando o conjunto ativo tem menos de `FINALITY_MIN_VALIDATORS` = 3 validadores, pois abaixo disso o quórum de 2/3 não oferece garantia significativa.

A profundidade de reorganização é adicionalmente limitada pela janela `REORG_WINDOW` = 5.000 blocos.

### 4.4 Armazenamento e recuperação

Blocos são persistidos em `blocks.jsonl`, um arquivo append-only com um objeto JSON por linha, indexado em memória por `offsets[altura] = [byteOffset, tamanho]` — acesso aleatório em O(1) por leitura posicionada, sem carregar a cadeia inteira. Uma janela dos blocos recentes (`REORG_WINDOW + 100` = 5.100) permanece em RAM; blocos que saem da janela avançam um estado-base por reaplicação.

Snapshots do estado completo são gravados a cada 5.000 blocos e podem ser autenticados com HMAC-SHA256 caso `EAV7_SNAPSHOT_KEY` esteja configurada — mitigação para o vetor em que um adversário com escrita no diretório de dados injeta saldos ou validadores num snapshot que o nó carregaria confiando. A revivificação do snapshot rejeita as chaves `__proto__`, `constructor` e `prototype` campo a campo.

Escrita parcial (*torn write*) na última linha do arquivo é detectada e truncada no boot. Blocos inválidos ao final do arquivo são descartados e o nó ressincroniza pela rede.

---

## 5. Criptografia e Modelo Pós-Quântico

### 5.1 O esquema `eav7-hybrid-1`

| Componente | Primitiva | Padrão |
|---|---|---|
| Assinatura clássica | ECDSA sobre secp256k1, digest SHA-256 | SEC 2 / FIPS 186 |
| Assinatura pós-quântica | ML-DSA-44 (Dilithium), sem pré-hash | NIST FIPS 204 |
| Função de hash | SHA3-256 truncada em 248 bits | NIST FIPS 202 |

A verificação é uma conjunção estrita: **ambas** as assinaturas devem ser válidas. Um objeto com apenas uma assinatura correta é rejeitado exatamente como um objeto sem assinatura alguma. Chaves trafegam em PEM (privada PKCS#8, pública SPKI) e assinaturas em base64.

O custo dessa escolha é explícito e assumido: a assinatura ML-DSA-44 é substancialmente maior que a ECDSA, o que motivou dimensionar a largura de banda gratuita por conta em 8.000 bytes — o suficiente para cobrir aproximadamente uma transação híbrida.

### 5.2 Formato de hash e endereço

Todo hash da EAV7 tem 64 caracteres: o prefixo literal `E7` seguido de 62 caracteres hexadecimais maiúsculos, correspondentes aos 248 bits mais significativos do SHA3-256. O prefixo é uma marca de identidade do protocolo, não entropia.

Endereços têm 34 caracteres: `E7` + 28 hexadecimais + 4 hexadecimais de checksum.

```
corpo     = SHA3-256( DER(chave_secp256k1) ‖ DER(chave_mldsa) )[0:14]   → 28 hex
checksum  = SHA3-256( "EAV7-ADDR:" ‖ corpo )[0:2]                       → 4 hex
endereço  = "E7" ‖ corpo ‖ checksum
```

O endereço deriva de **ambas** as chaves públicas concatenadas, o que amarra a identidade da conta ao par híbrido completo.

> **Limitação declarada.** O corpo do endereço tem 14 bytes = **112 bits**. A resistência a colisão de aniversário é, portanto, da ordem de 2⁵⁶ operações — abaixo do padrão de 2⁸⁰ considerado confortável hoje. Isto está registrado como achado residual na auditoria interna do projeto, com a observação de que alterá-lo quebra todos os endereços já emitidos. Ver Seção 14.

### 5.3 Separação de domínio

Digests de propósito específico são separados por prefixo de domínio e pelo separador `\x1f` (ASCII *unit separator*), impedindo que uma assinatura colhida em um contexto seja replayada em outro:

- `EAV7-BRIDGE-IN` — liberação de ativo da ponte
- `EAV7-BRIDGE-COMMITTEE` — rotação de comitê da ponte
- `EAV7-AI-ATTEST` — atestação de resultado de IA
- `EAV7-ADDR:` — checksum de endereço

---

## 6. Estrutura de Dados e Compromisso de Estado

### 6.1 Cabeçalho de bloco

O núcleo assinado do bloco contém: `protocol`, `version`, `scheme`, `height`, `timestamp`, `previousHash`, `txRoot`, `txCount`, `producer`, `publicKey`, `pqPublicKey` e — acima de `STATEROOT_HEIGHT` — `stateRoot`. Ficam fora do núcleo: `signature`, `pqSignature`, `hash` e `transactions`.

Acima de `CANONICAL_HASH_HEIGHT`, o hash do bloco é calculado **somente sobre o payload**, excluindo as assinaturas. Isso torna o identificador imune à maleabilidade de assinatura ECDSA, na qual um adversário reescreve `s` para `n − s` produzindo uma assinatura igualmente válida e portanto um identificador diferente para o mesmo bloco.

### 6.2 Transações

Uma transação carrega `protocol`, `scheme`, `type`, `from`, `to`, `amount`, `fee`, `nonce`, `timestamp`, `data`, as duas chaves públicas e as duas assinaturas. O identificador é derivado **exclusivamente do payload canônico assinado**, nunca dos bytes de assinatura — mesma defesa anti-maleabilidade aplicada ao bloco.

O campo `fee` é um **limite de taxa** (teto de queima autorizado pelo remetente), não um pagamento, seguindo a semântica de *feeLimit* da TRON. O nonce deve ser exatamente o corrente + 1.

O protocolo define **55 tipos de transação**, cobrindo transferência, staking, votação, permissões, tokens EAV20, NFTs EAV721, serviço de nomes, governança, tesouraria, vesting, meta-transações, EAVM, ponte e a camada de IA.

### 6.3 Modelo de estado e raiz de estado

O modelo é de contas (não UTXO), com valores monetários em `BigInt` na menor unidade, chamada **e7** (1 EAV7 = 10⁶ e7). O estado é particionado em domínios: contas, tokens, NFTs, nomes, contratos, oráculos, atestadores de IA, tarefas de IA, votos, permissões, delegações, propostas de governança, tesouraria, slashing, unbonding, vesting, comissões e ponte.

A raiz de estado é uma **árvore de Merkle de folhas ordenadas** — explicitamente **não** uma Merkle-Patricia Trie:

```
folha = H( domínio ‖ \x1f ‖ chave ‖ \x1f ‖ serialização_canônica(valor) )
raiz  = merkleRoot( sort(folhas) )
```

A serialização canônica ordena chaves de objeto recursivamente, codifica `BigInt` como `'B' + decimal` e descarta `undefined`, garantindo determinismo entre implementações.

Isso habilita **provas de inclusão de conta** para clientes leves: um cliente que conheça apenas a raiz de estado do cabeçalho pode verificar o saldo de uma conta a partir de um caminho de Merkle, sem confiar no nó que serviu a resposta.

> **Limitação de escala declarada.** A raiz é recomputada sobre o estado **inteiro** a cada bloco — custo O(|estado|) por bloco. Uma estrutura incremental (árvore persistente ou MPT) é trabalho reconhecido como necessário antes que a cadeia atinja tamanho de estado relevante. Ver Seção 13.

---

## 7. Modelo de Recursos e Taxas

A EAV7 **não tem mercado de gás**. Não há preço de gás, leilão de prioridade nem gorjeta ao produtor. O modelo é de recursos regenerativos com queima como mecanismo de excedente.

### 7.1 Energia e largura de banda

| Recurso | Grátis por conta | Por EAV7 em stake | Regeneração | Queima do excedente |
|---|---|---|---|---|
| Energia | 10 | +1 | 86.400 blocos (~24 h) | 20.000 e7 (0,02 EAV7) por unidade |
| Largura de banda | 8.000 bytes | +256 bytes | 86.400 blocos (~24 h) | 5 e7 por byte |

A regeneração é linear e calculada de forma preguiçosa, sem varredura de contas. Energia é consumida por tipo de transação (uma transferência custa 1; criar token ou NFT custa 10); largura de banda é consumida pelo tamanho serializado da transação.

A taxa efetiva é o déficit convertido em queima:

```
taxa = déficit_energia × 20.000 e7  +  déficit_bytes × 5 e7
```

Se essa taxa exceder o `feeLimit` declarado, a transação falha. **Uma conta com recursos suficientes paga taxa zero** — é assim que a promessa de "stake ≥ 100 EAV7 zera taxas de transferência" se realiza: 100 EAV7 em stake concedem 100 unidades de energia, muito acima do custo 1 de uma transferência.

Recursos podem ser **delegados** a terceiros (`DELEGATE_RESOURCE` / `UNDELEGATE_RESOURCE`) sem transferir poder de voto — permitindo que um aplicativo patrocine os recursos de seus usuários.

### 7.2 Queima integral das taxas

**Toda taxa cobrada é queimada.** O validador produtor não recebe nenhuma fração das taxas; sua receita é exclusivamente a recompensa de bloco. Essa é uma escolha econômica deliberada com três consequências:

1. **Pressão deflacionária proporcional ao uso.** Quanto mais a rede é usada, mais supply é destruído.
2. **Eliminação de incentivo a censura por taxa.** Como o produtor não lucra com a taxa, não há incentivo para ordenar ou censurar transações com base nela.
3. **Ausência de mercado de MEV por gorjeta.** Não existe canal de pagamento de prioridade ao produtor dentro do protocolo.

Além das taxas, são queimados: 90% das penalidades de slashing (10% vão ao denunciante) e o custo de registro de nomes no EAV-NS.

---

## 8. Staking, Validação e Governança

### 8.1 Stake e unbonding

Fazer stake move saldo de `balance` para `staked`, o que simultaneamente concede elegibilidade a validador, poder de voto, capacidade de energia e largura de banda, e isenção prática de taxas.

O `UNSTAKE` remove o stake **imediatamente** — o poder de voto e a posição de validador são perdidos no ato — mas os fundos entram em fila de *unbonding* por `UNBONDING_BLOCKS` = 604.800 blocos (**≈ 7 dias**), sendo creditados de volta pelo processamento determinístico de cada bloco.

Três travas protegem a integridade da rede: não é possível fazer unstake abaixo do total votado, nem abaixo do delegado a terceiros, nem **esvaziar o conjunto de validadores** — a última posição ativa não pode ser removida.

### 8.2 Votação e recompensa a eleitores

Detentores de EAV7 alocam poder de voto (igual ao stake) a candidatos, em até 30 alvos por transação. Voto em si mesmo é proibido, e só candidatos já elegíveis podem receber votos.

A recompensa de bloco é repartida na seguinte ordem: primeiro a fração de tesouraria (`TREASURY_PCT`, **0% por padrão**, governável até 50%); em seguida, se o produtor recebeu votos, ele retém sua comissão (padrão 20%, ajustável por validador) e o restante é distribuído proporcionalmente aos eleitores por meio de um acumulador de precisão fixa que torna o resgate O(1). Se o produtor não recebeu votos, retém a totalidade.

### 8.3 Governança on-chain

Apenas validadores ativos podem propor e votar. Uma proposta é aprovada com **`floor(2N/3) + 1`** dos validadores ativos, entra em estado `QUEUED` e só é aplicada após `GOV_TIMELOCK_BLOCKS` (padrão 40.000 blocos, ~11 h) — dando à comunidade uma janela para reagir a uma mudança aprovada antes que ela produza efeito.

Sete parâmetros são governáveis dentro de limites rígidos codificados no protocolo:

| Parâmetro | Mínimo | Máximo |
|---|---|---|
| `BLOCK_REWARD` | 0 | 1.000 EAV7 |
| `MIN_VALIDATOR_STAKE` | 1 EAV7 | 10.000.000 EAV7 |
| `MAX_VALIDATORS` | 1 | 101 |
| `FEE_EXEMPT_STAKE` | 0 | 1.000.000 EAV7 |
| `MIN_ORACLE_STAKE` | 0 | 1.000.000 EAV7 |
| `TREASURY_PCT` | 0 | 50 |
| `BRIDGE_BREAKER_BPS` | 100 (1%) | 10.000 (100%) |

Um **trilho anti-brick** reverte automaticamente qualquer alteração de `MIN_VALIDATOR_STAKE` ou `MAX_VALIDATORS` que resultaria em conjunto de validadores vazio — impedindo que a governança inutilize a rede por erro de parametrização.

### 8.4 Slashing

O protocolo implementa penalização por **dupla assinatura**: dois blocos válidos, mesmo produtor, mesma altura, hashes diferentes. A penalidade é 10% do valor em risco (stake ativo **mais** fundos em unbonding — fechando a fuga de fazer unstake após a ofensa), da qual 10% vai ao denunciante e 90% é queimada. Um nulificador por `ofensor:altura` impede punição dupla pela mesma evidência, e as verificações baratas precedem as duas verificações híbridas caras para evitar amplificação de DoS.

> **O slashing não está ativo no lançamento.** Esta é uma decisão consciente, documentada no próprio código: a detecção atual não distingue equivocação maliciosa de um validador honesto reproduzindo uma altura após uma reorganização, e puniria o honesto. Ativá-lo exige endurecer a evidência anti-equivocação. Ver Seções 13 e 14.

---

## 9. EAVM — Máquina Virtual e Compatibilidade de Carteiras

A EAVM é a máquina virtual própria da EAV7 — análoga ao papel da TVM na TRON. Ela executa bytecode e indexa logs, com keccak-256, RLP, secp256k1 e RIPEMD-160 implementados no repositório sem dependências.

Para reduzir atrito de adoção, a EAVM expõe um endpoint JSON-RPC que fala o **dialeto** que carteiras do ecossistema Ethereum entendem. Chain ID **72020**. Como carteiras assumem 18 decimais e o protocolo usa 6, a conversão é feita pelo fator `EAVM_WEI_PER_E7` = 10¹²; valores não divisíveis por 10¹² são rejeitados.

Um endereço `0x` é mapeado deterministicamente para um endereço E7. Adicionalmente, o protocolo aceita um destino E7 **codificado dentro do campo de 20 bytes** da transação EVM, usando o prefixo `0xe7000000` seguido dos 32 hexadecimais do corpo e checksum do endereço E7 — permitindo que uma carteira comum envie para um endereço nativo com o checksum validado on-chain.

### 9.1 Compatibilidade — declaração precisa

Esta seção existe para evitar uma expectativa incorreta. A compatibilidade JSON-RPC da EAV7 é **suficiente para carteiras, insuficiente para dApps**.

| Método | Situação |
|---|---|
| `eth_chainId`, `net_version`, `eth_blockNumber` | Implementado |
| `eth_getBalance`, `eth_getTransactionCount` | Implementado |
| `eth_sendRawTransaction` | Implementado — decodifica RLP/secp256k1 e converte em transação nativa |
| `eth_getTransactionByHash`, `eth_getTransactionReceipt` | Implementado (recibo sem logs) |
| `eth_getBlockByNumber`, `eth_getBlockByHash` | Implementado (filtra para transferências EAVM) |
| `eth_gasPrice`, `eth_feeHistory` | Implementado (valor derivado, sem mercado real) |
| **`eth_call`** | **Stub — retorna sempre `0x`** |
| **`eth_getCode`** | **Stub — retorna sempre `0x`** |
| **`eth_estimateGas`** | **Constante 21000** |
| **`eth_getLogs`, `eth_getStorageAt`, `eth_subscribe`, filtros, `eth_getProof`** | **Não implementados** |

**Consequência prática:** MetaMask e Trust Wallet adicionam a rede, exibem o saldo nativo e enviam transferências normalmente. Bibliotecas como ethers.js, web3.js e wagmi **não** conseguem ler contratos, chamar funções por ABI nem assinar eventos, porque `eth_call`, `eth_getCode` e `eth_getLogs` não estão funcionais. A interação com contratos acontece pelas transações nativas `EAVM_DEPLOY` e `EAVM_CALL`, cujos logs são indexados e servidos pela API REST do nó. Completar a superfície JSON-RPC é item de roadmap.

---

## 10. Camada Nativa de Inteligência Artificial

### 10.1 A fronteira que não se cruza

Antes de descrever o que a IA faz na EAV7, é necessário estabelecer o que ela não pode fazer, porque essa é a propriedade de segurança central do projeto.

A EAV7 contém dois conjuntos disjuntos de componentes que a palavra "IA" poderia confundir:

**(A) O protocolo de oráculos de IA** — consenso puro. Tipos de transação, escrow, reputação, quórum, contestação, atestação. É estado de consenso determinístico, replicado e verificável por qualquer nó. Nenhum modelo de linguagem participa da validação: o que a cadeia verifica são assinaturas e concordância de hashes.

**(B) A camada operacional de IA** — zero poder de consenso. Sentinela de segurança, conselheiro de governança, score de validador, roteamento de leitura do gateway e bloqueio de IPs abusivos.

A doutrina aplicada a (B) é explícita e uniforme: **a IA age sozinha apenas onde a ação é operacional e reversível; em tudo que toca consenso, validadores, stake, tesouraria ou código, ela apenas PROPÕE.**

| Componente | Autonomia | Efeito máximo |
|---|---|---|
| Conselheiro de governança | Somente propõe | Redige rascunho de proposta — sem remetente, sem nonce, sem assinatura |
| Score de validador | Somente propõe | Publica métrica de desempenho; jamais remove validador nem toca stake |
| Sentinela de segurança | Somente alerta | Publica alertas classificados por severidade |
| Gateway (roteamento de leitura) | Autônomo, não-consensual | Serve **leituras** de um par mais saudável; escritas permanecem locais |
| Guarda anti-abuso | Autônomo, não-consensual | Bloqueia IP por TTL com expiração automática; nunca afeta validade de transação |

Não existe caminho de código pelo qual qualquer componente de IA assine ou submeta uma transação. Um rascunho gerado pelo conselheiro precisa ser adotado por um validador humano, assinado, submetido e aprovado por 2/3+1 da governança, e ainda cumprir o timelock.

### 10.2 O protocolo de oráculos

O fluxo base: `ORACLE_REGISTER` (oráculo registra endpoint e trava stake ≥ 500 EAV7) → `AI_TASK` (solicitante deposita recompensa em escrow) → `AI_RESULT` (oráculo entrega) → liquidação. A reputação de cada oráculo nasce em 50 e evolui on-chain: **+4** por entrega bem-sucedida, **−12** por resultado derrubado ou não-entrega, **−8** por comprometer e não revelar, **+2/−4** para jurados conforme votem com ou contra a maioria.

Sobre essa base, cinco mecanismos de garantia coexistem, cada um ativado por altura de fork:

**Responsabilização.** Não entregando dentro do prazo, o oráculo é penalizado em 10 EAV7 retirados do seu stake travado e creditados ao solicitante como compensação — além do reembolso integral da recompensa.

**Quórum por commit-reveal.** A tarefa pode exigir N oráculos independentes (2 a 21). Cada um publica primeiro `H(saída ‖ salt)` numa janela de compromisso de 30 minutos, e só depois revela. Isso impede que um oráculo copie a resposta de outro. Quando o quórum de revelações concordantes é atingido, a recompensa é dividida entre os concordantes; a minoria divergente perde reputação.

**Verificação otimista com júri.** Um resultado de oráculo único entra em janela de contestação de 30 minutos. Sem contestação, qualquer um pode acionar a liquidação. Contestado — mediante fiança de 20 EAV7 —, um júri de oráculos registrados vota, com **partes interessadas explicitamente excluídas** da votação. Ao atingir 3 jurados, a maioria simples decide: mantido, o oráculo leva recompensa **mais** a fiança do contestante; derrubado, o solicitante é reembolsado, o oráculo é penalizado e o contestante recupera a fiança acrescida do prêmio.

**Leilão reverso.** Uma tarefa pode ser aberta com orçamento. Oráculos dão lances de preço; o solicitante adjudica; o excedente do orçamento é devolvido. Tarefa aberta e não adjudicada é reembolsável após expiração.

**Resultados privados e verificáveis.** O oráculo pode publicar apenas o `resultHash` e, opcionalmente, um URI, mantendo a saída fora da cadeia — cifrada para o solicitante em tarefas privadas. A verificação é `H(saída) == resultHash`. O prompt e os parâmetros de entrada são apagados do estado após a entrega, contendo o crescimento do estado.

### 10.3 Atestação por ambiente confiável

O mecanismo mais forte de aceitação dispensa reputação e janela de contestação. A governança registra um **atestador** — um conjunto de chaves públicas com um quórum e uma *measurement* que identifica o código atestado. Um resultado acompanhado de assinaturas suficientes desse conjunto sobre o digest

```
keccak256( "EAV7-AI-ATTEST" ‖ \x1f ‖ taskId ‖ \x1f ‖ resultHash ‖ \x1f ‖ attesterId ‖ \x1f ‖ measurement )
```

liquida **imediatamente** e é marcado on-chain como verificado. A *measurement* usada no digest é sempre a **registrada em cadeia**, nunca a fornecida pelo remetente — é isso que amarra a assinatura à identidade do código atestado. A contagem de assinaturas deduplica por endereço recuperado e limita o número de recuperações de curva ao tamanho do conjunto, impedindo tanto inflação por maleabilidade quanto DoS criptográfico.

> **Declaração precisa do modelo de confiança.** A EAV7 verifica on-chain **apenas assinaturas secp256k1 de um conjunto previamente registrado pela governança**. Não existe no protocolo nenhum código de SGX, SEV-SNP, TDX ou Nitro, e nenhum parsing de *quote* DCAP. A verificação da atestação remota do enclave é feita **off-chain, uma única vez, no momento do registro**, pelo operador e pelos validadores que aprovam a proposta de governança. A *measurement* é, do ponto de vista da cadeia, uma string opaca.
>
> Pela mesma razão, o tipo `ZK` é aceito e verificado de forma **idêntica** ao tipo `TEE` — por assinatura de um verificador registrado. **A EAV7 não implementa zkML.** Verificação on-chain de provas SNARK exigiria um verificador de pareamento (BN254 ou BLS12-381), incompatível com a política de zero dependências, e permanece como trabalho futuro.

---

## 11. Ponte Cross-Chain

### 11.1 Mecanismo

A ponte opera por *lock-and-release*. `BRIDGE_OUT` trava o ativo nativo ou o token na cadeia de origem, registrando o destino. `BRIDGE_IN` libera na cadeia de destino mediante prova.

A autoridade de liberação evoluiu em três eras, cada uma ativada por altura:

| Era | Autoridade para liberar |
|---|---|
| Inicial | Um relayer autorizado |
| Federada | Maioria dos relayers autorizados |
| **Atestada por comitê** | **Quórum de assinaturas do comitê da cadeia de origem sobre o digest do evento** |

No modelo final, a autorização de relayer permanece **apenas como controle anti-spam** — não é mais a autoridade de cunhagem. O digest amarra todos os campos do evento:

```
keccak256( "EAV7-BRIDGE-IN" ‖ \x1f ‖ CADEIA ‖ \x1f ‖ txHashOrigem ‖ \x1f ‖ destino ‖ \x1f ‖ valor ‖ \x1f ‖ token )
```

Uma assinatura colhida para liberar 5 EAV7 não pode liberar 500: o valor está no digest.

A proteção contra replay separa a chave de replay (`CADEIA:txHash`) da chave de atestação (que inclui destino, valor e token). Essa separação tem uma consequência importante: um relayer malicioso que atestar valores incorretos forma um grupo próprio que nunca atinge quórum, **sem bloquear** o quórum honesto sobre o valor correto.

### 11.2 Rotação de comitê e o trilho anti-captura

O comitê da cadeia de origem rotaciona por *handoff* assinado: o comitê **atual** assina a transição para o novo conjunto e época, e a assinatura precisa atingir o quórum **vigente**.

Uma propriedade de segurança merece destaque: a governança da EAV7 **não pode substituir um comitê ativo**. Uma proposta de governança só é capaz de *criar* um comitê quando nenhum existe para aquela cadeia (bootstrap). A razão é direta — sem esse trilho, 2/3 dos validadores da EAV7 poderiam trocar o comitê por chaves próprias e drenar a ponte. Trocar um comitê em operação exige o handoff assinado pela origem.

### 11.3 Disjuntor de velocidade

Um limite determinístico de velocidade complementa o modelo: a soma das liberações de um mesmo ativo dentro de uma janela deslizante de 3.600 blocos (~1 h) não pode exceder uma fração do pool medido no início da janela — padrão **30%**, governável entre 1% e 100%. Excedido, a liberação é **rejeitada** (falha fechada). Cada token possui orçamento independente.

O propósito é converter um cenário de dreno total — comitê ou relayer comprometido — em um **vazamento lento e observável**, dando tempo de reação humana.

### 11.4 Declaração honesta do modelo de confiança

Três esclarecimentos necessários:

**A ponte não é um light-client.** A especificação interna de uma ponte com relay de cabeçalhos, prova de inclusão de Merkle e profundidade mínima de confirmação existe, mas está marcada como *proposta, não implementada*. O que foi construído tem o comitê assinando o **digest do evento diretamente**, sem cabeçalho, sem prova de Merkle e sem verificação de profundidade de confirmação. A denominação correta é **ponte atestada por comitê**, não ponte trustless.

**A confiança foi deslocada, não eliminada.** Ela migrou do conjunto de relayers para o conjunto de chaves do comitê da cadeia de origem, o que é uma melhoria real e substancial. Mas um comitê comprometido em quórum ainda consegue cunhar, limitado apenas pelo disjuntor.

**Nenhum adaptador de cadeia de produção existe.** O protocolo define uma interface de adaptador e é agnóstico à cadeia por construção — qualquer identificador válido é aceito como origem ou destino. A única implementação presente no repositório é um adaptador de *loopback* para teste em memória. A TRON é o primeiro alvo especificado; nenhum adaptador foi implementado. Ver Seção 13.

---

## 12. Tokenomics

### 12.1 Parâmetros fundamentais

| Parâmetro | Valor |
|---|---|
| Símbolo | EAV7 |
| Casas decimais | 6 (menor unidade: **e7**; 1 EAV7 = 10⁶ e7) |
| Supply de gênese | **100.000.000.000 EAV7** |
| Recompensa por bloco | 16 EAV7 |
| Tempo de bloco | 1 segundo |
| Halving | a cada 126.144.000 blocos (**≈ 4 anos**) |
| Emissão no primeiro ano | 504.576.000 EAV7 (**0,50%** do gênese) |
| Emissão total até exaustão | 4.036.608.000 EAV7 (**≈ 4,04%** do gênese) |
| Teto teórico de supply | ≈ 104.036.608.000 EAV7, **antes das queimas** |
| Destino das taxas | **100% queimadas** |

A emissão é geometricamente decrescente e converge para zero após 64 halvings. Como toda taxa é queimada, o supply em circulação é dado por `gênese + emitido − queimado`, e sob volume de transações suficiente a queima supera a emissão — tornando a rede líquida deflacionária.

### 12.2 Distribuição do gênese

A distribuição parte da estrutura adotada pela TRON no seu gênese e desloca peso de forma deliberada em direção ao mercado aberto: a parcela pública sobe de 40% para **45%**, financiada por uma redução de 4 pontos na Fundação/Tesouraria e de 1 ponto na venda privada. A participação do parceiro estratégico permanece alinhada à referência.

| Bucket | TRON (referência) | **EAV7** | Δ | Tokens | Vesting |
|---|---|---|---|---|---|
| **Distribuição pública** | 40,00% | **45,00%** | +5,00 | 45.000.000.000 | Líquido no TGE |
| **Fundação / Tesouraria** | 34,25% | **30,25%** | −4,00 | 30.250.000.000 | Cliff 12 meses + linear 48 meses |
| **Venda privada** | 15,75% | **14,75%** | −1,00 | 14.750.000.000 | Cliff 12 meses + linear 24 meses |
| **Parceiro estratégico** | 10,00% | **10,00%** | 0,00 | 10.000.000.000 | Cliff 12 meses + linear 36 meses |
| **Total** | 100% | **100,00%** | — | **100.000.000.000** | — |

A parcela sob controle de insiders (Fundação, venda privada e parceiro) soma **55,00%**, contra 60,00% na estrutura de referência.

O stake inicial dos validadores do gênese (10.000 EAV7 por validador) é debitado do bucket de Fundação/Tesouraria.

**Sobre o vesting.** O protocolo implementa e testa vesting com *cliff* seguido de liberação linear, e o bloco de gênese aceita uma tabela de vesting. Registre-se, contudo, que o gerador de gênese atualmente distribuído **não popula essa tabela** — atribui todo o supply, menos o stake dos validadores, a uma única carteira de tesouraria. Materializar a tabela acima é uma alteração necessária no gerador **antes** da geração do bloco de gênese de produção, e é pré-requisito para que as travas descritas sejam reais e auditáveis on-chain. Ver Seção 13.

**Sobre a ausência de vesting na referência.** A TRON não aplicou travas de liberação aos seus buckets de insider, o que se tornou a crítica mais persistente ao seu lançamento. A EAV7 diverge deliberadamente nesse ponto: todo bucket não-público tem cliff mínimo de 12 meses.

### 12.3 Tesouraria

O protocolo suporta uma fração da recompensa de bloco direcionada à tesouraria on-chain, mas o parâmetro nasce em **0%**. Habilitá-lo requer proposta de governança aprovada por 2/3+1 dos validadores e sujeita a timelock, e o teto codificado é 50%. Gastos da tesouraria são igualmente feitos por governança.

---

## 13. Estado de Maturidade

Esta seção existe para que nenhum leitor precise inferir o que está pronto. A classificação é conservadora por escolha.

### 13.1 Implementado, testado e ativo no lançamento

Consenso DPoS com rodízio determinístico e uma-produção-por-slot · finalidade BFT como piso de reorganização · assinatura híbrida `eav7-hybrid-1` em carteiras, transações e blocos · raiz de estado nos cabeçalhos com provas de inclusão para clientes leves · hash de bloco e identificador de transação imunes a maleabilidade · modelo de recursos energia + largura de banda com delegação · votação em validadores com comissão e recompensa a eleitores · permissões e multi-assinatura por conta · governança on-chain com timelock e trilho anti-brick · tesouraria · vesting · meta-transações · tokens EAV20 e NFTs EAV721 · serviço de nomes EAV-NS · EAVM com execução de contratos e indexação de logs · fases 1 a 5 do protocolo de oráculos de IA · ponte com atestação por comitê e rotação por handoff · armazenamento em disco com snapshots autenticáveis e recuperação de escrita parcial.

**Cobertura de testes: 213 testes em 47 arquivos**, executados pelo runner nativo do Node, incluindo um teste de integração que levanta uma cadeia real com múltiplos validadores e verifica determinismo por replay.

### 13.2 Implementado e testado, porém INATIVO no lançamento

| Recurso | Situação | Requisito para ativação |
|---|---|---|
| **Slashing por dupla assinatura** | Código completo e testado; **deliberadamente não ativado no gênese** | Endurecer a evidência anti-equivocação para distinguir ataque de reprodução honesta pós-reorganização |
| **Disjuntor de velocidade da ponte** | Código completo e testado; altura de ativação fixada em valor distante | Rollout coordenado com altura futura idêntica nos três validadores |
| **Atestação TEE de resultados de IA (Fase 6)** | Código completo e testado; altura de ativação fixada em valor distante | Rollout coordenado + registro do primeiro atestador por governança |

As duas últimas estão fora do conjunto de forks zerados no gênese por uma razão técnica precisa: ativá-las altera a serialização do estado que compõe a raiz de estado, o que quebraria o replay dos blocos já produzidos. A ativação exige que os três validadores anunciem a **mesma** altura de fork antes que a cadeia a atinja — divergência causaria bifurcação.

### 13.3 Roadmap — não implementado

- **Raiz de estado incremental.** O custo atual é O(|estado|) por bloco. Substituir por árvore persistente ou MPT é pré-requisito para escala de estado relevante.
- **Superfície JSON-RPC completa.** `eth_call`, `eth_getCode`, `eth_getLogs`, `eth_getStorageAt`, filtros e `eth_subscribe`, para habilitar ethers.js/web3.js/wagmi.
- **Adaptadores de cadeia da ponte.** Nenhum adaptador de produção existe; TRON é o primeiro alvo especificado.
- **Ponte com light-client.** Relay de cabeçalhos, prova de inclusão de Merkle e profundidade mínima de confirmação.
- **zkML.** Verificação on-chain de provas SNARK, exigindo verificador de pareamento.
- **P2P autenticado.** O transporte atual é HTTP simples.
- **Integração contínua.** O repositório não possui configuração de CI; os testes são executados manualmente.
- **Auditoria por firma externa independente.** Ver Seção 14.

---

## 14. Fatores de Risco

Os riscos abaixo são materiais e devem ser lidos por qualquer pessoa que considere adquirir, custodiar ou construir sobre EAV7.

### 14.1 Risco regulatório — o mais relevante deste documento

**A distribuição pública descrita na Seção 12.2 é uma venda de tokens ao público.** Uma oferta dessa natureza tem alta probabilidade de ser caracterizada como oferta pública de valor mobiliário sob a legislação brasileira, sujeita à competência da Comissão de Valores Mobiliários, e sob a legislação dos Estados Unidos pelo teste de Howey. Não é hipótese remota: em março de 2023 a Securities and Exchange Commission dos Estados Unidos ajuizou ação contra a Tron Foundation e Justin Sun envolvendo, entre outras alegações, a oferta e venda não registrada de TRX.

As consequências potenciais incluem exigência de registro prévio, restrição de jurisdições elegíveis, obrigações de verificação de identidade e origem de recursos, responsabilização pessoal dos administradores e nulidade das ofertas realizadas.

**Nenhum conteúdo deste whitepaper substitui aconselhamento jurídico especializado, que deve ser obtido antes de qualquer captação.**

### 14.2 Riscos de centralização no lançamento

A rede inicia com **três validadores**. Com N = 3, o quórum de finalidade BFT é 3 — ou seja, a finalidade depende da participação de todos, e a indisponibilidade de um único operador degrada a rede. Um conjunto tão pequeno não oferece resistência significativa a conluio, coerção ou falha correlacionada de infraestrutura. A descentralização progressiva do conjunto de validadores é objetivo declarado, mas é um objetivo, não um estado atual.

Adicionalmente, o slashing não estará ativo no lançamento (Seção 13.2), de modo que a dupla assinatura por um validador **não será economicamente punida** até que o mecanismo seja endurecido e ativado.

### 14.3 Risco da ponte

O gerador de gênese semeia **um único relayer**. Com um relayer, qualquer quórum de maioria calculado sobre o conjunto de relayers equivale a um. O modelo de segurança da ponte só se torna efetivo com um comitê de origem devidamente constituído, e o disjuntor de velocidade — a mitigação projetada para transformar dreno em vazamento — está **inativo** no lançamento. **A ponte não deve custodiar valor economicamente relevante antes de o comitê estar constituído e o disjuntor ativado.**

### 14.4 Riscos criptográficos e estruturais

**Espaço de endereços de 112 bits.** O corpo do endereço tem 14 bytes, oferecendo resistência a colisão de aniversário da ordem de 2⁵⁶ operações — abaixo do patamar de 2⁸⁰ hoje considerado confortável. Corrigir invalidaria todos os endereços já emitidos.

**Construção da árvore de Merkle.** A árvore de transações duplica o último nó quando o número de folhas é ímpar e não aplica separação de domínio entre folha e nó interno. Essa construção é conhecida por permitir, em certos protocolos, que conjuntos distintos de transações produzam a mesma raiz. O impacto na EAV7 é limitado pelo fato de o identificador de transação ser derivado do payload assinado, mas a construção não é a mais robusta disponível.

**ML-DSA é um padrão recente.** O ML-DSA foi padronizado em 2024 e tem histórico de criptanálise pública substancialmente menor que o do ECDSA. A escolha híbrida existe precisamente para que uma falha em qualquer um dos dois esquemas não seja fatal — mas isso é uma mitigação, não uma garantia.

### 14.5 Risco de auditoria

O protocolo passou por múltiplas rodadas de auditoria adversarial conduzidas internamente com assistência de modelos de linguagem, que identificaram e levaram à correção de vulnerabilidades relevantes — incluindo manipulação de slot de consenso, dreno da ponte, roubo de escrow da camada de IA, maleabilidade de hash de bloco e snapshot não autenticado. Todas as correções estão cobertas por testes de regressão.

**Nenhuma firma de auditoria externa e independente revisou este código.** Auditoria interna, por mais rigorosa, não substitui revisão adversarial independente, e este é um risco material para qualquer valor custodiado na rede.

Não há também pipeline de integração contínua: os testes existem e passam, mas sua execução não é obrigatória nem automatizada a cada alteração.

### 14.6 Riscos operacionais e de escala

A recomputação da raiz de estado é O(|estado|) por bloco. Conforme o estado cresce, o custo por bloco cresce proporcionalmente, e existe um ponto em que a produção a cada segundo deixa de ser sustentável. Esse limite não foi caracterizado empiricamente.

O transporte P2P é HTTP não autenticado. A camada de IA operacional depende de serviços externos quando configurada para tal, e a indisponibilidade desses serviços degrada monitoramento, jamais consenso.

---

## 15. Aviso Legal

Este documento é fornecido exclusivamente para fins informativos e técnicos. Não constitui, e não deve ser interpretado como, oferta de venda, solicitação de oferta de compra, recomendação de investimento, aconselhamento jurídico, tributário, contábil ou financeiro, nem prospecto ou documento de oferta sob qualquer legislação.

**Declarações prospectivas.** Este whitepaper contém declarações sobre planos, roadmap, funcionalidades futuras e resultados pretendidos. Tais declarações refletem expectativas na data de publicação e envolvem riscos e incertezas conhecidos e desconhecidos. Os resultados efetivos podem diferir materialmente. Nenhuma obrigação de atualização é assumida.

**Ausência de garantias.** O software é fornecido "no estado em que se encontra", sem garantia de qualquer natureza, expressa ou implícita, incluindo garantias de comercialização, adequação a finalidade específica, disponibilidade, segurança ou ausência de defeitos. Nenhuma auditoria externa independente foi realizada sobre o código descrito.

**Risco de perda total.** Ativos digitais são de alto risco e alta volatilidade. O valor do EAV7 pode cair a zero. Falhas de software, exploração de vulnerabilidades, perda de chaves privadas, ação regulatória ou descontinuação do projeto podem resultar em perda total e irreversível. Não adquira EAV7 com recursos cuja perda integral comprometa sua situação financeira.

**Restrições jurisdicionais.** A aquisição ou detenção de ativos digitais é restrita ou proibida em determinadas jurisdições. É responsabilidade exclusiva do leitor verificar a legalidade de sua participação sob a legislação que lhe é aplicável.

**Independência da referência à TRON.** As referências à TRON neste documento são exclusivamente comparativas e descritivas de inspiração de projeto. A EAV7 não é afiliada, patrocinada, endossada ou de qualquer forma associada à TRON Foundation, à TRON DAO ou a quaisquer de suas entidades relacionadas.

---

## Apêndice A — Parâmetros de Consenso

| Parâmetro | Valor |
|---|---|
| Protocolo / versão | `eav20` / 1 |
| Esquema de assinatura | `eav7-hybrid-1` (secp256k1 + ML-DSA-44) |
| Função de hash | SHA3-256 truncada em 248 bits, prefixo `E7` |
| Comprimento de hash / endereço | 64 / 34 caracteres |
| Tempo de bloco | 1.000 ms |
| Máximo de transações por bloco | 500 |
| Deriva máxima de relógio | 2.000 ms |
| Tolerância de slot futuro | 400 ms |
| Janela de reorganização | 5.000 blocos |
| Intervalo de snapshot | 5.000 blocos |
| Máximo de validadores | 27 (governável, teto 101) |
| Stake mínimo de validador | 1.000 EAV7 (governável) |
| Mínimo de validadores para finalidade | 3 |
| Período de unbonding | 604.800 blocos (≈ 7 dias) |
| Percentual de slashing | 10% do valor em risco |
| Prêmio ao denunciante | 10% da penalidade |
| Comissão padrão de validador | 20% |
| Percentual de tesouraria | 0% (governável, teto 50%) |
| Recompensa de bloco | 16 EAV7 (governável, teto 1.000) |
| Intervalo de halving | 126.144.000 blocos (≈ 4 anos) |
| Supply de gênese | 100.000.000.000 EAV7 |
| Stake mínimo de oráculo | 500 EAV7 |
| Penalidade de oráculo | 10 EAV7 |
| Fiança de contestação | 20 EAV7 |
| Quórum de júri | 3 jurados |
| Quórum de governança | ⌊2N/3⌋ + 1 validadores ativos |
| Timelock de governança | 40.000 blocos (≈ 11 h) |
| Janela do disjuntor da ponte | 3.600 blocos (≈ 1 h) |
| Limite do disjuntor da ponte | 30% do pool (governável, 1%–100%) |
| EAVM Chain ID | 72020 |
| Conversão EAVM | 10¹² wei por e7 |
| Máximo de gás EAVM | 30.000.000 |
| Tamanho máximo de contrato | 24.576 bytes (EIP-170) |
| Limite máximo de taxa | 100 EAV7 |
| Tipos de transação | 55 |

---

*EAV7 · Whitepaper Técnico v1.0 · 19 de julho de 2026*
