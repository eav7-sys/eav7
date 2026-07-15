# EAV7 — Ponte trustless: especificação de design

Status: **proposta** (não implementado). Contexto: fix C1 da auditoria de 2026-07-14 elevou a
ponte de *ponto único* para *federação M-de-N*, mas ela ainda **confia no conjunto de relayers** —
não há prova criptográfica de que o depósito realmente aconteceu na cadeia de origem. Este documento
especifica como eliminar essa confiança.

---

## 1. Problema

Modelo atual (`src/bridge/gateway.js`, `src/core/state.js` `BRIDGE_IN`):

```
Depósito na cadeia de origem (TRON/ETH/BTC)
      │  relayer OBSERVA off-chain
      ▼
BRIDGE_IN assinada por relayer → libera fundos travados na EAV7
```

O nó EAV7 **acredita** no relayer. Após o C1, precisa de ≥ maioria dos relayers atestando o mesmo
depósito — mas se a maioria colude (ou tem as chaves comprometidas), libera fundos sem depósito real.
O `sourceTxHash` é uma string auto-declarada, nunca verificada.

**Meta:** o `BRIDGE_IN` só libera se acompanhado de uma **prova verificável on-chain** de que o
depósito ocorreu e está finalizado na cadeia de origem. Relayers viram meros transportadores de prova,
sem poder de cunhagem.

---

## 2. Espaço de soluções

| Abordagem | Como funciona | Custo p/ EAV7 | Confiança residual |
|-----------|---------------|---------------|--------------------|
| **A. Light client** | EAV7 sincroniza headers da origem e verifica o consenso dela | Alto (implementar consenso da origem no VM/estado) | Nenhuma (só o consenso da origem) |
| **B. Comitê + prova de inclusão (SPV)** | Relayers relatam headers assinados pelos validadores da origem; EAV7 verifica assinaturas do comitê + Merkle proof do evento | Médio | O comitê de validadores da origem (não os relayers) |
| **C. Otimista (fraud proof)** | Libera após janela de contestação; qualquer um contesta com prova de fraude | Médio (janela de latência longa) | Assumção de ≥1 vigia honesto |
| **D. zk-proof** | Prova SNARK de inclusão+finalidade verificada on-chain | Muito alto (verificador zk no EAVM) | Nenhuma |

### Recomendação para a EAV7

**Abordagem B (comitê + prova de inclusão)** como primeiro alvo, evoluindo para **A (light client)**
por cadeia conforme a demanda. Justificativa:

- A origem primária é **TRON** (DPoS, 27 Super Representatives, blocos ~3 s, finalidade por 2/3+1 SRs).
  O "comitê" já existe e é pequeno e assinado — é o caso ideal para B.
- B não exige reimplementar o consenso completo da origem; exige verificar **assinaturas do comitê**
  sobre um header + uma **Merkle proof** do log/evento de depósito dentro daquele header. Ambos são
  primitivas que a EAV7 já tem (secp256k1 em `src/eavm/secp256k1.js`, keccak, RLP, Merkle em
  `src/crypto/hash.js`).
- A federação de relayers **não some** — ela apenas deixa de ter poder. Um relayer que mente sobre um
  depósito falha na verificação da prova e sua tx é rejeitada pelo `BRIDGE_IN`.

O restante deste doc especifica **B para TRON→EAV7**. ETH e BTC seguem o mesmo esqueleto com adaptadores
de prova próprios.

---

## 3. Protocolo B (TRON → EAV7)

### 3.1 Componentes on-chain novos

**Comitê de origem confiável (por cadeia), na gênese/governança:**
```
state.bridgeSourceCommittees = {
  TRON: {
    epoch: 42,
    validators: [ <pubkey ou address dos SRs> ... ],   // 27 SRs
    quorum: 19,                                         // 2/3+1
    minConfirmations: 20,                              // blocos de finalidade
  }
}
```
Atualizado por transação de governança assinada (mudança de epoch dos SRs é rara e assinada pelo
próprio comitê anterior — "committee handoff", como um light client).

**Contrato de depósito conhecido na origem:** endereço do contrato de lock na TRON, fixado por cadeia,
para que só eventos daquele contrato sejam aceitos.

### 3.2 Nova forma do `BRIDGE_IN`

`tx.data` passa a carregar a **prova**, não só o `sourceTxHash`:

```jsonc
{
  "type": "BRIDGE_IN",
  "to": "E7…",
  "amount": "…",
  "data": {
    "sourceChain": "TRON",
    "sourceTxHash": "0x…",           // id do evento (chave de replay)
    "token": null,
    "proof": {
      "blockHeader": { … },          // header do bloco da origem que contém o depósito
      "committeeSigs": [ … ],        // assinaturas dos SRs sobre o header (≥ quorum)
      "committeeEpoch": 42,
      "txMerkleProof": [ … ],        // caminho Merkle: evento → txRoot do header
      "eventIndex": 3,
      "event": {                     // campos do evento de depósito no contrato de lock
        "contract": "T…",            // deve == contrato de lock fixado da TRON
        "eav7Recipient": "E7…",      // deve == tx.to
        "amount": "…",               // deve == tx.amount
        "token": null                // deve == data.token
      }
    }
  }
}
```

### 3.3 Verificação no handler `BRIDGE_IN` (state.js), ANTES de liberar

