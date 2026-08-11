# Plano: Fechar o desenvolvimento pendente (12–21)

**Status:** aceito em desenho (2026-08-09) — **mapa para não se perder**  
**Regra de ouro:** código e testes **antes** de gênese-ativa / heights 0.  
**Não confundir com:** [21](21-launch-checklist.md) (ordem de launch/ops). **Este** = o que ainda falta **programar**.

## Em uma frase

Os planos 12–21 são desenho fechado; quase tudo ainda é checkbox aberto no código — este doc lista **o que falta implementar**, em que **ordem**, e o que fica **depois**.

## Onde estamos (honestidade)

| Camada | Estado |
|---|---|
| Decisões de produto (Âncora, GB, EAV20-EAVM, set 51, gov, ponte, IA, consenso) | **Fechadas** nos planos |
| Código protocolo hoje | Muito já existe (v2 witness, `TOKEN_*` nativo, EAVM, AI txs, bridge…) |
| Gaps de código vs planos | **Grandes** — ver trilhos abaixo |
| Gênese launch (`GENESIS_ACTIVE` / heights 0) | **Proibido** até os trilhos P0 deste doc estarem verdes |

```
Desenho (12–21)  ✅
     │
     ▼
Código P0 (este plano)  ← VOCÊ ESTÁ AQUI
     │
     ▼
Gênese + heights 0  ([21] onda 0)
     │
     ▼
Testnet / faucet / audit  ([21] ondas 6–7)
     │
     ▼
Mainnet
```

---

## Trilhos P0 — obrigatórios antes da gênese de launch

Cada trilho = mergeável com testes. Só depois de **todos P0 verdes** → flip `GENESIS_ACTIVE` / heights.

### T1 — Âncora + governança *(planos 13 + 14)*

**Já no código:** permissões v2, witness na produção, ops `VOTE`/`SET_COMMISSION`/…  
**Falta:**

| # | Entrega | Onde |
|---|---|---|
| T1.1 | `GOV_PROPOSE` / `GOV_VOTE` em `MULTISIG_OPS` | `rust/src/state/gov.rs` |
| T1.2 | Guarda: conta com `witness` — `GOV_*` e ops de poder só com autoridade **owner** (não chave witness) | `gov.rs` + testes |
| T1.3 | Testes e2e Âncora: stake → `PERMISSION_UPDATE` v2 2-de-3 + witness; witness não governa | `rust/` tests |
| T1.4 | SDK: helpers `ancora_init` / `ancora_rotate_witness` (wrappers) | `rust/sdk` ✅ |
| T1.5 | Core: fluxo gerar N seeds, backup, keystore só witness | `rust/core` ✅ `ancora-init` |

**Pronto quando:** testes T1.2–T1.3 verdes; Core cria Âncora sem colar owner no VPS.

### T2 — Set 51 + banco *(plano 17)*

| # | Entrega | Onde |
|---|---|---|
| T2.1 | `MAX_VALIDATORS = 51`, `VALIDATOR_BANK_SIZE = 50` | `config.rs` ✅ |
| T2.2 | Função `banco()` / ranked top 101; API expõe ativas vs banco | `gov.rs` + API nó ✅ |
| T2.3 | Testes truncate 51 e posições 52–101 | tests (API `bank`/`bankSize` ✅; expandir set) |

**Pronto quando:** status/validators distingue ativa vs banco.

### T3 — Taxa GB *(plano 12)*

| # | Entrega | Onde |
|---|---|---|
| T3.1 | Constantes `GB_*` + `GB_FEE_HEIGHT` (0 só na gênese final) | `config.rs` ✅ (`GB_FEE_HEIGHT=1e8` até T7) |
| T3.2 | `peek_gb` / `commit_gb`; bytes sem sigs; burn unificado | `recursos.rs` + conta ✅ |
| T3.3 | API `gb` / `gbUsed`; testes cota/stake/sig | nó + tests ✅ (cota/sig; stake via API) |

**Pronto quando:** transfer dentro da cota não queima; deploy pode queimar; sig não muda consumo.

### T4 — EAV20 = contrato EAVM *(plano 19)*

| # | Entrega | Onde |
|---|---|---|
| T4.1 | `contracts/EAV20.sol`, `EAV20Managed.sol`, `EAV20Factory.sol` | `contracts/` + `artifacts/` ✅ |
| T4.2 | Deploy/factory e2e na EAVM (JSON-RPC + `EAVM_*`) | `eav20_contract.rs` ✅ deploy + factory createMinimal + transfer |
| T4.3 | Portal/explorer: criar token = factory (mínimo UX) | guia portal ✅; explorer badge pendente |
| T4.4 | Doc: `TOKEN_*` = legado; EAV20 = contrato | portal i18n ✅ |

**Pronto quando:** factory → transfer MetaMask/path JSON-RPC num teste automatizado ou script CI.

### T5 — Consenso launch-ready *(plano 20 B — sem skip ainda)*

| # | Entrega | Onde |
|---|---|---|
| T5.1 | Garantir caminhos strict producer + stateRoot + slash **testados** com heights de fixture | ✅ já em `blockchain.rs` (`acima_do_fork_o_bloco_fora_do_slot…`, `stateRoot não confere`) + `value.rs` (`slash_com_evidencia_real…`) |
| T5.2 | Spec skip/miss escrita o bastante para PR futuro (já no 20) — **código skip = P1** | — |

**Pronto quando:** suíte cobre strict/stateRoot/slash; skip **não** bloqueia T1–T4. ✅

