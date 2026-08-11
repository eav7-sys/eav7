# EAV7 — Uma Blockchain de Camada 1 com Segurança Pós-Quântica e Camada Nativa de Inteligência Artificial

**Whitepaper Técnico · Versão 1.0 · 11 de agosto de 2026**

Protocolo `eav20` · Símbolo `EAV7` · EAVM Chain ID `72020` (mainnet) / `72021` (testnet)

---

> **Aviso preliminar.** Este documento descreve a mainnet EAV7 em operação a partir de 11 de agosto de 2026. A Seção 13 (Estado de Maturidade) separa o que está ativo na rede ao vivo, o que permanece condicionado operacionalmente ou por altura de fork, e o que é roadmap. A Seção 14 (Fatores de Risco) e a Seção 15 (Aviso Legal) são partes integrantes deste documento e não devem ser lidas isoladamente. Nenhuma parte deste whitepaper constitui oferta, recomendação de investimento ou garantia de resultado.

---

## Sumário

1. [Resumo Executivo](#1-resumo-executivo)
2. [Motivação e Posicionamento](#2-motivação-e-posicionamento)
3. [Arquitetura e Pilha de Software](#3-arquitetura-e-pilha-de-software)
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

A EAV7 é uma blockchain de camada 1 implementada em Rust, que combina três decisões de projeto pouco usuais quando tomadas em conjunto.

**Assinatura híbrida pós-quântica obrigatória.** Toda carteira, transação e bloco carrega **duas** assinaturas independentes — ECDSA sobre secp256k1 e ML-DSA-44 (NIST FIPS 204) — e ambas precisam verificar para que o objeto seja aceito. Não é um modo opcional nem uma migração planejada: é o único esquema que o protocolo conhece, chamado `eav7-hybrid-1`. Um adversário com computador quântico criptograficamente relevante que quebre a curva elíptica ainda enfrenta o reticulado; um adversário que encontre falha estrutural no ML-DSA ainda enfrenta a curva.

**Camada de IA como primitiva de consenso, não como narrativa.** A EAV7 define tipos de transação nativos para contratar, entregar, contestar e liquidar trabalho de inteligência artificial, com escrow on-chain, reputação de oráculo, quórum por commit-reveal, janela de contestação otimista com júri, leilão reverso de oráculos e liquidação imediata mediante atestação criptográfica. Igualmente importante é o que a IA **não** pode fazer: nenhum componente de IA da EAV7 tem poder vinculante sobre consenso, conjunto de validadores, stake ou código. Essa fronteira é arquitetural e verificável no código.

**Economia deflacionária com emissão mínima.** Cem bilhões de EAV7 no gênese, blocos de um segundo, 16 EAV7 de recompensa por bloco com halving a cada ~4 anos. A emissão do primeiro ano equivale a **0,50%** do supply de gênese, e a emissão total ao longo de todos os halvings soma 4.036.608.000 EAV7 — cerca de 4,04% adicionais. Em contrapartida, **100% das taxas de transação são queimadas**: não vão para o validador, não vão para a tesouraria. Sob uso relevante, a rede é estruturalmente deflacionária.

Sobre essa base a EAV7 implementa DPoS com finalidade BFT, votação em validadores com recompensa a eleitores, permissões multiassinatura por conta, cota de recursos GB com delegação, governança autorizada pelo owner com timelock, vesting, meta-transações sem gás e uma EAVM que executa bytecode EVM. EAV20 é o padrão de token de produto: contrato Solidity compatível com ERC-20 na EAVM.

A implementação de referência é um workspace Rust — biblioteca de consenso, nó completo, CLI de operador, SDK e módulo criptográfico WebAssembly — mais um explorador de blocos em Next.js. A Seção 3 descreve a pilha; a Seção 13 declara com precisão até onde ela foi levada.

---

## 2. Motivação e Posicionamento

### 2.1 O problema da colheita antecipada

A ameaça quântica à criptografia de curva elíptica não é simétrica no tempo. Um adversário pode capturar hoje o tráfego e o histórico público de uma blockchain e decifrá-lo anos depois, quando o hardware existir — a estratégia conhecida como *harvest now, decrypt later*. Para uma blockchain isso é particularmente grave: chaves públicas ficam permanentemente expostas no histórico assim que uma conta transaciona, e o registro é imutável e público por construção.

O NIST padronizou o ML-DSA em agosto de 2024 (FIPS 204). A resposta da maioria das redes existentes tem sido postergar: migrar um esquema de assinatura em uma cadeia com valor econômico significativo é uma das operações mais arriscadas que existem, porque exige coordenação de todo o ecossistema de carteiras, exchanges e contratos. A EAV7 parte do princípio de que **nascer híbrida é substancialmente mais barato do que migrar depois**, e aceita o custo — assinaturas maiores, verificação mais cara, mais largura de banda por transação — como preço de entrada.

### 2.2 Por que uma camada de IA nativa

Serviços de inferência de IA são hoje consumidos por APIs centralizadas, com três propriedades ruins para aplicações on-chain: o resultado não é verificável, o pagamento não é atômico com a entrega, e o provedor não tem nada em risco se mentir ou não entregar.

A EAV7 trata a inferência como um mercado de oráculos com garantias econômicas explícitas. O solicitante deposita a recompensa em escrow ao criar a tarefa. O oráculo tem stake em risco. A entrega pode ser validada por concordância de múltiplos oráculos independentes (commit-reveal), por ausência de contestação em uma janela (verificação otimista com júri e fiança) ou por assinatura de um atestador registrado — e neste último caso liquida imediatamente, sem depender de reputação.

### 2.3 Princípios de projeto

A EAV7 é uma L1 própria: supply de gênese de 100 bilhões, recursos regenerativos (cota GB) em vez de mercado de gás, DPoS com rodízio determinístico, caminho de tokens via contratos na EAVM (bytecode EVM), blocos de ~1 segundo, 51 assentos ativos com banco de 50, assinatura híbrida pós-quântica, camada de IA nativa, cota GB que não cobra bytes de assinatura e **queima integral das taxas**.

---

## 3. Arquitetura e Pilha de Software

### 3.1 Crates e responsabilidades

A implementação de referência é um único workspace Rust. As dependências correm em uma só direção — a biblioteca de consenso não depende de nada acima dela, e nenhum componente acima reimplementa uma regra de consenso.

| Crate / caminho | Papel |
|---|---|
| `rust/` (`eav7`) | Biblioteca de consenso: máquina de estado, blocos, transações, raiz de estado, EAVM, ponte, governança |
| `rust/node` (`eav7-node`) | Nó completo: API REST, P2P, produtor de blocos, JSON-RPC da EAVM |
| `rust/core` (`eav7-core`) | CLI de operador: configuração, carteira, supervisão do nó, operações de stake e validador |
| `rust/sdk` (`eav7-sdk`) | Carteira, cliente HTTP bloqueante, verificação de provas de light client, utilitários de relayer |
| `rust/wasm` (`eav7-wasm`) | Criptografia híbrida compilada para WebAssembly, para carteiras no browser |
| `web-next/` | Explorador de blocos e interface de carteira (Next.js) |
| `vectors/` | Vetores de conformidade congelados para serialização canônica, criptografia, estado e EAVM |

A criptografia de consenso usa crates estabelecidos (`k256`, `sha2`, `sha3`, `ripemd`, a implementação de ML-DSA e `ark-bn254` para o precompilado de pareamento), em vez de primitivas escritas no repositório. Os vetores em `vectors/` fixam o comportamento byte a byte que qualquer implementação conforme precisa reproduzir: JSON canônico, identificadores de transação, derivação de endereço, folhas de estado, raízes de estado e envelopes da EAVM.

Não existe cliente de blockchain em JavaScript. O explorador é um front-end somente-leitura sobre a API HTTP do nó.

### 3.2 Cliente e caminho do operador

O `eav7-core` é a porta de entrada de quem quer rodar EAV7 sem ler o monorepo. Ele gera e guarda o par de chaves híbrido, escreve um arquivo de configuração em um diretório de dados nativo da plataforma, supervisiona um processo `eav7-node` e expõe as operações de stake e de validador através do SDK. O fluxo `ancora-init` cria backups dos owners e um keystore separado para a witness, sem colocar o material dos owners no servidor produtor.

| Modo | Comportamento |
|---|---|
| `listen` | Sincroniza e serve a API; sem carteira ligada à produção, não produz blocos |
| `candidate` | Carteira ligada; produz blocos **se** a conta estiver dentro do conjunto ativo |
| `validator` | Mesmo comportamento de protocolo do `candidate`; o nome distinto registra a intenção do operador de rodar 24/7 |

Os diretórios de dados padrão são `~/.eav7` no Linux, `~/Library/Application Support/EAV7` no macOS e `%APPDATA%\EAV7` no Windows, sobrescritíveis por `EAV7_HOME`. Definições de serviço para systemd, launchd e Windows (via `sc.exe` ou NSSM) acompanham o repositório em `deploy/`. Arquivos de release com checksum são publicados por tag para Linux x64, Linux arm64, macOS arm64 e Windows x64.

A higiene das chaves faz parte do modelo: a autoridade fria `owner` de uma Âncora é híbrida M-de-N (padrão de produto 2-de-3), enquanto a chave quente `witness` só produz blocos. A witness não pode autorizar governança nem operações de poder; os shares do owner ficam offline. Uma carteira de celular faz stake e vota; ela nunca assina blocos.

Esse caminho importa além da conveniência. Operadores externos rodando `eav7-core` são o único mecanismo pelo qual o conjunto de validadores se torna independente da entidade fundadora — ver Seções 13 e 14.

### 3.3 Superfícies do nó e transporte P2P

| Superfície | Porta padrão | Função |
|---|---|---|
| API REST | 6070 | Consulta de estado, submissão de transações, provas, endpoints administrativos |
| JSON-RPC EAVM | 7070 (porta da API + 1000) | Endpoint em dialeto Ethereum para carteiras e ferramentas |
| P2P | Mesmo listener HTTP | Gossip de blocos e transações, sincronização por faixa |

O tráfego entre pares corre sobre HTTP com um conjunto pequeno de mensagens: `POST /tx` para gossip de transação, `POST /blocks` para gossip de bloco e uma consulta paginada de faixa para sincronização. A descoberta de pares é por registro mútuo autenticado com token administrativo; a topologia legítima é semeada por uma lista de peers na inicialização, e o número de pares é limitado por `MAX_PEERS` = 64.

URLs de pares passam por um filtro anti-SSRF que normaliza formas não canônicas de IPv4 — codificações decimal, octal e hexadecimal resolvem para o mesmo endereço — antes de classificá-las como privadas ou públicas. Sem essa normalização, um par poderia levar o nó a falar com loopback ou com serviços de metadados de nuvem. Pares em faixa privada são recusados salvo autorização explícita, configuração destinada apenas a testnets locais.

O transporte em si não é autenticado nem cifrado na camada de protocolo. Deployments de produção devem colocar validadores atrás de proxy reverso ou túnel e jamais expor a API administrativa. P2P autenticado é item de roadmap (Seção 13.5).

---

## 4. Consenso

### 4.1 DPoS com rodízio determinístico por slot

O tempo é dividido em slots de `BLOCK_TIME_MS` = 1.000 ms. O slot de um instante é `floor(timestamp / 1000)`, e o produtor esperado daquele slot é

```
validators[ slot mod N ]
```

onde `validators` é o conjunto ativo ordenado. Não há sorteio, VRF ou leilão: dado o relógio e o conjunto de validadores, o produtor de qualquer slot é uma função pura e universalmente computável.

O conjunto ativo é derivado do estado a cada bloco: contas com `staked ≥ MIN_VALIDATOR_STAKE` (1.000 EAV7), ordenadas por **peso = stake próprio + votos recebidos** em ordem decrescente, desempate por endereço ascendente, truncado em `MAX_VALIDATORS` (51 na mainnet). As 50 contas elegíveis seguintes formam o banco; o ecossistema ranqueado totaliza top 101. Só Âncoras ativas produzem blocos e votam; o banco é candidato à promoção. Contas gerenciadas pela EAVM são excluídas por construção, pois não possuem par de chaves híbrido e portanto não conseguem assinar blocos.

A mainnet opera com **sete Âncoras** da fundação desde a altura 0 (uma produtora por VM, malha completa) e deve preencher rumo a 51 conforme operadores independentes se qualifiquem. Cada Âncora de lançamento usa owner frio M-de-N e witness quente separada; a witness assina bloco sem ganhar autoridade sobre governança, stake, comissão ou permissões do owner.

### 4.2 Regras de admissão de bloco

Um bloco é aceito somente se satisfizer, em ordem:

1. Integridade criptográfica — ambas as assinaturas verificam, o hash confere com o payload canônico.
2. `height == head.height + 1` e `previousHash == head.hash`.
3. `timestamp > head.timestamp`.
4. **Um bloco por slot**: `slot(bloco) > slot(head)`. Esta regra elimina o *slot grinding* — produzir múltiplos candidatos no mesmo slot para escolher o mais favorável.
5. `txCount ≤ MAX_TXS_PER_BLOCK` (500).
6. Slot não pertencente ao futuro além de `SLOT_FUTURE_TOLERANCE_MS` (400 ms) e deriva de relógio dentro de `MAX_CLOCK_DRIFT_MS` (2.000 ms).
7. Acima de `STRICT_PRODUCER_HEIGHT`, o produtor deve ser **exatamente** o produtor esperado do slot.
8. Acima de `STATEROOT_HEIGHT`, a raiz de estado recomputada deve bater com a declarada no cabeçalho.

A transição de estado é sempre simulada sobre um clone antes de ser comprometida, e a gravação em disco precede a mutação em memória.

### 4.3 Regra de escolha de cadeia e finalidade BFT

A regra base é **cadeia mais longa**, restringida por dois pisos de finalidade.

O piso dinâmico é derivado dos próprios produtores já presentes na cadeia: um bloco é considerado **final** quando pelo menos `floor(2N/3) + 1` validadores **distintos** produziram blocos acima dele. Não existe subprotocolo de votação, mensagem de *precommit* nem rodada de consenso separada — a finalidade é lida da história. Reorganizações que tentem reverter altura finalizada são rejeitadas.

A finalidade é desativada quando o conjunto ativo tem menos de `FINALITY_MIN_VALIDATORS` = 3 validadores, pois abaixo disso um quórum de dois terços não oferece garantia significativa.

A profundidade de reorganização é adicionalmente limitada por `REORG_WINDOW` = 5.000 blocos.

### 4.4 Armazenamento e recuperação

Blocos são persistidos em `blocks.jsonl`, arquivo append-only com um objeto JSON por linha, indexado em memória por `offsets[altura] = (byteOffset, tamanho)` — acesso aleatório em O(1) por leitura posicionada, sem materializar o arquivo. Uma janela dos blocos recentes permanece em memória; blocos que saem da janela avançam um estado-base por reaplicação. O armazém lida com LINHAS e delega o parse ao formato de bloco, o que o mantém correto quando o formato mudar.

Dois modos de falha são tratados de forma diferente, de propósito. Um rasgo na última linha do arquivo — crash no meio de um append — é recuperável: o arquivo é truncado no início dessa linha e o nó sobe com um bloco a menos, ressincronizando pela rede. Corrupção no meio do arquivo não é reparada em silêncio, porque isso significaria subir um nó sobre uma história que ele não consegue provar.

Snapshots do estado completo são gravados a cada `SNAPSHOT_INTERVAL_BLOCKS` = 5.000 blocos. Um snapshot carregado só é aceito se a raiz de estado recomputada bater com a raiz comprometida pelo bloco correspondente. É uma garantia mais forte do que selar o arquivo com uma chave do operador: um snapshot bem-formado e falso reprova na conferência da raiz, ao passo que um MAC só prova que quem escreveu o arquivo tinha a chave.

---

## 5. Criptografia e Modelo Pós-Quântico

### 5.1 O esquema `eav7-hybrid-1`

| Componente | Primitiva | Padrão |
|---|---|---|
| Assinatura clássica | ECDSA sobre secp256k1, digest SHA-256 | SEC 2 / FIPS 186 |
| Assinatura pós-quântica | ML-DSA-44 (Dilithium), sem pré-hash | NIST FIPS 204 |
| Função de hash | SHA3-256 truncada em 248 bits | NIST FIPS 202 |

A verificação é uma conjunção estrita: **ambas** as assinaturas devem ser válidas. Um objeto com apenas uma assinatura correta é rejeitado exatamente como um objeto sem assinatura alguma. Chaves trafegam em PEM (privada PKCS#8, pública SPKI) e assinaturas em base64.

Um adversário que quebre só o ECDSA **não redireciona a eleição nem a produção de blocos** sem também forjar a assinatura PQ: o protocolo exige as duas em todo objeto de consenso.

O custo dessa escolha é explícito e assumido: a assinatura ML-DSA-44 é substancialmente maior que a ECDSA. Por isso o modelo GB de lançamento exclui campos de assinatura dos bytes úteis medidos, em vez de tornar o custo dependente da assinatura híbrida grande e variável.

### 5.2 Formato de hash e endereço

Todo hash da EAV7 tem 64 caracteres: o prefixo literal `E7` seguido de 62 caracteres hexadecimais maiúsculos, correspondentes aos 248 bits mais significativos do SHA3-256. O prefixo é marca de identidade do protocolo, não entropia.

Endereços têm 34 caracteres: `E7` + 28 hexadecimais + 4 hexadecimais de checksum.

```
corpo     = SHA3-256( DER(chave_secp256k1) ‖ DER(chave_mldsa) )[0:14]   → 28 hex
checksum  = SHA3-256( "EAV7-ADDR:" ‖ corpo )[0:2]                       → 4 hex
endereço  = "E7" ‖ corpo ‖ checksum
```

O endereço deriva de **ambas** as chaves públicas concatenadas, o que amarra a identidade da conta ao par híbrido completo.

> **Limitação declarada.** O corpo do endereço tem 14 bytes = **112 bits**. A resistência a colisão de aniversário é, portanto, da ordem de 2⁵⁶ operações — abaixo do patamar de 2⁸⁰ hoje considerado confortável. Isto está registrado como achado residual na auditoria interna do projeto, com a observação de que alterá-lo invalida todos os endereços já emitidos. Ver Seção 14.

### 5.3 Separação de domínio

Digests de propósito específico são separados por prefixo de domínio e pelo separador `\x1f` (ASCII *unit separator*), impedindo que uma assinatura colhida em um contexto seja reaproveitada em outro:

- `EAV7-BRIDGE-IN` — liberação de ativo da ponte
- `EAV7-BRIDGE-COMMITTEE` — rotação de comitê da ponte
- `EAV7-AI-ATTEST` — atestação de resultado de IA
- `EAV7-ADDR:` — checksum de endereço

---

## 6. Estrutura de Dados e Compromisso de Estado

### 6.1 Cabeçalho de bloco

O núcleo assinado do bloco contém `protocol`, `version`, `scheme`, `height`, `timestamp`, `previousHash`, `txRoot`, `txCount`, `producer`, `publicKey`, `pqPublicKey` e — acima de `STATEROOT_HEIGHT` — `stateRoot`. Ficam fora do núcleo: `signature`, `pqSignature`, `hash` e `transactions`.

Acima de `CANONICAL_HASH_HEIGHT`, o hash do bloco é calculado **somente sobre o payload**, excluindo as assinaturas. Isso torna o identificador imune à maleabilidade de assinatura ECDSA, na qual um adversário reescreve `s` como `n − s`, produzindo assinatura igualmente válida e portanto identificador diferente para o mesmo bloco.

### 6.2 Transações

Uma transação carrega `protocol`, `scheme`, `type`, `from`, `to`, `amount`, `fee`, `nonce`, `timestamp`, `data`, as duas chaves públicas e as duas assinaturas. O identificador deriva **exclusivamente do payload canônico assinado**, nunca dos bytes de assinatura — mesma defesa anti-maleabilidade aplicada ao bloco.

O campo `fee` é um **limite de taxa** (teto de queima autorizado pelo remetente), não um pagamento, e é limitado por `MAX_FEE_LIMIT` = 100 EAV7. O nonce deve ser exatamente o corrente mais um.

O protocolo define **58 tipos de transação**, cobrindo transferência, staking, votação, permissões e multiassinatura, tokens EAV20, NFTs EAV721, serviço de nomes, governança, tesouraria, vesting, meta-transações, EAVM, ponte e a camada de IA. A lista é fechada: um nó precisa rejeitar um tipo desconhecido em vez de ignorá-lo, porque aceitar um tipo que não sabe executar diverge o estado.

A serialização canônica reproduz a forma JSON byte a byte com que o assinante se comprometeu, incluindo escape de strings e formatação de inteiros. Valores em ponto flutuante são deliberadamente ausentes do campo `data`: reproduzir em outra linguagem a formatação de menor round-trip de um motor JavaScript é fonte de divergências de um dígito, que mudariam o payload, mudariam o identificador e fariam da transação outro objeto. Aplicações que precisam de fração a codificam como texto, que é o que o resto do protocolo já faz com valores monetários.

### 6.3 Modelo de estado e raiz de estado

O modelo é de contas (não UTXO), com valores monetários em inteiros de 128 bits na menor unidade, chamada **e7** (1 EAV7 = 10⁶ e7). O estado é particionado em domínios: contas, tokens, NFTs, nomes, contratos, oráculos, atestadores de IA, tarefas de IA, votos, permissões, delegações, propostas de governança, tesouraria, slashing, unbonding, vesting, comissões e ponte.

A raiz de estado é uma **árvore de Merkle de folhas ordenadas** — explicitamente **não** uma Merkle-Patricia Trie:

```
folha = H( domínio ‖ \x1f ‖ chave ‖ \x1f ‖ serialização_canônica(valor) )
raiz  = merkleRoot( sort(folhas) )
```

Isso habilita **provas de inclusão de conta** para clientes leves. O caminho está implementado de ponta a ponta: o nó serve a prova de uma conta, e o `eav7-sdk` a verifica localmente contra uma raiz de estado retirada de um cabeçalho cuja integridade o próprio cliente conferiu. Um nó pode recusar-se a servir a prova — o que é detectável —, mas não consegue forjá-la.

> **Limitação de escala declarada.** A raiz é recomputada sobre o estado **inteiro** a cada bloco — custo O(|estado|) por bloco. Uma estrutura incremental (árvore persistente, árvore de Merkle esparsa ou estado com cópia sob escrita) é trabalho reconhecido como necessário antes que a cadeia atinja tamanho de estado relevante. Ver Seção 13.

---

## 7. Modelo de Recursos e Taxas

A EAV7 **não tem mercado de gás**. Não há preço de gás, leilão de prioridade nem gorjeta ao produtor. O modelo é de recursos regenerativos com queima como mecanismo de excedente.

### 7.1 GB · Assinatura Livre

O modelo de lançamento tem uma barra diária, **GB**: `1.000.000.000` bytes ponderados por conta, mais `1.000.000` por EAV7 efetivo em stake. Ela regenera em `86.400` blocos (~24 h) e não acumula além da capacidade diária.

```
bytes_úteis       = bytes da transação serializada sem signature, pqSignature e id
bytes_ponderados  = max(GB_MIN_WEIGHTED, bytes_úteis × fator_do_tipo)
cota_diária       = 1.000.000.000 + 1.000.000 × EAV7_efetivo_em_stake
queima            = max(0, bytes_ponderados − cota_restante) × BURN_PER_BYTE
```

`GB_MIN_WEIGHTED` é `1.024` bytes. O fator do tipo reutiliza a tabela legada de custo de energia; `BURN_PER_BYTE` é `5 e7`. O campo `fee` continua sendo **limite de queima**, não preço: se a queima calculada excedê-lo, a transação falha.

As assinaturas híbridas são excluídas dos bytes úteis. Essa regra de **assinatura livre** impede que a assinatura PQ, grande e variável, vire superfície de taxa e preserva a defesa contra maleabilidade; as chaves públicas continuam incluídas. Dentro da cota, a conta não queima nada. `DELEGATE_RESOURCE` / `UNDELEGATE_RESOURCE` continuam aumentando o stake efetivo de recurso do destinatário e, portanto, sua cota GB, sem transferir voto.

A contabilidade legada de energia e largura de banda continua abaixo de `GB_FEE_HEIGHT`. Na mainnet (`GENESIS_ACTIVE` / perfil de altura zero), o GB · Assinatura Livre aplica-se desde o gênese. Builds locais sem esse overlay podem ainda usar heights distantes.

### 7.2 Queima integral das taxas

**Toda taxa cobrada é queimada.** O validador produtor não recebe fração alguma das taxas; sua receita é exclusivamente a recompensa de bloco. É uma escolha econômica deliberada, com três consequências:

1. **Pressão deflacionária proporcional ao uso.** Quanto mais a rede é usada, mais supply é destruído.
2. **Eliminação do incentivo a censura por taxa.** Como o produtor não lucra com a taxa, não há incentivo para ordenar ou censurar transações com base nela.
3. **Ausência de mercado de MEV por gorjeta.** O protocolo não oferece canal de pagamento de prioridade ao produtor.

Além das taxas, são queimados: 90% das penalidades de slashing (10% vão ao denunciante) e o custo de registro de nomes no EAV-NS.

---

## 8. Staking, Validação e Governança

### 8.1 Stake e unbonding

Fazer stake move saldo de `balance` para `staked`, o que simultaneamente concede elegibilidade a validador, poder de voto e cota GB diária adicional.

O `UNSTAKE` remove o stake **imediatamente** — poder de voto e posição de validador são perdidos no ato —, mas os fundos entram em fila de unbonding por `UNBONDING_BLOCKS` = 604.800 blocos (**≈ 7 dias**), sendo creditados de volta pelo processamento determinístico de cada bloco. Uma conta mantém no máximo `MAX_UNBONDING_ENTRIES` = 32 entradas simultâneas.

Três travas protegem a integridade da rede: não é possível fazer unstake abaixo do total votado, nem abaixo do delegado a terceiros, nem **esvaziar o conjunto de validadores** — a última posição ativa não pode ser removida.

### 8.2 Votação e recompensa a eleitores

Detentores de EAV7 alocam poder de voto (igual ao stake) a candidatos, em até 30 alvos por transação. Voto em si mesmo é proibido, e só candidatos já elegíveis podem receber votos.

A recompensa de bloco é repartida na seguinte ordem: primeiro a fração de tesouraria (`TREASURY_PCT`, **0% por padrão**, governável até 50%); em seguida, se o produtor recebeu votos, ele retém sua comissão (padrão 20%, ajustável por validador com atraso de `COMMISSION_DELAY_BLOCKS` = 21.600 blocos) e o restante é distribuído proporcionalmente aos eleitores por um acumulador de precisão fixa que torna o resgate O(1). Se o produtor não recebeu votos, retém a totalidade.

Na mainnet, a votação está ativa desde o gênese, de modo que a ordenação usa stake próprio mais votos desde o início. O conjunto ativo tem até 51 Âncoras; as 50 contas elegíveis seguintes formam o banco, que não vota nem produz até ser promovido.

### 8.3 Governança on-chain

Apenas Âncoras ativas podem propor e votar. Uma proposta é aprovada com **`floor(2N/3) + 1`** dos validadores ativos, entra em estado `QUEUED` e só é aplicada após `GOV_TIMELOCK_BLOCKS` (padrão 40.000 blocos, ~11 h).

No lançamento, `GOV_PROPOSE` e `GOV_VOTE` exigem a autoridade fria `owner` da conta Âncora, inclusive o limiar M-de-N. A `witness` quente produz bloco ou atesta, mas não pode autorizar governança. A governança não é ponderada por holders, não há conselho off-chain com poder de protocolo e nenhuma IA tem voto, veto, chave de assinatura ou autoridade de submissão. Um advisor de IA pode apenas redigir; uma Âncora autorizada pelo owner precisa adotar e assinar.

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

Um **trilho anti-brick** reverte automaticamente qualquer alteração de `MIN_VALIDATOR_STAKE` ou `MAX_VALIDATORS` que resultaria em conjunto de validadores vazio, impedindo que a governança inutilize a rede por erro de parametrização.

### 8.4 Slashing

O protocolo implementa penalização por **dupla assinatura**: dois blocos válidos, mesmo produtor, mesma altura, hashes diferentes. A penalidade é 10% do valor em risco — stake ativo **mais** fundos em unbonding, fechando a fuga de fazer unstake após a ofensa —, da qual 10% vai ao denunciante e 90% é queimada. Um nulificador por `ofensor:altura` impede punição dupla pela mesma evidência, e as verificações baratas precedem as duas verificações híbridas caras para evitar amplificação de DoS.

Na mainnet, o slashing por dupla assinatura está ativo desde a altura 0. Builds locais sem o overlay `GENESIS_ACTIVE` podem ainda manter heights distantes.

---

## 9. EAVM — Máquina Virtual e Compatibilidade de Carteiras

A EAVM é a máquina virtual da EAV7. Ela executa bytecode EVM, contabiliza gás e indexa logs e recibos. Na mainnet, publicação, execução e transações EAVM com valor estão ativos desde o gênese.

Os precompilados `0x01`–`0x09` estão implementados, incluindo `modexp`, as operações da curva BN254 (`ecAdd`, `ecMul`, `ecPairing`) e `blake2f`, com o gás cobrado antes da execução para que uma entrada hostil não compre computação que não pagou. O gás é limitado a `MAX_EAVM_GAS` = 5.190.000 por transação; o tamanho de contrato é limitado a 24.576 bytes (EIP-170) e o calldata a 3.072 bytes.

A EAVM expõe um endpoint JSON-RPC que fala o dialeto que as carteiras do ecossistema Ethereum entendem. Chain ID **72020** na mainnet, **72021** na testnet pública. Como carteiras assumem 18 decimais e o protocolo usa 6, a conversão é feita pelo fator `EAVM_WEI_PER_E7` = 10¹²; valores não divisíveis por 10¹² são rejeitados.

Um endereço `0x` é mapeado deterministicamente para um endereço E7. Adicionalmente, o protocolo aceita um destino E7 **codificado dentro do campo de 20 bytes** da transação EVM, com o prefixo `0xe7000000` seguido dos 32 hexadecimais do corpo e checksum do endereço E7 — permitindo que uma carteira comum envie para um endereço nativo com o checksum validado on-chain.

### 9.1 Compatibilidade — declaração precisa

| Método | Situação |
|---|---|
| `eth_chainId`, `net_version`, `net_listening`, `web3_clientVersion`, `eth_syncing` | Implementado |
| `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionCount`, `eth_accounts` | Implementado |
| `eth_sendRawTransaction` | Implementado — decodifica RLP/secp256k1 e re-deriva a transação nativa canônica |
| `eth_getTransactionByHash`, `eth_getTransactionReceipt` | Implementado, com status real, gás consumido e logs vindos do índice de recibos do nó |
| `eth_getBlockByNumber`, `eth_getBlockByHash` | Implementado |
| `eth_call`, `eth_estimateGas` | Implementado — executam sobre um clone do estado, fora de qualquer lock exclusivo |
| `eth_getCode` | Implementado |
| `eth_getLogs` | Implementado, limitado por `MAX_LOG_RANGE` = 5.000 blocos e `MAX_LOG_RESULTS` = 10.000 entradas por consulta |
| `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory` | Implementado (valores derivados; não existe mercado de taxa) |
| `eth_getStorageAt`, `eth_getProof`, `eth_subscribe`, métodos de filtro | **Não implementados** |

**Consequência prática.** Carteiras adicionam a rede, exibem saldos, enviam transferências e interagem com contratos publicados. Bibliotecas cliente conseguem ler estado de contrato e consultar eventos históricos. O que falta é acesso bruto ao storage, provas EIP-1186 e streaming por assinatura ou filtro, de modo que ferramentas dependentes de `eth_subscribe` ou de instalação de filtros precisam fazer polling em `eth_getLogs`. As transações nativas `EAVM_DEPLOY` e `EAVM_CALL` continuam disponíveis e são o caminho usado pelo ferramental do próprio protocolo.

Os limites de faixa e de resultados em `eth_getLogs` são deliberados: uma consulta sem teto varreria a cadeia a cada chamada, que é o vetor clássico de negação de serviço contra esse método.

### 9.2 Padrão de token EAV20

**EAV20 é um contrato Solidity compatível com ERC-20 na EAVM.** Os contratos oficiais imutáveis são publicados via `EAV20Factory`, embora o deploy EAVM comum continue permissionless. `EAV20` é o contrato mínimo para tokens permissionless; `EAV20Managed` adiciona funções administrativas explícitas, como mint, burn, pause, blacklist e permit. As duas formas são nomeadas separadamente para que controles de gestão nunca fiquem escondidos sob um rótulo EAV20 genérico.

As transações nativas `TOKEN_*` permanecem um caminho legado de protocolo. Elas não são o caminho de produto EAV20 e não devem ser apresentadas como forma de criar um token EAV20.

---

## 10. Camada Nativa de Inteligência Artificial

### 10.1 A fronteira que não se cruza

Antes de descrever o que a IA faz na EAV7, é necessário estabelecer o que ela não pode fazer, porque essa é a propriedade de segurança central do projeto.

A EAV7 contém dois conjuntos disjuntos de componentes que a palavra "IA" poderia confundir:

**(A) O protocolo de oráculos de IA** — consenso puro. Tipos de transação, escrow, reputação, quórum, contestação, atestação. É estado de consenso determinístico, replicado e verificável por qualquer nó. Nenhum modelo de linguagem participa da validação: o que a cadeia verifica são assinaturas e concordância de hashes.

**(B) A camada operacional de IA** — zero poder de consenso. Sentinela de segurança, conselheiro de governança, score de validador, roteamento de leitura do gateway e bloqueio de IPs abusivos.

A doutrina aplicada a (B) é explícita e uniforme: **a IA age sozinha apenas onde a ação é operacional e reversível; em tudo que toca consenso, validadores, stake, tesouraria ou código, ela apenas propõe.**

| Componente | Autonomia | Efeito máximo |
|---|---|---|
| Conselheiro de governança | Somente propõe | Redige rascunho de proposta — sem remetente, sem nonce, sem assinatura |
| Score de validador | Somente propõe | Publica métrica de desempenho; jamais remove validador nem toca stake |
| Sentinela de segurança | Somente alerta | Publica alertas classificados por severidade |
| Gateway (roteamento de leitura) | Autônomo, não consensual | Serve **leituras** de um par mais saudável; escritas permanecem locais |
| Guarda anti-abuso | Autônomo, não consensual | Bloqueia IP por TTL com expiração automática; nunca afeta validade de transação |

Não existe caminho de código pelo qual qualquer componente de IA assine ou submeta uma transação. Um rascunho gerado pelo conselheiro precisa ser adotado por uma Âncora humana, autorizado pelo owner ou multisig de owner, submetido, aprovado por dois terços mais um da governança e ainda cumprir o timelock.

### 10.2 O protocolo de oráculos

O fluxo base: `ORACLE_REGISTER` (oráculo registra endpoint e trava stake ≥ 500 EAV7) → `AI_TASK` (solicitante deposita a recompensa em escrow) → `AI_RESULT` (oráculo entrega) → liquidação. A reputação de cada oráculo nasce em 50 e evolui on-chain: **+4** por entrega bem-sucedida, **−12** por resultado derrubado ou não entrega, **−8** por comprometer e não revelar, **+2/−4** para jurados conforme votem com ou contra a maioria.

Na mainnet, os cinco mecanismos-base de garantia estão ativos desde o gênese. A atestação TEE/ZK continua condicionada separadamente (`AI_TEE_HEIGHT` permanece distante):

**Responsabilização.** Não entregando dentro do prazo, o oráculo é penalizado em 10 EAV7 retirados de seu stake travado e creditados ao solicitante como compensação, além do reembolso integral da recompensa.

**Quórum por commit-reveal.** A tarefa pode exigir N oráculos independentes (2 a 21). Cada um publica primeiro `H(saída ‖ salt)` numa janela de compromisso de 30 minutos, e só depois revela. Isso impede que um oráculo copie a resposta de outro. Quando o quórum de revelações concordantes é atingido, a recompensa é dividida entre os concordantes; a minoria divergente perde reputação.

**Verificação otimista com júri.** Um resultado de oráculo único entra em janela de contestação de 30 minutos. Sem contestação, qualquer um pode acionar a liquidação. Contestado — mediante fiança de 20 EAV7 —, um júri de oráculos registrados vota, com partes interessadas explicitamente excluídas. Ao atingir 3 jurados, a maioria simples decide: mantido, o oráculo leva a recompensa **mais** a fiança do contestante; derrubado, o solicitante é reembolsado, o oráculo é penalizado e o contestante recupera a fiança acrescida do prêmio.

**Leilão reverso.** Uma tarefa pode ser aberta com orçamento. Oráculos dão lances de preço; o solicitante adjudica; o excedente do orçamento é devolvido. Tarefa aberta e não adjudicada é reembolsável após a expiração.

**Resultados privados e verificáveis.** O oráculo pode publicar apenas o `resultHash` e, opcionalmente, um URI, mantendo a saída fora da cadeia — cifrada para o solicitante em tarefas privadas. A verificação é `H(saída) == resultHash`. O prompt e os parâmetros de entrada são apagados do estado após a entrega, contendo o crescimento do estado.

### 10.3 Atestação por ambiente confiável

O mecanismo mais forte de aceitação dispensa reputação e janela de contestação. A governança registra um **atestador** — um conjunto de chaves públicas com um quórum e uma *measurement* que identifica o código atestado. Um resultado acompanhado de assinaturas suficientes desse conjunto sobre o digest

```
keccak256( "EAV7-AI-ATTEST" ‖ \x1f ‖ taskId ‖ \x1f ‖ resultHash ‖ \x1f ‖ attesterId ‖ \x1f ‖ measurement )
```

liquida **imediatamente** e é marcado on-chain como verificado. A *measurement* usada no digest é sempre a **registrada em cadeia**, nunca a fornecida pelo remetente — é isso que amarra a assinatura à identidade do código atestado. A contagem de assinaturas deduplica por endereço recuperado e limita as recuperações de curva ao tamanho do conjunto, impedindo tanto inflação por maleabilidade quanto negação de serviço criptográfica.

> **Declaração precisa do modelo de confiança.** A EAV7 verifica on-chain **apenas assinaturas secp256k1 de um conjunto previamente registrado pela governança**. Não existe no protocolo nenhum código de SGX, SEV-SNP, TDX ou Nitro, e nenhum parsing de *quote* DCAP. A verificação da atestação remota do enclave é feita **off-chain, uma única vez, no momento do registro**, pelo operador e pelos validadores que aprovam a proposta de governança. Do ponto de vista da cadeia, a *measurement* é uma string opaca.
>
> Pela mesma razão, o tipo de atestador `ZK` é aceito e verificado de forma **idêntica** ao tipo `TEE` — por assinatura de um verificador registrado. **A camada de IA não verifica provas SNARK nativamente.** A EAVM expõe os precompilados de pareamento BN254, de modo que um verificador publicado como contrato é tecnicamente possível; ligar esse caminho à liquidação de tarefas é trabalho futuro, não capacidade presente.

---

## 11. Ponte Cross-Chain

### 11.1 Mecanismo

A ponte opera por *lock-and-release*. `BRIDGE_OUT` trava o ativo nativo ou o token na cadeia de origem, registrando o destino. `BRIDGE_IN` libera na cadeia de destino mediante prova.

A autoridade de liberação evolui em três eras, cada uma ativada por altura:

| Era | Autoridade para liberar |
|---|---|
| Inicial | Um relayer autorizado |
| Federada (`BRIDGE_QUORUM_HEIGHT`) | Maioria dos relayers autorizados |
| **Atestada por comitê** (`BRIDGE_PROOF_HEIGHT`) | **Quórum de assinaturas do comitê da cadeia de origem sobre o digest do evento** |

No modelo final, a autorização de relayer permanece **apenas como controle anti-spam** — não é mais a autoridade de cunhagem. O digest amarra todos os campos do evento:

```
keccak256( "EAV7-BRIDGE-IN" ‖ \x1f ‖ CADEIA ‖ \x1f ‖ txHashOrigem ‖ \x1f ‖ destino ‖ \x1f ‖ valor ‖ \x1f ‖ token )
```

Uma assinatura colhida para liberar 5 EAV7 não pode liberar 500: o valor está no digest.

A proteção contra replay separa a chave de replay (`CADEIA:txHash`) da chave de atestação (que inclui destino, valor e token). Essa separação tem uma consequência importante: um relayer malicioso que atestar valores incorretos forma um grupo próprio que nunca atinge quórum, **sem bloquear** o quórum honesto sobre o valor correto.

### 11.2 Rotação de comitê e o trilho anti-captura

O comitê da cadeia de origem rotaciona por *handoff* assinado: o comitê **atual** assina a transição para o novo conjunto e época, e as assinaturas precisam atingir o quórum **vigente**.

Uma propriedade de segurança merece destaque: a governança da EAV7 **não pode substituir um comitê ativo**. Uma proposta de governança só é capaz de *criar* um comitê quando nenhum existe para aquela cadeia (bootstrap). A razão é direta — sem esse trilho, dois terços dos validadores da EAV7 poderiam trocar o comitê por chaves próprias e drenar a ponte. Trocar um comitê em operação exige o handoff assinado pela origem.

### 11.3 Disjuntor de velocidade

Um limite determinístico de velocidade complementa o modelo: a soma das liberações de um mesmo ativo dentro de uma janela deslizante de 3.600 blocos (~1 h) não pode exceder uma fração do pool medido no início da janela — padrão **30%**, governável entre 1% e 100%. Excedido, a liberação é **rejeitada** (falha fechada). Cada token possui orçamento independente.

O propósito é converter um cenário de dreno total — comitê ou relayer comprometido — em um vazamento lento e observável. Uma ponte pública com valor econômico exige disjuntor ativo no gênese, comitê de pelo menos três membros, adaptador real, política de confirmações e processo de pausa. Até essas condições serem atendidas, a ponte fica condicionada ou desligada na interface.

### 11.4 Declaração honesta do modelo de confiança

**A ponte não é um light client.** A especificação interna de uma ponte com relay de cabeçalhos, prova de inclusão de Merkle e profundidade mínima de confirmação existe, mas está marcada como proposta, não implementada. O que foi construído tem o comitê assinando o **digest do evento diretamente**, sem cabeçalho, sem prova de Merkle e sem verificação de profundidade de confirmação. A denominação correta é **ponte atestada por comitê**, não ponte trustless.

**A confiança foi deslocada, não eliminada.** Ela migrou do conjunto de relayers para o conjunto de chaves do comitê da cadeia de origem, o que é melhoria real e substancial. Mas um comitê comprometido em quórum ainda consegue cunhar, limitado apenas pelo disjuntor.

**A ponte não custodia valor econômico na mainnet por padrão.** O protocolo define uma interface de adaptador e é agnóstico à cadeia por construção. Um adaptador real, comitê constituído, disjuntor ativo e checklist operacional são pré-requisitos para custodiar valor; adaptador de *loopback* é somente teste. Light client continua roadmap.

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
| Emissão total até a exaustão | 4.036.608.000 EAV7 (**≈ 4,04%** do gênese) |
| Teto teórico de supply | ≈ 104.036.608.000 EAV7, **antes das queimas** |
| Destino das taxas | **100% queimadas** |

A emissão é geometricamente decrescente e converge para zero após 64 halvings. Como toda taxa é queimada, o supply em circulação é `gênese + emitido − queimado`, e sob volume de transações suficiente a queima supera a emissão, tornando a rede líquida deflacionária.

### 12.2 Distribuição do gênese

A distribuição do gênese prioriza o mercado aberto: a parcela pública é **45%**, com Fundação/Tesouraria em **30,25%**, venda privada em **14,75%** e parceiro estratégico em **10%**.

| Bucket | **EAV7** | Tokens | Destino no lançamento |
|---|---|---|---|
| **Distribuição pública** | **45,00%** | 45.000.000.000 | Custódia publicada / `PublicVault` — líquido no TGE / LBP |
| **Fundação / Tesouraria** | **30,25%** | 30.250.000.000 | Stake das Âncoras + 12 partes (1/12 líquido; 11 vestings) |
| **Venda privada** | **14,75%** | 14.750.000.000 | Custódia publicada / `SaleVault` — cliff 12m + linear 24m |
| **Parceiro estratégico** | **10,00%** | 10.000.000.000 | Custódia publicada / `PartnerTrancheVault` — 4 tranches |
| **Total** | **100,00%** | **100.000.000.000** | — |

A parcela sob controle de insiders (Fundação, venda privada e parceiro) soma **55,00%**.

#### Custódia e entrega (mainnet)

Os buckets **não** nascem numa carteira operacional única. No gênese ao vivo, a custódia dia 1 usa endereços publicados até a implantação dos contratos de vault; o caminho de produto pretendido permanece `PublicVault` / `SaleVault` / `PartnerTrancheVault` / vesting de protocolo.

| Bucket | Custódia dia 1 (publicada) | Liberação |
|---|---|---|
| Público (45%) | `E7AADB9206205894E8C8D7A9B6FE6C8320` | Destino líquido da distribuição pública / LBP; o contrato `PublicVault` é o caminho de produto quando implantado |
| Privada (14,75%) | `E7C66510442208FEA89FAFC30BE666CCB0` | Custódia da venda até `SaleVault`; preço Launch **$0,005** (tiers por USD arrecadado até Last call $0,015), travado no intent |
| Fundação (30,25%) | Vesting de protocolo + stakes → tesouraria `E7F2906EA4B2CD23D20180C8E813F2D126` | **7 Âncoras** recebem cada uma `GENESIS_STAKE` = **10.000 EAV7** em stake. O restante (**30.249.930.000 EAV7**) divide-se em **12 partes iguais**: **1/12 líquido no dia 1**; as **11** restantes em vestings com `cliff == duration` em **12, 18, 24, 30, 36, 42, 48, 54, 60, 66 e 72 meses** (liberação em lump no vencimento de cada tramo — **não** “cliff 12 + linear 48”) |
| Parceiro (10%) | `E72F728E69D24CFB91C167A805C6472D40` | Custódia até `PartnerTrancheVault` (4 tranches de **2,5B**, cooldown de 12 meses entre liberações; anti self-deal) |

Preço da venda privada no produto: patamares por USD arrecadado (ex.: Launch $0,005 → … → Last call $0,015), com preço **travado no intent**. A escassez de tier conta apenas intents `paid`/`granted` (pedidos `pending` não empurram o preço).

**Vesting on-contract (produto).** Nos vaults de venda, após o cliff a liberação é linear sobre `(duration − cliff)`, não um lump no instante do cliff. O schedule da **fundação** na mainnet, porém, é o de **12 partes** acima (`cliff == duration` por tramo).

**Ponte no gênese.** `bridgeRelayers` nasce **vazio**. As Âncoras de lançamento **não** são comitê de ponte no dia 1; mesmo com heights de ponte em 0 no overlay `GENESIS_ACTIVE`, a ponte econômica permanece condicionada até adaptador real, comitê e checklist operacional.

**Nomes no gênese.** Nomes EAV-NS das Âncoras foram re-registrados no dia 0; registro de oráculo de IA está disponível (stake mínimo 500 EAV7).

**Sobre builds locais.** Builds locais ainda podem usar um gerador que concentra supply numa única carteira para desenvolvimento. A mainnet materializou o fragmento de buckets (§12.2) com sete Âncoras e o schedule de vesting da fundação descritos acima. Ver Seção 13.

**Sobre o vesting.** Todo bucket não público tem cliff mínimo de 12 meses (ou equivalente em tranches com cooldown de 12 meses, no caso do parceiro), salvo a fração líquida de 1/12 da fundação no dia 1.

### 12.3 Tesouraria

O protocolo suporta direcionar uma fração da recompensa de bloco à tesouraria on-chain, mas o parâmetro nasce em **0%**. Habilitá-lo requer proposta de governança aprovada por dois terços mais um dos validadores e sujeita a timelock, com teto codificado de 50%. Gastos da tesouraria são igualmente feitos por governança.

---

## 13. Estado de Maturidade

Esta seção existe para que nenhum leitor precise inferir o que está pronto. A classificação é conservadora por escolha, e vale para agosto de 2026.

### 13.1 Postura atual

A EAV7 está em **mainnet ao vivo**. O cliente Rust é o cliente de produção: a biblioteca de consenso, o nó completo e o binário de operador `eav7-core` compilam e rodam em Linux, macOS e Windows, com releases por tag publicando arquivos e digests SHA-256 para Linux x64, Linux arm64, macOS arm64 e Windows x64. A integração contínua roda no GitHub Actions sobre o workspace, e os vetores de conformidade em `vectors/` fixam serialização canônica, criptografia, folhas de estado, raízes de estado e comportamento da EAVM.

O código-fonte é público em [github.com/eav7-sys/eav7](https://github.com/eav7-sys/eav7) sob licença MIT. O explorador público está em [eavscan.com](https://eavscan.com). Hash de gênese: `7aa09afcd542e6ec8fd4b977658ed522143991f20a8ce48aab8aca9aeb80e5fb`. Sete Âncoras da fundação produzem desde a altura 0 (uma produtora por VM, malha completa). O perfil `GENESIS_ACTIVE` / heights zero **é** o perfil da mainnet ao vivo.

**Cobertura de testes.** Aproximadamente 1.000 funções de teste em 68 arquivos do workspace Rust, incluindo determinismo por replay de uma cadeia com múltiplos validadores e conformidade contra os vetores congelados.

### 13.2 Ativo na mainnet desde a altura 0

Na mainnet estão ativos desde o gênese: rodízio DPoS e finalidade BFT · produtor estrito, raiz de estado e slashing por dupla assinatura · assinaturas híbridas e identificadores imunes a maleabilidade · contabilidade GB · Assinatura Livre com delegação · staking, unbonding, votação, permissões v2 e governança de Âncora autorizada por owner (`GOVERNANCE_HEIGHT=0`) · tesouraria, vesting e meta-transações · execução EAVM com valor · fases-base de oráculos de IA (`AI_ACCOUNTABILITY` / `QUORUM` / `CHALLENGE` / `MARKET` / `PRIVATE` = 0) · nomes EAV-NS (incluindo re-registro das Âncoras no dia 0) · armazenamento resiliente · e modos do `eav7-core`, inclusive `ancora-init`.

Os contratos de produto `SaleVault`, `PublicVault`, `PartnerTrancheVault` e `TimelockLpSeeder` / EAV20Factory permanecem o caminho pretendido; até a implantação, a custódia dia 1 usa os endereços publicados na Seção 12.2. `GENESIS_ACTIVE` e heights zero descrevem a mainnet; builds locais sem esse overlay podem ainda usar heights distantes.

### 13.3 Condicionado operacionalmente e roadmap

| Recurso | Estado e condição |
|---|---|
| **Atestação TEE/ZK de IA** | Condicionada: `AI_TEE_HEIGHT` permanece distante (100.000.000) até existir atestador real registrado pela governança. On-chain continua verificando assinatura registrada, não enclave ou SNARK nativo. |
| **Ponte com valor econômico** | Condicionada operacionalmente: `bridgeRelayers: []` no gênese; sem adaptador de produção nem comitê. Mesmo com heights de ponte em 0 no overlay, a ponte econômica **não** está aberta até adaptador real, committee ≥3, breaker fail-closed ativo, política de confirmação, pausa e testes e2e. Continua atestada por committee, não trustless. |
| **Skip/miss e downtime** | Upgrade de consenso futuro. Produção estrita, state root e slashing por dupla assinatura já estão ativos; skip/miss não bloqueiam a operação atual. |
| **Certificados de época híbridos** | Fase 2 para consumidores de light client/ponte; não são necessários para a rede em curso. |

Heights de fork são dados de consenso. O binário de mainnet confere seu modo de gênese contra o ambiente e recusa divergência.

### 13.4 Postura de descentralização

O conjunto ativo na mainnet é de **sete Âncoras operadas pela fundação**, produzindo desde a altura 0, até que operadores externos ocupem rumo aos 51 assentos ativos. Rodízio, voto, banco de 50 e ferramental existem, mas é a distribuição de stake que lhes dá sentido. As Âncoras **não** nascem como `bridgeRelayers`.

As metas incluem pelo menos dez Cores ouvintes externos, quinze candidatas com stake próprio no top 101 e maioria do conjunto ativo fora do grupo fundador. O teto ativo é 51; elevá-lo rumo ao teto governável de 101 exige conjunto preenchido, independente e desempenho PQ de finalidade medido.

### 13.5 Roadmap — não implementado ou fora do escopo de produto

- **Raiz de estado incremental.** O custo atual é O(|estado|) por bloco. Substituí-la por árvore persistente, árvore de Merkle esparsa ou estado com cópia sob escrita é pré-requisito para escala de estado relevante.
- **Superfície JSON-RPC restante.** `eth_getStorageAt`, `eth_getProof`, `eth_subscribe` e métodos de filtro.
- **Adaptadores de cadeia da ponte.** Nenhum adaptador de produção existe; o primeiro alvo especificado é uma cadeia externa com comitê de validadores assinado (tipicamente EVM L1).
- **Ponte com light client.** Relay de cabeçalhos, prova de inclusão de Merkle e profundidade mínima de confirmação.
- **Verificação nativa de SNARK na camada de IA.** Os precompilados da EAVM tornam viável um verificador em contrato; o caminho de liquidação não usa nenhum.
- **P2P autenticado.** O transporte atual é HTTP simples atrás de proxies geridos pelo operador.
- **Compactação do formato de bloco.** Material de chave em base64/PEM em todo bloco é caro em disco para o operador; um formato binário com referência de chave pública é um fork planejado.
- **Infraestrutura pública de seeds.** Seeds DNS estáveis e snapshots de bootstrap verificáveis, para que um operador novo não precise sincronizar desde o gênese.
- **Carteira móvel de eleitor.** Stake e voto pelo celular; a produção de blocos continua no Core.
- **EAV721 como produto.** O protocolo de nomes EAV-NS existe na mainnet (incluindo nomes das Âncoras); EAV721 permanece roadmap de produto/explorador e não faz parte da promessa EAV20.
- **Auditoria externa independente.** Ver Seção 14.

---

## 14. Fatores de Risco

Os riscos abaixo são materiais e devem ser lidos por qualquer pessoa que considere adquirir, custodiar ou construir sobre EAV7.

### 14.1 Risco regulatório — o mais relevante deste documento

**A distribuição pública descrita na Seção 12.2 é uma venda de tokens ao público.** Uma oferta dessa natureza tem alta probabilidade de ser caracterizada como oferta pública de valor mobiliário sob a legislação brasileira, sujeita à competência da Comissão de Valores Mobiliários, e sob a legislação dos Estados Unidos pelo teste de Howey. Não é hipótese remota: a SEC dos Estados Unidos já ajuizou ações contra emissores de tokens envolvendo, entre outras alegações, oferta e venda não registrada.

As consequências potenciais incluem exigência de registro prévio, restrição de jurisdições elegíveis, obrigações de verificação de identidade e origem de recursos, responsabilização pessoal dos administradores e nulidade das ofertas realizadas.

**Nenhum conteúdo deste whitepaper substitui aconselhamento jurídico especializado, que deve ser obtido antes de qualquer captação.**

### 14.2 Risco de centralização no lançamento

A mainnet opera com um conjunto de validadores **de sete Âncoras operadas pela fundação** (Seção 13.4), rumo a 51. Com N = 7, o quórum de finalidade BFT é 5; a indisponibilidade de operadores ainda degrada a rede, e um conjunto tão pequeno não oferece resistência significativa a conluio, coerção ou falha correlacionada de infraestrutura. A entidade que o opera pode, na prática, determinar a produção de blocos.

**A EAV7 não é hoje uma rede descentralizada.** A descentralização progressiva é objetivo declarado, com critérios de sucesso definidos, mas é objetivo, não estado presente, e o leitor deve tratar decisões de governança na rede atual como decisões do operador fundador.

O slashing por dupla assinatura **está ativo desde a altura 0** (Seção 13.2): a ofensa é economicamente punida na mainnet.

### 14.3 Risco da ponte

A ponte não deve custodiar valor economicamente relevante até haver adaptador real, comitê de origem de pelo menos três membros, disjuntor ativo e procedimentos de confirmação e pausa testados. Um relayer único ou *loopback* serve somente para demo e teste.

### 14.4 Riscos criptográficos e estruturais

**Espaço de endereços de 112 bits.** O corpo do endereço tem 14 bytes, oferecendo resistência a colisão de aniversário da ordem de 2⁵⁶ operações — abaixo do patamar de 2⁸⁰ hoje considerado confortável. Corrigir invalidaria todos os endereços já emitidos.

**Construção da árvore de Merkle.** A árvore de transações duplica o último nó quando o número de folhas é ímpar e não aplica separação de domínio entre folha e nó interno. Essa construção é conhecida por permitir, em certos protocolos, que conjuntos distintos de transações produzam a mesma raiz. O impacto na EAV7 é limitado pelo fato de o identificador de transação derivar do payload assinado, mas a construção não é a mais robusta disponível.

**ML-DSA é um padrão recente.** O ML-DSA foi padronizado em 2024 e tem histórico de criptanálise pública substancialmente menor que o do ECDSA. A escolha híbrida existe precisamente para que uma falha em qualquer um dos dois esquemas não seja fatal — mas isso é mitigação, não garantia.

### 14.5 Risco de auditoria

O protocolo passou por múltiplas rodadas de revisão adversarial conduzidas internamente com assistência de modelos de linguagem, que identificaram e levaram à correção de vulnerabilidades relevantes — incluindo manipulação de slot de consenso, dreno da ponte, roubo de escrow da camada de IA, maleabilidade de hash de bloco, requisição forjada a partir do servidor por endereços de par não canônicos e negação de serviço por precompilados sem medição de gás e por consultas de log sem teto. As correções estão cobertas por testes de regressão.

**Nenhuma firma de auditoria externa e independente revisou este código.** Revisão interna, por mais rigorosa, não substitui avaliação adversarial independente, e este é risco material para qualquer valor custodiado na rede.

### 14.6 Riscos operacionais e de escala

A recomputação da raiz de estado é O(|estado|) por bloco. Conforme o estado cresce, o custo por bloco cresce proporcionalmente, e existe um ponto em que a produção a cada segundo deixa de ser sustentável. Esse limite não foi caracterizado empiricamente.

O transporte P2P é HTTP não autenticado e depende de proxies ou túneis geridos pelo operador para confidencialidade e controle de acesso. Um operador que exponha a API administrativa sem um token forte expõe o nó.

A camada de IA operacional depende de serviços externos quando configurada para tal; a indisponibilidade desses serviços degrada monitoramento, jamais consenso.

---

## 15. Aviso Legal

Este documento é fornecido exclusivamente para fins informativos e técnicos. Não constitui, e não deve ser interpretado como, oferta de venda, solicitação de oferta de compra, recomendação de investimento, aconselhamento jurídico, tributário, contábil ou financeiro, nem prospecto ou documento de oferta sob qualquer legislação.

**Declarações prospectivas.** Este whitepaper contém declarações sobre planos, roadmap, funcionalidades futuras e resultados pretendidos. Tais declarações refletem expectativas na data de publicação e envolvem riscos e incertezas conhecidos e desconhecidos. Os resultados efetivos podem diferir materialmente. Nenhuma obrigação de atualização é assumida.

**Ausência de garantias.** O software é fornecido "no estado em que se encontra", sem garantia de qualquer natureza, expressa ou implícita, incluindo garantias de comercialização, adequação a finalidade específica, disponibilidade, segurança ou ausência de defeitos. Nenhuma auditoria externa independente foi realizada sobre o código descrito.

**Risco de perda total.** Ativos digitais são de alto risco e alta volatilidade. O valor do EAV7 pode cair a zero. Falhas de software, exploração de vulnerabilidades, perda de chaves privadas, ação regulatória ou descontinuação do projeto podem resultar em perda total e irreversível. Não adquira EAV7 com recursos cuja perda integral comprometa sua situação financeira.

**Restrições jurisdicionais.** A aquisição ou detenção de ativos digitais é restrita ou proibida em determinadas jurisdições. É responsabilidade exclusiva do leitor verificar a legalidade de sua participação sob a legislação que lhe é aplicável.

---

## Apêndice A — Parâmetros de Consenso

Os valores são os declarados em `rust/src/config.rs`, fonte canônica dos parâmetros de consenso.

### A.1 Protocolo e consenso

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
| Validadores ativos | 51 na mainnet (governável, teto 101) |
| Banco standby | Próximas 50 contas elegíveis; top 101 ranqueado no total |
| Stake mínimo de validador | 1.000 EAV7 (governável) |
| Mínimo de validadores para finalidade | 3 |
| Período de unbonding | 604.800 blocos (≈ 7 dias) |
| Máximo de entradas de unbonding por conta | 32 |
| Percentual de slashing | 10% do valor em risco |
| Prêmio ao denunciante | 10% da penalidade |
| Comissão padrão de validador | 20% |
| Atraso para mudança de comissão | 21.600 blocos |
| Percentual de tesouraria | 0% (governável, teto 50%) |
| Recompensa de bloco | 16 EAV7 (governável, teto 1.000) |
| Intervalo de halving | 126.144.000 blocos (≈ 4 anos) |
| Supply de gênese | 100.000.000.000 EAV7 |
| Stake de gênese por validador | 10.000 EAV7 |
| Quórum de governança | ⌊2N/3⌋ + 1 validadores ativos |
| Timelock de governança | 40.000 blocos (≈ 11 h) |
| Máximo de alvos de voto por transação | 30 |
| Limite máximo de taxa | 100 EAV7 |
| Tipos de transação | 58 |

### A.2 Execução, recursos e rede

| Parâmetro | Valor |
|---|---|
| Cota base diária GB | 1.000.000.000 bytes ponderados |
| GB por EAV7 efetivo em stake | +1.000.000 bytes ponderados |
| Transação ponderada mínima GB | 1.024 bytes |
| Ponderação GB | Bytes úteis × fator de tipo legado; assinaturas e ID excluídos |
| Queima por déficit GB | 5 e7 por byte ponderado |
| Janela de regeneração GB | 86.400 blocos (≈ 24 h) |
| EAVM Chain ID | 72020 (mainnet) · 72021 (testnet) |
| Conversão EAVM | 10¹² wei por e7 |
| Máximo de gás EAVM por transação | 5.190.000 |
| Gás por unidade de energia | 100 |
| Tamanho máximo de contrato | 24.576 bytes (EIP-170) |
| Calldata máximo da EAVM | 3.072 bytes |
| Tetos de `eth_getLogs` (faixa / resultados) | 5.000 blocos / 10.000 entradas |
| Máximo do campo `data` da transação | 65.536 bytes |
| Capacidade / TTL do mempool | 5.000 transações / 6 h |
| Gap máximo de nonce futuro | 64 |
| Máximo de pares | 64 |
| Limite de requisições da API | 240 por 10 s |

### A.3 Camada de IA e ponte

| Parâmetro | Valor |
|---|---|
| Stake mínimo de oráculo | 500 EAV7 |
| Penalidade de oráculo | 10 EAV7 |
| Fiança de contestação | 20 EAV7 |
| Quórum de júri | 3 jurados |
| Faixa de quórum de oráculos | 2 a 21 |
| Janelas de commit / reveal / contestação / veredito | 30 minutos cada |
| Timeout de tarefa | 1 hora |
| Máximo de prompt / saída / URI de IA | 8.192 B / 32.768 B / 512 B |
| Máximo de membros de atestador | 32 |
| Janela do disjuntor da ponte | 3.600 blocos (≈ 1 h) |
| Limite do disjuntor da ponte | 30% do pool (governável, 1%–100%) |
| Atestações mínimas da ponte | 1 |

### A.4 Alturas ativas na mainnet

Estas são as alturas do perfil `GENESIS_ACTIVE` / altura zero da mainnet ao vivo. Builds locais sem esse overlay podem ainda usar heights distantes. A ponte econômica permanece condicionada operacionalmente mesmo com heights de ponte em 0 (ver Seção 13.3).

| Altura | Fork |
|---|---|
| 0 | `STRICT_PRODUCER_HEIGHT` · `STATEROOT_HEIGHT` · `SLASHING_HEIGHT` |
| 0 | `VOTING_HEIGHT` · `PERMISSIONS_V2_HEIGHT` · `GOVERNANCE_HEIGHT` |
| 0 | `GB_FEE_HEIGHT` — GB · Assinatura Livre substitui energia/largura de banda |
| 0 | `EAVM_CONTRACTS_HEIGHT` · `EAVM_VALUE_HEIGHT` · `EAVM_OSAKA_HEIGHT` |
| 0 | `AI_ACCOUNTABILITY_HEIGHT` · `AI_QUORUM_HEIGHT` · `AI_CHALLENGE_HEIGHT` · `AI_MARKET_HEIGHT` · `AI_PRIVATE_HEIGHT` |
| 0 | `BRIDGE_QUORUM_HEIGHT` · `BRIDGE_PROOF_HEIGHT` · `BRIDGE_BREAKER_HEIGHT` — heights ativas; ponte econômica ainda condicionada até adaptador/comitê |
| 100.000.000 | `AI_TEE_HEIGHT` — distante até atestador real |

---

*EAV7 · Whitepaper Técnico v1.0 · 11 de agosto de 2026*
