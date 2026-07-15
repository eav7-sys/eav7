# EAV7 — Escala do estado: raiz incremental + estado copy-on-write

Status: **design / dívida agendada** (não implementado). Motivo: o custo por bloco é
O(estado) por causa de DUAS operações que varrem o estado inteiro a cada bloco — o
`clone()` do estado e o `computeStateRoot()`.

## O problema, medido

Benchmark (1 bloco/s; `clone` = `structuredClone` de todas as seções; `stateRoot` =
Merkle sobre todas as folhas):

| Contas | stateRoot | clone | total/bloco |
|-------:|----------:|------:|------------:|
| 1.000 | 3ms | 3ms | ~6ms |
| 10.000 | 25ms | 11ms | ~36ms |
| 100.000 | 273ms | 120ms | ~390ms |
| 500.000 | 1.700ms | 800ms | ~2,5s (> bloco de 1s) |

**Gatilho:** vira gargalo perto de **~100k contas**; acima de ~200k a cadeia não
sustenta 1 bloco/s. Abaixo de ~50k é irrelevante. Já feito: o produtor aplica/computa a
raiz UMA vez (era duas) — corta ~2x, mas não muda a assíntota.

## Por que os dois estão acoplados

Uma raiz **incremental** (atualizar só O(mudanças) por bloco) **não adianta enquanto o
`clone()` for O(estado)**: o bloco continua O(estado). E qualquer cache de folha/nó morre
no `clone()`, que copia tudo. Logo, os dois têm de ser resolvidos JUNTOS.

## Design

### 1. Estado copy-on-write (COW)

Trocar as seções de maior cardinalidade (`accounts`, e depois `tokens`, `contracts`) de
objeto plano para uma **estrutura persistente** (HAMT / árvore imutável com compartilhamento
estrutural):

- `clone()` → O(1) (compartilha a raiz; nós são copiados sob demanda na escrita).
- `get(addr)` / `set(addr, v)` → O(log N), copiando só o caminho raiz→folha.
- Atomicidade de bloco: em vez de `sim = clone()` + commit, aplica sobre a estrutura
  persistente e, em falha, descarta a nova raiz (a antiga continua íntegra) — sem cópia.

Impacto no código: todos os acessos `state.accounts[addr]` / `Object.entries(state.accounts)`
passam por uma API (`getAccount`/`setAccount`/`eachAccount`). É a parte invasiva —
`getAccount`, `credit`, `validators`, `distributeBlockReward`, as folhas do stateRoot, etc.

### 2. Raiz de estado incremental (Merkle trie)

Substituir `merkleRoot(folhas.sort())` por uma **árvore de Merkle esparsa (SMT)** indexada
pela chave da folha (`eavHash(domínio\x1fchave)`), com hashes-default por nível:

- `update(chave, hashDaFolha)` → recomputa só o caminho raiz→folha (O(log N)).
- `root()` → O(1) (cacheado no nó raiz).
- Dirty-tracking: as MESMAS estruturas COW marcam o que mudou; a SMT atualiza só isso.
- **Bônus:** provas de inclusão (feature de light client) ficam nativas e mais baratas —
  hoje `accountProof` reconstrói a árvore inteira (O(estado)); com a SMT é O(log N).

### Compatibilidade / rollout

- A raiz muda de valor (árvore de forma diferente) → é um **novo esquema de stateRoot**.
  Como o stateRoot é gated por altura (`STATEROOT_HEIGHT`) e no relaunch nasce em 0, o
  esquema pode ser trocado ANTES do lançamento sem hard fork adicional.
- **Invariante de segurança obrigatório:** manter `computeStateRootFull` (a versão O(estado))
  e um teste que exige `rootIncremental === rootFull` após sequências arbitrárias de
  transações reais. É a rede de proteção contra divergência de consenso.

## Recomendação

**Não implementar agora.** Numa cadeia que relança do zero, ficar muito tempo abaixo de
50k contas, é otimização prematura com alto risco de consenso. **Agendar** a reescrita
COW + SMT para quando a contagem de contas passar de ~30-50k (com folga sobre o gatilho de
~100k), guiada pelo invariante `incremental === full`.
