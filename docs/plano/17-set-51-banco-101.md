# Plano: Set de Âncoras · 51 ativas + banco 101

**Status:** aceito em desenho (2026-08-09) — **lançamento** (gênese)  
**Substitui implícito:** `MAX_VALIDATORS = 27`  
**Liga a:** [13](13-ancora-pq-multisig.md) Âncora · [14](14-governanca-ancora.md) gov · [15](15-longo-prazo-adiados.md) gates · [08](08-descentralizacao-core-carteira.md)

## Em uma frase

Teto ativo **51**, ecossistema ranqueado até **101** (ativas + banco), launch honesto **5–7**, voto na gênese — descentralização por **mais assentos e banco real**, não por marketing.

## Por que mudar

| Hoje | Problema |
|---|---|
| `MAX_VALIDATORS = 27` | Teto pequeno demais para a meta de descentralização |
| Sem banco protocolar | Queda de uma ativa = buraco até o weight reordenar no próximo bloco (ok) mas **ninguém é “reserva”** com dever/ incentiva |
| Voto / set pequeno | Whitepaper já admite clube fundação; teto 27 não ajuda a sair dele |

## Decisão

| Item | Escolha |
|---|---|
| Âncoras **ativas** | **51** (`MAX_VALIDATORS`) |
| Quórum gov / BFT (N=51) | `⌊2×51/3⌋+1 = **35**` |
| **Banco** (standby) | Próximas **50** por weight → total ranqueado **101** |
| Teto governável de ativos | **101** (já é o `max` de `MAX_VALIDATORS` em gov) — subir ativos 51→101 só com set cheio + custo PQ ok |
| Launch (gênese) | **5–7** Âncoras fundação (todas M-of-N + witness, [13](13-ancora-pq-multisig.md)) |
| `VOTING_HEIGHT` | **0** no launch — ranking = self-stake **+ votos** desde o início |
| `FINALITY_MIN_VALIDATORS` | Mantém **3** (rede sobe; finality frágil enquanto N&lt;~10 — documentar) |
| Produção de bloco | Só **ativas**; banco **não** assina bloco até promover |
| Gov on-chain | Só **ativas** ([14](14-governanca-ancora.md)) — banco não vota parâmetro |
| Sinal econômico do banco | **Leve** (fase B): fração pequena da reward de disponibilidade / missed-slot priority — sem diluir ativas demais |
| 101 ativos no dia 1 | **Não** — peso PQ em finality/época; meta de maturidade |

## Modelo

```
Weight = self-stake + votos recebidos
        │
        ▼
┌─────────────────────────────────────┐
│ Top 51      → Âncoras ATIVAS        │  bloco · finality · gov
│ 52 … 101    → BANCO                 │  prontas · sinal leve · promoção
│ 102+        → candidatos fora       │  só weight / UI
└─────────────────────────────────────┘
```

Frase: **51 cadeiras ativas com fila de reserva — sem fingir 51 nós da fundação no dia 1.**

## O que o protocolo já tem

- Ranking por weight, truncate em `MAX_VALIDATORS` — `validadores()` em `rust/src/state/gov.rs`  
- Param governável `MAX_VALIDATORS` com teto **101**  
- Anti-brick se set esvaziar  

### O que falta

| Peça | Hoje | Alvo |
|---|---|---|
| Default 51 | constante **27** | `MAX_VALIDATORS = 51` |
| Banco | inexistente (só “quem ficou de fora”) | conjunto **standby** derivado (top 101 \\ ativos) com API + regras de promoção |
| Incentivo banco | 0 | fase B — mínimo viável |
| Voto na gênese | `VOTING_HEIGHT` alto na mainnet param set | **0** no launch |
| Docs / produto | “27” no whitepaper | 51 + banco 101 |

---

## Trilha (checklist)

### A — Spec / narrativa (launch)

- [x] Decisão neste plano  
- [x] Whitepaper (EN + PT): § validadores — 51 ativas, banco 50; launch 5–7; meta encher set  
- [x] Portal + explorador: abas **Ativas** / **Banco** (candidatas = ranked futuro)  
- [ ] Atualizar gates em [15](15-longo-prazo-adiados.md): G1/G2 falam em 15/27 → alinhar a **~25 / 51**  
- [ ] Runbook ops: “entrar no banco” vs “estar ativa”  

### B — Protocolo mínimo (gênese)

