# Paridade com a TRON — o que falta, o que difere, o que decidir

**Status:** rodada 1 de análise concluída (5 agentes) · rodada 2 em andamento (6 agentes, fontes primárias)

Este documento existe para **você decidir**. Ele separa o que já foi implementado, o que eu
recomendo implementar sem consulta, e o que exige decisão de negócio.

Método: cinco agentes leram nosso código e a documentação de desenvolvedor da TRON em paralelo.
Toda afirmação sobre nós tem `file:line`; sobre eles, URL. O que não foi confirmado está marcado.

---

## JÁ IMPLEMENTADO nesta rodada

Quatro correções, todas **verificadas empiricamente** antes e depois — não aceitas por relato.

| Correção | O que estava errado | Verificação |
|---|---|---|
| **Comissão com atraso** (`COMMISSION_DELAY_BLOCKS`, 6h) | Validador subia a comissão para 100% no bloco do seu slot, capturava a recompensa inteira dos eleitores e baixava de volta | Ataque reproduzido: eleitor recebia **zero**. Após a correção, recebe o mesmo de antes |
| **Teto de saques** (`MAX_UNBONDING_ENTRIES`, 32) | `unbonding` sem limite, e o `blockTick` varre o array **inteiro a cada bloco** — DoS de estado controlado pelo atacante | 300 saques de 1 e7 aceitos antes; agora rejeita no 33º |
| **Símbolo de token único** | Qualquer um emitia um segundo "USDT" e personificava o primeiro | Segunda emissão do mesmo símbolo agora é rejeitada |
| **TTL de mempool** (6h, node-local) | Tx com lacuna de nonce nunca executa e nunca é podada — residente para sempre, reintroduzível meses depois | Spam de 50 tx de nonce-futuro: mempool devolvido ao operador |

Duas afirmações dos agentes que **verifiquei e não se sustentaram**:

- *"A isenção de taxa por stake não se aplica a tx nativa"* — **falso**. Ela funciona via energia:
  100 EAV7 em stake dão 100 de energia, e uma transferência custa 1. Taxa efetiva medida: zero.
- *"Recalcular o conjunto de validadores a cada bloco causa rejeição de bloco legítimo"* — **falso**.
  Testei com a ordem invertendo completamente após um voto: 16 blocos, zero rejeições. Produtor e
  validador calculam do mesmo estado determinístico. O custo real é outro (ver abaixo).

---

## RECOMENDO IMPLEMENTAR — sem decisão de negócio

Correções de segurança ou robustez, contidas, sem mudar modelo econômico.

### 1. `eth_call` e `eth_getCode` reais · **crítico**
`src/eavm/rpc.js:120-121` devolvem constantes. `envelope.js:58-59` ainda **rejeita** deploy e
qualquer calldata pela rota EVM. Consequência: temos uma VM funcional que **nenhuma ferramenta
externa alcança** — sem dApp, sem Hardhat, sem token visível em carteira.

Isto sozinho invalida boa parte do valor da EAVM. É a maior lacuna do projeto.

### 2. `eth_getLogs` + recibo real · **crítico**
Ausentes. Recibo devolve `gasUsed` fixo `0x5208` e `status` sempre `0x1` (`rpc.js:171-178`) —
valores fictícios. Sem logs, não há indexador, subgraph nem histórico de transferência de token.

### 3. Custo do `ecrecover`: 500.000 de gás · **alto**
`src/eavm/host.js:27` cobra ~166× o padrão do EVM (3.000). Torna economicamente inviável
qualquer contrato com assinatura: permit (EIP-2612), meta-tx, multisig on-chain, ordens off-chain.

### 4. `BLOCKHASH` (0x40) ausente · **médio**
Único opcode padrão faltando. Qualquer contrato com `blockhash()` trava — commit-reveal,
loteria, VRF caseiro.

