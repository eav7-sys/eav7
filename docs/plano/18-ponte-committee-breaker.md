# Plano: Ponte · committee real + breaker + honestidade

**Status:** aceito em desenho (2026-08-09) — amarrar **antes** de custodiar valor  
**Não é light client** (ainda): committee-attested; headers/Merkle = fase longa ([15](15-longo-prazo-adiados.md) C2–C3)  
**Liga a:** [13](13-ancora-pq-multisig.md) cert época · [14](14-governanca-ancora.md) bootstrap duro · [15](15-longo-prazo-adiados.md) · whitepaper §11

## Em uma frase

Ligar o que o protocolo **já tem** (committee, breaker, digest, anti-capture), exigir **committee ≥ 3 + breaker na gênese** se a ponte for pública, um **adapter real**, e nunca vender trustless — light client depois.

## Fronteira (não negociável)

| Manter | Por quê |
|---|---|
| Gov **não** troca committee ativo | Anti-capture pelas Âncoras |
| Digest amarra amount / destino / token | Sig de 5 ≠ mint de 500 |
| Replay key ≠ attestation key | Relayer mentiroso não bloqueia quórum honesto |
| Relayer na era committee = anti-spam | Não é autoridade de mint |
| Breaker fail-closed | Ralo vira vazamento lento |

Frase: **Trust foi relocado para o committee, não eliminado. Breaker compra tempo.**

## Decisão

| Item | Escolha |
|---|---|
| Modelo no launch público | **Committee-attested** (`BRIDGE_PROOF_HEIGHT` ativo) |
| Relayer-only / 1 relayer | Só **demo / loopback** — **proibido** com valor |
| `BRIDGE_BREAKER_HEIGHT` | **0** (ativo) se ponte pública; senão ponte desligada na UI |
| Committee mínimo | **≥ 3** membros; quorum `⌊2M/3⌋+1` (ou o que o código já exige — documentar) |
| Bootstrap committee | Só via gov **classe dura** ([14](14-governanca-ancora.md)); handoff assinado depois |
| Chaves do committee | Preferir **híbridas** alinhadas à tese PQ; se origem for secp-only, documentar risco |
| Adapter dia 1 | **Um** caminho real (EVM L1 ou outra origem com comitê) + testes; loopback ≠ produto |
| Caps extras | Cap por tx + soft cap / endereço / dia (além do breaker de pool) |
| Pause | Mecanismo de halt (gov dura ou multilat committee) além do rate limit |
| Confirmações na origem | Política **obrigatória do relayer** (N blocos) — off-chain até light client |
| Cert de época EAV7 | Relayer/verificação consome quando [13](13-ancora-pq-multisig.md) D existir |
| Light client (headers + Merkle + depth) | **Fora** deste plano de launch — gate [15](15-longo-prazo-adiados.md) |
| Narrativa | “committee-attested bridge” — nunca “trustless” / “light client” no launch |

## O que já existe

`rust/src/state/bridge.rs` + eras por height + SDK relayer + whitepaper §11:

- `BRIDGE_OUT` / `BRIDGE_IN`, quorum de relayers, committee + handoff + epoch  
- Circuit breaker (gated distante hoje)  
- Anti-capture gov  
- Loopback adapter de teste  

### Gaps

| Gap | Hoje | Alvo |
|---|---|---|
| Breaker | height ~100M | ativo no launch público |
| Committee | pode não existir; gênese 1 relayer | committee ≥ 3 antes de valor |
| Adapter produção | só loopback | 1 chain real |
| Caps / pause | só breaker de pool | tx cap + pause |
| UX / ops | fraco | dashboard + status de liberação |
| Época Âncora | não ligado | consumir cert quando existir |

---

## Trilha (checklist)

### A — Spec / honestidade

- [x] Decisão neste plano  
- [x] Whitepaper §11 (EN + PT): checklist “quando pode haver valor”; breaker/committee mínimos; sem linguagem trustless  
- [ ] Portal `/developers`: fluxo OUT→attest→IN; erros de breaker; “o que a ponte **não** é”  
- [ ] `llms.txt` / marketing: committee-attested only  
- [ ] Runbook incidente: pause → rotacionar committee (handoff) → reabrir  

### B — Gênese / protocolo (sem valor até verde)

