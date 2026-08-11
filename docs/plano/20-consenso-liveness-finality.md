# Plano: Consenso · liveness, finality e dentes (sem trocar DPoS)

**Status:** aceito em desenho (2026-08-09) — **lançamento** + v1.1  
**Não faz:** Tendermint/HotStuff por bloco · VRF PQ · tip/MEV ao produtor  
**Mantém:** slot determinístico `validators[slot % N]` · 1 bloco/slot · finality por produtores distintos · PQ híbrido no bloco  
**Liga a:** [13](13-ancora-pq-multisig.md) época/Âncora · [17](17-set-51-banco-101.md) set 51 · [14](14-governanca-ancora.md) · whitepaper §4

## Em uma frase

Manter o DPoS limpo; no launch **amarrar heights + set 51 + witness**; em seguida **skip/miss**, **slash de downtime leve** e **cert de época** — finality verificável sem reescrever o fork choice.

## O que não se mexe

| Peça | Motivo |
|---|---|
| `validators[slot % N]` | Previsível, sem lottery |
| Um bloco por slot | Anti-grinding |
| Longest chain + piso de finality | Simples, já auditado na ideia |
| Sem tip ao produtor | Sem mercado MEV de taxa |
| Double-sign slash | Já existe (ativar no launch) |

## Decisão

| Item | Escolha | Quando |
|---|---|---|
| `MAX_VALIDATORS` | **51** (+ banco 101) | Launch — [17](17-set-51-banco-101.md) |
| `STRICT_PRODUCER_HEIGHT` | **0** | Launch |
| `STATEROOT_HEIGHT` | **0** | Launch |
| `SLASHING_HEIGHT` (double-sign) | **0** | Launch |
| Produção | Só chave **witness** da Âncora | Launch — [13](13-ancora-pq-multisig.md) |
| Launch N operadores | **5–7** (não 3 se possível) | Ops — finality menos frágil |
| **Skip rule** | Após **K** slots sem bloco do esperado, próximo elegível (ativa seguinte ou banco) pode produzir | **v1.1** (fork) — ver spec abaixo |
| **Miss accounting** | Contador on-chain / derivado de gaps de slot por producer | v1.1 (junto do skip) |
| **Downtime penalty** | Após **M** misses numa janela **W**: inelegível temporário ou slash **leve** (param) | v1.1 |
| **Cert de época** | Quórum híbrido sobre set + `stateRoot` | Fase 2 — [13](13-ancora-pq-multisig.md) D; não muda fork choice |
| NTP / skew | Obrigatório no runbook Core; alerta sentinel | Launch (ops) |
| VRF / BFT votes por bloco | **Fora** | [15](15-longo-prazo-adiados.md) |

## Modelo mental

```
Slot t → ativa esperada (witness assina)
        │
        ├─ produz → bloco · reward · miss=0
        │
        └─ falha → (hoje) espera slot t+1
                   (v1.1) após K vazios → skip: próximo pode preencher
                         misses++ → threshold → penalty leve
```

Finality (inalterada na essência): bloco F final quando `⌊2N/3⌋+1` produtores **distintos** aparecem em blocos com height > F.  
Cert de época: prova **exportável** do mesmo quórum de set, para ponte/light client — complemento, não substituto do piso.

## Spec skip (v1.1 — proposta)

Constantes (nomes a fixar na impl.):

| Constante | Proposta inicial | Nota |
|---|---|---|
| `EMPTY_SLOTS_BEFORE_SKIP` | **2** ou **3** | Após K slots sem avanço de height no slot esperado |
| `MISS_WINDOW_BLOCKS` | **3_600** (~1 h) | Janela deslizante |
| `MISS_PENALTY_THRESHOLD` | **30** | Misses na janela |
| `DOWNTIME_PENALTY` | inelegível **1_800** blocos **ou** slash 1% at-risk | Preferir inelegível antes de slash duro |
| Quem pode skip-produce | `validators[(i+1) % N]` … até achar online; banco só se regra [17](17-set-51-banco-101.md) C ligar | Evitar qualquer um |

Regras:

1. Header (ou validação) deve permitir producer ≠ expected **somente** se `slot - lastSlot >= 1 + K` e producer = próximo na ordem determinística de skip.  
2. Skip não apaga double-sign slash.  
3. Reward do bloco skip: produtor real recebe; expected conta **miss**.  
4. Vetores de teste: rede não trava com 1 ativa down; não permite grind de skip.

*(Detalhe byte-a-byte na PR de implementação — este plano trava a intenção.)*

---

## Trilha (checklist)

### A — Spec / docs

- [x] Decisão neste plano  
- [x] Whitepaper §4 (EN + PT): heights 0; set 51; witness; mencionar skip/miss como upgrade; cert época  
- [ ] Runbook Core: NTP, skew, o que acontece se miss  
- [ ] Portal: “como o slot funciona” + finality em linguagem humana  

### B — Launch (sem fork de skip ainda)

- [ ] Config gênese: `STRICT_PRODUCER_HEIGHT=0`, `STATEROOT_HEIGHT=0`, `SLASHING_HEIGHT=0`  
- [ ] `MAX_VALIDATORS=51` — [17](17-set-51-banco-101.md)  
- [ ] Witness na produção — [13](13-ancora-pq-multisig.md)  
- [ ] Preferir **≥5** Âncoras fundação no ar (ideal 7)  
- [ ] Testes: strict producer; stateRoot mismatch rejeita; double-sign slash  
- [ ] Sentinel ([16](16-ia-oraculo-ops.md)): alerta clock drift / finality stall  

### C — v1.1 Skip + miss + downtime *(fork)*

- [ ] Spec fechada + `EMPTY_SLOTS_BEFORE_SKIP` em `config.rs`  
- [ ] Validação de bloco com producer de skip  
- [ ] Scheduler do producer: se não sou o expected mas skip me elege, produzo  
- [ ] Contagem de misses + penalty  
- [ ] Gov params (opcional) para K/M/W na classe dura  
- [ ] Testes multi-nó: 1 down, height avança; threshold pune; sem grind  
- [ ] Documentar em `docs/rollout-forks.md`  

### D — Cert de época (fase 2)

- [ ] Igual checklist [13](13-ancora-pq-multisig.md) D / [18](18-ponte-committee-breaker.md) E  
- [ ] Não alterar regra de finality por história no mesmo PR  

## Fora de escopo

- Consenso estilo Tendermint (prevote/precommit por height)  
- VRF / leader election aleatória  
- Tip / fee market ao produtor  
- Slash pesado estilo Cosmos no dia 1  

## Riscos

| Risco | Mitigação |
|---|---|
| Skip mal especificado = grind | Só cadeia determinística de sucessores; testes adversariais |
| Penalty leve demais | Params governáveis depois de dados reais |
| N=3 no launch | Ops: mínimo 5–7 |
| Cert época atrasa launch | Fica fase 2; B não depende |

## Ordem vs outros planos

1. **B** + [17](17-set-51-banco-101.md) + [13](13-ancora-pq-multisig.md) witness — gênese  
2. **C** skip/miss — primeiro fork de liveness  
3. **D** cert época — com ponte/light client  
4. Adiados VRF etc. — [15](15-longo-prazo-adiados.md)  

## Ligação

- Código: `rust/src/blockchain.rs` (slot, finality, strict) · `rust/src/config.rs` · producer no `eav7-node`  
- Whitepaper §4  
- Mapa: [10](10-mapa-integrado.md) · [11](11-mapa-melhorias-projeto.md)
