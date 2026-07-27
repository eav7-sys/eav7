# Permissões v2 — níveis, limiar e recuperação de chave

**Status:** IMPLEMENTADO sob `PERMISSIONS_V2_HEIGHT` · Mudança de CONSENSO, gated por altura

Origem do desenho: a estrutura (níveis, limiar, pesos, `witness`, escopo de operações) vem da
documentação de desenvolvedor da TRON e do código do java-tron — o whitepaper deles não trata
do assunto. A **recuperação por `recovery`, o timelock e o veto não existem na TRON**: são nossos.

## Por que

O modelo atual (`PERMISSIONS_HEIGHT`) tem um único conjunto por conta: `{ threshold, keys{endereço:peso} }`.
Ele resolve multi-assinatura, mas deixa três buracos:

1. **Perda de chave é perda total.** Não existe caminho de recuperação. É o modo de falha que
   mais destrói valor em blockchain — a estimativa mais citada (Chainalysis) é de que ~20% do
   Bitcoin existente está perdido. TRON e EOS também não têm recuperação.
2. **A chave que assina bloco é a chave que guarda o stake.** Em `block.js:10-12` o cabeçalho
   carrega `publicKey`/`pqPublicKey` do produtor, e `producer` é derivado dessas mesmas chaves.
   Um validador que produziu um bloco tem as duas chaves públicas expostas para sempre — e é
   com elas que ele custodia stake, votos e fundos.
3. **Validador não pode ter permissões.** `state.js:1140` exige `staked == 0` para virar
   multisig, porque `VOTE` não é operação multisig e o voto ficaria travado.

## Os quatro níveis

| Permissão | Chaves | Limiar | Move fundos | Age sozinha | Existe em |
|---|---|---|---|---|---|
| **owner** | até `MAX_PERMISSION_KEYS` | configurável | Sim | Sim | conta configurada |
| **active** | até `MAX_PERMISSION_KEYS` | configurável | Sim | Sim | conta configurada |
| **witness** | 1 | — | **Não** | Só assina bloco | só validador |
| **recovery** | **1** | — | **Não** | **Não — só vota** | opcional |

`root` não é um nível: é o **estado inicial**, quando `permissions[endereço]` não existe. A conta
funciona com uma chave, uma assinatura, sem atraso — exatamente como hoje. O explorer e a carteira
**sintetizam** a exibição (`{ limiar: 1, chaves: [{ conta, peso: 1 }], padrão: true }`) sem gravar
nada no estado: `computeStateRoot` é O(|estado|) por bloco, e materializar um registro por conta
pioraria diretamente o gargalo de escala já conhecido.

**Nada existe acima do `owner`.** Configurar permissões substitui o padrão; não acrescenta camada
sobre ele. Um nível com poder irrestrito e instantâneo anularia o timelock, o veto e a recuperação.

## Regras de autorização

| Operação | Quem autoriza | Timelock |
|---|---|---|
| Mover fundos | `active` (ou `owner`), no limiar | Não |
| Trocar `active` | `owner`, no limiar | Curto |
| Trocar `owner` | `active` **+** `recovery` | Configurável, mín. imposto |
| Trocar `recovery` | `owner` **+** `active` | Médio |
| Trocar `witness` | `owner`, no limiar | Curto |
| Assinar bloco | `witness` | Não |

**Veto:** qualquer mudança enfileirada pode ser cancelada pelo `owner` **no limiar dele**.
Deliberadamente não é "qualquer chave de owner sozinha": senão um ladrão com uma única chave
bloquearia a recuperação legítima indefinidamente — comprometimento parcial viraria refém eterno.

**Uma pendência estrutural por conta.** Nova proposta cancela a anterior. Isso também dá o
caminho de aborto sem inventar transação de cancelamento.

## Fluxo de recuperação

