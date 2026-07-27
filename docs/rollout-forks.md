# Runbook — Rollout coordenado dos forks dormentes

Dois recursos de **consenso** foram implementados e testados, mas ficam **DORMENTES** até um
rollout coordenado (a serialização do stateRoot só muda a partir do fork; ativar sem coordenar
divergiria a cadeia):

| Fork (env) | O que ativa | Risco de ativar |
|---|---|---|
| `EAV7_BRIDGE_BREAKER_HEIGHT` | circuit breaker da ponte (≤30% do pool por janela) | baixo — só rejeita drenos anormalmente rápidos; uso normal fica bem abaixo |
| `EAV7_AI_TEE_HEIGHT` | resultados de IA atestados (TEE/zk) — Fase 6 | baixo — opt-in por resultado; nada muda até um atestador ser registrado |

> Os outros forks de auditoria (`BRIDGE_QUORUM_HEIGHT`, `CANONICAL_HASH_HEIGHT`) estão em
> `FORK_HEIGHTS` → o gênese-ativo do relaunch os zerou → **já ativos** (aparecem como 0 em
> `/status.forkHeights`). Só os dois acima seguem dormentes (100.000.000 = placeholder).

## Invariante crítico
**Todos os 3 validadores DEVEM ter a MESMA altura de fork ANTES de a cadeia cruzá-la.** Se um nó
ativa numa altura e outro não, eles produzem estados/roots divergentes naquele bloco → fork/halt.
Por isso a ativação é por **env idêntico** nos 3, com verificação de que os 3 reportam o mesmo valor.

## Pré-requisito
O código com override por env já deve estar deployado (via `deploy-pending.sh` — que embarca o
`config.js` com `Number(process.env.EAV7_*_HEIGHT) || 100M` e o `/status.forkHeights`). Confira:

```
curl -s -H accept:application/json https://eavscan.com/status | jq .forkHeights
# esperado ANTES do rollout: bridgeBreaker=100000000, aiTee=100000000, bridgeQuorum=0, canonicalHash=0
```

## Passo 1 — Ativar os forks (script `rollout-forks.sh`)
O script:
1. Lê a altura atual (`head`) do node1.
2. Calcula alturas FUTURAS com folga (runway) e ESCALONADAS entre si:
   - `BREAKER  = head + 20.000` (~5,5h) — ativa primeiro
   - `AI_TEE   = head + 40.000` (~11h)  — ativa depois (isola o risco de cada um)
   (arredondadas para o milhar; o buffer >> tempo de deploy, então nenhum nó cruza a altura antes
   de todos terem o env)
3. Grava o MESMO drop-in `/etc/systemd/system/eav7.service.d/rollout-forks.conf` nos 3 nós:
   ```
   [Service]
   Environment=EAV7_BRIDGE_BREAKER_HEIGHT=<BREAKER>
   Environment=EAV7_AI_TEE_HEIGHT=<AI_TEE>
   ```
4. `daemon-reload` + `restart eav7` **escalonado** (um por vez, aguardando `/status`).
5. **Verifica** que os 3 nós (e o público) reportam EXATAMENTE os mesmos `forkHeights` — aborta se divergir.

Rollback (antes da altura ser cruzada): `rm` o drop-in nos 3 + restart → volta a 100M (dormente).
Depois de cruzada, a mudança é história da cadeia (não reverte sem re-fork).

## Passo 2 — (Só Fase 6) Registrar o primeiro atestador
O breaker não precisa de mais nada — ativa sozinho na altura. A Fase 6 só tem efeito quando um
**atestador** é registrado por governança, **acima** de `AI_TEE_HEIGHT`. Isso exige a infra de
enclave do operador (ver `docs/fase6-atestacao.md`):

1. Rodar o worker do oráculo no enclave (SGX/SEV/TDX/Nitro); obter a atestação remota (DCAP) e
   **verificá-la off-chain** (uma vez). Extrair: a `measurement` (MRENCLAVE/hash) e o endereço eth
   de cada **chave de atestação** selada no enclave.
2. Um validador submete (helper `register-attester.sh`):
   ```
   GOV_PROPOSE param=AI_ATTESTER value={
     attesterId:"sgx-eav7-oracle-v1", kind:"TEE",
     members:["0x…","0x…","0x…"], quorum:2, measurement:"<MRENCLAVE>"
   }
   ```
3. Os validadores votam (2/3+1); após o timelock, entra em `state.aiAttesters`.
4. A partir daí, oráculos anexam `attestation:{attesterId,sigs}` nos `AI_RESULT` e o resultado
   liquida na hora (verificado). Confira em `/status` e nas tarefas (`verified:"TEE"`).

## Verificação pós-ativação
- Antes da altura: `forkHeights` novos nos 3 == iguais; comportamento inalterado.
- Ao cruzar `BREAKER`: um `BRIDGE_IN` que exceda 30% do pool na janela passa a ser rejeitado
  (`circuit breaker da ponte: limite de velocidade atingido`). Uso normal não é afetado.
- Ao cruzar `AI_TEE`: `GOV_PROPOSE AI_ATTESTER` passa a ser aceito; sem atestador registrado,
  `AI_RESULT` segue nas Fases 1/3/5.
- Monitorar `eavscan.com/status` (altura/finalidade convergindo nos 3) e a página de segurança.