```
1. relayer autorizado (mantém) — agora só p/ anti-spam/rate, NÃO é a autoridade de cunhagem
2. committee = bridgeSourceCommittees[sourceChain]; proof.committeeEpoch == committee.epoch
3. header bem-formado; header.number confirmado:
     head_origem_conhecido - header.number >= committee.minConfirmations   (finalidade)
4. contagem de committeeSigs válidas sobre hash(header) >= committee.quorum
     (secp256k1.verify por assinatura; assinantes ∈ committee.validators; sem repetição)
5. Merkle: verifica txMerkleProof liga `event` (serializado canônico) ao header.txRoot
6. Igualdade de campos: event.contract == contrato de lock fixado;
     event.eav7Recipient == tx.to; event.amount == tx.amount; event.token == data.token
7. replay: replayKey = `${sourceChain}:${sourceTxHash}` não em processedInbound
8. valor travado suficiente (mantém)
→ só então: lockedNative/lockedTokens -= amount; credit(to, amount); processedInbound[replayKey]=tx.id
```

Passos 2–6 são a **prova**. Sem eles, o `BRIDGE_IN` de hoje. O quórum de relayers (C1) pode ser
**mantido como defesa em profundidade** (M-de-N relayers, cada um com prova válida) ou **reduzido a 1**,
já que a prova — não o relayer — passa a ser a autoridade. Recomendado: manter ≥1 relayer autorizado
(anti-spam) + prova obrigatória.

### 3.4 De onde vem o `head_origem_conhecido` (passo 3)

Um **relay de headers** leve: os relayers submetem headers da TRON via uma tx `BRIDGE_HEADER` que a
EAV7 verifica (assinaturas do comitê) e encadeia num mini light-client por cadeia:

```
state.bridgeHeaders[TRON] = { height: N, hash, txRoot, … }  // último header finalizado aceito
```

`BRIDGE_HEADER` verifica: encadeia no header anterior conhecido + quórum de assinaturas do comitê.
Isso torna a finalidade (passo 3) verificável on-chain sem confiar no relayer. É o núcleo "light client"
da abordagem A, mínimo o suficiente para B funcionar.

---

## 4. O que construir (checklist de implementação)

- [ ] `src/bridge/proofs/tron.js` — desserialização de header/evento TRON + verificação de assinatura
      dos SRs (reusa `secp256k1.js`, `keccak.js`, `rlp.js`).
- [ ] Estado novo: `bridgeSourceCommittees`, `bridgeHeaders` (com `clone()`/serialização no snapshot —
      cuidar do C2: entram no estado autenticado).
- [ ] Handler `BRIDGE_HEADER` em `state.js` (encadeia + verifica quórum do comitê).
- [ ] Estender handler `BRIDGE_IN` com os passos 2–6 (gated por `CHAIN.BRIDGE_PROOF_HEIGHT`, grandfather).
- [ ] Governança `BRIDGE_COMMITTEE_UPDATE` (handoff de epoch dos SRs, assinado pelo comitê vigente).
- [ ] Relayer (`gateway.js`): coletar header + assinaturas dos SRs + Merkle proof do adaptador TRON e
      anexar em `proof`; submeter `BRIDGE_HEADER` periodicamente.
- [ ] Adaptador TRON: expor `getBlockHeaderWithSigs(n)` e `getEventProof(txHash)`.
- [ ] Testes: prova válida libera; prova forjada/assinaturas insuficientes/evento adulterado/
      confirmações insuficientes/replay → todos rejeitam. Vetores reais de um bloco TRON.

---

## 5. Segurança e casos de borda

- **Reorg na origem:** `minConfirmations` cobre a finalidade probabilística; para TRON, esperar a
  finalidade por 2/3+1 SRs (irreversível) elimina reorg. Não liberar antes disso.
- **Rotação de comitê:** handoff assinado pelo comitê anterior; um gap de epoch trava novos `BRIDGE_IN`
  até o header do novo epoch ser aceito — falha fechada (seguro).
- **Replay entre epochs/cadeias:** `replayKey` inclui a cadeia; `sourceTxHash` é único por origem.
- **DoS por prova cara:** verificação de N assinaturas por `BRIDGE_IN` é pesada — cobrar energia
  proporcional (como o EAVM já faz) e/ou exigir relayer autorizado (anti-spam). Cf. achado M4.
- **Determinismo:** toda a verificação usa só estado de consenso (comitê, headers, prova na tx) →
  idêntica em todos os nós, replay-safe. Nada de I/O no handler.
- **Interação com C2:** `bridgeSourceCommittees`/`bridgeHeaders` são estado crítico — se o snapshot
  não for autenticado (HMAC/`EAV7_SNAPSHOT_KEY` ou state-root no header), um comitê forjado no
  snapshot derruba toda a prova. C2 é pré-requisito.

---

## 6. Rollout

Fork coordenado, igual a C1/M1: adicionar `CHAIN.BRIDGE_PROOF_HEIGHT` (altura futura acordada). Abaixo
dela, o `BRIDGE_IN` federado (pós-C1) segue válido; a partir dela, prova obrigatória. Sequência:

1. Deploy do código de verificação (inerte até a altura de fork) nos 3 validadores.
2. Publicar `bridgeSourceCommittees[TRON]` (epoch atual dos SRs) via governança.
3. Relayers começam a submeter `BRIDGE_HEADER` e a anexar `proof`.
4. Cadeia cruza `BRIDGE_PROOF_HEIGHT` → prova passa a ser obrigatória; federação vira defesa em profundidade.

---

## 7. Escopo faseado

- **Fase 1 (esta spec):** B para TRON. Elimina a confiança na federação de relayers.
- **Fase 2:** adaptadores de prova para ETH (headers PoS + prova de recibo) e BTC (SPV/cabeçalhos PoW).
- **Fase 3 (opcional):** substituir verificação de comitê por zk-proof (abordagem D) para reduzir custo
      de gás por `BRIDGE_IN` e a superfície de confiança ao mínimo teórico.