### 5. Derivação de `CREATE2` fora do padrão · **médio**
`state.js:934` omite o byte `0xff` do prefixo. Endereços contrafactuais calculados por
`ethers.getCreate2Address` dão errado — carteiras contrafactuais e state channels quebram
**silenciosamente**. É fork de consenso.

### 6. `MSIZE` com semântica errada · **médio**
`vm.js:173` devolve a capacidade física do buffer (dobra em potências de 2), não o tamanho
lógico arredondado a 32 bytes. Divergência de semântica, não só de gás. Fork de consenso.

### 7. Contador on-chain de blocos perdidos · **médio**
A TRON mantém `totalMissed`/`totalProduced` no estado do witness. Nós só temos
`recentProducerMeta()` (`blockchain.js:397`), **node-local e fora do consenso**. Sem dado
on-chain, o eleitor não tem sinal de qualidade do validador — e a "reeleição pelo voto" perde
seu principal insumo.

### 8. Cancelamento de proposta de governança · **médio**
`GOV_VOTE` é irrevogável e não há `GOV_DELETE` (`state.js:1370`). Uma proposta que atinge quórum
entra em timelock de ~11h **sem alavanca de cancelamento**, mesmo que a supermaioria mude de
ideia. O timelock vira uma janela de reação sem meio de reagir.

---

## PRECISA DA SUA DECISÃO

### A. Exchange nativo (AMM no protocolo) · ~~o maior item~~ → **recomendo NÃO fazer**
A TRON tem um DEX **dentro do consenso**: 4 tipos de transação, curva Bancor, criar par custa
1024 TRX queimados. Nós temos **zero**.

**A rodada 2 resolveu esta decisão.** Dois fatos do código-fonte deles:

