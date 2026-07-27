# Fase 6 — Resultados de IA verificáveis por atestação (TEE / zkML)

A Fase 6 fecha o roadmap da IA nativa dando **verificabilidade forte** aos resultados dos
oráculos: em vez de confiar na reputação (Fase 1) ou na janela de desafio otimista (Fase 3),
um resultado pode vir com uma **prova criptográfica** de que foi computado corretamente. Com
prova válida, o resultado é aceito como **VERIFICADO** e **liquida na hora** — sem janela de
desafio, sem depender da reputação do oráculo. Forjar exige as **chaves de atestação do
enclave**, não a confiança no oráculo.

Isto separa claramente o que é **on-chain** (implementado, determinístico, testado) do que é
**off-chain** (infra do operador — enclave TEE ou prover zk).

---

## 1. On-chain (implementado — `state.js`, `bridge/proof.js`, `config.js`)

Fork-gated por `CHAIN.AI_TEE_HEIGHT` (dormente até um rollout coordenado — ver §5).

### Registro de atestadores (por governança)
Um **atestador** é um conjunto de chaves de atestação + a **medida** (measurement) do código
atestado (MRENCLAVE de um enclave SGX, o hash do binário do enclave SEV/TDX, ou o commitment
do circuito/modelo no caso zk). É registrado por **governança on-chain** (validadores votam),
espelhando o comitê da ponte trustless (#3):

```
GOV_PROPOSE  param=AI_ATTESTER  value={
  attesterId : "sgx-eav7-oracle-v1",   // id estável
  kind       : "TEE" | "ZK",
  members    : ["0x<eth-addr-da-chave-de-atestação>", ...],  // <= MAX_AI_ATTESTER_MEMBERS
  quorum     : 2,                        // assinaturas distintas necessárias
  measurement: "mrenclave:abcdef..."     // a MEDIDA do código atestado
}
```

Após o timelock de governança, entra em `state.aiAttesters[attesterId]`. Trocar/rotacionar =
nova proposta. **A EAV7 confia numa chave de atestação só depois que a governança a registrou**
— o operador faz a verificação de atestação remota (DCAP/Intel, ou a cerimônia de setup do zk)
**fora da cadeia** e leva o resultado (as chaves + measurement) à governança.

### Verificação da atestação (`AI_RESULT`)
O oráculo entrega o resultado com um campo `attestation`:

```
AI_RESULT  data={
  taskId, output (ou resultHash),           // como nas Fases 1/5
  attestation: {
    attesterId: "sgx-eav7-oracle-v1",
    sigs: [{ r, s, recId }, ...]            // assinaturas secp256k1 sobre o digest
  }
}
```

A cadeia computa o **digest** determinístico e conta as assinaturas válidas e distintas de
membros registrados (reusa `verifyCommitteeProof` da ponte):

```
digest = aiAttestDigest({ taskId, resultHash, attesterId, measurement })
         = keccak256("EAV7-AI-ATTEST" | taskId | resultHash | attesterId | measurement)
```

- `valid >= attester.quorum` → resultado **VERIFICADO** (`task.verified = kind`), status `DONE`,
  oráculo pago **imediatamente**. Sem janela de desafio.
- `valid < quorum`, atestador não registrado, ou digest sobre outra `measurement` → **rejeitado**
  (falha fechada).
- Sem `attestation` (ou abaixo do fork) → comportamento das Fases 1/3/5 (janela de desafio).

O digest amarra `taskId`, `resultHash` **e** `measurement`: uma assinatura só vale para aquele
resultado exato, produzido por aquele código atestado exato.

---

## 2. Off-chain (infra do operador — NÃO roda na cadeia)

A EAV7 **verifica** a atestação; **gerar** a atestação é responsabilidade do operador do oráculo.
Dois caminhos:

### 2a. TEE (Trusted Execution Environment) — pronto para usar
1. Rodar o worker do oráculo **dentro de um enclave** (Intel SGX, AMD SEV-SNP, Intel TDX, AWS
   Nitro Enclaves). O enclave carrega o modelo e computa a resposta isolado do host.
2. No **setup**, obter a **atestação remota** do enclave (quote DCAP para SGX; report SEV/TDX;
   attestation document do Nitro). Ela prova que um enclave GENUÍNO rodando o código de medida
   `MRENCLAVE`/hash-esperado gerou uma **chave de atestação** (par secp256k1 selado no enclave).
3. Verificar essa atestação remota (Intel PCS/DCAP, ou o serviço do fornecedor) e levar à
   **governança** o par: `measurement` (a medida do enclave) + o endereço eth da chave de
   atestação → `GOV_PROPOSE AI_ATTESTER`.
4. Em **runtime**, para cada tarefa, o enclave assina o `aiAttestDigest(taskId, resultHash,
   attesterId, measurement)` com a chave selada e devolve `{r,s,recId}`. O oráculo põe isso em
   `attestation.sigs`. `quorum` > 1 = exigir várias réplicas de enclave independentes.

> A EAV7 verifica só a **assinatura secp256k1** da chave já registrada — determinístico e barato.
> A verificação do quote DCAP em si (parsing da cadeia de certificados Intel) é feita **uma vez, no
> registro, off-chain** — não on-chain. Isso mantém o consenso determinístico e zero-dependências.

### 2b. zkML (prova de conhecimento zero) — follow-up
Provar que `output = Modelo(input)` com uma prova succinta (ex.: ezkml, Risc0, zkML sobre um
circuito do modelo). O commitment do modelo/circuito vira a `measurement`. **Diferença crítica:**
verificar um SNARK on-chain exige um **verificador de pareamento** (BN254/BLS12-381), que **não é
zero-dependência** e ainda não está no consenso da EAV7. Caminho incremental:
1. Curto prazo: tratar o `kind: "ZK"` como o TEE — um **serviço verificador registrado** confere a
   prova off-chain e assina o digest (confiança no verificador, como no TEE).
2. Médio prazo: embutir um verificador de pareamento determinístico e verificar o SNARK direto no
   handler `AI_RESULT` (elimina o verificador confiável). É a evolução natural de `verifyCommitteeProof`.

---

## 3. Modelo de confiança

| Fase | Base de aceitação | Confia em |
|------|-------------------|-----------|
| 1 | reputação | histórico do oráculo |
| 3 | otimista + júri | ninguém contestar (economicamente) |
| 5 | hash-only/privado | compromisso de hash (integridade) |
| **6 TEE** | **assinatura do enclave** | **hardware do enclave + governança que o registrou** |
| **6 zkML (futuro)** | **prova matemática** | **ninguém (só a matemática)** |

---

## 4. Segurança / determinismo
- A verificação é **determinística** (mesmas assinaturas/registro → mesma decisão em todos os nós).
- `verifyCommitteeProof` dedup por endereço recuperado e limita o nº de `recover` (anti-DoS de
  cripto) — herdado da ponte trustless.
- `task.verified` só é setado quando de fato atestado → **abaixo do fork o campo nem existe**,
  mantendo a serialização de `aiTasks` (e do stateRoot) idêntica. Idem `aiAttesters` (só entra no
  stateRoot quando não-vazio). Isso torna o deploy **replay-safe** enquanto dormente.

## 5. Rollout (coordenado, como C1/M1 e o circuit breaker)
`AI_TEE_HEIGHT` = placeholder distante (100M) e **NÃO** está em `FORK_HEIGHTS` → o gênese-ativo
**não** o zera. Ativar exige:
1. Definir `AI_TEE_HEIGHT` para uma **altura futura acordada** nos 3 validadores (mesmo valor).
2. Registrar o(s) primeiro(s) atestador(es) por governança **acima** dessa altura.
3. Oráculos passam a anexar `attestation` nos `AI_RESULT`.

Enquanto isso, tudo segue nas Fases 1/3/5 — nada muda para quem já usa a rede.