```
active + recovery  →  propõe novo owner
                   →  timelock (configurado pelo dono, mínimo do protocolo)
                   →  owner vigente pode vetar, no limiar dele
                   →  aplica
```

| Cenário | Resultado |
|---|---|
| Perdeu o `owner` (backup frio destruído) | `active` + `recovery` nomeiam novo owner ✓ |
| Roubaram só o `recovery` | Nada — não age sozinho ✓ |
| Roubaram só a `active` | Não troca owner sem o recovery; owner rotaciona a active ✓ |
| Roubaram `active` + `recovery` | Propõem, mas o `owner` veta ✓ |
| Roubaram os três | Perdido — três depósitos independentes violados |
| **Perdeu `owner` e `active`** | **Perdido** — recovery sozinho não faz nada |

A última linha é **escolha consciente**, não esquecimento. Cobrir também esse caso exigiria
recovery com M-de-N guardiões agindo sozinhos, o que traz risco de conluio e complexidade de
produto. O caminho, se um dia for desejado, é permitir mais de uma chave no `recovery`,
mantendo o padrão em uma.

## Modelo de dados

```js
// state.permissions[endereço] — ausente = root (chave única, comportamento atual)
{
  owner:    { threshold: n, keys: { end: peso }, scheme?: 'eav7-hybrid-1' },
  active:   { threshold: n, keys: { end: peso }, scheme?: ... },
  witness?: { key: end },        // só validador; 1 chave, sem limiar
  recovery?:{ key: end },        // 1 chave, sem limiar, sem poder próprio
  delayBlocks: n,                // timelock escolhido pelo dono
}

// state.pendingPerm[endereço] — no máximo UMA
{ change, approvals{}, executeAt, proposedAt }
```

`contracts[].balance` permanece intocado. A serialização de `permissions` **muda**, então o fork
é gated por altura e entra em `FORK_HEIGHTS` (zero no gênese-ativo).

## Transações

| Tipo | Efeito |
|---|---|
| `PERMISSION_UPDATE` | Mantido — primeira configuração, por assinatura única |
| `PERMISSION_PROPOSE` | Propõe mudança estrutural; entra na fila com timelock |
| `PERMISSION_APPROVE` | Assinatura adicional de outro nível (ex.: recovery completando a active) |
| `PERMISSION_VETO` | Cancela pendência; exige limiar de `owner` |
| `MULTISIG_PROPOSE` / `MULTISIG_APPROVE` | Mantidos, com o conjunto de ops ampliado (abaixo) |

## Bloqueios do código atual que precisam cair

**1. `staked == 0` para virar multisig** (`state.js:1140`). Sem remover, validador nunca terá
`witness` — que é o principal ganho de segurança desta proposta. A restrição existe porque
`VOTE` não é operação multisig e o voto ficaria preso.

**Pré-requisito:** ampliar as ops multisig com `VOTE`, `SET_COMMISSION` e `CLAIM_VOTER_REWARD`.
Só então remover a trava. Fazer na ordem inversa trava validadores.

**2. Guarda de assinatura única** (`state.js:780`). Hoje qualquer conta com permissão é obrigada
a usar MULTISIG_PROPOSE/APPROVE. Com níveis, uma `active` de limiar 1 deve poder assinar direto —
senão o uso cotidiano fica burocrático e a proposta cobra pedágio no caminho comum, que é
exatamente o que rejeitamos ao longo do desenho.

## Trilhos de segurança

- **Anti-trava na proposta E na execução.** O estado muda durante o timelock: uma configuração
  segura ao propor pode inutilizar a conta ao aplicar. Revalidar no `blockTick` e descartar em
  vez de brickar — mesmo padrão do trilho anti-brick da governança (`state.js:462-466`).
- **Soma dos pesos ≥ limiar** em cada nível, como já validado em `#normalizePermission`.
- **Conta sempre precisa de caminho de gasto.** Recusar configuração sem `owner` ou `active` viável.
- **Validador sob timelock não pode travar a rede.** Por isso `witness` é rápida e sem fila.
- **Ops pendentes invalidadas** quando a permissão muda — comportamento já existente, manter.

