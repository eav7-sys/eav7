# Plano: Governança · Âncora manda, witness só produz

**Status:** aceito em desenho (2026-08-09) — amarrar no **lançamento** (gênese)  
**Depende de:** [13-ancora-pq-multisig.md](13-ancora-pq-multisig.md) · permissões v2  
**Não é relaunch:** ninguém usou em produção econômica; estamos amadurecendo o launch.

## Em uma frase

Governança on-chain continua **só Âncoras ativas + quórum + timelock**; o upgrade é **quem assina**: `owner` / multisig — **nunca** a chave `witness` do VPS.

## Decisão

| Item | Escolha |
|---|---|
| Quem propõe / vota | Só validador **ativo** (igual hoje) |
| Quórum | `⌊2N/3⌋ + 1` (igual hoje) |
| Timelock | Manter `GOV_TIMELOCK_BLOCKS` (~40 000); ver classes abaixo |
| Anti-brick | Manter (não esvaziar set via parâmetro) |
| Bridge committee ativo | Gov **não** substitui — só bootstrap se não existir (igual hoje) |
| IA | Advisor **só rascunho** — sem voto, sem peso, sem submit |
| Assinatura de `GOV_PROPOSE` / `GOV_VOTE` | **`owner` / limiar multisig** da conta Âncora |
| `witness` | Produz bloco / attest — **proibido** autorizar gov |
| Conta Âncora M-of-N | Gov via `MULTISIG_PROPOSE` / `APPROVE` (ops novas) |
| Classes leve/dura | **Sim no launch se couber**; senão timelock único já conservador + classes na v1.1 |
| Holder voting / 1 token = 1 voto | **Fora** do launch |
| Conselho off-chain com poder de protocolo | **Fora** |
| IA com peso em gov | **Fora** |

Frase de produto:  
**Âncoras multisig decidem. Witness só minera. Timelock protege o resto.**

## Por que agora (gênese)

Com set pequeno, a chave no VPS **é** o poder político se puder assinar `GOV_*`.  
Âncora sem essa amarração é cosmética. Mudar depois, com propostas e hábitos formados, dói mais — e neste momento ainda dá para cravar na gênese.

## O que já existe (não reinventar)

- `GOV_PROPOSE` / `GOV_VOTE` · quórum · timelock · anti-brick — `rust/src/state/gov.rs`, whitepaper §8.3  
- AI advisor propose-only (whitepaper § AI)  
- Trilho da ponte: gov não troca committee ativo  

### Gaps a fechar

| Gap | Hoje | Alvo |
|---|---|---|
| Ops multisig | `MULTISIG_OPS` **não** inclui `GOV_PROPOSE` / `GOV_VOTE` | Incluir |
| Autorização | Conta validadora assina como `tx.from` (chave “da conta”) | Conta v2 com `witness`: gov exige autoridade de **`owner`** (limiar), não da chave de produção |
| Heights de launch | `GOVERNANCE_HEIGHT` / `PERMISSIONS_V2_HEIGHT` altos na config atual | **0** (ou já ativos) na gênese de launch |
| UX timelock | Pouca narrativa humana | Explorador/Core: o que muda + countdown |

## Modelo

```
Proposta / voto on-chain
        │
        ▼
┌───────────────────┐
│ Conta Âncora      │  ← tem de estar no set ativo
│ owner 2-de-3  ────┼── autoriza GOV_* (multisig se limiar > 1)
│ witness (VPS) ────┼── NÃO autoriza GOV_*
└───────────────────┘
        │
        ▼
  quórum ⌊2N/3⌋+1  →  QUEUED  →  timelock  →  aplica
```

## Classes de proposta (opcional no dia 1)

Mesmo quórum. Timelock (e só isso) diferente:

| Classe | Exemplos | Timelock |
|---|---|---|
| **Leve** | constantes operacionais de baixo impacto | atual (`GOV_TIMELOCK_BLOCKS`) |
| **Dura** | treasury spend/enable, `MIN_VALIDATOR_STAKE`, `MAX_VALIDATORS`, bootstrap bridge/attester, mudanças que alterem “quem manda” | **maior** (constante nova, ex. 2–4×) |