- [x] `rust/src/config.rs`: `MAX_VALIDATORS = 51`  
- [x] Constante nova (proposta): `VALIDATOR_BANK_SIZE = 50` (ativos+banco = 101)  
- [x] `validadores()` inalterado na ideia; nova `banco()` / `ranked(limit=101)` para API e promoção  
- [ ] `VOTING_HEIGHT = 0` (ou ativo) na config de **lançamento**  
- [ ] Gov: manter max param 101; default efetivo 51; anti-brick intacto  
- [ ] Testes: N&gt;51 trunca ativos; posições 52–101 aparecem como banco; empate por endereço (regra atual)  
- [ ] Vetores / fixtures que assumem 27 revisados  

### C — Banco com dentes (pode ser logo após A+B se A+B só mudarem o número)

Sem isto o “banco” é só UI. Com isto vira melhoria real:

- [ ] **Promoção:** se ativa perde elegibilidade (unstake, slash, weight), a #52 assume no mesmo recálculo de set (já quase true se só aumentarmos Max — **banco explícito** documenta e expõe as 50 seguintes)  
- [ ] **Missed slots (opcional v1.1):** após K falhas consecutivas de uma ativa, priorizar standby no scheduler — spec alinhada a [20](20-consenso-liveness-finality.md) C  
- [ ] **Reward leve (opcional v1.1):** ex. ≤5% do bloco (param) repartido ao banco por heartbeat/availability off-chain attested **ou** só por estar no top 101 com stake — evitar farm barato  
- [ ] Decisão explícita na impl.: v1 = banco **derivado + API**; v1.1 = missed-slot e/ou reward  

**Recomendação de corte:** launch = **B completo (51 + `banco()` + voto 0 + UI)**; missed-slot/reward = não bloquear gênese.

### D — Produto / descentralização real

- [ ] Core: onboarding Âncora aponta “meta: banco → ativa”  
- [ ] Metas públicas (atualizar whitepaper § descentralização):  
  - ≥ **10** Cores ouvintes externos  
  - ≥ **15** candidatas com stake próprio no top 101  
  - **Maioria das 51** com chaves fora do operador fundador (quando N ativo ≥ 15)  
- [ ] Não operar 51 nós fundação “para encher” — isso é centralização disfarçada  
- [ ] Score Âncora ([13](13-ancora-pq-multisig.md) / [16](16-ia-oraculo-ops.md)): badge **ativa** vs **banco** — sem poder de consenso  

### E — PQ / época / finality (consciência)

- [ ] Finality com N→51: mais sigs híbridas — medir latência antes de marketing “51 finality”  
- [ ] Cert de época ([13](13-ancora-pq-multisig.md) D): quórum sobre **ativas**, não 101  
- [ ] Subir `MAX_VALIDATORS` a 101 via gov só após: set ~cheio, finality ok, época (se existir) ok — ver [15](15-longo-prazo-adiados.md)

## Fora de escopo

- Encher o set com operadores fantasma da fundação  
- 101 ativos no gênese  
- IA escolhendo quem entra no banco ([16](16-ia-oraculo-ops.md))  
- Baixar `MIN_VALIDATOR_STAKE` neste plano (decisão econômica à parte; só notar que stake alto demais engessa o 51)

## Riscos

| Risco | Mitigação |
|---|---|
| 51 slots vazios / fundação domina | Launch 5–7 + metas D + voto 0 |
| Banco sem incentivo = fantasma | UI honesta na v1; reward/missed na v1.1 |
| Finality lenta com PQ | Medir; não forçar 101 ativos cedo |
| Fixtures/testes quebram com 27 | Checklist B |

## Ordem vs outros planos

1. Gênese Âncora + gov ([13](13-ancora-pq-multisig.md) · [14](14-governanca-ancora.md))  
2. **Este plano B** — 51 + banco derivado + voto 0  
3. UI ativas/banco (**D**)  
4. v1.1 missed-slot / reward banco (**C** opcional)  
5. Cert época e teto 101 ativos quando gates [15](15-longo-prazo-adiados.md) pedirem  

## Ligação

- `rust/src/config.rs` (`MAX_VALIDATORS`) · `rust/src/state/gov.rs` (`validadores`, param gov)  
- Whitepaper §8 / §13 (EN/PT) — 27 → 51 + banco  
- Mapa: [10](10-mapa-integrado.md) · [11](11-mapa-melhorias-projeto.md)
