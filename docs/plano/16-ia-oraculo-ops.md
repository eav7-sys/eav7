# Plano: IA · oráculo usável + ops sem poder

**Status:** aceito em desenho (2026-08-09) — amarrar no **lançamento** o que for produto; resto por gates  
**Não muda:** IA **sem** poder sobre consenso, set de Âncoras, stake ou código ([14](14-governanca-ancora.md) · [15](15-longo-prazo-adiados.md) D4 = G∞)  
**Contexto:** launch em amadurecimento; sem mainnet econômica.

## Em uma frase

Tratar **(A) mercado de oráculos** como produto de consenso usável no dia 1, e **(B) camada ops** (advisor, sentinel, score) como ferramenta **sem assinatura e sem peso** — com honestidade total sobre TEE/ZK.

## Fronteira (não negociável)

| Camada | O que é | Poder |
|---|---|---|
| **A — Protocolo oráculo** | `ORACLE_*` / `AI_*`, escrow, reputação, commit-reveal, challenge, attester | Consenso puro; verifica sigs e hashes — **não** roda LLM na validação |
| **B — Ops** | Sentinel, governance advisor, score de Âncora, roteamento gateway, blocklist IP | **Zero** consenso; nenhum path assina ou submete tx |

Frase: **A chain verifica acordo e assinatura. O modelo só sugere.**

## Decisão

| Item | Escolha |
|---|---|
| Narrativa de launch | “Mercado de inferência com escrow” se A estiver usável; B **não** é o pitch |
| Heights fases 1–5 | **Ativas na gênese** do launch (0 / já passadas) se IA for diferencial |
| `AI_TEE_HEIGHT` | Continua **distante** até attester real + gov das Âncoras |
| TEE/ZK no produto | Texto honesto: on-chain = sig de attester registrado; measurement verificado **off-chain** na tipagem |
| Advisor | Draft-only; UI leva a fluxo **owner/multisig** da Âncora ([14](14-governanca-ancora.md)) |
| Score de Âncora | Só leitura (indexer); **nunca** mexe em set/comissão/gov |
| Attester / SNARK nativo | Pós-launch (gates); não blocker de gênese |
| IA com voto/veto/peso | **Não** — ver [15](15-longo-prazo-adiados.md) D4 |

## O que já existe (não reinventar)

Protocolo em `rust/src/state/ai.rs` + heights em `config.rs` / whitepaper §10:

- Registro de oráculo + stake mínimo  
- `AI_TASK` → `AI_RESULT` → settlement / accountability  
- Commit-reveal (quorum), challenge + júri, mercado (reverse auction), resultados privados  
- Attester gated por `AI_TEE_HEIGHT`  
- Advisor describe no whitepaper como propose-only  

**Gap real:** produto (Core/SDK/explorer/portal), heights de launch, amarração advisor→Âncora, honestidade TEE na UX.

---

## Trilha

### A — Spec / narrativa (launch)

- [x] Decisão neste plano  
- [x] Whitepaper §10 (EN + PT): separar A vs B em caixa; TEE/ZK honestos; advisor → Âncora multisig  
- [ ] Portal `/developers`: guia oráculo (register → task → result → dispute) + página “o que a IA **não** pode”  
- [ ] `public/llms.txt` / copy de marketing: sem “TEE verificado na chain” falso  
- [ ] Glossário: oráculo ≠ advisor ≠ Âncora  

### B — Gênese / protocolo fino

- [ ] Config de launch: `AI_ACCOUNTABILITY` / `AI_QUORUM` / `AI_CHALLENGE` / `AI_MARKET` / `AI_PRIVATE` = **0** (ou ativos)  
- [ ] `AI_TEE_HEIGHT` permanece alto até checklist attester (secção E)  
- [ ] Alinhar custo GB de `AI_TASK` ao [12](12-gb-assinatura-livre.md) (já “pesado” — só documentar)  
- [ ] Testes e2e mínimos: register → task → result feliz; timeout/slash; commit-reveal 2-of-2; challenge overturn  
- [ ] Vetor: nenhum módulo B assina tx (grep/CI smoke se houver código advisor no repo)

### C — Produto oráculo (A) — prioridade launch