Se o cronograma apertar: **não** bloquear o launch — subir o timelock único e deixar classes para logo após.

## Fora de escopo no launch (com motivo)

| Opção | Por que não agora |
|---|---|
| Governança de holders | Supply/stake concentrados → plutocracia; dois soberanos cedo; whitepaper já admite centralização inicial |
| Conselho off-chain com poder | Contorna quórum/timelock; mesmo risco do VPS com outro nome. Ops humana (comunicado) ok; poder de consenso não |
| IA com peso | Quebra o diferencial limpo (advisor sem assinatura); superfície de ataque vira o modelo/prompt |

Revisitar só com set de Âncoras real e stake disperso — mapa e gates: [15](15-longo-prazo-adiados.md).

## Trilha (checklist)

### A — Spec / docs

- [x] Decisão neste plano
- [x] Whitepaper §8.3 (EN + PT): Âncora autoriza gov; witness não; fora holder/council/IA-voto
- [ ] Portal `/developers`: fluxo propor/votar com multisig
- [x] Ligação explícita a [13](13-ancora-pq-multisig.md)

### B — Protocolo (`eav7`)

- [x] `MULTISIG_OPS`: adicionar `GOV_PROPOSE`, `GOV_VOTE`
- [x] Autorização: se conta tem permissão v2 com `witness`, `GOV_*` só conta se a assinatura / aprovação satisfizer **`owner`** (não bastar ser a chave witness)
- [ ] Conta ainda `root` / sem permissões: comportamento atual (1 chave = owner implícito) até virar Âncora — produto empurra M-of-N no onboarding
- [ ] `GOVERNANCE_HEIGHT` = 0 (ou ativo) na config de **lançamento**
- [ ] Testes: witness key sozinha **não** propõe nem vota; owner 2-de-3 completa via MULTISIG_*; quórum/timelock/anti-brick intactos
- [ ] Teste: META_TX / atalhos não burlar a guarda owner-vs-witness em gov
- [ ] *(Opcional dia 1)* mapa param → classe leve/dura + `GOV_TIMELOCK_HARD_BLOCKS`

### C — Nó / API / produto

- [ ] API/explorer: proposta mostra classe, `executeAt`, texto humano do param
- [ ] Core: comando/guia “propor parâmetro” usa chaves owner / fluxo multisig — nunca o keystore só-witness
- [ ] Advisor de IA: continua draft-only; UI deixa claro que Âncora tem de assinar

### D — Lançamento

- [ ] Mesma gênese que Âncora ([13](13-ancora-pq-multisig.md)) e, se fechado, GB ([12](12-gb-assinatura-livre.md))
- [ ] Nenhuma Âncora de launch com gov assinável só pelo VPS
- [ ] Runbook: “como votar uma proposta” = assembleia owner offline / multisig

## Riscos

| Risco | Mitigação |
|---|---|
| Ops esquece multisig e rede “trava” gov | Onboarding Âncora obrigatório; limiar 2 com 3 shares testados antes do launch |
| Divergência se só parte dos nós aplica a guarda | Height/gênese único; testes de vetor |
| Classes dura/leve atrasam | Cortar classes; manter guarda owner + timelock atual |

## Ordem vs outros planos

1. [13](13-ancora-pq-multisig.md) B — v2 na gênese + owner M-of-N  
2. **Este plano B** — ops gov + guarda witness  
3. Produto C (explorer/Core) em paralelo  
4. Classes dura/leve — dia 1 ou v1.1 sem drama  

## Ligação

- Código: `rust/src/state/gov.rs` (`gov_propose`, `gov_vote`, `MULTISIG_OPS`, `apurar`)  
- Âncora: [13](13-ancora-pq-multisig.md)  
- Permissões: `docs/permissoes-v2.md`  
- Mapa: [10](10-mapa-integrado.md) · [11](11-mapa-melhorias-projeto.md)