### T6 — Vesting na gênese + bloco enxuto *(plano 21 A1–A2)*

| # | Entrega | Onde |
|---|---|---|
| T6.1 | Generator/boot: tabela `vesting` no JSON de gênese (cliff ≥ 12m buckets não-públicos) | `boot.rs` ✅ helper + cliff 12m |
| T6.2 | Bloco enxuto: referenciar pubs PQ + encoding compacto; vetores; medição GB/dia | SPKI-base64 + omit pubs via `producer_keys` ✅ (`COMPACT_BLOCK_HEIGHT` até T7) |
| T6.3 | Testes gênese com vesting; tamanho de bloco ocioso documentado | tests ✅ vesting + size anchor |

**Pronto quando:** gênese de teste tem vesting real; bloco vazio ≪ 5,8 KB atuais (número anotado).

### T7 — Ligar gênese de launch *(só no fim do P0)*

| # | Entrega |
|---|---|
| T7.1 | `GENESIS_ACTIVE_BUILD = true` + heights P0 em **0** + `MAX_VALIDATORS=51` + breaker/bridge conforme [18](18-ponte-committee-breaker.md) se ponte on |
| T7.2 | `cargo test` workspace verde no modo gênese-ativa |
| T7.3 | Atualizar [21](21-launch-checklist.md) onda 0 como feita |

**Proibido:** fazer T7 antes de T1–T6.

**Estado P0 (2026-08-09):** T1–T6 de código/protocolo/docs mínimos **prontos**.  
**T7 / gênese de launch:** **não** rodar nesta máquina — gerar e ativar **somente no servidor de entrega** (onda 0 de [21](21-launch-checklist.md)). Dev local mantém heights distantes (`GB_FEE_HEIGHT=1e8`, etc.).  
Pendências não-bloqueantes: explorer badge 0x, MetaMask manual / permit EIP-2612 e2e (path secp). Whitepaper v1.2 alinhado.

---

## Trilhos P1 — no escopo “fechar dev”, mas depois do P0

| Trilho | Plano | Entrega resumida |
|---|---|---|
| P1-A | [16](16-ia-oraculo-ops.md) | UX oráculo Core/explorer + heights IA; TEE continua distante |
| P1-B | [18](18-ponte-committee-breaker.md) | Breaker on, committee ≥3, 1 adapter **ou** ponte off na UI |
| P1-C | [20](20-consenso-liveness-finality.md) C | Skip + miss + downtime |
| P1-D | [13](13-ancora-pq-multisig.md) D | Cert de época |
| P1-E | [21](21-launch-checklist.md) A4–A5 | Testnet/faucet + audit focada |
| P1-F | Docs | Whitepapers/portal alinhados (pode ir em paralelo ao P0) |

## Explicitamente fora (não são “pendência de fechar”)

- Holder gov / council / IA com peso — [15](15-longo-prazo-adiados.md)  
- EAV721 / EAV-NS no G0 — default fora ([21](21-launch-checklist.md) A3)  
- Light client / P2P auth / 101 ativos  
- Apagar `TOKEN_*` do protocolo  

---

## Ordem de trabalho (sprints)

Use isto no dia a dia. Um sprint ≈ um trilho P0 mergeado.

| Sprint | Foco | Saída |
|---|---|---|
| **S1** | T1 Âncora/gov | Multisig GOV + guarda witness + testes |
| **S2** | T2 Set 51 + banco | Const + API + testes |
| **S3** | T3 GB | `recursos` + API + testes |
| **S4** | T4 EAV20 contratos | Solidity + e2e deploy |
| **S5** | T6 Vesting + bloco enxuto | Generator + formato bloco |
| **S6** | T5 endurecer + polish sem gênese | CI verde; Core/SDK Âncora+GB; portal bank/GB |
| **S6b** | T7 gênese (**servidor de entrega**) | Flip `GENESIS_ACTIVE` + heights 0 **só no host de launch** |
| **S7+** | P1 conforme prioridade produto | IA / ponte / skip / testnet |

Paralelo seguro: **P1-F docs** e partes de **T4 UI** enquanto S1–S3 rodam.

---

## Como saber se “acabou o desenvolvimento pendente”

**Definição de pronto (dev P0):**

1. Checklists T1–T6 com itens de código marcados nos planos-fonte  
2. T7 feito e `cargo test -p eav7 --workspace` (ou o comando canônico do repo) verde em gênese-ativa  
3. Script manual: subir 1 nó → Âncora 2-de-3 → deploy EAV20 factory → transfer  
4. [21](21-launch-checklist.md) onda 0–3 essencialmente feita; ondas 4–7 = ops/testnet/mainnet  

Aí o “desenvolvimento pendente dos planos” de launch está fechado; o resto é P1 + [15](15-longo-prazo-adiados.md).

## Anti-perda (mapa mental de 10 segundos)

| Quero… | Ler |
|---|---|
| O que programar agora | **Este arquivo** — sprint S1… |
| Como lança a rede | [21](21-launch-checklist.md) |
| Detalhe de uma feature | Plano 12–20 do tema |
| O que NÃO fazer ainda | [15](15-longo-prazo-adiados.md) |
| Decisões fechadas | [06](06-decisoes-abertas.md) |

## Ligação

- Mestre launch: [21](21-launch-checklist.md)  
- Features: [12](12-gb-assinatura-livre.md) … [20](20-consenso-liveness-finality.md)  
- Índice: [README](README.md) · [10](10-mapa-integrado.md) · [11](11-mapa-melhorias-projeto.md)