## Vetores de ataque a cobrir em teste

| Vetor | Defesa esperada |
|---|---|
| Ladrão com 1 chave de owner (limiar 2) | Não age, não veta, não bloqueia recuperação |
| Ladrão com `recovery` | Nada — sem par, sem poder |
| Ladrão com `active` + `recovery` | Owner veta dentro do timelock |
| Ladrão propõe e re-propõe para renovar o timelock | Uma pendência por conta; veto encerra |
| Config que remove o único caminho de gasto | Rejeitada na proposta e na execução |
| `witness` tentando mover fundos | Rejeitada — não é autoridade de gasto |
| `recovery` agindo sozinho | Rejeitado |
| Validador multisig com voto preso | `VOTE` como op multisig antes de remover a trava |
| Permissão trocada com op multisig pendente | Ops invalidadas |

## Sequência de implementação

1. Ampliar ops multisig: `VOTE`, `SET_COMMISSION`, `CLAIM_VOTER_REWARD` — **sem** mexer em permissões
2. Testes provando que validador multisig não perde voto nem stake
3. Remover a trava `staked == 0`
4. Modelo de níveis + `PERMISSION_PROPOSE/APPROVE/VETO`, fork-gated
5. `witness` no consenso de produção de bloco (mudança em `block.js` e `blockchain.js`)
6. Padrão `root` sintetizado na API e no explorer (sem consenso, pode ir antes de tudo)
7. Suíte de ataque completa

Os passos 1-3 são pré-requisito e podem ser feitos e testados isoladamente. O passo 6 é
independente e sem risco.

## Escopo de operações na `active`

Equivalente ao bitmap de 32 bytes que a TRON mantém sobre os IDs de contrato — aqui uma
LISTA de tipos nomeados, porque nosso conjunto é pequeno e clareza vale mais que os bytes
economizados num registro raro.

```js
active: { threshold, keys, operations?: ['TRANSFER', 'VOTE', …] }
```

Ausente = tudo liberado (retrocompatível). `PERMISSION_CHANGE` **não é escopável**: conta v2
só troca permissão pelo caminho com timelock e veto, e permiti-lo aqui reabriria o desvio.
Conferido na proposta E na execução — a permissão pode mudar no intervalo.

## Slashing sob `witness` — o furo que faltava

O `witness` separa a chave que assina da conta que tem stake. `SLASH_DOUBLE_SIGN` punia
`blockA.producer`, que passaria a ser a chave de produção — **sem stake**, deixando a
equivocação impune. Como o slashing nasce desativado, nenhum teste existente pegaria.

Resolução: o infrator é `producerAccount ?? producer`; os dois blocos precisam apontar
para a MESMA conta; e a evidência só vale se a conta REALMENTE delegou àquela chave
(`permissions[conta].witness === producer`). Se o witness foi rotacionado desde então, a
evidência não é verificável e falha FECHADA — melhor não punir do que punir inocente.

## Fora de escopo

- Guardiões M-de-N (recovery permanece com 1 chave, por decisão)
- Múltiplas permissões `active` (a TRON permite 8; temos 1)
- Nome da permissão (a TRON permite ≤32 bytes)
- Esquema de assinatura por chave (SLH-DSA na recovery) — desejável, fica para depois
- Limites quantitativos por chave

## Riscos assumidos

**É mudança de consenso profunda**, tocando a área que já produziu achados de auditoria
(META_TX burlando guarda multisig; op multisig `UNSTAKE` travando stake). Merece auditoria
dedicada antes do lançamento.

**A recuperação só ajuda quem configurar.** Se estiver enterrada em ajustes, protege uma
fração dos usuários. É problema de carteira, não de protocolo — mas define se todo este
trabalho tem efeito prático.