- [ ] Launch config: `BRIDGE_PROOF_HEIGHT = 0` (ou ativo); `BRIDGE_QUORUM` coerente  
- [ ] `BRIDGE_BREAKER_HEIGHT = 0` se ponte ligada; default fraction 30% (já no modelo)  
- [ ] Rejeitar / não expor ponte pública se `committee[chain]` ausente ou `|members| < 3`  
- [ ] Caps: `BRIDGE_MAX_PER_TX`, `BRIDGE_MAX_PER_ADDRESS_WINDOW` (constantes + opcional gov)  
- [ ] Pause: param ou tx `BRIDGE_PAUSE` / flag em state — só owner gov / multilat (spec na impl.)  
- [ ] Testes: breaker rejeita; committee &lt; 3 não libera; gov não substitui committee ativo; handoff epoch  
- [ ] Teste: digest amount errado nunca junta quórum com o correto  

### C — Committee + ops

- [ ] Procedimento bootstrap: proposta gov dura `BRIDGE_COMMITTEE` (primeira vez)  
- [ ] Handoff ensaiado em testnet (epoch N → N+1)  
- [ ] Preferência chaves híbridas nos members; doc se mixed  
- [ ] Dashboard (explorer/Core): pool, janela breaker % usada, epoch, members, near-quorum  
- [ ] Alertas sentinel ([16](16-ia-oraculo-ops.md)): breaker &gt; X%, pause, handoff  

### D — Adapter + relayer

- [ ] Escolher alvo 1: **EVM L1** (ou outra origem com comitê assinado) — decisão na impl.  
- [ ] Implementar adapter de produção (watch depósitos, montar attest)  
- [ ] Relayer: esperar **N confirmações** na origem antes de atestar (config)  
- [ ] Relayer: nunca hot-key = committee key; committee offline / HSM  
- [ ] SDK: mensagens claras ATTESTED / RELEASED / rejected-breaker  
- [ ] E2E testnet: lock origem → release EAV7 (ou o par do adapter) com breaker ligado  

### E — Amarração Âncora / época (quando [13](13-ancora-pq-multisig.md) D existir)

- [ ] Relayer ou nó verifica cert de época para set/state relevantes  
- [ ] Doc: ponte não substitui cert; cert não substitui committee da origem  

### F — Light client (longo prazo — não bloqueia)

- [ ] Spec “proposed” → plano dedicado quando G2  
- [ ] Headers + inclusion + depth; committee vira transição ou backup  
- [ ] Ver [15](15-longo-prazo-adiados.md) C1–C3  

## Política de valor

| Ambiente | Relayer | Committee | Breaker | Valor |
|---|---|---|---|---|
| CI / loopback | 1 | opcional | off ok | fictício |
| Testnet pública | ≥ 2 | ≥ 3 recomendado | on | faucet only |
| Launch com ponte | anti-spam | **≥ 3** | **on** | só após checklist B+C+D verde |
| Sem checklist | — | — | — | **ponte desligada na UI** |

## Fora de escopo (neste plano)

- Light client completo  
- Dezenas de chains no dia 1  
- Gov das Âncoras mintando no lugar do committee  
- IA aprovando liberações  

## Riscos

| Risco | Mitigação |
|---|---|
| Marketing trustless | Checklist A |
| Breaker off + committee fraco | Política de valor |
| Adapter eterno “depois” | Sem adapter = ponte off |
| Pause centraliza | Multilat / gov dura + timelock; runbook |
| PQ misturado com secp origem | Doc de confiança explícito |

## Ordem vs outros planos

1. Âncora + gov ([13](13-ancora-pq-multisig.md) · [14](14-governanca-ancora.md)) — bootstrap committee é gov dura  
2. **Este plano B** — heights + caps + pause + testes  
3. **C+D** — committee live + 1 adapter  
4. Ponte na UI só com política de valor verde  
5. Época (**E**) e light client (**F**) depois  

## Ligação

- Código: `rust/src/state/bridge.rs` · config `BRIDGE_*` · SDK relayer  
- Whitepaper §11 · [05](05-pendencias.md) breaker distante  
- Mapa: [10](10-mapa-integrado.md) · [11](11-mapa-melhorias-projeto.md) · adiados: [15](15-longo-prazo-adiados.md)