- [ ] **SDK / Core:** templates `oracle_register`, `ai_task`, `ai_result`, `ai_commit` / `ai_reveal` (nomes a alinhar aos tipos reais)  
- [ ] **Core:** status da tarefa (escrow, deadline, fase, reputação do oráculo)  
- [ ] **Explorer:** páginas tarefa + oráculo; janelas “commit / reveal / challenge” legíveis  
- [ ] **Reputação:** histórico (+4/−12/…); stake travado; alerta “stake &lt; mínimo efetivo”  
- [ ] **Portal:** receita do requester e do operador de oráculo (uma página cada)  
- [ ] Faucet/testnet: script “primeiro oráculo” para demo interna  

### D — Camada ops (B) — launch leve, sem poder

- [ ] **Advisor:** gera draft de `GOV_PROPOSE` (param, valor, diff, risco, classe leve/dura se existir); **sem** `from` / nonce / signature  
- [ ] UI advisor: CTA “revisar e assinar com owner (multisig)” — nunca keystore só-witness  
- [ ] **Sentinel:** alertas ops (finality degradada, peer estranho, proposta dura no timelock) → log/webhook; humano age  
- [ ] **Score Âncora:** uptime / comissão / multisig sim-não / idade — badge no explorer; disclaimer “não é voto”  
- [ ] Documentar blocklist IP / roteamento gateway como ops de nó, não consenso  

### E — Attester e confiança forte (pós-G0, ver [15](15-longo-prazo-adiados.md))

Pré: gov Âncora ([14](14-governanca-ancora.md)) + pelo menos um operador capaz de measurement off-chain.

- [ ] PoC off-chain: measurement + chaves do attester  
- [ ] Proposta gov `AI_ATTESTER` (bootstrap)  
- [ ] Baixar `AI_TEE_HEIGHT` no launch só se PoC+gov prontos; senão height futuro anunciado  
- [ ] Produto: selo “settled by attester” vs “optimistic / quorum” na tarefa  
- [ ] Futuro: verifier SNARK na EAVM para kind `ZK` (whitepaper: future work) — gate pesquisa, não data  

### F — Aprimoramentos de confiança do mercado (G1+)

- [ ] UX júri: convite/estado “você é jurado”; exclusão de interessados visível  
- [ ] Reverse auction: UI de lance para oráculos  
- [ ] Tarefas privadas: doc + exemplo cifrar para requester; explorer mostra só hash/URI  
- [ ] Métricas públicas: tarefas/dia, taxa de challenge, slash events (indexer)  
- [ ] Opcional: oráculo operador com HSM de **produção** (ops, não protocolo) — espelha [13](13-ancora-pq-multisig.md) B1  

---

## Fora deste plano (consciente)

| Item | Onde vive |
|---|---|
| IA vota / veta / elege Âncora | [15](15-longo-prazo-adiados.md) D4 = **não** |
| Threshold Dilithium / VRF PQ | [15](15-longo-prazo-adiados.md) E1–E2 |
| Tip market por inferência on-chain além do escrow | economia nova — decisão à parte |
| Treinar/hospedar modelo “oficial” da fundação como oráculo único | centraliza o pitch; no máximo um oráculo entre N |

## Riscos

| Risco | Mitigação |
|---|---|
| Marketing vende TEE mentiroso | Checklist A + review de copy antes do launch |
| Fases IA ativas sem um oráculo demo | Script faucet + um oráculo interno na testnet de launch |
| Advisor empurra witness a assinar gov | UI + testes [14](14-governanca-ancora.md) |
| Score vira “ranking oficial” político | Disclaimer + zero wire para consenso |
| Attester prematuro | `AI_TEE_HEIGHT` alto até E completo |

## Ordem vs outros planos

1. Gênese com Âncora + gov ([13](13-ancora-pq-multisig.md) · [14](14-governanca-ancora.md))  
2. **Este plano B+C** — heights IA + oráculo usável  
3. **D** ops leve em paralelo (advisor/sentinel/score)  
4. GB ([12](12-gb-assinatura-livre.md)) documenta custo de `AI_TASK`  
5. **E–F** e itens [15](15-longo-prazo-adiados.md) depois de G0/G1  

## Ligação

- Código: `rust/src/state/ai.rs` · `rust/src/config.rs` (`AI_*_HEIGHT`)  
- Whitepaper §10 (EN/PT)  
- Gov/Âncora: [13](13-ancora-pq-multisig.md) · [14](14-governanca-ancora.md)  
- Adiados: [15](15-longo-prazo-adiados.md)  
- Mapa: [10](10-mapa-integrado.md) · [11](11-mapa-melhorias-projeto.md)