- O parâmetro `ALLOW_MARKET_TRANSACTION` (#44) está em **0 na mainnet** — o DEX nativo nunca
  foi ligado em produção.
- A partir da versão **4.8.1 ele foi bloqueado**: não pode mais nem ser ativado por proposta.

Ou seja: eles construíram o DEX no consenso, nunca ligaram, e agora fecharam a porta. Copiar
seria importar uma decisão que o próprio autor reverteu.

**Recomendação:** resolver o item 1 (`eth_call`) e deixar o DEX viver em contrato. Mais flexível,
atualizável sem hard fork, e não coloca risco de curva de precificação dentro do consenso.
Continua valendo que hoje **um EAV20 não tem caminho on-chain para virar EAV7** — mas o
destravamento certo é a EAVM, não um AMM no protocolo.

### B. Venda primária de token (ICO nativo)
`ParticipateAssetIssueContract`: o emissor define preço e janela, e o protocolo faz a venda
sem intermediário. Nosso `TOKEN_CREATE` credita 100% do supply ao criador (`state.js:1563`) e acabou.

- **Contra:** venda de token no protocolo tem implicação regulatória direta — é o mesmo terreno
  do whitepaper. Não implementaria sem parecer jurídico.

### C. Teto global de recursos (congestion pricing)
A TRON rateia um teto fixo da rede: `Energy = (seu stake / stake total) × 180.000.000.000`.
Nós emitimos recurso **absoluto e ilimitado**: `maxEnergy = FREE + stake` (`state.js:112`).

Sem teto global, o custo marginal de throughput **não sobe com a demanda** — não há como
precificar escassez de bloco. Um whale tem capacidade constante independentemente da rede.

- **A favor:** é o mecanismo que faz a rede se auto-regular sob carga
- **Contra:** muda o modelo econômico inteiro e a experiência de todo usuário
- **Minha leitura:** é a diferença estrutural mais importante da lista, e a que mais merece
  discussão antes de qualquer código.

### D. Stake tipado por recurso
Na TRON escolhe-se stakear **para** energia ou **para** banda, com pools disjuntos. Aqui um
único stake alimenta os dois (`state.js:112-119`) — 1 EAV7 rende recurso duas vezes.

### E. Trava temporal na delegação (`lock_period`)
Sem ela, o locador revoga o recurso no bloco seguinte ao pagamento — **aluguel de energia**
(negócio real e volumoso na TRON) não é construível sobre nós.

### F. SR partners (28º ao 127º)
A TRON paga 100 validadores de reserva para ficarem prontos. Aqui, cair do 27º para o 28º
significa perder **100% da receita** — a fronteira do ranking vira alvo de manipulação lucrativa,
e não há incentivo para manter nós de reserva sincronizados.

### G. Taxa de ativação de conta
A TRON queima 1 TRX para criar conta. Nós materializamos conta de graça (`state.js:95-102`) —
pulverizar poeira para 10⁶ endereços infla o estado permanentemente por custo quase zero.

- **Tensão:** nossa meta-tx patrocinada existe justamente para onboarding sem fricção. Uma taxa
  de ativação vai na direção oposta.

### H. Candidatura explícita de validador
A TRON cobra 9.999 TRX **queimados** para se candidatar, com URL obrigatória. Aqui é implícito:
`staked >= MIN_VALIDATOR_STAKE`. Sem custo irrecuperável, o anti-sybil é fraco (stake volta);
e sem metadados, o eleitor vota em endereços anônimos.

### I. Expiração de transação
A TRON tem `expiration` + `ref_block`. Nós temos nonce sequencial, que **cobre replay em fork**
(um reorg reverte o nonce junto com o saldo) mas **não** cobre reexecução tardia: uma tx assinada
é válida para sempre enquanto o nonce não for consumido.

Já mitiguei o lado node-local (TTL de mempool). O campo no payload é mudança de consenso —
decide se vale.

### J. Período de manutenção (epoch)
A TRON recalcula o conjunto de SRs a cada 6h; nós, a cada bloco. **Não causa rejeição de bloco**
(verifiquei), mas tem dois custos reais:
- O(nº de contas · log n) de ordenação **por bloco**, a 1 bloco/s
- A ordem de produção é **publicamente previsível para sempre** → DoS dirigido ao próximo produtor

### K. Gás patrocinado pelo contrato (`consume_user_resource_percent`)
Permite ao deployer pagar o gás do usuário. É o mecanismo que fez o USDT-TRC20 dominar — onboarding
sem o usuário precisar do token nativo. Não temos equivalente.

---

### L. Ativação de fork por VOTO, não por altura · **novo, e mexe com pendência real nossa**
Nós ativamos fork por altura fixa (`FORK_HEIGHTS`). A TRON ativa por **proposta aprovada pelos
validadores**: toda a linha de upgrade da TVM (Constantinople → Istanbul → London → Shanghai →
Cancun) entrou assim, como flag `ALLOW_*` no estado.

Isso importa agora porque temos **forks dormentes aguardando rollout coordenado**
(`BRIDGE_QUORUM_HEIGHT`, `CANONICAL_HASH_HEIGHT`, breaker, `AI_TEE`). Altura fixa exige que todo
mundo atualize o binário *antes* daquele bloco, ou cinde a rede. Ativação por voto dispensa a
coordenação: liga quando o quórum aprova, e quem não atualizou simplesmente para de seguir.

- **A favor:** elimina a janela de coordenação, que é exatamente o que está travando nosso rollout
- **Contra:** dá aos validadores poder sobre *quando* a regra muda, não só sobre parâmetros
- **Minha leitura:** vale discutir. É a melhoria de processo mais concreta que apareceu.

### M. Energia dinâmica (contrato popular paga mais)
Contrato cujo consumo passa de um limiar tem o custo multiplicado, até **4,4×**, decaindo 5% por
ciclo ocioso. O TIP deles justifica por concentração de CPU e tráfego fraudulento.

É um mecanismo anti-spam que não temos. Mas note a tensão com o item K: um multiplicador sobre
contratos populares empurra na direção oposta de gás patrocinado.

---

## NOVO — onde superar é mais barato que igualar

O levantamento da API achou uma fraqueza estrutural da TRON que **já podemos explorar**.

O JSON-RPC deles é **efetivamente read-only**: de 53 métodos anotados, 14 lançam
`MethodNotFound` — entre eles **`eth_getTransactionCount` e `eth_sendRawTransaction`**. Não é
omissão, é consequência do modelo: a TRON não tem nonce por conta (usa `ref_block` + `expiration`).
Resultado: **nenhuma ferramenta Ethereum escreve na TRON sem TronWeb.** MetaMask, ethers.js,
Hardhat — todos precisam de adaptador.

**Nós temos nonce sequencial.** Suportar `eth_getTransactionCount` e `eth_sendRawTransaction`
nativamente faz a stack EVM inteira funcionar direto. E é uma vantagem que **eles não podem
copiar sem mudar o modelo de transação**.

Isso reforça a prioridade dos itens 1-2: não é só tapar buraco, é o caminho mais barato para
uma vantagem competitiva real.

### Separação por nível de finalidade (recomendo adotar)
A TRON expõe três namespaces HTTP — `wallet` (head), `walletsolidity` (~2/3 dos validadores,
~57s), `walletpbft` (commit explícito). O cliente escolhe tolerância a reorg **pela URL**.

O detalhe que faz funcionar: **não existe endpoint de escrita no namespace solidificado.** Não é
convenção, é estrutural — um cliente mal configurado falha em vez de escrever no lugar errado.
Transforma política de risco de exchange numa escolha de URL.

Temos finalidade BFT (`⌊2N/3⌋+1`). Replicar custa pouco e elimina uma classe inteira de erro
de integração.

### Não igualar em número de endpoints
Dos 129 endpoints do full node deles, **25 são shielded/zk** (domínio desativado por governança),
4 são Stake 1.0 legado, e vários são pares redundantes. A superfície funcional real é ~60-70.
Igualar a contagem seria perseguir dívida técnica.

---

### N. Taxas: queimar ou pagar validador? · **decisão econômica de fundo**
Verificado ao vivo: na TRON, **100% das taxas são queimadas. Nada vai para os validadores.**
O pool de redistribuição existe implementado (`ALLOW_TRANSACTION_FEE_POOL`) e **nunca foi ligado**.

Consequência: a segurança da TRON é financiada **inteiramente por emissão nova** — ~1,43 bilhão
de TRX/ano, ~1,5% do supply. Não existe nada parecido com EIP-1559.

O balanço deles: na janela 2021-2026 foram claramente deflacionários (16,2 bi queimados contra
~9,4 bi emitidos). Mas a conta **virou recentemente** — o preço da energia caiu de 420 para
100 sun e a queima despencou. Amostragem instantânea sugere inflação líquida hoje.
*(A amostra foi de poucos minutos; trate como ordem de grandeza, não como número anual.)*

Para nós a pergunta é direta: **o orçamento de segurança da EAV7 vem de emissão ou de taxa?**
Herdar o modelo deles significa aceitar inflação permanente como custo de segurança.

---

## PARA PORTAR — desenho deles que é melhor que o nosso

### O acumulador `vi` de recompensas · **recomendo adotar**
Resolve "recompensa acumulada sem iterar épocas" em **O(1) por validador votado**, em vez de
O(ciclos × votos). É o padrão MasterChef/Synthetix:

```
vi(validador, ciclo) = vi(validador, ciclo−1) + recompensa × 10^18 / votos
recompensa_do_eleitor = ( vi(fim) − vi(início) ) × meus_votos / 10^18
```

`vi` só cresce; guarda "ganho por unidade de voto desde sempre". O eleitor que não saca há
mil ciclos paga o mesmo custo de quem sacou ontem. Com `BigInteger` e ponto fixo de 10^18,
sem `double` em caminho de consenso.

Vale portar diretamente — é desenho maduro e resolve um gargalo real de escala.

### Grafo de dependência entre forks
Já citado acima; repito aqui por ser barato de implementar e evitar um modo de falha silencioso.

---

## VERIFICAÇÕES QUE EU MESMO RODEI NESTA RODADA

**Travamento de conta por permissão.** A TRON não verifica que o dono esteja entre as chaves —
dá para travar a conta permanentemente. Testei os quatro cenários no nosso código:

| Configuração | Nosso resultado |
|---|---|
| Soma dos pesos < limiar | **rejeitado** — `soma dos pesos < threshold (conta ficaria travada)` |
| Zero chaves | **rejeitado** — `nº de keys inválido` |
| Limiar zero | **rejeitado** — `threshold inválido` |
| Dono fora das chaves | **aceito** |

O quarto caso é aceito **de propósito**, não por descuido: exigir que o dono esteja entre as
chaves quebraria rotação legítima de chave e delegação a custodiante. É exatamente o cenário
que o `recovery` existe para cobrir. Registro como propriedade deliberada, não como buraco.

**Maleabilidade na contagem de peso multisig.** A TRON corrigiu isto silenciosamente na v4.7.1,
num release rotulado "não-obrigatório" cujas notas nem mencionam mudança de consenso: a
deduplicação de assinaturas usava **o base64 da assinatura** em vez do endereço recuperado, então
uma assinatura maleável do mesmo signatário **contava peso duas vezes**. É a mesma classe do
nosso achado M1.

Verifiquei o nosso: `state.js:1553` deduplica por `pending.approvals[tx.from]` — endereço, não
bytes — e rejeita explicitamente aprovação repetida. **Imunes por desenho**, não por sorte.

**Convergência independente, terceira ocorrência.** O `brokerage` da TRON é gravado num slot
pendente e só passa a valer no ciclo seguinte — pelo mesmo motivo que implementei o
`COMMISSION_DELAY_BLOCKS`: impedir que o validador eleve a comissão retroativamente sobre
recompensa já acumulada. Cheguei lá pela análise do nosso ataque, sem conhecer o mecanismo deles.

---

## O QUE ELES TENTARAM E ABANDONARAM — a parte mais útil do levantamento

### Slashing: eles especificaram e mataram em 46 segundos
**TIP-412, "TRON Slashing"** — proposto por um autor `@tron.network` em 2022-06-06:
*"se o SR tem desempenho ruim, como taxa de blocos perdidos muito alta, seu stake é reduzido
numa porcentagem e ele é marcado como jailed."*

Fechado como `NOT_PLANNED`, **zero comentários, 46 segundos depois da abertura**. Junto com
outros dois TIPs internos na mesma janela. Nenhuma justificativa registrada.

**A TRON não tem slashing até hoje.** Sete anos, nenhuma punição para validador bizantino.

Isso reposiciona nossa vantagem nº 2: deixa de ser "temos algo a mais" e vira "temos algo que
o líder do setor tentou e desistiu". **Mas só se ativarmos** — hoje o nosso nasce desligado, e
enquanto estiver assim a vantagem é de papel, exatamente como registrei na auditoria.

### O aviso que vale mais para nós: forks dormentes viram dívida permanente
A TRON entregou código de consenso em release obrigatório e **depois** descobriu que os
validadores não ligariam. `ALLOW_ADAPTIVE_ENERGY` está em **zero desde 2018**. Doze flags
implementadas e nunca ativadas. Cada uma é um caminho de código que precisa continuar correto
e testado para sempre, sem nunca ter executado em produção.

O caso mais caro: **TIP-127**, um DEX com livro de ordens completo, construído dentro do
consenso, **nunca ligado**, e revogado na v4.8.1. Anos de engenharia descartados.

Nós temos **quatro forks dormentes** (`BRIDGE_QUORUM_HEIGHT`, `CANONICAL_HASH_HEIGHT`, breaker,
`AI_TEE`). A lição é direta: **decidir a ativação antes do merge, não depois.**

### Caminho de fork de emergência · **recomendo copiar**
Eles têm duas taxas de adoção: **80%** dos validadores para mudança normal, e **70%** para
hotfix de consenso. Duas versões usaram o caminho reduzido, ambas correções urgentes.

Melhor ainda: três versões (27, 33, 35) ativam **puramente por adoção de validador, sem voto
nenhum** — são correções que eles classificaram como não-negociáveis.

Ter um trilho rápido separado do trilho de governança é desenho maduro. Não temos.

### Detalhes pequenos que valem copiar
- **Catraca no período máximo de trava:** a proposta só é válida se o valor **aumentar**.
  Garantia anti-rug para quem alugou recurso. Está só no código, em nenhuma prosa.
- **Aprovação de proposta não é monotônica** — a proposta #23 teve **20 aprovações e mesmo
  assim foi reprovada**, porque aprovadores caíram do top-27 antes da apuração e seus votos
  foram descartados em silêncio. Se copiarmos apuração por conjunto ativo, isso precisa ser
  explícito, não surpresa.
- **Cuidado com o nosso breaker:** eles tentaram desligar um recurso transformando-o em
  precompile que falha, e recuaram — o caminho de falha **queimaria toda a energia restante
  do chamador** a cada chamada bloqueada. Desligar deve retornar sucesso-e-reverte, não falha.

### Sobre a qualidade das fontes
**57% das propostas on-chain deles falharam** (41 reprovadas + 16 canceladas de 106). A API do
Tronscan **omite 39 delas** — quase todas as fracassadas. O `README` de propostas do repositório
lista **apenas as efetivadas**. Só o nó direto mostra o histórico real.

Duas contradições onde o código venceu a documentação: o limiar de proposta é **18** de 27, não
19 como diz o README deles; e a solidificação são **18 blocos-filho**, não 19 como diz o TIP-62.

---

## NÃO RECOMENDO COPIAR

- ~~**TRC10 como token nativo separado**~~ — **eu estava errado aqui.** Escrevi que "nosso EAV20
  nativo já é o melhor dos dois". Só seria verdade se o nosso caminho de contrato funcionasse.
  A TRON tem o legado morto (TRC10) **e** o caminho vivo (TRC20 em Solidity, que é o que o
  ecossistema inteiro usa — o USDT deles é TRC20). Nós temos só o legado, porque a EAVM está
  trancada (item 1). Não é o melhor dos dois: é exatamente o lado que morreu lá.
  Corrigido em 2026-07-20, depois de tentar construir a aba de contrato e não achar código
  para mostrar.
- **Stake 1.0 coexistindo com 2.0** — dívida técnica deles. Nascemos com modelo único.
- **Endereço de 21 bytes com prefixo 0x41** — é o que torna a TRON incompatível com MetaMask.
  Nossa solução (E7 embutido nos 20 bytes com checksum) é estritamente melhor.
- **Saque manual pós-unbonding** (`WithdrawExpireUnfreeze`) — nosso crédito automático é melhor UX.

---

## ONDE JÁ SOMOS MELHORES

Registrado para não perdermos de vista o que **não** deve ser sacrificado por paridade:

1. **Criptografia pós-quântica** obrigatória — eles não têm nada
2. **Slashing por dupla assinatura** — a TRON não pune SR bizantino de forma alguma
   *(ressalva: o nosso nasce desativado; hoje é vantagem de papel)*
3. **`stateRoot` no header** com provas de conta para light client — eles não commitam estado
4. **Recuperação de chave, timelock e veto nas permissões** — inéditos
5. **Camada de IA nativa** (12 tipos de tx), **ponte no consenso**, **EAV-NS**
6. **Tesouraria on-chain** e **trilho anti-brick** na governança
7. **Ledger unificado 0x ↔ E7** — um livro só, contra dois mundos com conversão explícita
8. **Bloco de 1s** contra 3s
9. **Nonce por conta** — permite `eth_sendRawTransaction`, que a TRON não consegue oferecer
10. **Timelock na governança** — na TRON, proposta aprovada **aplica no mesmo período de
    manutenção**, sem janela de reação. Nosso timelock de ~11h é vantagem real
    *(mas ver item 8: falta a alavanca de cancelamento que torna a janela útil)*

**Confirmação incidental:** o teto de 32 saques pendentes que implementei nesta rodada é
**exatamente o mesmo número da TRON** (`getavailableunfreezecount`). Cheguei nele por análise
do nosso DoS, sem conhecer o valor deles. Convergência independente.

**Dois defeitos deles que não devemos herdar:**
- `ENERGY_FEE` e `EXCHANGE_CREATE_FEE` **não têm validação nenhuma** de faixa — proposta aprovada
  pode setar preço de energia para qualquer int64, **inclusive negativo**. Se espelharmos algum
  parâmetro governável, valide os limites.
- **Grafo de dependência entre forks** — este, ao contrário, **vale copiar**: eles recusam
  proposta fora de ordem (ex.: Prague exige Shanghai, porque o bytecode contém `PUSH0` e travaria).
  Nosso `FORK_HEIGHTS` não tem essa checagem.

---

## Sequência que eu proponho

1. **Itens 1-3** (`eth_call`, `eth_getLogs`, custo do `ecrecover`) — desbloqueiam o ecossistema
   inteiro e não dependem de nenhuma decisão sua
2. **Itens 4-8** — correções contidas de consenso e governança
3. **Decisões A-K** — depois da rodada 2, quando tivermos a especificação completa

### Estado da rodada 2

| Levantamento | Estado |
|---|---|
| Parâmetros de governança | **Pronto** — 77 exatos (não ~80), do `enum ProposalType` do java-tron 4.8.2 |
| Superfície de API | **Pronto** — 228 endpoints HTTP + 53 métodos JSON-RPC, extraídos dos registros de servlet |
| Opcodes e custos de energia da TVM | **Pronto** — com verificação cruzada que corrigiu 3 erros do próprio relatório |
| Specs campo a campo de ContractType | **Pronto** — 38 dos 41 tipos (3 nunca foram implementados por eles) |
| Fórmulas de economia e recurso | **Pronto** — com valores de mainnet ao vivo, não só defaults de código |
| Índice de TIPs e forks | **Pronto** — 145 TIPs, 36 versões de fork, 106 propostas on-chain |

**Rodada 2 completa.** Fontes: `tronprotocol/tips` e `java-tron` clonados, mais consultas ao vivo
à mainnet. Onde a documentação deles contradiz o código, o código venceu — e está anotado.

### Armadilha que atravessa todo o levantamento

Para **cada** parâmetro existem dois números: o *default do código-fonte* e o *valor vigente em
mainnet*, alterado por proposta. Confundir os dois é a origem de quase toda desinformação sobre
a TRON na web — e seria nosso erro por omissão se copiássemos o código sem aplicar as propostas:

| Parâmetro | Default no código | Mainnet real |
|---|---|---|
| Recompensa de bloco | 32 TRX | **8 TRX** (4× menor) |
| Banda gratuita | 5.000/dia | **600/dia** (8× menor) |
| Teto global de energia | 50 bi | **180 bi** (3,6× maior) |
| Taxa de criação de conta | 0 | **1 TRX** |
| Preço da banda | 10 sun/byte | **1.000 sun/byte** (100× maior) |

Herdar os defaults daria à EAV7 uma economia que **nunca existiu em produção**.

Mais uma, específica nossa: o `windowSize` do decaimento de recurso é **derivado do intervalo
de bloco** (`86.400.000 / 3.000 = 28.800` slots). Nosso bloco é de 1s, não 3s — se portarmos a
fórmula, o número muda junto ou a economia inteira se desloca.

Os arquivos completos de cada levantamento estão em
`/private/tmp/claude-501/-Users-jonathancardinalle-Blockchain/ca3ed1d4-.../tasks/*.output`.
